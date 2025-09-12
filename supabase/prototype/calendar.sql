-- =========================
-- 0) EXTENSIONS & ENUMS
-- =========================
-- WHY: pgcrypto -> UUIDs without round-tripping; citext -> case-insensitive emails.
create extension if not exists pgcrypto;
create extension if not exists citext;

-- WHY: Roles as ENUMs prevent typos and make RLS logic simpler & faster.
do $$ begin
  create type cal_role as enum ('owner','writer','reader');
exception when duplicate_object then null; end $$;

-- WHY: Map common ATTENDEE params to enums for data integrity & easy filtering.
do $$ begin
  create type attendee_role as enum ('REQ-PARTICIPANT','OPT-PARTICIPANT','NON-PARTICIPANT','CHAIR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attendee_partstat as enum
    ('NEEDS-ACTION','ACCEPTED','DECLINED','TENTATIVE','DELEGATED','COMPLETED','IN-PROCESS');
exception when duplicate_object then null; end $$;

-- WHY: Generic trigger to keep updated_at fresh everywhere.
create or replace function _touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;


-- =========================
-- 1) USER COUPLING
-- =========================
-- WHY: Keep external directory/CRM linkage separate from calendar rows.
-- Lets you join auth.users -> your systems without polluting core tables.
create table if not exists user_profiles (
  user_id          uuid primary key,            -- WHY: equals auth.users.id for joins in RLS & UI.
  external_user_id text,                        -- WHY: map to HR/CRM/etc.
  user_type        text,                        -- WHY: 'employee','contractor','guest'... free-form.
  privilege_level  int not null default 0,      -- WHY: your app-specific ladder (feature flags, etc.).
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trg_user_profiles_touch on user_profiles;
create trigger trg_user_profiles_touch
before update on user_profiles
for each row execute function _touch_updated_at();


-- =========================
-- 2) CALENDARS & MEMBERSHIP
-- =========================
-- WHY: A calendar has an owner & default TZ; members table drives RLS.
create table calendars (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null,                -- WHY: auth.users.id; owner is ultimate writer.
  name             text not null,                -- WHY: simple, searchable.
  description      text,
  color            text,                         -- WHY: UI hint only.
  timezone_default text not null,                -- WHY: IANA TZ for display & ICS round-trip.
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- WHY: Members with roles enable shared calendars; fuels RLS checks.
create table calendar_members (
  calendar_id      uuid references calendars(id) on delete cascade,
  user_id          uuid not null,                -- WHY: auth.users.id
  role             cal_role not null,            -- WHY: 'reader' vs 'writer' in policies.
  primary key (calendar_id, user_id)
);

create index on calendars (owner_user_id);
create index on calendar_members (user_id);

drop trigger if exists trg_cal_touch on calendars;
create trigger trg_cal_touch
before update on calendars
for each row execute function _touch_updated_at();



-- =========================
-- 3) EVENTS (VEVENT master)
-- =========================
-- WHY: Store raw RFC fields to preserve ICS fidelity; expansion happens in Edge, not SQL.
create table events (
  id               uuid primary key default gen_random_uuid(),
  calendar_id      uuid not null references calendars(id) on delete cascade,

  -- WHY: UID+SEQUENCE are how iTIP clients detect newer versions.
  uid              text not null,                -- WHY: globally unique per calendar.
  sequence         int  not null default 0,      -- WHY: bumped by trigger on meaningful change.
  last_modified    timestamptz not null default now(), -- WHY: sync-friendly timestamp.

  -- WHY: Always store UTC; keep original TZID for round-trip ICS exports.
  dtstart          timestamptz not null,
  dtend            timestamptz,                  -- WHY: RFC allows either DTEND or DURATION.
  duration_sec     int,                          -- WHY: XOR with dtend to avoid ambiguity.
  tzid             text,                         -- WHY: preserves DTSTART local zone for ICS.
  all_day          boolean not null default false, -- WHY: UI/rendering hint.

  -- WHY: Recurrence is stored raw; expansion via libraries (rrule.js/dateutil/etc).
  rrule            text,
  rdate            timestamptz[],                -- WHY: explicit inclusions (UTC).
  exdate           timestamptz[],                -- WHY: explicit exclusions (UTC).

  -- WHY: Core ICS properties; 'extended' holds vendor X- props for lossless round-trip.
  summary          text,
  description      text,
  location         text,
  geo_lat          double precision,
  geo_lon          double precision,
  url              text,
  status           text check (status in ('TENTATIVE','CONFIRMED','CANCELLED')),  -- WHY: RFC 5545 VEVENT.
  transparency     text check (transparency in ('OPAQUE','TRANSPARENT')),         -- WHY: busy vs free.
  organizer_email  citext,
  organizer_name   text,
  categories       text[],
  extended         jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- WHY: prevent duplicate UIDs in same calendar; necessary for iTIP flow correctness.
  constraint events_uid_unique_per_cal unique (calendar_id, uid),

  -- WHY: force a single definition of "end" to avoid conflicts.
  constraint events_time_choice check ((dtend is null) <> (duration_sec is null)),

  -- WHY: basic sanity check for time ordering.
  constraint events_dt_order check (dtend is null or dtend > dtstart)
);

