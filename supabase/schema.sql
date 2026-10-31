create extension if not exists pgcrypto;

create table if not exists public.demo_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('MANAGER', 'PRODUCTION_HEAD', 'PRODUCTION_EMPLOYEE'))
);

create table if not exists public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.demo_users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('WORKER', 'FOREMAN'))
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null,
  city text not null,
  work_type text not null,
  volume text not null default '',
  notes text not null default '',
  status text not null default 'NEW' check (status in ('NEW', 'PLANNED', 'COMPLETED')),
  start_date date,
  end_date date,
  vehicle_id text,
  completed_at date,
  creator_id uuid not null references public.demo_users(id),
  created_at timestamptz not null default now(),
  constraint project_dates_valid check (start_date is null or end_date is null or end_date >= start_date),
  constraint project_plan_complete check (status = 'NEW' or (start_date is not null and end_date is not null))
);

create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete restrict,
  is_responsible boolean not null default false,
  unique (project_id, employee_id)
);

alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists vehicle_id text;
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check check (status in ('NEW', 'PLANNED', 'COMPLETED'));
alter table public.projects drop constraint if exists projects_vehicle_id_check;
alter table public.projects add constraint projects_vehicle_id_check
  check (vehicle_id is null or vehicle_id in ('RENAULT', 'OPEL', 'VOLKSWAGEN', 'IVECO'));

create unique index if not exists one_responsible_per_project
  on public.project_assignments(project_id) where is_responsible;
create index if not exists project_assignments_employee_idx on public.project_assignments(employee_id);
drop index if exists public.projects_schedule_idx;
create index public.projects_schedule_idx on public.projects(start_date, end_date) where archived_at is null and start_date is not null and end_date is not null;

drop function if exists public.save_project_plan(uuid, date, date, uuid[], uuid);
drop function if exists public.save_project_plan(uuid, date, date, uuid[], uuid, date);
drop function if exists public.save_project_plan(uuid, date, date, uuid[], uuid, text);

create or replace function public.save_project_plan(
  p_project_id uuid,
  p_start_date date,
  p_end_date date,
  p_employee_ids uuid[],
  p_responsible_employee_id uuid,
  p_vehicle_id text
) returns void
language plpgsql
as $$
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid project dates';
  end if;
  if p_vehicle_id is null or p_vehicle_id not in ('RENAULT', 'OPEL', 'VOLKSWAGEN', 'IVECO') then
    raise exception 'Invalid project vehicle';
  end if;
  if coalesce(cardinality(p_employee_ids), 0) = 0
    or p_responsible_employee_id is null
    or not (p_responsible_employee_id = any(p_employee_ids)) then
    raise exception 'Responsible employee must be part of the project team';
  end if;
  if (
    select count(*)
      from public.employee_profiles ep
      join public.demo_users du on du.id = ep.user_id
     where ep.id = any(p_employee_ids) and du.role = 'PRODUCTION_EMPLOYEE'
  ) <> cardinality(p_employee_ids) then
    raise exception 'All team members must be production employees';
  end if;
  if (select count(distinct selected.employee_id) from unnest(p_employee_ids) as selected(employee_id)) <> cardinality(p_employee_ids) then
    raise exception 'Duplicate employees are not allowed';
  end if;

  update public.projects
     set start_date = p_start_date, end_date = p_end_date,
         status = 'PLANNED', vehicle_id = p_vehicle_id
   where id = p_project_id and archived_at is null;
  if not found then
    raise exception 'Project is not available for planning';
  end if;

  delete from public.project_assignments where project_id = p_project_id;
  insert into public.project_assignments(project_id, employee_id, is_responsible)
  select p_project_id, selected.employee_id, selected.employee_id = p_responsible_employee_id
    from unnest(p_employee_ids) as selected(employee_id);
end;
$$;

alter table public.demo_users enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_assignments enable row level security;

drop policy if exists "demo access" on public.demo_users;
create policy "demo access" on public.demo_users for all to anon, authenticated using (true) with check (true);
drop policy if exists "demo access" on public.employee_profiles;
create policy "demo access" on public.employee_profiles for all to anon, authenticated using (true) with check (true);
drop policy if exists "demo access" on public.projects;
create policy "demo access" on public.projects for all to anon, authenticated using (true) with check (true);
drop policy if exists "demo access" on public.project_assignments;
create policy "demo access" on public.project_assignments for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.demo_users, public.employee_profiles, public.projects, public.project_assignments to anon, authenticated;
revoke delete on public.projects from anon, authenticated;
grant execute on function public.save_project_plan(uuid, date, date, uuid[], uuid, text) to anon, authenticated;
