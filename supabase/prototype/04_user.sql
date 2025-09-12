-- ============================================================
-- producers.sql
-- Run order: 1) utils.sql  2) acts.sql  3) producers.sql  4) user.sql  5) calendar.sql
-- WHY: Define PRODUCER entity and membership so owners/user.sql can sync it into owner_users.
-- ============================================================

create table if not exists producers (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists producer_users (
  producer_id uuid not null references producers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role entity_user_role not null default 'viewer',
  primary key (producer_id, user_id)
);

-- Optional RLS (enable if you want to restrict direct selects to operators)
-- alter table producers enable row level security;
-- alter table producer_users enable row level security;
-- create policy producer_users_self on producer_users for select using (user_id = auth.uid());
""")

# Build updated owners/user.sql (generic pieces only + sync triggers referencing entity tables)
owners_sql = textwrap.dedent("""\
-- ============================================================
-- user.sql  (generic owners & profile utilities)
-- Run order: 1) utils.sql  2) acts.sql  3) producers.sql  4) user.sql  5) calendar.sql
-- WHY: Polymorphic OWNERS, OWNER_USERS, auth bootstrap, and functions/triggers
--      that sync entity memberships (act_users/producer_users) into owner_users.
--      Keep all generic bits here; entities live in their own files.
-- ============================================================

-- Polymorphic owners table
create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  kind owner_kind not null,                         -- 'individual' | 'act' | 'producer'
  individual_user_id uuid references auth.users(id) on delete cascade,
  act_id uuid references acts(id) on delete cascade,
  producer_id uuid references producers(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owners_exactly_one_ref check (
    (kind='individual' and individual_user_id is not null and act_id is null and producer_id is null) or
    (kind='act'        and act_id             is not null and individual_user_id is null and producer_id is null) or
    (kind='producer'   and producer_id        is not null and individual_user_id is null and act_id is null)
  )
);
drop trigger if exists trg_owners_touch on owners;
create trigger trg_owners_touch
before update on owners
for each row execute function _touch_updated_at();

-- Which users can operate a given owner (admin/editor/viewer)
create table if not exists owner_users (
  owner_id uuid not null references owners(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     entity_user_role not null,
  primary key (owner_id, user_id)
);
create index if not exists idx_owner_users_user on owner_users(user_id);

-- Auto-link individual owners to themselves as 'admin'
create or replace function _link_individual_owner() returns trigger
language plpgsql as $$
begin
  if NEW.kind = 'individual' and NEW.individual_user_id is not null then
    insert into owner_users(owner_id, user_id, role)
    values (NEW.id, NEW.individual_user_id, 'admin')
    on conflict do nothing;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_owners_autolink_individual on owners;
create trigger trg_owners_autolink_individual
after insert on owners
for each row execute function _link_individual_owner();

-- Helpers to resolve owners for entity records
create or replace function _owner_id_for_act(aid uuid) returns uuid
language sql stable as $$
  select id from owners where kind='act' and act_id = aid
$$;

create or replace function _owner_id_for_producer(pid uuid) returns uuid
language sql stable as $$
  select id from owners where kind='producer' and producer_id = pid
$$;

-- Sync act_users -> owner_users (requires acts.sql to be run first)
create or replace function _sync_owner_users_from_act() returns trigger
language plpgsql as $$
declare oid uuid;
begin
  if (TG_OP = 'DELETE') then
    delete from owner_users where owner_id = _owner_id_for_act(old.act_id) and user_id = old.user_id;
    return old;
  end if;

  select _owner_id_for_act(new.act_id) into oid;
  if oid is null then return new; end if;

  insert into owner_users(owner_id, user_id, role)
  values (oid, new.user_id, new.role)
  on conflict (owner_id, user_id) do update set role = excluded.role;

  return new;
end $$;

drop trigger if exists trg_sync_act_users_iud on act_users;
create trigger trg_sync_act_users_iud
after insert or update or delete on act_users
for each row execute function _sync_owner_users_from_act();

-- Sync producer_users -> owner_users (requires producers.sql first)
create or replace function _sync_owner_users_from_producer() returns trigger
language plpgsql as $$
declare oid uuid;
begin
  if (TG_OP = 'DELETE') then
    delete from owner_users where owner_id = _owner_id_for_producer(old.producer_id) and user_id = old.user_id;
    return old;
  end if;

  select _owner_id_for_producer(new.producer_id) into oid;
  if oid is null then return new; end if;

  insert into owner_users(owner_id, user_id, role)
  values (oid, new.user_id, new.role)
  on conflict (owner_id, user_id) do update set role = excluded.role;

  return new;
end $$;

drop trigger if exists trg_sync_producer_users_iud on producer_users;
create trigger trg_sync_producer_users_iud
after insert or update or delete on producer_users
for each row execute function _sync_owner_users_from_producer();

-- Optional: user profiles & signup bootstrap
create table if not exists user_profiles (
  user_id uuid primary key,                -- equals auth.users.id
  external_user_id text,
  user_type text,
  privilege_level int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_user_profiles_touch on user_profiles;
create trigger trg_user_profiles_touch
before update on user_profiles
for each row execute function _touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS exposure for owners/owner_users (adjust to taste)
alter table if exists owners      enable row level security;
alter table if exists owner_users enable row level security;

create policy owners_select on owners for select
using (
  (kind='individual' and individual_user_id = auth.uid())
  or exists (select 1 from owner_users ou where ou.owner_id = owners.id and ou.user_id = auth.uid())
);

create policy owner_users_select on owner_users for select
using (
  user_id = auth.uid() or exists (
    select 1 from owner_users ou2
    where ou2.owner_id = owner_users.owner_id and ou2.user_id = auth.uid() and ou2.role='admin'
  )
);
