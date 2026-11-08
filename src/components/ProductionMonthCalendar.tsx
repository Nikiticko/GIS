import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDays, localDate } from "@/lib/project-utils";
import type { ScheduleRow, Status } from "@/lib/api";
import { formatDate } from "@/lib/date";

const statusLabels: Record<Status, string> = { NEW: "Новий", PLANNED: "Запланований", IN_PROGRESS: "У роботі", COMPLETED: "Завершений" };
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

type CalendarEvent = { row: ScheduleRow; start: string; end: string };
type WeekEvent = CalendarEvent & { first: number; last: number; lane: number };

function eventsForWeek(events: CalendarEvent[], days: string[]) {
  const start = days[0], end = days[6];
  const visible = events.filter((event) => event.start <= end && event.end >= start)
    .map((event) => ({ ...event, first: Math.max(0, days.findIndex((day) => day >= event.start)), last: days.reduce((last, day, index) => day <= event.end ? index : last, -1) }))
    .sort((a, b) => a.first - b.first || b.last - a.last || a.row.project.name.localeCompare(b.row.project.name, "uk") || a.row.project.id.localeCompare(b.row.project.id));
  const laneEnds: number[] = [];
  const placed: WeekEvent[] = visible.map((event) => {
    let lane = laneEnds.findIndex((last) => last < event.first);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = event.last;
    return { ...event, lane };
  });
  return { events: placed, laneCount: laneEnds.length };
}

export function ProductionMonthCalendar({ rows, employee, onOpen, onSelectDates }: { rows: ScheduleRow[]; employee: boolean; onOpen: (id: string) => void; onSelectDates?: (start: string, end: string) => void }) {
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  function selectDay(day: string) {
    if (!onSelectDates) return;
    if (!selectionStart) { setSelectionStart(day); return; }
    onSelectDates(day < selectionStart ? day : selectionStart, day < selectionStart ? selectionStart : day);
    setSelectionStart(null);
  }
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const today = localDate();
  const weeks = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const events: CalendarEvent[] = rows.flatMap((row) => {
      const startDate = row.project.plannedStart ?? row.project.desiredStart;
      const endDate = row.project.plannedEnd ?? row.project.desiredEnd;
      return startDate && endDate && !row.project.archivedAt ? [{ row, start: startDate, end: endDate }] : [];
    });
    return Array.from({ length: 6 }, (_, index) => {
      const days = Array.from({ length: 7 }, (_, day) => addDays(index * 7 + day, start));
      return { days, ...eventsForWeek(events, days) };
    });
  }, [month, rows]);
  const label = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric" }).format(month);
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  function move(amount: number) { setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }

  return <section className="page-stack" onKeyDown={(event) => { if (event.key === "Escape") setSelectionStart(null); }}>
    <div className="page-heading schedule-heading"><div><p className="eyebrow">ВИРОБНИЦТВО</p><h1>{employee ? "Мій графік" : "Графік виробництва"}</h1><p className="page-subtitle">{employee ? "Призначені вам об’єкти за місяць" : "Об’єкти за бажаними та виробничими датами"}</p></div>
      <div className="month-controls"><Button type="button" variant="outline" size="icon" aria-label="Попередній місяць" onClick={() => move(-1)}><ChevronLeft /></Button><strong aria-live="polite">{label}</strong><Button type="button" variant="outline" size="icon" aria-label="Наступний місяць" onClick={() => move(1)}><ChevronRight /></Button><Button type="button" variant="outline" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>Сьогодні</Button></div>
    </div>
    {onSelectDates && <div className="calendar-selection-help"><span role="status">{selectionStart ? `Початок: ${formatDate(selectionStart)}. Натисніть день завершення — або цей самий день для одного дня.` : "Щоб створити об’єкт, натисніть день початку, а потім день завершення."}</span>{selectionStart && <Button type="button" variant="outline" onClick={() => setSelectionStart(null)}>Скасувати вибір</Button>}</div>}
    <div className="production-month-scroll"><div className="production-month" role="region" aria-label={`Графік за ${label}`}>
      <div className="production-month-weekdays">{weekdays.map((day) => <div key={day}>{day}</div>)}</div>
      {weeks.map(({ days, events, laneCount }) => <div className="production-month-week" key={days[0]} style={{ gridTemplateRows: `34px repeat(${Math.max(1, laneCount + (selectionStart && days.includes(selectionStart) ? 1 : 0))}, minmax(min-content, 1fr))` }}>
        {days.map((day, index) => onSelectDates ? <button type="button" className={`production-month-cell selectable ${day.startsWith(monthPrefix) ? "" : "outside-month"} ${day === today ? "today" : ""} ${day === selectionStart ? "selection-start" : ""}`} aria-label={`${selectionStart ? "Завершення" : "Початок"}: ${formatDate(day)}`} aria-pressed={day === selectionStart} onClick={() => selectDay(day)} key={day} style={{ gridColumn: index + 1 }} /> : <div className={`production-month-cell ${day.startsWith(monthPrefix) ? "" : "outside-month"} ${day === today ? "today" : ""}`} aria-label={formatDate(day)} key={day} style={{ gridColumn: index + 1 }} />)}
        {onSelectDates && selectionStart && days.includes(selectionStart) && <div className="production-month-event calendar-draft" style={{ gridColumn: days.indexOf(selectionStart) + 1, gridRow: laneCount + 2 }}><span><strong>Новий об’єкт</strong><span>Оберіть завершення</span></span></div>}
        {days.map((day, index) => <span className={`production-month-day ${day.startsWith(monthPrefix) ? "" : "outside-month"} ${day === today ? "today" : ""}`} aria-hidden="true" key={day} style={{ gridColumn: index + 1 }}>{Number(day.slice(-2))}</span>)}
        {events.map((event) => <button key={event.row.project.id} type="button" className={`production-month-event status-${event.row.status.toLowerCase().replace("_", "-")} ${event.start < days[0] ? "continues-before" : ""} ${event.end > days[6] ? "continues-after" : ""}`} style={{ gridColumn: `${event.first + 1} / ${event.last + 2}`, gridRow: event.lane + 2 }} title={`${event.row.project.name} · ${statusLabels[event.row.status]} · ${formatDate(event.start)} — ${formatDate(event.end)}`} onClick={() => { setSelectionStart(null); onOpen(event.row.project.id); }}><span><strong>{event.row.project.name}</strong><span>Менеджер: {event.row.managerName}</span><span>Тип робіт: {event.row.workTypeName}</span><span>Обсяг: {event.row.project.volume || "Не вказано"}</span>{event.row.status !== "NEW" && <><span>Бригада: {event.row.team.join(", ") || "Не призначена"}</span><span>Автомобілі: {event.row.vehicles.join(", ") || "Не призначені"}</span></>}</span></button>)}
      </div>)}
    </div></div>
    <div className="production-month-legend" aria-label="Кольори статусів">{(Object.keys(statusLabels) as Status[]).map((status) => <span key={status}><i className={`status-${status.toLowerCase().replace("_", "-")}`} />{statusLabels[status]}</span>)}</div>
  </section>;
}
