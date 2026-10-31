import type { AppData, DemoUser, EmployeeProfile, Project, ProjectAssignment, VehicleId } from "@/types";
import { createDemoData, demoIds } from "@/lib/demo-data";
import { getProjectStatus } from "@/lib/project-utils";
import { supabase } from "@/lib/supabase";

const storageKey = "gis-production-schedule-demo:v1";

type Row = Record<string, string | boolean | null>;

function readLocalData(): AppData {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const data = JSON.parse(raw) as AppData;
      const seededManagers = createDemoData().users.filter((user) => demoIds.testManagers.includes(user.id));
      const users = [...data.users, ...seededManagers.filter((manager) => !data.users.some((user) => user.id === manager.id))];
      return localizeLegacyDemoData({ ...data, users, projects: normalizeProjects(data.projects) });
    }
  } catch {
    localStorage.removeItem(storageKey);
  }
  const initial = createDemoData();
  localStorage.setItem(storageKey, JSON.stringify(initial));
  return initial;
}

function localizeLegacyDemoData(data: AppData): AppData {
  const employeeNames = new Map([
    [demoIds.profiles[0], ["Иван Петров", "Іван Петренко"]],
    [demoIds.profiles[1], ["Ольга Смирнова", "Ольга Кравченко"]],
    [demoIds.profiles[2], ["Алексей Кузнецов", "Олексій Коваль"]],
    [demoIds.profiles[3], ["Мария Волкова", "Марія Вовк"]],
    [demoIds.profiles[4], ["Сергей Морозов", "Сергій Мороз"]],
    [demoIds.profiles[5], ["Екатерина Новикова", "Катерина Новікова"]],
  ]);
  const translatedName = (id: string, name: string) => {
    const legacy = employeeNames.get(id);
    return legacy?.[0] === name ? legacy[1] : name;
  };
  const projects = new Map([
    [demoIds.projects[0], { name: ["Монтаж освещения — БЦ Север", "Монтаж освітлення — БЦ Північний"], location: ["ул. Дегтярёвская, 21", "вул. Дегтярівська, 21"], city: ["Киев", "Київ"], workType: ["Монтаж электрики", "Монтаж електрики"], comment: ["Согласовать доступ к щитовой", "Погодити доступ до електрощитової"] }],
    [demoIds.projects[1], { name: ["Геодезическая съёмка — ЖК Ривер", "Геодезичне знімання — ЖК Рівер"], location: ["Набережно-Рыбальская, 3", "Набережно-Рибальська, 3"], city: ["Киев", "Київ"], workType: ["Геодезическая съёмка", "Геодезичне знімання"], comment: ["Въезд со стороны набережной", "В’їзд з боку набережної"] }],
    [demoIds.projects[2], { name: ["Обследование фасада — корпус В", "Обстеження фасаду — корпус В"], location: ["ул. Садовая, 18", "вул. Садова, 18"], city: ["Бровары", "Бровари"], workType: ["Техническое обследование", "Технічне обстеження"], comment: ["Нужен подъёмник", "Потрібен підіймач"] }],
    [demoIds.projects[3], { name: ["Складской комплекс — этап 2", "Складський комплекс — етап 2"], location: ["ул. Промышленная, 5", "вул. Промислова, 5"], city: ["Вишнёвое", "Вишневе"], workType: ["Разметка инженерных сетей", "Розмітка інженерних мереж"], comment: ["Сверить результаты разметки", "Звірити результати розмітки"] }],
    [demoIds.projects[4], { name: ["Проверка площадки — логистический центр", "Перевірка майданчика — логістичний центр"], location: ["Окружная дорога, 10", "Окружна дорога, 10"], city: ["Киев", "Київ"], workType: ["Контроль геометрии", "Контроль геометрії"], comment: ["Проверить отметки перед заливкой", "Перевірити відмітки перед заливанням"] }],
  ]);

  return {
    ...data,
    users: data.users.map((user) => ({ ...user, name: user.employeeId ? translatedName(user.employeeId, user.name) : user.name === "Дмитрий Левченко" ? "Дмитро Левченко" : user.name })),
    employees: data.employees.map((employee) => ({ ...employee, name: translatedName(employee.id, employee.name) })),
    projects: data.projects.map((project) => {
      const legacy = projects.get(project.id);
      if (!legacy) return project;
      const replace = (value: string, pair: string[]) => value === pair[0] ? pair[1] : value;
      return { ...project, name: replace(project.name, legacy.name), location: replace(project.location, legacy.location), city: replace(project.city, legacy.city), workType: replace(project.workType, legacy.workType), comment: replace(project.comment, legacy.comment) };
    }),
  };
}

