-- 00_util.sql
-- =============================================================================
-- PURPOSE
--   Shared enums, extensions, and helper functions used across the schema.
--   Defines:
--     • Extensions: citext
--     • owner_kind       — canonical "who" types (individual user | group)
--     • group_role       — roles within a group (admin/manager/member)
--     • role_kind        — event-credit roles (also reused for slot staff)
--     • cal_role         — calendar sharing roles (owner/writer/reader)
--     • attendee_role    — RFC 5545 ATTENDEE ROLE parameter
--     • attendee_partstat— RFC 5545 PARTSTAT parameter
--     • _touch_updated_at— trigger helper to maintain updated_at
--     • _stamp_editor    — stub to record actor (optional)
-- =============================================================================

-- Extensions ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;

-- === Enums ===================================================================

-- Top-level "who" type used across the schema
do $$ begin
  create type owner_kind as enum ('individual','group');
exception when duplicate_object then null; end $$;

-- Roles within a group (access/roster)
do $$ begin
  create type group_role as enum ('admin','manager','member');
exception when duplicate_object then null; end $$;

-- Event credit roles (per-series defaults and per-instance overrides).
-- Also reused at slot level for operational staff (e.g., crew/host/producer/tech).
do $$ begin
  create type role_kind as enum ('performer','producer','host','promoter','crew');
exception when duplicate_object then null; end $$;

-- Calendar sharing roles
do $$ begin
  create type cal_role as enum ('owner','writer','reader');
exception when duplicate_object then null; end $$;

-- RFC 5545 ATTENDEE parameters
do $$ begin
  create type attendee_role as enum ('CHAIR','REQ-PARTICIPANT','OPT-PARTICIPANT','NON-PARTICIPANT');
exception when duplicate_object then null; end $$;
do $$ begin
  create type attendee_partstat as enum ('NEEDS-ACTION','ACCEPTED','DECLINED','TENTATIVE','DELEGATED');
exception when duplicate_object then null; end $$;

-- === Helpers =================================================================

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
