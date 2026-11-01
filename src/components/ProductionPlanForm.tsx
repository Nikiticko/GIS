import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Availability, type Conflicts, type Employee, type Plan, type ProjectDetail, type Vehicle } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ProductionPlanForm({ detail, employees, vehicles, onSaved, onCancel }: { detail: ProjectDetail; employees: Employee[]; vehicles: Vehicle[]; onSaved: (files: File[]) => Promise<void>; onCancel: () => void }) {
  const availableEmployees = [...employees, ...detail.team.filter((person) => !employees.some((employee) => employee.id === person.id)).map((person) => ({ ...person, active: false, foreman: false }))];
  const availableVehicles = [...vehicles, ...detail.vehicles.filter((vehicle) => !vehicles.some((item) => item.id === vehicle.id)).map((vehicle) => ({ ...vehicle, active: false }))];
  const [start, setStart] = useState(detail.project.plannedStart ?? detail.project.desiredStart ?? "");
  const [end, setEnd] = useState(detail.project.plannedEnd ?? detail.project.desiredEnd ?? "");
  const [information, setInformation] = useState(detail.project.information ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [selected, setSelected] = useState(detail.team.map((person) => person.id));
  const [responsible, setResponsible] = useState(detail.team.find((person) => person.responsible)?.id ?? "");
  const [cars, setCars] = useState(detail.vehicles.map((vehicle) => vehicle.id));
  const [conflicts, setConflicts] = useState<Conflicts | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    setAvailability(null); setAvailabilityError("");
    if (start && end && start <= end) {
      void api.availability(detail.project.id, start, end).then((result) => { if (active) setAvailability(result); }).catch(() => { if (active) setAvailabilityError("Не вдалося перевірити зайнятість. Змініть дати або відкрийте планування знову."); });
    }
    return () => { active = false; };
  }, [detail.project.id, start, end]);
  const clearWarning = () => { setConflicts(null); setError(""); };
  const toggle = (id: string, current: string[], setter: (next: string[]) => void) => { setter(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); clearWarning(); };
  async function save(confirmConflicts: boolean) {
    if (!start || !end || end < start || !selected.length || !selected.includes(responsible)) { setError("Вкажіть коректні дати, команду та відповідального з її складу."); return; }
    const plan: Plan = { start, end, employeeIds: selected, responsibleId: responsible, vehicleIds: cars, confirmConflicts, expectedUpdatedAt: detail.project.updatedAt, information: information.trim() || null };
    setSaving(true); setError("");
    try { await api.savePlan(detail.project.id, plan); await onSaved(files); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.conflicts) setConflicts(reason.conflicts);
      else setError(reason instanceof Error ? reason.message : "Не вдалося зберегти план.");
    } finally { setSaving(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(false); }
  return <form className="form-stack" onSubmit={submit}>
    <div className="planning-dates"><div className="field"><Label htmlFor="plan-start">Початок робіт</Label><Input id="plan-start" type="date" value={start} onChange={(event) => { setStart(event.target.value); clearWarning(); }} required /></div><span className="date-arrow">—</span><div className="field"><Label htmlFor="plan-end">Завершення робіт</Label><Input id="plan-end" type="date" value={end} onChange={(event) => { setEnd(event.target.value); clearWarning(); }} required /></div></div>
    {availabilityError && <p className="form-error" role="alert">{availabilityError}</p>}
    <fieldset className="field"><legend>Команда</legend>{availableEmployees.filter((person) => person.active || selected.includes(person.id)).map((person) => <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => { toggle(person.id, selected, setSelected); if (person.id === responsible && selected.includes(person.id)) setResponsible(""); }} /> {person.name}{person.foreman ? " · бригадир" : ""}{!person.active ? " · неактивний" : ""}{availability?.employees.filter((item) => item.resourceId === person.id).map((item) => <span className="resource-busy" key={item.projectId}>Зайнятий: {item.projectName}, {item.start} — {item.end}</span>)}</label>)}</fieldset>
    <div className="field"><Label htmlFor="plan-responsible">Відповідальний</Label><select id="plan-responsible" className="form-select" value={responsible} onChange={(event) => { setResponsible(event.target.value); clearWarning(); }} required><option value="">Оберіть учасника команди</option>{availableEmployees.filter((person) => selected.includes(person.id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>
    <fieldset className="field"><legend>Автомобілі (необов’язково)</legend>{availableVehicles.filter((vehicle) => vehicle.active || cars.includes(vehicle.id)).map((vehicle) => <label key={vehicle.id}><input type="checkbox" checked={cars.includes(vehicle.id)} onChange={() => toggle(vehicle.id, cars, setCars)} /> {vehicle.name} · {vehicle.registration}{!vehicle.active ? " · неактивний" : ""}{availability?.vehicles.filter((item) => item.resourceId === vehicle.id).map((item) => <span className="resource-busy" key={item.projectId}>Зайнятий: {item.projectName}, {item.start} — {item.end}</span>)}</label>)}</fieldset>
    <div className="field"><Label htmlFor="plan-information">Коментар (необов’язково)</Label><Textarea id="plan-information" value={information} onChange={(event) => setInformation(event.target.value)} rows={3} /></div>
    <div className="field"><Label htmlFor="plan-files">Вкладення (необов’язково)</Label><Input id="plan-files" type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></div>
    {conflicts && <div className="overlap-warning" role="alert"><div><strong>Виявлено перетин призначень</strong>{[...conflicts.employees, ...conflicts.vehicles].map((conflict, index) => <p key={`${conflict.resourceId}-${conflict.projectId}-${index}`}>{conflict.resourceName}: {conflict.projectName}, {conflict.overlapStart} — {conflict.overlapEnd}</p>)}<p>Ви можете зберегти план попри попередження.</p></div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Скасувати</Button>{conflicts ? <Button type="button" className="primary-shadcn" disabled={saving} onClick={() => void save(true)}>Зберегти попри перетин</Button> : <Button type="submit" className="primary-shadcn" disabled={saving}>{saving ? "Зберігаємо…" : "Зберегти план"}</Button>}</div>
  </form>;
}
