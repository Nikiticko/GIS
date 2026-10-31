import { BriefcaseBusiness, MapPin, UserRound } from "lucide-react";
import type { AppData } from "@/types";
import { getEmployeeCurrentProjects, localDate, projectsForEmployee, statusLabel } from "@/lib/project-utils";

export function TeamView({ data }: { data: AppData }) {
  const employees = data.employees.map((employee) => {
    const current = getEmployeeCurrentProjects(data, employee.id);
    const upcoming = projectsForEmployee(data, employee.id).filter((project) => project.startDate && project.startDate > localDate()).sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
    return { employee, current, upcoming };
  });

  return <section className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">КОМАНДА</p><h1>Працівники</h1><p className="page-subtitle">Зайнятість сьогодні та найближчі призначення</p></div><div className="team-count"><UserRound size={16} />Працівників: {data.employees.length}</div></div>
    <div className="team-grid">{employees.map(({ employee, current, upcoming }) => <article className="employee-card" key={employee.id}>
      <div className="employee-card-head"><span className={`avatar-initial large ${employee.type === "FOREMAN" ? "foreman" : ""}`}>{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><h3>{employee.name}</h3><p>{employee.type === "FOREMAN" ? "Бригадир" : "Працівник виробництва"}</p></div></div>
      <div className={`employee-presence ${current.length ? "is-working" : "is-free"}`}><span className="presence-dot" />{current.length ? current.length > 1 ? "На кількох об’єктах" : `На об’єкті · ${current[0].city}` : "Вільний сьогодні"}</div>
      <div className="employee-projects"><div className="employee-project-block"><span className="block-label"><BriefcaseBusiness size={13} />СЬОГОДНІ</span>{current.length ? current.map((project) => {
        const creator = data.users.find((user) => user.id === project.creatorId);
        return <div className="employee-job" key={project.id}><strong>{project.name}</strong><small><MapPin size={12} />{project.city} · {statusLabel.PLANNED}</small>{creator && <small>Менеджер: {creator.name}</small>}</div>;
      }) : <p className="light-empty">Сьогодні немає призначень</p>}</div>
        <div className="employee-project-block"><span className="block-label">ДАЛІ</span>{upcoming.length ? upcoming.slice(0, 2).map((project) => {
          const creator = data.users.find((user) => user.id === project.creatorId);
          return <div className="employee-job upcoming-job" key={project.id}><strong>{project.name}</strong><small><MapPin size={12} />{project.city} · {project.startDate}</small>{creator && <small>Менеджер: {creator.name}</small>}</div>;
        }) : <p className="light-empty">Немає нових призначень</p>}</div></div>
    </article>)}</div>
  </section>;
}
