-- 05_calendar.sql
-- =============================================================================
-- PURPOSE
--   Calendar schema including:
--     • slots (operational containers)
--     • events and materialized occurrences (per-date)
--     • event staff roles:
--         – defaults on event (series)
--         – per-occurrence overrides
--     • slot-level staff roles (ops only, does NOT gate invites)
--     • attendees model keyed by occurrence
--     • integrity:
--         – member_of must be groups only
--         – member_of subset of resolved event staff for that occurrence
--         – auto-drop of future invites that become ineligible
--
-- DESIGN NOTES
--   • Eligibility is based on event credits (resolved per occurrence),
--     NOT on slot staff. Slot staff is operational (e.g., guest tech).
--   • Direct individual invites are always allowed (member_of empty).
--   • Group-based invites require member_of to list credited group owners.
-- =============================================================================

-- === Core calendar tables ===============================================

-- Operational "container" a show/date runs in
CREATE TABLE slots (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_slots_touch
BEFORE UPDATE ON slots
FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

-- Event series (defaults live here)
CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  slot_id    uuid REFERENCES slots(id),          -- default slot for the series (optional)
  starts_at  timestamptz,                        -- optional anchor
  ends_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_events_touch
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();

-- Materialized occurrences so per-date logic is easy and correct
CREATE TABLE event_occurrence (
  occurrence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz,
  slot_id       uuid REFERENCES slots(id),       -- resolved slot for the date
  is_cancelled  boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_occ_event ON event_occurrence(event_id, starts_at);

-- === Event staff roles (credits) ========================================
-- Defaults applied to each occurrence unless overridden
CREATE TABLE event_staff_default (
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,  -- individual or group
  role         role_kind NOT NULL,
  billing_name text,
  billing_ord  int,
  notes        text,
  PRIMARY KEY (event_id, owner_id, role)
);
CREATE INDEX esd_event_idx ON event_staff_default(event_id, role, billing_ord);
CREATE INDEX esd_owner_idx ON event_staff_default(owner_id, role);

-- Per-occurrence overrides: store only rows that differ from defaults
CREATE TABLE event_staff_occurrence (
  occurrence_id uuid NOT NULL REFERENCES event_occurrence(occurrence_id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  role          role_kind NOT NULL,
  billing_name  text,
  billing_ord   int,
  notes         text,
  PRIMARY KEY (occurrence_id, owner_id, role)
);
CREATE INDEX eso_occ_idx   ON event_staff_occurrence(occurrence_id, role, billing_ord);
CREATE INDEX eso_owner_idx ON event_staff_occurrence(owner_id, role);

-- Resolved view = overrides ∪ (defaults minus overridden pairs)
-- This is the source of truth for "who is credited on this occurrence".
CREATE OR REPLACE VIEW v_event_staff_resolved AS
WITH dft AS (
  SELECT eo.occurrence_id, esd.owner_id, esd.role, esd.billing_name, esd.billing_ord, esd.notes
  FROM event_staff_default esd
  JOIN event_occurrence eo ON eo.event_id = esd.event_id
),
ovr AS (
  SELECT occurrence_id, owner_id, role, billing_name, billing_ord, notes
  FROM event_staff_occurrence
),
dft_filtered AS (
  SELECT d.*
  FROM dft d
  WHERE NOT EXISTS (
    SELECT 1 FROM ovr
    WHERE ovr.occurrence_id = d.occurrence_id
      AND ovr.owner_id      = d.owner_id
      AND ovr.role          = d.role
  )
)
SELECT * FROM ovr
UNION ALL
SELECT * FROM dft_filtered;

-- === Slot-level operational staff (guest tech, etc.) =====================
-- These roles are for logistics and DO NOT gate invitations.
-- Uses the same role_kind enum as event credits (e.g., 'crew'/'host').
CREATE TABLE slot_staff (
  slot_id uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  role    role_kind NOT NULL DEFAULT 'crew',
  notes   text,
  PRIMARY KEY (slot_id, owner_id, role)
);
CREATE INDEX idx_slot_staff_slot_role  ON slot_staff(slot_id, role);
CREATE INDEX idx_slot_staff_owner_role ON slot_staff(owner_id, role);

-- === Attendees & integrity ==============================================

-- Unified attendees: the invitee (owner_id) can be an individual or a group.
-- If the invite is "as part of" a group, member_of_owner_ids must list group
-- owners that are credited on this specific occurrence.
CREATE TABLE event_attendees (
  occurrence_id        uuid NOT NULL REFERENCES event_occurrence(occurrence_id) ON DELETE CASCADE,
  owner_id             uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,  -- invitee
  member_of_owner_ids  uuid[],                                                -- groups they attend under
  invited_by_owner_id  uuid REFERENCES owners(id) ON DELETE SET NULL,
  notes                text,
  PRIMARY KEY (occurrence_id, owner_id)
);

-- (A) Guarantee member_of references GROUP owners only (never individuals).
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

-- (B) Guarantee member_of is a subset of the RESOLVED event staff for this occurrence.
--     This ties eligibility to the per-date credited groups, not slot ops staff.
CREATE OR REPLACE FUNCTION _chk_attendee_member_of_event_staff()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  missing uuid[];
BEGIN
  IF NEW.member_of_owner_ids IS NULL OR array_length(NEW.member_of_owner_ids,1) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(z.owner_id), '{}'::uuid[])
    INTO missing
  FROM unnest(NEW.member_of_owner_ids) AS z(owner_id)
  LEFT JOIN (
    SELECT DISTINCT owner_id
    FROM v_event_staff_resolved
    WHERE occurrence_id = NEW.occurrence_id
  ) allowed ON allowed.owner_id = z.owner_id
  WHERE allowed.owner_id IS NULL;

  IF array_length(missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'member_of contains owners not on resolved event staff: %', missing
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER trg_chk_attendee_member_of_event_staff
AFTER INSERT OR UPDATE ON event_attendees
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION _chk_attendee_member_of_event_staff();

-- === Auto-drop ineligible invitations (future occurrences only) =========
-- These triggers proactively REMOVE now-invalid invites when the world changes:
--   1) a user leaves a group they were attending under
--   2) per-occurrence staff changes
--   3) default staff changes (fan-out to all future occurrences)