function normalizeProjects(projects: Project[]): Project[] {
  return projects.map((project) => ({
    ...project,
    vehicleId: project.vehicleId ?? null,
    status: getProjectStatus(project),
    archivedAt: project.archivedAt ?? null,
  }));
}

export function saveLocalData(data: AppData) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

export async function loadAppData(): Promise<{ data: AppData; source: "supabase" | "local" }> {
  if (!supabase) return { data: readLocalData(), source: "local" };

  const [userResult, employeeResult, projectResult, assignmentResult] = await Promise.all([
    supabase.from("demo_users").select("id,name,role"),
    supabase.from("employee_profiles").select("id,user_id,name,type"),
    supabase.from("projects").select("id,name,location,city,work_type,volume,notes,status,start_date,end_date,vehicle_id,archived_at,creator_id"),
    supabase.from("project_assignments").select("id,project_id,employee_id,is_responsible"),
  ]);

  const error = userResult.error || employeeResult.error || projectResult.error || assignmentResult.error;
  if (error) throw error;
  if (!userResult.data?.length || !employeeResult.data?.length || !projectResult.data?.length) {
    return { data: readLocalData(), source: "local" };
  }

  const employees: EmployeeProfile[] = (employeeResult.data as Row[]).map((row) => ({
    id: String(row.id), userId: String(row.user_id), name: String(row.name), type: row.type as EmployeeProfile["type"],
  }));
  const employeeIdByUser = new Map(employees.map((employee) => [employee.userId, employee.id]));
  const users: DemoUser[] = (userResult.data as Row[]).map((row) => ({
    id: String(row.id), name: String(row.name), role: row.role as DemoUser["role"],
    employeeId: employeeIdByUser.get(String(row.id)),
  }));
  const projects: Project[] = (projectResult.data as Row[]).map((row) => ({
    id: String(row.id), name: String(row.name), location: String(row.location), city: String(row.city),
    workType: String(row.work_type), volume: String(row.volume), comment: String(row.notes ?? ""),
    status: row.status as Project["status"],
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    vehicleId: row.vehicle_id ? String(row.vehicle_id) as VehicleId : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    creatorId: String(row.creator_id),
  }));
  const assignments: ProjectAssignment[] = (assignmentResult.data as Row[]).map((row) => ({
    id: String(row.id), projectId: String(row.project_id), employeeId: String(row.employee_id),
    isResponsible: Boolean(row.is_responsible),
  }));

  const data = localizeLegacyDemoData({ users, employees, projects: normalizeProjects(projects), assignments });
  saveLocalData(data);
  return { data, source: "supabase" };
}

export async function insertProject(project: Project, useRemote: boolean) {
  if (!supabase || !useRemote) return;
  const { error } = await supabase.from("projects").insert({
    id: project.id, name: project.name, location: project.location, city: project.city,
    work_type: project.workType, volume: project.volume, notes: project.comment, status: project.status,
    start_date: project.startDate, end_date: project.endDate, archived_at: project.archivedAt, creator_id: project.creatorId,
  });
  if (error) throw error;
}

export async function archiveProject(projectId: string, archivedAt: string, useRemote: boolean) {
  if (!supabase || !useRemote) return;
  const { error, data } = await supabase.from("projects").update({ archived_at: archivedAt })
    .eq("id", projectId).is("archived_at", null).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Об’єкт уже переміщено до кошика або не знайдено.");
}

export async function restoreProject(projectId: string, useRemote: boolean) {
  if (!supabase || !useRemote) return;
  const { error, data } = await supabase.from("projects").update({ archived_at: null })
    .eq("id", projectId).not("archived_at", "is", null).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Об’єкт уже відновлено або не знайдено.");
}

export async function saveProjectPlan(project: Project, employeeIds: string[], responsibleId: string, vehicleId: VehicleId, useRemote: boolean) {
  if (!supabase || !useRemote) return;
  const { error } = await supabase.rpc("save_project_plan", {
    p_project_id: project.id,
    p_start_date: project.startDate,
    p_end_date: project.endDate,
    p_employee_ids: employeeIds,
    p_responsible_employee_id: responsibleId,
    p_vehicle_id: vehicleId,
  });
  if (error) throw error;
}

export function createId() {
  return crypto.randomUUID();
}

