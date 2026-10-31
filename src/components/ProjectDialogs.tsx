import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Archive, Check, MapPin, Users } from "lucide-react";
import { vehicles, type AppData, type Project, type VehicleId } from "@/types";
import { assignedEmployees, getEmployeeAvailability, getVehicleAvailability, isValidProjectDateRange, shortDate } from "@/lib/project-utils";
import { addDays } from "@/lib/project-utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const otherWorkType = "__other__";
const standardWorkTypes = ["ДЗ", "Арматура", "Качання свай"];

export interface NewProjectValues {
  name: string;
  location: string;
  city: string;
  workType: string;
  volume: string;
  comment: string;
  startDate: string;
  endDate: string;
}

export function CreateProjectDialog({ open, onOpenChange, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: NewProjectValues) => Promise<boolean>;
}) {
  const [values, setValues] = useState<NewProjectValues>({ name: "", location: "", city: "", workType: "", volume: "", comment: "", startDate: "", endDate: "" });
  const [workTypeChoice, setWorkTypeChoice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedWorkType = workTypeChoice;

  useEffect(() => {
    if (open) {
      setValues({ name: "", location: "", city: "", workType: "", volume: "", comment: "", startDate: "", endDate: "" });
      setWorkTypeChoice("");
      setError("");
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const workType = selectedWorkType === otherWorkType ? values.workType.trim() : selectedWorkType;
    if (!values.name.trim() || !values.location.trim() || !values.city.trim() || !workType.trim() || !isValidProjectDateRange(values.startDate, values.endDate)) {
      setError("Заповніть назву, місце, місто, тип робіт і коректний бажаний період.");
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave({ ...values, workType });
      if (saved) onOpenChange(false);
      else setError("Не вдалося зберегти об’єкт. Перевірте з’єднання та спробуйте ще раз.");
    } catch {
      setError("Не вдалося зберегти об’єкт. Перевірте з’єднання та спробуйте ще раз.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="modal-content">
    <DialogHeader><DialogTitle>Новий об’єкт</DialogTitle><DialogDescription>Укажіть бажані дати робіт. Керівник виробництва побачить об’єкт у графіку зі статусом «Новий» і зможе скоригувати період.</DialogDescription></DialogHeader>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Назва об’єкта"><Input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="Наприклад, БЦ Центральний" /></Field>
      <div className="form-row"><Field label="Місто"><Input value={values.city} onChange={(event) => setValues({ ...values, city: event.target.value })} placeholder="Київ" /></Field><Field label="Адреса / місце розташування"><Input value={values.location} onChange={(event) => setValues({ ...values, location: event.target.value })} placeholder="вул. Прикладна, 10" /></Field></div>
      <div className="planning-dates"><Field label="Бажаний початок"><Input type="date" value={values.startDate} onChange={(event) => setValues({ ...values, startDate: event.target.value })} required /></Field><span className="date-arrow">—</span><Field label="Бажане завершення"><Input type="date" min={values.startDate || undefined} value={values.endDate} onChange={(event) => setValues({ ...values, endDate: event.target.value })} required /></Field></div>
      <Field label="Тип робіт"><select className="form-select" value={selectedWorkType} onChange={(event) => { setWorkTypeChoice(event.target.value); setValues({ ...values, workType: standardWorkTypes.includes(event.target.value) ? event.target.value : "", volume: "" }); }} required>
        <option value="" disabled>Оберіть тип робіт</option>
        {standardWorkTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        <option value={otherWorkType}>Свій варіант</option>
      </select></Field>
      {selectedWorkType === otherWorkType && <Field label="Свій тип робіт"><Input value={values.workType} onChange={(event) => setValues({ ...values, workType: event.target.value })} placeholder="Вкажіть тип робіт" required /></Field>}
      {selectedWorkType === "ДЗ" && <Field label="Кількість точок"><Input type="number" min="1" step="1" value={values.volume} onChange={(event) => setValues({ ...values, volume: event.target.value })} placeholder="Наприклад, 25" /></Field>}
      <Field label="Коментар"><Textarea value={values.comment} onChange={(event) => setValues({ ...values, comment: event.target.value })} placeholder="Що важливо знати команді" rows={3} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <DialogFooter className="modal-footer"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Скасувати</Button><Button type="submit" className="primary-shadcn" disabled={saving}>{saving ? "Зберігаємо…" : "Створити об’єкт"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export function ArchiveProjectDialog({ project, onOpenChange, onConfirm }: {
  project: Project | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (projectId: string) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function confirmArchive() {
    if (!project) return;
    setSaving(true);
    setError("");
    try {
      const archived = await onConfirm(project.id);
      if (archived) onOpenChange(false);
      else setError("Не вдалося перемістити об’єкт до кошика. Перевірте з’єднання та спробуйте ще раз.");
    } catch {
      setError("Не вдалося перемістити об’єкт до кошика. Перевірте з’єднання та спробуйте ще раз.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open={Boolean(project)} onOpenChange={onOpenChange}><DialogContent className="modal-content">
    {project && <>
      <DialogHeader><DialogTitle>Перемістити об’єкт до кошика?</DialogTitle><DialogDescription>«{project.name}» і призначення команди збережуться в кошику. Об’єкт можна буде відновити.</DialogDescription></DialogHeader>
      {error && <p className="form-error" role="alert">{error}</p>}
      <DialogFooter className="modal-footer"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Скасувати</Button><Button type="button" variant="destructive" disabled={saving} onClick={() => void confirmArchive()}><Archive size={15} />{saving ? "Переміщуємо…" : "До кошика"}</Button></DialogFooter>
    </>}
  </DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><Label>{label}</Label>{children}</div>;
}

export function PlanProjectDialog({ project, data, onOpenChange, onSave }: {
  project: Project | null;
  data: AppData;
  onOpenChange: (open: boolean) => void;
  onSave: (project: Project, employeeIds: string[], responsibleId: string, vehicleId: VehicleId) => Promise<boolean>;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [responsibleId, setResponsibleId] = useState("");
  const [vehicleId, setVehicleId] = useState<VehicleId | "">("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const open = Boolean(project);

  useEffect(() => {
    if (!project) return;
    setStartDate(project.startDate ?? addDays(2));
    setEndDate(project.endDate ?? addDays(4));
    const current = assignedEmployees(data, project.id).map((employee) => employee.id);
    const currentResponsible = data.assignments.find((item) => item.projectId === project.id && item.isResponsible)?.employeeId ?? "";
    setSelected(current);
    setResponsibleId(currentResponsible);
    setVehicleId(project.vehicleId ?? "");
    setError("");
  }, [project?.id, data]);

  const validPeriod = isValidProjectDateRange(startDate, endDate);
  const statuses = useMemo(() => validPeriod ? data.employees.map((employee) => ({
    employee,
    busyWith: getEmployeeAvailability(data, employee, startDate, endDate, project?.id),
  })) : [], [data, endDate, project?.id, startDate, validPeriod]);
  const free = statuses.filter((item) => item.busyWith.length === 0);
  const busy = statuses.filter((item) => item.busyWith.length > 0);
  const selectedBusy = busy.filter((item) => selected.includes(item.employee.id));
  const vehicleConflicts = validPeriod && vehicleId
    ? getVehicleAvailability(data, vehicleId, startDate, endDate, project?.id)
    : [];

  function toggle(employeeId: string) {
    setSelected((current) => current.includes(employeeId) ? current.filter((id) => id !== employeeId) : [...current, employeeId]);
    if (responsibleId === employeeId && selected.includes(employeeId)) setResponsibleId("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    if (!startDate || !endDate || endDate < startDate) {
      setError("Перевірте дати: завершення має бути не раніше за початок.");
      return;
    }
    if (selected.length === 0 || !responsibleId || !selected.includes(responsibleId)) {
      setError("Виберіть команду та відповідального з її складу.");
      return;
    }
    if (!vehicleId) {
      setError("Виберіть автомобіль для команди.");
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave({ ...project, startDate, endDate, status: "PLANNED", vehicleId }, selected, responsibleId, vehicleId);
      if (saved) onOpenChange(false);
      else setError("План не збережено. Перевірте з’єднання й доступність об’єкта та спробуйте ще раз.");
    } catch {
      setError("План не збережено. Перевірте з’єднання та спробуйте ще раз.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="modal-content planning-modal">
    {project && <>
      <DialogHeader><p className="eyebrow">ПЛАНУВАННЯ ОБ’ЄКТА</p><DialogTitle>{project.name}</DialogTitle><DialogDescription><MapPin size={13} />{project.city} · {project.location}</DialogDescription></DialogHeader>
      <form className="form-stack" onSubmit={submit}>
        <div className="planning-dates"><Field label="Початок робіт"><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field><span className="date-arrow">—</span><Field label="Планове завершення"><Input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field></div>
        <Field label="Автомобіль для команди"><select className="form-select" value={vehicleId} onChange={(event) => setVehicleId(event.target.value as VehicleId | "")} required>
          <option value="" disabled>Оберіть автомобіль</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}
        </select></Field>
        {vehicleConflicts.length > 0 && <div className="overlap-warning"><AlertTriangle size={16} /><span><strong>{vehicles.find((vehicle) => vehicle.id === vehicleId)?.name}</strong> за планом уже працює на іншому об’єкті в цей період. Призначення дозволено.{vehicleConflicts.map((other) => <span className="vehicle-conflict-reason" key={other.id}>{other.name} · {other.city} · {shortDate(other.startDate)}—{shortDate(other.endDate)}</span>)}</span></div>}
        <div className="availability-heading"><div><h3>Доступність команди</h3><p>Зайнятість перевіряється за вибраний період</p></div><span><Users size={14} />Вільно: {free.length}</span></div>
        {!validPeriod && <div className="empty-state compact-empty">Укажіть коректний період, щоб перевірити зайнятість працівників.</div>}
        {validPeriod && <div className="availability-groups">
          <div className="availability-group"><div className="availability-group-title"><span className="availability-dot free" />Вільні <b>{free.length}</b></div>{free.length ? free.map(({ employee }) => <EmployeeChoice key={employee.id} employee={employee} selected={selected.includes(employee.id)} onClick={() => toggle(employee.id)} />) : <p className="light-empty">На ці дати немає вільних працівників</p>}</div>
          <div className="availability-group"><div className="availability-group-title"><span className="availability-dot busy" />Зайняті <b>{busy.length}</b></div>{busy.length ? busy.map(({ employee, busyWith }) => <div className={`busy-choice-wrap ${selected.includes(employee.id) ? "selected" : ""}`} key={employee.id}>
            <EmployeeChoice employee={employee} selected={selected.includes(employee.id)} busy onClick={() => toggle(employee.id)} />
            <div className="busy-reasons">{busyWith.map((other) => <span key={other.id}>{other.name} · {other.city} · {shortDate(other.startDate)}—{shortDate(other.endDate)}</span>)}</div>
          </div>) : <p className="light-empty">Усі інші працівники вільні</p>}</div>
        </div>}
        {selectedBusy.length > 0 && <div className="overlap-warning"><AlertTriangle size={16} /><span>{selectedBusy.length === 1 ? "Одного вибраного працівника" : `${selectedBusy.length} вибраних працівників`} уже призначено на цей період. Призначення дозволено.</span></div>}
        <div className="responsible-select"><Label htmlFor="responsible">Відповідальний за об’єкт</Label><select id="responsible" value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)} disabled={!selected.length}>
          <option value="">Виберіть учасника команди</option>{data.employees.filter((employee) => selected.includes(employee.id)).map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.type === "FOREMAN" ? "Бригадир" : "Працівник"}</option>)}
        </select><small>Відповідального вказано у складі команди об’єкта.</small></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <DialogFooter className="modal-footer"><Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Скасувати</Button><Button type="submit" className="primary-shadcn" disabled={saving}>{saving ? "Зберігаємо…" : <><Check size={15} />Зберегти план</>}</Button></DialogFooter>
      </form>
    </>}
  </DialogContent></Dialog>;
}

function EmployeeChoice({ employee, selected, busy: isBusy = false, onClick }: {
  employee: AppData["employees"][number]; selected: boolean; busy?: boolean; onClick: () => void;
}) {
  return <button type="button" className={`employee-choice ${selected ? "selected" : ""} ${isBusy ? "is-busy" : ""}`} onClick={onClick} aria-pressed={selected}>
    <span className={`avatar-initial small ${employee.type === "FOREMAN" ? "foreman" : ""}`}>{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span className="choice-copy"><strong>{employee.name}</strong><small>{employee.type === "FOREMAN" ? "Бригадир" : "Працівник"}</small></span><span className="choice-check">{selected ? <Check size={14} /> : null}</span>
  </button>;
}
