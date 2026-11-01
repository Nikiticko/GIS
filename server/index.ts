import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Transform } from "node:stream";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { assignments, attachments, audit, notifications, projects, projectVehicles, sessions, users, vehicles, workTypes } from "./schema.js";

const logFile = resolve(process.env.LOG_FILE || "logs/gis-api.log");
mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
closeSync(openSync(logFile, "a", 0o600));
class SessionExpired extends Error { statusCode = 401; }
const app = Fastify({ logger: { level: "info", file: logFile }, logController: new Fastify.LogController({ disableRequestLogging: true }), trustProxy: process.env.TRUST_PROXY || false });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  app.log.fatal("Не задано DATABASE_URL");
  process.stderr.write("Не задано DATABASE_URL. Налаштуйте підключення до PostgreSQL.\n");
  process.exitCode = 1;
} else {
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
const db = drizzle(pool);
app.setErrorHandler((error, request, reply) => {
  const status = (error as { statusCode?: number }).statusCode;
  const code = status && status >= 400 && status < 500 ? status : 500;
  const rawCode = (error as { code?: unknown }).code;
  const errorCode = typeof rawCode === "string" && /^[A-Z0-9_]{1,50}$/.test(rawCode) ? rawCode : undefined;
  request.log.error({ statusCode: code, errorCode }, "Помилка обробки запиту");
  return reply.code(code).send({ error: error instanceof SessionExpired ? "Сесію завершено." : code === 413 ? "Файл перевищує допустимий розмір." : code < 500 ? "Некоректний запит." : "Не вдалося виконати запит." });
});
app.addHook("onSend", async (_request, reply, payload) => {
  reply.header("Cache-Control", "no-store");
  return payload;
});
app.addHook("onResponse", async (request, reply) => {
  const details = { method: request.method, route: request.routeOptions.url || "невідомий маршрут", statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) };
  if (reply.statusCode >= 500) request.log.error(details, "Запит завершено з помилкою сервера");
  else if (reply.statusCode >= 400) request.log.warn(details, "Запит відхилено");
  else request.log.info(details, "Запит виконано");
});
await app.register(cookie);
await app.register(multipart, { limits: { files: 1, fileSize: 2_147_483_647 } });
const bucket = process.env.S3_BUCKET;
const storage = bucket ? new S3Client({ region: process.env.AWS_REGION || "us-east-1", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: true }) : null;
const sessionCookie = "gis_session";
const secure = process.env.NODE_ENV === "production";
const attempts = new Map<string, { count: number; until: number }>();

app.post("/api/auth/login", async (request, reply) => {
  const now = Date.now();
  const attempt = attempts.get(request.ip);
  if (attempt && attempt.until > now && attempt.count >= 10) return reply.code(429).send({ error: "Забагато спроб входу. Спробуйте пізніше." });
  const current = attempt && attempt.until > now ? attempt : { count: 0, until: now + 15 * 60_000 };
  current.count++;
  attempts.set(request.ip, current);
  function releaseAttempt() {
    if (attempts.get(request.ip) !== current) return;
    current.count--;
    if (current.count === 0) attempts.delete(request.ip);
  }
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
  const token = randomBytes(32).toString("hex");
  let user;
  try {
    user = parsed.success ? await db.transaction(async (tx) => {
      const [matched] = await tx.select().from(users).where(eq(users.keyCode, parsed.data.code)).for("update");
      if (!matched?.active) return undefined;
      await tx.insert(sessions).values({ id: token, userId: matched.id });
      return matched;
    }) : undefined;
  } catch (error) {
    releaseAttempt();
    throw error;
  }
  if (!user) {
    return reply.code(401).send({ error: "Невірний код або обліковий запис неактивний." });
  }
  releaseAttempt();
  reply.setCookie(sessionCookie, token, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return { id: user.id, name: user.name, role: user.role };
});

app.get("/api/auth/me", async (request, reply) => {
  const token = request.cookies[sessionCookie];
  if (!token) return reply.code(401).send({ error: "Потрібно увійти." });
  const result = await db.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(eq(sessions.id, token)).limit(1);
  const user = result[0];
  if (!user?.active) return reply.code(401).send({ error: "Сесію завершено." });
  return { id: user.id, name: user.name, role: user.role };
});
app.post("/api/auth/logout", async (request, reply) => {
  const token = request.cookies[sessionCookie];
  if (token) await db.delete(sessions).where(eq(sessions.id, token));
  reply.clearCookie(sessionCookie, { path: "/" });
  return { ok: true };
});

const roles = z.enum(["MANAGER", "PRODUCTION_HEAD", "PRODUCTION_EMPLOYEE"]);
const uuidParam = z.object({ id: z.string().uuid() });
const createUser = z.object({ name: z.string().trim().min(1), role: roles, phone: z.string().trim().nullable().optional(), foreman: z.boolean().optional() }).strict();
const updateUser = createUser.partial().extend({ active: z.boolean().optional(), expectedUpdatedAt: z.iso.datetime({ offset: true }).optional() }).strict();

async function currentUser(token: string | undefined) {
  if (!token) return undefined;
  const [user] = await db.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id)).where(eq(sessions.id, token)).limit(1);
  return user?.active ? user : undefined;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function sessionStillValid(tx: Transaction, token: string | undefined, actor: { id: string; role: string }) {
  if (!token) return "unauthorized" as const;
  const [current] = await tx.select({ id: users.id, role: users.role, active: users.active }).from(users).where(eq(users.id, actor.id)).for("share");
  if (!current?.active) return "unauthorized" as const;
  const [session] = await tx.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, token), eq(sessions.userId, actor.id))).for("share");
  if (!session) return "unauthorized" as const;
  return current.role === actor.role ? "ok" as const : "changed" as const;
}

