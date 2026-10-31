import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, Check, CircleAlert, ClipboardList, HardHat, Plus, Users, X } from "lucide-react";
import type { AppData, Project, Screen, VehicleId } from "@/types";
import { createDemoData } from "@/lib/demo-data";
import { archiveProject, createId, insertProject, loadAppData, restoreProject, saveLocalData, saveProjectPlan } from "@/lib/data";
import { localDate } from "@/lib/project-utils";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ScheduleView } from "@/components/ScheduleView";
import { ProjectsView } from "@/components/ProjectsView";
import { TeamView } from "@/components/TeamView";
import { EmployeeView } from "@/components/EmployeeView";
import { ArchiveProjectDialog, CreateProjectDialog, PlanProjectDialog, type NewProjectValues } from "@/components/ProjectDialogs";

export default function App() {
  const [data, setData] = useState<AppData>(() => createDemoData());
  const [screen, setScreen] = useState<Screen>("schedule");
  const [currentUserId, setCurrentUserId] = useState("10000000-0000-4000-8000-000000000002");
  const [remoteActive, setRemoteActive] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [today, setToday] = useState(() => localDate());
  const [notice, setNotice] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [planningProjectId, setPlanningProjectId] = useState<string | null>(null);
  const [archivingProjectId, setArchivingProjectId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadAppData().then((result) => {
      if (!live) return;
      setData(result.data);
      setRemoteActive(result.source === "supabase");
    }).catch(() => {
      if (!live) return;
      setLoadError(true);
      setRemoteActive(false);
      setData(createDemoData());
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    async function refreshAfterDateChange() {
      const nextDay = localDate();
      if (nextDay === today) return;
      setToday(nextDay);
      try {
        const result = await loadAppData();
        setData(result.data);
        setRemoteActive(result.source === "supabase");
        setLoadError(false);
      } catch {
        setLoadError(true);
      }
    }

    const interval = window.setInterval(() => { void refreshAfterDateChange(); }, 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshAfterDateChange();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [today]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const currentUser = data.users.find((user) => user.id === currentUserId) ?? data.users[0];
  const employeeId = currentUser?.employeeId;
  const effectiveScreen = currentUser?.role === "PRODUCTION_EMPLOYEE" ? "employee" : currentUser?.role === "MANAGER" && !["schedule", "projects", "trash"].includes(screen) ? "projects" : screen;
  const planningProject = data.projects.find((project) => project.id === planningProjectId && !project.archivedAt) ?? null;
  const archivingProject = data.projects.find((project) => project.id === archivingProjectId && !project.archivedAt) ?? null;
  const roleGroups = useMemo(() => ({
    MANAGER: data.users.filter((user) => user.role === "MANAGER"),
    PRODUCTION_HEAD: data.users.filter((user) => user.role === "PRODUCTION_HEAD"),
    PRODUCTION_EMPLOYEE: data.users.filter((user) => user.role === "PRODUCTION_EMPLOYEE"),
  }), [data.users]);

  function commit(next: AppData) {
    setData(next);
    saveLocalData(next);
  }

  async function handleCreateProject(values: NewProjectValues) {
    const project: Project = {
      ...values,
      id: createId(),
      status: "NEW",
      vehicleId: null,
      archivedAt: null,
      creatorId: currentUser.id,
    };
    try {
      await insertProject(project, remoteActive);
    } catch {
      setLoadError(true);
      return false;
    }
    commit({ ...data, projects: [project, ...data.projects] });
    setNotice("Об’єкт створено й передано керівнику виробництва.");
    return true;
  }

  async function handleSavePlan(project: Project, employeeIds: string[], responsibleId: string, vehicleId: VehicleId) {
    const currentProject = data.projects.find((item) => item.id === project.id);
    if (!currentProject || currentProject.archivedAt) {
      setPlanningProjectId(null);
      setNotice("Об’єкт недоступний для планування.");
      return false;
    }
    if (!employeeIds.length || !employeeIds.includes(responsibleId) || employeeIds.some((id) => !data.employees.some((employee) => employee.id === id)) || project.vehicleId !== vehicleId) {
      return false;
    }
    const nextProject = {
      ...currentProject,
      startDate: project.startDate,
      endDate: project.endDate,
      status: "PLANNED" as const,
      vehicleId,
    };
    const nextAssignments = data.assignments.filter((assignment) => assignment.projectId !== project.id);
    employeeIds.forEach((id) => nextAssignments.push({ id: createId(), projectId: project.id, employeeId: id, isResponsible: id === responsibleId }));
    try {
      await saveProjectPlan(nextProject, employeeIds, responsibleId, vehicleId, remoteActive);
    } catch {
      setLoadError(true);
      return false;
    }
    commit({ ...data, projects: data.projects.map((item) => item.id === project.id ? nextProject : item), assignments: nextAssignments });
    setPlanningProjectId(null);
    setNotice("План збережено. Команда й автомобіль призначені на об’єкт.");
    return true;
  }

  async function handleArchiveProject(projectId: string) {
    const project = data.projects.find((item) => item.id === projectId);
    const mayManage = currentUser.role === "PRODUCTION_HEAD" || (currentUser.role === "MANAGER" && project?.creatorId === currentUser.id);
    if (!project || project.archivedAt || !mayManage) return false;
    const archivedAt = new Date().toISOString();
    try {
      await archiveProject(projectId, archivedAt, remoteActive);
    } catch {
      setLoadError(true);
      return false;
    }
    commit({ ...data, projects: data.projects.map((item) => item.id === projectId ? { ...item, archivedAt } : item) });
    setArchivingProjectId(null);
    setNotice("Об’єкт переміщено до кошика. Його можна відновити.");
    return true;
  }

  async function handleRestoreProject(projectId: string) {
    const project = data.projects.find((item) => item.id === projectId);
    const mayManage = currentUser.role === "PRODUCTION_HEAD" || (currentUser.role === "MANAGER" && project?.creatorId === currentUser.id);
    if (!project || !project.archivedAt || !mayManage) return false;
    try {
      await restoreProject(projectId, remoteActive);
    } catch {
      setLoadError(true);
      setNotice("Не вдалося відновити об’єкт із кошика.");
      return false;
    }
    commit({ ...data, projects: data.projects.map((item) => item.id === projectId ? { ...item, archivedAt: null } : item) });
    setNotice("Об’єкт відновлено.");
    return true;
  }

  const navItems = currentUser.role === "PRODUCTION_HEAD"
    ? [{ key: "schedule" as const, title: "Графік", icon: CalendarDays }, { key: "projects" as const, title: "Об’єкти", icon: ClipboardList }, { key: "trash" as const, title: "Кошик", icon: Archive }, { key: "team" as const, title: "Команда", icon: Users }]
    : currentUser.role === "MANAGER"
      ? [{ key: "schedule" as const, title: "Графік", icon: CalendarDays }, { key: "projects" as const, title: "Мої об’єкти", icon: ClipboardList }, { key: "trash" as const, title: "Кошик", icon: Archive }]
      : [];

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><HardHat size={19} strokeWidth={2.2} /></div><div><strong>GIS Reports</strong><span>ВИРОБНИЦТВО</span></div></div>
      <nav className="desktop-nav" aria-label="Основна навігація">{navItems.map(({ key, title, icon: Icon }) => <button key={key} className={`nav-link ${effectiveScreen === key ? "active" : ""}`} onClick={() => setScreen(key)}><Icon size={17} />{title}</button>)}</nav>
      <div className="topbar-actions">
        <div className={`data-indicator ${remoteActive ? "connected" : "local"}`}><span />{remoteActive ? "Supabase" : "Демо-дані"}</div>
        <label className="user-switcher"><span>Демо-режим</span><select value={currentUser?.id ?? ""} onChange={(event) => setCurrentUserId(event.target.value)} aria-label="Вибрати демо-користувача">
          <optgroup label="Менеджер">{roleGroups.MANAGER.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</optgroup>
          <optgroup label="Керівник виробництва">{roleGroups.PRODUCTION_HEAD.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</optgroup>
          <optgroup label="Працівники виробництва">{roleGroups.PRODUCTION_EMPLOYEE.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</optgroup>
        </select></label>
        <span className="user-avatar">{currentUser?.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
      </div>
    </header>

    <div className="workspace">
      <main className="main-content">
        <div className="content-inner">
          {loadError && isSupabaseConfigured && <div className="connection-alert"><CircleAlert size={16} /><span>{remoteActive ? "Операцію не збережено в Supabase. Перевірте з’єднання та спробуйте ще раз." : "Не вдалося під’єднатися до Supabase. Працюємо з даними браузера."}</span><button onClick={() => setLoadError(false)} aria-label="Приховати сповіщення"><X size={14} /></button></div>}
          {effectiveScreen === "schedule" && (currentUser.role === "PRODUCTION_HEAD" || currentUser.role === "MANAGER") && <ScheduleView data={data} canPlan={currentUser.role === "PRODUCTION_HEAD"} onPlan={setPlanningProjectId} />}
          {(effectiveScreen === "projects" || effectiveScreen === "trash") && <ProjectsView data={data} userId={currentUser.id} canPlan={currentUser.role === "PRODUCTION_HEAD"} canCreate={currentUser.role === "MANAGER"} canArchive={currentUser.role === "MANAGER" || currentUser.role === "PRODUCTION_HEAD"} isTrash={effectiveScreen === "trash"} onCreate={() => setCreatingProject(true)} onPlan={setPlanningProjectId} onArchive={(project) => setArchivingProjectId(project.id)} onRestore={(id) => void handleRestoreProject(id)} />}
          {effectiveScreen === "team" && currentUser.role === "PRODUCTION_HEAD" && <TeamView data={data} />}
          {effectiveScreen === "employee" && employeeId && <EmployeeView data={data} employeeId={employeeId} />}
          {!effectiveScreen && <div className="empty-state">Виберіть демо-користувача.</div>}
        </div>
      </main>
    </div>

    {navItems.length > 1 && <nav className="mobile-nav" aria-label="Основна навігація">{navItems.map(({ key, title, icon: Icon }) => <button key={key} className={effectiveScreen === key ? "active" : ""} onClick={() => setScreen(key)}><Icon size={19} /><span>{title}</span></button>)}</nav>}
    {effectiveScreen === "projects" && currentUser.role === "MANAGER" && <button className="mobile-create-button" onClick={() => setCreatingProject(true)} aria-label="Створити об’єкт"><Plus size={21} /></button>}

    <CreateProjectDialog open={creatingProject} onOpenChange={setCreatingProject} onSave={handleCreateProject} />
    <PlanProjectDialog project={planningProject} data={data} onOpenChange={(open) => { if (!open) setPlanningProjectId(null); }} onSave={handleSavePlan} />
    <ArchiveProjectDialog project={archivingProject} onOpenChange={(open) => { if (!open) setArchivingProjectId(null); }} onConfirm={handleArchiveProject} />
    {notice && <div className="toast-message" role="status"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Закрити"><X size={14} /></button></div>}
  </div>;
}
