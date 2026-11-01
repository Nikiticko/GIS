const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(value: string | null | undefined, fallback = "Не вказано") {
  if (!value) return fallback;
  const match = value.match(isoDatePattern);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : fallback;
}

export function parseDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day) ? iso : "";
}

export function maskDate(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join("/");
}

export function formatDateTime(value: string | null | undefined, fallback = "Не вказано") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")}, ${part("hour")}:${part("minute")}`;
}