async function requireAdmin(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const user = await currentUser(request.cookies[sessionCookie]);
  if (!user) { await reply.code(401).send({ error: "Потрібно увійти." }); return undefined; }
  if (user.role !== "ADMIN") { await reply.code(403).send({ error: "Недостатньо прав." }); return undefined; }
  return user;
}

app.get("/api/users", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  return db.transaction(async (tx) => {
    if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
    return tx.select().from(users);
  });
});

app.post("/api/users", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const input = createUser.safeParse(request.body);
  if (!input.success || (input.data.foreman && input.data.role !== "PRODUCTION_EMPLOYEE")) return reply.code(400).send({ error: "Некоректні дані користувача." });
  for (let i = 0; i < 20; i++) {
    try {
      const result = await db.transaction(async (tx) => {
        if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
        const [user] = await tx.insert(users).values({ ...input.data, phone: input.data.phone || null, foreman: input.data.foreman ?? false, keyCode: String(randomInt(0, 1_000_000)).padStart(6, "0") }).returning();
        await tx.insert(audit).values({ actorId: actor.id, entityType: "user", entityId: user.id, action: "CREATE" });
        return user;
      });
      return reply.code(201).send(result);
    } catch (error) {
      if ((error as { cause?: { code?: string; constraint?: string } }).cause?.constraint !== "users_key_code_unique") throw error;
    }
  }
  return reply.code(503).send({ error: "Не вдалося створити унікальний код." });
});

app.patch("/api/users/:id", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const params = uuidParam.safeParse(request.params), input = updateUser.safeParse(request.body);
  if (!params.success || !input.success || !Object.keys(input.data).some((key) => key !== "expectedUpdatedAt")) return reply.code(400).send({ error: "Некоректні дані користувача." });
  const { expectedUpdatedAt, ...changes } = input.data;
  return db.transaction(async (tx) => {
        if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
    const [old] = await tx.select().from(users).where(eq(users.id, params.data.id)).for("update");
    if (!old) return reply.code(404).send({ error: "Користувача не знайдено." });
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== old.updatedAt.getTime()) return reply.code(409).send({ error: "Профіль змінився. Оновіть дані перед збереженням." });
    if (old.role === "ADMIN" && (changes.role !== undefined || changes.active === false)) return reply.code(403).send({ error: "Роль і активність адміністратора захищені." });
    const nextRole = changes.role ?? old.role;
    const nextForeman = changes.foreman ?? (nextRole === "PRODUCTION_EMPLOYEE" ? old.foreman : false);
    if (nextForeman && nextRole !== "PRODUCTION_EMPLOYEE") return reply.code(400).send({ error: "Бригадиром може бути лише працівник виробництва." });
    const next = { ...changes, ...(changes.phone !== undefined ? { phone: changes.phone || null } : {}), foreman: nextForeman };
    const [updated] = await tx.update(users).set({ ...next, updatedAt: sql`greatest(clock_timestamp(), ${users.updatedAt} + interval '1 millisecond')` }).where(eq(users.id, old.id)).returning();
    for (const field of ["name", "role", "phone", "active", "foreman"] as const) {
      if (old[field] !== updated[field]) await tx.insert(audit).values({ actorId: actor.id, entityType: "user", entityId: old.id, action: "UPDATE", field, oldValue: String(old[field] ?? ""), newValue: String(updated[field] ?? "") });
    }
    if (old.active && !updated.active) {
      await tx.delete(sessions).where(eq(sessions.userId, old.id));
      if (old.role === "PRODUCTION_EMPLOYEE") {
        const heads = await tx.select({ id: users.id }).from(users).where(eq(users.role, "PRODUCTION_HEAD"));
        if (heads.length) await tx.insert(notifications).values(heads.map((head) => ({ userId: head.id, type: "EMPLOYEE_DEACTIVATED", subjectUserId: old.id })));
      }
    }
    return updated;
  });
});

app.post("/api/users/:id/sessions/revoke", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  return db.transaction(async (tx) => {
        if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, params.data.id)).for("update");
    if (!user) return reply.code(404).send({ error: "Користувача не знайдено." });
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await tx.insert(audit).values({ actorId: actor.id, entityType: "user", entityId: user.id, action: "REVOKE_SESSIONS" });
    return { ok: true };
  });
});

app.post("/api/users/:id/key-code/reissue", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  for (let i = 0; i < 20; i++) {
    try {
      return await db.transaction(async (tx) => {
        if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
        const [user] = await tx.select().from(users).where(eq(users.id, params.data.id)).for("update");
        if (!user) return reply.code(404).send({ error: "Користувача не знайдено." });
        let code: string;
        do { code = String(randomInt(0, 1_000_000)).padStart(6, "0"); } while (code === user.keyCode);
        await tx.update(users).set({ keyCode: code, updatedAt: sql`greatest(clock_timestamp(), ${users.updatedAt} + interval '1 millisecond')` }).where(eq(users.id, user.id));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await tx.insert(audit).values({ actorId: actor.id, entityType: "user", entityId: user.id, action: "REISSUE_KEY_CODE" });
        return { keyCode: code };
      });
    } catch (error) {
      if ((error as { cause?: { code?: string; constraint?: string } }).cause?.constraint !== "users_key_code_unique") throw error;
    }
  }
  return reply.code(503).send({ error: "Не вдалося створити унікальний код." });
});

