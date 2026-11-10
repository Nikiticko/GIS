import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScheduleRow, Vehicle } from "@/lib/api";
import { addDays, assignProjectCalendarLanes, getWeekDays, localDate } from "@/lib/project-utils";
import { formatDate } from "@/lib/date";

export function ProductionVehicleSchedule({ vehicles, rows, onOpen }: {
  vehicles: Vehicle[]; rows: ScheduleRow[]; onOpen: (id: string) => void;
}) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const dates = mode === "week" ? getWeekDays(anchor) : Array.from({ length: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() }, (_, day) => new Date(anchor.getFullYear(), anchor.getMonth(), day + 1));
  const days = dates.map((date) => localDate(date));
  const start = days[0], end = days[days.length - 1], today = localDate();
  const visible = rows.filter(({ project }) => !project.archivedAt && project.plannedStart && project.plannedEnd && project.plannedStart <= end && project.plannedEnd >= start);
  const label = mode === "week" ? `${formatDate(start)} — ${formatDate(end)}` : new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric" }).format(anchor);
  const gridStyle = { "--employee-days": days.length, "--employee-day-width": mode === "week" ? "128px" : "150px" } as CSSProperties;
  function move(amount: number) {
    setAnchor(mode === "week" ? new Date(`${addDays(amount * 7, anchor)}T00:00:00`) : new Date(anchor.getFullYear(), anchor.getMonth() + amount, 1));
  }
  return <section className="page-stack">
    <div className="page-heading schedule-heading"><div><p className="eyebrow">ВИРОБНИЦТВО</p><h1>Автомобілі</h1><p className="page-subtitle">Зайнятість автомобілів на виробничих виїздах</p></div>
      <div className="employee-schedule-controls"><div className="production-actions"><Button variant={mode === "week" ? "default" : "outline"} aria-pressed={mode === "week"} onClick={() => setMode("week")}>Тиждень</Button><Button variant={mode === "month" ? "default" : "outline"} aria-pressed={mode === "month"} onClick={() => setMode("month")}>Місяць</Button></div>
        <div className="month-controls"><Button variant="outline" size="icon" aria-label="Попередній період" onClick={() => move(-1)}><ChevronLeft /></Button><strong aria-live="polite">{label}</strong><Button variant="outline" size="icon" aria-label="Наступний період" onClick={() => move(1)}><ChevronRight /></Button><Button variant="outline" onClick={() => setAnchor(new Date())}>Сьогодні</Button></div>
      </div>
    </div>
    {!vehicles.some((vehicle) => vehicle.active) ? <div className="empty-state">Активних автомобілів поки немає.</div> : <div className="employee-schedule-scroll" role="region" aria-label={`Зайнятість автомобілів: ${label}`} tabIndex={0}>
      <div className="employee-schedule-grid" style={gridStyle}>
        <div className="employee-schedule-header employee-schedule-row"><div className="employee-schedule-person">Автомобіль</div>{dates.map((date, index) => <div key={days[index]} className={`employee-schedule-date ${days[index] === today ? "is-today" : ""} ${date.getDay() === 0 || date.getDay() === 6 ? "is-weekend" : ""}`}><strong>{date.getDate()}</strong><span>{new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(date)}</span></div>)}</div>
        {vehicles.filter((vehicle) => vehicle.active).sort((a, b) => a.name.localeCompare(b.name, "uk") || a.registration.localeCompare(b.registration, "uk") || a.id.localeCompare(b.id)).map((vehicle) => {
          const events = assignProjectCalendarLanes(visible.filter((row) => row.vehicleIds?.includes(vehicle.id)).map((row) => ({ row, startDate: row.project.plannedStart!, endDate: row.project.plannedEnd! })));
          const laneCount = Math.max(1, ...events.map(({ lane }) => lane + 1));
          return <div key={vehicle.id} className="employee-schedule-row" style={{ gridTemplateRows: `repeat(${laneCount}, minmax(122px, auto))` }} aria-label={`${vehicle.name}, ${vehicle.registration}`}>
            <div className="employee-schedule-person" style={{ gridRow: "1 / -1" }}><strong>{vehicle.name}</strong><span>{vehicle.registration}</span></div>
            {days.map((day, index) => <div aria-hidden="true" key={day} className={`employee-schedule-day ${day === today ? "is-today" : ""}`} style={{ gridColumn: index + 2, gridRow: "1 / -1" }} />)}
            {!events.length && <span className="employee-schedule-free" style={{ gridColumn: `2 / ${days.length + 2}`, gridRow: 1 }}>Виїздів у цьому періоді немає</span>}
            {events.map(({ project: { row, startDate, endDate }, lane }) => {
              const first = startDate < start ? 0 : days.indexOf(startDate);
              const last = endDate > end ? days.length - 1 : days.indexOf(endDate);
              return <button key={row.project.id} type="button" className={`employee-schedule-event status-${row.status.toLowerCase().replace("_", "-")}`} style={{ gridColumn: `${first + 2} / ${last + 3}`, gridRow: lane + 1 }} onClick={() => onOpen(row.project.id)}>
                <strong>{row.project.name} · {row.project.confirmedAt ? "100%" : "Попередньо"}</strong><span>Менеджер: {row.managerName}</span><span>Бригада: {row.team.join(", ") || "Не призначена"}</span><span>{formatDate(startDate)} — {formatDate(endDate)}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
    </div>}
  </section>;
}
