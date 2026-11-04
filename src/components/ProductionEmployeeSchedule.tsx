import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Employee, ScheduleRow } from "@/lib/api";
import { addDays, assignProjectCalendarLanes, getWeekDays, localDate } from "@/lib/project-utils";
import { formatDate } from "@/lib/date";

export function ProductionEmployeeSchedule({ employees, rows, onOpen }: {
  employees: Employee[]; rows: ScheduleRow[]; onOpen: (id: string) => void;
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
    <div className="page-heading schedule-heading"><div><p className="eyebrow">ВИРОБНИЦТВО</p><h1>Працівники</h1><p className="page-subtitle">Зайнятість за виробничими планами об’єктів</p></div>
      <div className="employee-schedule-controls"><div className="production-actions"><Button variant={mode === "week" ? "default" : "outline"} aria-pressed={mode === "week"} onClick={() => setMode("week")}>Тиждень</Button><Button variant={mode === "month" ? "default" : "outline"} aria-pressed={mode === "month"} onClick={() => setMode("month")}>Місяць</Button></div>
        <div className="month-controls"><Button variant="outline" size="icon" aria-label="Попередній період" onClick={() => move(-1)}><ChevronLeft /></Button><strong aria-live="polite">{label}</strong><Button variant="outline" size="icon" aria-label="Наступний період" onClick={() => move(1)}><ChevronRight /></Button><Button variant="outline" onClick={() => setAnchor(new Date())}>Сьогодні</Button></div>
      </div>
    </div>
    {!employees.length ? <div className="empty-state">Працівників виробництва поки немає.</div> : <div className="employee-schedule-scroll" role="region" aria-label={`Зайнятість працівників: ${label}`} tabIndex={0}>
      <div className="employee-schedule-grid" style={gridStyle}>
        <div className="employee-schedule-header employee-schedule-row"><div className="employee-schedule-person">Працівник</div>{dates.map((date, index) => <div key={days[index]} className={`employee-schedule-date ${days[index] === today ? "is-today" : ""} ${date.getDay() === 0 || date.getDay() === 6 ? "is-weekend" : ""}`}><strong>{date.getDate()}</strong><span>{new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(date)}</span></div>)}</div>
        {[...employees].sort((a, b) => a.name.localeCompare(b.name, "uk") || a.id.localeCompare(b.id)).map((employee) => {
          const events = assignProjectCalendarLanes(visible.filter((row) => row.employeeIds?.includes(employee.id)).map((row) => ({ row, startDate: row.project.plannedStart!, endDate: row.project.plannedEnd! })));
          const laneCount = Math.max(1, ...events.map(({ lane }) => lane + 1));
          return <div key={employee.id} className="employee-schedule-row" style={{ gridTemplateRows: `repeat(${laneCount}, minmax(122px, auto))` }} aria-label={employee.name}>
            <div className="employee-schedule-person" style={{ gridRow: "1 / -1" }}><strong>{employee.name}</strong><span>{employee.phone || "Телефон не вказано"}</span>{employee.foreman && <span>Бригадир</span>}{!employee.active && <span>Неактивний</span>}</div>
            {days.map((day, index) => <div aria-hidden="true" key={day} className={`employee-schedule-day ${day === today ? "is-today" : ""}`} style={{ gridColumn: index + 2, gridRow: "1 / -1" }} />)}
            {!events.length && <span className="employee-schedule-free" style={{ gridColumn: `2 / ${days.length + 2}`, gridRow: 1 }}>Призначень у цьому періоді немає</span>}
            {events.map(({ project: { row, startDate, endDate }, lane }) => {
              const first = startDate < start ? 0 : days.indexOf(startDate);
              const last = endDate > end ? days.length - 1 : days.indexOf(endDate);
              return <button key={row.project.id} type="button" className={`employee-schedule-event status-${row.status.toLowerCase().replace("_", "-")}`} style={{ gridColumn: `${first + 2} / ${last + 3}`, gridRow: lane + 1 }} onClick={() => onOpen(row.project.id)}>
                <strong>{row.project.name}</strong><span>Менеджер: {row.managerName}</span><span>Бригада: {row.team.join(", ") || "Не призначена"}</span><span>Автомобілі: {row.vehicles.join(", ") || "Не призначені"}</span><span>{formatDate(startDate)} — {formatDate(endDate)}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
    </div>}
  </section>;
}
