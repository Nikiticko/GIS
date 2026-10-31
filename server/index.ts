import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { randomBytes, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { audit, notifications, sessions, users, vehicles, workTypes } from "./schema.js";

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

app.addHook("onClose", async () => { await pool.end(); });
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 3000) });
