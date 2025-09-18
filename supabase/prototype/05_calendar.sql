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

CREATE TABLE calendars (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE, -- generic owner (individual/group)
  name             text NOT NULL,
  description      text,
  color            text,
  timezone_default text NOT NULL,   -- e.g. 'Europe/London'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cal_touch
BEFORE UPDATE ON calendars
FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

CREATE TABLE calendar_members (
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        cal_role NOT NULL,              -- 'owner'/'writer'/'reader'
  PRIMARY KEY (calendar_id, user_id)
);
CREATE INDEX idx_cal_members_user ON calendar_members(user_id);

-- =========================
-- RFC 5545 TABLES
-- =========================

-- Master events (VEVENT)
CREATE TABLE events (
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
CREATE INDEX idx_events_cal_dt  ON events (calendar_id, dtstart);
CREATE INDEX idx_events_cal_uid ON events (calendar_id, uid);
CREATE INDEX idx_events_cats    ON events USING gin (categories);
CREATE INDEX idx_events_ext     ON events USING gin (extended);

CREATE TRIGGER trg_events_touch
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

-- Detached per-instance overrides (RECURRENCE-ID)
CREATE TABLE event_overrides (
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
CREATE INDEX idx_overrides_parent_rid ON event_overrides (parent_event_id, recurrence_id);

CREATE TRIGGER trg_overrides_touch
BEFORE UPDATE ON event_overrides
FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

-- =========================
-- EVENT STAFF (credits)
-- =========================

-- Series defaults (apply to every instance unless overridden)
CREATE TABLE event_staff_default (
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,  -- individual or group
  role         role_kind NOT NULL,                                     -- performer/producer/...
  billing_name text,
  billing_ord  int,
  notes        text,
  PRIMARY KEY (event_id, owner_id, role)
);
CREATE INDEX esd_event_idx ON event_staff_default(event_id, role, billing_ord);
CREATE INDEX esd_owner_idx ON event_staff_default(owner_id, role);

-- Instance overrides keyed by (event_id, recurrence_id)
CREATE TABLE event_staff_instance (
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recurrence_id timestamptz NOT NULL,                              -- RFC 5545 RECURRENCE-ID
  owner_id      uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  role          role_kind NOT NULL,
  billing_name  text,
  billing_ord   int,
  notes         text,
  PRIMARY KEY (event_id, recurrence_id, owner_id, role)
);
CREATE INDEX esi_event_idx ON event_staff_instance(event_id, recurrence_id, role, billing_ord);
CREATE INDEX esi_owner_idx ON event_staff_instance(owner_id, role);

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
-- SLOT-LEVEL STAFF (ops only)
-- =========================
-- Uses role_kind (e.g., 'crew','host') but does NOT gate invites.
CREATE TABLE slot_staff (
  slot_id uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  role    role_kind NOT NULL DEFAULT 'crew',
  notes   text,
  PRIMARY KEY (slot_id, owner_id, role)
);
CREATE INDEX idx_slot_staff_slot_role  ON slot_staff(slot_id, role);
CREATE INDEX idx_slot_staff_owner_role ON slot_staff(owner_id, role);

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
CREATE TABLE event_attendees (
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

CREATE INDEX idx_attendees_event    ON event_attendees (event_id);
CREATE INDEX idx_attendees_override ON event_attendees (override_id);
CREATE INDEX idx_attendees_owner    ON event_attendees (owner_id);
CREATE INDEX idx_attendees_email    ON event_attendees (email);

-- Unique per (scope, identity). Treat NULL override_id as equal across rows.
CREATE UNIQUE INDEX uq_attendees_scope_owner ON event_attendees (
  COALESCE(slot_id,     '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(override_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(owner_id,    '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE owner_id IS NOT NULL;

CREATE UNIQUE INDEX uq_attendees_scope_email ON event_attendees (
  COALESCE(slot_id,     '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(override_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(email)
) WHERE owner_id IS NULL AND email IS NOT NULL;

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
CREATE CONSTRAINT TRIGGER trg_chk_member_of_instance_staff
AFTER INSERT OR UPDATE ON event_attendees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION _chk_member_of_instance_staff();

CREATE CONSTRAINT TRIGGER trg_chk_member_of_series_staff
AFTER INSERT OR UPDATE ON event_attendees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION _chk_member_of_series_staff();

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
    SELECT 1 FROM calendar_members m WHERE m.calendar_id = cal_id AND m.user_id = auth.uid()
    UNION
    SELECT 1 FROM calendars c JOIN owner_users ou ON ou.owner_id = c.owner_id
      WHERE c.id = cal_id AND ou.user_id = auth.uid()
  );
$$;

CREATE POLICY cal_read  ON calendars         FOR SELECT USING (can_read_calendar(id));
CREATE POLICY cal_write ON calendars         FOR ALL    USING (can_write_calendar(id)) WITH CHECK (can_write_calendar(id));
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