create index on events (calendar_id, dtstart);    -- WHY: common range queries per calendar.
create index on events (calendar_id, uid);        -- WHY: iTIP lookups.
create index on events using gin (categories);    -- WHY: tag filters.
create index on events using gin (extended);      -- WHY: query X- props.

drop trigger if exists trg_events_touch on events;
create trigger trg_events_touch
before update on events
for each row execute function _touch_updated_at();



-- =========================
-- 4) OVERRIDES (RECURRENCE-ID)
-- =========================
-- WHY: A detached occurrence with changes at a specific instance timestamp.
-- Move/cancel/change one date without altering the entire series.
create table event_overrides (
  id               uuid primary key default gen_random_uuid(),
  parent_event_id  uuid not null references events(id) on delete cascade,
  recurrence_id    timestamptz not null,         -- WHY: original instance start (UTC).

  -- WHY: Any of these may be NULL to mean "inherit from master".
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

  -- WHY: Same XOR rule as master; avoid contradictory end definitions.
  constraint overrides_time_choice check (dtend is null or duration_sec is null),

  -- WHY: If dtend provided, dtstart must exist and be after it.
  constraint overrides_dt_order check (dtend is null or (dtstart is not null and dtend > dtstart)),

  -- WHY: Only one override per instance per event.
  constraint overrides_unique_instance unique (parent_event_id, recurrence_id)
);

create index on event_overrides (parent_event_id, recurrence_id); -- WHY: fast instance matching.

drop trigger if exists trg_ovr_touch on event_overrides;
create trigger trg_ovr_touch
before update on event_overrides
for each row execute function _touch_updated_at();



-- =========================
-- 5) ATTENDEES (ATTENDEE params)
-- =========================
-- WHY: Row per attendee per scope:
--   - series-level = override_id IS NULL
--   - per-occurrence change = override_id points to that override
-- Cleanly supports "accept series; decline one date".
create table event_attendees (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id) on delete cascade,
  override_id      uuid references event_overrides(id) on delete cascade,  -- NULL => series-level
  email            citext not null,               -- WHY: citext avoids casing issues.
  cn               text,
  role             attendee_role,
  partstat         attendee_partstat,             -- WHY: attendee's reply (not event status!).
  rsvp             boolean,
  cutype           text check (cutype in ('INDIVIDUAL','GROUP','RESOURCE','ROOM','UNKNOWN')),
  member_of        text[],
  delegated_to     citext[],
  delegated_from   citext[],
  sent_by          citext,
  params           jsonb not null default '{}'::jsonb,

  -- WHY: prevent duplicates within the same scope (series or specific instance).
  unique (event_id, coalesce(override_id, '00000000-0000-0000-0000-000000000000'::uuid), email)
);

create index on event_attendees (event_id);    -- WHY: common joins for UI.
create index on event_attendees (override_id); -- WHY: per-instance attendee diffs.



-- =========================
-- 6) VERSIONING TRIGGERS
-- =========================
-- WHY: iTIP relies on SEQUENCE increasing for meaningful updates.
-- This trigger bumps SEQUENCE when fields that matter to clients change.
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
    NEW.sequence := coalesce(OLD.sequence,0) + 1; -- WHY: signal "newer version".
    NEW.last_modified := now();                   -- WHY: sync-friendly timestamp.
  end if;
  return NEW;
end $$;

drop trigger if exists trg_events_bump_seq on events;
create trigger trg_events_bump_seq
before update on events
for each row execute function _bump_event_sequence();

-- WHY: Any change to an override also means the event version should advance
-- so subscribers can pick up the per-instance change.
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

drop trigger if exists trg_ovr_bump_parent on event_overrides;
create trigger trg_ovr_bump_parent
after insert or update or delete on event_overrides
for each row execute function _bump_parent_sequence_from_override();


-- =========================
-- 7) VIEWS FOR UI
-- =========================
-- WHY: Keep client queries simple & RLS-friendly by exposing pre-joined JSON.

-- Events with series-level attendees aggregated
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

-- Overrides with their per-occurrence attendees aggregated
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

-- Flat merged view (master + overrides). NOT an expansion: still 1 row per master or override.
-- WHY: Useful for building lists & for Edge expansion input.
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
-- 8) ROW-LEVEL SECURITY (RLS)
-- =========================
-- WHY: Make calendars safely multi-tenant. Members read; writers/owners write.

alter table user_profiles      enable row level security;
alter table calendars          enable row level security;
alter table calendar_members   enable row level security;
alter table events             enable row level security;
alter table event_overrides    enable row level security;
alter table event_attendees    enable row level security;

