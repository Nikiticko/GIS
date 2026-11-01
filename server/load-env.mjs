import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  if (error?.code !== "ENOENT") {
    console.error("Не вдалося завантажити налаштування середовища.");
    process.exitCode = 1;
    throw new Error("Помилка налаштування середовища");
  }
}

const localCommands = new Set(["dev", "api:dev", "db:migrate", "api:bootstrap-admin"]);
if (localCommands.has(process.env.npm_lifecycle_event) && existsSync(resolve(".local/use-local-db"))) {
  const url = new URL("postgresql://localhost/gis_reports");
  url.searchParams.set("host", resolve(".local/socket"));
  url.searchParams.set("port", "55432");
  process.env.DATABASE_URL = url.toString();
  process.env.GIS_LOCAL_DATABASE = "1";
}
