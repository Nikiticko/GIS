import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { sessions, users } from "./schema.js";

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
  const user = parsed.success ? (await db.select().from(users).where(eq(users.keyCode, parsed.data.code)).limit(1))[0] : undefined;
  if (!user?.active) {
    const current = attempt && attempt.until > now ? attempt : { count: 0, until: now + 15 * 60_000 };
    current.count++;
    attempts.set(request.ip, current);
    return reply.code(401).send({ error: "Невірний код або обліковий запис неактивний." });
  }
  attempts.delete(request.ip);
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ id: token, userId: user.id });
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

app.addHook("onClose", async () => { await pool.end(); });
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 3000) });
