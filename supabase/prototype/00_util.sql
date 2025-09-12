-- ============================================================
-- utils.sql
-- Run order: 1) utils.sql  2) user.sql  3) calendar.sql
-- WHY: This file contains generic, table-agnostic utilities that other files depend on:
--      * common extensions
--      * shared enums
--      * generic helper triggers
--      Keeping these separate ensures no forward references to tables.
-- ============================================================

-- Extensions (WHY: pgcrypto for gen_random_uuid(); citext for case-insensitive emails)
create extension if not exists pgcrypto;
create extension if not exists citext;

-- Owner kind for generic ownership (individual user, act, producer)
do $$ begin
  create type owner_kind as enum ('individual','act','producer');
exception when duplicate_object then null; end $$;

-- Calendar member roles (reader/writer/owner)
do $$ begin
  create type cal_role as enum ('owner','writer','reader');
exception when duplicate_object then null; end $$;

-- Event attendee roles (subset of RFC parameters)
do $$ begin
  create type attendee_role as enum ('REQ-PARTICIPANT','OPT-PARTICIPANT','NON-PARTICIPANT','CHAIR');
exception when duplicate_object then null; end $$;

-- Event attendee participation status (RFC-style)
do $$ begin
  create type attendee_partstat as enum
    ('NEEDS-ACTION','ACCEPTED','DECLINED','TENTATIVE','DELEGATED','COMPLETED','IN-PROCESS');
exception when duplicate_object then null; end $$;

-- Entity-user role for acts/producers control surface
do $$ begin
  create type entity_user_role as enum ('admin','editor','viewer');
exception when duplicate_object then null; end $$;

-- Generic timestamp touch trigger (WHY: standardize updated_at bookkeeping)
create or replace function _touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Optional: stamp the editor (auth.uid()) on update (calendar.sql may add updated_by column)
create or replace function _stamp_editor() returns trigger
language plpgsql as $$
begin
  -- This function assumes a column named updated_by exists on the target table.
  -- If it doesn't, attach this trigger only where available.
  begin
    new.updated_by := auth.uid();
  exception when undefined_column then
    -- ignore if column doesn't exist on the target table
    null;
  end;
  return new;
end $$;
