import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectRow, Status } from "@/lib/api";
import { formatDate } from "@/lib/date";

const statusLabels: Record<Status, string> = { NEW: "Новий", PLANNED: "Запланований", IN_PROGRESS: "У роботі", COMPLETED: "Завершений" };
const allStatuses = Object.keys(statusLabels) as Status[];
const period = (start: string | null, end: string | null) => start && end ? `${formatDate(start)} — ${formatDate(end)}` : "Не вказано";

export function ProductionProjectList({ rows, open, purge, filters = false, showManagerFilter = false }: {
  rows: ProjectRow[]; open: (id: string) => Promise<void>; purge?: (id: string) => void; filters?: boolean; showManagerFilter?: boolean;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Set<Status> | null>(null);
  const [confirmation, setConfirmation] = useState<"ALL" | "CONFIRMED" | "PRELIMINARY">("ALL");
  const [workTypeIds, setWorkTypeIds] = useState<Set<string> | null>(null);
  const [managerIds, setManagerIds] = useState<Set<string> | null>(null);
  const [planning, setPlanning] = useState<"ALL" | "PLANNED" | "UNPLANNED">("ALL");
  const [plannedFrom, setPlannedFrom] = useState("");
  const [plannedTo, setPlannedTo] = useState("");
  const workTypes = useMemo(() => [...new Map(rows.map((row) => [row.project.workTypeId, row.workTypeName] as const)).entries()].sort((a, b) => a[1].localeCompare(b[1], "uk")), [rows]);
  const managers = useMemo(() => [...new Map(rows.map((row) => [row.project.managerId, row.managerName] as const)).entries()].sort((a, b) => a[1].localeCompare(b[1], "uk")), [rows]);
  const filteredRows = useMemo(() => {
    if (!filters) return rows;
    const normalizedQuery = query.trim().toLocaleLowerCase("uk");
    return rows.filter((row) => {
      if (normalizedQuery && !row.project.name.toLocaleLowerCase("uk").includes(normalizedQuery)) return false;
      if (statuses && !statuses.has(row.status)) return false;
      if (confirmation === "CONFIRMED" && !row.project.confirmedAt) return false;
      if (confirmation === "PRELIMINARY" && row.project.confirmedAt) return false;
      if (workTypeIds && !workTypeIds.has(row.project.workTypeId)) return false;
      if (showManagerFilter && managerIds && !managerIds.has(row.project.managerId)) return false;
      if (planning === "PLANNED" && !row.project.plannedStart) return false;
      if (planning === "UNPLANNED" && row.project.plannedStart) return false;
      if (plannedFrom && (!row.project.plannedEnd || row.project.plannedEnd < plannedFrom)) return false;
      if (plannedTo && (!row.project.plannedStart || row.project.plannedStart > plannedTo)) return false;
      return true;
    });
  }, [confirmation, filters, managerIds, plannedFrom, plannedTo, planning, query, rows, showManagerFilter, statuses, workTypeIds]);
  const filtersActive = Boolean(query.trim() || statuses || confirmation !== "ALL" || workTypeIds || (showManagerFilter && managerIds) || planning !== "ALL" || plannedFrom || plannedTo);
  function toggleValue<T>(current: Set<T> | null, value: T, all: T[]) {
    const next = new Set(current ?? all);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next.size === all.length ? null : next;
  }
  function resetFilters() {
    setQuery(""); setStatuses(null); setConfirmation("ALL"); setWorkTypeIds(null); setManagerIds(null); setPlanning("ALL"); setPlannedFrom(""); setPlannedTo("");
  }
  return <>
    {filters && <><Button type="button" variant="outline" className="schedule-filter-toggle" aria-expanded={filtersOpen} aria-controls="project-filters" onClick={() => setFiltersOpen((open) => !open)}>Фільтри{filtersActive ? " •" : ""}</Button>
      <div id="project-filters" className={`production-panel schedule-filter-panel project-filter-panel ${showManagerFilter ? "has-manager-filter" : ""} ${filtersOpen ? "open" : ""}`}>
        <label className="schedule-filter-search">Назва об’єкта<Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук за назвою" /></label>
        <details className="schedule-filter-group"><summary>Статуси · {statuses === null ? "Усі" : `Обрано: ${statuses.size}`}</summary><div className="schedule-filter-options"><div className="schedule-filter-actions"><button type="button" onClick={() => setStatuses(null)}>Обрати всі</button><button type="button" onClick={() => setStatuses(new Set())}>Очистити</button></div>{allStatuses.map((status) => <label key={status}><input type="checkbox" checked={statuses === null || statuses.has(status)} onChange={() => setStatuses((current) => toggleValue(current, status, allStatuses))} /> {statusLabels[status]}</label>)}</div></details>
        <label>Підтвердження<select className="form-select" value={confirmation} onChange={(event) => setConfirmation(event.target.value as typeof confirmation)}><option value="ALL">Усі</option><option value="CONFIRMED">Підтверджені</option><option value="PRELIMINARY">Попередні</option></select></label>
        <details className="schedule-filter-group"><summary>Типи робіт · {workTypeIds === null ? "Усі" : `Обрано: ${workTypeIds.size}`}</summary><div className="schedule-filter-options"><div className="schedule-filter-actions"><button type="button" onClick={() => setWorkTypeIds(null)}>Обрати всі</button><button type="button" onClick={() => setWorkTypeIds(new Set())}>Очистити</button></div>{workTypes.map(([id, name]) => <label key={id}><input type="checkbox" checked={workTypeIds === null || workTypeIds.has(id)} onChange={() => setWorkTypeIds((current) => toggleValue(current, id, workTypes.map(([workTypeId]) => workTypeId)))} /> {name}</label>)}</div></details>
        {showManagerFilter && <details className="schedule-filter-group"><summary>Менеджери · {managerIds === null ? "Усі" : `Обрано: ${managerIds.size}`}</summary><div className="schedule-filter-options"><div className="schedule-filter-actions"><button type="button" onClick={() => setManagerIds(null)}>Обрати всіх</button><button type="button" onClick={() => setManagerIds(new Set())}>Очистити</button></div>{managers.map(([id, name]) => <label key={id}><input type="checkbox" checked={managerIds === null || managerIds.has(id)} onChange={() => setManagerIds((current) => toggleValue(current, id, managers.map(([managerId]) => managerId)))} /> {name}</label>)}</div></details>}
        <label>Планування<select className="form-select" value={planning} onChange={(event) => setPlanning(event.target.value as typeof planning)}><option value="ALL">Усі</option><option value="PLANNED">Заплановані</option><option value="UNPLANNED">Незаплановані</option></select></label>
        <label>План від<Input type="date" value={plannedFrom} onChange={(event) => setPlannedFrom(event.target.value)} /></label><label>План до<Input type="date" value={plannedTo} min={plannedFrom || undefined} onChange={(event) => setPlannedTo(event.target.value)} /></label>
        <div className="schedule-filter-footer"><span>Знайдено: {filteredRows.length} із {rows.length}</span>{filtersActive && <Button type="button" variant="outline" onClick={resetFilters}>Скинути фільтри</Button>}</div>
      </div></>}
    <div className="production-list">{filteredRows.map(({ project, status, workTypeName, managerName }) => purge ? <article className="production-panel production-row archived-project-row" key={project.id}><button className="production-project archived-project-main" onClick={() => void open(project.id)}><strong>{project.name}</strong><span>{project.confirmedAt ? "100%" : "Попередньо"} · {statusLabels[status]} · {workTypeName}</span><span>{project.address} · {period(project.plannedStart, project.plannedEnd)}</span></button><Button type="button" variant="destructive" onClick={() => purge(project.id)}>Видалити назавжди</Button></article> : <button className="production-panel production-project" key={project.id} onClick={() => void open(project.id)}><strong>{project.name}</strong><span>{project.confirmedAt ? "100%" : "Попередньо"} · {statusLabels[status]} · {workTypeName}</span>{showManagerFilter && <span>Менеджер: {managerName}</span>}<span>{project.address} · {period(project.plannedStart, project.plannedEnd)}</span></button>)}{!filteredRows.length && <div className="empty-state">Об’єктів за вибраними умовами немає.</div>}</div>
  </>;
}
