import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Transform } from "node:stream";
import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dirname, resolve } from "node:path";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { assignments, attachments, audit, notifications, projects, projectVehicles, sessions, users, vehicles, workTypes, type NotificationPayload } from "./schema.js";

const logFile = resolve(process.env.LOG_FILE || "logs/gis-api.log");
if (process.env.NODE_ENV !== "production") {
  mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
  closeSync(openSync(logFile, "a", 0o600));
}
class SessionExpired extends Error { statusCode = 401; }
const app = Fastify({ logger: process.env.NODE_ENV === "production" ? { level: "info" } : { level: "info", file: logFile }, logController: new Fastify.LogController({ disableRequestLogging: true }), trustProxy: process.env.TRUST_PROXY || false });
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
const attachmentLimit = 500 * 1024 * 1024;
await app.register(multipart, { limits: { files: 1, fileSize: attachmentLimit } });
const bucket = process.env.S3_BUCKET;
const storage = bucket ? new S3Client({ region: process.env.AWS_REGION || "us-east-1", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: true }) : null;
const attachmentDir = resolve(process.env.ATTACHMENTS_DIR || ".local/attachments");
function localAttachmentPath(key: string) {
  const match = /^local\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i.exec(key);
  if (!match) throw new Error("Некоректний ключ вкладення");
  return resolve(attachmentDir, match[1], match[2]);
}
async function deleteStoredAttachment(key: string) {
  if (key.startsWith("local/")) await rm(localAttachmentPath(key), { force: true });
  else if (storage && bucket) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  else throw new Error("Попереднє сховище файлів не налаштовано");
}
const sessionCookie = "gis_session";
const secure = process.env.NODE_ENV === "production";
const attempts = new Map<string, { count: number; until: number }>();

