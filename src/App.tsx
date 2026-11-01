import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Bell, CalendarDays, ClipboardList, HardHat, LogOut, Plus, Settings, Shield, Users } from "lucide-react";
import { api, ApiError, type Attachment, type AuditEntry, type CurrentUser, type Employee, type Notification, type ProjectDetail, type ProjectRow, type ProjectValues, type User, type Vehicle, type WorkType } from "@/lib/api";
import { LoginView } from "@/components/LoginView";
import { ProductionProjectForm } from "@/components/ProductionProjectForm";
import { ProductionPlanForm } from "@/components/ProductionPlanForm";
import { ProductionAudit, ProductionDirectories, ProductionUsers } from "@/components/ProductionAdmin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProductionMonthCalendar } from "@/components/ProductionMonthCalendar";

type Screen = "projects" | "schedule" | "archive" | "employees" | "users" | "directories" | "audit" | "notifications";
const statuses = { NEW: "Новий", PLANNED: "Запланований", IN_PROGRESS: "У роботі", COMPLETED: "Завершений" };
const notificationLabels: Record<string, string> = { PROJECT_CREATED: "Створено новий об’єкт", PROJECT_LOCATION_CHANGED: "Змінено локацію об’єкта", PROJECT_ARCHIVED: "Об’єкт архівовано", EMPLOYEE_ASSIGNED: "Вас призначено на об’єкт", EMPLOYEE_REMOVED: "Вас знято з об’єкта", PROJECT_DATES_CHANGED: "Змінено дати об’єкта", EMPLOYEE_DEACTIVATED: "Працівника деактивовано" };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Не вдалося виконати дію.";
const initialData = { projects: [] as ProjectRow[], schedule: [] as ProjectRow[], archive: [] as ProjectRow[], employees: [] as Employee[], users: [] as User[], workTypes: [] as WorkType[], vehicles: [] as Vehicle[], notifications: [] as Notification[], audit: [] as AuditEntry[] };
type Data = typeof initialData;

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const sessionIdentity = useRef<CurrentUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [data, setData] = useState<Data>(initialData);
  const [screen, setScreen] = useState<Screen>("projects");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [modal, setModal] = useState<"create" | "detail" | "edit" | "plan" | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (current: CurrentUser) => {
    const admin = current.role === "ADMIN", head = current.role === "PRODUCTION_HEAD", employee = current.role === "PRODUCTION_EMPLOYEE";
    const [projects, schedule, archive, employees, users, workTypes, vehicles, notifications, audit] = await Promise.all([
      api.projects(), api.projects("schedule"), employee ? Promise.resolve([]) : api.projects("archive"),
      admin || head ? api.employees() : Promise.resolve([]), admin ? api.users() : Promise.resolve([]),
      employee ? Promise.resolve([]) : api.workTypes(), admin || head ? api.vehicles() : Promise.resolve([]),
      api.notifications(), admin ? api.audit() : Promise.resolve([]),
    ]);
    if (sessionIdentity.current?.id !== current.id || sessionIdentity.current.role !== current.role) return;
    setData({ projects, schedule, archive, employees, users, workTypes, vehicles, notifications, audit });
    setConnectionError("");
  }, []);
  const reset = useCallback(() => { sessionIdentity.current = null; setUser(null); setData(initialData); setDetail(null); setModal(null); setScreen("projects"); setConnectionError(""); }, []);
  const loadSession = useCallback(async () => {
    try {
      const current = await api.me();
      if (sessionIdentity.current && (sessionIdentity.current.id !== current.id || sessionIdentity.current.role !== current.role)) { setData(initialData); setDetail(null); setModal(null); setScreen("projects"); }
      sessionIdentity.current = current; setUser(current); await refresh(current);
    }
    catch (error) { if (error instanceof ApiError && error.status === 401) reset(); else setConnectionError(errorMessage(error)); }
    finally { setChecking(false); }
  }, [refresh, reset]);
  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void loadSession(), 60_000);
    const visible = () => { if (document.visibilityState === "visible") void loadSession(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [Boolean(user), loadSession]);
  async function reload() {
    if (!user) return;
    try { await refresh(user); }
    catch (error) { if (error instanceof ApiError && error.status === 401) reset(); throw error; }
  }
  async function perform(action: () => Promise<void>) { setBusy(true); setConnectionError(""); try { await action(); } catch (error) { if (error instanceof ApiError && error.status === 401) reset(); else setConnectionError(errorMessage(error)); } finally { setBusy(false); } }
  async function refreshAfterWrite(message: string, update: () => Promise<void>) {
    try { await update(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) reset();
      else setConnectionError(`${message} Не вдалося оновити дані на екрані. Оновіть сторінку.`);
    }
  }
  async function openProject(id: string) {
    await perform(async () => { const [project, files] = await Promise.all([api.project(id), api.attachments(id)]); setDetail(project); setAttachments(files); setModal("detail"); });
  }
  async function saveProject(values: ProjectValues) {
    if (!user) return;
    if (modal === "edit" && detail) {
      const changes: Partial<ProjectValues> = {};
      for (const key of Object.keys(values) as (keyof ProjectValues)[]) {
        if (values[key] !== detail.project[key]) Object.assign(changes, { [key]: values[key] });
      }
      if (Object.keys(changes).length) await api.updateProject(detail.project.id, { ...changes, expectedUpdatedAt: detail.project.updatedAt });
    } else await api.createProject(values);
    setModal(null); setDetail(null);
    await refreshAfterWrite("Зміни збережено.", () => refresh(user));
  }
  async function refreshDetail(id: string) { const [project, files] = await Promise.all([api.project(id), api.attachments(id)]); setDetail(project); setAttachments(files); }
  async function logout() { await perform(async () => { await api.logout(); reset(); }); }
  if (checking) return <div className="empty-state">Завантаження…</div>;
  if (!user) return connectionError ? <div className="login-page"><div className="login-card"><p role="alert">{connectionError}</p><Button onClick={() => void loadSession()}>Спробувати ще раз</Button></div></div> : <LoginView onLogin={(current) => { sessionIdentity.current = current; setUser(current); void refresh(current).catch((error) => setConnectionError(errorMessage(error))); }} />;
  const admin = user.role === "ADMIN", head = user.role === "PRODUCTION_HEAD", manager = user.role === "MANAGER", employee = user.role === "PRODUCTION_EMPLOYEE";
  const canPlan = admin || head, canCreate = admin || manager;
  const nav: { key: Screen; title: string; icon: typeof Users }[] = [
    { key: "projects", title: employee ? "Мої об’єкти" : manager ? "Мої об’єкти" : "Об’єкти", icon: ClipboardList },
    { key: "schedule", title: "Графік", icon: CalendarDays },
    ...(!employee ? [{ key: "archive" as const, title: "Архів", icon: Archive }] : []),
    ...(head ? [{ key: "employees" as const, title: "Працівники", icon: Users }] : []),
    ...(admin ? [{ key: "users" as const, title: "Користувачі", icon: Users }, { key: "directories" as const, title: "Довідники", icon: Settings }, { key: "audit" as const, title: "Аудит", icon: Shield }] : []),
    { key: "notifications", title: `Сповіщення${data.notifications.some((item) => !item.readAt) ? " •" : ""}`, icon: Bell },
  ];
  const effectiveScreen = nav.some((item) => item.key === screen) ? screen : "projects";
  const currentRows = effectiveScreen === "archive" ? data.archive : data.projects;
  const canEdit = Boolean(detail && !detail.project.archivedAt && (admin || head || (manager && detail.project.managerId === user.id)));
  return <div className="app-shell">
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark"><HardHat size={19} /></div><div><strong>GIS Reports</strong><span>ВИРОБНИЦТВО</span></div></div><div className="production-account"><span>{user.name}</span><Button variant="outline" onClick={() => void logout()} disabled={busy}><LogOut data-icon="inline-start" />Вийти</Button></div></header>
    <div className="production-layout"><nav className="production-nav" aria-label="Основна навігація">{nav.map(({ key, title, icon: Icon }) => <button key={key} className={`nav-link ${effectiveScreen === key ? "active" : ""}`} onClick={() => setScreen(key)}><Icon size={17} />{title}</button>)}</nav>
      <main className="main-content"><div className="content-inner">
        {connectionError && <div className="connection-alert" role="alert">{connectionError} <button onClick={() => void loadSession()}>Повторити</button></div>}
        {(effectiveScreen === "projects" || effectiveScreen === "archive") && <section className="page-stack"><div className="page-heading"><div><p className="eyebrow">ВИРОБНИЦТВО</p><h1>{effectiveScreen === "archive" ? "Архів об’єктів" : manager || employee ? "Мої об’єкти" : "Об’єкти"}</h1></div>{effectiveScreen === "projects" && canCreate && <Button onClick={() => setModal("create")}><Plus data-icon="inline-start" />Новий об’єкт</Button>}</div><ProjectList rows={currentRows} open={openProject} /></section>}
        {effectiveScreen === "schedule" && <ProductionMonthCalendar rows={data.schedule} employee={employee} onOpen={(id) => void openProject(id)} />}
        {effectiveScreen === "employees" && <section className="page-stack"><div className="page-heading"><h1>Працівники виробництва</h1></div><div className="production-list">{data.employees.map((person) => <div className="production-panel" key={person.id}><strong>{person.name}</strong><p>{person.phone || "Телефон не вказано"} · {person.active ? "Активний" : "Неактивний"}{person.foreman ? " · Бригадир" : ""}</p></div>)}</div></section>}
        {effectiveScreen === "users" && admin && <ProductionUsers users={data.users} refresh={reload} />}
        {effectiveScreen === "directories" && admin && <ProductionDirectories workTypes={data.workTypes} vehicles={data.vehicles} refresh={reload} />}
        {effectiveScreen === "audit" && admin && <ProductionAudit entries={data.audit} users={data.users} projects={[...data.projects, ...data.archive]} workTypes={data.workTypes} vehicles={data.vehicles} />}
        {effectiveScreen === "notifications" && <section className="page-stack"><div className="page-heading"><h1>Сповіщення</h1></div><div className="production-list">{data.notifications.map((notice) => <article className="production-panel production-row" key={notice.id}><div><strong>{notificationLabels[notice.type] ?? "Системне сповіщення"}{notice.subjectName ? `: ${notice.subjectName}` : notice.projectName ? `: ${notice.projectName}` : ""}</strong><p>{new Date(notice.createdAt).toLocaleString("uk-UA")} · {notice.readAt ? "Прочитано" : "Нове"}</p></div><div className="production-actions">{notice.projectId && notice.type !== "EMPLOYEE_REMOVED" && <Button variant="outline" onClick={() => void openProject(notice.projectId!)}>Відкрити об’єкт</Button>}{!notice.readAt && <Button variant="outline" onClick={() => void perform(async () => { await api.markRead(notice.id); await reload(); })}>Позначити прочитаним</Button>}</div></article>)}{!data.notifications.length && <p>Сповіщень поки немає.</p>}</div></section>}
      </div></main>
    </div>
    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}><DialogContent className="modal-content production-modal">
      {connectionError && <p className="form-error" role="alert">{connectionError}</p>}
      {modal === "create" && <><DialogHeader><DialogTitle>Новий об’єкт</DialogTitle><DialogDescription>Об’єкт одразу стане доступним керівнику виробництва.</DialogDescription></DialogHeader><ProductionProjectForm workTypes={data.workTypes} managers={data.users} isAdmin={admin} onSave={saveProject} onCancel={() => setModal(null)} /></>}
      {modal === "edit" && detail && <><DialogHeader><DialogTitle>Редагування об’єкта</DialogTitle><DialogDescription>{detail.project.name}</DialogDescription></DialogHeader><ProductionProjectForm key={detail.project.id} initial={detail.project} isManager={manager} isAdmin={admin} workTypes={data.workTypes} managers={data.users} onSave={saveProject} onCancel={() => setModal("detail")} /></>}
      {modal === "plan" && detail && <><DialogHeader><DialogTitle>Планування об’єкта</DialogTitle><DialogDescription>{detail.project.name}</DialogDescription></DialogHeader><ProductionPlanForm key={detail.project.id} detail={detail} employees={data.employees} vehicles={data.vehicles} onSaved={() => { setModal(null); void perform(() => refreshAfterWrite("План збережено.", reload)); }} onCancel={() => setModal("detail")} /></>}
      {modal === "detail" && detail && <><DialogHeader><DialogTitle>{detail.project.name}</DialogTitle><DialogDescription>{statuses[detail.status]} · {detail.workTypeName}</DialogDescription></DialogHeader><div className="form-stack">
        <div className="production-detail-grid"><div><span>Адреса</span><strong>{detail.project.address || "Не вказано"}</strong></div><div><span>GPS</span><strong>{detail.project.gps || "Не вказано"}</strong></div><div><span>Менеджер</span><strong>{detail.managerName}</strong></div><div><span>Обсяг робіт</span><strong>{detail.project.volume || "Не вказано"}</strong></div><div><span>Бажані дати</span><strong>{period(detail.project.desiredStart, detail.project.desiredEnd)}</strong></div><div><span>Планові дати</span><strong>{period(detail.project.plannedStart, detail.project.plannedEnd)}</strong></div><div><span>Команда</span><strong>{detail.team.map((person) => `${person.name}${person.responsible ? " (відповідальний)" : ""}`).join(", ") || "Не призначена"}</strong></div><div><span>Автомобілі</span><strong>{detail.vehicles.map((vehicle) => `${vehicle.name} (${vehicle.registration})`).join(", ") || "Не призначені"}</strong></div><div><span>Додаткова інформація</span><strong>{detail.project.information || "Не вказано"}</strong></div></div>
        <div className="field"><strong>Вкладення</strong>{attachments.map((file) => <div className="production-row" key={file.id}><a href={api.attachmentUrl(detail.project.id, file.id)}>{file.name}</a>{canEdit && (admin || file.uploaderId === user.id) && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => { await api.deleteAttachment(detail.project.id, file.id); await refreshAfterWrite("Файл видалено.", () => refreshDetail(detail.project.id)); })}>Видалити</Button>}</div>)}{!attachments.length && <p>Файлів немає.</p>}{canEdit && <label>Додати файл<Input type="file" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void perform(async () => { await api.upload(detail.project.id, file); await refreshAfterWrite("Файл додано.", () => refreshDetail(detail.project.id)); }); }} /></label>}</div>
        <div className="production-actions">{canEdit && <Button variant="outline" onClick={() => setModal("edit")}>Редагувати</Button>}{canPlan && !detail.project.archivedAt && <Button variant="outline" onClick={() => setModal("plan")}>Планувати</Button>}{!detail.project.archivedAt && (admin || (manager && detail.project.managerId === user.id)) && <Button variant="destructive" disabled={busy} onClick={() => { if (window.confirm("Архівувати об’єкт? Відновлення недоступне.")) void perform(async () => { await api.archiveProject(detail.project.id); setModal(null); await refreshAfterWrite("Об’єкт архівовано.", reload); }); }}>Архівувати</Button>}</div>
      </div></>}
    </DialogContent></Dialog>
  </div>;
}

function period(start: string | null, end: string | null) { return start && end ? `${start} — ${end}` : "Не вказано"; }
function ProjectList({ rows, open }: { rows: ProjectRow[]; open: (id: string) => Promise<void> }) {
  return <div className="production-list">{rows.map(({ project, status, workTypeName }) => <button className="production-panel production-project" key={project.id} onClick={() => void open(project.id)}><strong>{project.name}</strong><span>{statuses[status]} · {workTypeName}</span><span>{project.address || project.gps} · {period(project.plannedStart, project.plannedEnd)}</span></button>)}{!rows.length && <div className="empty-state">Об’єктів немає.</div>}</div>;
}
