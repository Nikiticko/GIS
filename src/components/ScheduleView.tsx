import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import type { AppData, EmployeeProfile, Project } from "@/types";
import { assignedEmployees, assignProjectCalendarLanes, dateRange, getProjectStatus, getWeekDays, localDate, projectCoversDay, responsibleForProject, shortDate, statusLabel } from "@/lib/project-utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  data: AppData;
  canPlan: boolean;
  onPlan: (projectId: string) => void;
}

export function ScheduleView({ data, canPlan, onPlan }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [mobileDay, setMobileDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [viewMode, setViewMode] = useState<"employees" | "projects">("employees");
  const [displayMode, setDisplayMode] = useState<"month" | "week">("month");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const days = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    return getWeekDays(base);
  }, [weekOffset]);
  const today = localDate();
  const activeProjects = data.projects.filter((project) => !project.archivedAt && project.startDate && project.endDate);
  const weekStart = localDate(days[0]);
  const weekEnd = localDate(days[6]);
  const weekProjects = activeProjects
    .filter((project) => project.startDate! <= weekEnd && project.endDate! >= weekStart)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!));
  const weekLabel = `${shortDate(localDate(days[0]))} — ${shortDate(localDate(days[6]))}`;
  const monthDate = new Date();
  monthDate.setDate(1);
  monthDate.setMonth(monthDate.getMonth() + monthOffset);
  const monthLabel = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric" }).format(monthDate);
  const monthDays = useMemo(() => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const cellCount = 42;
    return Array.from({ length: cellCount }, (_, index) => new Date(year, month, index - firstWeekday + 1));
  }, [monthOffset]);
  const monthStart = localDate(monthDays[0]);
  const monthEnd = localDate(monthDays[monthDays.length - 1]);
  const calendarProjects = activeProjects.filter((project) => project.startDate! <= monthEnd && project.endDate! >= monthStart);
  const calendarEvents = assignProjectCalendarLanes(calendarProjects);
  const calendarLaneCount = calendarEvents.length ? Math.max(...calendarEvents.map(({ lane }) => lane + 1)) : 0;

  function employeeProjects(employee: EmployeeProfile, day: string) {
    return activeProjects.filter((project) => {
      const assigned = data.assignments.some((assignment) => assignment.employeeId === employee.id && assignment.projectId === project.id);
      return assigned && projectCoversDay(project, day);
    });
  }

  function employeeIntervals(employee: EmployeeProfile) {
    const intervals = activeProjects.flatMap((project) => {
      const assigned = data.assignments.some((assignment) => assignment.employeeId === employee.id && assignment.projectId === project.id);
      if (!assigned) return [];
      const covered = days.map((date, index) => projectCoversDay(project, localDate(date)) ? index : -1).filter((index) => index >= 0);
      return covered.length ? [{ project, start: covered[0], end: covered[covered.length - 1], track: 0 }] : [];
    }).sort((a, b) => a.start - b.start || a.end - b.end);
    const trackEnds: number[] = [];
    return intervals.map((interval) => {
      let track = trackEnds.findIndex((end) => end < interval.start);
      if (track === -1) track = trackEnds.length;
      trackEnds[track] = interval.end;
      return { ...interval, track };
    });
  }

  return (
    <section className="page-stack">
      <div className="page-heading schedule-heading">
        <div>
          <p className="eyebrow">ВИРОБНИЦТВО</p>
          <h1>Графік виробництва</h1>
          <p className="page-subtitle">Об’єкти та завантаження команди за днями</p>
        </div>
        <div className="schedule-heading-actions">
          <div className="schedule-mode-switch schedule-period-switch" role="group" aria-label="Період графіка">
            <button type="button" aria-pressed={displayMode === "month"} className={displayMode === "month" ? "selected" : ""} onClick={() => setDisplayMode("month")}>Місяць</button>
            <button type="button" aria-pressed={displayMode === "week"} className={displayMode === "week" ? "selected" : ""} onClick={() => setDisplayMode("week")}>Тиждень</button>
          </div>
          {displayMode === "month" ? <div className="week-control">
            <button className="icon-button" aria-label="Попередній місяць" onClick={() => setMonthOffset((value) => value - 1)}><ChevronLeft size={18} /></button>
            <div className="week-label"><span>{monthLabel}</span><small>{monthOffset === 0 ? "Цей місяць" : "Місячний графік"}</small></div>
            <button className="icon-button" aria-label="Наступний місяць" onClick={() => setMonthOffset((value) => value + 1)}><ChevronRight size={18} /></button>
            <button className="today-button" onClick={() => setMonthOffset(0)}>Сьогодні</button>
          </div> : <div className="week-control">
            <button className="icon-button" aria-label="Попередній тиждень" onClick={() => setWeekOffset((value) => value - 1)}><ChevronLeft size={18} /></button>
            <div className="week-label"><span>{weekLabel}</span><small>{weekOffset === 0 ? "Цей тиждень" : `${Math.abs(weekOffset)} тиж. ${weekOffset < 0 ? "тому" : "від сьогодні"}`}</small></div>
            <button className="icon-button" aria-label="Наступний тиждень" onClick={() => setWeekOffset((value) => value + 1)}><ChevronRight size={18} /></button>
            <button className="today-button" onClick={() => { setWeekOffset(0); setMobileDay((new Date().getDay() + 6) % 7); }}>Сьогодні</button>
          </div>}
        </div>
      </div>

      <div className="schedule-summary-row">
        <div className="schedule-summary"><span className="summary-dot blue" />Об’єктів сьогодні: {activeProjects.filter((project) => projectCoversDay(project, today)).length}</div>
        <div className="schedule-summary"><span className="summary-dot mint" />Попереду: {activeProjects.filter((project) => project.startDate! > today).length}</div>
        <div className="schedule-summary muted">{displayMode === "month" ? `Об’єктів у місяці: ${activeProjects.filter((project) => project.startDate! <= localDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)) && project.endDate! >= localDate(monthDate)).length}` : viewMode === "projects" ? `Об’єктів у тижні: ${weekProjects.length}` : `Працівників: ${data.employees.length}`}</div>
      </div>

      {displayMode === "month" ? <div className="month-calendar card-surface">
        <div className="month-calendar-weekdays">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((day) => <div key={day}>{day}</div>)}</div>
        <div className="month-calendar-grid">
          {Array.from({ length: monthDays.length / 7 }, (_, weekIndex) => {
            const weekDays = monthDays.slice(weekIndex * 7, weekIndex * 7 + 7);
            const weekStart = localDate(weekDays[0]);
            const weekEnd = localDate(weekDays[6]);
            const weekEvents = calendarEvents.filter(({ project }) => project.startDate! <= weekEnd && project.endDate! >= weekStart);
            return <div className="month-calendar-week" key={weekStart} style={{ gridTemplateRows: `var(--month-day-row, 34px) repeat(${calendarLaneCount}, var(--month-event-row, 25px))` }}>
              {weekDays.map((date) => {
                const dayKey = localDate(date);
                const inMonth = date.getMonth() === monthDate.getMonth();
                return <div key={dayKey} className={`month-calendar-day ${inMonth ? "" : "outside-month"} ${dayKey === today ? "is-today" : ""}`}>
                  <span className="month-calendar-date">{date.getDate()}</span>
                </div>;
              })}
              {weekEvents.map(({ project, lane }) => {
                const startColumn = project.startDate! < weekStart ? 1 : weekDays.findIndex((day) => localDate(day) === project.startDate!) + 1;
                const endIndex = project.endDate! > weekEnd ? 6 : weekDays.findIndex((day) => localDate(day) === project.endDate!);
                const endColumn = endIndex + 2;
                const status = getProjectStatus(project, today);
                const continuesBefore = project.startDate! < weekStart;
                const continuesAfter = project.endDate! > weekEnd;
                return <button type="button" key={`${project.id}-${weekStart}`} className={`month-calendar-event ${status.toLowerCase()} ${continuesBefore ? "continues-before" : ""} ${continuesAfter ? "continues-after" : ""}`} style={{ gridColumn: `${startColumn} / ${endColumn}`, gridRow: lane + 2 }} title={`${project.name} · ${statusLabel[status]}`} aria-label={`${project.name} · ${statusLabel[status]}`} onClick={() => setSelectedProject(project)}>
                  <span className="month-calendar-event-title">{project.name}</span><small>{statusLabel[status]}</small>
                </button>;
              })}
            </div>;
          })}
        </div>
      </div> : <>
      <div className="schedule-desktop card-surface">
        <div className="schedule-mode-switch" role="group" aria-label="Режим графіка">
          <button type="button" aria-pressed={viewMode === "employees"} className={viewMode === "employees" ? "selected" : ""} onClick={() => setViewMode("employees")}>Працівники</button>
          <button type="button" aria-pressed={viewMode === "projects"} className={viewMode === "projects" ? "selected" : ""} onClick={() => setViewMode("projects")}>Об’єкти</button>
        </div>
        <div className="schedule-scroll">
          <div className={`schedule-grid schedule-grid-header ${viewMode === "projects" ? "schedule-project-grid" : ""}`}>
            <div className="schedule-person-head">{viewMode === "projects" ? "Об’єкт" : "Працівник"}</div>
            {days.map((date, index) => {
              const key = localDate(date);
              return <div className={`schedule-day-head ${key === today ? "is-today" : ""}`} key={key}><span>{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"][index]}</span><strong>{date.getDate()}</strong></div>;
            })}
          </div>
          {viewMode === "employees" ? data.employees.map((employee) => {
            const active = employeeProjects(employee, today);
            const intervals = employeeIntervals(employee);
            const trackCount = Math.max(1, ...intervals.map((item) => item.track + 1));
            const nowLabel = active.length > 1 ? "На кількох об’єктах" : active[0] ? `На об’єкті · ${active[0].city}` : "Вільний сьогодні";
            return (
              <div className="schedule-grid schedule-grid-row" style={{ gridTemplateRows: `repeat(${trackCount}, 62px)` }} key={employee.id}>
                <div className="schedule-person" style={{ gridRow: "1 / -1" }}>
                  <span className={`avatar-initial ${employee.type === "FOREMAN" ? "foreman" : ""}`}>{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                  <span className="person-copy"><strong>{employee.name}</strong><small>{employee.type === "FOREMAN" ? "Бригадир" : "Працівник"} · {nowLabel}</small></span>
                </div>
                {days.map((date) => {
                  const key = localDate(date);
                  return <div className={`schedule-cell ${key === today ? "is-today" : ""}`} style={{ gridColumn: days.indexOf(date) + 2, gridRow: "1 / -1" }} key={key} />;
                })}
                {intervals.map(({ project, start, end, track }) => {
                  const creator = data.users.find((user) => user.id === project.creatorId);
                  const status = getProjectStatus(project, today);
                  return <button key={project.id} disabled={!canPlan} title={`${project.name} · ${creator ? `Менеджер: ${creator.name} · ` : ""}${statusLabel[status]}`} className={`schedule-project is-track is-${status.toLowerCase()}`} style={{ gridColumn: `${start + 2} / ${end + 3}`, gridRow: track + 1 }} onClick={() => onPlan(project.id)}>
                    <span className="schedule-project-title">{project.name}</span><span className="schedule-project-city"><MapPin size={12} />{project.city}</span><small className="schedule-project-state">{statusLabel[status]}</small>
                  </button>;
                })}
              </div>
            );
          }) : weekProjects.length ? weekProjects.map((project) => {
            const crew = assignedEmployees(data, project.id);
            const foremen = crew.filter((employee) => employee.type === "FOREMAN");
            const responsible = responsibleForProject(data, project.id);
            const creator = data.users.find((user) => user.id === project.creatorId);
            const status = getProjectStatus(project, today);
            const coveredDays = days.map((date, index) => projectCoversDay(project, localDate(date)) ? index : -1).filter((index) => index >= 0);
            const start = coveredDays[0];
            const end = coveredDays[coveredDays.length - 1];
            const teamNames = crew.map((employee) => employee.name).join(", ");
            return <div className="schedule-grid schedule-grid-row schedule-object-row schedule-project-grid" key={project.id}>
              <div className="schedule-object-meta" style={{ gridRow: "1 / -1" }}>
                <strong>{project.name}</strong>
                <span className="schedule-object-location"><MapPin size={11} />{project.city} · {project.workType}</span>
                <small>Обсяг: {project.volume || "Не вказано"}</small>
                <small>Період: {dateRange(project.startDate, project.endDate)}</small>
                <small className={`schedule-status-note ${status.toLowerCase()}`}>{statusLabel[status]}</small>
                {creator && <small>Менеджер: {creator.name}</small>}
                <small>Команда: {teamNames || "Не призначена"}</small>
                {foremen.length > 0 && <small>Бригадир: {foremen.map((employee) => employee.name).join(", ")}</small>}
                {responsible && <small>Відповідальний: {responsible.name}</small>}
              </div>
              {days.map((date, index) => {
                const key = localDate(date);
                return <div className={`schedule-cell ${key === today ? "is-today" : ""}`} style={{ gridColumn: index + 2, gridRow: "1 / -1" }} key={key} />;
              })}
              <button key={project.id} disabled={!canPlan} title={`${project.name} · ${dateRange(project.startDate, project.endDate)} · ${statusLabel[status]}`} aria-label={canPlan ? `Відкрити планування: ${project.name}` : `${project.name} · ${dateRange(project.startDate, project.endDate)} · ${statusLabel[status]}`} className={`schedule-project is-track is-${status.toLowerCase()} schedule-object-bar`} style={{ gridColumn: `${start + 2} / ${end + 3}`, gridRow: 1 }} onClick={() => onPlan(project.id)}>
                <span>{dateRange(project.startDate, project.endDate)} · {statusLabel[status]}</span>
              </button>
            </div>;
          }) : <div className="schedule-project-empty">На цей тиждень немає запланованих об’єктів</div>}
        </div>
      </div>

      <div className="schedule-mobile">
        <div className="mobile-days" role="tablist" aria-label="Дні тижня">
          {days.map((date, index) => <button className={`mobile-day ${mobileDay === index ? "selected" : ""} ${localDate(date) === today ? "today" : ""}`} key={localDate(date)} onClick={() => setMobileDay(index)}><span>{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"][index]}</span><strong>{date.getDate()}</strong></button>)}
        </div>
        <div className="mobile-agenda">
          {activeProjects.filter((project) => projectCoversDay(project, localDate(days[mobileDay]))).map((project) => {
            const crew = assignedEmployees(data, project.id);
            const foremen = crew.filter((person) => person.type === "FOREMAN");
            const responsible = responsibleForProject(data, project.id);
            const creator = data.users.find((user) => user.id === project.creatorId);
            const status = getProjectStatus(project, today);
            return <button className={`agenda-card ${status.toLowerCase()}`} disabled={!canPlan} key={project.id} onClick={() => onPlan(project.id)}>
              <div className="agenda-card-top"><span className={`status-mark ${status.toLowerCase()}`} />{statusLabel[status]}<span className="agenda-arrow"><ChevronRight size={16} /></span></div>
              <strong>{project.name}</strong><span className="agenda-location"><MapPin size={13} />{project.city} · {project.location}</span>
              <div className="agenda-project-details"><span>{project.workType} · Обсяг: {project.volume || "Не вказано"}</span><span>Період: {dateRange(project.startDate, project.endDate)}</span></div>
              {creator && <div className="agenda-role-line">Менеджер: {creator.name}</div>}
              <div className="agenda-crew-list"><strong>Команда</strong>{crew.length ? <span>{crew.map((person) => person.name).join(", ")}</span> : <span>Не призначена</span>}</div>
              {foremen.length > 0 && <div className="agenda-role-line">Бригадир: {foremen.map((person) => person.name).join(", ")}</div>}
              {responsible && <div className="agenda-role-line">Відповідальний: {responsible.name}</div>}
            </button>;
          })}
          {!activeProjects.some((project) => projectCoversDay(project, localDate(days[mobileDay])) ) && <div className="empty-state compact-empty">На цей день немає призначень</div>}
        </div>
      </div>

      </>}

      <div className="schedule-legend"><span><i className="legend-swatch new" />Новий</span><span><i className="legend-swatch planned" />Заплановано</span><span><i className="legend-swatch completed" />Завершено</span>{canPlan && displayMode === "week" && <span className="legend-note">Натисніть на об’єкт, щоб змінити план</span>}</div>

      <Dialog open={Boolean(selectedProject)} onOpenChange={(open) => { if (!open) setSelectedProject(null); }}>
        <DialogContent className="modal-content project-detail-modal">
          {selectedProject && <>
            <DialogHeader><DialogTitle>{selectedProject.name}</DialogTitle><DialogDescription>{selectedProject.city} · {selectedProject.location}</DialogDescription></DialogHeader>
            <div className="project-detail-modal-fields">
              <div><span>Період</span><strong>{dateRange(selectedProject.startDate, selectedProject.endDate)}</strong></div>
              <div><span>Статус</span><strong>{statusLabel[getProjectStatus(selectedProject, today)]}</strong></div>
              <div><span>Тип робіт</span><strong>{selectedProject.workType}</strong></div>
              <div><span>Обсяг</span><strong>{selectedProject.volume || "Не вказано"}</strong></div>
              <div><span>Менеджер</span><strong>{data.users.find((user) => user.id === selectedProject.creatorId)?.name ?? "Не вказано"}</strong></div>
              <div><span>Команда</span><strong>{assignedEmployees(data, selectedProject.id).map((employee) => employee.name).join(", ") || "Не призначена"}</strong></div>
              <div><span>Відповідальний</span><strong>{responsibleForProject(data, selectedProject.id)?.name ?? "Не призначено"}</strong></div>
              {selectedProject.comment && <div className="project-detail-comment"><span>Коментар</span><strong>{selectedProject.comment}</strong></div>}
            </div>
            {canPlan && <div className="project-detail-modal-actions"><Button type="button" className="primary-shadcn" onClick={() => { const projectId = selectedProject.id; setSelectedProject(null); onPlan(projectId); }}>Змінити план</Button></div>}
          </>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
