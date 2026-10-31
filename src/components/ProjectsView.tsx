import { Archive, CalendarDays, ChevronRight, MapPin, Plus, RotateCcw, UserRound, Users } from "lucide-react";
import type { AppData, Project, ProjectStatus } from "@/types";
import { assignedEmployees, dateRange, getProjectStatus, localDate, responsibleForProject, statusLabel } from "@/lib/project-utils";

interface Props {
  data: AppData;
  userId: string;
  canPlan: boolean;
  canCreate: boolean;
  canArchive: boolean;
  isTrash: boolean;
  onCreate: () => void;
  onPlan: (projectId: string) => void;
  onArchive: (project: Project) => void;
  onRestore: (projectId: string) => void;
}

export function ProjectsView({ data, userId, canPlan, canCreate, canArchive, isTrash, onCreate, onPlan, onArchive, onRestore }: Props) {
  const visibleProjects = data.projects.filter((project) => (canPlan || project.creatorId === userId) && Boolean(project.archivedAt) === isTrash);
  const today = localDate();
  const groups = isTrash
    ? [{ key: "TRASH", label: "У кошику", className: "history", projects: visibleProjects }]
    : [
        { key: "NEW", label: statusLabel.NEW, className: "new", projects: visibleProjects.filter((project) => getProjectStatus(project, today) === "NEW") },
        { key: "PLANNED", label: statusLabel.PLANNED, className: "planned", projects: visibleProjects.filter((project) => getProjectStatus(project, today) === "PLANNED") },
        { key: "COMPLETED", label: statusLabel.COMPLETED, className: "completed", projects: visibleProjects.filter((project) => getProjectStatus(project, today) === "COMPLETED") },
      ];

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div><p className="eyebrow">{isTrash ? "КОШИК" : "ОБ’ЄКТИ"}</p><h1>{isTrash ? "Кошик" : "Об’єкти"}</h1><p className="page-subtitle">{isTrash ? "Об’єкти зберігаються тут, доки їх не відновлять" : "Усі виробничі завдання в одному місці"}</p></div>
        {canCreate && !isTrash && <button className="primary-button" onClick={onCreate}><Plus size={17} />Новий об’єкт</button>}
      </div>
      {!isTrash && <div className="project-status-summary">
        {groups.map(({ key, label, className, projects }) => <div className={`status-summary-tile ${className}`} key={key}><span>{label}</span><strong>{projects.length}</strong></div>)}
      </div>}
      {groups.map(({ key, label, className, projects }) => <section className="project-section" key={key}>
        <div className="section-title-row"><div className={`status-mark ${className}`} /><h2>{label}</h2><span className="section-count">{projects.length}</span></div>
        {projects.length ? <div className="project-card-list">{projects.map((project) => <ProjectCard key={project.id} project={project} data={data} canPlan={canPlan && !isTrash} canArchive={canArchive} archived={isTrash} onPlan={onPlan} onArchive={onArchive} onRestore={onRestore} />)}</div> : <div className="empty-state">{isTrash ? "Кошик порожній" : "У цьому розділі поки немає об’єктів"}</div>}
      </section>)}
    </section>
  );
}

function ProjectCard({ project, data, canPlan, canArchive, archived, onPlan, onArchive, onRestore }: { project: Project; data: AppData; canPlan: boolean; canArchive: boolean; archived: boolean; onPlan: (id: string) => void; onArchive: (project: Project) => void; onRestore: (id: string) => void }) {
  const status: ProjectStatus = getProjectStatus(project);
  const crew = assignedEmployees(data, project.id);
  const responsible = responsibleForProject(data, project.id);
  const creator = data.users.find((user) => user.id === project.creatorId);
  const canOpenPlan = canPlan;
  const label = archived ? "У кошику" : statusLabel[status];
  return <article className="project-card">
    <div className="project-card-main">
      <div className="project-card-title-row"><h3>{project.name}</h3><span className={`status-pill ${archived ? "history" : status.toLowerCase()}`}>{label}</span></div>
      <div className="project-meta"><span><MapPin size={14} />{project.city} · {project.location}</span><span><CalendarDays size={14} />{dateRange(project.startDate, project.endDate)}</span>{creator && <span><UserRound size={14} />Менеджер: {creator.name}</span>}</div>
      <div className="project-detail-row"><span>{project.workType}</span>{project.volume && <b>{project.volume}</b>}</div>
    </div>
    <div className="project-card-footer">
      <div className="project-team-line"><Users size={15} /><span>{crew.length ? crew.map((employee) => employee.name.split(" ")[0]).join(", ") : "Команду не призначено"}</span>{responsible && <small>Відповідальний: {responsible.name.split(" ")[0]}</small>}</div>
      {canOpenPlan && <button className="text-action" onClick={() => onPlan(project.id)}>{status === "NEW" ? "Запланувати" : "Змінити план"}<ChevronRight size={16} /></button>}
      {canArchive && (archived
        ? <button className="text-action" onClick={() => onRestore(project.id)}><RotateCcw size={15} />Відновити</button>
        : <button className="text-action" onClick={() => onArchive(project)}><Archive size={15} />До кошика</button>)}
    </div>
  </article>;
}
