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
drop function if exists public.add_member_by_email(p_team_id uuid, p_email text, p_role text);

create or replace function public.add_member_by_email(p_team_id uuid, p_email text, p_role text default 'member')
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_is_admin boolean;
  v_role public.team_role := coalesce(p_role, 'member')::public.team_role;
begin
  -- Only team admins can invite
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'Only team admins can invite members';
  end if;

  select id into v_user from auth.users where lower(email) = lower(p_email);

  if v_user is null then
    raise exception 'User with that email does not exist';
  end if;

  -- Create or update invitation instead of direct membership
  insert into public.team_invitations (team_id, user_id, role, status, invited_by)
  values (p_team_id, v_user, v_role, 'invited', auth.uid())
  on conflict (team_id, user_id) do update
    set role = excluded.role,
        status = 'invited',
        invited_by = auth.uid(),
        created_at = now();
end;
$$;

grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;


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
      allow_team_applications = coalesce((v_patch->>'allow_team_applications')::boolean, allow_team_applications),
      allow_individual_applications = coalesce((v_patch->>'allow_individual_applications')::boolean, allow_individual_applications),
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

-- ====================================================
-- 10) Event notifications to users
-- - Notifies team members when a base event is deleted
-- - Notifies attendees when a base event's time/location changes
-- - Notifies attendees when a single occurrence is canceled/edited
-- ====================================================

-- Base event notifications: delete or time/location change
drop trigger if exists trg_notify_team_events on public.team_events;
drop function if exists public.trg_notify_team_events();

create or replace function public.trg_notify_team_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $trg_events_notify$
begin
  if TG_OP = 'DELETE' then
    -- Notify all team members that the event (series) was deleted
    insert into public.user_notifications (user_id, kind, team_id, payload)
    select m.user_id, 'event_deleted', OLD.team_id,
           jsonb_build_object(
             'event_id', OLD.id,
             'title', OLD.title,
             'starts_at', OLD.starts_at,
             'ends_at', OLD.ends_at,
             'by', auth.uid(),
             'by_name', public.user_display_name(auth.uid())
           )
    from public.team_members m
    where m.team_id = OLD.team_id;
    return OLD;

  elsif TG_OP = 'UPDATE' then
    -- Only notify if base time or location changed
    if (NEW.location is distinct from OLD.location)
       or (NEW.starts_at is distinct from OLD.starts_at)
       or (NEW.ends_at   is distinct from OLD.ends_at)
    then
      insert into public.user_notifications (user_id, kind, team_id, payload)
      select distinct tea.user_id, 'event_changed', NEW.team_id,
             jsonb_build_object(
               'event_id', NEW.id,
               'title', NEW.title,
               'old_location', OLD.location, 'new_location', NEW.location,
               'old_starts_at', OLD.starts_at, 'new_starts_at', NEW.starts_at,
               'old_ends_at', OLD.ends_at, 'new_ends_at', NEW.ends_at,
               'by', auth.uid(),
               'by_name', public.user_display_name(auth.uid())
             )
      from public.team_event_attendance tea
      where tea.event_id = NEW.id;
    end if;
    return NEW;
  end if;

  return null;
end;
$trg_events_notify$;

create trigger trg_notify_team_events
after update or delete on public.team_events
for each row execute procedure public.trg_notify_team_events();

-- Occurrence notifications: cancel or time/location change via overrides
drop trigger if exists trg_notify_event_overrides on public.team_event_overrides;
drop function if exists public.trg_notify_event_overrides();

create or replace function public.trg_notify_event_overrides()
returns trigger
language plpgsql
security definer
set search_path = public
as $trg_overrides_notify$
declare
  v_team uuid;
  v_title text;
begin
  if TG_OP = 'DELETE' then
    select team_id, title into v_team, v_title from public.team_events where id = OLD.event_id;
  else
    select team_id, title into v_team, v_title from public.team_events where id = NEW.event_id;
  end if;

  if TG_OP in ('INSERT','UPDATE') then
    -- Cancelation newly set
    if NEW.canceled and (TG_OP = 'INSERT' or coalesce(OLD.canceled,false) = false) then
      insert into public.user_notifications (user_id, kind, team_id, payload)
      select tea.user_id, 'occurrence_canceled', v_team,
             jsonb_build_object(
               'event_id', NEW.event_id,
               'title', v_title,
               'occ_start', NEW.occ_start,
               'by', auth.uid(),
               'by_name', public.user_display_name(auth.uid())
             )
      from public.team_event_attendance tea
      where tea.event_id = NEW.event_id and tea.occ_start = NEW.occ_start;
      return NEW;
    end if;

    -- Edited fields present or changed
    if (TG_OP = 'INSERT' and (NEW.starts_at is not null or NEW.ends_at is not null or NEW.location is not null))
       or (TG_OP = 'UPDATE' and ((NEW.starts_at is distinct from OLD.starts_at) or (NEW.ends_at is distinct from OLD.ends_at) or (NEW.location is distinct from OLD.location)))
    then
      insert into public.user_notifications (user_id, kind, team_id, payload)
      select tea.user_id, 'occurrence_changed', v_team,
             jsonb_build_object(
               'event_id', NEW.event_id,
               'title', v_title,
               'occ_start', NEW.occ_start,
               'new_starts_at', NEW.starts_at,
               'new_ends_at',   NEW.ends_at,
               'new_location',  NEW.location,
               'by', auth.uid(),
               'by_name', public.user_display_name(auth.uid())
             )
      from public.team_event_attendance tea
      where tea.event_id = NEW.event_id and tea.occ_start = NEW.occ_start;
      return NEW;
    end if;

    return NEW;
  elsif TG_OP = 'DELETE' then
    -- Clearing an override: no notification
    return OLD;
  end if;

  return null;
