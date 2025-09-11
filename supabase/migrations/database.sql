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

-- Populate occurrences for an event over a window (no invites)
-- Limit occurrences to max 12 per event (auto-sync)
drop function if exists public.sync_event_occurrences_12(p_event_id uuid);
create or replace function public.sync_event_occurrences_12(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  e record; byday text[]; e_dow text; day_interval interval;
  occ timestamptz; d timestamptz; n int := 0; cap int := 12;
  wom int; wd2 text; y int; m int; dom int; month_start date;
  until_date date; maxn int;
begin
  select * into e from public.show_events where id = p_event_id;
  if e.id is null then raise exception 'event not found'; end if;
  day_interval := e.starts_at - date_trunc('day', e.starts_at);
  byday := e.recur_byday; e_dow := substring(upper(to_char(e.starts_at, 'DY')), 1, 2);
  if e.recur_freq = 'weekly' and (byday is null or array_length(byday,1) is null) then byday := array[e_dow]; end if;
  wom := e.recur_week_of_month; until_date := e.recur_until; maxn := coalesce(e.recur_count, cap);
  cap := least(cap, coalesce(maxn, cap));

  if e.recur_freq = 'none' then
    occ := e.starts_at;
    if until_date is null or occ::date <= until_date then
      perform public.ensure_occurrence(p_event_id, occ);
    end if;
    return;
  elsif e.recur_freq = 'weekly' then
    d := date_trunc('day', e.starts_at);
    while n < cap loop
      wd2 := substring(upper(to_char(d,'DY')),1,2);
      if (byday is null and wd2 = e_dow) or (byday is not null and wd2 = any(byday)) then
        occ := date_trunc('day', d) + day_interval;
        if occ >= e.starts_at and (until_date is null or occ::date <= until_date) then
          perform public.ensure_occurrence(p_event_id, occ); n := n + 1;
          if n >= cap then exit; end if;
        end if;
      end if;
      d := d + interval '1 day';
    end loop;
  elsif e.recur_freq = 'monthly' then
    d := date_trunc('month', e.starts_at);
    while n < cap loop
      y := extract(year from d)::int; m := extract(month from d)::int;
      month_start := make_date(y, m, 1);
      if wom is not null and byday is not null and array_length(byday,1) = 1 then
        wd2 := byday[1]; dom := 1;
        while substring(upper(to_char(make_timestamp(y,m,dom,0,0,0),'DY')),1,2) <> wd2 loop dom := dom + 1; end loop;
        if wom > 0 then dom := dom + 7 * (wom - 1);
        else dom := extract(day from (month_start + interval '1 month - 1 day'))::int;
             while substring(upper(to_char(make_timestamp(y,m,dom,0,0,0),'DY')),1,2) <> wd2 loop dom := dom - 1; end loop;
        end if;
      else
        dom := coalesce(e.recur_bymonthday[1], extract(day from e.starts_at)::int);
        dom := least(dom, extract(day from (month_start + interval '1 month - 1 day'))::int);
      end if;
      occ := (make_timestamp(y, m, dom, 0, 0, 0) at time zone 'UTC') + day_interval;
      if occ >= e.starts_at and (until_date is null or occ::date <= until_date) then
        perform public.ensure_occurrence(p_event_id, occ); n := n + 1;
      end if;
      d := date_trunc('month', d) + interval '1 month';
    end loop;
  else
    occ := e.starts_at;
    if until_date is null or occ::date <= until_date then
      perform public.ensure_occurrence(p_event_id, occ);
    end if;
  end if;
end; $$;

-- Trigger to auto-sync first 12 occurrences when an event is created/edited
drop trigger if exists trg_sync_event_occurrences on public.show_events;
drop function if exists public.trg_sync_event_occurrences();
create or replace function public.trg_sync_event_occurrences()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.sync_event_occurrences_12(NEW.id);
  return NEW;
end; $$;

create trigger trg_sync_event_occurrences
after insert or update of starts_at, ends_at, recur_freq, recur_byday, recur_bymonthday, recur_week_of_month, recur_day_of_week, recur_count, recur_until
on public.show_events
for each row execute procedure public.trg_sync_event_occurrences();
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

-- Compatibility shim: expose show_event_overrides as a view backed by occurrences
-- Some clients may still read this name; map to occurrence overrides.
drop view if exists public.show_event_overrides;
create view public.show_event_overrides as
select
  so.event_id,
  so.base_start as occ_start,
  so.title,
  so.description,
  so.location,
  so.category,
  so.tz,
  so.starts_at,
  so.ends_at,
  so.canceled,
  so.base_start as created_at
from public.show_occurrences so
where so.event_id is not null;

grant select on public.show_event_overrides to authenticated;

-- ====================================================
-- Showrunner notifications: cancel series / cancel occurrence
-- ====================================================

-- Notify team members when a show occurrence is canceled via override
drop function if exists public.trg_notify_show_occ_cancel();
create or replace function public.trg_notify_show_occ_cancel()
returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_event uuid;
  v_occ   timestamptz;
  v_title text;
  v_prod  text;
  l record;
begin
  if TG_OP = 'INSERT' then
    v_event := NEW.event_id;
    if TG_TABLE_NAME = 'show_occurrences' then
      v_occ := NEW.base_start;
    else
      v_occ := NEW.occ_start;
    end if;
    if coalesce(NEW.canceled,false) = false then return NEW; end if;
  elsif TG_OP = 'UPDATE' then
    if coalesce(NEW.canceled,false) = coalesce(OLD.canceled,false) then return NEW; end if;
    if coalesce(NEW.canceled,false) = false then return NEW; end if;
    v_event := NEW.event_id;
    if TG_TABLE_NAME = 'show_occurrences' then
      v_occ := NEW.base_start;
    else
      v_occ := NEW.occ_start;
    end if;
  else
    return NULL;
  end if;

  select coalesce(e.title, s.name), s.name into v_title, v_prod from public.show_events e join public.show_series s on s.id = e.series_id where e.id = v_event;

  insert into public.user_notifications (user_id, kind, team_id, payload)
  select m.user_id, 'show_occurrence_canceled', x.team_id,
         jsonb_build_object('event_id', v_event, 'occ_start', v_occ, 'title', v_title, 'by', auth.uid(), 'by_name', public.user_display_name(auth.uid()))
  from (
    select sti.team_id
    from public.show_team_invitations sti
    where sti.event_id = v_event and sti.occ_start = v_occ and coalesce(sti.status,'') <> 'dismissed'
    union
    select ssti.team_id
    from public.show_series_team_invitations ssti
    where ssti.event_id = v_event and coalesce(ssti.status,'') <> 'dismissed'
      and not exists (
        select 1 from public.show_team_invitations o
        where o.event_id = v_event and o.occ_start = v_occ and o.team_id = ssti.team_id
      )
  ) x
  join public.team_members m on m.team_id = x.team_id;

  -- For each team: accepted → log removed booking; invited → delete prior invite log (no new entry)
  for l in
    with lineup as (
      select coalesce(sti.team_id, ssti.team_id) as team_id,
             exists (
               select 1 from public.show_team_invitations a
               where a.event_id = v_event and a.occ_start = v_occ and a.team_id = coalesce(sti.team_id, ssti.team_id) and a.status = 'accepted'
             ) as had_accepted
      from public.show_series_team_invitations ssti
      left join public.show_team_invitations sti
        on sti.event_id = v_event and sti.occ_start = v_occ and sti.team_id = ssti.team_id
      where ssti.event_id = v_event and coalesce(ssti.status,'') <> 'dismissed'
      union
      select sti.team_id, (sti.status = 'accepted') as had_accepted
      from public.show_team_invitations sti
      where sti.event_id = v_event and sti.occ_start = v_occ and coalesce(sti.status,'') <> 'dismissed'
    )
    select * from lineup
  loop
    if l.had_accepted then
      perform public._log_team_change(l.team_id, 'show_booking_removed', jsonb_build_object('event_id', v_event, 'occ_start', v_occ, 'title', v_title, 'production_name', v_prod));
    else
      delete from public.team_change_log
      where team_id = l.team_id
        and action in ('show_lineup_invited','invite_withdrawn')
        and (details->>'event_id')::uuid = v_event
        and (details->>'occ_start')::timestamptz = v_occ;
    end if;
  end loop;

  return NEW;
end; $$;

drop trigger if exists trg_notify_show_occ_cancel on public.show_occurrences;
create trigger trg_notify_show_occ_cancel
after insert or update on public.show_occurrences
for each row execute procedure public.trg_notify_show_occ_cancel();

-- Notify team members when an entire show (series or single) is deleted
drop function if exists public.trg_notify_show_deleted();
create or replace function public.trg_notify_show_deleted()
returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_title text := OLD.title;
  v_prod  text;
  l record;
  acc record;
begin
  -- Mark this transaction as deleting an event so row-level deletes can skip duplicate logs
  perform set_config('improvhub.event_deleting', OLD.id::text, true);
  select s.name into v_prod from public.show_series s where s.id = OLD.series_id;
  v_title := coalesce(v_title, v_prod);
  -- Teams from series defaults
  insert into public.user_notifications (user_id, kind, team_id, payload)
  select m.user_id, 'show_series_canceled', ssti.team_id,
         jsonb_build_object(
           'event_id', OLD.id,
           'title', v_title,
           'by', auth.uid(),
           'by_name', public.user_display_name(auth.uid())
         )
  from public.show_series_team_invitations ssti
  join public.team_members m on m.team_id = ssti.team_id
  where ssti.event_id = OLD.id and coalesce(ssti.status,'') <> 'dismissed'
  union
  -- Teams from any per-occ rows (deduped by team)
  select distinct m.user_id, 'show_series_canceled', sti.team_id,
         jsonb_build_object(
           'event_id', OLD.id,
           'title', v_title,
           'by', auth.uid(),
           'by_name', public.user_display_name(auth.uid())
         )
  from public.show_team_invitations sti
  join public.team_members m on m.team_id = sti.team_id
  where sti.event_id = OLD.id and coalesce(sti.status,'') <> 'dismissed';

  -- Team change log cleanup vs removal notice
  -- If a team never accepted any lineup for this event, delete prior invitation logs.
  -- If any acceptance existed, keep invite and acceptance logs and add a booking removed entry per accepted occurrence.
  for l in
    select team_id, bool_or(status = 'accepted') as had_accepted
    from public.show_team_invitations
    where event_id = OLD.id
    group by team_id
  loop
    if l.had_accepted then
      for acc in
        select occ_start from public.show_team_invitations
        where event_id = OLD.id and status = 'accepted' and team_id = l.team_id
      loop
        perform public._log_team_change(
          l.team_id,
          'show_booking_removed',
          jsonb_build_object('event_id', OLD.id, 'occ_start', acc.occ_start, 'title', v_title, 'production_name', v_prod)
        );
      end loop;
    else
      delete from public.team_change_log
      where team_id = l.team_id
        and action in ('show_lineup_invited','invite_withdrawn')
        and (details->>'event_id')::uuid = OLD.id;
    end if;
  end loop;

  return OLD;
end; $$;

drop trigger if exists trg_notify_show_deleted on public.show_events;
create trigger trg_notify_show_deleted
before delete on public.show_events
for each row execute procedure public.trg_notify_show_deleted();

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

-- Show event overrides are now stored directly on show_occurrences as optional columns

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

-- Occurrence helpers for show lineup
drop function if exists public._occ_end_by_duration(p_event_id uuid, p_base_start timestamptz);
create or replace function public._occ_end_by_duration(p_event_id uuid, p_base_start timestamptz)
returns timestamptz
language sql stable security definer set search_path=public as $$
  select p_base_start + (e.ends_at - e.starts_at) from public.show_events e where e.id = p_event_id
$$;

drop function if exists public.ensure_occurrence(p_event_id uuid, p_base_start timestamptz);
create or replace function public.ensure_occurrence(
  p_event_id   uuid,
  p_base_start timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_end timestamptz;
  v_series uuid;
begin
  select id into v_id from public.show_occurrences where event_id = p_event_id and base_start = p_base_start;
  if v_id is not null then return v_id; end if;

  select s.id into v_series
  from public.show_events e
  join public.show_series s on s.id = e.series_id
  where e.id = p_event_id;

  select public._occ_end_by_duration(p_event_id, p_base_start) into v_end;
  insert into public.show_occurrences(event_id, series_id, base_start, base_end)
  values (p_event_id, v_series, p_base_start, v_end)
  returning id into v_id;
  return v_id;
end;
$$;

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

-- ====================================================
-- 12) Show lineup: occurrences + invitations per occurrence
-- ====================================================

-- Canonical occurrence rows (authoritative per-night keys)
create table if not exists public.show_occurrences (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.show_events(id) on delete cascade,
  series_id   uuid references public.show_series(id) on delete cascade,
  base_start  timestamptz not null,
  base_end    timestamptz not null,
  -- Optional per-occurrence overrides
  title       text,
  description text,
  location    text,
  category    event_category,
  tz          text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  canceled    boolean not null default false,
  unique (event_id, base_start)
);

-- Ensure shape if table existed
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='show_occurrences' and column_name='series_id'
  ) then
    alter table public.show_occurrences add column series_id uuid references public.show_series(id) on delete cascade;
  end if;
  begin
    alter table public.show_occurrences alter column event_id drop not null;
  exception when others then null; end;
