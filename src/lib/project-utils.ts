import type { AppData, EmployeeProfile, Project, ProjectAssignment, ProjectStatus, VehicleId } from "@/types";

export function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dayOffset: number, base = new Date()) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  date.setDate(date.getDate() + dayOffset);
  return localDate(date);
}

export function getProjectStatus(project: Pick<Project, "status" | "endDate">, today = localDate()): ProjectStatus {
  if (project.status === "PLANNED" && project.endDate && project.endDate < today) return "COMPLETED";
  return project.status;
}

export function rangesOverlap(start: string, end: string, project: Project) {
  return Boolean(project.startDate && project.endDate && start <= project.endDate && end >= project.startDate);
}

export function projectCoversDay(project: Project, day: string) {
  return Boolean(project.startDate && project.endDate && project.startDate <= day && day <= project.endDate);
}

export function isValidProjectDateRange(start: string, end: string) {
  return Boolean(start && end && end >= start);
}

export function assignProjectCalendarLanes<T extends Pick<Project, "startDate" | "endDate">>(projects: T[]) {
  const laneEnds: string[] = [];
  return [...projects]
    .filter((project): project is T & { startDate: string; endDate: string } => Boolean(project.startDate && project.endDate))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate))
    .map((project) => {
      let lane = laneEnds.findIndex((end) => end < project.startDate);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = project.endDate;
      return { project, lane };
    });
}

export function assignmentsForProject(assignments: ProjectAssignment[], projectId: string) {
  return assignments.filter((assignment) => assignment.projectId === projectId);
}

export function projectsForEmployee(data: AppData, employeeId: string) {
  const ids = new Set(data.assignments.filter((a) => a.employeeId === employeeId).map((a) => a.projectId));
  return data.projects.filter((project) => !project.archivedAt && ids.has(project.id));
}

export function responsibleForProject(data: AppData, projectId: string) {
  const assignment = data.assignments.find((item) => item.projectId === projectId && item.isResponsible);
  return data.employees.find((employee) => employee.id === assignment?.employeeId);
}

export function assignedEmployees(data: AppData, projectId: string) {
  const ids = assignmentsForProject(data.assignments, projectId).map((a) => a.employeeId);
  return data.employees.filter((employee) => ids.includes(employee.id));
}

export function getEmployeeCurrentProjects(data: AppData, employeeId: string, today = localDate()) {
  return projectsForEmployee(data, employeeId).filter((project) => projectCoversDay(project, today));
}

export function getEmployeeAvailability(
  data: AppData,
  employee: EmployeeProfile,
  start: string,
  end: string,
  excludedProjectId?: string,
) {
  return data.projects.filter((project) => {
    if (project.id === excludedProjectId || project.status === "NEW" || project.archivedAt) return false;
    if (!rangesOverlap(start, end, project)) return false;
    return data.assignments.some((assignment) => assignment.projectId === project.id && assignment.employeeId === employee.id);
  });
}

export function getVehicleAvailability(
  data: AppData,
  vehicleId: VehicleId,
  start: string,
  end: string,
  excludedProjectId?: string,
) {
  return data.projects.filter((project) => {
    if (project.id === excludedProjectId || project.status === "NEW" || project.archivedAt) return false;
    if (project.vehicleId !== vehicleId || !rangesOverlap(start, end, project)) return false;
    return true;
  });
}

export function shortDate(value: string | null) {
  if (!value) return "Дату не вказано";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "Дату не вказано";
}

export function dateRange(start: string | null, end: string | null) {
  if (!start || !end) return "Терміни не вказано";
  return `${shortDate(start)} — ${shortDate(end)}`;
}

export function getWeekDays(base = new Date()) {
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const weekday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - weekday);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });
}

export function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export const statusLabel: Record<ProjectStatus, string> = {
  NEW: "Новий",
  PLANNED: "Заплановано",
  COMPLETED: "Завершено",
};