const directoryName = z.object({ name: z.string().trim().min(1), active: z.boolean().optional() }).strict();
const vehicleInput = directoryName.extend({ registration: z.string().trim().min(1) });
const directoryParam = z.object({ kind: z.enum(["work-types", "vehicles"]), id: z.string().uuid() });

app.get("/api/work-types", async (request, reply) => {
  const user = await currentUser(request.cookies[sessionCookie]);
  if (!user) return reply.code(401).send({ error: "Потрібно увійти." });
  if (user.role === "PRODUCTION_EMPLOYEE") return reply.code(403).send({ error: "Недостатньо прав." });
  return db.select().from(workTypes);
});
app.get("/api/vehicles", async (request, reply) => {
  const user = await currentUser(request.cookies[sessionCookie]);
  if (!user) return reply.code(401).send({ error: "Потрібно увійти." });
  if (user.role !== "ADMIN" && user.role !== "PRODUCTION_HEAD") return reply.code(403).send({ error: "Недостатньо прав." });
  return db.select().from(vehicles);
});
app.post("/api/:kind", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const kind = z.object({ kind: z.enum(["work-types", "vehicles"]) }).safeParse(request.params);
  if (!kind.success) return reply.code(404).send({ error: "Довідник не знайдено." });
  const data = (kind.data.kind === "vehicles" ? vehicleInput : directoryName).safeParse(request.body);
  if (!data.success) return reply.code(400).send({ error: "Некоректні дані." });
  return db.transaction(async (tx) => {
        if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
    const [row] = kind.data.kind === "vehicles"
      ? await tx.insert(vehicles).values(data.data as z.infer<typeof vehicleInput>).returning()
      : await tx.insert(workTypes).values(data.data).returning();
    await tx.insert(audit).values({ actorId: actor.id, entityType: kind.data.kind, entityId: row.id, action: "CREATE" });
    return reply.code(201).send(row);
  });
});
app.patch("/api/:kind/:id", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const params = directoryParam.safeParse(request.params);
  if (!params.success) return reply.code(404).send({ error: "Запис не знайдено." });
  const expectedVehicle = z.object({ name: z.string(), registration: z.string(), active: z.boolean() }).strict();
  const data = (params.data.kind === "vehicles" ? vehicleInput.partial().extend({ expected: expectedVehicle.optional() }) : z.object({ active: z.boolean(), expectedActive: z.boolean().optional() }).strict()).safeParse(request.body);
  if (!data.success) return reply.code(400).send({ error: "Некоректні дані." });
  const { expected, expectedActive, ...changes } = data.data as { name?: string; registration?: string; active?: boolean; expected?: z.infer<typeof expectedVehicle>; expectedActive?: boolean };
  if (!Object.keys(changes).length) return reply.code(400).send({ error: "Некоректні дані." });
  return db.transaction(async (tx) => {
    if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
    const table = params.data.kind === "vehicles" ? vehicles : workTypes;
    const [old] = await tx.select().from(table).where(eq(table.id, params.data.id)).for("update");
    if (!old) return reply.code(404).send({ error: "Запис не знайдено." });
    if ((expected && (!("registration" in old) || old.name !== expected.name || old.registration !== expected.registration || old.active !== expected.active)) || (expectedActive !== undefined && old.active !== expectedActive)) return reply.code(409).send({ error: "Запис змінився. Оновіть дані перед збереженням." });
    const [updated] = await tx.update(table).set(changes).where(eq(table.id, old.id)).returning();
    for (const field of Object.keys(changes) as (keyof typeof changes)[]) {
      const before = (old as Record<string, unknown>)[field], after = (updated as Record<string, unknown>)[field];
      if (before !== after) await tx.insert(audit).values({ actorId: actor.id, entityType: params.data.kind, entityId: old.id, action: "UPDATE", field, oldValue: String(before ?? ""), newValue: String(after ?? "") });
    }
    return updated;
  });
});

const dateValue = z.iso.date();
const projectFields = z.object({
  name: z.string().trim().min(1), managerId: z.string().uuid().optional(), workTypeId: z.string().uuid(),
  address: z.string().trim().nullable().optional(), gps: z.string().trim().nullable().optional(),
  volume: z.string().trim().nullable().optional(), information: z.string().trim().nullable().optional(),
  desiredStart: dateValue.nullable().optional(), desiredEnd: dateValue.nullable().optional(),
}).strict();
const validProject = (value: { address?: string | null; gps?: string | null; desiredStart?: string | null; desiredEnd?: string | null }) => Boolean(value.address || value.gps) && ((!value.desiredStart && !value.desiredEnd) || Boolean(value.desiredStart && value.desiredEnd && value.desiredStart <= value.desiredEnd));
const projectInput = projectFields.refine(validProject);
const statusSql = sql<string>`case when ${projects.plannedStart} is null then 'NEW' when ${projects.plannedStart} > current_date then 'PLANNED' when ${projects.plannedEnd} >= current_date then 'IN_PROGRESS' else 'COMPLETED' end`;

