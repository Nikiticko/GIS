import { MapPin, Users } from "lucide-react";
import type { AppData, Project } from "@/types";
import { assignedEmployees, dateRange, getEmployeeCurrentProjects, localDate, projectsForEmployee, responsibleForProject, statusLabel } from "@/lib/project-utils";

interface Props {
  data: AppData;
  employeeId: string;
}

export function EmployeeView({ data, employeeId }: Props) {
  const employee = data.employees.find((item) => item.id === employeeId);
  if (!employee) return <div className="empty-state">Профіль працівника не знайдено. Виберіть демо-користувача.</div>;
  const currentProjects = getEmployeeCurrentProjects(data, employee.id);
  const futureProjects = projectsForEmployee(data, employee.id).filter((project) => project.startDate && project.startDate > localDate()).sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

  return <section className="page-stack employee-page">
    <div className="page-heading"><div><p className="eyebrow">МІЙ ГРАФІК</p><h1>Вітаємо, {employee.name.split(" ")[0]}</h1><p className="page-subtitle">Ваші поточні та майбутні об’єкти</p></div></div>
    <div className="employee-status-banner"><span className="presence-dot" /><div><strong>{currentProjects.length > 1 ? "На кількох об’єктах" : currentProjects[0] ? `На об’єкті · ${currentProjects[0].city}` : "Вільний сьогодні"}</strong><small>Зайнятість за планом</small></div></div>
    <section className="employee-section"><div className="section-title-row"><span className="status-mark planned" /><h2>Сьогодні</h2><span className="section-count">{currentProjects.length}</span></div>
      {currentProjects.length ? <div className="employee-project-list">{currentProjects.map((project) => <EmployeeProjectCard key={project.id} project={project} data={data} employeeId={employee.id} />)}</div> : <div className="empty-state">На сьогодні у вас немає запланованих об’єктів</div>}
    </section>
    <section className="employee-section"><div className="section-title-row"><span className="status-mark planned" /><h2>Далі за графіком</h2><span className="section-count">{futureProjects.length}</span></div>
      {futureProjects.length ? <div className="employee-project-list">{futureProjects.map((project) => <EmployeeProjectCard key={project.id} project={project} data={data} employeeId={employee.id} />)}</div> : <div className="empty-state">Майбутніх призначень поки немає</div>}
    </section>
  </section>;
}

function EmployeeProjectCard({ project, data, employeeId }: { project: Project; data: AppData; employeeId: string }) {
  const status = project.status;
  const team = assignedEmployees(data, project.id);
  const responsible = responsibleForProject(data, project.id);
  const creator = data.users.find((user) => user.id === project.creatorId);
  return <article className={`employee-project-card ${status.toLowerCase()}`}><div className="employee-project-top"><span className={`status-pill ${status.toLowerCase()}`}>{statusLabel[status]}</span></div>
    <h3>{project.name}</h3><p className="employee-project-location"><MapPin size={14} />{project.city} · {project.location}</p>{creator && <p className="employee-project-work">Менеджер: {creator.name}</p>}<p className="employee-project-work">{project.workType}{project.volume && ` · ${project.volume}`}</p><p className="employee-project-date">{dateRange(project.startDate, project.endDate)}</p><div className="employee-project-divider" />
    <div className="employee-team-info"><span><Users size={14} />Команда</span><div>{team.map((member) => <small key={member.id} className={member.id === employeeId ? "self-member" : ""}>{member.name.split(" ")[0]}{member.id === employeeId ? " · ви" : ""}</small>)}</div></div>
    <div className="employee-responsible"><span>Відповідальний</span><strong>{responsible?.name ?? "Не призначено"}</strong></div>
  </article>;
}