end $$;

-- Ensure override columns exist for older DBs
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='title') then
    alter table public.show_occurrences add column title text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='description') then
    alter table public.show_occurrences add column description text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='location') then
    alter table public.show_occurrences add column location text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='category') then
    alter table public.show_occurrences add column category event_category;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='tz') then
    alter table public.show_occurrences add column tz text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='starts_at') then
    alter table public.show_occurrences add column starts_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='ends_at') then
    alter table public.show_occurrences add column ends_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='show_occurrences' and column_name='canceled') then
    alter table public.show_occurrences add column canceled boolean not null default false;
  end if;
end $$;

-- Link a team to a specific show occurrence (event_id + occ_start)
create table if not exists public.show_team_invitations (
  event_id    uuid not null references public.show_events(id) on delete cascade,
  occ_start   timestamptz not null, -- base occurrence start (series key)
  team_id     uuid not null references public.teams(id) on delete cascade,
  status      text not null default 'invited', -- invited|accepted|declined|canceled
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  primary key (event_id, occ_start, team_id)
);

-- Add occurrence link
alter table public.show_team_invitations
  add column if not exists occ_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'show_team_invites_occ_fk'
      and conrelid = 'public.show_team_invitations'::regclass
  ) then
    alter table public.show_team_invitations
      add constraint show_team_invites_occ_fk
      foreign key (occ_id) references public.show_occurrences(id)
      on delete cascade;
  end if;