app.post("/api/projects", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  if (actor.role !== "ADMIN" && actor.role !== "MANAGER") return reply.code(403).send({ error: "Недостатньо прав." });
  const input = projectInput.safeParse(request.body);
  if (!input.success || (actor.role === "ADMIN" && !input.data.managerId) || (actor.role === "MANAGER" && input.data.managerId && input.data.managerId !== actor.id)) return reply.code(400).send({ error: "Некоректні дані об’єкта." });
  const managerId = actor.role === "MANAGER" ? actor.id : input.data.managerId!;
  return db.transaction(async (tx) => {
    const sessionStatus = await sessionStillValid(tx, request.cookies[sessionCookie], actor);
    if (sessionStatus !== "ok") return reply.code(sessionStatus === "changed" ? 409 : 401).send({ error: sessionStatus === "changed" ? "Права змінилися. Оновіть дані та повторіть дію." : "Сесію завершено." });
    const [manager] = await tx.select().from(users).where(eq(users.id, managerId)).for("share");
    const [workType] = await tx.select().from(workTypes).where(eq(workTypes.id, input.data.workTypeId)).for("share");
    if (!manager?.active || manager.role !== "MANAGER" || !workType?.active) return reply.code(400).send({ error: "Оберіть активного менеджера та тип робіт." });
    const [project] = await tx.insert(projects).values({ ...input.data, managerId, creatorId: actor.id }).returning();
    await tx.insert(audit).values({ actorId: actor.id, entityType: "project", entityId: project.id, action: "CREATE" });
    const heads = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "PRODUCTION_HEAD"), eq(users.active, true)));
    if (heads.length) await tx.insert(notifications).values(heads.map((head) => ({ userId: head.id, type: "PROJECT_CREATED", projectId: project.id })));
    return reply.code(201).send({ ...project, status: "NEW" });
  });
});

app.get("/api/projects", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const query = z.object({ scope: z.enum(["own", "schedule", "archive"]).optional() }).strict().safeParse(request.query);
  if (!query.success) return reply.code(400).send({ error: "Некоректний запит." });
  const scope = query.data.scope ?? "own";
  if (actor.role === "PRODUCTION_EMPLOYEE" && scope === "archive") return reply.code(403).send({ error: "Недостатньо прав." });
  const conditions = [];
  conditions.push(scope === "archive" ? sql`${projects.archivedAt} is not null` : isNull(projects.archivedAt));
  if (actor.role === "MANAGER" && scope !== "schedule") conditions.push(eq(projects.managerId, actor.id));
  if (scope === "schedule") conditions.push(sql`${projects.plannedStart} is not null`);
  if (actor.role === "PRODUCTION_EMPLOYEE") conditions.push(sql`exists (select 1 from ${assignments} where ${assignments.projectId} = ${projects.id} and ${assignments.userId} = ${actor.id})`);
  return db.select({ project: projects, workTypeName: workTypes.name, status: statusSql }).from(projects)
    .innerJoin(workTypes, eq(projects.workTypeId, workTypes.id)).where(and(...conditions));
});

app.post("/api/projects/:id/archive", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  return db.transaction(async (tx) => {
    const sessionStatus = await sessionStillValid(tx, request.cookies[sessionCookie], actor);
    if (sessionStatus !== "ok") return reply.code(sessionStatus === "changed" ? 409 : 401).send({ error: sessionStatus === "changed" ? "Права змінилися. Оновіть дані та повторіть дію." : "Сесію завершено." });
    const [project] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
    if (!project || project.archivedAt) return reply.code(404).send({ error: "Об’єкт не знайдено." });
    if (actor.role !== "ADMIN" && !(actor.role === "MANAGER" && project.managerId === actor.id)) return reply.code(403).send({ error: "Недостатньо прав." });
    const archivedAt = new Date();
    await tx.update(projects).set({ archivedAt, updatedAt: sql`greatest(clock_timestamp(), ${projects.updatedAt} + interval '1 millisecond')` }).where(eq(projects.id, project.id));
    await tx.insert(audit).values({ actorId: actor.id, entityType: "project", entityId: project.id, action: "ARCHIVE", field: "archivedAt", newValue: archivedAt.toISOString() });
    if (actor.role === "MANAGER" && project.plannedStart) {
      const heads = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "PRODUCTION_HEAD"), eq(users.active, true)));
      if (heads.length) await tx.insert(notifications).values(heads.map((head) => ({ userId: head.id, type: "PROJECT_ARCHIVED", projectId: project.id })));
    }
    return { ok: true };
  });
});

const planningInput = z.object({
  start: dateValue, end: dateValue, employeeIds: z.array(z.string().uuid()).min(1), responsibleId: z.string().uuid(),
  vehicleIds: z.array(z.string().uuid()), confirmConflicts: z.boolean().default(false), expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
}).strict().refine((v) => v.start <= v.end && new Set(v.employeeIds).size === v.employeeIds.length && new Set(v.vehicleIds).size === v.vehicleIds.length && v.employeeIds.includes(v.responsibleId));

