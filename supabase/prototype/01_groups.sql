-- =============================================================================
-- PURPOSE
--   Unified "group" entity (replaces legacy "acts" and "producers") and the
--   membership model that ties auth.users to groups with roles.
--
-- PRINCIPLES
--   • Individuals are ONLY in auth.users (no separate person table).
--   • Groups are first-class entities.
--   • group_membership encodes governance + roster via role:
--       - admin   : full control
--       - manager : operational control
--       - member  : roster only
--   • Permissions for groups are derived later via owner_users (04_user.sql).
-- =============================================================================

-- Group types (multi-select flags)
-- Values are lowercased for storage; UI can present humanized labels.
do $$ begin
  create type group_type as enum ('act','practice_group','school','theatre','producer');
exception when duplicate_object then null; end $$;

-- Unified group entity
CREATE TABLE IF NOT EXISTS "group" (
  group_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Zero-or-more types, e.g., {'act','theatre'}
  types      group_type[] NOT NULL DEFAULT '{}',
  display_id text NOT NULL,
  public_listing boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure columns exist when rerun
alter table "group" add column if not exists types group_type[] not null default '{}'::group_type[];
alter table "group" add column if not exists display_id text not null;
alter table "group" add column if not exists public_listing boolean not null default false;
alter table "group" add column if not exists is_active boolean not null default true;

-- Unique index for display_id
create unique index if not exists uq_group_display_id on "group"(display_id);

-- Maintain updated_at on change
do $$ begin
  create trigger trg_group_touch
  before update on "group"
  for each row execute function _touch_updated_at();
exception when duplicate_object then null; end $$;

-- Index for filtering by type membership
do $$ begin
  create index idx_group_types_gin on "group" using gin (types);
exception when duplicate_table then null; end $$;

-- Membership of auth.users in groups, with roles and simple period validity.
-- Design: historical-friendly PK so you can keep prior memberships.
CREATE TABLE IF NOT EXISTS group_membership (
  group_id   uuid NOT NULL REFERENCES "group"(group_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  role       group_role NOT NULL DEFAULT 'member',
  started_on date,
  ended_on   date,
  PRIMARY KEY (group_id, user_id, started_on)
);

-- Fast lookups for current state (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_gm_group_active ON group_membership(group_id, role) WHERE ended_on IS NULL;
CREATE INDEX IF NOT EXISTS idx_gm_user_active  ON group_membership(user_id, role)  WHERE ended_on IS NULL;

-- =========================
-- Display ID generation (human-friendly IDs like "My Group#1")
-- =========================
drop function if exists next_group_display_id(p_name text);
create or replace function next_group_display_id(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare base text := trim(p_name); n int := 0; candidate text;
begin
  if base is null or base = '' then raise exception 'Group name required'; end if;
  candidate := base;
  loop
    exit when not exists (select 1 from "group" g where g.display_id = candidate);
    n := n + 1; candidate := base || '#' || n;
  end loop;
  return candidate;
end $$;

-- =========================
-- RLS
-- =========================
alter table "group" enable row level security;

-- Read policy: members can read; non-members can read only if public_listing = true
do $$ begin
  drop policy if exists group_read_all on "group";
exception when undefined_object then null; end $$;
do $$ begin
  drop policy if exists group_read_visible on "group";
exception when undefined_object then null; end $$;
create policy group_read_visible on "group" for select to authenticated
using (
  public_listing = true
  or exists (
    select 1 from group_membership gm
    where gm.group_id = "group".group_id and gm.user_id = auth.uid() and gm.ended_on is null
  )
);

-- Update/write policy is created in 03_group_policies.sql after can_admin_group() exists.

-- =========================
-- RPCs (SECURITY DEFINER)
-- =========================

-- Create group with caller as admin
drop function if exists create_group(p_name text);
create or replace function create_group(p_name text)
returns table (id uuid, group_name text, group_display_id text, types group_type[])
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_disp text; v_types group_type[] := '{}';
begin
  v_disp := next_group_display_id(p_name);
  insert into "group"(name, display_id)
  values (p_name, v_disp)
  returning group_id, name, display_id into v_id, v_name, v_disp;

  insert into group_membership(group_id, user_id, role, started_on)
  values (v_id, auth.uid(), 'admin', current_date);

  return query select v_id, v_name as group_name, v_disp as group_display_id, v_types;
end $$;
grant execute on function create_group(text) to authenticated;

-- List my groups with role (active memberships only)
drop function if exists list_my_groups();
create or replace function list_my_groups()
returns table (id uuid, name text, display_id text, types group_type[], public_listing boolean, role text)
language sql stable security definer set search_path = public as $$
  select g.group_id as id, g.name, g.display_id, g.types, g.public_listing, gm.role::text as role
  from group_membership gm
  join "group" g on g.group_id = gm.group_id
  where gm.user_id = auth.uid() and gm.ended_on is null
  order by g.created_at asc
$$;
grant execute on function list_my_groups() to authenticated;

-- List group members
drop function if exists list_group_members(p_group_id uuid);
create or replace function list_group_members(p_group_id uuid)
returns table (user_id uuid, email text, display_name text, role text)
language sql stable security definer set search_path = public, auth as $$
  select u.id as user_id,
         u.email::text as email,
         coalesce(nullif(u.raw_user_meta_data->>'display_name',''), u.email::text) as display_name,
         gm.role::text as role
  from group_membership gm
  join auth.users u on u.id = gm.user_id
  where gm.group_id = p_group_id
    and exists (
      select 1 from group_membership me where me.group_id = p_group_id and me.user_id = auth.uid() and me.ended_on is null
    )
  order by u.email
$$;
grant execute on function list_group_members(uuid) to authenticated;

-- Rename group (admin only)
drop function if exists rename_group(p_group_id uuid, p_name text);
create or replace function rename_group(p_group_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  v_ok := public.can_admin_group(p_group_id);
  if not v_ok then raise exception 'not allowed' using errcode = '42501'; end if;
  update "group" set name = p_name where group_id = p_group_id;
end $$;
grant execute on function rename_group(uuid, text) to authenticated;

-- Delete group (admin only)
drop function if exists delete_group(p_group_id uuid);
create or replace function delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_admin_group(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from "group" where group_id = p_group_id;
end $$;
grant execute on function delete_group(uuid) to authenticated;

-- Set member role (admin only). Prevent removing last admin.
drop function if exists set_group_member_role(p_group_id uuid, p_user_id uuid, p_role text);
create or replace function set_group_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_new group_role := coalesce(p_role,'member')::group_role; v_admins int;
begin
  if not public.can_admin_group(p_group_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_new <> 'admin' then
    select count(*) into v_admins from group_membership where group_id = p_group_id and role = 'admin' and ended_on is null;
    if v_admins <= 1 then raise exception 'cannot demote last admin' using errcode = 'P0001'; end if;
  end if;
  update group_membership set role = v_new where group_id = p_group_id and user_id = p_user_id and ended_on is null;
end $$;
grant execute on function set_group_member_role(uuid, uuid, text) to authenticated;

-- Remove member (self or admin; prevent removing last admin)
drop function if exists remove_group_member(p_group_id uuid, p_user_id uuid);
create or replace function remove_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_self boolean := (p_user_id = auth.uid()); v_is_admin boolean; v_target_admin boolean; v_admins int;
begin
  select exists (
    select 1 from group_membership m where m.group_id = p_group_id and m.user_id = auth.uid() and m.role = 'admin' and m.ended_on is null
  ) into v_is_admin;

  if not v_self and not v_is_admin then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select (role='admin') into v_target_admin from group_membership where group_id = p_group_id and user_id = p_user_id and ended_on is null;
  if coalesce(v_target_admin,false) then
    select count(*) into v_admins from group_membership where group_id = p_group_id and role = 'admin' and ended_on is null;
    if v_admins <= 1 then raise exception 'cannot remove last admin' using errcode = 'P0001'; end if;
  end if;

  update group_membership set ended_on = current_date where group_id = p_group_id and user_id = p_user_id and ended_on is null;
end $$;
grant execute on function remove_group_member(uuid, uuid) to authenticated;
