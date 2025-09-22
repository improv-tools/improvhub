-- 05_calendar.sql
-- =============================================================================
-- PURPOSE
--   RFC 5545–compliant calendar schema (series + detached instance overrides),
--   plus:
--     • calendars + calendar sharing (calendars, calendar_members)
--     • event staff roles
--         – defaults at the EVENT (series) level
--         – per-INSTANCE overrides keyed by RECURRENCE-ID (timestamptz)
--     • slot-level staff roles (ops only; does NOT gate invites)
--     • attendees keyed by (event_id, override_id?)   -- series-level or instance-level
--     • integrity:
--         – member_of_owner_ids must be groups only
--         – member_of_owner_ids subset of RESOLVED staff for scope
--         – auto-drop of future invites that become ineligible
--
-- NOTES
--   • This preserves an iCalendar-style model:
--       - events carry DTSTART/DTEND/DURATION/TZID and RRULE/RDATE/EXDATE
--       - event_overrides are keyed by (parent_event_id, RECURRENCE-ID)
--   • We *do not* materialize occurrences; expansion belongs in Edge Functions.
-- =============================================================================

-- =========================
-- CALENDARS + SHARING
-- =========================

CREATE TABLE IF NOT EXISTS calendars (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE, -- generic owner (individual/group)
  name             text NOT NULL,
  description      text,
  color            text,
  timezone_default text NOT NULL,   -- e.g. 'Europe/London'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
do $$ begin
  create trigger trg_cal_touch
  before update on calendars
  for each row execute function _touch_updated_at();
exception when duplicate_object then null; end $$;

CREATE TABLE IF NOT EXISTS calendar_members (
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        cal_role NOT NULL,              -- 'owner'/'writer'/'reader'
  PRIMARY KEY (calendar_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cal_members_user ON calendar_members(user_id);

-- =========================
-- RFC 5545 TABLES
-- =========================

-- Master events (VEVENT)
CREATE TABLE IF NOT EXISTS events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id      uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,

  -- iTIP identity and change tracking
  uid              text NOT NULL,                    -- per-calendar UID
  sequence         int  NOT NULL DEFAULT 0,          -- bump on meaningful change
  last_modified    timestamptz NOT NULL DEFAULT now(),

  -- Timing (store UTC; keep original TZ in tzid if needed for RECURRENCE-ID interop)
  dtstart          timestamptz NOT NULL,
  dtend            timestamptz,                      -- XOR with duration_sec
  duration_sec     int,
  tzid             text,                             -- original zone name ('Europe/London', etc.)
  all_day          boolean NOT NULL DEFAULT false,

  -- Recurrence
  rrule            text,                             -- raw RFC string; expansion external
  rdate            timestamptz[],
  exdate           timestamptz[],

  -- Content/metadata
  summary          text,
  description      text,
  location         text,
  geo_lat          double precision,
  geo_lon          double precision,
  url              text,
  status           text CHECK (status IN ('TENTATIVE','CONFIRMED','CANCELLED')),
  transparency     text CHECK (transparency IN ('OPAQUE','TRANSPARENT')),
  organizer_email  citext,
  organizer_name   text,
  categories       text[],
  extended         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Optional auditing
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT events_uid_unique_per_cal UNIQUE (calendar_id, uid),
  CONSTRAINT events_time_choice CHECK ((dtend IS NULL) <> (duration_sec IS NULL)),
  CONSTRAINT events_dt_order CHECK (dtend IS NULL OR dtend > dtstart)
);
CREATE INDEX IF NOT EXISTS idx_events_cal_dt  ON events (calendar_id, dtstart);
CREATE INDEX IF NOT EXISTS idx_events_cal_uid ON events (calendar_id, uid);
CREATE INDEX IF NOT EXISTS idx_events_cats    ON events USING gin (categories);
CREATE INDEX IF NOT EXISTS idx_events_ext     ON events USING gin (extended);

do $$ begin
  create trigger trg_events_touch
  before update on events
  for each row execute function _touch_updated_at();
exception when duplicate_object then null; end $$;

-- Detached per-instance overrides (RECURRENCE-ID)
CREATE TABLE IF NOT EXISTS event_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recurrence_id    timestamptz NOT NULL,             -- original instance start (UTC)

  -- Overridable fields (NULL means "inherit from parent")
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
  status           text CHECK (status IN ('TENTATIVE','CONFIRMED','CANCELLED')),
  transparency     text CHECK (transparency IN ('OPAQUE','TRANSPARENT')),
  categories       text[],
  extended         jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT overrides_time_choice CHECK (dtend IS NULL OR duration_sec IS NULL),
  CONSTRAINT overrides_dt_order CHECK (dtend IS NULL OR (dtstart IS NOT NULL AND dtend > dtstart)),
  CONSTRAINT overrides_unique_instance UNIQUE (parent_event_id, recurrence_id)
);
CREATE INDEX IF NOT EXISTS idx_overrides_parent_rid ON event_overrides (parent_event_id, recurrence_id);

do $$ begin
  create trigger trg_overrides_touch
  before update on event_overrides
  for each row execute function _touch_updated_at();
exception when duplicate_object then null; end $$;

-- =========================
-- EVENT STAFF (credits)
-- =========================

-- Series defaults (apply to every instance unless overridden)
CREATE TABLE IF NOT EXISTS event_staff_default (
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,  -- individual or group
  role         role_kind NOT NULL,                                     -- performer/producer/...
  billing_name text,
  billing_ord  int,
  notes        text,
  PRIMARY KEY (event_id, owner_id, role)
);
CREATE INDEX IF NOT EXISTS esd_event_idx ON event_staff_default(event_id, role, billing_ord);
CREATE INDEX IF NOT EXISTS esd_owner_idx ON event_staff_default(owner_id, role);

-- Instance overrides keyed by (event_id, recurrence_id)
CREATE TABLE IF NOT EXISTS event_staff_instance (
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recurrence_id timestamptz NOT NULL,                              -- RFC 5545 RECURRENCE-ID
  owner_id      uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  role          role_kind NOT NULL,
  billing_name  text,
  billing_ord   int,
  notes         text,
  PRIMARY KEY (event_id, recurrence_id, owner_id, role)
);
CREATE INDEX IF NOT EXISTS esi_event_idx ON event_staff_instance(event_id, recurrence_id, role, billing_ord);
CREATE INDEX IF NOT EXISTS esi_owner_idx ON event_staff_instance(owner_id, role);

-- (moved below to ensure event_attendees exists before referencing it)

-- =========================
-- SLOT-LEVEL STAFF (ops only)
-- =========================
-- OPTIONAL SLOTS TABLE (lightweight placeholder)
-- Some features reference a generic "slots" resource. Provide a minimal table so
-- foreign keys from event_attendees.slot_id and slot_staff.slot_id can resolve.
CREATE TABLE IF NOT EXISTS slots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES owners(id) ON DELETE CASCADE,
  name       text,
  info       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
do $$ begin
  create trigger trg_slots_touch
  before update on slots
  for each row execute function _touch_updated_at();
exception when duplicate_object then null; end $$;

-- Uses role_kind (e.g., 'crew','host') but does NOT gate invites.
CREATE TABLE IF NOT EXISTS slot_staff (
  slot_id uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  role    role_kind NOT NULL DEFAULT 'crew',
  notes   text,
  PRIMARY KEY (slot_id, owner_id, role)
);
CREATE INDEX IF NOT EXISTS idx_slot_staff_slot_role  ON slot_staff(slot_id, role);
CREATE INDEX IF NOT EXISTS idx_slot_staff_owner_role ON slot_staff(owner_id, role);

-- Helper view: owners present on a slot (role-agnostic)
CREATE OR REPLACE VIEW v_slot_owners AS
SELECT DISTINCT slot_id, owner_id
FROM slot_staff;

-- =========================
-- ATTENDEES
-- =========================

-- Attendees may be series-level (override_id NULL) or instance-level (override_id set).
-- Direct individual invites: leave member_of_owner_ids NULL/empty.
-- Group-based invites: member_of_owner_ids must list credited GROUP owners for that scope.
CREATE TABLE IF NOT EXISTS event_attendees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  override_id        uuid REFERENCES event_overrides(id) ON DELETE CASCADE,  -- NULL => series-level
  slot_id            uuid REFERENCES slots(id),                               -- alternative slot scope

  -- Canonical identity for attendee (internal owner or external email)
  owner_id           uuid REFERENCES owners(id),
  email              citext,

  -- RFC 5545 attendee params/state
  cn                 text,
  role               attendee_role,
  partstat           attendee_partstat,
  rsvp               boolean,
  cutype             text CHECK (cutype IN ('INDIVIDUAL','GROUP','RESOURCE','ROOM','UNKNOWN')),

  -- Group context (structured + legacy)
  member_of_emails   text[],   -- legacy email-based list (DLs/externals)
  member_of_owner_ids uuid[],  -- structured owner-based groups (internal)

  delegated_to       citext[],
  delegated_from     citext[],
  sent_by            citext,

  params             jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Either slot-scoped OR (event/override)-scoped
  CONSTRAINT attendees_scope_ck CHECK (
    (slot_id IS NOT NULL AND override_id IS NULL)
    OR
    (slot_id IS NULL)
  ),

  -- Require at least one identity
  CONSTRAINT attendees_identity_ck CHECK (owner_id IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_attendees_event    ON event_attendees (event_id);
CREATE INDEX IF NOT EXISTS idx_attendees_override ON event_attendees (override_id);
CREATE INDEX IF NOT EXISTS idx_attendees_owner    ON event_attendees (owner_id);
CREATE INDEX IF NOT EXISTS idx_attendees_email    ON event_attendees (email);

-- Unique per (scope, identity). Treat NULL override_id as equal across rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendees_scope_owner ON event_attendees (
  COALESCE(slot_id,     '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(override_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(owner_id,    '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE owner_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendees_scope_email ON event_attendees (
  COALESCE(slot_id,     '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(override_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(email)
) WHERE owner_id IS NULL AND email IS NOT NULL;

-- Resolved staff for scope (event series vs specific instance)
-- For instances we combine overrides with defaults-minus-overridden.
-- For series (no recurrence_id), resolved = defaults only.
CREATE OR REPLACE VIEW v_event_staff_resolved AS
WITH all_instances AS (
  SELECT DISTINCT event_id, recurrence_id FROM event_staff_instance
  UNION
  SELECT eo.parent_event_id AS event_id, eo.recurrence_id FROM event_overrides eo
  UNION
  SELECT ea.event_id, eo.recurrence_id
  FROM event_attendees ea
  JOIN event_overrides eo ON eo.id = ea.override_id
),
ovr AS (
  SELECT event_id, recurrence_id, owner_id, role, billing_name, billing_ord, notes
  FROM event_staff_instance
),
dft_fanned AS (
  SELECT ai.event_id, ai.recurrence_id, d.owner_id, d.role, d.billing_name, d.billing_ord, d.notes
  FROM all_instances ai
  JOIN event_staff_default d ON d.event_id = ai.event_id
),
dft_filtered AS (
  SELECT d.*
  FROM dft_fanned d
  WHERE NOT EXISTS (
    SELECT 1 FROM ovr
    WHERE ovr.event_id = d.event_id
      AND ovr.recurrence_id = d.recurrence_id
      AND ovr.owner_id = d.owner_id
      AND ovr.role     = d.role
  )
)
SELECT * FROM ovr
UNION ALL
SELECT * FROM dft_filtered;

-- =========================
-- INTEGRITY CONSTRAINTS
-- =========================

-- (A) member_of_owner_ids must reference GROUP owners only (never individuals).
CREATE OR REPLACE FUNCTION _chk_member_of_are_groups()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad uuid[];
BEGIN
  IF NEW.member_of_owner_ids IS NULL OR array_length(NEW.member_of_owner_ids,1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(o.id), '{}'::uuid[])
    INTO bad
  FROM unnest(NEW.member_of_owner_ids) z(id)
  JOIN owners o ON o.id = z.id
  WHERE o.kind <> 'group';

  IF array_length(bad,1) IS NOT NULL THEN
    RAISE EXCEPTION 'member_of_owner_ids must reference group owners only: %', bad
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END $$;

do $$ begin
  drop trigger if exists trg_chk_member_of_are_groups on event_attendees;
exception when undefined_object then null; end $$;
CREATE CONSTRAINT TRIGGER trg_chk_member_of_are_groups
AFTER INSERT OR UPDATE ON event_attendees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION _chk_member_of_are_groups();

-- (B1) For instance-scoped rows (override_id NOT NULL): member_of ⊆ resolved staff for that instance.
CREATE OR REPLACE FUNCTION _chk_member_of_instance_staff()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid timestamptz; ev uuid; missing uuid[];
BEGIN
  IF NEW.override_id IS NULL OR NEW.member_of_owner_ids IS NULL OR array_length(NEW.member_of_owner_ids,1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT eo.recurrence_id, eo.parent_event_id INTO rid, ev
  FROM event_overrides eo WHERE eo.id = NEW.override_id;

  SELECT COALESCE(array_agg(z.owner_id), '{}'::uuid[])
    INTO missing
  FROM unnest(NEW.member_of_owner_ids) AS z(owner_id)
  LEFT JOIN (
    SELECT DISTINCT owner_id
    FROM v_event_staff_resolved
    WHERE event_id = ev AND recurrence_id = rid
  ) allowed ON allowed.owner_id = z.owner_id
  WHERE allowed.owner_id IS NULL;

  IF array_length(missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'member_of contains owners not on resolved staff for this instance: %', missing
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END $$;

-- (B2) For series-scoped rows (override_id NULL & slot_id NULL): member_of ⊆ series defaults.
CREATE OR REPLACE FUNCTION _chk_member_of_series_staff()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE missing uuid[];
BEGIN
  IF NEW.override_id IS NOT NULL OR NEW.slot_id IS NOT NULL
     OR NEW.member_of_owner_ids IS NULL OR array_length(NEW.member_of_owner_ids,1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(z.owner_id), '{}'::uuid[])
    INTO missing
  FROM unnest(NEW.member_of_owner_ids) AS z(owner_id)
  LEFT JOIN (
    SELECT DISTINCT owner_id FROM event_staff_default WHERE event_id = NEW.event_id
  ) allowed ON allowed.owner_id = z.owner_id
  WHERE allowed.owner_id IS NULL;

  IF array_length(missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'member_of contains owners not on series staff: %', missing
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END $$;

-- (B3) For slot-scoped rows: member_of ⊆ owners present on the slot.
CREATE OR REPLACE FUNCTION _chk_member_of_slot_staff()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE missing uuid[];
BEGIN
  IF NEW.slot_id IS NULL OR NEW.member_of_owner_ids IS NULL OR array_length(NEW.member_of_owner_ids,1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(z.owner_id), '{}'::uuid[])
    INTO missing
  FROM unnest(NEW.member_of_owner_ids) AS z(owner_id)
  LEFT JOIN v_slot_owners so ON so.slot_id = NEW.slot_id AND so.owner_id = z.owner_id
  WHERE so.owner_id IS NULL;

  IF array_length(missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'member_of contains owners not present on this slot: %', missing
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END $$;

-- Attach the three scope-aware checks
do $$ begin
  drop trigger if exists trg_chk_member_of_instance_staff on event_attendees;
exception when undefined_object then null; end $$;
CREATE CONSTRAINT TRIGGER trg_chk_member_of_instance_staff
AFTER INSERT OR UPDATE ON event_attendees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION _chk_member_of_instance_staff();

do $$ begin
  drop trigger if exists trg_chk_member_of_series_staff on event_attendees;
exception when undefined_object then null; end $$;
CREATE CONSTRAINT TRIGGER trg_chk_member_of_series_staff
AFTER INSERT OR UPDATE ON event_attendees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION _chk_member_of_series_staff();

do $$ begin
  drop trigger if exists trg_chk_member_of_slot_staff on event_attendees;
exception when undefined_object then null; end $$;
CREATE CONSTRAINT TRIGGER trg_chk_member_of_slot_staff
AFTER INSERT OR UPDATE ON event_attendees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION _chk_member_of_slot_staff();

-- =========================
-- SEQUENCE/EDITOR TRIGGERS
-- =========================

-- Bump SEQUENCE/last_modified for material changes on events
CREATE OR REPLACE FUNCTION _bump_event_sequence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.dtstart, NEW.dtend, NEW.duration_sec, NEW.rrule, NEW.rdate, NEW.exdate,
         NEW.summary, NEW.description, NEW.location, NEW.status, NEW.transparency,
         NEW.categories, NEW.extended)
     IS DISTINCT FROM
     ROW(OLD.dtstart, OLD.dtend, OLD.duration_sec, OLD.rrule, OLD.rdate, OLD.exdate,
         OLD.summary, OLD.description, OLD.location, OLD.status, OLD.transparency,
         OLD.categories, OLD.extended)
  THEN
    NEW.sequence := COALESCE(OLD.sequence,0) + 1;
    NEW.last_modified := now();
  END IF;
  RETURN NEW;
END $$;
do $$ begin
  drop trigger if exists trg_events_bump_seq on events;
exception when undefined_object then null; end $$;
CREATE TRIGGER trg_events_bump_seq
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION _bump_event_sequence();

-- Changing overrides bumps the parent SEQUENCE and timestamps
CREATE OR REPLACE FUNCTION _bump_parent_sequence_from_override() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE events
     SET sequence = sequence + 1,
         last_modified = now(),
         updated_at = now()
   WHERE id = COALESCE(NEW.parent_event_id, OLD.parent_event_id);
  RETURN COALESCE(NEW,OLD);
END $$;
do $$ begin
  drop trigger if exists trg_overrides_bump_parent on event_overrides;
exception when undefined_object then null; end $$;
CREATE TRIGGER trg_overrides_bump_parent
AFTER INSERT OR UPDATE OR DELETE ON event_overrides
FOR EACH ROW EXECUTE FUNCTION _bump_parent_sequence_from_override();

-- Optional: auto-add organizer as CHAIR attendee at series level
CREATE OR REPLACE FUNCTION _auto_add_organizer_attendee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organizer_email IS NOT NULL THEN
    INSERT INTO event_attendees (event_id, email, cn, role, partstat, rsvp)
    VALUES (NEW.id, NEW.organizer_email, NEW.organizer_name, 'CHAIR', 'NEEDS-ACTION', false)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
do $$ begin
  drop trigger if exists trg_events_add_org_att on events;
exception when undefined_object then null; end $$;
CREATE TRIGGER trg_events_add_org_att
AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION _auto_add_organizer_attendee();

-- =========================
-- UI VIEWS
-- =========================

CREATE OR REPLACE VIEW v_events AS
SELECT
  e.*,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'email', a.email, 'cn', a.cn, 'role', a.role, 'partstat', a.partstat,
      'rsvp', a.rsvp, 'params', a.params
    ) ORDER BY a.email)
    FROM event_attendees a
    WHERE a.event_id = e.id AND a.override_id IS NULL
  ) AS attendees_series
FROM events e;

CREATE OR REPLACE VIEW v_event_overrides AS
SELECT
  o.*,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'email', a.email, 'cn', a.cn, 'role', a.role, 'partstat', a.partstat,
      'rsvp', a.rsvp, 'params', a.params
    ) ORDER BY a.email)
    FROM event_attendees a
    WHERE a.override_id = o.id
  ) AS attendees_override
FROM event_overrides o;

CREATE OR REPLACE VIEW v_events_with_overrides AS
SELECT e.id AS event_id, NULL::uuid AS override_id, e.calendar_id, e.uid, e.sequence,
       e.dtstart, e.dtend, e.duration_sec, e.tzid, e.all_day,
       e.rrule, e.rdate, e.exdate,
       e.summary, e.description, e.location, e.geo_lat, e.geo_lon, e.url,
       e.status, e.transparency, e.categories, e.extended,
       e.created_at, e.updated_at, e.last_modified
FROM events e
UNION ALL
SELECT o.parent_event_id, o.id, e.calendar_id, e.uid, e.sequence,
       COALESCE(o.dtstart, e.dtstart),
       COALESCE(o.dtend,   e.dtend),
       COALESCE(o.duration_sec, e.duration_sec),
       COALESCE(o.tzid, e.tzid),
       COALESCE(o.all_day, e.all_day),
       e.rrule, e.rdate, e.exdate,
       COALESCE(o.summary, e.summary),
       COALESCE(o.description, e.description),
       COALESCE(o.location, e.location),
       COALESCE(o.geo_lat, e.geo_lat),
       COALESCE(o.geo_lon, e.geo_lon),
       COALESCE(o.url, e.url),
       COALESCE(o.status, e.status),
       COALESCE(o.transparency, e.transparency),
       COALESCE(o.categories, e.categories),
       COALESCE(o.extended, e.extended),
       o.created_at, o.updated_at, e.last_modified
FROM event_overrides o
JOIN events e ON e.id = o.parent_event_id;

-- =========================
-- RLS HELPERS & POLICIES (optional)
-- =========================
-- Enable/disable as needed for your project. These are conservative defaults.

ALTER TABLE calendars       ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;

-- Owner-level = admins/managers of the calendar's owning entity
CREATE OR REPLACE FUNCTION is_owner_level(cal_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1
    FROM calendars c
    JOIN owner_users ou ON ou.owner_id = c.owner_id
    WHERE c.id = cal_id
      AND ou.user_id = auth.uid()
      AND ou.role IN ('admin')
  );
$$;

-- Writers = owner admins/managers OR explicit calendar writers/owners
CREATE OR REPLACE FUNCTION can_write_calendar(cal_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1
    FROM calendars c
    JOIN owner_users ou ON ou.owner_id = c.owner_id
    WHERE c.id = cal_id AND ou.user_id = auth.uid() AND ou.role IN ('admin','manager')
    UNION
    SELECT 1
    FROM calendar_members m
    WHERE m.calendar_id = cal_id AND m.user_id = auth.uid() AND m.role IN ('owner','writer')
  );
$$;

-- Readers = any owner operator or explicit calendar member
CREATE OR REPLACE FUNCTION can_read_calendar(cal_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    -- Explicit calendar membership (any role)
    SELECT 1 FROM calendar_members m WHERE m.calendar_id = cal_id AND m.user_id = auth.uid()
    UNION
    -- Owner operators (admins/managers) via owner_users
    SELECT 1 FROM calendars c JOIN owner_users ou ON ou.owner_id = c.owner_id
      WHERE c.id = cal_id AND ou.user_id = auth.uid()
    UNION
    -- Any active member of the GROUP that owns the calendar may read
    SELECT 1
    FROM calendars c
    JOIN owners o ON o.id = c.owner_id AND o.kind = 'group'
    JOIN group_membership gm ON gm.group_id = o.group_id AND gm.user_id = auth.uid() AND gm.ended_on IS NULL
    WHERE c.id = cal_id
  );
$$;

do $$ begin
  drop policy if exists cal_read  on calendars;
  drop policy if exists cal_write on calendars;
  drop policy if exists mem_read  on calendar_members;
  drop policy if exists mem_write on calendar_members;
  drop policy if exists ev_read   on events;
  drop policy if exists ev_ins    on events;
  drop policy if exists ev_upd    on events;
  drop policy if exists ev_del    on events;
  drop policy if exists ov_read   on event_overrides;
  drop policy if exists ov_cud    on event_overrides;
  drop policy if exists att_read  on event_attendees;
  drop policy if exists att_cud   on event_attendees;
exception when undefined_object then null; end $$;

-- Inline policies on calendars to avoid recursive self-references that can
-- trigger stack depth errors when RLS evaluates functions that read calendars.
CREATE POLICY cal_read  ON calendars FOR SELECT USING (
  -- Any explicit member can read
  EXISTS (SELECT 1 FROM calendar_members m WHERE m.calendar_id = id AND m.user_id = auth.uid())
  OR
  -- Owner operators (admins/managers) can read
  EXISTS (SELECT 1 FROM owner_users ou WHERE ou.owner_id = owner_id AND ou.user_id = auth.uid())
  OR
  -- Any active member of the GROUP that owns the calendar can read
  EXISTS (
    SELECT 1 FROM owners o
    JOIN group_membership gm ON gm.group_id = o.group_id AND gm.user_id = auth.uid() AND gm.ended_on IS NULL
    WHERE o.id = owner_id AND o.kind = 'group'
  )
);

CREATE POLICY cal_write ON calendars FOR ALL USING (
  -- Writer via explicit calendar membership
  EXISTS (SELECT 1 FROM calendar_members m WHERE m.calendar_id = id AND m.user_id = auth.uid() AND m.role IN ('owner','writer'))
  OR
  -- Owner admins/managers
  EXISTS (SELECT 1 FROM owner_users ou WHERE ou.owner_id = owner_id AND ou.user_id = auth.uid() AND ou.role IN ('admin','manager'))
) WITH CHECK (
  -- Same as USING for writes
  EXISTS (SELECT 1 FROM calendar_members m WHERE m.calendar_id = id AND m.user_id = auth.uid() AND m.role IN ('owner','writer'))
  OR
  EXISTS (SELECT 1 FROM owner_users ou WHERE ou.owner_id = owner_id AND ou.user_id = auth.uid() AND ou.role IN ('admin','manager'))
);
CREATE POLICY mem_read  ON calendar_members  FOR SELECT USING (can_read_calendar(calendar_id));
CREATE POLICY mem_write ON calendar_members  FOR ALL    USING (can_write_calendar(calendar_id)) WITH CHECK (can_write_calendar(calendar_id));
CREATE POLICY ev_read   ON events            FOR SELECT USING (can_read_calendar(calendar_id));
CREATE POLICY ev_ins    ON events            FOR INSERT WITH CHECK (can_write_calendar(calendar_id));
CREATE POLICY ev_upd    ON events            FOR UPDATE USING (can_write_calendar(calendar_id)) WITH CHECK (can_write_calendar(calendar_id));
CREATE POLICY ev_del    ON events            FOR DELETE USING (can_write_calendar(calendar_id));

CREATE POLICY ov_read   ON event_overrides   FOR SELECT USING (can_read_calendar((SELECT calendar_id FROM events WHERE id = parent_event_id)));
CREATE POLICY ov_cud    ON event_overrides   FOR ALL    USING (can_write_calendar((SELECT calendar_id FROM events WHERE id = parent_event_id)))
                                                    WITH CHECK (can_write_calendar((SELECT calendar_id FROM events WHERE id = parent_event_id)));

CREATE POLICY att_read  ON event_attendees   FOR SELECT USING (can_read_calendar((SELECT calendar_id FROM events WHERE id = event_id)));
CREATE POLICY att_cud   ON event_attendees   FOR ALL    USING (can_write_calendar((SELECT calendar_id FROM events WHERE id = event_id)))
                                                    WITH CHECK (can_write_calendar((SELECT calendar_id FROM events WHERE id = event_id)));

-- =========================
-- RPCs: group calendars and events
-- =========================

-- List calendars for a group owner
drop function if exists list_group_calendars(p_group_id uuid);
create or replace function list_group_calendars(p_group_id uuid)
returns setof calendars
language sql stable security definer set search_path = public as $$
  select c.*
  from calendars c
  where c.owner_id = get_owner_for_group(p_group_id)
    and can_read_calendar(c.id)
  order by c.created_at asc
$$;
grant execute on function list_group_calendars(uuid) to authenticated;

-- Ensure a primary calendar exists for a group and return it
drop function if exists ensure_primary_group_calendar(p_group_id uuid);
create or replace function ensure_primary_group_calendar(p_group_id uuid)
returns calendars
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_row calendars%rowtype;
begin
  v_owner := ensure_owner_for_group(p_group_id);
  select * into v_row from calendars where owner_id = v_owner order by created_at asc limit 1;
  if not found then
    insert into calendars(owner_id, name, timezone_default)
    values (v_owner, 'Main', 'Europe/London')
    returning * into v_row;
  end if;
  return v_row;
end $$;
grant execute on function ensure_primary_group_calendar(uuid) to authenticated;

-- Create event for a group (on primary calendar)
drop function if exists create_group_event(p_group_id uuid, p_event jsonb);
create or replace function create_group_event(p_group_id uuid, p_event jsonb)
returns events
language plpgsql security definer set search_path = public as $$
declare v_cal calendars; v_row events%rowtype; v_uid text;
begin
  v_cal := ensure_primary_group_calendar(p_group_id);
  if not can_write_calendar(v_cal.id) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_uid := coalesce(p_event->>'uid', gen_random_uuid()::text);
  -- Enforce recurrence policy (12 max and 12-month window). We only validate RRULE caps here.
  perform validate_recurrence_policy(
    (p_event->>'dtstart')::timestamptz,
    p_event->>'rrule',
    null
  );
  insert into events(calendar_id, uid, dtstart, dtend, duration_sec, tzid, all_day, rrule, rdate, exdate,
                     summary, description, location, status, transparency, categories, extended,
                     created_by, updated_by)
  values (
    v_cal.id, v_uid,
    (p_event->>'dtstart')::timestamptz,
    (p_event->>'dtend')::timestamptz,
    (p_event->>'duration_sec')::int,
    p_event->>'tzid',
    coalesce((p_event->>'all_day')::boolean, false),
    p_event->>'rrule',
    null,
    null,
    p_event->>'summary',
    p_event->>'description',
    p_event->>'location',
    coalesce(p_event->>'status','CONFIRMED'),
    coalesce(p_event->>'transparency','OPAQUE'),
    null,
    coalesce(p_event->'extended','{}'::jsonb),
    auth.uid(), auth.uid()
  ) returning * into v_row;
  -- Optional: initial series staff defaults
  if p_event ? 'staff_defaults' then
    perform set_event_staff_defaults(v_row.id, p_event->'staff_defaults');
  end if;
  return v_row;
end $$;
grant execute on function create_group_event(uuid, jsonb) to authenticated;

-- Update event (patch limited fields)
drop function if exists update_event(p_event_id uuid, p_patch jsonb);
create or replace function update_event(p_event_id uuid, p_patch jsonb)
returns events
language plpgsql security definer set search_path = public as $$
declare v_cal uuid; v_row events%rowtype; v jsonb := coalesce(p_patch,'{}'::jsonb);
declare v_dtstart timestamptz; v_rrule text; v_rdate timestamptz[];
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;
  -- Compute would-be values for validation
  select dtstart, rrule, rdate into v_dtstart, v_rrule, v_rdate from events where id = p_event_id;
  v_dtstart := coalesce((v->>'dtstart')::timestamptz, v_dtstart);
  v_rrule   := coalesce(v->>'rrule', v_rrule);
  -- Enforce recurrence policy on new values
  perform validate_recurrence_policy(v_dtstart, v_rrule, v_rdate);
  update events set
    dtstart = coalesce((v->>'dtstart')::timestamptz, dtstart),
    dtend   = coalesce((v->>'dtend')::timestamptz, dtend),
    duration_sec = coalesce((v->>'duration_sec')::int, duration_sec),
    tzid    = coalesce(v->>'tzid', tzid),
    all_day = coalesce((v->>'all_day')::boolean, all_day),
    rrule   = coalesce(v->>'rrule', rrule),
    summary = coalesce(v->>'summary', summary),
    description = coalesce(v->>'description', description),
    location = coalesce(v->>'location', location),
    status  = coalesce(v->>'status', status),
    transparency = coalesce(v->>'transparency', transparency),
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_event_id
  returning * into v_row;
  -- Optional: replace series staff defaults when provided
  if v ? 'staff_defaults' then
    perform set_event_staff_defaults(p_event_id, v->'staff_defaults');
  end if;
  return v_row;
end $$;
grant execute on function update_event(uuid, jsonb) to authenticated;

-- Delete event
drop function if exists delete_event(p_event_id uuid);
create or replace function delete_event(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cal uuid;
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then return; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from events where id = p_event_id;
end $$;
grant execute on function delete_event(uuid) to authenticated;

-- Upsert an override for an instance
drop function if exists upsert_event_override(p_event_id uuid, p_recurrence_id timestamptz, p_patch jsonb);
create or replace function upsert_event_override(p_event_id uuid, p_recurrence_id timestamptz, p_patch jsonb)
returns event_overrides
language plpgsql security definer set search_path = public as $$
declare v_cal uuid; v_row event_overrides%rowtype; v jsonb := coalesce(p_patch,'{}'::jsonb);
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into event_overrides(parent_event_id, recurrence_id,
    dtstart, dtend, duration_sec, tzid, all_day,
    summary, description, location, status, transparency, categories, extended)
  values (
    p_event_id, p_recurrence_id,
    (v->>'dtstart')::timestamptz,
    (v->>'dtend')::timestamptz,
    (v->>'duration_sec')::int,
    v->>'tzid',
    (v->>'all_day')::boolean,
    v->>'summary', v->>'description', v->>'location', v->>'status', v->>'transparency', null, coalesce(v->'extended','{}'::jsonb)
  )
  on conflict (parent_event_id, recurrence_id) do update set
    dtstart = coalesce(excluded.dtstart, event_overrides.dtstart),
    dtend   = coalesce(excluded.dtend, event_overrides.dtend),
    duration_sec = coalesce(excluded.duration_sec, event_overrides.duration_sec),
    tzid    = coalesce(excluded.tzid, event_overrides.tzid),
    all_day = coalesce(excluded.all_day, event_overrides.all_day),
    summary = coalesce(excluded.summary, event_overrides.summary),
    description = coalesce(excluded.description, event_overrides.description),
    location = coalesce(excluded.location, event_overrides.location),
    status  = coalesce(excluded.status, event_overrides.status),
    transparency = coalesce(excluded.transparency, event_overrides.transparency),
    extended = coalesce(excluded.extended, event_overrides.extended)
  returning * into v_row;
  -- Optional: replace instance-level staff for this recurrence
  if v ? 'instance_staff' then
    perform set_event_staff_instance(p_event_id, p_recurrence_id, v->'instance_staff');
  end if;
  return v_row;
end $$;
grant execute on function upsert_event_override(uuid, timestamptz, jsonb) to authenticated;

-- Replace series-level staff defaults for an event
drop function if exists set_event_staff_defaults(p_event_id uuid, p_staff jsonb);
create or replace function set_event_staff_defaults(p_event_id uuid, p_staff jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cal uuid;
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;

  delete from event_staff_default where event_id = p_event_id;
  insert into event_staff_default(event_id, owner_id, role, billing_name, billing_ord, notes)
  select p_event_id,
         x.owner_id,
         x.role::role_kind,
         nullif(x.billing_name, ''),
         nullif(x.billing_ord, 0),
         nullif(x.notes, '')
  from jsonb_to_recordset(coalesce(p_staff, '[]'::jsonb)) as x(owner_id uuid, role text, billing_name text, billing_ord int, notes text);
end $$;
grant execute on function set_event_staff_defaults(uuid, jsonb) to authenticated;

-- Replace instance-level staff for a specific recurrence
drop function if exists set_event_staff_instance(p_event_id uuid, p_recurrence_id timestamptz, p_staff jsonb);
create or replace function set_event_staff_instance(p_event_id uuid, p_recurrence_id timestamptz, p_staff jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cal uuid;
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;

  delete from event_staff_instance where event_id = p_event_id and recurrence_id = p_recurrence_id;
  insert into event_staff_instance(event_id, recurrence_id, owner_id, role, billing_name, billing_ord, notes)
  select p_event_id,
         p_recurrence_id,
         x.owner_id,
         x.role::role_kind,
         nullif(x.billing_name, ''),
         nullif(x.billing_ord, 0),
         nullif(x.notes, '')
  from jsonb_to_recordset(coalesce(p_staff, '[]'::jsonb)) as x(owner_id uuid, role text, billing_name text, billing_ord int, notes text);
end $$;
grant execute on function set_event_staff_instance(uuid, timestamptz, jsonb) to authenticated;

-- Delete override
drop function if exists delete_event_override(p_event_id uuid, p_recurrence_id timestamptz);
create or replace function delete_event_override(p_event_id uuid, p_recurrence_id timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cal uuid;
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then return; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from event_overrides where parent_event_id = p_event_id and recurrence_id = p_recurrence_id;
end $$;
grant execute on function delete_event_override(uuid, timestamptz) to authenticated;

-- Move an override to a different RECURRENCE-ID (re-attach)
drop function if exists move_event_override(p_event_id uuid, p_from_rid timestamptz, p_to_rid timestamptz);
create or replace function move_event_override(p_event_id uuid, p_from_rid timestamptz, p_to_rid timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cal uuid; v_exists int;
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;

  -- Disallow move if target already has an override
  select count(*) into v_exists from event_overrides where parent_event_id = p_event_id and recurrence_id = p_to_rid;
  if v_exists > 0 then raise exception 'target recurrence already has an override' using errcode = 'P0001'; end if;

  update event_overrides
    set recurrence_id = p_to_rid
  where parent_event_id = p_event_id and recurrence_id = p_from_rid;
end $$;
grant execute on function move_event_override(uuid, timestamptz, timestamptz) to authenticated;

-- Prune all orphaned instance data for a series (no time window)
-- Call this after updating a series with the authoritative list of valid recurrence_ids.
-- Deletes:
--   - event_overrides not matching provided recurrence_ids (cascades to instance attendees)
--   - event_staff_instance rows not matching provided recurrence_ids
drop function if exists prune_orphaned_event_data(p_event_id uuid, p_valid_rids timestamptz[]);
create or replace function prune_orphaned_event_data(p_event_id uuid, p_valid_rids timestamptz[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_cal uuid;
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then return; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;

  -- Delete overrides whose recurrence_id is NOT in the provided set
  delete from event_overrides eo
   where eo.parent_event_id = p_event_id
     and not (eo.recurrence_id = any(p_valid_rids));

  -- Delete instance-level staff not in the provided set
  delete from event_staff_instance esi
   where esi.event_id = p_event_id
     and not (esi.recurrence_id = any(p_valid_rids));
end $$;
grant execute on function prune_orphaned_event_data(uuid, timestamptz[]) to authenticated;

-- Preview orphaned instances after a series change (no time window)
-- Returns recurrence_ids present in overrides or instance staff that are NOT in p_valid_rids
drop function if exists list_orphaned_event_instances(p_event_id uuid, p_valid_rids timestamptz[]);
create or replace function list_orphaned_event_instances(p_event_id uuid, p_valid_rids timestamptz[])
returns table(recurrence_id timestamptz, has_override boolean, has_instance_staff boolean)
language sql stable security definer set search_path = public as $$
  with
  o as (
    select distinct recurrence_id from event_overrides where parent_event_id = p_event_id
  ),
  s as (
    select distinct recurrence_id from event_staff_instance where event_id = p_event_id
  ),
  u as (
    select recurrence_id from o
    union
    select recurrence_id from s
  )
  select
    u.recurrence_id,
    exists (select 1 from o where o.recurrence_id = u.recurrence_id) as has_override,
    exists (select 1 from s where s.recurrence_id = u.recurrence_id) as has_instance_staff
  from u
  where not (u.recurrence_id = any(coalesce(p_valid_rids, '{}'::timestamptz[])))
  order by u.recurrence_id asc
$$;
grant execute on function list_orphaned_event_instances(uuid, timestamptz[]) to authenticated;

-- Update a series and prune orphans atomically
drop function if exists update_event_and_prune(p_event_id uuid, p_patch jsonb, p_valid_rids timestamptz[]);
create or replace function update_event_and_prune(p_event_id uuid, p_patch jsonb, p_valid_rids timestamptz[])
returns events
language plpgsql security definer set search_path = public as $$
declare v_row events%rowtype; v_cal uuid; v jsonb := coalesce(p_patch,'{}'::jsonb);
        v_dtstart timestamptz; v_rrule text; v_rdate timestamptz[];
begin
  select calendar_id into v_cal from events where id = p_event_id;
  if v_cal is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not can_write_calendar(v_cal) then raise exception 'not allowed' using errcode = '42501'; end if;

  -- Validate recurrence policy against would-be values
  select dtstart, rrule, rdate into v_dtstart, v_rrule, v_rdate from events where id = p_event_id;
  v_dtstart := coalesce((v->>'dtstart')::timestamptz, v_dtstart);
  v_rrule   := coalesce(v->>'rrule', v_rrule);
  perform validate_recurrence_policy(v_dtstart, v_rrule, v_rdate);

  -- Apply update
  update events set
    dtstart = coalesce((v->>'dtstart')::timestamptz, dtstart),
    dtend   = coalesce((v->>'dtend')::timestamptz, dtend),
    duration_sec = coalesce((v->>'duration_sec')::int, duration_sec),
    tzid    = coalesce(v->>'tzid', tzid),
    all_day = coalesce((v->>'all_day')::boolean, all_day),
    rrule   = coalesce(v->>'rrule', rrule),
    summary = coalesce(v->>'summary', summary),
    description = coalesce(v->>'description', description),
    location = coalesce(v->>'location', location),
    status  = coalesce(v->>'status', status),
    transparency = coalesce(v->>'transparency', transparency),
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_event_id
  returning * into v_row;

  -- Prune orphans when a valid set is provided (treat NULL as empty set => prune all instance data)
  perform prune_orphaned_event_data(p_event_id, coalesce(p_valid_rids, '{}'::timestamptz[]));

  return v_row;
end $$;
grant execute on function update_event_and_prune(uuid, jsonb, timestamptz[]) to authenticated;

-- List staff candidates for a group: the group owner and active member owners
drop function if exists list_group_staff_candidates(p_group_id uuid);
create or replace function list_group_staff_candidates(p_group_id uuid)
returns table(owner_id uuid, kind text, display_name text, user_id uuid)
language sql stable security definer set search_path = public, auth as $$
  with me as (
    select 1 from group_membership gm where gm.group_id = p_group_id and gm.user_id = auth.uid() and gm.ended_on is null
  ), grp as (
    -- read-only getter for group owner (owner row should already exist from creation trigger)
    select get_owner_for_group(p_group_id) as owner_id
  ), members as (
    -- read-only getter; owner row may be null for some users
    select gm.user_id, get_owner_for_user(gm.user_id) as owner_id
    from group_membership gm
    where gm.group_id = p_group_id and gm.ended_on is null
  )
  -- Group owner row with fallback to group name
  select o.id as owner_id, o.kind::text as kind,
         coalesce(o.display_name, (select g.name from "group" g where g.group_id = p_group_id)) as display_name,
         null::uuid as user_id
  from owners o join grp on grp.owner_id = o.id
  where exists (select 1 from me)
  union all
  -- Member owners with fallback to auth.users display/email; include users lacking owner row
  select m.owner_id,
         coalesce(o.kind::text, 'individual') as kind,
         coalesce(o.display_name,
                  coalesce(nullif(u.raw_user_meta_data->>'display_name',''), split_part(u.email::text,'@',1), u.email::text)) as display_name,
         m.user_id
  from members m
  left join owners o on o.id = m.owner_id
  join auth.users u on u.id = m.user_id
  where exists (select 1 from me)
  order by kind desc, display_name asc
$$;
grant execute on function list_group_staff_candidates(uuid) to authenticated;

-- Read helpers for staff tables with calendar permission checks
drop function if exists get_event_staff_defaults(p_event_id uuid);
create or replace function get_event_staff_defaults(p_event_id uuid)
returns setof event_staff_default
language sql stable security definer set search_path = public as $$
  select esd.*
  from event_staff_default esd
  join events e on e.id = esd.event_id
  where esd.event_id = p_event_id
    and can_read_calendar(e.calendar_id)
  order by coalesce(esd.billing_ord, 999999), esd.owner_id;
$$;
grant execute on function get_event_staff_defaults(uuid) to authenticated;

drop function if exists get_event_staff_instance(p_event_id uuid, p_recurrence_id timestamptz);
create or replace function get_event_staff_instance(p_event_id uuid, p_recurrence_id timestamptz)
returns setof event_staff_instance
language sql stable security definer set search_path = public as $$
  select esi.*
  from event_staff_instance esi
  join events e on e.id = esi.event_id
  where esi.event_id = p_event_id and esi.recurrence_id = p_recurrence_id
    and can_read_calendar(e.calendar_id)
  order by coalesce(esi.billing_ord, 999999), esi.owner_id;
$$;
grant execute on function get_event_staff_instance(uuid, timestamptz) to authenticated;

-- Resolve an owner_id by user email (ensures owner row if user exists)
drop function if exists owner_id_by_email(p_email text);
create or replace function owner_id_by_email(p_email text)
returns uuid
language plpgsql stable security definer set search_path = public, auth as $$
declare u_id uuid; o_id uuid;
begin
  if p_email is null or length(trim(p_email)) = 0 then
    return null;
  end if;
  select id into u_id from auth.users where lower(email::text) = lower(trim(p_email)) limit 1;
  if u_id is null then
    return null;
  end if;
  -- Read-only resolution: do not create owners here to avoid writes in read-only transactions
  select get_owner_for_user(u_id) into o_id;
  return o_id;
end $$;
grant execute on function owner_id_by_email(text) to authenticated;

-- Ensure and return owner_id for a given user_id (used when a member lacks an owner row)
drop function if exists owner_id_by_userid(p_user_id uuid);
create or replace function owner_id_by_userid(p_user_id uuid)
returns uuid
language sql security definer stable set search_path = public as $$
  select ensure_owner_for_user(p_user_id);
$$;
grant execute on function owner_id_by_userid(uuid) to authenticated;

-- Enforce recurrence policy: finite and bounded
-- Rules:
--   - Max 12 total occurrences for RRULE via COUNT; otherwise require UNTIL within 12 months of dtstart
--   - If no RRULE, total of base + rdate[] must be <= 12
-- Notes: we only parse COUNT and UNTIL from RRULE; full expansion remains in the app.
drop function if exists _parse_rrule_param(v_rule text, p_name text);
create or replace function _parse_rrule_param(v_rule text, p_name text)
returns text language sql immutable as $$
  -- Extract value for a given RRULE param name (case-insensitive).
  -- We avoid quote_meta (not available in PG) and assume p_name is a simple token like COUNT/UNTIL.
  select nullif(
    (regexp_match(coalesce(v_rule,''), '(^|;)'||p_name||'=([^;]+)', 'i'))[2],
    ''
  );
$$;

drop function if exists validate_recurrence_policy(p_dtstart timestamptz, p_rrule text, p_rdate timestamptz[]);
create or replace function validate_recurrence_policy(p_dtstart timestamptz, p_rrule text, p_rdate timestamptz[])
returns void language plpgsql as $$
declare v_count_txt text; v_until_txt text; v_count int; v_until timestamptz; v_base_count int := 1; v_rdates int := 0;
begin
  if p_rrule is null or length(p_rrule) = 0 then
    v_rdates := coalesce(array_length(p_rdate,1),0);
    if (v_base_count + v_rdates) > 12 then
      raise exception 'Too many occurrences without RRULE: base + RDATEs (% > 12)', (v_base_count + v_rdates)
        using errcode = '22023';
    end if;
    return;
  end if;

  -- Extract COUNT and UNTIL (case-insensitive)
  v_count_txt := _parse_rrule_param(p_rrule, 'COUNT');
  v_until_txt := _parse_rrule_param(p_rrule, 'UNTIL');

  if v_count_txt is null and v_until_txt is null then
    raise exception 'RRULE must specify COUNT or UNTIL to cap occurrences' using errcode = '22023';
  end if;

  if v_count_txt is not null then
    begin
      v_count := v_count_txt::int;
    exception when others then
      raise exception 'Invalid RRULE COUNT: %', v_count_txt using errcode = '22023';
    end;
    if v_count > 12 then
      raise exception 'RRULE COUNT (%) exceeds 12', v_count using errcode = '22023';
    end if;
  end if;

  if v_until_txt is not null then
    -- Support UNTIL in forms YYYYMMDD or YYYYMMDDTHH24MISSZ (UTC)
    if v_until_txt ~ '^[0-9]{8}$' then
      v_until := to_timestamp(v_until_txt, 'YYYYMMDD');
    elsif v_until_txt ~ '^[0-9]{8}T[0-9]{6}Z?$' then
      v_until := to_timestamp(substr(v_until_txt,1,8)||substr(v_until_txt,10,6), 'YYYYMMDDHH24MISS');
    else
      raise exception 'Unsupported RRULE UNTIL format: %', v_until_txt using errcode = '22023';
    end if;
    if v_until > (p_dtstart + interval '12 months') then
      raise exception 'RRULE UNTIL (%) exceeds 12 months from DTSTART', v_until using errcode = '22023';
    end if;
  end if;
end $$;

-- Auto-create a primary calendar for each new group
drop trigger if exists trg_group_create_calendar on "group";
drop function if exists trg_group_create_calendar();
create or replace function trg_group_create_calendar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform ensure_primary_group_calendar(NEW.group_id);
  return NEW;
end $$;

create trigger trg_group_create_calendar
after insert on "group"
for each row execute procedure trg_group_create_calendar();
-- Read-only: resolve a user_id by email (no writes)
drop function if exists user_id_by_email(p_email text);
create or replace function user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email::text) = lower(trim(p_email)) limit 1;
$$;
grant execute on function user_id_by_email(text) to authenticated;
