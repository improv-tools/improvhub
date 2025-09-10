-- =============================================================================
-- 0) Extensions (for UUIDs) 
-- =============================================================================
create extension if not exists "pgcrypto";  -- gen_random_uuid()


-- =============================================================================
-- 1) Types
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'team_role') then
    create type team_role as enum ('admin','member');
  end if;
  if not exists (select 1 from pg_type where typname = 'event_category') then
    create type event_category as enum ('rehearsal','social','performance');
  end if;
  if not exists (select 1 from pg_type where typname = 'recur_freq') then
    create type recur_freq as enum ('none','weekly','monthly');
  end if;
end$$;


-- =============================================================================
-- 2) Tables
-- =============================================================================

-- Drop in FK order (overrides -> events -> members -> teams)
drop table if exists public.team_event_overrides cascade;
drop table if exists public.team_events cascade;
drop table if exists public.team_members cascade;
drop table if exists public.teams cascade;

-- TEAMS -----------------------------------------------------------------------
create table public.teams (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  display_id   text not null unique,          -- e.g. "Writers Room#2"
  created_at   timestamptz not null default now()
);

-- TEAM MEMBERS ----------------------------------------------------------------
create table public.team_members (
  team_id      uuid not null references public.teams(id) on delete cascade,
  user_id      uuid not null references auth.users(id)   on delete cascade,
  role         team_role not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members (user_id);

-- TEAM EVENTS (base series / one-off) ----------------------------------------
create table public.team_events (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams(id) on delete cascade,

  title              text not null,
  description        text,
  location           text,
  category           event_category not null default 'rehearsal',

  tz                 text not null default 'Europe/London',
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,

  -- Recurrence
  recur_freq         recur_freq not null default 'none',  -- none|weekly|monthly
  recur_interval     int not null default 1,              -- >=1
  recur_byday        text[],       -- for weekly (values: 'SU','MO',...,'SA')
  recur_bymonthday   int[],        -- for monthly (e.g. {1,15,30})
  recur_week_of_month int,         -- for monthly nth (1..5 or -1 for last)
  recur_day_of_week  text,         -- for monthly nth ('SU'..'SA')
  recur_count        int,          -- total occurrences cap
  recur_until        date,         -- end date cap (local date)

  created_at         timestamptz not null default now(),

  constraint team_events_time_chk check (ends_at > starts_at)
);

create index if not exists team_events_team_idx on public.team_events (team_id);

-- TEAM EVENT OVERRIDES (per-occurrence edits/cancels) -------------------------
create table public.team_event_overrides (
  event_id    uuid not null references public.team_events(id) on delete cascade,
  occ_start   timestamptz not null,  -- base occurrence start (series key)
  -- Optional overrides
  title       text,
  description text,
  location    text,
  category    event_category,
  tz          text,
  starts_at   timestamptz,           -- new start for this occurrence (optional)
  ends_at     timestamptz,           -- new end for this occurrence (optional)
  canceled    boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (event_id, occ_start)
);

create unique index if not exists team_event_overrides_event_occ_uq
  on public.team_event_overrides (event_id, occ_start);

-- (Optional) sanity: if both provided, ends > starts
alter table public.team_event_overrides
  drop constraint if exists team_event_overrides_time_chk;
alter table public.team_event_overrides
  add constraint team_event_overrides_time_chk
  check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  );


-- =============================================================================
-- 3) RLS (Row Level Security)
-- =============================================================================
alter table public.teams                 enable row level security;
alter table public.team_members          enable row level security;
alter table public.team_events           enable row level security;
alter table public.team_event_overrides  enable row level security;

-- TEAMS policies --------------------------------------------------------------
drop policy if exists "teams select if member" on public.teams;
create policy "teams select if member"
on public.teams
for select
to authenticated
using (
  exists (
    select 1 from public.team_members m
    where m.team_id = teams.id and m.user_id = auth.uid()
  )
);

drop policy if exists "teams update if admin" on public.teams;
create policy "teams update if admin"
on public.teams
for update
to authenticated
using (
  exists (
    select 1 from public.team_members m
    where m.team_id = teams.id and m.user_id = auth.uid() and m.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.team_members m
    where m.team_id = teams.id and m.user_id = auth.uid() and m.role = 'admin'
  )
);

