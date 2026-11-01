import { spawn, spawnSync } from "node:child_process";
import { get } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const start = (command, args, stdio = "inherit") => spawn(command, args, { cwd: root, env: process.env, stdio });
let api;
let web;
let localDatabase;
let stopping = false;
let timer;
let probing = false;
class LocalSetupError extends Error {}
let localStage = "database";
function reportLocalError(message) {
  console.error(message);
  try {
    const logFile = resolve(root, process.env.LOG_FILE || "logs/gis-api.log");
    mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
    appendFileSync(logFile, `${JSON.stringify({ level: 50, time: Date.now(), startupStage: localStage, msg: message })}\n`, { mode: 0o600 });
  } catch {
    console.error("Не вдалося записати журнал запуску.");
  }
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  if (web && web.exitCode === null && web.signalCode === null) web.kill(signal);
  if (api && api.exitCode === null && api.signalCode === null) {
    api.once("exit", () => { if (localDatabase && localDatabase.exitCode === null && localDatabase.signalCode === null) localDatabase.kill("SIGINT"); });
    api.kill(signal);
  } else if (localDatabase && localDatabase.exitCode === null && localDatabase.signalCode === null) localDatabase.kill("SIGINT");
}
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

function isDatabaseReady() {
  return spawnSync("pg_isready", ["-q", "-h", resolve(root, ".local/socket"), "-p", "55432", "-d", "gis_reports"], { stdio: "ignore" }).status === 0;
}
async function prepareLocalDatabase() {
  if (!isDatabaseReady()) {
    console.log("Запускаємо локальну PostgreSQL…");
    localDatabase = start("postgres", ["-D", resolve(root, ".local/postgres"), "-c", "listen_addresses=", "-c", `unix_socket_directories=${resolve(root, ".local/socket")}`, "-p", "55432", "-c", "log_min_error_statement=panic"], "ignore");
    localDatabase.once("error", () => { reportLocalError("Не вдалося запустити локальну PostgreSQL."); process.exitCode = 1; stop(); });
    localDatabase.once("exit", () => { if (!stopping) { reportLocalError("Локальну PostgreSQL зупинено."); process.exitCode = 1; stop(); } });
    for (let i = 0; i < 100 && !stopping && !isDatabaseReady(); i++) await new Promise((done) => setTimeout(done, 100));
    if (stopping || !isDatabaseReady()) throw new LocalSetupError("Локальна PostgreSQL не запустилася.");
  }
  localStage = "schema";
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let hasUsers;
  try { hasUsers = (await pool.query("select exists(select 1 from users) as exists")).rows[0].exists; }
  finally { await pool.end(); }
  if (!hasUsers) {
    localStage = "bootstrap";
    if (!process.stdout.isTTY) throw new LocalSetupError("Для першого запуску відкрийте інтерактивний термінал: у ньому буде показано початковий код адміністратора.");
    const bootstrap = start(process.execPath, ["--import", "tsx", resolve(root, "server/bootstrap-admin.ts"), "Адміністратор", "--show-code"]);
    const exitCode = await new Promise((done, fail) => { bootstrap.once("error", fail); bootstrap.once("exit", done); });
    if (exitCode !== 0) throw new LocalSetupError("Не вдалося створити першого адміністратора.");
  }
}

try {
  if (process.env.GIS_LOCAL_DATABASE === "1") await prepareLocalDatabase();
} catch (error) {
  reportLocalError(error instanceof LocalSetupError ? error.message : "Не вдалося підготувати локальну базу. Перевірте PostgreSQL та стан бази.");
  process.exitCode = 1;
  stop();
}

if (!stopping) {
  api = start(process.execPath, ["--import", "tsx", resolve(root, "server/index.ts")]);
  api.once("error", () => { console.error("Не вдалося запустити API."); process.exitCode = 1; stop(); });
  api.once("exit", (code) => {
    if (!stopping) {
      console.error("API зупинено. Перевірте налаштування бази та журнал API.");
      process.exitCode = code || 1;
      stop();
    }
  });
  if (process.env.DATABASE_URL) {
    console.log("Запускаємо API та перевіряємо підключення до бази…");
    timer = setInterval(() => {
      if (probing || stopping) return;
      probing = true;
      const request = get({ hostname: "127.0.0.1", port: Number(process.env.PORT || 3000), path: "/api/auth/me", timeout: 1000 }, (response) => {
        response.resume();
        probing = false;
        if (response.statusCode === 401) {
          clearInterval(timer);
          if (stopping || web) return;
          web = start(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), ...process.argv.slice(2)]);
          web.once("error", () => { console.error("Не вдалося запустити інтерфейс."); process.exitCode = 1; stop(); });
          web.once("exit", (code, signal) => { if (!stopping) { process.exitCode = code || (signal ? 1 : 0); stop(); } });
        }
      });
      request.on("timeout", () => request.destroy());
      request.on("error", () => { probing = false; });
    }, 200);
  }
}
