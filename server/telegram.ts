type TelegramNotificationPayload = {
  projectName: string;
  manager?: string;
  start?: string | null;
  end?: string | null;
  workType?: string;
  volume?: string | null;
  team?: string[];
  vehicles?: string[];
  changes?: { field: string; before: string | null; after: string | null }[];
};

const titles: Record<string, string> = {
  PROJECT_CREATED: "Створено новий об’єкт",
  PROJECT_ARCHIVED: "Об’єкт архівовано",
  PROJECT_CREATED_V2: "Створено новий об’єкт",
  PROJECT_PLANNED: "Об’єкт заплановано",
  PROJECT_CHANGED: "Об’єкт змінено",
  PROJECT_ARCHIVED_V2: "Об’єкт архівовано",
};

function userDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value ?? "—";
}

export function telegramMessage(type: string, payload: TelegramNotificationPayload | null) {
  const lines = [titles[type] ?? "Системне сповіщення"];
  if (!payload) return lines[0];
  if (payload.projectName) lines[0] += `: ${payload.projectName}`;
  if (payload.manager !== undefined) lines.push(`Менеджер: ${payload.manager}`, `Дати: ${userDate(payload.start)} — ${userDate(payload.end)}`, `Тип робіт: ${payload.workType || "—"}`, `Обсяг робіт: ${payload.volume || "Не вказано"}`);
  if (payload.team) lines.push(`Бригада: ${payload.team.join(", ") || "Не призначена"}`);
  if (payload.vehicles) lines.push(`Автомобілі: ${payload.vehicles.join(", ") || "Не призначені"}`);
  for (const change of payload.changes ?? []) lines.push(`${change.field}: ${userDate(change.before)} → ${userDate(change.after)}`);
  const characters = Array.from(lines.join("\n"));
  return characters.length <= 4096 ? characters.join("") : `${characters.slice(0, 4093).join("")}...`;
}

export function telegramDeliveryIsTerminal(attempts: number, status: number | undefined, message: string) {
  const normalized = message.toLowerCase();
  return attempts >= 12 || status === 403 || normalized.includes("chat not found") || normalized.includes("user is deactivated");
}
