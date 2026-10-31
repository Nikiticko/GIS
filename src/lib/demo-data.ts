import type { AppData } from "@/types";
import { addDays, getProjectStatus } from "@/lib/project-utils";

const ids = {
  manager: "10000000-0000-4000-8000-000000000001",
  testManagers: [
    "10000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000004",
  ],
  head: "10000000-0000-4000-8000-000000000002",
  employees: [
    "10000000-0000-4000-8000-000000000101",
    "10000000-0000-4000-8000-000000000102",
    "10000000-0000-4000-8000-000000000103",
    "10000000-0000-4000-8000-000000000104",
    "10000000-0000-4000-8000-000000000105",
    "10000000-0000-4000-8000-000000000106",
  ],
  profiles: [
    "20000000-0000-4000-8000-000000000101",
    "20000000-0000-4000-8000-000000000102",
    "20000000-0000-4000-8000-000000000103",
    "20000000-0000-4000-8000-000000000104",
    "20000000-0000-4000-8000-000000000105",
    "20000000-0000-4000-8000-000000000106",
  ],
  projects: [
    "30000000-0000-4000-8000-000000000101",
    "30000000-0000-4000-8000-000000000102",
    "30000000-0000-4000-8000-000000000103",
    "30000000-0000-4000-8000-000000000104",
    "30000000-0000-4000-8000-000000000105",
  ],
};

export const demoIds = ids;

export function createDemoData(): AppData {
  const names = ["Іван Петренко", "Ольга Кравченко", "Олексій Коваль", "Марія Вовк", "Сергій Мороз", "Катерина Новікова"];
  const employees = names.map((name, index) => ({
    id: ids.profiles[index],
    userId: ids.employees[index],
    name,
    type: index % 3 === 0 ? "FOREMAN" as const : "WORKER" as const,
  }));

  return {
    users: [
      { id: ids.manager, name: "Анна Коваленко", role: "MANAGER" },
      { id: ids.testManagers[0], name: "Марія Бондар", role: "MANAGER" },
      { id: ids.testManagers[1], name: "Олександр Мельник", role: "MANAGER" },
      { id: ids.head, name: "Дмитро Левченко", role: "PRODUCTION_HEAD" },
      ...employees.map((employee) => ({ id: employee.userId, name: employee.name, role: "PRODUCTION_EMPLOYEE" as const, employeeId: employee.id })),
    ],
    employees,
    projects: [
      {
        id: ids.projects[0], name: "Монтаж освітлення — БЦ Північний", location: "вул. Дегтярівська, 21", city: "Київ",
        workType: "Монтаж електрики", volume: "1 240 м²", comment: "Погодити доступ до електрощитової",
        status: getProjectStatus({ status: "PLANNED", endDate: addDays(-2) }), startDate: addDays(-4), endDate: addDays(-2), vehicleId: null, archivedAt: null, creatorId: ids.manager,
      },
      {
        id: ids.projects[1], name: "Геодезичне знімання — ЖК Рівер", location: "Набережно-Рибальська, 3", city: "Київ",
        workType: "Геодезичне знімання", volume: "3 секції", comment: "В’їзд з боку набережної",
        status: "PLANNED", startDate: addDays(1), endDate: addDays(4), vehicleId: null, archivedAt: null, creatorId: ids.manager,
      },
      {
        id: ids.projects[2], name: "Обстеження фасаду — корпус В", location: "вул. Садова, 18", city: "Бровари",
        workType: "Технічне обстеження", volume: "860 м²", comment: "Потрібен підіймач",
        status: "NEW", startDate: addDays(3), endDate: addDays(5), vehicleId: null, archivedAt: null, creatorId: ids.manager,
      },
      {
        id: ids.projects[3], name: "Складський комплекс — етап 2", location: "вул. Промислова, 5", city: "Вишневе",
        workType: "Розмітка інженерних мереж", volume: "2 100 м²", comment: "Звірити результати розмітки",
        status: getProjectStatus({ status: "PLANNED", endDate: addDays(-10) }), startDate: addDays(-12), endDate: addDays(-10), vehicleId: null, archivedAt: null, creatorId: ids.manager,
      },
      {
        id: ids.projects[4], name: "Перевірка майданчика — логістичний центр", location: "Окружна дорога, 10", city: "Київ",
        workType: "Контроль геометрії", volume: "4 зони", comment: "Перевірити відмітки перед заливанням",
        status: "PLANNED", startDate: addDays(6), endDate: addDays(8), vehicleId: null, archivedAt: null, creatorId: ids.manager,
      },
    ],
    assignments: [
      { id: "40000000-0000-4000-8000-000000000101", projectId: ids.projects[0], employeeId: employees[0].id, isResponsible: true },
      { id: "40000000-0000-4000-8000-000000000102", projectId: ids.projects[0], employeeId: employees[1].id, isResponsible: false },
      { id: "40000000-0000-4000-8000-000000000103", projectId: ids.projects[0], employeeId: employees[2].id, isResponsible: false },
      { id: "40000000-0000-4000-8000-000000000104", projectId: ids.projects[1], employeeId: employees[1].id, isResponsible: true },
      { id: "40000000-0000-4000-8000-000000000105", projectId: ids.projects[1], employeeId: employees[3].id, isResponsible: false },
      { id: "40000000-0000-4000-8000-000000000106", projectId: ids.projects[4], employeeId: employees[4].id, isResponsible: true },
      { id: "40000000-0000-4000-8000-000000000107", projectId: ids.projects[4], employeeId: employees[5].id, isResponsible: false },
      { id: "40000000-0000-4000-8000-000000000108", projectId: ids.projects[3], employeeId: employees[2].id, isResponsible: true },
      { id: "40000000-0000-4000-8000-000000000109", projectId: ids.projects[3], employeeId: employees[4].id, isResponsible: false },
    ],
  };
}
