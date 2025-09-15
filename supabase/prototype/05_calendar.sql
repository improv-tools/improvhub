-- ============================================================
-- calendar.sql
-- Run order: 1) utils.sql  2) user.sql  3) calendar.sql
-- WHY: This file defines calendars (owned by generic owners), sharing,
--      RFC 5545 event storage (events/overrides/attendees), RLS policies,
--      and RPC functions for CRUD. The heavy RFC logic (RRULE expansion,
--      ICS import/export) should live in Edge Functions.
-- ============================================================

-- CALENDARS (owned by owners.id), plus calendar-level members for ad-hoc sharing
create table if not exists calendars (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references owners(id) on delete cascade, -- WHY: generic ownership abstraction
  name             text not null,
  description      text,
  color            text,
  timezone_default text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_cal_touch on calendars;
create trigger trg_cal_touch
before update on calendars
for each row execute function _touch_updated_at();

create table if not exists calendar_members (
  calendar_id uuid not null references calendars(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  role        cal_role not null,              -- WHY: 'writer'/'reader' sharers alongside owner_users
  primary key (calendar_id, owner_id)
);
create index if not exists idx_cal_members_user on calendar_members(owner_id);

-- =========================
-- RFC 5545 TABLES
-- =========================

-- Master events (VEVENT)
create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  calendar_id      uuid not null references calendars(id) on delete cascade,

  uid              text not null,                    -- WHY: iTIP identity per calendar
  sequence         int  not null default 0,          -- WHY: bump on meaningful change
  last_modified    timestamptz not null default now(),

  dtstart          timestamptz not null,             -- store UTC
  dtend            timestamptz,                      -- XOR with duration_sec
  duration_sec     int,
  tzid             text,                             -- original zone for DTSTART
  all_day          boolean not null default false,

  rrule            text,                             -- raw RFC strings; expansion in Edge
  rdate            timestamptz[],
  exdate           timestamptz[],

  summary          text,
  description      text,
  location         text,
  geo_lat          double precision,
  geo_lon          double precision,
  url              text,
  status           text check (status in ('TENTATIVE','CONFIRMED','CANCELLED')),
  transparency     text check (transparency in ('OPAQUE','TRANSPARENT')),
  organizer_email  citext,
  organizer_name   text,
  categories       text[],
  extended         jsonb not null default '{}'::jsonb,

  created_by       uuid default auth.uid(),          -- optional audit
  updated_by       uuid,                             -- optional audit
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint events_uid_unique_per_cal unique (calendar_id, uid),
  constraint events_time_choice check ((dtend is null) <> (duration_sec is null)),
  constraint events_dt_order check (dtend is null or dtend > dtstart)
);
create index if not exists idx_events_cal_dt on events (calendar_id, dtstart);
create index if not exists idx_events_cal_uid on events (calendar_id, uid);
create index if not exists idx_events_categories on events using gin (categories);
create index if not exists idx_events_extended on events using gin (extended);

drop trigger if exists trg_events_touch on events;
create trigger trg_events_touch
before update on events
for each row execute function _touch_updated_at();

drop trigger if exists trg_events_editor on events;
create trigger trg_events_editor
before update on events
for each row execute function _stamp_editor();

-- Detached per-instance overrides (RECURRENCE-ID)
create table if not exists event_overrides (
  id               uuid primary key default gen_random_uuid(),
  parent_event_id  uuid not null references events(id) on delete cascade,
  recurrence_id    timestamptz not null,             -- original instance start (UTC)

  dtstart          timestamptz,
  dtend            timestamptz,
  duration_sec     int,
  tzid             text,
  all_day          boolean,

  summary          text,
  description      text,
  location         text,
  geo_lat          double precision,
  geo_lon          double precision,
  url              text,
  status           text check (status in ('TENTATIVE','CONFIRMED','CANCELLED')),
  transparency     text check (transparency in ('OPAQUE','TRANSPARENT')),
  categories       text[],
  extended         jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint overrides_time_choice check (dtend is null or duration_sec is null),
  constraint overrides_dt_order check (dtend is null or (dtstart is not null and dtend > dtstart)),
  constraint overrides_unique_instance unique (parent_event_id, recurrence_id)
);
create index if not exists idx_overrides_parent_rid on event_overrides (parent_event_id, recurrence_id);

drop trigger if exists trg_overrides_touch on event_overrides;
create trigger trg_overrides_touch
before update on event_overrides
for each row execute function _touch_updated_at();

-- ATTENDEES (series-level or per-override)
create table if not exists event_attendees (
  id               uuid primary key default gen_random_uuid(),
  -- Canonical scope
  event_id         uuid not null references events(id) on delete cascade,
  override_id      uuid references event_overrides(id) on delete cascade,  -- NULL => series-level
  slot_id          uuid references slots(id),

  owner_id         uuid references owners(id),  -- canonical internal attendee (user/act/producer)                               -- when attendees differ per slot

  -- Canonical identity for attendee (one of these must be present)
  owner_id         uuid references owners(id),  -- internal canonical owner (user/act/producer)
  email            citext,                      -- external CAL-ADDRESS for iTIP; NULL when using owner_id only

  -- RFC5545 attendee parameters/state
  cn               text,
  role             attendee_role,
  partstat         attendee_partstat,
  rsvp             boolean,
  cutype           text check (cutype in ('INDIVIDUAL','GROUP','RESOURCE','ROOM','UNKNOWN')),

  -- Group context (for MEMBER= and lineage)
  member_of                     text[],   -- legacy email-based (DLs / externals)
  member_of_owner_ids           uuid[],   -- structured owner-based groups (internal)

  delegated_to     citext[],
  delegated_from   citext[],
  sent_by          citext,

  params           jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Either slot-scoped OR (event/override)-scoped
  constraint attendees_scope_ck check (
    (slot_id is not null and override_id is null)
    or
    (slot_id is null)
  ),

  -- Require at least one identity
  constraint attendees_identity_ck check (owner_id is not null or email is not null)
)


-- ============================================================
-- Constraint trigger: ensure slot-scoped attendees' member_of_owner_ids
-- are a subset of the owners actually assigned to that slot (via slot_acts → owners(kind='act')).
-- ============================================================
create or replace function _chk_attendee_member_of_slot_owners()
returns trigger
language plpgsql as $$
declare
  invalid uuid[];
begin
  -- Only enforce for slot-scoped rows with a non-empty member_of_owner_ids array
  if new.slot_id is null or new.member_of_owner_ids is null or array_length(new.member_of_owner_ids,1) is null then
    return new;
  end if;

  -- Compute which owner_ids (if any) are not present in v_slot_owners for this slot
  select coalesce(array_agg(x.owner_id), '{}') into invalid
  from unnest(new.member_of_owner_ids) as mo(owner_id)
  left join v_slot_owners x on x.slot_id = new.slot_id and x.owner_id = mo.owner_id
  where x.owner_id is null;

  if invalid is not null and array_length(invalid,1) is not null then
    raise exception 'member_of_owner_ids must reference owners assigned to this slot. Invalid: %', invalid;
  end if;

  return new;
end $$;

drop trigger if exists trg_chk_attendee_member_of_slot_owners on event_attendees;
create constraint trigger trg_chk_attendee_member_of_slot_owners
after insert or update on event_attendees
deferrable initially deferred
for each row execute function _chk_attendee_member_of_slot_owners();

;

-- Scope-aware uniqueness:
--  - Internal canonical attendees: (scope, owner_id)
--  - External email attendees:     (scope, lower(email))
create unique index if not exists uq_event_attendees_scope_owner
    on event_attendees (
      coalesce(slot_id,      '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(override_id,  '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(owner_id,     '00000000-0000-0000-0000-000000000000'::uuid)
    )
    where owner_id is not null;

  create unique index if not exists uq_event_attendees_scope_email
    on event_attendees (
      coalesce(slot_id,      '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(override_id,  '00000000-0000-0000-0000-000000000000'::uuid),
      lower(email)
    )
    where owner_id is null and email is not null;
exception when duplicate_object then null; end $$;


create index if not exists idx_attendees_event on event_attendees (event_id);
create index if not exists idx_attendees_override on event_attendees (override_id);
create index if not exists idx_attendees_user      on event_attendees (owner_id);
create index if not exists idx_attendees_email     on event_attendees (email);

-- uniqueness per (event, occurrence-or-series, identity)
-- treats NULL override_id as equal across rows
-- =========================
-- SEQUENCE/EDITOR TRIGGERS
-- =========================

create or replace function _bump_event_sequence() returns trigger
language plpgsql as $$
begin
  if row(NEW.dtstart, NEW.dtend, NEW.duration_sec, NEW.rrule, NEW.rdate, NEW.exdate,
         NEW.summary, NEW.description, NEW.location, NEW.status, NEW.transparency,
         NEW.categories, NEW.extended)
     is distinct from
     row(OLD.dtstart, OLD.dtend, OLD.duration_sec, OLD.rrule, OLD.rdate, OLD.exdate,
         OLD.summary, OLD.description, OLD.location, OLD.status, OLD.transparency,
         OLD.categories, OLD.extended)
  then
    NEW.sequence := coalesce(OLD.sequence,0) + 1;
    NEW.last_modified := now();
  end if;
  return NEW;
end $$;
drop trigger if exists trg_events_bump_seq on events;
create trigger trg_events_bump_seq
before update on events
for each row execute function _bump_event_sequence();

create or replace function _bump_parent_sequence_from_override() returns trigger
language plpgsql as $$
begin
  update events
     set sequence = sequence + 1,
         last_modified = now(),
         updated_at = now()
   where id = coalesce(NEW.parent_event_id, OLD.parent_event_id);
  return coalesce(NEW,OLD);
end $$;
drop trigger if exists trg_overrides_bump_parent on event_overrides;
create trigger trg_overrides_bump_parent
after insert or update or delete on event_overrides
for each row execute function _bump_parent_sequence_from_override();

-- OPTIONAL: auto-add organizer as attendee (CHAIR). Comment out if not desired.
create or replace function _auto_add_organizer_attendee() returns trigger
language plpgsql as $$
begin
  if new.organizer_email is not null then
    insert into event_attendees (event_id, email, cn, role, partstat, rsvp)
    values (new.id, new.organizer_email, new.organizer_name, 'CHAIR', 'NEEDS-ACTION', false)
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_events_add_org_att on events;
create trigger trg_events_add_org_att
after insert on events
for each row execute function _auto_add_organizer_attendee();

-- =========================
-- VIEWS (UI-friendly)
-- =========================

create or replace view v_events as
select
  e.*,
  (
    select jsonb_agg(jsonb_build_object(
      'email', a.email, 'cn', a.cn, 'role', a.role, 'partstat', a.partstat,
      'rsvp', a.rsvp, 'params', a.params
    ) order by a.email)
    from event_attendees a
    where a.event_id = e.id and a.override_id is null
  ) as attendees_series
from events e;

create or replace view v_event_overrides as
select
  o.*,
  (
    select jsonb_agg(jsonb_build_object(
      'email', a.email, 'cn', a.cn, 'role', a.role, 'partstat', a.partstat,
      'rsvp', a.rsvp, 'params', a.params
    ) order by a.email)
    from event_attendees a
    where a.override_id = o.id
  ) as attendees_override
from event_overrides o;

create or replace view v_events_with_overrides as
select e.id as event_id, null::uuid as override_id, e.calendar_id, e.uid, e.sequence,
       e.dtstart, e.dtend, e.duration_sec, e.tzid, e.all_day,
       e.rrule, e.rdate, e.exdate,
       e.summary, e.description, e.location, e.geo_lat, e.geo_lon, e.url,
       e.status, e.transparency, e.categories, e.extended,
       e.created_at, e.updated_at, e.last_modified
from events e
union all
select o.parent_event_id, o.id, e.calendar_id, e.uid, e.sequence,
       coalesce(o.dtstart, e.dtstart),
       coalesce(o.dtend,   e.dtend),
       coalesce(o.duration_sec, e.duration_sec),
       coalesce(o.tzid, e.tzid),
       coalesce(o.all_day, e.all_day),
       e.rrule, e.rdate, e.exdate,
       coalesce(o.summary, e.summary),
       coalesce(o.description, e.description),
       coalesce(o.location, e.location),
       coalesce(o.geo_lat, e.geo_lat),
       coalesce(o.geo_lon, e.geo_lon),
       coalesce(o.url, e.url),
       coalesce(o.status, e.status),
       coalesce(o.transparency, e.transparency),
       coalesce(o.categories, e.categories),
       coalesce(o.extended, e.extended),
       o.created_at, o.updated_at, e.last_modified
from event_overrides o
join events e on e.id = o.parent_event_id;

-- =========================
-- RLS HELPERS & POLICIES
-- =========================

alter table if exists calendars         enable row level security;
alter table if exists calendar_members  enable row level security;
alter table if exists events            enable row level security;
alter table if exists event_overrides   enable row level security;
alter table if exists event_attendees   enable row level security;

-- Who is owner-level for a calendar? (admins of the owning entity)
create or replace function is_owner_level(cal_id uuid)
returns boolean language sql stable as $$
  select exists(
    select 1
    from calendars c
    join owner_users ou on ou.owner_id = c.owner_id
    where c.id = cal_id
      and ou.owner_id = auth.uid()
      and ou.role in ('admin')
  );
$$;

-- Who can write a calendar? (owner admins OR per-calendar writers/owners)
create or replace function can_write_calendar(cal_id uuid)
returns boolean language sql stable as $$
  select exists(
    select 1
    from calendars c
    join owner_users ou on ou.owner_id = c.owner_id
    where c.id = cal_id and ou.owner_id = auth.uid() and ou.role in ('admin','editor')
    union
    select 1
    from calendar_members m
    where m.calendar_id = cal_id and m.owner_id = auth.uid() and m.role in ('owner','writer')
  );
$$;

-- Who can read a calendar? (members or any operator of the owner entity)
create or replace function is_member_of (emails)_calendar(cal_id uuid)
returns boolean language sql stable as $$
  select exists(
    select 1 from calendar_members m where m.calendar_id = cal_id and m.owner_id = auth.uid()
    union
    select 1 from calendars c join owner_users ou on ou.owner_id = c.owner_id
      where c.id = cal_id and ou.owner_id = auth.uid()
  );
$$;

-- Calendar policies
create policy cal_read on calendars for select
using (is_member_of (emails)_calendar(id));

create policy cal_write on calendars for all
using (is_owner_level(id))
with check (is_owner_level(id));

-- Calendar members
create policy members_read on calendar_members for select
using (is_member_of (emails)_calendar(calendar_id));

create policy members_write on calendar_members for all
using (is_owner_level(calendar_id))
with check (is_owner_level(calendar_id));

-- Events
create policy events_read on events for select
using (is_member_of (emails)_calendar(calendar_id));

create policy events_insert on events for insert
with check (can_write_calendar(calendar_id));

create policy events_update on events for update
using (can_write_calendar(calendar_id))
with check (can_write_calendar(calendar_id));

create policy events_delete on events for delete
using (can_write_calendar(calendar_id));

-- Overrides
create policy overrides_read on event_overrides for select
using (is_member_of (emails)_calendar((select calendar_id from events where id = parent_event_id)));

create policy overrides_cud on event_overrides for all
using (can_write_calendar((select calendar_id from events where id = parent_event_id)))
with check (can_write_calendar((select calendar_id from events where id = parent_event_id)));


-- ============================================================
-- Attendee identity uses canonical owner_id (owners.id) or external email
-- WHY: Owners are our canonical entity (user/act/producer). Attendees may be:
--   * internal owner (owner_id UUID)
--   * external via email (CAL-ADDRESS)
-- We retain 'email' for external attendees. We also add 'member_of (emails)_owner_ids'
-- to carry structured group membership alongside the existing text[] 'member_of (emails)'.
-- ============================================================
-- NOTE: We are deprecating 'owner_id'. Keep the column for now if it exists for backward-compat,
-- but new writes should use owner_id. Migration step can backfill owner_id from owner_id -> owners(id).

-- Attendees
create policy attendees_read on event_attendees for select
using (is_member_of (emails)_calendar((select calendar_id from events where id = event_id)));

create policy attendees_cud on event_attendees for all
using (can_write_calendar((select calendar_id from events where id = event_id)))
with check (can_write_calendar((select calendar_id from events where id = event_id)));

-- =========================
-- RPC API (SECURITY DEFINER)
-- =========================

create schema if not exists api;

-- Create calendar under a specific owner (kind + ref_id)
create or replace function api.create_calendar_with_owner(p jsonb)
returns calendars
language plpgsql security definer set search_path=public as $$
declare
  v_owner owners;
  v_cal   calendars;
begin
  if (p->>'kind') not in ('individual','act','producer') then
    raise exception 'Invalid owner kind';
  end if;

  if p->>'kind' = 'individual' then
    insert into owners(kind, individual_owner_id, display_name)
    values ('individual', coalesce(nullif(p->>'ref_id','')::uuid, auth.uid()), p->>'display_name')
    on conflict do nothing;
    select * into v_owner from owners
     where kind='individual' and individual_owner_id = coalesce(nullif(p->>'ref_id','')::uuid, auth.uid())
     limit 1;
  elsif p->>'kind' = 'act' then
    if p->>'ref_id' is null then raise exception 'act ref_id required'; end if;
    insert into owners(kind, owner_id, display_name)
    values ('act', (p->>'ref_id')::uuid, p->>'display_name')
    on conflict do nothing;
    select * into v_owner from owners where kind='act' and owner_id=(p->>'ref_id')::uuid limit 1;
  else
    if p->>'ref_id' is null then raise exception 'producer ref_id required'; end if;
    insert into owners(kind, producer_id, display_name)
    values ('producer', (p->>'ref_id')::uuid, p->>'display_name')
    on conflict do nothing;
    select * into v_owner from owners where kind='producer' and producer_id=(p->>'ref_id')::uuid limit 1;
  end if;

  insert into calendars(owner_id, name, description, color, timezone_default)
  values (
    v_owner.id,
    p->>'name',
    nullif(p->>'description',''),
    nullif(p->>'color',''),
    coalesce(p->>'timezone_default','Europe/Dublin')
  )
  returning * into v_cal;

  -- Convenience: add caller as writer member
  insert into calendar_members(calendar_id, owner_id, role)
  values (v_cal.id, auth.uid(), 'writer')
  on conflict do nothing;

  return v_cal;
end $$;

-- Create Event
create or replace function api.create_event(p jsonb)
returns events
language plpgsql security definer set search_path=public as $$
declare v events;
begin
  insert into events (
    calendar_id, uid, dtstart, dtend, duration_sec, tzid, all_day,
    rrule, rdate, exdate, summary, description, location, geo_lat, geo_lon,
    url, status, transparency, organizer_email, organizer_name, categories, extended
  )
  values (
    (p->>'calendar_id')::uuid,
    coalesce(p->>'uid', gen_random_uuid()::text),
    (p->>'dtstart')::timestamptz,
    nullif(p->>'dtend','')::timestamptz,
    nullif(p->>'duration_sec','')::int,
    nullif(p->>'tzid',''),
    coalesce((p->>'all_day')::bool,false),
    nullif(p->>'rrule',''),
    case when p ? 'rdate' then (select array_agg((x)::timestamptz) from jsonb_array_elements_text(p->'rdate') x) end,
    case when p ? 'exdate' then (select array_agg((x)::timestamptz) from jsonb_array_elements_text(p->'exdate') x) end,
    nullif(p->>'summary',''),
    nullif(p->>'description',''),
    nullif(p->>'location',''),
    nullif(p->>'geo_lat','')::double precision,
    nullif(p->>'geo_lon','')::double precision,
    nullif(p->>'url',''),
    nullif(upper(p->>'status'),''),
    nullif(upper(p->>'transparency'),''),
    nullif(p->>'organizer_email',''),
    nullif(p->>'organizer_name',''),
    case when p ? 'categories' then (select array_agg(value::text) from jsonb_array_elements(p->'categories')) end,
    coalesce(p->'extended','{}'::jsonb)
  )
  returning * into v;
  return v;
end $$;

-- Update Event (partial)
create or replace function api.update_event(event_id uuid, p jsonb)
returns events
language plpgsql security definer set search_path=public as $$
declare v events;
begin
  update events set
    dtstart        = coalesce((p->>'dtstart')::timestamptz, dtstart),
    dtend          = coalesce(nullif(p->>'dtend','')::timestamptz, dtend),
    duration_sec   = coalesce(nullif(p->>'duration_sec','')::int, duration_sec),
    tzid           = coalesce(nullif(p->>'tzid',''), tzid),
    all_day        = coalesce((p->>'all_day')::bool, all_day),
    rrule          = coalesce(nullif(p->>'rrule',''), rrule),
    rdate          = coalesce(case when p ? 'rdate'
                       then (select array_agg((x)::timestamptz) from jsonb_array_elements_text(p->'rdate') x) end, rdate),
    exdate         = coalesce(case when p ? 'exdate'
                       then (select array_agg((x)::timestamptz) from jsonb_array_elements_text(p->'exdate') x) end, exdate),
    summary        = coalesce(nullif(p->>'summary',''), summary),
    description    = coalesce(nullif(p->>'description',''), description),
    location       = coalesce(nullif(p->>'location',''), location),
    geo_lat        = coalesce(nullif(p->>'geo_lat','')::double precision, geo_lat),
    geo_lon        = coalesce(nullif(p->>'geo_lon','')::double precision, geo_lon),
    url            = coalesce(nullif(p->>'url',''), url),
    status         = coalesce(nullif(upper(p->>'status'),''), status),
    transparency   = coalesce(nullif(upper(p->>'transparency'),''), transparency),
    organizer_email= coalesce(nullif(p->>'organizer_email',''), organizer_email),
    organizer_name = coalesce(nullif(p->>'organizer_name',''), organizer_name),
    categories     = coalesce(case when p ? 'categories'
                       then (select array_agg(value::text) from jsonb_array_elements(p->'categories')) end, categories),
    extended       = coalesce(p->'extended', extended)
  where id = event_id
  returning * into v;
  return v;
end $$;

-- Delete Event
create or replace function api.delete_event(event_id uuid)
returns void language sql security definer set search_path=public as $$
  delete from events where id = event_id;
$$;

-- Upsert Override
create or replace function api.upsert_override(parent_event_id uuid, p jsonb)
returns event_overrides
language plpgsql security definer set search_path=public as $$
declare o event_overrides;
begin
  insert into event_overrides (
    parent_event_id, recurrence_id, dtstart, dtend, duration_sec, tzid, all_day,
    summary, description, location, geo_lat, geo_lon, url, status, transparency,
    categories, extended
  )
  values (
    parent_event_id,
    (p->>'recurrence_id')::timestamptz,
    nullif(p->>'dtstart','')::timestamptz,
    nullif(p->>'dtend','')::timestamptz,
    nullif(p->>'duration_sec','')::int,
    nullif(p->>'tzid',''),
    (p->>'all_day')::bool,
    nullif(p->>'summary',''),
    nullif(p->>'description',''),
    nullif(p->>'location',''),
    nullif(p->>'geo_lat','')::double precision,
    nullif(p->>'geo_lon','')::double precision,
    nullif(p->>'url',''),
    nullif(upper(p->>'status'),''),
    nullif(upper(p->>'transparency'),''),
    case when p ? 'categories' then (select array_agg(value::text) from jsonb_array_elements(p->'categories')) end,
    case when p ? 'extended' then p->'extended' end
  )
  on conflict (parent_event_id, recurrence_id) do update
  set dtstart        = coalesce(excluded.dtstart, event_overrides.dtstart),
      dtend          = coalesce(excluded.dtend, event_overrides.dtend),
      duration_sec   = coalesce(excluded.duration_sec, event_overrides.duration_sec),
      tzid           = coalesce(excluded.tzid, event_overrides.tzid),
      all_day        = coalesce(excluded.all_day, event_overrides.all_day),
      summary        = coalesce(excluded.summary, event_overrides.summary),
      description    = coalesce(excluded.description, event_overrides.description),
      location       = coalesce(excluded.location, event_overrides.location),
      geo_lat        = coalesce(excluded.geo_lat, event_overrides.geo_lat),
      geo_lon        = coalesce(excluded.geo_lon, event_overrides.geo_lon),
      url            = coalesce(excluded.url, event_overrides.url),
      status         = coalesce(excluded.status, event_overrides.status),
      transparency   = coalesce(excluded.transparency, event_overrides.transparency),
      categories     = coalesce(excluded.categories, event_overrides.categories),
      extended       = coalesce(excluded.extended, event_overrides.extended)
  returning * into o;
  return o;
end $$;

-- Delete Override
create or replace function api.delete_override(parent_event_id uuid, recurrence_id timestamptz)
returns void language sql security definer set search_path=public as $$
  delete from event_overrides
  where parent_event_id = $1 and recurrence_id = $2;
$$;

-- Upsert Attendee (series or per-occurrence via override_id)
create or replace function api.upsert_attendee(p jsonb)
returns event_attendees
language plpgsql security definer set search_path=public as $$
declare
  v_owner_id uuid := nullif(p->>'owner_id','')::uuid; a event_attendees;
begin
  insert into event_attendees (
    event_id, override_id, email, cn, role, partstat, rsvp, cutype,
    member_of (emails), delegated_to, delegated_from, sent_by, params
  )
  values (
    (p->>'event_id')::uuid,
    nullif(p->>'override_id','')::uuid,
    (p->>'email')::citext,
    nullif(p->>'cn',''),
    nullif(p->>'role','')::attendee_role,
    nullif(p->>'partstat','')::attendee_partstat,
    coalesce((p->>'rsvp')::bool, false),
    nullif(p->>'cutype',''),
    case when p ? 'member_of (emails)' then (select array_agg(value::text) from jsonb_array_elements(p->'member_of (emails)')) end,
    case when p ? 'delegated_to' then (select array_agg(value::citext) from jsonb_array_elements_text(p->'delegated_to')) end,
    case when p ? 'delegated_from' then (select array_agg(value::citext) from jsonb_array_elements_text(p->'delegated_from')) end,
    nullif(p->>'sent_by','')::citext,
    coalesce(p->'params','{}'::jsonb)
  )
  on conflict (event_id, coalesce(override_id, '00000000-0000-0000-0000-000000000000'::uuid), email)
  do update set
    cn         = coalesce(excluded.cn, event_attendees.cn),
    role       = coalesce(excluded.role, event_attendees.role),
    partstat   = coalesce(excluded.partstat, event_attendees.partstat),
    rsvp       = coalesce(excluded.rsvp, event_attendees.rsvp),
    cutype     = coalesce(excluded.cutype, event_attendees.cutype),
    member_of (emails)  = coalesce(excluded.member_of (emails), event_attendees.member_of (emails)),
    delegated_to   = coalesce(excluded.delegated_to, event_attendees.delegated_to),
    delegated_from = coalesce(excluded.delegated_from, event_attendees.delegated_from),
    sent_by    = coalesce(excluded.sent_by, event_attendees.sent_by),
    params     = coalesce(excluded.params, event_attendees.params)
  returning * into a;
  return a;
end $$;

-- Delete Attendee
create or replace function api.delete_attendee(event_id uuid, attendee_email citext, override_id uuid default null)
returns void language sql security definer set search_path=public as $$
  delete from event_attendees
  where event_id = $1
    and email = $2
    and ( (override_id is null and $3 is null) or (override_id = $3) );
$$;



-- Scope-aware uniqueness:
--  - For internal canonical attendees: unique by (slot or override scope, owner_id)
--  - For external attendees:        unique by (slot or override scope, lower(email))
do $$ begin
  exception when duplicate_object then null; end $$;



-- ============================================================
-- Helper view: slot → owners (derived from slot_acts with kind='act')
-- Used by constraints to validate member_of_owner_ids on slot-scoped attendees.
-- ============================================================
create or replace view v_slot_owners as
select
  sa.slot_id,
  o.id as owner_id
from slot_acts sa
join owners o
  on o.kind = 'act'
 and o.act_id = sa.act_id;

