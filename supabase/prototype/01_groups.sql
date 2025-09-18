-- 01_groups.sql
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

-- Unified group entity
CREATE TABLE "group" (
  group_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Maintain updated_at on change
CREATE TRIGGER trg_group_touch
BEFORE UPDATE ON "group"
FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

-- Membership of auth.users in groups, with roles and simple period validity.
-- Design: historical-friendly PK so you can keep prior memberships.
CREATE TABLE group_membership (
  group_id   uuid NOT NULL REFERENCES "group"(group_id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  role       group_role NOT NULL DEFAULT 'member',
  started_on date,
  ended_on   date,
  PRIMARY KEY (group_id, user_id, started_on)
);

-- Fast lookups for current state (optional but recommended)
CREATE INDEX idx_gm_group_active ON group_membership(group_id, role) WHERE ended_on IS NULL;
CREATE INDEX idx_gm_user_active  ON group_membership(user_id, role)  WHERE ended_on IS NULL;