drop policy if exists "teams delete if admin" on public.teams;
create policy "teams delete if admin"
on public.teams
for delete
to authenticated
using (
  exists (
    select 1 from public.team_members m
    where m.team_id = teams.id and m.user_id = auth.uid() and m.role = 'admin'
  )
);

-- Note: no direct INSERT policy on teams (creation via RPC).

-- TEAM MEMBERS policies -------------------------------------------------------
drop policy if exists "members select if member" on public.team_members;
create policy "members select if member"
on public.team_members
for select
to authenticated
using (
  exists (
    select 1 from public.team_members m
    where m.team_id = team_members.team_id and m.user_id = auth.uid()
  )
);

-- No direct insert/update/delete policies; managed via RPCs with definer rights.

-- TEAM EVENTS policies --------------------------------------------------------
drop policy if exists "events select if member" on public.team_events;
create policy "events select if member"
on public.team_events
for select
to authenticated
using (
  exists (
    select 1 from public.team_members m
    where m.team_id = team_events.team_id and m.user_id = auth.uid()
  )
);

drop policy if exists "events insert if member" on public.team_events;
create policy "events insert if member"
on public.team_events
for insert
to authenticated
with check (
  exists (
    select 1 from public.team_members m
    where m.team_id = team_events.team_id and m.user_id = auth.uid()
  )
);

drop policy if exists "events delete if admin" on public.team_events;
create policy "events delete if admin"
on public.team_events
for delete
to authenticated
using (
  exists (
    select 1 from public.team_members m
    where m.team_id = team_events.team_id and m.user_id = auth.uid() and m.role = 'admin'
  )
);