end;
$trg_overrides_notify$;

create trigger trg_notify_event_overrides
after insert or update or delete on public.team_event_overrides
for each row execute procedure public.trg_notify_event_overrides();

notify pgrst, 'reload schema';

-- ====================================================
-- 11) Showrunner: Series + Shows (no attendance)
-- Mirrors Teams schema with owner-only access
-- ====================================================

-- Types are shared (event_category, recur_freq) from earlier sections

-- SHOW SERIES ---------------------------------------------------------------
create table if not exists public.show_series (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  display_id  text not null unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.show_series enable row level security;

drop policy if exists "show_series select own" on public.show_series;
create policy "show_series select own"
on public.show_series
for select to authenticated
using (owner_id = auth.uid());

drop policy if exists "show_series write own" on public.show_series;
create policy "show_series write own"
on public.show_series
for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Helper to generate display ids
drop function if exists public.next_show_display_id(p_name text);
create or replace function public.next_show_display_id(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare base text := trim(p_name); n int := 0; candidate text;
begin
  if base is null or base = '' then raise exception 'Name required'; end if;
  candidate := base;
  loop
    exit when not exists (select 1 from public.show_series s where s.display_id = candidate);
    n := n + 1; candidate := base || '#' || n;
  end loop;
  return candidate;
end; $$;
grant execute on function public.next_show_display_id(text) to authenticated;

-- SHOW EVENTS (no attendance) ----------------------------------------------
create table if not exists public.show_events (
  id                 uuid primary key default gen_random_uuid(),
  series_id          uuid not null references public.show_series(id) on delete cascade,
  title              text not null,
  description        text,
  location           text,
  category           event_category not null default 'rehearsal',
  -- Applications (showrunner-specific)
  allow_team_applications boolean not null default false,
  allow_individual_applications boolean not null default false,
  tz                 text not null default 'Europe/London',
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  recur_freq         recur_freq not null default 'none',
  recur_interval     int not null default 1,
  recur_byday        text[],
  recur_bymonthday   int[],
  recur_week_of_month int,
  recur_day_of_week  text,
  recur_count        int,
  recur_until        date,
  created_at         timestamptz not null default now(),
  constraint show_events_time_chk check (ends_at > starts_at)
);

create index if not exists show_events_series_idx on public.show_events(series_id);

alter table public.show_events enable row level security;

drop policy if exists "show_events select own" on public.show_events;
create policy "show_events select own"
on public.show_events for select to authenticated
using (exists (select 1 from public.show_series s where s.id = show_events.series_id and s.owner_id = auth.uid()));

drop policy if exists "show_events insert own" on public.show_events;
create policy "show_events insert own"
on public.show_events for insert to authenticated
with check (exists (select 1 from public.show_series s where s.id = show_events.series_id and s.owner_id = auth.uid()));

drop policy if exists "show_events delete own" on public.show_events;
create policy "show_events delete own"
on public.show_events for delete to authenticated
using (exists (select 1 from public.show_series s where s.id = show_events.series_id and s.owner_id = auth.uid()));

-- SHOW EVENT OVERRIDES ------------------------------------------------------
create table if not exists public.show_event_overrides (
  event_id    uuid not null references public.show_events(id) on delete cascade,
  occ_start   timestamptz not null,
  title       text,
  description text,
  location    text,
  category    event_category,
  tz          text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  canceled    boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (event_id, occ_start)
);

alter table public.show_event_overrides enable row level security;

drop policy if exists "show_overrides select own" on public.show_event_overrides;
create policy "show_overrides select own"
on public.show_event_overrides for select to authenticated
using (exists (select 1 from public.show_events e join public.show_series s on s.id = e.series_id where e.id = show_event_overrides.event_id and s.owner_id = auth.uid()));

drop policy if exists "show_overrides write own" on public.show_event_overrides;
create policy "show_overrides write own"
on public.show_event_overrides for all to authenticated
using (exists (select 1 from public.show_events e join public.show_series s on s.id = e.series_id where e.id = show_event_overrides.event_id and s.owner_id = auth.uid()))
with check (exists (select 1 from public.show_events e join public.show_series s on s.id = e.series_id where e.id = show_event_overrides.event_id and s.owner_id = auth.uid()));

-- RPCs: series management
drop function if exists public.create_show_series(p_name text);
create or replace function public.create_show_series(p_name text)
returns table (id uuid, name text, display_id text)
language sql
security definer
set search_path = public
as $$
  with ins as (
    insert into public.show_series(name, display_id, owner_id)
    values (
      p_name,
      public.next_show_display_id(p_name),
      auth.uid()
    )
    returning id, name, display_id
  )
  select id, name, display_id from ins
$$;
grant execute on function public.create_show_series(text) to authenticated;

drop function if exists public.list_my_show_series();
create or replace function public.list_my_show_series()
returns table (id uuid, name text, display_id text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.display_id
  from public.show_series s
  where s.owner_id = auth.uid()
  order by s.created_at desc
$$;
grant execute on function public.list_my_show_series() to authenticated;

drop function if exists public.rename_show_series(p_series_id uuid, p_name text);
create or replace function public.rename_show_series(p_series_id uuid, p_name text)
returns table (id uuid, name text, display_id text)
language sql
security definer
set search_path = public
as $$
  update public.show_series
  set name = p_name
  where id = p_series_id and owner_id = auth.uid();

  select s.id, s.name, s.display_id
  from public.show_series s
  where s.id = p_series_id;
$$;
grant execute on function public.rename_show_series(uuid, text) to authenticated;

drop function if exists public.delete_show_series(p_series_id uuid);
create or replace function public.delete_show_series(p_series_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.show_series where id = p_series_id and owner_id = auth.uid();
end; $$;
grant execute on function public.delete_show_series(uuid) to authenticated;

-- RPC: edit show event patch (like edit_team_event)
drop function if exists public.edit_show_event(p_event_id uuid, p_patch jsonb);
create or replace function public.edit_show_event(p_event_id uuid, p_patch jsonb)
returns public.show_events
language plpgsql security definer set search_path = public as $$
declare v_row public.show_events; v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  if not exists (
    select 1 from public.show_events e
    join public.show_series s on s.id = e.series_id
    where e.id = p_event_id and s.owner_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  update public.show_events
  set title        = coalesce(v_patch->>'title', title),
      description  = coalesce(v_patch->>'description', description),
      location     = coalesce(v_patch->>'location', location),
      category     = coalesce((v_patch->>'category')::event_category, category),
      tz           = coalesce(v_patch->>'tz', tz),
      starts_at    = coalesce((v_patch->>'starts_at')::timestamptz, starts_at),
      ends_at      = coalesce((v_patch->>'ends_at')::timestamptz, ends_at),
      recur_freq   = coalesce((v_patch->>'recur_freq')::recur_freq, recur_freq),
      recur_interval = 1,
      recur_byday = case when v_patch ? 'recur_byday' then
        case jsonb_typeof(v_patch->'recur_byday') when 'array' then (select coalesce(array_agg(value::text), '{}') from jsonb_array_elements_text(v_patch->'recur_byday'))
          when 'string' then array[(v_patch->>'recur_byday')] when 'null' then null else recur_byday end
        else recur_byday end,
      recur_bymonthday = case when v_patch ? 'recur_bymonthday' then
        case jsonb_typeof(v_patch->'recur_bymonthday') when 'array' then (select coalesce(array_agg((e.value)::int), '{}') from jsonb_array_elements(v_patch->'recur_bymonthday') e)
          when 'number' then array[(v_patch->>'recur_bymonthday')::int] when 'null' then null else recur_bymonthday end
        else recur_bymonthday end,
      recur_week_of_month = case when v_patch ? 'recur_week_of_month' then (v_patch->>'recur_week_of_month')::int else recur_week_of_month end,
      recur_until         = coalesce((v_patch->>'recur_until')::timestamptz, recur_until),
      recur_count         = case when v_patch ? 'recur_count' then (v_patch->>'recur_count')::int else recur_count end
  where id = p_event_id
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.edit_show_event(uuid, jsonb) to authenticated;

-- Ensure application columns exist if table was created earlier
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='show_events' and column_name='allow_team_applications'
  ) then
    alter table public.show_events add column allow_team_applications boolean not null default false;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='show_events' and column_name='allow_individual_applications'
  ) then
    alter table public.show_events add column allow_individual_applications boolean not null default false;
  end if;
end$$;

notify pgrst, 'reload schema';

-- ====================================================
-- 7) Team Invitations: table, policies, RPCs
-- ====================================================

-- Table for team invitations
create table if not exists public.team_invitations (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        team_role not null default 'member',
  status      text not null default 'invited', -- invited|accepted|declined|canceled
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (team_id, user_id)
);

alter table public.team_invitations enable row level security;

-- Visibility: invitee or team admins can see
drop policy if exists "invites select if invitee or admin" on public.team_invitations;
create policy "invites select if invitee or admin"
on public.team_invitations for select
to authenticated
using (
  user_id = auth.uid() or exists (
    select 1 from public.team_members m
    where m.team_id = team_invitations.team_id and m.user_id = auth.uid() and m.role = 'admin'
  )
);

-- Inserts via RPC (definer), but restrict direct inserts to admins
drop policy if exists "invites insert if admin" on public.team_invitations;
create policy "invites insert if admin"
on public.team_invitations for insert
to authenticated
with check (
  exists (
    select 1 from public.team_members m
    where m.team_id = team_invitations.team_id and m.user_id = auth.uid() and m.role = 'admin'
  )
);

-- Updates: invitee can update their own record (accept/decline); admins can cancel
drop policy if exists "invites update invitee or admin" on public.team_invitations;
create policy "invites update invitee or admin"
on public.team_invitations for update
to authenticated
using (
  user_id = auth.uid() or exists (
    select 1 from public.team_members m
    where m.team_id = team_invitations.team_id and m.user_id = auth.uid() and m.role = 'admin'
  )
)
with check (
  user_id = auth.uid() or exists (
    select 1 from public.team_members m
    where m.team_id = team_invitations.team_id and m.user_id = auth.uid() and m.role = 'admin'
  )
);

-- RPC: list invitations for current user
drop function if exists public.list_my_invitations();
create or replace function public.list_my_invitations()
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  display_id text,
  role team_role,
  status text,
  invited_by uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.team_id, t.name as team_name, t.display_id, i.role, i.status, i.invited_by, i.created_at
  from public.team_invitations i
  join public.teams t on t.id = i.team_id
  where i.user_id = auth.uid()
  order by i.created_at desc;
$$;
grant execute on function public.list_my_invitations() to authenticated;

-- RPC: accept invitation for current user
drop function if exists public.accept_invitation(p_team_id uuid);
create or replace function public.accept_invitation(p_team_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role team_role;
begin
  select role into v_role
  from public.team_invitations
  where team_id = p_team_id and user_id = auth.uid() and status = 'invited';

  if v_role is null then
    raise exception 'No pending invitation for this team';
  end if;

  -- mark accepted
  update public.team_invitations
  set status = 'accepted'
  where team_id = p_team_id and user_id = auth.uid();

  -- add membership
  insert into public.team_members (team_id, user_id, role)
  values (p_team_id, auth.uid(), v_role)
  on conflict (team_id, user_id) do update set role = excluded.role;
end;
$$;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- RPC: decline invitation for current user
drop function if exists public.decline_invitation(p_team_id uuid);
create or replace function public.decline_invitation(p_team_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.team_invitations
  set status = 'declined'
  where team_id = p_team_id and user_id = auth.uid() and status = 'invited';
end;
$$;
grant execute on function public.decline_invitation(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Helper view to resolve invitee names/emails for listing invites per team
drop view if exists public.team_invitations_with_names;
create view public.team_invitations_with_names as
select
  i.team_id,
  i.user_id,
  i.role,
  i.status,
  i.invited_by,
  i.created_at,
  coalesce(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1),
    'Unknown'
  ) as display_name,
  u.email
from public.team_invitations i
left join auth.users u on u.id = i.user_id;

grant select on public.team_invitations_with_names to authenticated;

notify pgrst, 'reload schema';

-- ====================================================
-- 8) User notifications (removed from team, etc.)
-- ====================================================

create table if not exists public.user_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null, -- e.g., 'removed_from_team'
  team_id     uuid references public.teams(id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

drop policy if exists "notifications select own" on public.user_notifications;
create policy "notifications select own"
on public.user_notifications for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "notifications update own" on public.user_notifications;
create policy "notifications update own"
on public.user_notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- RPC: list my notifications (excluding deleted)
drop function if exists public.list_my_notifications();
create or replace function public.list_my_notifications()
returns table (
  id uuid,
  kind text,
  team_id uuid,
  team_name text,
  display_id text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.team_id, t.name as team_name, t.display_id, n.payload, n.read_at, n.created_at
  from public.user_notifications n
  left join public.teams t on t.id = n.team_id
  where n.user_id = auth.uid() and n.deleted_at is null
  order by n.created_at desc;
$$;
grant execute on function public.list_my_notifications() to authenticated;

-- RPCs: mark read / delete (soft)
drop function if exists public.mark_notification_read(p_id uuid);
create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.user_notifications
  set read_at = coalesce(read_at, now())
  where id = p_id and user_id = auth.uid();
end;
$$;
grant execute on function public.mark_notification_read(uuid) to authenticated;

drop function if exists public.delete_notification(p_id uuid);
create or replace function public.delete_notification(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.user_notifications
  set deleted_at = now()
  where id = p_id and user_id = auth.uid();
end;
$$;
grant execute on function public.delete_notification(uuid) to authenticated;

-- Hook notification into remove_member
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
  v_target_name text;
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

  -- Notify the removed user (if not self-removal)
  if not v_self then
    insert into public.user_notifications (user_id, kind, team_id, payload)
    values (p_user_id, 'removed_from_team', p_team_id, '{}'::jsonb);
  end if;
end;
$$;

grant execute on function public.remove_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ====================================================
-- 9) Team change log (90-day feed)
-- ====================================================

create table if not exists public.team_change_log (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  actor_user_id   uuid references auth.users(id),
  action          text not null, -- e.g., 'member_removed','role_changed','event_created','event_deleted','event_updated','invite_sent','invite_accepted','invite_declined','invite_canceled','attendance_changed','occurrence_canceled','occurrence_edited','occurrence_override_cleared','team_renamed'
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

alter table public.team_change_log enable row level security;

drop policy if exists "log select if member" on public.team_change_log;
create policy "log select if member"
on public.team_change_log for select
to authenticated
using (
  exists (
    select 1 from public.team_members m
    where m.team_id = team_change_log.team_id and m.user_id = auth.uid()
  )
);

-- Helper to resolve actor name in feeds
drop view if exists public.team_change_log_with_names;
create view public.team_change_log_with_names as
select
  l.id,
  l.team_id,
  l.actor_user_id,
  coalesce(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1),
    'Unknown'
  ) as actor_name,
  l.action,
  l.details,
  l.created_at
from public.team_change_log l
left join auth.users u on u.id = l.actor_user_id;

grant select on public.team_change_log_with_names to authenticated;

-- RPC: list updates for a team (last 90 days)
drop function if exists public.list_team_updates(p_team_id uuid);
create or replace function public.list_team_updates(p_team_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  actor_user_id uuid,
  actor_name text,
  details jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.created_at, l.action, l.actor_user_id, l.actor_name, l.details
  from public.team_change_log_with_names l
  where l.team_id = p_team_id
    and l.created_at >= now() - interval '90 days'
    and exists (
      select 1 from public.team_members m
      where m.team_id = p_team_id and m.user_id = auth.uid()
    )
  order by l.created_at desc
$$;
grant execute on function public.list_team_updates(uuid) to authenticated;

-- Helper to log from functions
drop function if exists public._log_team_change(p_team_id uuid, p_action text, p_details jsonb);
create or replace function public._log_team_change(p_team_id uuid, p_action text, p_details jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  insert into public.team_change_log(team_id, actor_user_id, action, details)
  values (p_team_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb));
end;
$$;
grant execute on function public._log_team_change(uuid, text, jsonb) to authenticated;

-- Helper: consistent display name resolution
drop function if exists public.user_display_name(p_user_id uuid);
create or replace function public.user_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    au.raw_user_meta_data->>'display_name',
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    split_part(au.email, '@', 1),
    'Unknown'
  )
  from auth.users au where au.id = p_user_id
$$;

-- Hook logs into existing RPCs
-- 1) remove_member: already replaced above; add log
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
  v_target_name text;
begin
  v_self := (p_user_id = auth.uid());

  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;
  if not v_self and not v_is_admin then
    raise exception 'Only admins can remove other members';
  end if;

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

  -- Remove membership
  delete from public.team_members
  where team_id = p_team_id and user_id = p_user_id;

  -- Remove all attendance by this user for this team's events
  delete from public.team_event_attendance tea
  using public.team_events e
  where tea.event_id = e.id
    and e.team_id = p_team_id
    and tea.user_id = p_user_id;

  -- Log and notify (skip self-removal)
  if not v_self then
    v_target_name := public.user_display_name(p_user_id);
    perform public._log_team_change(
      p_team_id,
      'member_removed',
      jsonb_build_object('target_user_id', p_user_id, 'target_name', v_target_name)
    );
    insert into public.user_notifications (user_id, kind, team_id, payload)
    values (
      p_user_id,
      'removed_from_team',
      p_team_id,
      jsonb_build_object('by', auth.uid(), 'by_name', public.user_display_name(auth.uid()))
    );
  end if;
end;
$$;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- 2) set_member_role: log promotion/demotion
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
  v_new_role public.team_role := p_role::public.team_role;
  v_target_name text;
  v_old_role public.team_role;
begin
  if p_role not in ('admin','member') then
    raise exception 'Invalid role %', p_role;
  end if;
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin'
  ) into v_is_admin;
  if not v_is_admin then
    raise exception 'Only team admins can change roles';
  end if;
  if v_new_role = 'member' then
    select count(*) from public.team_members
    where team_id = p_team_id and role = 'admin'
    into v_admin_count;
    if v_admin_count <= 1 then
      if exists (select 1 from public.team_members where team_id = p_team_id and user_id = p_user_id and role = 'admin') then
        raise exception 'Cannot demote the last admin';
      end if;
    end if;
  end if;
  -- current role
  select role into v_old_role from public.team_members where team_id = p_team_id and user_id = p_user_id;
  if v_old_role = v_new_role then
    return;
  end if;

  update public.team_members set role = v_new_role where team_id = p_team_id and user_id = p_user_id;
  v_target_name := public.user_display_name(p_user_id);
  perform public._log_team_change(
    p_team_id,
    'role_changed',
    jsonb_build_object('target_user_id', p_user_id, 'target_name', v_target_name, 'new_role', v_new_role)
  );

  -- Notify target for admin grant/revoke
  if v_new_role = 'admin' then
    insert into public.user_notifications (user_id, kind, team_id, payload)
    values (
      p_user_id,
      'role_admin_granted',
      p_team_id,
      jsonb_build_object('by', auth.uid(), 'by_name', public.user_display_name(auth.uid()))
    );
  elsif v_new_role = 'member' then
    insert into public.user_notifications (user_id, kind, team_id, payload)
    values (
      p_user_id,
      'role_admin_revoked',
      p_team_id,
      jsonb_build_object('by', auth.uid(), 'by_name', public.user_display_name(auth.uid()))
    );
  end if;
end;
$$;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- 3) rename_team: log rename
drop function if exists public.rename_team(p_team_id uuid, p_name text);
create or replace function public.rename_team(p_team_id uuid, p_name text)
returns table (id uuid, name text, display_id text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_old text;
begin
  select name into v_old from public.teams where id = p_team_id;
  update public.teams set name = p_name where id = p_team_id;
  perform public._log_team_change(p_team_id, 'team_renamed', jsonb_build_object('old_name', v_old, 'new_name', p_name));
  return query select t.id, t.name, t.display_id from public.teams t where t.id = p_team_id;
end;
$$;
grant execute on function public.rename_team(uuid, text) to authenticated;

-- 4) Invitations: log offer/accept/decline/cancel
drop function if exists public.add_member_by_email(p_team_id uuid, p_email text);
drop function if exists public.add_member_by_email(p_team_id uuid, p_email text, p_role text);
create or replace function public.add_member_by_email(p_team_id uuid, p_email text, p_role text default 'member')
returns void
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare v_user uuid; v_is_admin boolean; v_role public.team_role := coalesce(p_role, 'member')::public.team_role;
begin
  select exists (select 1 from public.team_members m where m.team_id = p_team_id and m.user_id = auth.uid() and m.role = 'admin') into v_is_admin;
  if not v_is_admin then raise exception 'Only team admins can invite members'; end if;
  select id into v_user from auth.users where lower(email) = lower(p_email);
  if v_user is null then raise exception 'User with that email does not exist'; end if;
  insert into public.team_invitations (team_id, user_id, role, status, invited_by)
  values (p_team_id, v_user, v_role, 'invited', auth.uid())
  on conflict (team_id, user_id) do update set role = excluded.role, status = 'invited', invited_by = auth.uid(), created_at = now();
  perform public._log_team_change(
    p_team_id,
    'invite_sent',
    jsonb_build_object('target_user_id', v_user, 'target_name', public.user_display_name(v_user), 'role', v_role)
  );
end;
$$;
grant execute on function public.add_member_by_email(uuid, text, text) to authenticated;

drop function if exists public.accept_invitation(p_team_id uuid);
create or replace function public.accept_invitation(p_team_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_role public.team_role;
begin
  select role into v_role from public.team_invitations where team_id = p_team_id and user_id = auth.uid() and status = 'invited';
  if v_role is null then raise exception 'No pending invitation for this team'; end if;
  update public.team_invitations set status = 'accepted' where team_id = p_team_id and user_id = auth.uid();
  insert into public.team_members (team_id, user_id, role) values (p_team_id, auth.uid(), v_role)
  on conflict (team_id, user_id) do update set role = excluded.role;
  perform public._log_team_change(
    p_team_id,
    'invite_accepted',
    jsonb_build_object('target_user_id', auth.uid(), 'target_name', public.user_display_name(auth.uid()), 'role', v_role)
  );
end;
$$;
grant execute on function public.accept_invitation(uuid) to authenticated;

drop function if exists public.decline_invitation(p_team_id uuid);
create or replace function public.decline_invitation(p_team_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.team_invitations set status = 'declined' where team_id = p_team_id and user_id = auth.uid() and status = 'invited';
  perform public._log_team_change(
    p_team_id,
    'invite_declined',
    jsonb_build_object('target_user_id', auth.uid(), 'target_name', public.user_display_name(auth.uid()))
  );
end;
$$;
grant execute on function public.decline_invitation(uuid) to authenticated;

-- For cancel invite via direct update, add trigger to log when status becomes canceled
drop trigger if exists trg_log_invite_cancel on public.team_invitations;
drop function if exists public.trg_team_invitations_log_cancel();
create or replace function public.trg_team_invitations_log_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE' and NEW.status = 'canceled' and coalesce(OLD.status,'') <> 'canceled' then
    perform public._log_team_change(
      NEW.team_id,
      'invite_canceled',
      jsonb_build_object('target_user_id', NEW.user_id, 'target_name', public.user_display_name(NEW.user_id))
    );
  end if;
  return NEW;
end;
$$;
create trigger trg_log_invite_cancel after update on public.team_invitations
for each row execute procedure public.trg_team_invitations_log_cancel();

-- Events: triggers for create/update/delete
drop function if exists public.trg_team_events_log();
create or replace function public.trg_team_events_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    perform public._log_team_change(NEW.team_id, 'event_created', jsonb_build_object('event_id', NEW.id, 'title', NEW.title));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    perform public._log_team_change(NEW.team_id, 'event_updated', jsonb_build_object('event_id', NEW.id, 'title', NEW.title));
    return NEW;
  elsif TG_OP = 'DELETE' then
    perform public._log_team_change(OLD.team_id, 'event_deleted', jsonb_build_object('event_id', OLD.id, 'title', OLD.title));
    return OLD;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_log_team_events on public.team_events;
create trigger trg_log_team_events after insert or update or delete on public.team_events
for each row execute procedure public.trg_team_events_log();

-- Overrides: insert/update/delete
drop function if exists public.trg_team_event_overrides_log();
create or replace function public.trg_team_event_overrides_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_team uuid; v_title text;
begin
  if TG_OP in ('INSERT','UPDATE') then
    select team_id, title into v_team, v_title from public.team_events where id = NEW.event_id;
    if NEW.canceled and (TG_OP='INSERT' or coalesce(OLD.canceled,false) = false) then
      perform public._log_team_change(v_team, 'occurrence_canceled', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', v_title));
    else
      perform public._log_team_change(v_team, 'occurrence_edited', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', v_title));
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    select team_id, title into v_team, v_title from public.team_events where id = OLD.event_id;
    perform public._log_team_change(v_team, 'occurrence_override_cleared', jsonb_build_object('event_id', OLD.event_id, 'occ_start', OLD.occ_start, 'title', v_title));
    return OLD;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_log_team_event_overrides on public.team_event_overrides;
create trigger trg_log_team_event_overrides after insert or update or delete on public.team_event_overrides
for each row execute procedure public.trg_team_event_overrides_log();

-- Attendance: log when user toggles
drop function if exists public.trg_team_event_attendance_log();
create or replace function public.trg_team_event_attendance_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_team uuid; v_title text; v_uid uuid := coalesce(auth.uid(), NEW.user_id);
begin
  select e.team_id, e.title into v_team, v_title from public.team_events e where e.id = (case when TG_OP='DELETE' then OLD.event_id else NEW.event_id end);
  if TG_OP='INSERT' then
    perform public._log_team_change(
      v_team,
      'attendance_changed',
      jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'attending', NEW.attending, 'by', v_uid, 'by_name', public.user_display_name(v_uid), 'title', v_title)
    );
    return NEW;
  elsif TG_OP='UPDATE' then
    if coalesce(OLD.attending,false) <> coalesce(NEW.attending,false) then
      perform public._log_team_change(
        v_team,
        'attendance_changed',
        jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'attending', NEW.attending, 'by', v_uid, 'by_name', public.user_display_name(v_uid), 'title', v_title)
      );
    end if;
    return NEW;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_log_team_event_attendance on public.team_event_attendance;
create trigger trg_log_team_event_attendance after insert or update on public.team_event_attendance
for each row execute procedure public.trg_team_event_attendance_log();

notify pgrst, 'reload schema';

-- Attendance for team events
create table if not exists public.team_event_attendance (
  event_id    uuid not null references public.team_events(id) on delete cascade,
  occ_start   timestamptz not null,
  user_id     uuid not null default auth.uid(),
  attending   boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (event_id, occ_start, user_id)
);

create index if not exists team_event_attendance_event_time_idx
  on public.team_event_attendance (event_id, occ_start);

alter table public.team_event_attendance enable row level security;

drop policy if exists "attendance select if team member" on public.team_event_attendance;
create policy "attendance select if team member"
on public.team_event_attendance for select
to authenticated
using (
  exists (
    select 1 from public.team_events e
    join public.team_members m on m.team_id = e.team_id
    where e.id = team_event_attendance.event_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "attendance upsert own if member" on public.team_event_attendance;
create policy "attendance upsert own if member"
on public.team_event_attendance for insert
to authenticated
with check (
  auth.uid() = user_id and exists (
    select 1 from public.team_events e
    join public.team_members m on m.team_id = e.team_id
    where e.id = team_event_attendance.event_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "attendance update own if member" on public.team_event_attendance;
create policy "attendance update own if member"
on public.team_event_attendance for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop view if exists public.team_event_attendance_with_names;

create view public.team_event_attendance_with_names as
select
  tea.event_id,
  tea.occ_start,
  tea.user_id,
  tea.attending,
  e.team_id,
  coalesce(
    au.raw_user_meta_data->>'full_name',  -- preferred
    au.raw_user_meta_data->>'name',       -- common alt
    au.email,                             -- fallback
    'Unknown'
  ) as full_name,
  (tea.user_id = auth.uid()) as _is_me
from public.team_event_attendance tea
join public.team_events e on e.id = tea.event_id
left join auth.users au on au.id = tea.user_id;

grant select on public.team_event_attendance_with_names to authenticated;

 -- ===============================================
-- 1) Ensure PROFILES table exists (with full_name)
-- ===============================================
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='profiles'
  ) then
    create table public.profiles (
      id         uuid primary key references auth.users(id) on delete cascade,
      full_name  text,
      updated_at timestamptz not null default now()
    );

    alter table public.profiles enable row level security;

    drop policy if exists "profiles read own or team" on public.profiles;
    create policy "profiles read own or team"
      on public.profiles for select
      to authenticated
      using (true); -- relax as needed; typically profiles are readable by members

    drop policy if exists "profiles upsert own" on public.profiles;
    create policy "profiles upsert own"
      on public.profiles for insert
      to authenticated
      with check (id = auth.uid());

    drop policy if exists "profiles update own" on public.profiles;
    create policy "profiles update own"
      on public.profiles for update
      to authenticated
      using (id = auth.uid())
      with check (id = auth.uid());
  else
    -- Ensure full_name column exists
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='profiles' and column_name='full_name'
    ) then
      alter table public.profiles add column full_name text;
    end if;
  end if;
end
$$;

-- ====================================================
-- 2) Ensure TEAM EVENT ATTENDANCE table + policies
-- ====================================================
do $$
declare has_tbl boolean;
begin
  select exists(
    select 1 from information_schema.tables
    where table_schema='public' and table_name='team_event_attendance'
  ) into has_tbl;

  if not has_tbl then
    create table public.team_event_attendance (
      event_id   uuid not null references public.team_events(id) on delete cascade,
      occ_start  timestamptz not null,
      user_id    uuid not null default auth.uid(),
      attending  boolean not null default true,
      created_at timestamptz not null default now(),
      primary key (event_id, occ_start, user_id)
    );
  end if;

  -- Ensure occ_start exists (rename common mistakes)
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='team_event_attendance' and column_name='occ_start'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='team_event_attendance' and column_name='base_start'
    ) then
      alter table public.team_event_attendance rename column base_start to occ_start;
    else
      alter table public.team_event_attendance add column occ_start timestamptz;
      alter table public.team_event_attendance alter column occ_start set not null;
    end if;
  end if;

  create index if not exists team_event_attendance_event_time_idx
    on public.team_event_attendance (event_id, occ_start);

  alter table public.team_event_attendance enable row level security;

  drop policy if exists "attendance select if team member" on public.team_event_attendance;
  create policy "attendance select if team member"
  on public.team_event_attendance for select
  to authenticated
  using (
    exists (
      select 1
      from public.team_events e
      join public.team_members m on m.team_id = e.team_id
      where e.id = team_event_attendance.event_id
        and m.user_id = auth.uid()
    )
  );

  drop policy if exists "attendance upsert own if member" on public.team_event_attendance;
  create policy "attendance upsert own if member"
  on public.team_event_attendance for insert
  to authenticated
  with check (
    auth.uid() = user_id and exists (
      select 1 from public.team_events e
      join public.team_members m on m.team_id = e.team_id
      where e.id = team_event_attendance.event_id
        and m.user_id = auth.uid()
    )
  );

  drop policy if exists "attendance update own if member" on public.team_event_attendance;
  create policy "attendance update own if member"
  on public.team_event_attendance for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
end
$$;

-- ====================================================
-- 3) Helper VIEW: robust attendee name resolution
-- ====================================================
drop view if exists public.team_event_attendance_with_names;

create view public.team_event_attendance_with_names as
select
  tea.event_id,
  tea.occ_start,
  tea.user_id,
  tea.attending,
  e.team_id,
  coalesce(
    au.raw_user_meta_data->>'display_name',
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    split_part(au.email, '@', 1),
    'Unknown'
  ) as full_name,
  (tea.user_id = auth.uid()) as _is_me
from public.team_event_attendance tea
join public.team_events e on e.id = tea.event_id
left join auth.users au on au.id = tea.user_id;

grant select on public.team_event_attendance_with_names to authenticated;

do $$
begin
  -- Add 'daily' to the recur_freq enum if it's not already there
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'recur_freq' and e.enumlabel = 'daily'
  ) then
    alter type public.recur_freq add value 'daily' after 'weekly';
  end if;
end
$$;
-- =============================================================================
-- 6) PGRST schema reload (make new RPCs visible immediately)
-- =============================================================================
notify pgrst, 'reload schema';