-- Convenience lookups for owners
CREATE OR REPLACE FUNCTION _owner_id_for_group(g uuid) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM owners WHERE kind='group' AND group_id=g $$;

CREATE OR REPLACE FUNCTION _owner_id_for_user(u uuid) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM owners WHERE kind='individual' AND individual_user_id=u $$;

-- (1) Membership end/removal ⇒ drop future invites where attendee is that user and member_of includes the group
CREATE OR REPLACE FUNCTION drop_invites_on_membership_end()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  grp_owner_id uuid;
  usr_owner_id uuid;
BEGIN
  SELECT _owner_id_for_group(COALESCE(NEW.group_id, OLD.group_id)) INTO grp_owner_id;
  SELECT _owner_id_for_user(COALESCE(NEW.user_id, OLD.user_id))   INTO usr_owner_id;

  IF grp_owner_id IS NULL OR usr_owner_id IS NULL THEN
    RETURN COALESCE(NEW,OLD);
  END IF;

  DELETE FROM event_attendees ea
  USING event_occurrence eo
  WHERE ea.occurrence_id = eo.occurrence_id
    AND eo.starts_at >= now()
    AND ea.owner_id = usr_owner_id
    AND ea.member_of_owner_ids @> ARRAY[grp_owner_id]::uuid[];

  RETURN COALESCE(NEW,OLD);
END $$;

CREATE TRIGGER trg_drop_on_membership_end
AFTER UPDATE OF ended_on OR DELETE ON group_membership
FOR EACH ROW EXECUTE FUNCTION drop_invites_on_membership_end();

-- (2) Occurrence staff changes ⇒ drop invites referencing owners no longer present
CREATE OR REPLACE FUNCTION drop_invites_on_occurrence_staff_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM event_attendees ea
  WHERE ea.occurrence_id = COALESCE(NEW.occurrence_id, OLD.occurrence_id)
    AND EXISTS (
      SELECT 1
      FROM unnest(ea.member_of_owner_ids) m(owner_id)
      WHERE NOT EXISTS (
        SELECT 1
        FROM v_event_staff_resolved r
        WHERE r.occurrence_id = COALESCE(NEW.occurrence_id, OLD.occurrence_id)
          AND r.owner_id = m.owner_id
      )
    );
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE TRIGGER trg_drop_on_occ_staff_iud
AFTER INSERT OR UPDATE OR DELETE ON event_staff_occurrence
FOR EACH ROW EXECUTE FUNCTION drop_invites_on_occurrence_staff_change();

-- (3) Default staff changes ⇒ drop invites for all affected future occurrences
CREATE OR REPLACE FUNCTION drop_invites_on_default_staff_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM event_attendees ea
  USING event_occurrence eo
  WHERE eo.event_id = COALESCE(NEW.event_id, OLD.event_id)
    AND eo.starts_at >= now()
    AND ea.occurrence_id = eo.occurrence_id
    AND EXISTS (
      SELECT 1
      FROM unnest(ea.member_of_owner_ids) m(owner_id)
      WHERE NOT EXISTS (
        SELECT 1
        FROM v_event_staff_resolved r
        WHERE r.occurrence_id = eo.occurrence_id
          AND r.owner_id = m.owner_id
      )
    );
  RETURN COALESCE(NEW,OLD);
END $$;

CREATE TRIGGER trg_drop_on_default_staff_iud
AFTER INSERT OR UPDATE OR DELETE ON event_staff_default
FOR EACH ROW EXECUTE FUNCTION drop_invites_on_default_staff_change();
