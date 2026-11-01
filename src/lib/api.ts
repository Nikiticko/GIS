export type Role = "ADMIN" | "MANAGER" | "PRODUCTION_HEAD" | "PRODUCTION_EMPLOYEE";
export type Status = "NEW" | "PLANNED" | "IN_PROGRESS" | "COMPLETED";
export interface CurrentUser { id: string; name: string; role: Role }
export interface User extends CurrentUser { phone: string | null; active: boolean; foreman: boolean; keyCode: string; updatedAt: string }
export interface Employee { id: string; name: string; phone: string | null; active: boolean; foreman: boolean }
export interface WorkType { id: string; name: string; active: boolean }
export interface Vehicle { id: string; name: string; registration: string; active: boolean }
export interface Project {
  id: string; name: string; managerId: string; creatorId: string; workTypeId: string;
  address: string | null; gps: string | null; volume: string | null; information: string | null;
  desiredStart: string | null; desiredEnd: string | null; plannedStart: string | null; plannedEnd: string | null;
  archivedAt: string | null; createdAt: string; updatedAt: string;
}
export interface ProjectRow { project: Project; workTypeName: string; status: Status }
export interface ProjectDetail extends ProjectRow {
  managerName: string;
  team: { id: string; name: string; phone: string | null; responsible: boolean }[];
  vehicles: Pick<Vehicle, "id" | "name" | "registration">[];
}
export interface Attachment { id: string; projectId: string; uploaderId: string; name: string; contentType: string; size: number; createdAt: string }
export interface Notification { id: string; type: string; projectId: string | null; projectName: string | null; subjectName: string | null; createdAt: string; readAt: string | null }
export interface AuditEntry { id: string; actorId: string; entityType: string; entityId: string; action: string; field: string | null; oldValue: string | null; newValue: string | null; createdAt: string }
export interface Conflict { resourceId: string; resourceName: string; projectId: string; projectName: string; overlapStart: string; overlapEnd: string }
export interface Conflicts { employees: Conflict[]; vehicles: Conflict[] }
export interface Plan { start: string; end: string; employeeIds: string[]; responsibleId: string; vehicleIds: string[]; confirmConflicts: boolean; expectedUpdatedAt: string }
export type ProjectValues = Pick<Project, "name" | "workTypeId" | "address" | "gps" | "volume" | "information" | "desiredStart" | "desiredEnd"> & { managerId?: string };

export class ApiError extends Error {
  constructor(public status: number, message: string, public conflicts?: Conflicts) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, credentials: "same-origin", headers: options.body instanceof FormData ? options.headers : { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  } catch {
    throw new ApiError(0, "Не вдалося з’єднатися із сервером.");
  }
  if (!response.ok) {
    let data: { error?: string; conflicts?: Conflicts } = {};
    try { data = await response.json() as typeof data; } catch { /* server may be unavailable */ }
    throw new ApiError(response.status, data.error || "Не вдалося виконати запит.", data.conflicts);
  }
  return response.json() as Promise<T>;
}
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  me: () => request<CurrentUser>("/auth/me"),
  login: (code: string) => request<CurrentUser>("/auth/login", json("POST", { code })),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  users: () => request<User[]>("/users"),
  createUser: (values: { name: string; role: Exclude<Role, "ADMIN">; phone?: string | null; foreman?: boolean }) => request<User>("/users", json("POST", values)),
  updateUser: (id: string, values: Partial<Pick<User, "name" | "phone" | "foreman" | "active"> & { role: Exclude<Role, "ADMIN"> }> & { expectedUpdatedAt?: string }) => request<User>(`/users/${id}`, json("PATCH", values)),
  revokeSessions: (id: string) => request<{ ok: boolean }>(`/users/${id}/sessions/revoke`, { method: "POST" }),
  reissueKey: (id: string) => request<{ keyCode: string }>(`/users/${id}/key-code/reissue`, { method: "POST" }),
  employees: () => request<Employee[]>("/employees"),
  workTypes: () => request<WorkType[]>("/work-types"),
  createWorkType: (name: string) => request<WorkType>("/work-types", json("POST", { name })),
  updateWorkType: (id: string, active: boolean, expectedActive?: boolean) => request<WorkType>(`/work-types/${id}`, json("PATCH", { active, expectedActive })),
  vehicles: () => request<Vehicle[]>("/vehicles"),
  createVehicle: (name: string, registration: string) => request<Vehicle>("/vehicles", json("POST", { name, registration })),
  updateVehicle: (id: string, values: Partial<Pick<Vehicle, "name" | "registration" | "active">> & { expected?: Pick<Vehicle, "name" | "registration" | "active"> }) => request<Vehicle>(`/vehicles/${id}`, json("PATCH", values)),
  projects: (scope: "own" | "schedule" | "archive" = "own") => request<ProjectRow[]>(`/projects?scope=${scope}`),
  project: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  createProject: (values: ProjectValues) => request<Project>("/projects", json("POST", values)),
  updateProject: (id: string, values: Partial<ProjectValues> & { expectedUpdatedAt?: string }) => request<Project>(`/projects/${id}`, json("PATCH", values)),
  archiveProject: (id: string) => request<{ ok: boolean }>(`/projects/${id}/archive`, { method: "POST" }),
  savePlan: (id: string, plan: Plan) => request<{ ok: boolean; conflicts: Conflicts }>(`/projects/${id}/planning`, json("PUT", plan)),
  attachments: (id: string) => request<Attachment[]>(`/projects/${id}/attachments`),
  upload: (id: string, file: File) => { const form = new FormData(); form.append("file", file); return request<Attachment>(`/projects/${id}/attachments`, { method: "POST", body: form }); },
  attachmentUrl: (id: string, fileId: string) => `/api/projects/${id}/attachments/${fileId}`,
  deleteAttachment: (id: string, fileId: string) => request<{ ok: boolean }>(`/projects/${id}/attachments/${fileId}`, { method: "DELETE" }),
  audit: () => request<AuditEntry[]>("/audit"),
  notifications: () => request<Notification[]>("/notifications"),
  markRead: (id: string) => request<{ id: string }>(`/notifications/${id}/read`, { method: "POST" }),
};