app.get("/api/health", async (_request, reply) => {
  try {
    await pool.query("select 1");
    return { status: "ok" };
  } catch {
    return reply.code(503).send({ status: "unavailable" });
  }
});

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
type NotificationChange = NonNullable<NotificationPayload["changes"]>[number];
const notificationFields: Record<string, string> = { name: "Назва", managerId: "Менеджер", workTypeId: "Тип робіт", address: "Адреса", locationUrl: "Локація", volume: "Обсяг робіт", information: "Коментар", desiredStart: "Бажаний початок", desiredEnd: "Бажане завершення", plannedStart: "Плановий початок", plannedEnd: "Планове завершення", employees: "Бригада", responsible: "Відповідальний", vehicles: "Автомобілі" };
async function describeChanges(tx: Transaction, changes: { field: string; before: string | null; after: string | null }[]): Promise<NotificationChange[]> {
  const userIds = new Set<string>(), vehicleIds = new Set<string>(), typeIds = new Set<string>();
  for (const change of changes) {
    const target = ["managerId", "employees", "responsible"].includes(change.field) ? userIds : change.field === "vehicles" ? vehicleIds : change.field === "workTypeId" ? typeIds : null;
    if (target) for (const value of [change.before, change.after]) for (const id of (value ?? "").split(",")) if (id) target.add(id);
  }
  const [people, cars, types] = await Promise.all([
    userIds.size ? tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])) : [],
    vehicleIds.size ? tx.select({ id: vehicles.id, name: vehicles.name, registration: vehicles.registration }).from(vehicles).where(inArray(vehicles.id, [...vehicleIds])) : [],
    typeIds.size ? tx.select({ id: workTypes.id, name: workTypes.name }).from(workTypes).where(inArray(workTypes.id, [...typeIds])) : [],
  ]);
  const names = new Map([...people.map((person) => [person.id, person.name] as const), ...cars.map((car) => [car.id, `${car.name} (${car.registration})`] as const), ...types.map((type) => [type.id, type.name] as const)]);
  return changes.map(({ field, before, after }) => {
    const translate = (value: string | null) => value && ["managerId", "workTypeId", "employees", "responsible", "vehicles"].includes(field) ? value.split(",").map((id) => names.get(id) ?? id).join(", ") : value;
    return { field: notificationFields[field] ?? field, before: translate(before), after: translate(after) };
  });
}
async function notifyProject(tx: Transaction, actor: { id: string; name: string; role: string }, project: typeof projects.$inferSelect, event: "created" | "planned" | "changed" | "archived", changes: NotificationChange[] = [], previousWorkers: string[] = []) {
  if (actor.role === "ADMIN") return;
  const planned = Boolean(project.plannedStart);
  const assigned = await tx.select({ id: users.id, name: users.name }).from(assignments).innerJoin(users, eq(assignments.userId, users.id)).where(eq(assignments.projectId, project.id));
  const heads = actor.role === "MANAGER" ? await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "PRODUCTION_HEAD"), eq(users.active, true))) : [];
  const recipients = new Set<string>();
  if (actor.role === "MANAGER") for (const head of heads) recipients.add(head.id);
  if (actor.role === "PRODUCTION_HEAD") recipients.add(project.managerId);
  if (planned && event !== "created") for (const id of [...assigned.map((person) => person.id), ...previousWorkers]) recipients.add(id);
  recipients.delete(actor.id);
  if (!recipients.size) return;
  const [manager] = await tx.select({ name: users.name }).from(users).where(eq(users.id, project.managerId));
  const [workType] = await tx.select({ name: workTypes.name }).from(workTypes).where(eq(workTypes.id, project.workTypeId));
  const cars = await tx.select({ name: vehicles.name, registration: vehicles.registration }).from(projectVehicles).innerJoin(vehicles, eq(projectVehicles.vehicleId, vehicles.id)).where(eq(projectVehicles.projectId, project.id));
  const payload: NotificationPayload = { actor: actor.name, projectName: project.name, ...(event === "created" || event === "planned" ? { manager: manager?.name ?? "", start: planned ? project.plannedStart : project.desiredStart, end: planned ? project.plannedEnd : project.desiredEnd, workType: workType?.name ?? "", volume: project.volume, ...(planned ? { team: assigned.map((person) => person.name), vehicles: cars.map((car) => `${car.name} (${car.registration})`) } : {}) } : {}), ...(changes.length ? { changes } : {}) };
  const type = { created: "PROJECT_CREATED_V2", planned: "PROJECT_PLANNED", changed: "PROJECT_CHANGED", archived: "PROJECT_ARCHIVED_V2" }[event];
  await tx.insert(notifications).values([...recipients].map((userId) => ({ userId, type, projectId: project.id, subjectUserId: actor.id, payload })));
}
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
const locationUrl = z.url().refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Некоректне посилання на мапу.");
const projectFields = z.object({
  name: z.string().trim().min(1), managerId: z.string().uuid().optional(), workTypeId: z.string().uuid(),
  address: z.string().trim().min(1), locationUrl: locationUrl.nullable().optional(),
  volume: z.string().trim().nullable().optional(), information: z.string().trim().nullable().optional(),
  desiredStart: dateValue.nullable().optional(), desiredEnd: dateValue.nullable().optional(),
}).strict();
const validProject = (value: { address?: string | null; desiredStart?: string | null; desiredEnd?: string | null }) => Boolean(value.address) && ((!value.desiredStart && !value.desiredEnd) || Boolean(value.desiredStart && value.desiredEnd && value.desiredStart <= value.desiredEnd));
const projectInput = projectFields.refine((value) => validProject(value) && Boolean(value.desiredStart && value.desiredEnd && value.volume));
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
    await notifyProject(tx, actor, project, "created");
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
  if (scope === "schedule") conditions.push(sql`(${projects.plannedStart} is not null or ${projects.desiredStart} is not null)`);
  if (actor.role === "PRODUCTION_EMPLOYEE") conditions.push(sql`exists (select 1 from ${assignments} where ${assignments.projectId} = ${projects.id} and ${assignments.userId} = ${actor.id})`);
  if (scope === "schedule") return db.select({
    project: projects, workTypeName: workTypes.name, status: statusSql,
    managerName: sql<string>`(select ${users.name} from ${users} where ${users.id} = ${projects.managerId})`,
    employeeIds: sql<string[]>`array(select ${assignments.userId} from ${assignments} where ${assignments.projectId} = ${projects.id})`,
    team: sql<string[]>`array(select ${users.name} from ${assignments} inner join ${users} on ${assignments.userId} = ${users.id} where ${assignments.projectId} = ${projects.id} order by ${users.name}, ${users.id})`,
    vehicles: sql<string[]>`array(select concat(${vehicles.name}, ' (', ${vehicles.registration}, ')') from ${projectVehicles} inner join ${vehicles} on ${projectVehicles.vehicleId} = ${vehicles.id} where ${projectVehicles.projectId} = ${projects.id} order by ${vehicles.name}, ${vehicles.id})`,
  }).from(projects).innerJoin(workTypes, eq(projects.workTypeId, workTypes.id)).where(and(...conditions));
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
    if (actor.role !== "ADMIN" && actor.role !== "PRODUCTION_HEAD" && !(actor.role === "MANAGER" && project.managerId === actor.id)) return reply.code(403).send({ error: "Недостатньо прав." });
    const archivedAt = new Date();
    await tx.update(projects).set({ archivedAt, updatedAt: sql`greatest(clock_timestamp(), ${projects.updatedAt} + interval '1 millisecond')` }).where(eq(projects.id, project.id));
    await tx.insert(audit).values({ actorId: actor.id, entityType: "project", entityId: project.id, action: "ARCHIVE", field: "archivedAt", newValue: archivedAt.toISOString() });
    await notifyProject(tx, actor, project, "archived");
    return { ok: true };
  });
});

