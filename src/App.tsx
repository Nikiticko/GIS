import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Archive, Bell, CalendarDays, Car, CheckCircle2, ClipboardList, HardHat, LogOut, Plus, Send, Settings, Shield, Users } from "lucide-react";
import { api, ApiError, type Attachment, type AuditEntry, type CurrentUser, type Employee, type Notification, type ProjectDetail, type ProjectRow, type ProjectValues, type ScheduleRow, type User, type Vehicle, type WorkType } from "@/lib/api";
import { LoginView } from "@/components/LoginView";
import { ProductionProjectForm } from "@/components/ProductionProjectForm";
import { ProductionPlanForm } from "@/components/ProductionPlanForm";
import { ProductionAudit, ProductionDirectories, ProductionUsers } from "@/components/ProductionAdmin";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductionEmployeeSchedule } from "@/components/ProductionEmployeeSchedule";
import { ProductionVehicleSchedule } from "@/components/ProductionVehicleSchedule";
import { ProductionMonthCalendar } from "@/components/ProductionMonthCalendar";
import { ProjectAttachments } from "@/components/ProjectAttachments";
import { formatDate, formatDateTime } from "@/lib/date";
import { telegramSdkReady } from "@/telegram-bootstrap";

type Screen = "projects" | "schedule" | "archive" | "employees" | "vehicles_schedule" | "users" | "directories" | "audit" | "notifications";
const paths: Record<Screen, string> = { projects: "/projects", schedule: "/schedule", archive: "/archive", employees: "/employees", vehicles_schedule: "/vehicles", users: "/users", directories: "/directories", audit: "/audit", notifications: "/notifications" };
function screenFromPath(path: string): Screen | null {
  const normalized = path.replace(/\/+$/, "") || "/";
  if (normalized === "/") return "projects";
  return (Object.keys(paths) as Screen[]).find((key) => paths[key] === normalized) ?? null;
}
const statuses = { NEW: "Новий", PLANNED: "Запланований", IN_PROGRESS: "У роботі", COMPLETED: "Завершений" };
const notificationLabels: Record<string, string> = { PROJECT_CREATED: "Створено новий об’єкт", PROJECT_ARCHIVED: "Об’єкт архівовано", PROJECT_CREATED_V2: "Створено новий об’єкт", PROJECT_PLANNED: "Об’єкт заплановано", PROJECT_CHANGED: "Об’єкт змінено", PROJECT_ARCHIVED_V2: "Об’єкт архівовано", EMPLOYEE_ASSIGNED: "Вас призначено на об’єкт", EMPLOYEE_REMOVED: "Призначення скасовано", PROJECT_ARCHIVED_EMPLOYEE: "Об’єкт скасовано та архівовано", PROJECT_ATTACHMENT_ADDED: "Додано нове вкладення" };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Не вдалося виконати дію.";
const initialData = { projects: [] as ProjectRow[], schedule: [] as ScheduleRow[], archive: [] as ProjectRow[], employees: [] as Employee[], users: [] as User[], workTypes: [] as WorkType[], vehicles: [] as Vehicle[], notifications: [] as Notification[], audit: [] as AuditEntry[] };
type Data = typeof initialData;

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const sessionIdentity = useRef<CurrentUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [data, setData] = useState<Data>(initialData);
  const [screen, setScreen] = useState<Screen | null>(() => screenFromPath(window.location.pathname));
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [modal, setModal] = useState<"create" | "detail" | "edit" | "plan" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [createDates, setCreateDates] = useState<{ desiredStart: string; desiredEnd: string }>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const openedProjectFromUrl = useRef<string | null>(null);
  const initialLoadStarted = useRef(false);

  const refresh = useCallback(async (current: CurrentUser) => {
    const admin = current.role === "ADMIN", head = current.role === "PRODUCTION_HEAD", manager = current.role === "MANAGER", employee = current.role === "PRODUCTION_EMPLOYEE";
    const [projects, schedule, archive, employees, users, workTypes, vehicles, notifications, audit] = await Promise.all([
      api.projects(), api.schedule(), employee ? Promise.resolve([]) : api.projects("archive"),
      admin || head || manager ? api.employees() : Promise.resolve([]), admin ? api.users() : Promise.resolve([]),
      employee ? Promise.resolve([]) : api.workTypes(), admin || head || manager ? api.vehicles() : Promise.resolve([]),
      api.notifications(), admin ? api.audit() : Promise.resolve([]),
    ]);
    if (sessionIdentity.current?.id !== current.id || sessionIdentity.current.role !== current.role) return;
    setData({ projects, schedule, archive, employees, users, workTypes, vehicles, notifications, audit });
    setConnectionError("");
  }, []);
  const reset = useCallback(() => { sessionIdentity.current = null; setUser(null); setData(initialData); setDetail(null); setModal(null); setConnectionError(""); }, []);
  const loadNotifications = useCallback(async () => {
    const current = sessionIdentity.current;
    if (!current) return;
    try {
      const notifications = await api.notifications();
      if (sessionIdentity.current?.id === current.id && sessionIdentity.current.role === current.role) setData((previous) => ({ ...previous, notifications }));
    } catch (error) {
      if (sessionIdentity.current?.id !== current.id || sessionIdentity.current.role !== current.role) return;
      if (error instanceof ApiError && error.status === 401) reset();
      else setConnectionError(errorMessage(error));
    }
  }, [reset]);
  const loadSession = useCallback(async () => {
    try {
      await telegramSdkReady;
      let current: CurrentUser;
      const initData = window.Telegram?.WebApp.initData;
      if (initData) {
        try { current = await api.telegramLogin(initData); }
        catch (telegramError) {
          if (telegramError instanceof ApiError && (telegramError.status === 401 || telegramError.status === 403)) { reset(); return; }
          throw telegramError;
        }
      } else current = await api.me();
      if (sessionIdentity.current && (sessionIdentity.current.id !== current.id || sessionIdentity.current.role !== current.role)) { setData(initialData); setDetail(null); setModal(null); }
      sessionIdentity.current = current; setUser(current);
      if (current.telegramLinked && window.sessionStorage.getItem("telegramLinkPending")) {
        window.sessionStorage.removeItem("telegramLinkPending");
        setStatusMessage("Telegram підключено");
      }
      await refresh(current);
    }
    catch (error) { if (error instanceof ApiError && error.status === 401) reset(); else setConnectionError(errorMessage(error)); }
    finally { setChecking(false); }
  }, [refresh, reset]);
  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void telegramSdkReady.then(() => {
      if (window.Telegram?.WebApp.initData) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      }
      return loadSession();
    });
  }, [loadSession]);
  useEffect(() => {
    const onPopState = () => { setScreen(screenFromPath(window.location.pathname)); setModal(null); setDetail(null); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void loadSession(), 60_000);
    const visible = () => { if (document.visibilityState === "visible") void loadSession(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [Boolean(user), loadSession]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadNotifications(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [user?.id, user?.role, loadNotifications]);
  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(""), 4_000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("project");
    if (!projectId || openedProjectFromUrl.current === projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) return;
    openedProjectFromUrl.current = projectId;
    void openProject(projectId).finally(() => {
      params.delete("project");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    });
  }, [user?.id]);
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
  async function uploadFiles(projectId: string, files: File[]) {
    const failed: string[] = [];
    if (!files.length) return failed;
    setUploading(true);
    try { for (const file of files) {
      try { await api.upload(projectId, file); } catch { failed.push(file.name); }
    } } finally { setUploading(false); }
    return failed;
  }
  function reportFailedUploads(failed: string[]) {
    if (failed.length) setConnectionError(`Об’єкт збережено, але не вдалося завантажити файли: ${failed.join(", ")}. Додайте їх у картці об’єкта.`);
  }
  async function saveProject(values: ProjectValues, files: File[]) {
    if (!user) return;
    let failed: string[] = [];
    if (modal === "edit" && detail) {
      const changes: Partial<ProjectValues> = {};
      for (const key of Object.keys(values) as (keyof ProjectValues)[]) {
        if (values[key] !== detail.project[key]) Object.assign(changes, { [key]: values[key] });
      }
      if (Object.keys(changes).length) await api.updateProject(detail.project.id, { ...changes, expectedUpdatedAt: detail.project.updatedAt });
    } else {
      const project = await api.createProject(values);
      failed = await uploadFiles(project.id, files);
    }
    setModal(null); setDetail(null);
    await refreshAfterWrite("Зміни збережено.", () => refresh(user));
    reportFailedUploads(failed);
  }
  async function refreshDetail(id: string) { const [project, files] = await Promise.all([api.project(id), api.attachments(id)]); setDetail(project); setAttachments(files); }
  async function logout() { await perform(async () => { await api.logout(); reset(); }); }
  async function connectTelegram() { await perform(async () => { const { url } = await api.telegramLink(); window.sessionStorage.setItem("telegramLinkPending", "1"); window.location.assign(url); }); }
  function navigate(event: MouseEvent<HTMLAnchorElement>, target: Screen) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.pathname !== paths[target]) window.history.pushState(null, "", paths[target]);
    setScreen(target); setModal(null); setDetail(null);
    if (target === "notifications") void loadNotifications();
  }
  if (checking) return <div className="empty-state">Завантаження…</div>;
  if (!user) return connectionError ? <div className="login-page"><div className="login-card"><p role="alert">{connectionError}</p><Button onClick={() => void loadSession()}>Спробувати ще раз</Button></div></div> : <LoginView onLogin={(current) => { sessionIdentity.current = current; setUser(current); void refresh(current).catch((error) => setConnectionError(errorMessage(error))); }} />;
  const admin = user.role === "ADMIN", head = user.role === "PRODUCTION_HEAD", manager = user.role === "MANAGER", employee = user.role === "PRODUCTION_EMPLOYEE";
  const canPlan = admin || head, canCreate = admin || manager;
  const nav: { key: Screen; title: string; icon: typeof Users }[] = [
    { key: "projects", title: employee ? "Мої об’єкти" : manager ? "Мої об’єкти" : "Об’єкти", icon: ClipboardList },
    { key: "schedule", title: "Графік", icon: CalendarDays },
    ...(!employee ? [{ key: "archive" as const, title: "Архів", icon: Archive }] : []),
    ...(admin || head || manager ? [{ key: "employees" as const, title: "Працівники", icon: Users }] : []),
    ...(admin || head || manager ? [{ key: "vehicles_schedule" as const, title: "Автомобілі", icon: Car }] : []),
    ...(admin ? [{ key: "users" as const, title: "Користувачі", icon: Users }, { key: "directories" as const, title: "Довідники", icon: Settings }, { key: "audit" as const, title: "Аудит", icon: Shield }] : []),
    { key: "notifications", title: `Сповіщення${data.notifications.some((item) => !item.readAt) ? " •" : ""}`, icon: Bell },
  ];
  const effectiveScreen = nav.some((item) => item.key === screen) ? screen : null;
  const currentRows = effectiveScreen === "archive" ? data.archive : data.projects;
  const canEdit = Boolean(detail && !detail.project.archivedAt && (admin || head || (manager && detail.project.managerId === user.id)));
  return <div className="app-shell">
    {statusMessage && <div className="toast-message" role="status"><CheckCircle2 size={16} />{statusMessage}</div>}
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark"><HardHat size={19} /></div><div><strong>GIS Calendar</strong><span>ВИРОБНИЦТВО</span></div></div><div className="production-account"><span className="account-name">{user.name}</span>{!user.telegramLinked && <Button className="telegram-connect-button" variant="outline" onClick={() => void connectTelegram()} disabled={busy} aria-label="Підключити Telegram"><Send data-icon="inline-start" /><span className="telegram-connect-label">Підключити Telegram</span></Button>}<Button variant="outline" onClick={() => void logout()} disabled={busy}><LogOut data-icon="inline-start" />Вийти</Button></div></header>
    <div className="production-layout"><nav className="production-nav" aria-label="Основна навігація">{nav.map(({ key, title, icon: Icon }) => <a key={key} href={paths[key]} className={`nav-link ${effectiveScreen === key ? "active" : ""}`} aria-current={effectiveScreen === key ? "page" : undefined} onClick={(event) => navigate(event, key)}><Icon size={17} />{title}</a>)}</nav>
      <main className="main-content"><div className="content-inner">
        {connectionError && <div className="connection-alert" role="alert">{connectionError} <button onClick={() => void loadSession()}>Повторити</button></div>}
        {!effectiveScreen && <section className="page-stack"><div className="page-heading"><h1>{screen ? "Доступ до сторінки обмежено" : "Сторінку не знайдено"}</h1></div><a href={paths.projects} onClick={(event) => navigate(event, "projects")}>Перейти до об’єктів</a></section>}
        {(effectiveScreen === "projects" || effectiveScreen === "archive") && <section className="page-stack"><div className="page-heading"><div><p className="eyebrow">ВИРОБНИЦТВО</p><h1>{effectiveScreen === "archive" ? "Архів об’єктів" : manager || employee ? "Мої об’єкти" : "Об’єкти"}</h1></div>{effectiveScreen === "projects" && canCreate && <Button onClick={() => { setCreateDates(undefined); setModal("create"); }}><Plus data-icon="inline-start" />Новий об’єкт</Button>}</div><ProjectList rows={currentRows} open={openProject} /></section>}
        {effectiveScreen === "schedule" && <ProductionMonthCalendar rows={data.schedule} employee={employee} onSelectDates={canCreate ? (desiredStart, desiredEnd) => { setCreateDates({ desiredStart, desiredEnd }); setModal("create"); } : undefined} onOpen={(id) => void openProject(id)} />}
        {effectiveScreen === "employees" && <ProductionEmployeeSchedule employees={data.employees} rows={data.schedule} onOpen={(id) => void openProject(id)} />}
        {effectiveScreen === "vehicles_schedule" && <ProductionVehicleSchedule vehicles={data.vehicles} rows={data.schedule} onOpen={(id) => void openProject(id)} />}
        {effectiveScreen === "users" && admin && <ProductionUsers users={data.users} refresh={reload} />}
        {effectiveScreen === "directories" && admin && <ProductionDirectories workTypes={data.workTypes} vehicles={data.vehicles} refresh={reload} />}
        {effectiveScreen === "audit" && admin && <ProductionAudit entries={data.audit} users={data.users} projects={[...data.projects, ...data.archive]} workTypes={data.workTypes} vehicles={data.vehicles} />}
        {effectiveScreen === "notifications" && <section className="page-stack"><div className="page-heading"><h1>Сповіщення</h1>{Boolean(data.notifications.length) && <Button variant="destructive" disabled={busy} onClick={() => { if (window.confirm("Очистити всі сповіщення? Відновити їх буде неможливо.")) void perform(async () => { await api.clearNotifications(); setData((previous) => ({ ...previous, notifications: [] })); }); }}>Очистити сповіщення</Button>}</div><div className="production-list">{data.notifications.map((notice) => <article className="production-panel production-row" key={notice.id}><div><strong>{notificationLabels[notice.type] ?? "Системне сповіщення"}{notice.payload?.projectName || notice.projectName ? `: ${notice.payload?.projectName || notice.projectName}` : ""}</strong><p>{formatDateTime(notice.createdAt)} · {notice.readAt ? "Прочитано" : "Нове"}</p>{notice.payload && <>{notice.payload.manager !== undefined && <><p>Менеджер: {notice.payload.manager}</p><p>Дати: {period(notice.payload.start ?? null, notice.payload.end ?? null)}</p><p>Тип робіт: {notice.payload.workType}</p><p>Обсяг робіт: {notice.payload.volume || "Не вказано"}</p>{notice.payload.team && <p>Бригада: {notice.payload.team.join(", ") || "Не призначена"}</p>}{notice.payload.vehicles && <p>Автомобілі: {notice.payload.vehicles.join(", ") || "Не призначені"}</p>}</>}{notice.payload.changes?.map((change, index) => <p key={`${change.field}-${index}`}>{change.field}: {formatChangeValue(change.field, change.before)} → {formatChangeValue(change.field, change.after)}</p>)}</>}</div><div className="production-actions">{notice.projectId && notice.canOpen && <Button variant="outline" onClick={() => void openProject(notice.projectId!)}>Відкрити об’єкт</Button>}{!notice.readAt && <Button variant="outline" onClick={() => void perform(async () => { await api.markRead(notice.id); await reload(); })}>Позначити прочитаним</Button>}</div></article>)}{!data.notifications.length && <p>Сповіщень поки немає.</p>}</div></section>}
      </div></main>
    </div>
    <Dialog open={modal !== null} onOpenChange={(open) => { if (!open && !uploading) setModal(null); }}><DialogContent className="modal-content production-modal">
      {connectionError && <p className="form-error" role="alert">{connectionError}</p>}
      {modal === "create" && <><DialogHeader><DialogTitle>Новий об’єкт</DialogTitle><DialogDescription>Об’єкт одразу стане доступним керівнику виробництва.</DialogDescription></DialogHeader><ProductionProjectForm initialDates={createDates} workTypes={data.workTypes} managers={data.users} isAdmin={admin} onSave={saveProject} onCancel={() => setModal(null)} /></>}
      {modal === "edit" && detail && <><DialogHeader><DialogTitle>Редагування об’єкта</DialogTitle><DialogDescription>{detail.project.name}</DialogDescription></DialogHeader><ProductionProjectForm key={detail.project.id} initial={detail.project} isManager={manager} isAdmin={admin} workTypes={data.workTypes} managers={data.users} onSave={saveProject} onCancel={() => setModal("detail")} /></>}
      {modal === "plan" && detail && <><DialogHeader><DialogTitle>Планування об’єкта</DialogTitle><DialogDescription>{detail.project.name}</DialogDescription></DialogHeader><ProductionPlanForm key={detail.project.id} detail={detail} employees={data.employees} vehicles={data.vehicles} onSaved={async (files) => { const failed = await uploadFiles(detail.project.id, files); setModal(null); await refreshAfterWrite("План збережено.", reload); reportFailedUploads(failed); }} onCancel={() => setModal("detail")} /></>}
      {modal === "detail" && detail && <><DialogHeader><DialogTitle>{detail.project.name}</DialogTitle><DialogDescription>{statuses[detail.status]} · {detail.workTypeName}</DialogDescription></DialogHeader><div className="form-stack">
        <div className="production-detail-grid"><div><span>Підтвердження</span><strong>{detail.project.confirmedAt ? "100%" : "Попередньо"}</strong></div><div><span>Адреса</span><strong>{detail.project.address}</strong></div><div><span>Локація</span><strong>{detail.project.locationUrl?.match(/^https?:\/\//i) ? <a href={detail.project.locationUrl} target="_blank" rel="noreferrer">Відкрити на мапі</a> : "Не вказано"}</strong></div><div><span>Менеджер</span><strong>{detail.managerName || "Не вказано"}</strong></div><div><span>Телефон менеджера</span><strong>{detail.managerPhone || "Не вказано"}</strong></div><div><span>Обсяг робіт</span><strong>{detail.project.volume || "Не вказано"}</strong></div><div><span>Бажані дати</span><strong>{period(detail.project.desiredStart, detail.project.desiredEnd)}</strong></div><div><span>Планові дати</span><strong>{period(detail.project.plannedStart, detail.project.plannedEnd)}</strong></div><div><span>Бригада</span><strong>{detail.team.length ? detail.team.map((person) => <span className="project-team-contact" key={person.id}>{person.name}{person.responsible ? " (відповідальний)" : ""} · {person.phone || "Телефон не вказано"}</span>) : "Не призначена"}</strong></div><div><span>Автомобілі</span><strong>{detail.vehicles.map((vehicle) => `${vehicle.name} (${vehicle.registration})`).join(", ") || "Не призначені"}</strong></div><div><span>Додаткова інформація</span><strong className="project-information">{detail.project.information || "Не вказано"}</strong></div><div><span>Створено</span><strong>{formatDateTime(detail.project.createdAt)}</strong></div><div><span>Оновлено</span><strong>{formatDateTime(detail.project.updatedAt)}</strong></div>{detail.project.archivedAt && <div><span>Архівовано</span><strong>{formatDateTime(detail.project.archivedAt)}</strong></div>}</div>
        <ProjectAttachments attachments={attachments} projectId={detail.project.id} canAdd={canEdit} canDelete={(file) => canEdit && (admin || file.uploaderId === user.id)} busy={busy || uploading} attachmentUrl={api.attachmentUrl} onUpload={async (files) => { await perform(async () => { const failed = await uploadFiles(detail.project.id, files); await refreshAfterWrite("Файли додано.", () => refreshDetail(detail.project.id)); if (failed.length) setConnectionError(`Не вдалося завантажити файли: ${failed.join(", ")}.`); }); }} onDelete={async (file) => { await perform(async () => { await api.deleteAttachment(detail.project.id, file.id); await refreshAfterWrite("Файл видалено.", () => refreshDetail(detail.project.id)); }); }} />
        {canEdit && <label><input type="checkbox" checked={Boolean(detail.project.confirmedAt)} disabled={Boolean(detail.project.confirmedAt) || busy} onChange={() => setConfirming(true)} /> Підтвердити об’єкт</label>}
        <div className="production-actions">{canEdit && <Button variant="outline" onClick={() => setModal("edit")}>Редагувати</Button>}{canPlan && !detail.project.archivedAt && <Button variant="outline" onClick={() => setModal("plan")}>Планувати</Button>}{canPlan && detail.project.plannedStart && <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm("Зняти об’єкт із планування?")) void perform(async () => { await api.removePlan(detail.project.id); await refreshDetail(detail.project.id); await reload(); }); }}>Зняти з планування</Button>}{!detail.project.archivedAt && (admin || head || (manager && detail.project.managerId === user.id)) && <Button variant="destructive" disabled={busy} onClick={() => { if (window.confirm("Архівувати об’єкт? Відновлення недоступне.")) void perform(async () => { await api.archiveProject(detail.project.id); setModal(null); await refreshAfterWrite("Об’єкт архівовано.", reload); }); }}>Архівувати</Button>}</div>
      </div></>}
    </DialogContent></Dialog>
    <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent className="modal-content"><DialogHeader><DialogTitle>Підтвердити об’єкт?</DialogTitle><DialogDescription>Підтвердження об’єкта незворотне. Після підтвердження та планування призначені працівники отримуватимуть Telegram-сповіщення про зміни об’єкта. Скасувати підтвердження неможливо.</DialogDescription></DialogHeader><div className="modal-footer"><Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Скасувати</Button><Button disabled={busy} onClick={() => void perform(async () => { if (!detail) return; await api.confirmProject(detail.project.id); setConfirming(false); await refreshDetail(detail.project.id); await reload(); })}>Підтвердити</Button></div></DialogContent></Dialog>
  </div>;
}

const dateFields = new Set(["desiredStart", "desiredEnd", "plannedStart", "plannedEnd"]);
function formatChangeValue(field: string, value: string | null) {
  if (dateFields.has(field)) return formatDate(value, "—");
  if (field === "archivedAt") return formatDateTime(value, "—");
  return value || "—";
}
function period(start: string | null, end: string | null) { return start && end ? `${formatDate(start)} — ${formatDate(end)}` : "Не вказано"; }
function ProjectList({ rows, open }: { rows: ProjectRow[]; open: (id: string) => Promise<void> }) {
  return <div className="production-list">{rows.map(({ project, status, workTypeName }) => <button className="production-panel production-project" key={project.id} onClick={() => void open(project.id)}><strong>{project.name}</strong><span>{project.confirmedAt ? "100%" : "Попередньо"} · {statuses[status]} · {workTypeName}</span><span>{project.address} · {period(project.plannedStart, project.plannedEnd)}</span></button>)}{!rows.length && <div className="empty-state">Об’єктів немає.</div>}</div>;
}