end $$;

alter table public.show_team_invitations enable row level security;

-- Select if: show owner, or member of invited team
drop policy if exists "sti select owner or team" on public.show_team_invitations;
create policy "sti select owner or team"
on public.show_team_invitations for select to authenticated
using (
  exists (
    select 1 from public.show_events e
    join public.show_series s on s.id = e.series_id
    where e.id = show_team_invitations.event_id and s.owner_id = auth.uid()
  ) or exists (
    select 1 from public.team_members m
    where m.team_id = show_team_invitations.team_id and m.user_id = auth.uid()
  )
);

-- Insert/delete by show owner only
drop policy if exists "sti write owner" on public.show_team_invitations;
create policy "sti write owner"
on public.show_team_invitations for insert to authenticated
with check (
  exists (
    select 1 from public.show_events e
    join public.show_series s on s.id = e.series_id
    where e.id = show_team_invitations.event_id and s.owner_id = auth.uid()
  )
);

drop policy if exists "sti update owner or team-admin" on public.show_team_invitations;
create policy "sti update owner or team-admin"
on public.show_team_invitations for update to authenticated
using (
  -- owner can update/cancel
  exists (
    select 1 from public.show_events e
    join public.show_series s on s.id = e.series_id
    where e.id = show_team_invitations.event_id and s.owner_id = auth.uid()
  )
  or
  -- team admin can accept/decline
  exists (
    select 1 from public.team_members m
    where m.team_id = show_team_invitations.team_id and m.user_id = auth.uid() and m.role = 'admin'
  )
)
with check (
  -- same as using
  exists (
    select 1 from public.show_events e
    join public.show_series s on s.id = e.series_id
    where e.id = show_team_invitations.event_id and s.owner_id = auth.uid()
  )
  or exists (
    select 1 from public.team_members m
    where m.team_id = show_team_invitations.team_id and m.user_id = auth.uid() and m.role = 'admin'
  )
);

