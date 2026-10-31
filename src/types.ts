export type UserRole = "MANAGER" | "PRODUCTION_HEAD" | "PRODUCTION_EMPLOYEE";
export type EmployeeType = "WORKER" | "FOREMAN";
export type ProjectStatus = "NEW" | "PLANNED" | "COMPLETED";
export type VehicleId = "RENAULT" | "OPEL" | "VOLKSWAGEN" | "IVECO";

export const vehicles: { id: VehicleId; name: string }[] = [
  { id: "RENAULT", name: "Renault" },
  { id: "OPEL", name: "Opel" },
  { id: "VOLKSWAGEN", name: "Volkswagen" },
  { id: "IVECO", name: "Iveco" },
];

export interface DemoUser {
  id: string;
  name: string;
  role: UserRole;
  employeeId?: string;
}

export interface EmployeeProfile {
  id: string;
  userId: string;
  name: string;
  type: EmployeeType;
}

export interface Project {
  id: string;
  name: string;
  location: string;
  city: string;
  workType: string;
  volume: string;
  comment: string;
  status: ProjectStatus;
  vehicleId: VehicleId | null;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  creatorId: string;
}

export interface ProjectAssignment {
  id: string;
  projectId: string;
  employeeId: string;
  isResponsible: boolean;
}

export interface AppData {
  users: DemoUser[];
  employees: EmployeeProfile[];
  projects: Project[];
  assignments: ProjectAssignment[];
}

export type Screen = "schedule" | "projects" | "trash" | "team";
