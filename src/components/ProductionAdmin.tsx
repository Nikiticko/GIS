import { useState, type FormEvent } from "react";
import { api, ApiError, type AuditEntry, type ProjectRow, type Role, type User, type Vehicle, type WorkType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime } from "@/lib/date";

const roles: Record<Role, string> = { ADMIN: "Адміністратор", MANAGER: "Менеджер", PRODUCTION_HEAD: "Керівник виробництва", PRODUCTION_EMPLOYEE: "Працівник виробництва" };
const message = (reason: unknown) => reason instanceof Error ? reason.message : "Не вдалося виконати дію.";

export function ProductionUsers({ users, refresh }: { users: User[]; refresh: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Exclude<Role, "ADMIN">>("MANAGER");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function act(work: () => Promise<unknown>) {
    setPending(true); setError("");
    try {
      await work();
      try { await refresh(); } catch { setError("Дію виконано, але дані на екрані не оновлено. Оновіть сторінку."); }
    } catch (reason) {
      setError(message(reason));
      if (reason instanceof ApiError && reason.status === 409) { try { await refresh(); } catch { /* зберігаємо повідомлення про конфлікт */ } }
    } finally { setPending(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await act(async () => { await api.createUser({ name, role, phone: phone || null }); setName(""); setPhone(""); });
  }
  return <section className="page-stack"><div className="page-heading"><div><p className="eyebrow">АДМІНІСТРУВАННЯ</p><h1>Користувачі</h1></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="production-panel form-stack" onSubmit={create}><h2>Додати користувача</h2><label>ПІБ<Input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Роль<select className="form-select" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>{Object.entries(roles).filter(([key]) => key !== "ADMIN").map(([key, title]) => <option value={key} key={key}>{title}</option>)}</select></label><label>Телефон<Input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" /></label><Button type="submit" disabled={pending}>Створити</Button></form>
    <div className="production-list">{users.map((user) => <UserCard key={user.id} user={user} pending={pending} act={act} />)}</div>
  </section>;
}
type UserDraft = { base: User; name: string; phone: string; role: Role; foreman: boolean };
function userDraft(user: User): UserDraft { return { base: user, name: user.name, phone: user.phone ?? "", role: user.role, foreman: user.foreman }; }
function UserCard({ user, pending, act }: { user: User; pending: boolean; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [showCode, setShowCode] = useState(false);
  const values = draft ?? userDraft(user);
  const admin = user.role === "ADMIN";
  const stale = Boolean(draft && draft.base.updatedAt !== user.updatedAt);
  function edit(changes: Partial<Omit<UserDraft, "base">>) { setDraft((current) => ({ ...(current ?? userDraft(user)), ...changes })); }
  function save() {
    if (!draft) return;
    const changes: Partial<Pick<User, "name" | "phone" | "foreman"> & { role: Exclude<Role, "ADMIN"> }> = {};
    const name = draft.name.trim(), phone = draft.phone.trim() || null;
    if (name !== draft.base.name) changes.name = name;
    if (phone !== draft.base.phone) changes.phone = phone;
    if (!admin && draft.role !== draft.base.role) changes.role = draft.role as Exclude<Role, "ADMIN">;
    if (!admin && draft.foreman !== draft.base.foreman) changes.foreman = draft.foreman;
    if (!Object.keys(changes).length) { setDraft(null); return; }
    void act(async () => { await api.updateUser(user.id, { ...changes, expectedUpdatedAt: draft.base.updatedAt }); setDraft(null); });
  }
  return <article className="production-panel form-stack"><div><strong>{user.name}</strong> · {roles[user.role]} · {user.active ? "Активний" : "Неактивний"}</div>
    <p>Telegram: {user.telegramLinked ? user.telegramUsername ? `@${user.telegramUsername}` : "Підключено" : "Не підключено"}</p>
    {stale && <div role="alert"><p>Профіль змінився. Завантажте актуальні дані перед збереженням.</p><Button type="button" variant="outline" onClick={() => setDraft(null)}>Завантажити актуальні дані</Button></div>}
    <label>ПІБ<Input value={values.name} onChange={(event) => edit({ name: event.target.value })} /></label><label>Телефон<Input value={values.phone} type="tel" onChange={(event) => edit({ phone: event.target.value })} /></label>
    {!admin && <label>Роль<select className="form-select" value={values.role} onChange={(event) => { const role = event.target.value as Role; edit({ role, ...(role !== "PRODUCTION_EMPLOYEE" ? { foreman: false } : {}) }); }}>{Object.entries(roles).filter(([key]) => key !== "ADMIN").map(([key, title]) => <option value={key} key={key}>{title}</option>)}</select></label>}
    {values.role === "PRODUCTION_EMPLOYEE" && <label><input type="checkbox" checked={values.foreman} onChange={(event) => edit({ foreman: event.target.checked })} /> Бригадир</label>}
    <div className="production-actions"><Button type="button" variant="outline" disabled={pending || !values.name.trim() || stale} onClick={save}>Зберегти</Button>
      {!admin && <Button type="button" variant="outline" disabled={pending} onClick={() => void act(() => api.updateUser(user.id, { active: !user.active, expectedUpdatedAt: user.updatedAt }))}>{user.active ? "Деактивувати" : "Активувати"}</Button>}
      <Button type="button" variant="outline" disabled={pending} onClick={() => setShowCode((current) => !current)}>{showCode ? "Приховати код" : "Показати код"}</Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => { if (window.confirm("Перевипустити код і завершити всі сесії?")) void act(() => api.reissueKey(user.id)); }}>Перевипустити код</Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => { if (window.confirm("Завершити всі сесії користувача?")) void act(() => api.revokeSessions(user.id)); }}>Завершити сесії</Button>
      {user.telegramLinked && <Button type="button" variant="outline" disabled={pending} onClick={() => { if (window.confirm("Відв’язати Telegram користувача?")) void act(() => api.unlinkTelegram(user.id)); }}>Відв’язати Telegram</Button>}</div>
    {showCode && <p>Ключ-код: <strong>{user.keyCode}</strong></p>}
  </article>;
}

export function ProductionDirectories({ workTypes, vehicles, refresh }: { workTypes: WorkType[]; vehicles: Vehicle[]; refresh: () => Promise<void> }) {
  const [workType, setWorkType] = useState(""); const [name, setName] = useState(""); const [registration, setRegistration] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function act(work: () => Promise<unknown>) { setPending(true); setError(""); try { await work(); try { await refresh(); } catch { setError("Дію виконано, але дані на екрані не оновлено. Оновіть сторінку."); } } catch (reason) { setError(message(reason)); if (reason instanceof ApiError && reason.status === 409) { try { await refresh(); } catch { /* зберігаємо повідомлення про конфлікт */ } } } finally { setPending(false); } }
  return <section className="page-stack"><div className="page-heading"><div><p className="eyebrow">АДМІНІСТРУВАННЯ</p><h1>Довідники</h1></div></div>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="production-panel form-stack"><h2>Типи робіт</h2><form className="production-actions" onSubmit={(event) => { event.preventDefault(); void act(async () => { await api.createWorkType(workType); setWorkType(""); }); }}><Input aria-label="Назва типу робіт" value={workType} onChange={(event) => setWorkType(event.target.value)} required /><Button type="submit" disabled={pending}>Додати</Button></form>{workTypes.map((type) => <div className="production-row" key={type.id}><span>{type.name} · {type.active ? "Активний" : "Неактивний"}</span><Button variant="outline" disabled={pending} onClick={() => void act(() => api.updateWorkType(type.id, !type.active, type.active))}>{type.active ? "Деактивувати" : "Активувати"}</Button></div>)}</div>
    <div className="production-panel form-stack"><h2>Автомобілі</h2><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void act(async () => { await api.createVehicle(name, registration); setName(""); setRegistration(""); }); }}><label>Назва<Input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Державний номер<Input value={registration} onChange={(event) => setRegistration(event.target.value)} required /></label><Button type="submit" disabled={pending}>Додати автомобіль</Button></form>{vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} pending={pending} act={act} />)}</div>
  </section>;
}
type VehicleDraft = { base: Vehicle; name: string; registration: string };
function vehicleDraft(vehicle: Vehicle): VehicleDraft { return { base: vehicle, name: vehicle.name, registration: vehicle.registration }; }
function vehicleExpected(vehicle: Vehicle) { return { name: vehicle.name, registration: vehicle.registration, active: vehicle.active }; }
function VehicleCard({ vehicle, pending, act }: { vehicle: Vehicle; pending: boolean; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState<VehicleDraft | null>(null);
  const values = draft ?? vehicleDraft(vehicle);
  const stale = Boolean(draft && (draft.base.name !== vehicle.name || draft.base.registration !== vehicle.registration || draft.base.active !== vehicle.active));
  function edit(changes: Partial<Pick<VehicleDraft, "name" | "registration">>) { setDraft((current) => ({ ...(current ?? vehicleDraft(vehicle)), ...changes })); }
  function save() {
    if (!draft) return;
    const changes: Partial<Pick<Vehicle, "name" | "registration">> = {};
    if (draft.name.trim() !== draft.base.name) changes.name = draft.name.trim();
    if (draft.registration.trim() !== draft.base.registration) changes.registration = draft.registration.trim();
    if (!Object.keys(changes).length) { setDraft(null); return; }
    void act(async () => { await api.updateVehicle(vehicle.id, { ...changes, expected: vehicleExpected(draft.base) }); setDraft(null); });
  }
  return <div className="form-stack">
    {stale && <div role="alert"><p>Автомобіль змінився. Завантажте актуальні дані перед збереженням.</p><Button type="button" variant="outline" onClick={() => setDraft(null)}>Завантажити актуальні дані</Button></div>}
    <div className="production-row"><Input aria-label="Назва автомобіля" value={values.name} onChange={(event) => edit({ name: event.target.value })} /><Input aria-label="Державний номер" value={values.registration} onChange={(event) => edit({ registration: event.target.value })} /><Button variant="outline" disabled={pending || !values.name.trim() || !values.registration.trim() || stale} onClick={save}>Зберегти</Button><Button variant="outline" disabled={pending} onClick={() => void act(() => api.updateVehicle(vehicle.id, { active: !vehicle.active, expected: vehicleExpected(vehicle) }))}>{vehicle.active ? "Деактивувати" : "Активувати"}</Button></div>
  </div>;
}
const auditActions: Record<string, string> = { CREATE: "Створення", UPDATE: "Зміна", ARCHIVE: "Архівування", DELETE: "Видалення", REISSUE_KEY_CODE: "Перевипуск ключ-коду", REVOKE_SESSIONS: "Завершення сесій", TELEGRAM_UNLINK: "Відв’язування Telegram" };
const auditEntities: Record<string, string> = { user: "Користувач", project: "Об’єкт", attachment: "Вкладення", "work-types": "Тип робіт", vehicles: "Автомобіль" };
const auditFields: Record<string, string> = { name: "Назва / ПІБ", role: "Роль", phone: "Телефон", active: "Активність", foreman: "Бригадир", managerId: "Відповідальний менеджер", workTypeId: "Тип робіт", address: "Адреса", locationUrl: "Локація", volume: "Обсяг робіт", information: "Додаткова інформація", desiredStart: "Бажаний початок", desiredEnd: "Бажане завершення", plannedStart: "Плановий початок", plannedEnd: "Планове завершення", employees: "Команда", responsible: "Відповідальний", vehicles: "Автомобілі", registration: "Державний номер", archivedAt: "Час архівування" };
export function ProductionAudit({ entries, users, projects, workTypes, vehicles }: { entries: AuditEntry[]; users: User[]; projects: ProjectRow[]; workTypes: WorkType[]; vehicles: Vehicle[] }) {
  const names = new Map<string, string>();
  for (const user of users) names.set(user.id, user.name);
  for (const { project } of projects) names.set(project.id, project.name);
  for (const workType of workTypes) names.set(workType.id, workType.name);
  for (const vehicle of vehicles) names.set(vehicle.id, `${vehicle.name} · ${vehicle.registration}`);
  function value(field: string | null, raw: string | null) {
    if (raw === null || raw === "") return "—";
    if (field === "role") return roles[raw as Role] ?? raw;
    if (field === "active") return raw === "true" ? "Активний" : raw === "false" ? "Неактивний" : raw;
    if (field === "foreman") return raw === "true" ? "Так" : raw === "false" ? "Ні" : raw;
    if (field && ["desiredStart", "desiredEnd", "plannedStart", "plannedEnd"].includes(field)) return formatDate(raw, "—");
    if (field === "archivedAt") return formatDateTime(raw, "—");
    if (field && ["managerId", "workTypeId", "employees", "responsible", "vehicles"].includes(field)) return raw.split(",").map((id) => names.get(id) ?? id).join(", ");
    return raw;
  }
  return <section className="page-stack"><div className="page-heading"><h1>Журнал змін</h1></div><div className="production-list">{entries.map((entry) => <article className="production-panel" key={entry.id}>
    <strong>{auditActions[entry.action] ?? entry.action} · {auditEntities[entry.entityType] ?? entry.entityType}{names.has(entry.entityId) ? `: ${names.get(entry.entityId)}` : ` · ${entry.entityId}`}</strong>
    <p>{users.find((user) => user.id === entry.actorId)?.name ?? "—"} · {formatDateTime(entry.createdAt)}</p>
    {entry.field && <p>{auditFields[entry.field] ?? entry.field}: {value(entry.field, entry.oldValue)} → {value(entry.field, entry.newValue)}</p>}
  </article>)}{!entries.length && <p>Записів поки немає.</p>}</div></section>;
}
