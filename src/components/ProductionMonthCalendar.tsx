import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, localDate } from "@/lib/project-utils";
import type { ScheduleRow, Status } from "@/lib/api";
import { formatDate } from "@/lib/date";

const statusLabels: Record<Status, string> = { NEW: "Новий", PLANNED: "Запланований", IN_PROGRESS: "У роботі", COMPLETED: "Завершений" };
const allStatuses = Object.keys(statusLabels) as Status[];
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [managerIds, setManagerIds] = useState<Set<string> | null>(null);
  const [statuses, setStatuses] = useState<Set<Status> | null>(null);
  const [workTypeIds, setWorkTypeIds] = useState<Set<string> | null>(null);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const managers = useMemo(() => [...new Map(rows.map((row) => [row.project.managerId, row.managerName] as const)).entries()].sort((left, right) => left[1].localeCompare(right[1], "uk")), [rows]);
  const workTypes = useMemo(() => [...new Map(rows.map((row) => [row.project.workTypeId, row.workTypeName] as const)).entries()].sort((left, right) => left[1].localeCompare(right[1], "uk")), [rows]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("uk");
    return rows.filter((row) => {
      if (normalizedQuery && !row.project.name.toLocaleLowerCase("uk").includes(normalizedQuery)) return false;
      if (managerIds && !managerIds.has(row.project.managerId)) return false;
      if (statuses && !statuses.has(row.status)) return false;
      if (workTypeIds && !workTypeIds.has(row.project.workTypeId)) return false;
      if (confirmedOnly && !row.project.confirmedAt) return false;
      return true;
    });
  }, [confirmedOnly, managerIds, query, rows, statuses, workTypeIds]);
  const filtersActive = Boolean(query.trim() || managerIds || statuses || workTypeIds || confirmedOnly);
  function toggleValue<T>(current: Set<T> | null, value: T, all: T[]) {
    const next = new Set(current ?? all);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next.size === all.length ? null : next;
  }
  function resetFilters() {
    setQuery("");
    setManagerIds(null);
    setStatuses(null);
    setWorkTypeIds(null);
    setConfirmedOnly(false);
  }
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
    const events: CalendarEvent[] = filteredRows.flatMap((row) => {
      const startDate = row.project.plannedStart ?? row.project.desiredStart;
      const endDate = row.project.plannedEnd ?? row.project.desiredEnd;
      return startDate && endDate && !row.project.archivedAt ? [{ row, start: startDate, end: endDate }] : [];
    });
    return Array.from({ length: 6 }, (_, index) => {
      const days = Array.from({ length: 7 }, (_, day) => addDays(index * 7 + day, start));
      return { days, ...eventsForWeek(events, days) };
    });
  }, [filteredRows, month]);
  const label = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric" }).format(month);
  const monthPrefix = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  function move(amount: number) { setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }

  return <section className="page-stack" onKeyDown={(event) => { if (event.key === "Escape") setSelectionStart(null); }}>
    <div className="page-heading schedule-heading"><div><p className="eyebrow">ВИРОБНИЦТВО</p><h1>{employee ? "Мій графік" : "Графік виробництва"}</h1><p className="page-subtitle">{employee ? "Призначені вам об’єкти за місяць" : "Об’єкти за бажаними та виробничими датами"}</p></div>
      <div className="month-controls"><Button type="button" variant="outline" size="icon" aria-label="Попередній місяць" onClick={() => move(-1)}><ChevronLeft /></Button><strong aria-live="polite">{label}</strong><Button type="button" variant="outline" size="icon" aria-label="Наступний місяць" onClick={() => move(1)}><ChevronRight /></Button><Button type="button" variant="outline" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); }}>Сьогодні</Button></div>
    </div>
    <Button type="button" variant="outline" className="schedule-filter-toggle" aria-expanded={filtersOpen} aria-controls="schedule-filters" onClick={() => setFiltersOpen((open) => !open)}>Фільтри{filtersActive ? " •" : ""}</Button>
    <div id="schedule-filters" className={`production-panel schedule-filter-panel ${filtersOpen ? "open" : ""}`}>
      <label className="schedule-filter-search">Назва об’єкта<Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук за назвою" /></label>
      <details className="schedule-filter-group"><summary>Менеджери · {managerIds === null ? "Усі менеджери" : `Обрано: ${managerIds.size}`}</summary><div className="schedule-filter-options"><div className="schedule-filter-actions"><button type="button" onClick={() => setManagerIds(null)}>Обрати всіх</button><button type="button" onClick={() => setManagerIds(new Set())}>Очистити</button></div>{managers.map(([id, name]) => <label key={id}><input type="checkbox" checked={managerIds === null || managerIds.has(id)} onChange={() => setManagerIds((current) => toggleValue(current, id, managers.map(([managerId]) => managerId)))} /> {name}</label>)}</div></details>
      <details className="schedule-filter-group"><summary>Статуси · {statuses === null ? "Усі" : `Обрано: ${statuses.size}`}</summary><div className="schedule-filter-options"><div className="schedule-filter-actions"><button type="button" onClick={() => setStatuses(null)}>Обрати всі</button><button type="button" onClick={() => setStatuses(new Set())}>Очистити</button></div>{allStatuses.map((status) => <label key={status}><input type="checkbox" checked={statuses === null || statuses.has(status)} onChange={() => setStatuses((current) => toggleValue(current, status, allStatuses))} /> {statusLabels[status]}</label>)}</div></details>
      <details className="schedule-filter-group"><summary>Типи робіт · {workTypeIds === null ? "Усі" : `Обрано: ${workTypeIds.size}`}</summary><div className="schedule-filter-options"><div className="schedule-filter-actions"><button type="button" onClick={() => setWorkTypeIds(null)}>Обрати всі</button><button type="button" onClick={() => setWorkTypeIds(new Set())}>Очистити</button></div>{workTypes.map(([id, name]) => <label key={id}><input type="checkbox" checked={workTypeIds === null || workTypeIds.has(id)} onChange={() => setWorkTypeIds((current) => toggleValue(current, id, workTypes.map(([workTypeId]) => workTypeId)))} /> {name}</label>)}</div></details>
      <label className="schedule-filter-confirmed"><input type="checkbox" checked={confirmedOnly} onChange={(event) => setConfirmedOnly(event.target.checked)} /> Тільки підтверджені об’єкти</label>
      <div className="schedule-filter-footer"><span>Знайдено: {filteredRows.length} із {rows.length}</span>{filtersActive && <Button type="button" variant="outline" onClick={resetFilters}>Скинути фільтри</Button>}</div>
    </div>
    {onSelectDates && <div className="calendar-selection-help"><span role="status">{selectionStart ? `Початок: ${formatDate(selectionStart)}. Натисніть день завершення — або цей самий день для одного дня.` : "Щоб створити об’єкт, натисніть день початку, а потім день завершення."}</span>{selectionStart && <Button type="button" variant="outline" onClick={() => setSelectionStart(null)}>Скасувати вибір</Button>}</div>}
    <div className="production-month-scroll"><div className="production-month" role="region" aria-label={`Графік за ${label}`}>
      <div className="production-month-weekdays">{weekdays.map((day) => <div key={day}>{day}</div>)}</div>
      {weeks.map(({ days, events, laneCount }) => <div className="production-month-week" key={days[0]} style={{ gridTemplateRows: `34px repeat(${Math.max(1, laneCount + (selectionStart && days.includes(selectionStart) ? 1 : 0))}, minmax(min-content, 1fr))` }}>
        {days.map((day, index) => onSelectDates ? <button type="button" className={`production-month-cell selectable ${day.startsWith(monthPrefix) ? "" : "outside-month"} ${day === today ? "today" : ""} ${day === selectionStart ? "selection-start" : ""}`} aria-label={`${selectionStart ? "Завершення" : "Початок"}: ${formatDate(day)}`} aria-pressed={day === selectionStart} onClick={() => selectDay(day)} key={day} style={{ gridColumn: index + 1 }} /> : <div className={`production-month-cell ${day.startsWith(monthPrefix) ? "" : "outside-month"} ${day === today ? "today" : ""}`} aria-label={formatDate(day)} key={day} style={{ gridColumn: index + 1 }} />)}
        {onSelectDates && selectionStart && days.includes(selectionStart) && <div className="production-month-event calendar-draft" style={{ gridColumn: days.indexOf(selectionStart) + 1, gridRow: laneCount + 2 }}><span><strong>Новий об’єкт</strong><span>Оберіть завершення</span></span></div>}
        {days.map((day, index) => <span className={`production-month-day ${day.startsWith(monthPrefix) ? "" : "outside-month"} ${day === today ? "today" : ""}`} aria-hidden="true" key={day} style={{ gridColumn: index + 1 }}>{Number(day.slice(-2))}</span>)}
        {events.map((event) => <button key={event.row.project.id} type="button" className={`production-month-event status-${event.row.status.toLowerCase().replace("_", "-")} ${event.start < days[0] ? "continues-before" : ""} ${event.end > days[6] ? "continues-after" : ""}`} style={{ gridColumn: `${event.first + 1} / ${event.last + 2}`, gridRow: event.lane + 2 }} title={`${event.row.project.name} · ${event.row.project.confirmedAt ? "100%" : "Попередньо"} · ${statusLabels[event.row.status]} · ${formatDate(event.start)} — ${formatDate(event.end)}`} onClick={() => { setSelectionStart(null); onOpen(event.row.project.id); }}><span><strong>{event.row.project.name} · {event.row.project.confirmedAt ? "100%" : "Попередньо"}</strong><span>Менеджер: {event.row.managerName}</span><span>Тип робіт: {event.row.workTypeName}</span><span>Обсяг: {event.row.project.volume || "Не вказано"}</span>{event.row.status !== "NEW" && <><span>Бригада: {event.row.team.join(", ") || "Не призначена"}</span><span>Автомобілі: {event.row.vehicles.join(", ") || "Не призначені"}</span></>}</span></button>)}
      </div>)}
    </div></div>
    <div className="production-month-legend" aria-label="Кольори статусів">{(Object.keys(statusLabels) as Status[]).map((status) => <span key={status}><i className={`status-${status.toLowerCase().replace("_", "-")}`} />{statusLabels[status]}</span>)}</div>
  </section>;
}