app.put("/api/projects/:id/planning", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  if (actor.role !== "ADMIN" && actor.role !== "PRODUCTION_HEAD") return reply.code(403).send({ error: "Недостатньо прав." });
  const params = uuidParam.safeParse(request.params), input = planningInput.safeParse(request.body);
  if (!params.success || !input.success) return reply.code(400).send({ error: "Некоректний виробничий план." });
  const plan = input.data;
  return db.transaction(async (tx) => {
    const sessionStatus = await sessionStillValid(tx, request.cookies[sessionCookie], actor);
    if (sessionStatus !== "ok") return reply.code(sessionStatus === "changed" ? 409 : 401).send({ error: sessionStatus === "changed" ? "Права змінилися. Оновіть дані та повторіть дію." : "Сесію завершено." });
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gis_project_planning'))`);
    const [project] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
    if (!project || project.archivedAt) return reply.code(404).send({ error: "Об’єкт не знайдено." });
    if (plan.expectedUpdatedAt && new Date(plan.expectedUpdatedAt).getTime() !== project.updatedAt.getTime()) return reply.code(409).send({ error: "Об’єкт змінився. Оновіть дані перед збереженням." });
    const oldAssignments = await tx.select().from(assignments).where(eq(assignments.projectId, project.id));
    const oldVehicles = await tx.select().from(projectVehicles).where(eq(projectVehicles.projectId, project.id));
    const team = await tx.select().from(users).where(inArray(users.id, plan.employeeIds)).for("share");
    if (team.length !== plan.employeeIds.length || team.some((user) => (!user.active || user.role !== "PRODUCTION_EMPLOYEE") && !oldAssignments.some((old) => old.userId === user.id))) return reply.code(400).send({ error: "Оберіть активних працівників виробництва." });
    const cars = plan.vehicleIds.length ? await tx.select().from(vehicles).where(inArray(vehicles.id, plan.vehicleIds)).for("share") : [];
    if (cars.length !== plan.vehicleIds.length || cars.some((vehicle) => !vehicle.active && !oldVehicles.some((old) => old.vehicleId === vehicle.id))) return reply.code(400).send({ error: "Оберіть активні автомобілі." });
    const overlap = and(sql`${projects.id} <> ${project.id}`, isNull(projects.archivedAt), sql`${projects.plannedStart} <= ${plan.end}`, sql`${projects.plannedEnd} >= ${plan.start}`);
    const employeeConflicts = await tx.select({ resourceId: users.id, resourceName: users.name, projectId: projects.id, projectName: projects.name, start: projects.plannedStart, end: projects.plannedEnd }).from(assignments).innerJoin(projects, eq(assignments.projectId, projects.id)).innerJoin(users, eq(assignments.userId, users.id)).where(and(overlap, inArray(assignments.userId, plan.employeeIds)));
    const vehicleConflicts = plan.vehicleIds.length ? await tx.select({ resourceId: vehicles.id, resourceName: vehicles.name, projectId: projects.id, projectName: projects.name, start: projects.plannedStart, end: projects.plannedEnd }).from(projectVehicles).innerJoin(projects, eq(projectVehicles.projectId, projects.id)).innerJoin(vehicles, eq(projectVehicles.vehicleId, vehicles.id)).where(and(overlap, inArray(projectVehicles.vehicleId, plan.vehicleIds))) : [];
    const intersect = <T extends { start: string | null; end: string | null }>(item: T) => ({ ...item, overlapStart: item.start && item.start > plan.start ? item.start : plan.start, overlapEnd: item.end && item.end < plan.end ? item.end : plan.end });
    const conflicts = { employees: employeeConflicts.map(intersect), vehicles: vehicleConflicts.map(intersect) };
    if (!plan.confirmConflicts && (employeeConflicts.length || vehicleConflicts.length)) return reply.code(409).send({ error: "Виявлено перетин призначень.", conflicts });
    await tx.update(projects).set({ plannedStart: plan.start, plannedEnd: plan.end, updatedAt: sql`greatest(clock_timestamp(), ${projects.updatedAt} + interval '1 millisecond')` }).where(eq(projects.id, project.id));
    await tx.delete(assignments).where(eq(assignments.projectId, project.id));
    await tx.insert(assignments).values(plan.employeeIds.map((userId) => ({ projectId: project.id, userId, responsible: userId === plan.responsibleId })));
    await tx.delete(projectVehicles).where(eq(projectVehicles.projectId, project.id));
    if (plan.vehicleIds.length) await tx.insert(projectVehicles).values(plan.vehicleIds.map((vehicleId) => ({ projectId: project.id, vehicleId })));
    const oldResponsible = oldAssignments.find((item) => item.responsible)?.userId ?? null;
    const changes = [
      { field: "plannedStart", before: project.plannedStart, after: plan.start }, { field: "plannedEnd", before: project.plannedEnd, after: plan.end },
      { field: "employees", before: oldAssignments.map((item) => item.userId).sort().join(","), after: [...plan.employeeIds].sort().join(",") },
      { field: "responsible", before: oldResponsible, after: plan.responsibleId },
      { field: "vehicles", before: oldVehicles.map((item) => item.vehicleId).sort().join(","), after: [...plan.vehicleIds].sort().join(",") },
    ];
    const entries = changes.filter((change) => change.before !== change.after).map((change) => ({ actorId: actor.id, entityType: "project", entityId: project.id, action: "UPDATE", field: change.field, oldValue: change.before, newValue: change.after }));
    if (entries.length) await tx.insert(audit).values(entries);
    const oldIds = new Set(oldAssignments.map((item) => item.userId));
    const newIds = new Set(plan.employeeIds);
    const events = [
      ...plan.employeeIds.filter((id) => !oldIds.has(id)).map((userId) => ({ userId, type: "EMPLOYEE_ASSIGNED", projectId: project.id })),
      ...oldAssignments.filter((item) => !newIds.has(item.userId)).map((item) => ({ userId: item.userId, type: "EMPLOYEE_REMOVED", projectId: project.id })),
      ...plan.employeeIds.filter((id) => oldIds.has(id) && (project.plannedStart !== plan.start || project.plannedEnd !== plan.end)).map((userId) => ({ userId, type: "PROJECT_DATES_CHANGED", projectId: project.id })),
    ];
    if (events.length) await tx.insert(notifications).values(events);
    return { ok: true, conflicts };
  });
});