const planningInput = z.object({
  start: dateValue, end: dateValue, employeeIds: z.array(z.string().uuid()).min(1), responsibleId: z.string().uuid(),
  vehicleIds: z.array(z.string().uuid()), confirmConflicts: z.boolean().default(false), expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(), information: z.string().trim().max(10000).nullable().optional(),
}).strict().refine((v) => v.start <= v.end && new Set(v.employeeIds).size === v.employeeIds.length && new Set(v.vehicleIds).size === v.vehicleIds.length && v.employeeIds.includes(v.responsibleId));

app.get("/api/projects/:id/availability", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  if (actor.role !== "ADMIN" && actor.role !== "PRODUCTION_HEAD") return reply.code(403).send({ error: "Недостатньо прав." });
  const params = uuidParam.safeParse(request.params);
  const query = z.object({ start: dateValue, end: dateValue }).strict().refine((value) => value.start <= value.end).safeParse(request.query);
  if (!params.success || !query.success) return reply.code(400).send({ error: "Некоректні дати." });
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, params.data.id), isNull(projects.archivedAt)));
  if (!project) return reply.code(404).send({ error: "Об’єкт не знайдено." });
  const overlap = and(sql`${projects.id} <> ${project.id}`, isNull(projects.archivedAt), sql`${projects.plannedStart} <= ${query.data.end}`, sql`${projects.plannedEnd} >= ${query.data.start}`);
  const [employeesBusy, vehiclesBusy] = await Promise.all([
    db.select({ resourceId: assignments.userId, projectId: projects.id, projectName: projects.name, start: projects.plannedStart, end: projects.plannedEnd }).from(assignments).innerJoin(projects, eq(assignments.projectId, projects.id)).where(overlap),
    db.select({ resourceId: projectVehicles.vehicleId, projectId: projects.id, projectName: projects.name, start: projects.plannedStart, end: projects.plannedEnd }).from(projectVehicles).innerJoin(projects, eq(projectVehicles.projectId, projects.id)).where(overlap),
  ]);
  return { employees: employeesBusy, vehicles: vehiclesBusy };
});

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
    const [plannedProject] = await tx.update(projects).set({ plannedStart: plan.start, plannedEnd: plan.end, ...(plan.information !== undefined ? { information: plan.information } : {}), updatedAt: sql`greatest(clock_timestamp(), ${projects.updatedAt} + interval '1 millisecond')` }).where(eq(projects.id, project.id)).returning();
    await tx.delete(assignments).where(eq(assignments.projectId, project.id));
    await tx.insert(assignments).values(plan.employeeIds.map((userId) => ({ projectId: project.id, userId, responsible: userId === plan.responsibleId })));
    await tx.delete(projectVehicles).where(eq(projectVehicles.projectId, project.id));
    if (plan.vehicleIds.length) await tx.insert(projectVehicles).values(plan.vehicleIds.map((vehicleId) => ({ projectId: project.id, vehicleId })));
    const oldResponsible = oldAssignments.find((item) => item.responsible)?.userId ?? null;
    const changes = [
      { field: "plannedStart", before: project.plannedStart, after: plan.start }, { field: "plannedEnd", before: project.plannedEnd, after: plan.end },
      { field: "information", before: project.information, after: plan.information === undefined ? project.information : plan.information },
      { field: "employees", before: oldAssignments.map((item) => item.userId).sort().join(","), after: [...plan.employeeIds].sort().join(",") },
      { field: "responsible", before: oldResponsible, after: plan.responsibleId },
      { field: "vehicles", before: oldVehicles.map((item) => item.vehicleId).sort().join(","), after: [...plan.vehicleIds].sort().join(",") },
    ];
    const entries = changes.filter((change) => change.before !== change.after).map((change) => ({ actorId: actor.id, entityType: "project", entityId: project.id, action: "UPDATE", field: change.field, oldValue: change.before, newValue: change.after }));
    if (entries.length) await tx.insert(audit).values(entries);
    const changed = changes.filter((change) => change.before !== change.after);
    if (!project.plannedStart) await notifyProject(tx, actor, plannedProject, "planned");
    else if (changed.length) await notifyProject(tx, actor, plannedProject, "changed", await describeChanges(tx, changed), oldAssignments.map((item) => item.userId));
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
  if (actor.role === "MANAGER" && row.project.managerId !== actor.id && ((!row.project.plannedStart && !row.project.desiredStart) || row.project.archivedAt)) return reply.code(403).send({ error: "Недостатньо прав." });
  const team = await db.select({ id: users.id, name: users.name, phone: users.phone, responsible: assignments.responsible }).from(assignments).innerJoin(users, eq(assignments.userId, users.id)).where(eq(assignments.projectId, row.project.id));
  if (actor.role === "PRODUCTION_EMPLOYEE" && (row.project.archivedAt || !team.some((person) => person.id === actor.id))) return reply.code(403).send({ error: "Недостатньо прав." });
  const cars = await db.select({ id: vehicles.id, name: vehicles.name, registration: vehicles.registration }).from(projectVehicles).innerJoin(vehicles, eq(projectVehicles.vehicleId, vehicles.id)).where(eq(projectVehicles.projectId, row.project.id));
  const [manager] = await db.select({ name: users.name, phone: users.phone }).from(users).where(eq(users.id, row.project.managerId));
  const [creator] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.project.creatorId));
  return { ...row, managerName: manager?.name ?? "", managerPhone: manager?.phone ?? null, creatorName: creator?.name ?? "", team, vehicles: cars };
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
    if (changes.volume !== undefined && !changes.volume) return reply.code(400).send({ error: "Обсяг робіт обов’язковий." });
    if (!validProject(next)) return reply.code(400).send({ error: "Вкажіть локацію та коректну пару бажаних дат." });
    if ((changes.desiredStart !== undefined || changes.desiredEnd !== undefined) && (!next.desiredStart || !next.desiredEnd)) return reply.code(400).send({ error: "Бажані дати початку та завершення обов’язкові." });
    if (next.managerId !== old.managerId) {
      const [manager] = await tx.select().from(users).where(eq(users.id, next.managerId)).for("share");
      if (!manager?.active || manager.role !== "MANAGER") return reply.code(400).send({ error: "Оберіть активного менеджера." });
    }
    if (next.workTypeId !== old.workTypeId) {
      const [workType] = await tx.select().from(workTypes).where(eq(workTypes.id, next.workTypeId)).for("share");
      if (!workType?.active) return reply.code(400).send({ error: "Оберіть активний тип робіт." });
    }
    const [updated] = await tx.update(projects).set({ ...changes, updatedAt: sql`greatest(clock_timestamp(), ${projects.updatedAt} + interval '1 millisecond')` }).where(eq(projects.id, old.id)).returning();
    const changed = (["name", "managerId", "workTypeId", "address", "locationUrl", "volume", "information", "desiredStart", "desiredEnd"] as const).filter((field) => old[field] !== updated[field]).map((field) => ({ field, before: old[field], after: updated[field] }));
    for (const change of changed) await tx.insert(audit).values({ actorId: actor.id, entityType: "project", entityId: old.id, action: "UPDATE", field: change.field, oldValue: change.before, newValue: change.after });
    if (changed.length) await notifyProject(tx, actor, updated, "changed", await describeChanges(tx, changed));
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
  const canOpen = actor.role === "PRODUCTION_EMPLOYEE" ? sql<boolean>`${projects.id} is not null and ${projects.archivedAt} is null and exists (select 1 from ${assignments} where ${assignments.projectId} = ${projects.id} and ${assignments.userId} = ${actor.id})` : actor.role === "MANAGER" ? sql<boolean>`${projects.id} is not null and (${projects.managerId} = ${actor.id} or (${projects.archivedAt} is null and (${projects.plannedStart} is not null or ${projects.desiredStart} is not null)))` : sql<boolean>`${projects.id} is not null`;
  return db.select({ notification: notifications, subjectName: users.name, projectName: projects.name, canOpen }).from(notifications)
    .leftJoin(users, eq(notifications.subjectUserId, users.id)).leftJoin(projects, eq(notifications.projectId, projects.id))
    .where(eq(notifications.userId, actor.id)).orderBy(sql`${notifications.createdAt} desc`)
    .then((rows) => rows.map(({ notification, subjectName, projectName, canOpen }) => ({ ...notification, subjectName, projectName, canOpen })));
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
class AttachmentLimitExceeded extends Error {}
async function attachmentAccess(projectId: string, actor: NonNullable<Awaited<ReturnType<typeof currentUser>>>, edit: boolean) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return false;
  if (edit) return !project.archivedAt && (actor.role === "ADMIN" || actor.role === "PRODUCTION_HEAD" || (actor.role === "MANAGER" && project.managerId === actor.id));
  if (actor.role === "ADMIN" || actor.role === "PRODUCTION_HEAD") return true;
  if (actor.role === "MANAGER") return project.managerId === actor.id || Boolean((project.plannedStart || project.desiredStart) && !project.archivedAt);
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
  return db.select({ id: attachments.id, projectId: attachments.projectId, uploaderId: attachments.uploaderId, name: attachments.name, contentType: attachments.contentType, size: attachments.size, createdAt: attachments.createdAt }).from(attachments).where(and(eq(attachments.projectId, params.data.id), isNull(attachments.deletedAt))).orderBy(sql`${attachments.createdAt} desc`, sql`${attachments.id} desc`);
});
app.post("/api/projects/:id/attachments", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  if (!await attachmentAccess(params.data.id, actor, true)) return reply.code(403).send({ error: "Недостатньо прав." });
  const file = await request.file();
  if (!file || !file.filename.trim()) return reply.code(400).send({ error: "Оберіть файл." });
  const key = `local/${params.data.id}/${randomUUID()}`;
  let size = 0;
  const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(null, chunk); } });
  try {
    const path = localAttachmentPath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await pipeline(file.file, counter, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    if (file.file.truncated) throw new Error("Файл перевищує допустимий розмір.");
    const refreshedActor = await currentUser(request.cookies[sessionCookie]);
    if (!refreshedActor || refreshedActor.id !== actor.id || !await attachmentAccess(params.data.id, refreshedActor, true)) throw new AttachmentAccessChanged();
    const attachment = await db.transaction(async (tx) => {
      if (await sessionStillValid(tx, request.cookies[sessionCookie], actor) !== "ok") throw new AttachmentAccessChanged();
      const [project] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
      if (!project || project.archivedAt || !(actor.role === "ADMIN" || actor.role === "PRODUCTION_HEAD" || (actor.role === "MANAGER" && project.managerId === actor.id))) throw new AttachmentAccessChanged();
      const [usage] = await tx.select({ total: sql<string>`coalesce(sum(${attachments.size}), 0)` }).from(attachments).where(and(eq(attachments.projectId, params.data.id), isNull(attachments.deletedAt)));
      if (Number(usage.total) + size > attachmentLimit) throw new AttachmentLimitExceeded();
      const [item] = await tx.insert(attachments).values({ projectId: params.data.id, uploaderId: actor.id, name: file.filename, storageKey: key, contentType: file.mimetype, size }).returning();
      await tx.insert(audit).values({ actorId: actor.id, entityType: "attachment", entityId: item.id, action: "CREATE" });
      return item;
    });
    return reply.code(201).send({ id: attachment.id, projectId: attachment.projectId, uploaderId: attachment.uploaderId, name: attachment.name, contentType: attachment.contentType, size: attachment.size, createdAt: attachment.createdAt });
  } catch (error) {
    try {
      await deleteStoredAttachment(key);
    } catch {
      try {
        await db.insert(attachments).values({ projectId: params.data.id, uploaderId: actor.id, name: file.filename, storageKey: key, contentType: file.mimetype, size, deletedAt: new Date() });
        void scheduleCleanup();
      } catch {
        request.log.error("Не вдалося зберегти завдання очищення незавершеного вкладення");
      }
    }
    if (error instanceof AttachmentAccessChanged) return reply.code(403).send({ error: "Доступ до об’єкта змінився під час завантаження." });
    if (error instanceof AttachmentLimitExceeded) return reply.code(413).send({ error: "Загальний розмір вкладень об’єкта не може перевищувати 500 МБ." });
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
  const previewTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "text/plain", "text/csv"]);
  const contentType = previewTypes.has(item.contentType.toLowerCase()) ? item.contentType.toLowerCase() : "application/octet-stream";
  const disposition = contentType === "application/octet-stream" ? "attachment" : "inline";
  reply.header("Content-Type", contentType).header("X-Content-Type-Options", "nosniff").header("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(item.name)}`);
  if (item.storageKey.startsWith("local/")) return reply.send(createReadStream(localAttachmentPath(item.storageKey)));
  if (!storage || !bucket) return reply.code(503).send({ error: "Попереднє сховище файлів не налаштовано." });
  const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: item.storageKey }));
  return reply.send(object.Body);
});
app.delete("/api/projects/:id/attachments/:attachmentId", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = attachmentParams.safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Некоректний ідентифікатор." });
  if (!await attachmentAccess(params.data.id, actor, true)) return reply.code(403).send({ error: "Недостатньо прав." });
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
  if (cleanupTask) return cleanupTask;
  cleanupTask = (async () => {
    let after: string | undefined;
    for (;;) {
      const batch = await db.select({ id: attachments.id, key: attachments.storageKey }).from(attachments)
        .where(and(isNotNull(attachments.deletedAt), isNull(attachments.storageDeletedAt), after ? gt(attachments.id, after) : undefined))
        .orderBy(attachments.id).limit(100);
      if (!batch.length) break;
      for (const item of batch) {
        try {
          await deleteStoredAttachment(item.key);
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
  await pool.query("select payload from notifications limit 0");
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