-- WHY: Helper checks keep policies readable & reusable.
create or replace function is_member_of_calendar(cal_id uuid)
returns boolean language sql stable as $$
  select exists(
    select 1
    from calendars c
    left join calendar_members m
      on m.calendar_id = c.id and m.user_id = auth.uid()
    where c.id = cal_id
      and (c.owner_user_id = auth.uid() or m.user_id is not null)
  );
$$;

create or replace function can_write_calendar(cal_id uuid)
returns boolean language sql stable as $$
  select exists(
    select 1
    from calendars c
    left join calendar_members m
      on m.calendar_id = c.id and m.user_id = auth.uid()
    where c.id = cal_id
      and (
        c.owner_user_id = auth.uid()
        or (m.user_id is not null and m.role in ('owner','writer'))
      )
  );
$$;

-- Calendars: anyone who is a member can read; only owner can write/edit members.
create policy cal_read on calendars for select
  using (owner_user_id = auth.uid()
     or exists (select 1 from calendar_members where calendar_id = calendars.id and user_id = auth.uid()));

create policy cal_write on calendars for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Members table managed by owner
create policy members_read on calendar_members for select
  using (is_member_of_calendar(calendar_id));

create policy members_write on calendar_members for all
  using (exists (select 1 from calendars c where c.id = calendar_members.calendar_id and c.owner_user_id = auth.uid()))
  with check (exists (select 1 from calendars c where c.id = calendar_members.calendar_id and c.owner_user_id = auth.uid()));

-- Events
create policy events_read on events for select
  using (is_member_of_calendar(calendar_id));

create policy events_insert on events for insert
  with check (can_write_calendar(calendar_id));

create policy events_update on events for update
  using (can_write_calendar(calendar_id))
  with check (can_write_calendar(calendar_id));

create policy events_delete on events for delete
  using (can_write_calendar(calendar_id));

-- Overrides (scope via parent event)
create policy overrides_read on event_overrides for select
  using (is_member_of_calendar((select calendar_id from events where id = parent_event_id)));

create policy overrides_cud on event_overrides for all
  using (can_write_calendar((select calendar_id from events where id = parent_event_id)))
  with check (can_write_calendar((select calendar_id from events where id = parent_event_id)));

-- Attendees (scope via event)
create policy attendees_read on event_attendees for select
  using (is_member_of_calendar((select calendar_id from events where id = event_id)));

create policy attendees_cud on event_attendees for all
  using (can_write_calendar((select calendar_id from events where id = event_id)))
  with check (can_write_calendar((select calendar_id from events where id = event_id)));


-- =========================
-- 9) RPCs (SECURITY DEFINER)
-- =========================
-- WHY: Single API surface for client. Centralizes validation & plays well with RLS.

create schema if not exists api;

-- Create Event
-- WHY: Accepts JSON to keep client simple; generates UID if missing.
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
end$$;

-- Update Event (partial)
-- WHY: Patch-style updates so clients only send changed fields.
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
end$$;

-- Delete Event
-- WHY: Simple hard-delete; rely on ON DELETE CASCADE to clean overrides/attendees.
create or replace function api.delete_event(event_id uuid)
returns void language sql security definer set search_path=public as $$
  delete from events where id = event_id;
$$;

-- Upsert Override
-- WHY: Create-or-update by (parent_event_id, recurrence_id) to match RFC RECURRENCE-ID semantics.
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
end$$;

-- Delete Override
-- WHY: Target by (parent_event_id, recurrence_id) which uniquely identifies the instance.
create or replace function api.delete_override(parent_event_id uuid, recurrence_id timestamptz)
returns void language sql security definer set search_path=public as $$
  delete from event_overrides
  where parent_event_id = $1 and recurrence_id = $2;
$$;

-- Upsert Attendee (series or per-occurrence)
-- WHY: Same shape for both scopes; override_id distinguishes them.
create or replace function api.upsert_attendee(p jsonb)
returns event_attendees
language plpgsql security definer set search_path=public as $$
declare a event_attendees;
begin
  insert into event_attendees (
    event_id, override_id, email, cn, role, partstat, rsvp, cutype,
    member_of, delegated_to, delegated_from, sent_by, params
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
    case when p ? 'member_of' then (select array_agg(value::text) from jsonb_array_elements(p->'member_of')) end,
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
    member_of  = coalesce(excluded.member_of, event_attendees.member_of),
    delegated_to   = coalesce(excluded.delegated_to, event_attendees.delegated_to),
    delegated_from = coalesce(excluded.delegated_from, event_attendees.delegated_from),
    sent_by    = coalesce(excluded.sent_by, event_attendees.sent_by),
    params     = coalesce(excluded.params, event_attendees.params)
  returning * into a;
  return a;
end$$;

-- Delete Attendee
-- WHY: Optional override_id allows deleting series-level OR instance-level row.
create or replace function api.delete_attendee(event_id uuid, attendee_email citext, override_id uuid default null)
returns void language sql security definer set search_path=public as $$
  delete from event_attendees
  where event_id = $1
    and email = $2
    and ( (override_id is null and $3 is null) or (override_id = $3) );
$$;