app.get("/api/projects/:id", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  const [row] = await db.select({ project: projects, workTypeName: workTypes.name, status: statusSql }).from(projects).innerJoin(workTypes, eq(projects.workTypeId, workTypes.id)).where(eq(projects.id, params.data.id));
  if (!row) return reply.code(404).send({ error: "Об’єкт не знайдено." });
  if (actor.role === "MANAGER" && row.project.managerId !== actor.id && (!row.project.plannedStart || row.project.archivedAt)) return reply.code(403).send({ error: "Недостатньо прав." });
  const team = await db.select({ id: users.id, name: users.name, phone: users.phone, responsible: assignments.responsible }).from(assignments).innerJoin(users, eq(assignments.userId, users.id)).where(eq(assignments.projectId, row.project.id));
  if (actor.role === "PRODUCTION_EMPLOYEE" && (row.project.archivedAt || !team.some((person) => person.id === actor.id))) return reply.code(403).send({ error: "Недостатньо прав." });
  const cars = await db.select({ id: vehicles.id, name: vehicles.name, registration: vehicles.registration }).from(projectVehicles).innerJoin(vehicles, eq(projectVehicles.vehicleId, vehicles.id)).where(eq(projectVehicles.projectId, row.project.id));
  const [manager] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.project.managerId));
  return { ...row, managerName: manager?.name ?? "", team, vehicles: cars };
});

app.patch("/api/projects/:id", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params), input = projectFields.partial().extend({ expectedUpdatedAt: z.iso.datetime({ offset: true }).optional() }).safeParse(request.body);
  if (!params.success || !input.success || !Object.keys(input.data).some((key) => key !== "expectedUpdatedAt")) return reply.code(400).send({ error: "Некоректні дані об’єкта." });
  const { expectedUpdatedAt, ...changes } = input.data;
  return db.transaction(async (tx) => {
    const sessionStatus = await sessionStillValid(tx, request.cookies[sessionCookie], actor);
    if (sessionStatus !== "ok") return reply.code(sessionStatus === "changed" ? 409 : 401).send({ error: sessionStatus === "changed" ? "Права змінилися. Оновіть дані та повторіть дію." : "Сесію завершено." });
    const [old] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
    if (!old || old.archivedAt) return reply.code(404).send({ error: "Об’єкт не знайдено." });
    if (actor.role !== "ADMIN" && actor.role !== "PRODUCTION_HEAD" && !(actor.role === "MANAGER" && actor.id === old.managerId)) return reply.code(403).send({ error: "Недостатньо прав." });
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== old.updatedAt.getTime()) return reply.code(409).send({ error: "Об’єкт змінився. Оновіть дані перед збереженням." });
    if (changes.managerId && changes.managerId !== old.managerId && actor.role !== "ADMIN") return reply.code(403).send({ error: "Змінити менеджера може лише адміністратор." });
    if (actor.role === "MANAGER" && old.plannedStart && ((changes.workTypeId && changes.workTypeId !== old.workTypeId) || (changes.desiredStart !== undefined && changes.desiredStart !== old.desiredStart) || (changes.desiredEnd !== undefined && changes.desiredEnd !== old.desiredEnd))) return reply.code(403).send({ error: "Ці дані змінює керівник виробництва." });
    const next = { ...old, ...changes };
    if (!validProject(next)) return reply.code(400).send({ error: "Вкажіть локацію та коректну пару бажаних дат." });
    if (next.managerId !== old.managerId) {
      const [manager] = await tx.select().from(users).where(eq(users.id, next.managerId)).for("share");
      if (!manager?.active || manager.role !== "MANAGER") return reply.code(400).send({ error: "Оберіть активного менеджера." });
    }
    if (next.workTypeId !== old.workTypeId) {
      const [workType] = await tx.select().from(workTypes).where(eq(workTypes.id, next.workTypeId)).for("share");
      if (!workType?.active) return reply.code(400).send({ error: "Оберіть активний тип робіт." });
    }
    const [updated] = await tx.update(projects).set({ ...changes, updatedAt: sql`greatest(clock_timestamp(), ${projects.updatedAt} + interval '1 millisecond')` }).where(eq(projects.id, old.id)).returning();
    for (const field of ["name", "managerId", "workTypeId", "address", "gps", "volume", "information", "desiredStart", "desiredEnd"] as const) {
      if (old[field] !== updated[field]) await tx.insert(audit).values({ actorId: actor.id, entityType: "project", entityId: old.id, action: "UPDATE", field, oldValue: old[field], newValue: updated[field] });
    }
    if (actor.role === "MANAGER" && old.plannedStart && (old.address !== updated.address || old.gps !== updated.gps)) {
      const heads = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "PRODUCTION_HEAD"), eq(users.active, true)));
      if (heads.length) await tx.insert(notifications).values(heads.map((head) => ({ userId: head.id, type: "PROJECT_LOCATION_CHANGED", projectId: old.id })));
    }
    return updated;
  });
});

