import { useState, type FormEvent } from "react";
import { type ProjectValues, type User, type WorkType, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Values = { name: string; managerId: string; workTypeId: string; address: string; locationUrl: string; volume: string; information: string; desiredStart: string; desiredEnd: string };
const empty: Values = { name: "", managerId: "", workTypeId: "", address: "", locationUrl: "", volume: "", information: "", desiredStart: "", desiredEnd: "" };
const isMapLink = (value: string) => /^https?:\/\//i.test(value.trim());

export function ProductionProjectForm({ workTypes, managers, isAdmin, initial, isManager, onSave, onCancel }: {
  workTypes: WorkType[]; managers: User[]; isAdmin: boolean; initial?: Project; isManager?: boolean;
  onSave: (values: ProjectValues, files: File[]) => Promise<void>; onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(() => initial ? { name: initial.name, managerId: initial.managerId, workTypeId: initial.workTypeId, address: initial.address, locationUrl: isMapLink(initial.locationUrl ?? "") ? initial.locationUrl! : "", volume: initial.volume ?? "", information: initial.information ?? "", desiredStart: initial.desiredStart ?? "", desiredEnd: initial.desiredEnd ?? "" } : empty);
  const restricted = Boolean(initial?.plannedStart && isManager);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const change = (key: keyof Values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.address.trim()) { setError("Вкажіть адресу об’єкта."); return; }
    if ((!initial || initial.desiredStart || initial.desiredEnd) && (!values.desiredStart || !values.desiredEnd)) { setError("Вкажіть обидві бажані дати."); return; }
    if (Boolean(values.desiredStart) !== Boolean(values.desiredEnd) || (values.desiredStart && values.desiredEnd < values.desiredStart)) { setError("Вкажіть обидві бажані дати в правильному порядку."); return; }
    setSaving(true); setError("");
    try {
      await onSave({ name: values.name.trim(), workTypeId: values.workTypeId, ...(isAdmin ? { managerId: values.managerId } : {}), address: values.address.trim(), locationUrl: values.locationUrl.trim() || null, volume: values.volume.trim() || null, information: values.information.trim() || null, desiredStart: values.desiredStart || null, desiredEnd: values.desiredEnd || null }, files);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося зберегти об’єкт.");
    } finally { setSaving(false); }
  }
  return <form className="form-stack" onSubmit={submit}>
    <div className="field"><Label htmlFor="project-name">Назва об’єкта</Label><Input id="project-name" value={values.name} onChange={(event) => change("name", event.target.value)} required /></div>
    {isAdmin && <div className="field"><Label htmlFor="project-manager">Відповідальний менеджер</Label><select id="project-manager" className="form-select" value={values.managerId} onChange={(event) => change("managerId", event.target.value)} required><option value="">Оберіть менеджера</option>{managers.filter((manager) => (manager.active && manager.role === "MANAGER") || manager.id === initial?.managerId).map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></div>}
    <div className="field"><Label htmlFor="project-work-type">Тип робіт</Label><select id="project-work-type" className="form-select" value={values.workTypeId} disabled={restricted} onChange={(event) => change("workTypeId", event.target.value)} required><option value="">Оберіть тип робіт</option>{workTypes.filter((type) => type.active || type.id === initial?.workTypeId).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></div>
    <div className="field"><Label htmlFor="project-address">Адреса</Label><Input id="project-address" value={values.address} onChange={(event) => change("address", event.target.value)} required /></div>
    <div className="field"><Label htmlFor="project-location-url">Локація (необов’язково)</Label><div className="location-url-row"><Input id="project-location-url" type="url" inputMode="url" placeholder="Вставте посилання з Google Maps або іншої мапи" value={values.locationUrl} onChange={(event) => change("locationUrl", event.target.value)} />{isMapLink(values.locationUrl) && <Button type="button" variant="outline" onClick={() => window.open(values.locationUrl.trim(), "_blank", "noopener,noreferrer")}>Відкрити</Button>}</div></div>
    <div className="field"><Label htmlFor="project-volume">Обсяг робіт</Label><Input id="project-volume" required={!initial || Boolean(initial.volume)} value={values.volume} onChange={(event) => change("volume", event.target.value)} /></div>
    <div className="planning-dates"><div className="field"><Label htmlFor="desired-start">Бажаний початок</Label><Input id="desired-start" type="date" required={!initial || Boolean(initial.desiredStart)} disabled={restricted} value={values.desiredStart} onChange={(event) => change("desiredStart", event.target.value)} /></div><span className="date-arrow">—</span><div className="field"><Label htmlFor="desired-end">Бажане завершення</Label><Input id="desired-end" type="date" required={!initial || Boolean(initial.desiredEnd)} disabled={restricted} value={values.desiredEnd} onChange={(event) => change("desiredEnd", event.target.value)} /></div></div>
    <div className="field"><Label htmlFor="project-info">Коментар (необов’язково)</Label><Textarea id="project-info" value={values.information} onChange={(event) => change("information", event.target.value)} rows={3} /></div>
    {!initial && <div className="field"><Label htmlFor="project-files">Вкладення (необов’язково)</Label><Input id="project-files" type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer"><Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Скасувати</Button><Button type="submit" className="primary-shadcn" disabled={saving}>{saving ? "Зберігаємо…" : (initial ? "Зберегти зміни" : "Створити об’єкт")}</Button></div>
  </form>;
}
