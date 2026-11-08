import assert from "node:assert/strict";
import test from "node:test";
import { telegramDeliveryIsTerminal, telegramMessage } from "../server/telegram.ts";

test("Telegram notifications use the user-facing date format", () => {
  const message = telegramMessage("PROJECT_PLANNED", {
    projectName: "Об’єкт",
    manager: "Менеджер",
    start: "2026-11-08",
    end: "2026-11-10",
    changes: [{ field: "Плановий початок", before: "2026-11-08", after: "2026-11-09" }],
  });
  assert.match(message, /08\/11\/2026 — 10\/11\/2026/);
  assert.match(message, /08\/11\/2026 → 09\/11\/2026/);
});

test("Telegram notifications never exceed 4096 Unicode characters", () => {
  const message = telegramMessage("PROJECT_CHANGED", {
    projectName: "Об’єкт",
    changes: [{ field: "Коментар", before: null, after: "😀".repeat(5000) }],
  });
  assert.equal(Array.from(message).length, 4096);
  assert.ok(message.endsWith("..."));
});

test("Telegram delivery retries stop on permanent errors or after twelve attempts", () => {
  assert.equal(telegramDeliveryIsTerminal(1, 403, "Forbidden"), true);
  assert.equal(telegramDeliveryIsTerminal(1, 400, "Bad Request: chat not found"), true);
  assert.equal(telegramDeliveryIsTerminal(11, 500, "Temporary error"), false);
  assert.equal(telegramDeliveryIsTerminal(12, 500, "Temporary error"), true);
});
