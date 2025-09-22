-- 04_user.sql
-- =============================================================================
-- PURPOSE
--   Polymorphic owners and operator mapping.
--
-- MODEL
--   owners.id is the single foreign key used throughout the app to mean
--   "this refers to either an individual user or a group". We keep it honest
--   via a CHECK constraint so exactly one side is populated.
--
--   owner_users maps "who can operate on behalf of an owner". It is derived:
--     - Individual owners auto-map to themselves as admin.
--     - Group owners map from group_membership where role IN ('admin','manager').
--
--   Helper functions ensure owners rows exist for users/groups on demand.
-- =============================================================================

-- Polymorphic owners: individual (auth.users) OR group ("group")
CREATE TABLE IF NOT EXISTS owners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               owner_kind NOT NULL,  -- 'individual' | 'group'
  individual_user_id uuid UNIQUE REFERENCES auth.users(id)     ON DELETE CASCADE,
  group_id           uuid UNIQUE REFERENCES "group"(group_id)  ON DELETE CASCADE,
  display_name       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owners_exactly_one_ref CHECK (
    (kind='individual' AND individual_user_id IS NOT NULL AND group_id IS NULL) OR
    (kind='group'      AND group_id           IS NOT NULL AND individual_user_id IS NULL)
  )
);

-- Maintain updated_at on change
do $$ begin
  create trigger trg_owners_touch
  before update on owners
  for each row execute function _touch_updated_at();
exception when duplicate_object then null; end $$;

-- Flat operator mapping: who can act on behalf of an owner
CREATE TABLE IF NOT EXISTS owner_users (
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role     group_role NOT NULL,
  PRIMARY KEY (owner_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_owner_users_user ON owner_users(user_id);

-- Auto-link individual owners to themselves as admin.
-- This fires when you insert an 'individual' row in owners.
CREATE OR REPLACE FUNCTION _link_individual_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'individual' AND NEW.individual_user_id IS NOT NULL THEN
    INSERT INTO owner_users(owner_id, user_id, role)
    VALUES (NEW.id, NEW.individual_user_id, 'admin')
    ON CONFLICT (owner_id, user_id) DO UPDATE SET role = 'admin';
  END IF;
  RETURN NEW;
END $$;

do $$ begin
  create trigger trg_owners_link_self
  after insert on owners
  for each row execute function _link_individual_owner();
exception when duplicate_object then null; end $$;

-- Ensure owners row exists for a user; return owners.id
CREATE OR REPLACE FUNCTION ensure_owner_for_user(u uuid) RETURNS uuid LANGUAGE sql AS $$
  WITH ins AS (
    INSERT INTO owners(kind, individual_user_id, display_name)
    SELECT 'individual', u, COALESCE((SELECT email::text FROM auth.users WHERE id=u), 'user')
    WHERE NOT EXISTS (SELECT 1 FROM owners WHERE kind='individual' AND individual_user_id=u)
    RETURNING id
  )
  SELECT id FROM ins
  UNION ALL
  SELECT id FROM owners WHERE kind='individual' AND individual_user_id=u
  LIMIT 1;
$$;

-- Read-only getter: return owners.id for a user if it exists (no insert)
drop function if exists get_owner_for_user(u uuid);
create or replace function get_owner_for_user(u uuid)
returns uuid language sql stable set search_path = public as $$
  select id from owners where kind='individual' and individual_user_id=u limit 1;
$$;
grant execute on function get_owner_for_user(uuid) to authenticated;

-- Ensure owners row exists for a group; return owners.id
CREATE OR REPLACE FUNCTION ensure_owner_for_group(g uuid) RETURNS uuid LANGUAGE sql AS $$
  WITH ins AS (
    INSERT INTO owners(kind, group_id, display_name)
    SELECT 'group', g, (SELECT name FROM "group" WHERE group_id=g)
    WHERE NOT EXISTS (SELECT 1 FROM owners WHERE kind='group' AND group_id=g)
    RETURNING id
  )
  SELECT id FROM ins
  UNION ALL
  SELECT id FROM owners WHERE kind='group' AND group_id=g
  LIMIT 1;
$$;

-- Read-only getter: return owners.id for a group if it exists (no insert)
drop function if exists get_owner_for_group(g uuid);
create or replace function get_owner_for_group(g uuid)
returns uuid language sql stable set search_path = public as $$
  select id from owners where kind='group' and group_id=g limit 1;
$$;
grant execute on function get_owner_for_group(uuid) to authenticated;

-- Keep owner_users in sync with group_membership (admins/managers only).
-- Why AFTER? We want the row visible for the SELECTs used in sync.
CREATE OR REPLACE FUNCTION _sync_owner_users_from_group_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grp_owner uuid;
BEGIN
  SELECT ensure_owner_for_group(COALESCE(NEW.group_id, OLD.group_id)) INTO grp_owner;

  -- When membership ends or is deleted, remove capability
  IF TG_OP = 'DELETE' OR (TG_OP='UPDATE' AND NEW.ended_on IS NOT NULL) THEN
    DELETE FROM owner_users
    WHERE owner_id = grp_owner
      AND user_id  = COALESCE(OLD.user_id, NEW.user_id);
    RETURN COALESCE(OLD,NEW);
  END IF;

  -- Grant/refresh capability for admins/managers with active membership
  IF NEW.ended_on IS NULL AND NEW.role IN ('admin','manager') THEN
    INSERT INTO owner_users(owner_id, user_id, role)
    VALUES (grp_owner, NEW.user_id, NEW.role)
    ON CONFLICT (owner_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  ELSE
    -- Demote/remove others (e.g., member or ended)
    DELETE FROM owner_users WHERE owner_id=grp_owner AND user_id=NEW.user_id;
  END IF;

  RETURN NEW;
END $$;

do $$ begin
  create trigger trg_sync_group_membership_iud
  after insert or update or delete on group_membership
  for each row execute function _sync_owner_users_from_group_membership();
exception when duplicate_object then null; end $$;

create or replace function can_admin_group(p_group_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1
    from owners o
    join owner_users ou on ou.owner_id = o.id
    where o.kind = 'group'
      and o.group_id = p_group_id
      and ou.user_id = auth.uid()
      and ou.role = 'admin'
  );
$$;
grant execute on function can_admin_group(uuid) to authenticated;
