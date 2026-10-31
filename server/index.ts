import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { assignments, audit, notifications, projects, projectVehicles, sessions, users, vehicles, workTypes } from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString });
const db = drizzle(pool);
const app = Fastify({ logger: true, trustProxy: false });
await app.register(cookie);
const sessionCookie = "gis_session";
const secure = process.env.NODE_ENV === "production";
const attempts = new Map<string, { count: number; until: number }>();

app.post("/api/auth/login", async (request, reply) => {
  const now = Date.now();
  const attempt = attempts.get(request.ip);
  if (attempt && attempt.until > now && attempt.count >= 10) return reply.code(429).send({ error: "Забагато спроб входу. Спробуйте пізніше." });
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
  const token = randomBytes(32).toString("hex");
  const user = parsed.success ? await db.transaction(async (tx) => {
    const [matched] = await tx.select().from(users).where(eq(users.keyCode, parsed.data.code)).for("update");
    if (!matched?.active) return undefined;
    await tx.insert(sessions).values({ id: token, userId: matched.id });
    return matched;
  }) : undefined;
  if (!user) {
    const current = attempt && attempt.until > now ? attempt : { count: 0, until: now + 15 * 60_000 };
    current.count++;
    attempts.set(request.ip, current);
    return reply.code(401).send({ error: "Невірний код або обліковий запис неактивний." });
  }
  attempts.delete(request.ip);
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
const updateUser = createUser.partial().extend({ active: z.boolean().optional() }).strict();

async function currentUser(token: string | undefined) {
  if (!token) return undefined;
  const [user] = await db.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id)).where(eq(sessions.id, token)).limit(1);
  return user?.active ? user : undefined;
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
  return db.select().from(users);
});