-- TEAM EVENT OVERRIDES policies ----------------------------------------------
drop policy if exists "overrides select if team member" on public.team_event_overrides;
create policy "overrides select if team member"
on public.team_event_overrides
for select
to authenticated
using (
  exists (
    select 1
    from public.team_events e
    join public.team_members m on m.team_id = e.team_id
    where e.id = team_event_overrides.event_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "overrides insert if team member" on public.team_event_overrides;
create policy "overrides insert if team member"
on public.team_event_overrides
for insert
to authenticated
with check (
  exists (
    select 1
    from public.team_events e
    join public.team_members m on m.team_id = e.team_id
    where e.id = team_event_overrides.event_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "overrides update if team member" on public.team_event_overrides;
create policy "overrides update if team member"
on public.team_event_overrides
for update
to authenticated
using (
  exists (
    select 1
    from public.team_events e
    join public.team_members m on m.team_id = e.team_id
    where e.id = team_event_overrides.event_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.team_events e
    join public.team_members m on m.team_id = e.team_id
    where e.id = team_event_overrides.event_id
      and m.user_id = auth.uid()
  )
);


-- =============================================================================
-- 4) Helpers: Display ID generator
-- =============================================================================
drop function if exists public.next_team_display_id(p_name text);

create or replace function public.next_team_display_id(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base text := trim(p_name);
  n int := 0;
  candidate text;
begin
  if base is null or base = '' then
    raise exception 'Team name required';
  end if;

  candidate := base;
  loop
    exit when not exists (select 1 from public.teams t where t.display_id = candidate);
    n := n + 1;
    candidate := base || '#' || n;
  end loop;

  return candidate;
end;
$$;

grant execute on function public.next_team_display_id(text) to authenticated;


-- =============================================================================
-- 5) RPCs
-- =============================================================================

-- list_my_teams ---------------------------------------------------------------
drop function if exists public.list_my_teams();

create or replace function public.list_my_teams()
returns table (
  id uuid,
  name text,
  display_id text,
  role text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.display_id, tm.role::text
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.user_id = auth.uid()
  order by t.created_at asc;
$$;

grant execute on function public.list_my_teams() to authenticated;


-- list_team_members -----------------------------------------------------------
drop function if exists public.list_team_members(p_team_id uuid);

create or replace function public.list_team_members(p_team_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  -- Only allow if caller is a member of the team
  select u.id as user_id,
         u.email,
         coalesce(nullif(u.raw_user_meta_data->>'display_name',''), u.email) as display_name,
         tm.role::text
  from public.team_members tm
  join auth.users u on u.id = tm.user_id
  where tm.team_id = p_team_id
    and exists (
      select 1
      from public.team_members m
      where m.team_id = p_team_id and m.user_id = auth.uid()
    )
  order by u.email;
$$;

grant execute on function public.list_team_members(uuid) to authenticated;


-- create_team_with_admin ------------------------------------------------------
drop function if exists public.create_team_with_admin(p_name text);

create or replace function public.create_team_with_admin(p_name text)
returns table (id uuid, name text, display_id text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_disp text;
begin
  v_disp := public.next_team_display_id(p_name);

  insert into public.teams as t (name, display_id)
  values (p_name, v_disp)
  returning t.id, t.name, t.display_id
  into id, name, display_id;        -- write directly into OUT params

  -- creator becomes admin
  insert into public.team_members (team_id, user_id, role)
  values (id, auth.uid(), 'admin');

  return;
end;
$$;

grant execute on function public.create_team_with_admin(text) to authenticated;

-- Optional compatibility: create_team -> aliases to create_team_with_admin
drop function if exists public.create_team(p_name text);
create or replace function public.create_team(p_name text)
returns table (id uuid, name text, display_id text)
language sql
volatile
security definer
set search_path = public
as $$
  select * from public.create_team_with_admin(p_name);
$$;
grant execute on function public.create_team(text) to authenticated;


-- add_member_by_email ---------------------------------------------------------
drop function if exists public.add_member_by_email(p_team_id uuid, p_email text);

create or replace function public.add_member_by_email(p_team_id uuid, p_email text)
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_is_admin boolean;
begin
  -- Only team admins can add
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'Only team admins can add members';
  end if;

  select id into v_user from auth.users where lower(email) = lower(p_email);

  if v_user is null then
    raise exception 'User with that email does not exist';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (p_team_id, v_user, 'member')
  on conflict (team_id, user_id) do nothing;
end;
$$;

grant execute on function public.add_member_by_email(uuid, text) to authenticated;


-- remove_member ---------------------------------------------------------------
drop function if exists public.remove_member(p_team_id uuid, p_user_id uuid);

create or replace function public.remove_member(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_self boolean;
  v_target_admin boolean;
  v_admin_count int;
begin
  v_self := (p_user_id = auth.uid());

  -- caller admin?
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;

  if not v_self and not v_is_admin then
    raise exception 'Only admins can remove other members';
  end if;

  -- If target is admin, ensure not last admin
  select (role = 'admin') from public.team_members
  where team_id = p_team_id and user_id = p_user_id
  into v_target_admin;

  if coalesce(v_target_admin,false) then
    select count(*) from public.team_members
    where team_id = p_team_id and role = 'admin'
    into v_admin_count;

    if v_admin_count <= 1 then
      raise exception 'Cannot remove the last admin';
    end if;
  end if;

  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.remove_member(uuid, uuid) to authenticated;


-- set_member_role -------------------------------------------------------------
drop function if exists public.set_member_role(p_team_id uuid, p_user_id uuid, p_role text);

create or replace function public.set_member_role(p_team_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_admin_count int;
begin
  if p_role not in ('admin','member') then
    raise exception 'Invalid role %', p_role;
  end if;

  -- only admins can change roles
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'Only team admins can change roles';
  end if;

  -- prevent demoting the last admin
  if p_role = 'member' then
    select count(*) from public.team_members
    where team_id = p_team_id and role = 'admin'
    into v_admin_count;

    if v_admin_count <= 1 then
      -- If the target is not actually admin, allow; else block
      if exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id and role = 'admin') then
        raise exception 'Cannot demote the last admin';
      end if;
    end if;
  end if;

  update public.team_members
  set role = p_role::team_role
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;


-- rename_team -----------------------------------------------------------------
drop function if exists public.rename_team(p_team_id uuid, p_name text);

create or replace function public.rename_team(p_team_id uuid, p_name text)
returns table (id uuid, name text, display_id text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  -- Only admins may rename
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'Only team admins can rename the team';
  end if;

  update public.teams
  set name = p_name
  where id = p_team_id;

  return query
  select t.id, t.name, t.display_id from public.teams t where t.id = p_team_id;
end;
$$;

grant execute on function public.rename_team(uuid, text) to authenticated;


-- delete_team -----------------------------------------------------------------
drop function if exists public.delete_team(p_team_id uuid);

create or replace function public.delete_team(p_team_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
begin
  -- Only admins can delete
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'Only team admins can delete the team';
  end if;

  delete from public.teams where id = p_team_id;  -- cascades to members/events/overrides
end;
$$;

grant execute on function public.delete_team(uuid) to authenticated;

alter table public.team_event_overrides enable row level security;

-- Clean slate
do $$
declare r record;
begin
  for r in (
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'team_event_overrides'
  ) loop
    execute format('drop policy if exists %I on public.team_event_overrides', r.policyname);
  end loop;
end$$;

-- Read: anyone in the team
create policy teo_select_in_my_teams
on public.team_event_overrides
for select
to authenticated
using (
  exists (
    select 1 from public.team_events e
    where e.id = team_event_overrides.event_id
      and public.is_team_member(e.team_id)
  )
);

-- Insert/Update/Delete: admins only
create policy teo_write_admin_only
on public.team_event_overrides
for all
to authenticated
using (
  exists (
    select 1 from public.team_events e
    where e.id = team_event_overrides.event_id
      and public.is_team_admin(e.team_id)
  )
)
with check (
  exists (
    select 1 from public.team_events e
    where e.id = team_event_overrides.event_id
      and public.is_team_admin(e.team_id)
  )
);

-- Edit a team event (series) with an admin check; bypasses RLS safely
create or replace function public.edit_team_event(
  p_event_id uuid,
  p_patch jsonb
) returns public.team_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_row public.team_events;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select team_id into v_team_id from public.team_events where id = p_event_id;
  if v_team_id is null then
    raise exception 'event % not found', p_event_id using errcode = 'P0002';
  end if;
  if not public.is_team_admin(v_team_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.team_events
  set title        = coalesce(v_patch->>'title', title),
      description  = coalesce(v_patch->>'description', description),
      location     = coalesce(v_patch->>'location', location),
      category     = coalesce((v_patch->>'category')::event_category, category),
      tz           = coalesce(v_patch->>'tz', tz),
      starts_at    = coalesce((v_patch->>'starts_at')::timestamptz, starts_at),
      ends_at      = coalesce((v_patch->>'ends_at')::timestamptz, ends_at),

      -- enums/interval
      recur_freq   = coalesce((v_patch->>'recur_freq')::recur_freq, recur_freq),
      recur_interval = 1,

      -- text[]: accept ["MO","WE"] or "MO"
      recur_byday = case
        when v_patch ? 'recur_byday' then
          case jsonb_typeof(v_patch->'recur_byday')
            when 'array'  then (select coalesce(array_agg(value::text), '{}') from jsonb_array_elements_text(v_patch->'recur_byday'))
            when 'string' then array[(v_patch->>'recur_byday')]
            when 'null'   then null
            else recur_byday
          end
        else recur_byday
      end,

      -- int[]: accept [1,15] or 15
      recur_bymonthday = case
        when v_patch ? 'recur_bymonthday' then
          case jsonb_typeof(v_patch->'recur_bymonthday')
            when 'array'  then (select coalesce(array_agg((e.value)::int), '{}') from jsonb_array_elements(v_patch->'recur_bymonthday') e)
            when 'number' then array[(v_patch->>'recur_bymonthday')::int]
            when 'null'   then null
            else recur_bymonthday
          end
        else recur_bymonthday
      end,

      -- plain integers
      recur_week_of_month = case when v_patch ? 'recur_week_of_month' then (v_patch->>'recur_week_of_month')::int else recur_week_of_month end,
      recur_until         = coalesce((v_patch->>'recur_until')::timestamptz, recur_until),
      recur_count         = case when v_patch ? 'recur_count' then (v_patch->>'recur_count')::int else recur_count end

  where id = p_event_id
  returning * into v_row;

  return v_row;
end$$;

alter function public.edit_team_event(uuid, jsonb) owner to postgres;
grant execute on function public.edit_team_event(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';


 

-- =============================================================================
-- 6) PGRST schema reload (make new RPCs visible immediately)
-- =============================================================================
notify pgrst, 'reload schema';
