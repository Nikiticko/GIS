import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { users } from "./schema.js";

const name = process.argv[2]?.trim();
const connectionString = process.env.DATABASE_URL;
if (!name || !connectionString) throw new Error("Потрібні ім’я адміністратора та DATABASE_URL");
const pool = new pg.Pool({ connectionString });
try {
  const db = drizzle(pool);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gis_bootstrap_admin'))`);
    const existing = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing.length) throw new Error("Початкового адміністратора можна створити лише в порожній базі");
    await tx.insert(users).values({ name, role: "ADMIN", keyCode: String(randomInt(0, 1_000_000)).padStart(6, "0") });
  });
  console.log("Початкового адміністратора створено.");
} finally {
  await pool.end();
}