app.post("/api/users", async (request, reply) => {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  const input = createUser.safeParse(request.body);
  if (!input.success || (input.data.foreman && input.data.role !== "PRODUCTION_EMPLOYEE")) return reply.code(400).send({ error: "Некоректні дані користувача." });
  for (let i = 0; i < 20; i++) {
    try {
      const result = await db.transaction(async (tx) => {
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
  if (!params.success || !input.success || !Object.keys(input.data).length) return reply.code(400).send({ error: "Некоректні дані користувача." });
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(users).where(eq(users.id, params.data.id)).for("update");
    if (!old) return reply.code(404).send({ error: "Користувача не знайдено." });
    if (old.role === "ADMIN" && (input.data.role !== undefined || input.data.active === false)) return reply.code(403).send({ error: "Роль і активність адміністратора захищені." });
    const nextRole = input.data.role ?? old.role;
    const nextForeman = input.data.foreman ?? (nextRole === "PRODUCTION_EMPLOYEE" ? old.foreman : false);
    if (nextForeman && nextRole !== "PRODUCTION_EMPLOYEE") return reply.code(400).send({ error: "Бригадиром може бути лише працівник виробництва." });
    const next = { ...input.data, ...(input.data.phone !== undefined ? { phone: input.data.phone || null } : {}), foreman: nextForeman };
    const [updated] = await tx.update(users).set({ ...next, updatedAt: new Date() }).where(eq(users.id, old.id)).returning();
    for (const field of ["name", "role", "phone", "active", "foreman"] as const) {
      if (old[field] !== updated[field]) await tx.insert(audit).values({ actorId: actor.id, entityType: "user", entityId: old.id, action: "UPDATE", field, oldValue: String(old[field] ?? ""), newValue: String(updated[field] ?? "") });
    }
    if (old.active && !updated.active) {
      await tx.delete(sessions).where(eq(sessions.userId, old.id));
      if (old.role === "PRODUCTION_EMPLOYEE") {
        const heads = await tx.select({ id: users.id }).from(users).where(eq(users.role, "PRODUCTION_HEAD"));
        if (heads.length) await tx.insert(notifications).values(heads.map((head) => ({ userId: head.id, type: "EMPLOYEE_DEACTIVATED" })));
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
        const [user] = await tx.select().from(users).where(eq(users.id, params.data.id)).for("update");
        if (!user) return reply.code(404).send({ error: "Користувача не знайдено." });
        let code: string;
        do { code = String(randomInt(0, 1_000_000)).padStart(6, "0"); } while (code === user.keyCode);
        await tx.update(users).set({ keyCode: code, updatedAt: new Date() }).where(eq(users.id, user.id));
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
  const data = (params.data.kind === "vehicles" ? vehicleInput.partial() : z.object({ active: z.boolean() }).strict()).safeParse(request.body);
  if (!data.success || !Object.keys(data.data).length) return reply.code(400).send({ error: "Некоректні дані." });
  return db.transaction(async (tx) => {
    const table = params.data.kind === "vehicles" ? vehicles : workTypes;
    const [old] = await tx.select().from(table).where(eq(table.id, params.data.id)).for("update");
    if (!old) return reply.code(404).send({ error: "Запис не знайдено." });
    const [updated] = await tx.update(table).set(data.data).where(eq(table.id, old.id)).returning();
    for (const field of Object.keys(data.data) as (keyof typeof data.data)[]) {
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
    const [project] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
    if (!project || project.archivedAt) return reply.code(404).send({ error: "Об’єкт не знайдено." });
    if (actor.role !== "ADMIN" && !(actor.role === "MANAGER" && project.managerId === actor.id)) return reply.code(403).send({ error: "Недостатньо прав." });
    const archivedAt = new Date();
    await tx.update(projects).set({ archivedAt, updatedAt: archivedAt }).where(eq(projects.id, project.id));
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
  vehicleIds: z.array(z.string().uuid()), confirmConflicts: z.boolean().default(false),
}).strict().refine((v) => v.start <= v.end && new Set(v.employeeIds).size === v.employeeIds.length && new Set(v.vehicleIds).size === v.vehicleIds.length && v.employeeIds.includes(v.responsibleId));

app.put("/api/projects/:id/planning", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  if (actor.role !== "ADMIN" && actor.role !== "PRODUCTION_HEAD") return reply.code(403).send({ error: "Недостатньо прав." });
  const params = uuidParam.safeParse(request.params), input = planningInput.safeParse(request.body);
  if (!params.success || !input.success) return reply.code(400).send({ error: "Некоректний виробничий план." });
  const plan = input.data;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gis_project_planning'))`);
    const [project] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
    if (!project || project.archivedAt) return reply.code(404).send({ error: "Об’єкт не знайдено." });
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
    await tx.update(projects).set({ plannedStart: plan.start, plannedEnd: plan.end, updatedAt: new Date() }).where(eq(projects.id, project.id));
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
  return { ...row, team, vehicles: cars };
});

app.patch("/api/projects/:id", async (request, reply) => {
  const actor = await currentUser(request.cookies[sessionCookie]);
  if (!actor) return reply.code(401).send({ error: "Потрібно увійти." });
  const params = uuidParam.safeParse(request.params), input = projectFields.partial().safeParse(request.body);
  if (!params.success || !input.success || !Object.keys(input.data).length) return reply.code(400).send({ error: "Некоректні дані об’єкта." });
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(projects).where(eq(projects.id, params.data.id)).for("update");
    if (!old || old.archivedAt) return reply.code(404).send({ error: "Об’єкт не знайдено." });
    if (actor.role !== "ADMIN" && actor.role !== "PRODUCTION_HEAD" && !(actor.role === "MANAGER" && actor.id === old.managerId)) return reply.code(403).send({ error: "Недостатньо прав." });
    if (input.data.managerId && input.data.managerId !== old.managerId && actor.role !== "ADMIN") return reply.code(403).send({ error: "Змінити менеджера може лише адміністратор." });
    if (actor.role === "MANAGER" && old.plannedStart && ((input.data.workTypeId && input.data.workTypeId !== old.workTypeId) || (input.data.desiredStart !== undefined && input.data.desiredStart !== old.desiredStart) || (input.data.desiredEnd !== undefined && input.data.desiredEnd !== old.desiredEnd))) return reply.code(403).send({ error: "Ці дані змінює керівник виробництва." });
    const next = { ...old, ...input.data };
    if (!validProject(next)) return reply.code(400).send({ error: "Вкажіть локацію та коректну пару бажаних дат." });
    if (next.managerId !== old.managerId) {
      const [manager] = await tx.select().from(users).where(eq(users.id, next.managerId)).for("share");
      if (!manager?.active || manager.role !== "MANAGER") return reply.code(400).send({ error: "Оберіть активного менеджера." });
    }
    if (next.workTypeId !== old.workTypeId) {
      const [workType] = await tx.select().from(workTypes).where(eq(workTypes.id, next.workTypeId)).for("share");
      if (!workType?.active) return reply.code(400).send({ error: "Оберіть активний тип робіт." });
    }
    const [updated] = await tx.update(projects).set({ ...input.data, updatedAt: new Date() }).where(eq(projects.id, old.id)).returning();
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
  return db.select().from(notifications).where(eq(notifications.userId, actor.id)).orderBy(sql`${notifications.createdAt} desc`);
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
  return db.select().from(audit).orderBy(sql`${audit.createdAt} desc`);
});

app.addHook("onClose", async () => { await pool.end(); });
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 3000) });