app.get("/api/employees", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  if (actor.role !== "ADMIN" && actor.role !== "PRODUCTION_HEAD") return reply.code(403).send({ error: "Недостатньо прав." });
  return db.select({ id: users.id, name: users.name, phone: users.phone, active: users.active, foreman: users.foreman }).from(users).where(eq(users.role, "PRODUCTION_EMPLOYEE"));
});
app.get("/api/notifications", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  return db.select({ notification: notifications, subjectName: users.name, projectName: projects.name }).from(notifications)
    .leftJoin(users, eq(notifications.subjectUserId, users.id)).leftJoin(projects, eq(notifications.projectId, projects.id))
    .where(eq(notifications.userId, actor.id)).orderBy(sql`${notifications.createdAt} desc`)
    .then((rows) => rows.map(({ notification, subjectName, projectName }) => ({ ...notification, subjectName, projectName })));
});
app.post("/api/notifications/:id/read", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  const [item] = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, params.data.id), eq(notifications.userId, actor.id))).returning({ id: notifications.id });
  return item ?? reply.code(404).send({ error: "Сповіщення не знайдено." });
});
app.get("/api/audit", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  return db.transaction(async (tx) => {
    if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new SessionExpired();
    return tx.select().from(audit).orderBy(sql`${audit.createdAt} desc`);
  });
});

const attachmentParams = z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() });
class AttachmentAccessChanged extends Error {}
async function attachmentAccess(projectId: string, actor: NonNullable<Awaited<ReturnType<typeof currentUser>>>, edit: boolean) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return false;
  if (edit) return !project.archivedAt && (actor.role === "ADMIN" || actor.role === "PRODUCTION_HEAD" || (actor.role === "MANAGER" && project.managerId === actor.id));
  if (actor.role === "ADMIN" || actor.role === "PRODUCTION_HEAD") return true;
  if (actor.role === "MANAGER") return project.managerId === actor.id || Boolean(project.plannedStart && !project.archivedAt);
  if (actor.role === "PRODUCTION_EMPLOYEE" && !project.archivedAt) {
    const [assignment] = await db.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.projectId, project.id), eq(assignments.userId, actor.id)));
    return Boolean(assignment);
  }
  return false;
}

