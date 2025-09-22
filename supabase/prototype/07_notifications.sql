-- 07_notifications.sql
-- =============================================================================
-- PURPOSE
--   Owner-scoped notifications with two modes of interaction:
--     • 'dismiss' — informational; visible until dismissed by the recipient.
--     • 'ack'     — actionable; recipient must answer yes/no. The outcome is
--                   recorded on the original row and a courtesy follow-up
--                   notification is sent back to the sender.
--
--   "Owner" refers to either an individual user or a group, as defined in the
--   prototype owners model. Notifications are routed from one owner to another
--   (from_owner_id → to_owner_id), and row-level security is enforced via the
--   owner_users mapping.
--
-- DESIGN GOALS
--   • Owner-level routing so both users and groups can participate uniformly.
--   • Minimal coupling: avoids depending on calendars/events; pure messaging.
--   • Simple client API: two RPCs cover dismissal and yes/no responses.
--   • Auditable outcome: ack response is persisted alongside the original row.
--   • Sender feedback: ack auto-notifies the original sender with the result.
--
-- STRUCTURAL CHOICES (why this shape?)
--   • notification_type enum ('dismiss','ack') instead of a boolean:
--     explicit future-proofing if more interaction modes are added.
--   • ack_response stored as text ('yes'/'no') rather than another enum:
--     reduces migration friction if we expand valid responses later. The check
--     constraint guards values today; callers use respond_owner_notification().
--   • from_owner_id nullable with ON DELETE SET NULL:
--     permits system-generated messages or deleted senders while preserving
--     recipient history. When present, it governs additional read access.
--   • subject_kind/subject_uuid/subject_label are denormalized pointers:
--     enable lightweight deep-linking without hard FKs across modules.
--   • responded_by_user (auth.users) is captured, not responded_by_owner:
--     ack decisions are ultimately made by a user acting on behalf of an owner.
--   • RLS reads allowed to both sides (sender/recipient operators):
--     sender visibility is important to observe delivery and outcomes; writes
--     remain restricted to recipient operators (dismiss/ack).
--   • RPC-centric mutation instead of triggers on UPDATE:
--     explicit intent (dismiss vs ack) avoids surprising state transitions and
--     simplifies client logic and auditing.
--
-- DEPENDENCIES
--   • 00_util.sql: _touch_updated_at trigger helper
--   • 04_user.sql: owners, owner_users, ensure_owner_for_user/group
--   This module does not depend on calendars/events and can be installed last.
-- =============================================================================

-- Type: notification kind
do $$ begin
  create type notification_type as enum ('dismiss','ack');
exception when duplicate_object then null; end $$;

