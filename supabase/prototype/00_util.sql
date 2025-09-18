-- 00_util.sql
-- =============================================================================
-- PURPOSE
--   Shared enums and helper functions used across the schema.
--   This file defines:
--     - owner_kind:       the two canonical "who" types (individual user | group)
--     - group_role:       roles within a group for governance and access
--     - role_kind:        event-credit roles (performer/producer/etc.)
--     - role_kind:        also used on slots for operational roles (guest tech, etc.)
--     - _touch_updated_at: helper to maintain updated_at columns
--     - _stamp_editor:     stub for recording the actor (if you wire one)
--
-- PHILOSOPHY
--   Keep the polymorphism minimal and explicit:
--     * Individuals are rows in auth.users.
--     * Groups are rows in "group".
--     * Everywhere else references a single "owners(id)" that points to either.
-- =============================================================================

-- === Enums ==============================================================

-- Top-level "who" type used across the schema
CREATE TYPE owner_kind AS ENUM ('individual','group');

-- Roles within a group (access/roster)
CREATE TYPE group_role AS ENUM ('admin','manager','member');

-- Event credit roles (per-series defaults and per-occurrence overrides)
CREATE TYPE role_kind AS ENUM ('performer','producer','host','promoter','crew');

-- === Helpers ============================================================

-- Generic "touch" trigger to maintain updated_at columns on UPDATE
CREATE OR REPLACE FUNCTION _touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- (Optional) editor stamping helper — wire to your session logic if needed.
-- For example, set "app.user_id" at session start and record it here.
CREATE OR REPLACE FUNCTION _stamp_editor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- NEW.updated_by := current_setting('app.user_id', true)::uuid;
  RETURN NEW;
END $$;