app.get("/api/projects/:id/attachments", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  if (!await attachmentAccess(params.data.id, actor, false)) return reply.code(403).send({ error: "Недостатньо прав." });
  return db.select({ id: attachments.id, projectId: attachments.projectId, uploaderId: attachments.uploaderId, name: attachments.name, contentType: attachments.contentType, size: attachments.size, createdAt: attachments.createdAt }).from(attachments).where(and(eq(attachments.projectId, params.data.id), isNull(attachments.deletedAt)));
});
app.post("/api/projects/:id/attachments", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  if (!await attachmentAccess(params.data.id, actor, true)) return reply.code(403).send({ error: "Недостатньо прав." });
  if (!storage || !bucket) return reply.code(503).send({ error: "Сховище файлів не налаштовано." });
  const file = await request.file();
  if (!file || !file.filename.trim()) return reply.code(400).send({ error: "Оберіть файл." });
  const key = `${params.data.id}/${randomUUID()}`;
  let size = 0;
  const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(null, chunk); } });
  file.file.on("error", (error) => counter.destroy(error));
  const upload = new Upload({ client: storage, params: { Bucket: bucket, Key: key, Body: file.file.pipe(counter), ContentType: file.mimetype } });
  try {
    await upload.done();
    if (file.file.truncated) throw new Error("Файл перевищує допустимий розмір.");
    const refreshedActor = await currentUser(request.cookies[sessionCookie]);
    if (!refreshedActor || refreshedActor.id !== actor.id || !await attachmentAccess(params.data.id, refreshedActor, true)) throw new AttachmentAccessChanged();
    const attachment = await db.transaction(async (tx) => {
      if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new AttachmentAccessChanged();
      const [project] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
      if (!project || project.archivedAt || !(actor.role === "ADMIN" || actor.role === "PRODUCTION_HEAD" || (actor.role === "MANAGER" && project.managerId === actor.id))) throw new AttachmentAccessChanged();
      const [item] = await tx.insert(attachments).values({ projectId: params.data.id, uploaderId: actor.id, name: file.filename, storageKey: key, contentType: file.mimetype, size }).returning();
      await tx.insert(audit).values({ actorId: actor.id, entityType: "attachment", entityId: item.id, action: "CREATE" });
      return item;
    });
    return reply.code(201).send({ id: attachment.id, projectId: attachment.projectId, uploaderId: attachment.uploaderId, name: attachment.name, contentType: attachment.contentType, size: attachment.size, createdAt: attachment.createdAt });
  } catch (error) {
    try {
      await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      try {
        await db.insert(attachments).values({ projectId: params.data.id, uploaderId: actor.id, name: file.filename, storageKey: key, contentType: file.mimetype, size, deletedAt: new Date() });
        void scheduleCleanup();
      } catch {
        request.log.error("Не вдалося зберегти завдання очищення незавершеного вкладення");
      }
    }
    if (error instanceof AttachmentAccessChanged) return reply.code(403).send({ error: "Доступ до об’єкта змінився під час завантаження." });
    throw error;
  }
});
app.get("/api/projects/:id/attachments/:attachmentId", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = attachmentParams.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  if (!await attachmentAccess(params.data.id, actor, false)) return reply.code(403).send({ error: "Недостатньо прав." });
  const [item] = await db.select().from(attachments).where(and(eq(attachments.id, params.data.attachmentId), eq(attachments.projectId, params.data.id), isNull(attachments.deletedAt)));
  if (!item) return reply.code(404).send({ error: "Файл не знайдено." });
  if (!storage || !bucket) return reply.code(503).send({ error: "Сховище файлів не налаштовано." });
  const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: item.storageKey }));
  reply.header("Content-Type", "application/octet-stream").header("X-Content-Type-Options", "nosniff").header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`);
  return reply.send(object.Body);
});
app.delete("/api/projects/:id/attachments/:attachmentId", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = attachmentParams.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  if (!await attachmentAccess(params.data.id, actor, true)) return reply.code(403).send({ error: "Недостатньо прав." });
  if (!storage || !bucket) return reply.code(503).send({ error: "Сховище файлів не налаштовано." });
  const item = await db.transaction(async (tx) => {
    const sessionStatus = await sessionStillValid(tx, request.cookies[sessionCookie], actor);
    if (sessionStatus !== "ok") return sessionStatus;
    const [project] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
    if (!project || project.archivedAt || !(actor.role === "ADMIN" || actor.role === "PRODUCTION_HEAD" || (actor.role === "MANAGER" && project.managerId === actor.id))) return false;
    const [found] = await tx.select().from(attachments).where(and(eq(attachments.id, params.data.attachmentId), eq(attachments.projectId, params.data.id), isNull(attachments.deletedAt))).for("update");
    if (!found) return null;
    if (actor.role !== "ADMIN" && found.uploaderId !== actor.id) return false;
    await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, found.id));
    await tx.insert(audit).values({ actorId: actor.id, entityType: "attachment", entityId: found.id, action: "DELETE" });
    return found;
  });
  if (item === "changed" || item === "unauthorized") return reply.code(item === "changed" ? 409 : 401).send({ error: item === "changed" ? "Права змінилися. Оновіть дані та повторіть дію." : "Сесію завершено." });
  if (item === null) return reply.code(404).send({ error: "Файл не знайдено." });
  if (item === false) return reply.code(403).send({ error: "Можна видалити лише власний файл." });
  void scheduleCleanup();
  return { ok: true };
});

let cleanupTask: Promise<void> | undefined;
function scheduleCleanup() {
  if (!storage || !bucket) return Promise.resolve();
  if (cleanupTask) return cleanupTask;
  const client = storage;
  const targetBucket = bucket;
  cleanupTask = (async () => {
    let after: string | undefined;
    for (;;) {
      const batch = await db.select({ id: attachments.id, key: attachments.storageKey }).from(attachments)
        .where(and(isNotNull(attachments.deletedAt), isNull(attachments.storageDeletedAt), after ? gt(attachments.id, after) : undefined))
        .orderBy(attachments.id).limit(100);
      if (!batch.length) break;
      for (const item of batch) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: item.key }));
          await db.update(attachments).set({ storageDeletedAt: new Date() }).where(eq(attachments.id, item.id));
        } catch {
          app.log.error({ attachmentId: item.id }, "Не вдалося видалити файл зі сховища; буде повторна спроба");
        }
      }
      after = batch[batch.length - 1].id;
    }
  })().catch(() => { app.log.error("Не вдалося виконати очищення сховища; буде повторна спроба"); }).finally(() => { cleanupTask = undefined; });
  return cleanupTask;
}
const cleanupTimer = setInterval(() => {
  void scheduleCleanup();
  const now = Date.now();
  for (const [ip, attempt] of attempts) if (attempt.until <= now) attempts.delete(ip);
}, 60_000);
app.addHook("onClose", async () => { clearInterval(cleanupTimer); await cleanupTask; storage?.destroy(); await pool.end(); });
void scheduleCleanup();
async function shutdown(signal: string) {
  app.log.info({ signal }, "Зупинка сервера");
  try {
    await app.close();
    app.log.info("Сервер зупинено");
  } catch {
    app.log.error("Не вдалося коректно зупинити сервер");
    process.exitCode = 1;
  } finally {
    const logger = app.log as typeof app.log & { flush: (callback: (error?: Error) => void) => void };
    await new Promise<void>((done) => logger.flush((error) => {
      if (error) { process.stderr.write("Не вдалося записати журнал сервера.\n"); process.exitCode = 1; }
      done();
    }));
  }
}
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
let startupStage: "database" | "schema" | "server" = "database";
try {
  await pool.query("select 1");
  startupStage = "schema";
  await pool.query("select key_code from users limit 0");
  await pool.query("select subject_user_id from notifications limit 0");
  await pool.query("select storage_deleted_at from attachments limit 0");
  startupStage = "server";
  await app.listen({ host: process.env.HOST || "127.0.0.1", port: Number(process.env.PORT || 3000) });
  app.log.info("Сервер запущено");
} catch (error) {
  const rawCode = (error as { code?: unknown }).code;
  const errorCode = typeof rawCode === "string" && /^[A-Z0-9_]{1,50}$/.test(rawCode) ? rawCode : undefined;
  app.log.fatal({ startupStage, errorCode }, "Не вдалося запустити сервер");
  const message = startupStage === "database" ? "Не вдалося підключитися до PostgreSQL. Перевірте DATABASE_URL і доступність бази." : startupStage === "schema" ? (errorCode === "42P01" || errorCode === "42703" ? "База не підготовлена. Виконайте npm run db:migrate." : "Не вдалося перевірити схему бази. Перевірте доступ до неї та журнал API.") : "Не вдалося запустити API. Перевірте доступність порту.";
  process.stderr.write(`${message}\n`);
  await shutdown("startup-error");
  process.exitCode = 1;
}

}
