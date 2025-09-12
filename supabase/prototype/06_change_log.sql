-- ============================================================
-- owner_change_logs.sql (owners-only)
-- Depends on: utils.sql (types), owners.sql
-- ============================================================

do $$ begin
  create type owner_log_type as enum (
    'create',
    'update',
    'delete',
    'role_change',
    'membership_add',
    'membership_remove',
    'transfer_ownership',
    'link',
    'unlink',
    'note'
  );
exception when duplicate_object then null; end $$;

create table if not exists owner_change_logs (
  id uuid primary key default gen_random_uuid(),

  -- The OWNER this log is about
  owner_id uuid not null,          -- raw UUID from owners.id (no FK)
  owner_label text not null,       -- snapshot of the owner's display name

  -- Who did it (always another owner)
  actor_owner_id uuid not null,    -- raw UUID from owners.id (no FK)
  actor_owner_label text not null, -- snapshot of actor-owner display name

  -- Optional heterogeneous SUBJECT (e.g., event, another owner, etc.)
  subject_kind text null,          -- e.g., 'event', 'owner', 'calendar'
  subject_uuid uuid null,          -- raw UUID (no FK)
  subject_label text null,         -- snapshot of subject name/title

  -- Classification + human message
  message_type owner_log_type not null,
  message text not null,

  -- Flexible metadata
  meta jsonb null,

  -- When it happened
  occurred_at timestamptz not null default now(),

  -- Handy refs
  owner_ref text generated always as ('owner:' || owner_id::text) stored,
  actor_owner_ref text generated always as ('owner:' || actor_owner_id::text) stored,
  subject_ref text generated always as (
    case when subject_kind is not null and subject_uuid is not null
      then lower(subject_kind) || ':' || subject_uuid::text end
  ) stored
);

comment on table owner_change_logs is
'Append-only log about owners. Target = owner_id, actor = another owner. Subject is polymorphic. Labels are snapshots to survive deletes.';

-- Indexes
create index if not exists owner_change_logs_owner_idx
  on owner_change_logs (owner_id, occurred_at desc);

create index if not exists owner_change_logs_actor_owner_idx
  on owner_change_logs (actor_owner_id, occurred_at desc);

create index if not exists owner_change_logs_subject_idx
  on owner_change_logs (subject_kind, subject_uuid, occurred_at desc);

create index if not exists owner_change_logs_message_type_idx
  on owner_change_logs (message_type, occurred_at desc);

create index if not exists owner_change_logs_meta_gin
  on owner_change_logs using gin (meta);

-- Append-only enforcement
create or replace function _owner_log_no_update_delete()
returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'owner_change_logs is append-only (%).', tg_op;
  end if;
  return null;
end $$;

do $$ begin
  create trigger owner_change_logs_no_update_delete
    before update or delete on owner_change_logs
    for each row execute function _owner_log_no_update_delete();
exception when duplicate_object then null; end $$;