drop policy if exists "sti delete owner" on public.show_team_invitations;
create policy "sti delete owner"
on public.show_team_invitations for delete to authenticated
using (
  exists (
    select 1 from public.show_events e
    join public.show_series s on s.id = e.series_id
    where e.id = show_team_invitations.event_id and s.owner_id = auth.uid()
  )
);

-- Helper view with show and team names for UI
drop view if exists public.show_team_invitations_with_details;
create view public.show_team_invitations_with_details as
select
  sti.event_id,
  sti.occ_start,
  sti.occ_id,
  sti.team_id,
  sti.status,
  sti.invited_by,
  sti.created_at,
  t.name as team_name,
  t.display_id as team_display_id,
  coalesce(so.title, e.title) as show_title,
  coalesce(so.tz, e.tz) as show_tz,
  e.starts_at as base_starts_at,
  e.ends_at as base_ends_at,
  s.name as series_name
from public.show_team_invitations sti
join public.show_events e on e.id = sti.event_id
join public.show_series s on s.id = e.series_id
join public.teams t on t.id = sti.team_id
left join public.show_occurrences so on so.id = sti.occ_id;

grant select on public.show_team_invitations_with_details to authenticated;

-- RPCs
drop function if exists public.list_show_lineup(p_event_id uuid, p_occ_start timestamptz);
create or replace function public.list_show_lineup(p_event_id uuid, p_occ_start timestamptz)
returns table (
  event_id uuid,
  occ_start timestamptz,
  team_id uuid,
  status text,
  invited_by uuid,
  created_at timestamptz,
  team_name text,
  team_display_id text,
  show_title text,
  show_tz text,
  base_starts_at timestamptz,
  base_ends_at timestamptz,
  series_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with occ as (
    select
      v.event_id,
      v.occ_start,
      v.team_id,
      v.status,
      v.invited_by,
      v.created_at,
      v.team_name,
      v.team_display_id,
      v.show_title,
      v.show_tz,
      v.base_starts_at,
      v.base_ends_at,
      v.series_name
    from public.show_team_invitations_with_details v
    where v.event_id = p_event_id and v.occ_start = p_occ_start and coalesce(v.status,'') <> 'dismissed'
  )
  select * from occ
  union all
  select p_event_id as event_id,
         p_occ_start as occ_start,
         ssti.team_id,
         ssti.status,
         ssti.invited_by,
         ssti.created_at,
         t.name as team_name,
         t.display_id as team_display_id,
         e.title as show_title,
         e.tz as show_tz,
         e.starts_at as base_starts_at,
         e.ends_at as base_ends_at,
         s.name as series_name
  from public.show_series_team_invitations ssti
  join public.show_events e on e.id = ssti.event_id
  join public.show_series s on s.id = e.series_id
  join public.teams t on t.id = ssti.team_id
  where ssti.event_id = p_event_id
    and coalesce(ssti.status,'') <> 'dismissed'
    and not exists (
      select 1 from public.show_team_invitations sti
      where sti.event_id = p_event_id and sti.occ_start = p_occ_start and sti.team_id = ssti.team_id
    )
  order by created_at desc;
$$;
grant execute on function public.list_show_lineup(uuid, timestamptz) to authenticated;

drop function if exists public.invite_team_to_show(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid);
create or replace function public.invite_team_to_show(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_occ_id uuid;
begin
  -- Ensure caller owns the show
  if not exists (
    select 1 from public.show_events e join public.show_series s on s.id = e.series_id
    where e.id = p_event_id and s.owner_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  v_occ_id := public.ensure_occurrence(p_event_id, p_occ_start);

  insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by, occ_id)
  values (p_event_id, p_occ_start, p_team_id, 'invited', auth.uid(), v_occ_id)
  on conflict (event_id, occ_start, team_id) do update set status = excluded.status, invited_by = excluded.invited_by, occ_id = excluded.occ_id;
end;
$$;
grant execute on function public.invite_team_to_show(uuid, timestamptz, uuid) to authenticated;

drop function if exists public.cancel_team_show_invite(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid);
create or replace function public.cancel_team_show_invite(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.show_team_invitations
  set status = 'canceled'
  where event_id = p_event_id and occ_start = p_occ_start and team_id = p_team_id;
end;
$$;
grant execute on function public.cancel_team_show_invite(uuid, timestamptz, uuid) to authenticated;

drop function if exists public.list_team_show_invitations(p_team_id uuid);
create or replace function public.list_team_show_invitations(p_team_id uuid)
returns setof public.show_team_invitations_with_details
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.show_team_invitations_with_details v
  where v.team_id = p_team_id
  order by v.created_at desc;
$$;
grant execute on function public.list_team_show_invitations(uuid) to authenticated;

drop function if exists public.accept_team_show_invite(p_event_id uuid, p_occ_start timestamptz);
create or replace function public.accept_team_show_invite(p_event_id uuid, p_occ_start timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_occ_id uuid;
begin
  -- Require admin of the invited team
  if not exists (
    select 1 from public.team_members m
    join public.show_series s on true
    where m.user_id = auth.uid() and m.role = 'admin'
      and exists (
        select 1 from public.show_series_team_invitations ssti
        where ssti.event_id = p_event_id and ssti.team_id = m.team_id
      )
  ) then
    raise exception 'not allowed';
  end if;

  v_occ_id := public.ensure_occurrence(p_event_id, p_occ_start);

  -- Create or update a per-occurrence row to accepted
  insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by, occ_id)
  select p_event_id, p_occ_start, m.team_id, 'accepted', auth.uid(), v_occ_id
  from public.team_members m
  where m.user_id = auth.uid()
    and m.role = 'admin'
    and exists (
      select 1 from public.show_series_team_invitations ssti
      where ssti.event_id = p_event_id and ssti.team_id = m.team_id
    )
  on conflict (event_id, occ_start, team_id)
  do update set status = 'accepted', occ_id = excluded.occ_id;
end;
$$;
grant execute on function public.accept_team_show_invite(uuid, timestamptz) to authenticated;

drop function if exists public.decline_team_show_invite(p_event_id uuid, p_occ_start timestamptz);
create or replace function public.decline_team_show_invite(p_event_id uuid, p_occ_start timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_occ_id uuid;
begin
  if not exists (
    select 1 from public.team_members m
    where m.user_id = auth.uid() and m.role = 'admin'
      and exists (
        select 1 from public.show_series_team_invitations ssti
        where ssti.event_id = p_event_id and ssti.team_id = m.team_id
      )
  ) then
    raise exception 'not allowed';
  end if;

  v_occ_id := public.ensure_occurrence(p_event_id, p_occ_start);

  -- Create or update a per-occurrence row to declined
  insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by, occ_id)
  select p_event_id, p_occ_start, m.team_id, 'declined', auth.uid(), v_occ_id
  from public.team_members m
  where m.user_id = auth.uid()
    and m.role = 'admin'
    and exists (
      select 1 from public.show_series_team_invitations ssti
      where ssti.event_id = p_event_id and ssti.team_id = m.team_id
    )
  on conflict (event_id, occ_start, team_id)
  do update set status = 'declined', occ_id = excluded.occ_id;
end;
$$;
grant execute on function public.decline_team_show_invite(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- ====================================================
-- Utility: resolve team UUID from display_id (for showrunner invites)
-- ====================================================

drop function if exists public.team_id_by_display_id(p_display_id text);
create or replace function public.team_id_by_display_id(p_display_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.teams where display_id = p_display_id limit 1;
$$;
grant execute on function public.team_id_by_display_id(text) to authenticated;

notify pgrst, 'reload schema';

-- Resolve team brief (id, name, display_id) by Team ID (display_id)
drop function if exists public.team_brief_by_display_id(p_display_id text);
create or replace function public.team_brief_by_display_id(p_display_id text)
returns table (id uuid, name text, display_id text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name, t.display_id
  from public.teams t
  where t.display_id = p_display_id
  limit 1;
$$;
grant execute on function public.team_brief_by_display_id(text) to authenticated;

notify pgrst, 'reload schema';

-- ====================================================
-- Show lineup: logging + team-side cancel + listings
-- ====================================================

-- Log lineup changes into team_change_log
drop function if exists public.trg_log_show_team_invitations();
create or replace function public.trg_log_show_team_invitations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_prod  text;
  v_event_deleting text;
begin
  -- If this delete is cascading from an event deletion, skip per-row logging/cleanup
  if TG_OP = 'DELETE' then
    v_event_deleting := current_setting('improvhub.event_deleting', true);
    if v_event_deleting is not null and v_event_deleting::uuid = OLD.event_id then
      return OLD;
    end if;
  end if;
  if TG_OP = 'INSERT' then
    select e.title, s.name into v_title, v_prod from public.show_events e join public.show_series s on s.id = e.series_id where e.id = NEW.event_id;
    if NEW.status = 'accepted' then
      perform public._log_team_change(NEW.team_id, 'show_lineup_accepted', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
    elsif NEW.status = 'declined' then
      perform public._log_team_change(NEW.team_id, 'show_lineup_declined', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
    elsif NEW.status = 'invited' then
      perform public._log_team_change(NEW.team_id, 'show_lineup_invited', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
    end if;
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if NEW.status is distinct from OLD.status then
      select e.title, s.name into v_title, v_prod from public.show_events e join public.show_series s on s.id = e.series_id where e.id = NEW.event_id;
      if NEW.status = 'accepted' then
        perform public._log_team_change(NEW.team_id, 'show_lineup_accepted', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
      elsif NEW.status = 'declined' then
        perform public._log_team_change(NEW.team_id, 'show_lineup_declined', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
      elsif NEW.status = 'canceled' then
        -- Invited → Canceled: remove the prior invite logs (no new entry)
        if OLD.status = 'invited' then
          delete from public.team_change_log
          where team_id = NEW.team_id
            and action in ('show_lineup_invited','invite_withdrawn')
            and (details->>'event_id')::uuid = NEW.event_id
            and (details->>'occ_start')::timestamptz = NEW.occ_start;
        elsif OLD.status = 'accepted' then
          perform public._log_team_change(NEW.team_id, 'show_booking_removed', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
        else
          perform public._log_team_change(NEW.team_id, 'show_lineup_canceled', jsonb_build_object('event_id', NEW.event_id, 'occ_start', NEW.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
        end if;
      end if;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    select e.title, s.name into v_title, v_prod from public.show_events e join public.show_series s on s.id = e.series_id where e.id = OLD.event_id;
    if OLD.status = 'invited' then
      -- Remove prior invitation logs; do not add a new entry
      delete from public.team_change_log
      where team_id = OLD.team_id
        and action in ('show_lineup_invited','invite_withdrawn')
        and (details->>'event_id')::uuid = OLD.event_id
        and (details->>'occ_start')::timestamptz = OLD.occ_start;
    elsif OLD.status = 'accepted' then
      -- Explicitly mark the accepted booking as removed
      perform public._log_team_change(OLD.team_id, 'show_booking_removed', jsonb_build_object('event_id', OLD.event_id, 'occ_start', OLD.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
    else
      -- For other statuses, keep a generic removal entry
      perform public._log_team_change(OLD.team_id, 'show_lineup_removed', jsonb_build_object('event_id', OLD.event_id, 'occ_start', OLD.occ_start, 'title', coalesce(v_title, v_prod), 'production_name', v_prod));
    end if;
    return OLD;
  end if;
  return null;
end; $$;

drop trigger if exists trg_log_show_team_invitations on public.show_team_invitations;
create trigger trg_log_show_team_invitations
after insert or update or delete on public.show_team_invitations
for each row execute procedure public.trg_log_show_team_invitations();

-- Team-side cancellation (after acceptance)
drop function if exists public.cancel_team_show_booking(p_event_id uuid, p_occ_start timestamptz);
create or replace function public.cancel_team_show_booking(p_event_id uuid, p_occ_start timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_team uuid;
begin
  select team_id into v_team from public.show_team_invitations
  where event_id = p_event_id and occ_start = p_occ_start and status = 'accepted';

  if v_team is null then
    raise exception 'No accepted booking to cancel';
  end if;

  if not exists (
    select 1 from public.team_members m
    where m.team_id = v_team and m.user_id = auth.uid() and m.role = 'admin'
  ) then
    raise exception 'not allowed';
  end if;

  update public.show_team_invitations
  set status = 'canceled'
  where event_id = p_event_id and occ_start = p_occ_start and team_id = v_team;
end; $$;
grant execute on function public.cancel_team_show_booking(uuid, timestamptz) to authenticated;

-- Owner-side hard remove (dismiss after cancellation)
drop function if exists public.remove_team_from_show(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid);
create or replace function public.remove_team_from_show(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.show_events e join public.show_series s on s.id = e.series_id
    where e.id = p_event_id and s.owner_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;
  delete from public.show_team_invitations where event_id = p_event_id and occ_start = p_occ_start and team_id = p_team_id;
end; $$;
grant execute on function public.remove_team_from_show(uuid, timestamptz, uuid) to authenticated;

-- List accepted bookings for a team within a window, resolving overrides
drop function if exists public.list_team_show_performances(p_team_id uuid, p_start timestamptz, p_end timestamptz);
create or replace function public.list_team_show_performances(p_team_id uuid, p_start timestamptz, p_end timestamptz)
returns table (
  event_id uuid,
  occ_start timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  title text,
  location text,
  tz text,
  series_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sti.event_id,
    sti.occ_start,
    coalesce(so.starts_at, e.starts_at) as starts_at,
    coalesce(so.ends_at,   e.ends_at)   as ends_at,
    coalesce(so.title, e.title) as title,
    coalesce(so.location, e.location) as location,
    coalesce(so.tz, e.tz) as tz,
    s.name as series_name
  from public.show_team_invitations sti
  join public.show_events e on e.id = sti.event_id
  join public.show_series s on s.id = e.series_id
  left join public.show_occurrences so on so.id = sti.occ_id and coalesce(so.canceled, false) = false
  where sti.team_id = p_team_id
    and sti.status = 'accepted'
    and sti.occ_start >= p_start and sti.occ_start <= p_end
  order by coalesce(so.starts_at, e.starts_at) asc;
$$;
grant execute on function public.list_team_show_performances(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

-- Series default lineup: tables, policies, RPCs, and occurrence override upsert
create table if not exists public.show_series_team_invitations (
  event_id   uuid not null references public.show_events(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  status     text not null default 'invited',
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (event_id, team_id)
);
alter table public.show_series_team_invitations enable row level security;
drop policy if exists "ssti select owner or team" on public.show_series_team_invitations;
create policy "ssti select owner or team" on public.show_series_team_invitations for select to authenticated
using (
  exists (select 1 from public.show_events e join public.show_series s on s.id = e.series_id where e.id = show_series_team_invitations.event_id and s.owner_id = auth.uid())
  or exists (select 1 from public.team_members m where m.team_id = show_series_team_invitations.team_id and m.user_id = auth.uid())
);
drop policy if exists "ssti write owner" on public.show_series_team_invitations;
create policy "ssti write owner" on public.show_series_team_invitations for all to authenticated
using (exists (select 1 from public.show_events e join public.show_series s on s.id = e.series_id where e.id = show_series_team_invitations.event_id and s.owner_id = auth.uid()))
with check (exists (select 1 from public.show_events e join public.show_series s on s.id = e.series_id where e.id = show_series_team_invitations.event_id and s.owner_id = auth.uid()));

drop function if exists public.list_series_lineup(p_event_id uuid);
create or replace function public.list_series_lineup(p_event_id uuid)
returns table (event_id uuid, team_id uuid, status text, invited_by uuid, created_at timestamptz, team_name text, team_display_id text)
language sql stable security definer set search_path = public as $$
  select ssti.event_id, ssti.team_id, ssti.status, ssti.invited_by, ssti.created_at,
         t.name as team_name, t.display_id as team_display_id
  from public.show_series_team_invitations ssti
  join public.teams t on t.id = ssti.team_id
  where ssti.event_id = p_event_id and coalesce(ssti.status,'') <> 'dismissed'
  order by ssti.created_at desc
$$;
grant execute on function public.list_series_lineup(uuid) to authenticated;

-- Seed per-occurrence invites for a series within a window
drop function if exists public.seed_series_invites(p_event_id uuid, p_start timestamptz, p_end timestamptz);
create or replace function public.seed_series_invites(p_event_id uuid, p_start timestamptz, p_end timestamptz)
returns void
language plpgsql security definer set search_path=public as $$
declare
  e record; s record; d timestamptz; day_interval interval;
  start_day timestamptz; end_day timestamptz; byday text[]; e_dow text;
  y int; m int; dom int; month_start date; occ timestamptz;
  wom int; wd2 text;
begin
  select * into e from public.show_events where id = p_event_id;
  if e.id is null then raise exception 'event not found'; end if;
  day_interval := e.starts_at - date_trunc('day', e.starts_at);
  start_day := greatest(date_trunc('day', coalesce(p_start, now())), date_trunc('day', e.starts_at));
  end_day   := date_trunc('day', coalesce(p_end, now() + interval '365 days'));
  byday := e.recur_byday;
  -- Map Postgres DY ('MON') to two-letter ('MO') to match stored byday values
  e_dow := substring(upper(to_char(e.starts_at, 'DY')), 1, 2);
  if e.recur_freq = 'weekly' and (byday is null or array_length(byday,1) is null) then byday := array[e_dow]; end if;
  wom := e.recur_week_of_month;

  for s in select team_id from public.show_series_team_invitations where event_id = p_event_id and coalesce(status,'') <> 'dismissed' loop
    if e.recur_freq = 'none' then
      occ := e.starts_at;
      if occ >= start_day and occ <= (end_day + interval '1 day - 1 second') then
        insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by)
        values (p_event_id, occ, s.team_id, 'invited', auth.uid())
        on conflict (event_id, occ_start, team_id) do nothing;
      end if;
    elsif e.recur_freq = 'weekly' then
      d := start_day;
      while d <= end_day loop
        wd2 := substring(upper(to_char(d,'DY')),1,2);
        if (byday is null and wd2 = e_dow) or (byday is not null and wd2 = any(byday)) then
          occ := date_trunc('day', d) + day_interval;
          if occ >= e.starts_at then
            insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by)
            values (p_event_id, occ, s.team_id, 'invited', auth.uid())
            on conflict (event_id, occ_start, team_id) do nothing;
          end if;
        end if;
        d := d + interval '1 day';
      end loop;
    elsif e.recur_freq = 'monthly' then
      d := start_day;
      while d <= end_day loop
        y := extract(year from d)::int; m := extract(month from d)::int;
        month_start := make_date(y, m, 1);
        if wom is not null and byday is not null and array_length(byday,1) = 1 then
          -- Week-of-month pattern: compute nth weekday of month
          wd2 := byday[1];
          -- Convert wd2 ('MO') to 0..6 where 0=Sunday like Postgres dow?
          -- We'll match by stepping days from first of month until matching wd2
          -- Find first matching weekday in this month
          dom := 1;
          while substring(upper(to_char(make_timestamp(y,m,dom,0,0,0),'DY')),1,2) <> wd2 loop
            dom := dom + 1;
          end loop;
          if wom > 0 then
            dom := dom + 7 * (wom - 1);
          else
            -- last (-1): go to last day of month, step back to matching weekday
            dom := extract(day from (month_start + interval '1 month - 1 day'))::int;
            while substring(upper(to_char(make_timestamp(y,m,dom,0,0,0),'DY')),1,2) <> wd2 loop
              dom := dom - 1;
            end loop;
          end if;
        else
          -- Month-day pattern (or fallback to event DOM)
          dom := coalesce(e.recur_bymonthday[1], extract(day from e.starts_at)::int);
          dom := least(dom, extract(day from (month_start + interval '1 month - 1 day'))::int);
        end if;
        occ := (make_timestamp(y, m, dom, 0, 0, 0) at time zone 'UTC') + day_interval;
        if occ >= e.starts_at and occ >= start_day and occ <= (end_day + interval '1 day - 1 second') then
          insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by)
          values (p_event_id, occ, s.team_id, 'invited', auth.uid())
          on conflict (event_id, occ_start, team_id) do nothing;
        end if;
        d := date_trunc('month', d) + interval '1 month';
      end loop;
    else
      occ := e.starts_at;
      if occ >= start_day and occ <= (end_day + interval '1 day - 1 second') then
        insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by)
        values (p_event_id, occ, s.team_id, 'invited', auth.uid())
        on conflict (event_id, occ_start, team_id) do nothing;
      end if;
    end if;
  end loop;
end; $$;
grant execute on function public.seed_series_invites(uuid, timestamptz, timestamptz) to authenticated;

-- Seed per-occ invites for existing occurrences (no occurrence generation)
drop function if exists public.seed_series_invites_existing(p_event_id uuid);
create or replace function public.seed_series_invites_existing(p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  for r in
    select id as occ_id, base_start from public.show_occurrences so where so.event_id = p_event_id order by base_start asc
  loop
    insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by, occ_id)
    select p_event_id, r.base_start, ssti.team_id, 'invited', auth.uid(), r.occ_id
    from public.show_series_team_invitations ssti
    where ssti.event_id = p_event_id and coalesce(ssti.status,'') <> 'dismissed'
    on conflict (event_id, occ_start, team_id) do update set occ_id = excluded.occ_id;
  end loop;
end $$;

-- Trigger on residency invite insert to seed per-occ invites
 drop trigger if exists trg_seed_per_occ_invites on public.show_series_team_invitations;
 drop function if exists public.trg_seed_per_occ_invites();
 create or replace function public.trg_seed_per_occ_invites()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.seed_series_invites_existing(NEW.event_id);
  return NEW;
end $$;

 create trigger trg_seed_per_occ_invites
after insert on public.show_series_team_invitations
for each row execute procedure public.trg_seed_per_occ_invites();

drop function if exists public.invite_team_to_series(p_event_id uuid, p_team_id uuid);
create or replace function public.invite_team_to_series(p_event_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.show_events e join public.show_series s on s.id = e.series_id where e.id = p_event_id and s.owner_id = auth.uid()) then raise exception 'not allowed'; end if;
  insert into public.show_series_team_invitations(event_id, team_id, status, invited_by)
  values (p_event_id, p_team_id, 'invited', auth.uid())
  on conflict (event_id, team_id) do update set status = excluded.status, invited_by = excluded.invited_by;
  -- Do not seed per-occurrence invitations here; per-night rows are created only when an
  -- actual action happens on that occurrence (accept/decline/cancel). This keeps invites
  -- aligned with real occurrences even if recurrence changes later.
end; $$;

-- Also seed invites when a new occurrence is created (for existing residency teams)
 drop trigger if exists trg_seed_invites_on_occ on public.show_occurrences;
 drop function if exists public.trg_seed_invites_on_occ();
 create or replace function public.trg_seed_invites_on_occ()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by, occ_id)
  select NEW.event_id, NEW.base_start, ssti.team_id, 'invited', auth.uid(), NEW.id
  from public.show_series_team_invitations ssti
  where ssti.event_id = NEW.event_id and coalesce(ssti.status,'') <> 'dismissed'
  on conflict (event_id, occ_start, team_id) do update set occ_id = excluded.occ_id;
  return NEW;
end $$;

 create trigger trg_seed_invites_on_occ
after insert on public.show_occurrences
for each row execute procedure public.trg_seed_invites_on_occ();
grant execute on function public.invite_team_to_series(uuid, uuid) to authenticated;

drop function if exists public.cancel_team_series_invite(p_event_id uuid, p_team_id uuid);
create or replace function public.cancel_team_series_invite(p_event_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.show_series_team_invitations set status = 'canceled' where event_id = p_event_id and team_id = p_team_id;
  update public.show_team_invitations set status = 'canceled'
  where event_id = p_event_id and team_id = p_team_id and status <> 'canceled';
end; $$;
grant execute on function public.cancel_team_series_invite(uuid, uuid) to authenticated;

drop function if exists public.remove_team_from_series(p_event_id uuid, p_team_id uuid);
create or replace function public.remove_team_from_series(p_event_id uuid, p_team_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  delete from public.show_series_team_invitations where event_id = p_event_id and team_id = p_team_id;
  delete from public.show_team_invitations where event_id = p_event_id and team_id = p_team_id;
end; $$;
grant execute on function public.remove_team_from_series(uuid, uuid) to authenticated;

drop function if exists public.upsert_occ_lineup_status(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid, p_status text);
create or replace function public.upsert_occ_lineup_status(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid, p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_occ_id uuid;
begin
  v_occ_id := public.ensure_occurrence(p_event_id, p_occ_start);
  insert into public.show_team_invitations(event_id, occ_start, team_id, status, invited_by, occ_id)
  values (p_event_id, p_occ_start, p_team_id, coalesce(p_status,'invited'), auth.uid(), v_occ_id)
  on conflict (event_id, occ_start, team_id) do update set status = excluded.status, occ_id = excluded.occ_id;
end; $$;
grant execute on function public.upsert_occ_lineup_status(uuid, timestamptz, uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- Clear per-occurrence override: reverts to series default visibility
drop function if exists public.clear_occ_lineup_override(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid);
create or replace function public.clear_occ_lineup_override(p_event_id uuid, p_occ_start timestamptz, p_team_id uuid)
returns void language sql security definer set search_path=public as $$
  delete from public.show_team_invitations
  where event_id = p_event_id and occ_start = p_occ_start and team_id = p_team_id;
$$;
grant execute on function public.clear_occ_lineup_override(uuid, timestamptz, uuid) to authenticated;

notify pgrst, 'reload schema';

-- Keep lineup occ_start in sync for single (non-recurring) shows when time changes
drop function if exists public.trg_sync_lineup_on_show_time_change();
create or replace function public.trg_sync_lineup_on_show_time_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only for non-recurring shows, and only when starts_at changed
  if (TG_OP = 'UPDATE') and (NEW.recur_freq = 'none') and (NEW.starts_at is distinct from OLD.starts_at) then
    update public.show_team_invitations
    set occ_start = NEW.starts_at
    where event_id = NEW.id;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_sync_lineup_on_show_time_change on public.show_events;
create trigger trg_sync_lineup_on_show_time_change
after update on public.show_events
for each row execute procedure public.trg_sync_lineup_on_show_time_change();

notify pgrst, 'reload schema';

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
    l.details->>'production_name',
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
  -- Skip logging if team no longer exists (e.g., during cascading delete)
  if not exists (select 1 from public.teams t where t.id = p_team_id) then
    return;
  end if;

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