-- Core table
create table if not exists owner_notifications (
  id              uuid primary key default gen_random_uuid(),

  -- Routing
  to_owner_id     uuid not null references owners(id) on delete cascade,
  from_owner_id   uuid references owners(id) on delete set null,
  type            notification_type not null,

  -- Content
  title           text,
  body            text,
  payload         jsonb not null default '{}'::jsonb,

  -- Optional heterogeneous subject (for deep-linking)
  subject_kind    text,
  subject_uuid    uuid,
  subject_label   text,

  -- Interaction state
  dismissed_at    timestamptz,
  -- For type='ack'
  ack_response    text check (ack_response in ('yes','no')),
  responded_at    timestamptz,
  responded_by_user uuid references auth.users(id),

  -- Lifecycle
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists owner_notifications_to_idx on owner_notifications(to_owner_id, created_at desc);
create index if not exists owner_notifications_from_idx on owner_notifications(from_owner_id, created_at desc);
create index if not exists owner_notifications_pending_ack_idx on owner_notifications(type, ack_response) where type = 'ack' and ack_response is null;

-- Maintain updated_at
do $$ begin
  create trigger trg_owner_notifications_touch
    before update on owner_notifications
    for each row execute function _touch_updated_at();
exception when duplicate_object then null; end $$;

-- RLS helpers ---------------------------------------------------------------
-- can_act_for_owner(owner_id): true if the current auth.uid() is listed in
-- owner_users for the given owner. Used by all policies below.
create or replace function can_act_for_owner(p_owner_id uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from owner_users ou
    where ou.owner_id = p_owner_id and ou.user_id = auth.uid()
  );
$$;

-- RLS policies --------------------------------------------------------------
alter table owner_notifications enable row level security;

-- Read: operators of either side (recipient or sender)
do $$ begin
  drop policy if exists on_read_owner_notifications on owner_notifications;
exception when undefined_object then null; end $$;
-- Broaden read: allow operators of recipient or sender, and allow all members
-- of a GROUP owner to read notifications addressed to that group.
create or replace function can_view_owner_notifications(p_owner_id uuid)
returns boolean language sql stable set search_path = public as $$
  select
    -- Operators of the owner (admins/managers for group; self for individual)
    exists (
      select 1 from owner_users ou where ou.owner_id = p_owner_id and ou.user_id = auth.uid()
    )
    or
    -- Any member of the group may view notifications to that group
    exists (
      select 1
      from owners o
      join group_membership gm on gm.group_id = o.group_id and gm.user_id = auth.uid() and gm.ended_on is null
      where o.id = p_owner_id and o.kind = 'group'
    );
$$;
grant execute on function can_view_owner_notifications(uuid) to authenticated;

create policy on_read_owner_notifications
on owner_notifications
for select to authenticated
using (
  can_view_owner_notifications(to_owner_id) or (from_owner_id is not null and can_act_for_owner(from_owner_id))
);

-- Update: recipient operators can update (e.g., dismiss; function will manage ack fields)
do $$ begin
  drop policy if exists on_update_owner_notifications on owner_notifications;
exception when undefined_object then null; end $$;
create policy on_update_owner_notifications
on owner_notifications
for update to authenticated
using (can_act_for_owner(to_owner_id))
with check (can_act_for_owner(to_owner_id));

-- Insert: allow operators of either the recipient or the sender to create
-- (enables server-side functions and controlled client flows if needed)
do $$ begin
  drop policy if exists on_insert_owner_notifications on owner_notifications;
exception when undefined_object then null; end $$;
create policy on_insert_owner_notifications
on owner_notifications
for insert to authenticated
with check (
  can_act_for_owner(to_owner_id)
  or (from_owner_id is not null and can_act_for_owner(from_owner_id))
);

-- RPCs ----------------------------------------------------------------------

-- Dismiss a notification (idempotent)
drop function if exists dismiss_owner_notification(p_id uuid);
create or replace function dismiss_owner_notification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public as $$
begin
  -- Ensure caller can act for recipient
  if not exists (
    select 1 from owner_notifications n
    where n.id = p_id and can_act_for_owner(n.to_owner_id)
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update owner_notifications
  set dismissed_at = coalesce(dismissed_at, now())
  where id = p_id;
end $$;
grant execute on function dismiss_owner_notification(uuid) to authenticated;

-- Respond to an ACK notification with 'yes'/'no' and notify the sender
drop function if exists respond_owner_notification(p_id uuid, p_response text);
create or replace function respond_owner_notification(p_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = public as $$
declare
  v_type notification_type;
  v_to   uuid;
  v_from uuid;
  v_title text;
  v_body  text;
  v_payload jsonb;
  v_subject_kind text; v_subject_uuid uuid; v_subject_label text;
  v_resp text;
begin
  v_resp := lower(trim(p_response));
  if v_resp not in ('yes','no') then
    raise exception 'invalid response: %', p_response using errcode = '22023';
  end if;

  -- Load and authorize
  select type, to_owner_id, from_owner_id, title, body, payload, subject_kind, subject_uuid, subject_label
  into v_type, v_to, v_from, v_title, v_body, v_payload, v_subject_kind, v_subject_uuid, v_subject_label
  from owner_notifications where id = p_id for update;

  if not found then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;
  if v_type <> 'ack' then
    raise exception 'not an ack notification' using errcode = '22023';
  end if;
  if not can_act_for_owner(v_to) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Record response and dismiss original
  update owner_notifications
  set ack_response = v_resp,
      responded_at = now(),
      responded_by_user = auth.uid(),
      dismissed_at = coalesce(dismissed_at, now())
  where id = p_id;

  -- Notify sender with a dismiss-style message (if sender exists)
  if v_from is not null then
    insert into owner_notifications (
      to_owner_id, from_owner_id, type, title, body, payload,
      subject_kind, subject_uuid, subject_label
    ) values (
      v_from, v_to, 'dismiss',
      coalesce(v_title, 'Acknowledgment response'),
      format('Response: %s', v_resp),
      coalesce(v_payload, '{}'::jsonb) || jsonb_build_object('ack_response', v_resp, 'source_notification_id', p_id::text),
      v_subject_kind, v_subject_uuid, v_subject_label
    );
  end if;
end $$;
grant execute on function respond_owner_notification(uuid, text) to authenticated;

-- ============================================================
-- Group membership invites via notifications
-- ============================================================

-- Invite a user (by email) to join a group via an ACK notification.
-- Returns the created notification id.
drop function if exists invite_user_to_group_by_email(p_group_id uuid, p_email text, p_role text);
create or replace function invite_user_to_group_by_email(
  p_group_id uuid,
  p_email    text,
  p_role     text default 'member'
) returns uuid
language plpgsql
security definer
set search_path = public as $$
declare
  v_group_owner uuid;
  v_user_id     uuid;
  v_to_owner    uuid;
  v_role        group_role := coalesce(p_role,'member')::group_role;
  v_group_name  text;
  v_notif_id    uuid;
  v_inviter_name text;
  v_target_name  text;
begin
  -- Resolve the group owner and check caller can operate for it (admin/manager)
  v_group_owner := ensure_owner_for_group(p_group_id);
  if not exists (
    select 1 from owner_users ou
    where ou.owner_id = v_group_owner and ou.user_id = auth.uid() and ou.role in ('admin','manager')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Resolve target user and their owner id
  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    raise exception 'user not found: %', p_email using errcode = 'P0002';
  end if;
  v_to_owner := ensure_owner_for_user(v_user_id);

  select name into v_group_name from "group" where group_id = p_group_id;

  -- Resolve inviter and target display names (best-effort)
  select coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(u.email::text,'@',1), u.email::text)
    into v_inviter_name
  from auth.users u where u.id = auth.uid();
  select coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(u.email::text,'@',1), u.email::text)
    into v_target_name
  from auth.users u where u.id = v_user_id;

  insert into owner_notifications (
    to_owner_id, from_owner_id, type, title, body, payload,
    subject_kind, subject_uuid, subject_label
  ) values (
    v_to_owner, v_group_owner, 'ack',
    coalesce(format('Invitation to join %s', v_group_name), 'Group invitation'),
    'Would you like to join this group?',
    jsonb_build_object(
      'kind','group_invite',
      'group_id', p_group_id::text,
      'group_name', v_group_name,
      'role', v_role::text,
      'invited_by_user', auth.uid()::text,
      'invited_by_name', v_inviter_name,
      'target_user_id', v_user_id::text,
      'target_user_email', p_email,
      'target_user_name', v_target_name
    ),
    'group', p_group_id, v_group_name
  ) returning id into v_notif_id;

  return v_notif_id;
end $$;
grant execute on function invite_user_to_group_by_email(uuid, text, text) to authenticated;

-- Respond to a group invite (ack notification) and, on 'yes', add/ensure membership.
drop function if exists respond_group_invite(p_notification_id uuid, p_response text);
create or replace function respond_group_invite(
  p_notification_id uuid,
  p_response        text
) returns void
language plpgsql
security definer
set search_path = public as $$
declare
  v_type           notification_type;
  v_to_owner       uuid;
  v_from_owner     uuid;
  v_payload        jsonb;
  v_group_id       uuid;
  v_role           group_role;
  v_user_id        uuid;
  v_resp           text;
  v_has_active     boolean;
begin
  v_resp := lower(trim(p_response));
  if v_resp not in ('yes','no') then
    raise exception 'invalid response: %', p_response using errcode = '22023';
  end if;

  -- Load notification and authorize recipient
  select type, to_owner_id, from_owner_id, payload
  into v_type, v_to_owner, v_from_owner, v_payload
  from owner_notifications
  where id = p_notification_id
  for update;

  if not found then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;
  if v_type <> 'ack' then
    raise exception 'not an ack notification' using errcode = '22023';
  end if;
  if not can_act_for_owner(v_to_owner) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Only handle group_invite here; otherwise, just record via generic responder
  if coalesce(v_payload->>'kind','') <> 'group_invite' then
    perform respond_owner_notification(p_notification_id, v_resp);
    return;
  end if;

  v_group_id := (v_payload->>'group_id')::uuid;
  v_role     := coalesce((v_payload->>'role')::group_role, 'member');

  if v_resp = 'yes' then
    -- Resolve the individual user behind the recipient owner
    select individual_user_id into v_user_id
    from owners
    where id = v_to_owner and kind = 'individual';

    if v_user_id is null then
      raise exception 'invite target is not an individual owner' using errcode = '22023';
    end if;

    -- If an active membership exists, update role; else insert a new active row
    select exists (
      select 1 from group_membership
      where group_id = v_group_id and user_id = v_user_id and ended_on is null
    ) into v_has_active;

    if v_has_active then
      update group_membership
      set role = v_role
      where group_id = v_group_id and user_id = v_user_id and ended_on is null;
    else
      insert into group_membership (group_id, user_id, role, started_on)
      values (v_group_id, v_user_id, v_role, current_date);
    end if;
  end if;

  -- Record ack and notify original sender
  perform respond_owner_notification(p_notification_id, v_resp);
end $$;
grant execute on function respond_group_invite(uuid, text) to authenticated;

-- ============================================================
-- Convenience RPCs for listing notifications
-- ============================================================

-- List notifications for the caller's individual owner
drop function if exists list_my_owner_notifications();
create or replace function list_my_owner_notifications()
returns setof owner_notifications
language sql stable security definer set search_path = public as $$
  select n.*
  from owner_notifications n
  where n.to_owner_id = get_owner_for_user(auth.uid())
    and can_view_owner_notifications(n.to_owner_id)
  order by n.created_at desc
$$;
grant execute on function list_my_owner_notifications() to authenticated;

-- List notifications for a group (to_owner_id = group owner id)
drop function if exists list_group_notifications(p_group_id uuid);
create or replace function list_group_notifications(p_group_id uuid)
returns setof owner_notifications
language sql stable security definer set search_path = public as $$
  select n.*
  from owner_notifications n
  where n.to_owner_id = get_owner_for_group(p_group_id)
    and can_view_owner_notifications(n.to_owner_id)
  order by n.created_at desc
$$;
grant execute on function list_group_notifications(uuid) to authenticated;

-- List pending outgoing group invites (sender = group owner, kind = group_invite, not dismissed/responded)
drop function if exists list_group_outgoing_invites(p_group_id uuid);
create or replace function list_group_outgoing_invites(p_group_id uuid)
returns setof owner_notifications
language sql stable security definer set search_path = public as $$
  with base as (
    select n.*
    from owner_notifications n
    where n.from_owner_id = get_owner_for_group(p_group_id)
      and (n.payload->>'kind') = 'group_invite'
      and n.dismissed_at is null
      and n.ack_response is null
      and can_act_for_owner(n.from_owner_id)
  )
  select
    b.id,
    b.to_owner_id,
    b.from_owner_id,
    b.type,
    b.title,
    b.body,
    (
      coalesce(b.payload, '{}'::jsonb)
      || jsonb_build_object(
           'target_user_name', coalesce(b.payload->>'target_user_name',
             (case when o.kind = 'individual' then coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(u.email::text,'@',1), u.email::text) end)
           ),
           'target_user_email', coalesce(b.payload->>'target_user_email', u.email::text),
           'invited_by_name', coalesce(b.payload->>'invited_by_name', coalesce(nullif(inv.raw_user_meta_data->>'display_name',''), split_part(inv.email::text,'@',1), inv.email::text))
         )
    ) as payload,
    b.subject_kind,
    b.subject_uuid,
    b.subject_label,
    b.dismissed_at,
    b.ack_response,
    b.responded_at,
    b.responded_by_user,
    b.expires_at,
    b.created_at,
    b.updated_at
  from base b
  left join owners o on o.id = b.to_owner_id
  left join auth.users u on o.kind = 'individual' and u.id = o.individual_user_id
  left join auth.users inv on inv.id = nullif(b.payload->>'invited_by_user','')::uuid
  order by b.created_at desc
$$;
grant execute on function list_group_outgoing_invites(uuid) to authenticated;

-- Cancel an outstanding group invite (sender-side)
drop function if exists cancel_group_invite(p_notification_id uuid);
create or replace function cancel_group_invite(p_notification_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_to uuid; v_payload jsonb; v_kind text;
begin
  select from_owner_id, to_owner_id, payload->>'kind'
  into v_from, v_to, v_kind
  from owner_notifications
  where id = p_notification_id
  for update;
  if not found then raise exception 'notification not found' using errcode = 'P0002'; end if;
  if v_kind <> 'group_invite' then raise exception 'not a group invite' using errcode = '22023'; end if;
  if v_from is null or not can_act_for_owner(v_from) then raise exception 'not allowed' using errcode = '42501'; end if;

  update owner_notifications
     set dismissed_at = now(), payload = coalesce(payload,'{}'::jsonb) || jsonb_build_object('canceled', true)
   where id = p_notification_id;

  -- Inform recipient the invite was canceled
  if v_to is not null then
    insert into owner_notifications (to_owner_id, from_owner_id, type, title, body, payload)
    values (
      v_to, v_from, 'dismiss', 'Invitation withdrawn', 'The group invitation has been withdrawn.', jsonb_build_object('source_notification_id', p_notification_id::text, 'kind','group_invite_canceled')
    );
  end if;
end $$;
grant execute on function cancel_group_invite(uuid) to authenticated;

-- ============================================================
-- USAGE NOTES / EXAMPLES
-- ============================================================
-- Listing notifications for current user (acting as an individual owner):
--   select * from owner_notifications n
--   where n.to_owner_id = ensure_owner_for_user(auth.uid())
--   order by created_at desc;
--
-- Dismissing a notification:
--   select dismiss_owner_notification('<notification_uuid>');
--
-- Responding to an ACK (generic):
--   select respond_owner_notification('<notification_uuid>', 'yes');
--
-- Sending a group invite (as group admin/manager):
--   select invite_user_to_group_by_email('<group_uuid>', 'user@example.com', 'member');
--
-- Accepting a group invite (recipient):
--   select respond_group_invite('<notification_uuid>', 'yes');
--
-- Edge cases and concurrency:
--   • Multiple operators may read a notification; only recipient operators can
--     mutate it. Updates are row-locked during response to avoid races.
--   • respond_owner_notification() is safe to call once; calling again will
--     overwrite the ack_response. Clients should avoid duplicate submissions.
--   • dismiss_owner_notification() is idempotent.
--
-- Extensibility:
--   • New interaction modes can be added to notification_type.
--   • Additional responders (e.g., multi-choice) can mirror the ACK pattern
--     and emit a follow-up 'dismiss' to the sender carrying the outcome.
--   • subject_* can point to calendars/events/tasks without creating hard FKs.
-- =============================================================================
