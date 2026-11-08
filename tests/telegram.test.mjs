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

test("assignment notification contains current operational project data", () => {
  const message = telegramMessage("EMPLOYEE_ASSIGNED", {
    projectName: "Об’єкт", manager: "Менеджер", address: "Київ, Хрещатик 1",
    locationUrl: "https://maps.example/project", start: "2026-11-09", end: "2026-11-10",
    workType: "Монтаж", volume: "100 м²", information: "Вхід з двору", responsible: "Бригадир",
    team: ["Бригадир", "Працівник"], vehicles: ["Iveco (AA0001AA)"],
  });
  assert.match(message, /Вас призначено на об’єкт: Об’єкт/);
  assert.match(message, /Адреса: Київ, Хрещатик 1/);
  assert.match(message, /Геолокація: https:\/\/maps\.example\/project/);
  assert.match(message, /Відповідальний: Бригадир/);
});

test("cancellation and archive messages do not imply an active assignment", () => {
  assert.match(telegramMessage("EMPLOYEE_REMOVED", { projectName: "Об’єкт" }), /призначення.*скасовано/i);
  assert.match(telegramMessage("PROJECT_ARCHIVED_EMPLOYEE", { projectName: "Об’єкт" }), /скасовано та архівовано/i);
});
