// src/teams/hooks/useCalendarData.js
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchGroupEvents,
  fetchGroupOverrides,
  createGroupEvent,
  updateEvent,
  listOrphanedEventInstances,
  updateEventAndPrune,
  deleteEvent,
  upsertEventOverride,
  deleteEventOverrideRPC,
  listGroupCalendars,
} from "../teams.api";
import { expandEvents, expandBaseOccurrences } from "../../calendar/expandOccurrences";

export default function useCalendarData(teamId, windowStartIso, windowEndIso) {
  const [events, setEvents] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const inflight = useMemo(() => ({ v: 0 }), []);
  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true); setErr("");
    try {
      const myTicket = ++inflight.v;
      const cals = await listGroupCalendars(teamId);
      const calIds = (cals || []).map(c => c.id);
      const [ev, ov] = await Promise.all([
        fetchGroupEvents(teamId, windowStartIso, windowEndIso, calIds),
        fetchGroupOverrides(teamId, windowStartIso, windowEndIso, calIds),
      ]);
      // Discard out-of-order responses
      if (myTicket !== inflight.v) return;
      // Normalize prototype events to legacy-friendly shape expected by CalendarPanel
      const norm = (ev || []).map(e => ({
        ...e,
        // legacy-friendly aliases for series editing UI
        starts_at: e.dtstart,
        ends_at: e.dtend,
        tz: e.tzid || 'UTC',
        title: e.summary || '',
        description: e.description || '',
        location: e.location || '',
        category: e.category || 'rehearsal',
      }));
      setEvents(norm);
      setOverrides(ov);
    } catch (e) {
      setErr(e.message || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [teamId, windowStartIso, windowEndIso]);

  useEffect(() => { load(); }, [load]);

  const occurrences = useMemo(() => {
    const merged = expandEvents({ events, overrides, windowStart: windowStartIso, windowEnd: windowEndIso, capPerEvent: 12 });
    // Adapt to legacy consumer shape for CalendarPanel
    return merged.map(m => ({
      event_id: m.eventId,
      base_start: m.recurrence_id,
      starts_at: m.start ? new Date(m.start).toISOString() : m.recurrence_id,
      ends_at: m.end ? new Date(m.end).toISOString() : null,
      title: (m.override && m.override.summary) || (m.event && m.event.summary) || '',
      description: (m.override && m.override.description) || (m.event && m.event.description) || '',
      location: (m.override && m.override.location) || (m.event && m.event.location) || '',
      tz: (m.override && m.override.tzid) || (m.event && m.event.tzid) || 'UTC',
      overridden: !!m.override,
    }));
  }, [events, overrides, windowStartIso, windowEndIso]);

  // Mutations
  const createBase = async (payload) => {
    // Map legacy payload to prototype event fields
    const e = await createGroupEvent(teamId, {
      summary: payload.title,
      description: payload.description,
      location: payload.location,
      tzid: payload.tz,
      dtstart: payload.starts_at,
      dtend: payload.ends_at,
      rrule: (() => {
        // Compose a minimal RRULE from legacy fields
        const freq = (payload.recur_freq || 'none').toUpperCase();
        if (freq === 'NONE') return null;
        const parts = [ `FREQ=${freq}` ];
        if (payload.recur_interval && Number(payload.recur_interval) > 1) parts.push(`INTERVAL=${Number(payload.recur_interval)}`);
        if (payload.recur_byday && Array.isArray(payload.recur_byday) && payload.recur_byday.length) parts.push(`BYDAY=${payload.recur_byday.join(',')}`);
        if (payload.recur_bymonthday && Array.isArray(payload.recur_bymonthday) && payload.recur_bymonthday.length) parts.push(`BYMONTHDAY=${payload.recur_bymonthday.join(',')}`);
        if (payload.recur_week_of_month && payload.recur_day_of_week) parts.push(`BYDAY=${payload.recur_week_of_month}${payload.recur_day_of_week}`);
        if (payload.recur_until) parts.push(`UNTIL=${new Date(payload.recur_until).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/, 'Z')}`);
        if (payload.recur_count) parts.push(`COUNT=${payload.recur_count}`);
        return parts.join(';');
      })(),
    });
    await load();
    return e;
  };
  const updateBase = async (eventId, patch) => {
    // Build patch for server
    const serverPatch = {
      summary: patch.title,
      description: patch.description,
      location: patch.location,
      tzid: patch.tz,
      dtstart: patch.starts_at,
      dtend: patch.ends_at,
      rrule: patch.recur_freq ? (()=>{
        const freq = (patch.recur_freq || 'none').toUpperCase();
        if (freq === 'NONE') return null;
        const parts = [ `FREQ=${freq}` ];
        if (patch.recur_interval && Number(patch.recur_interval) > 1) parts.push(`INTERVAL=${Number(patch.recur_interval)}`);
        if (patch.recur_byday && Array.isArray(patch.recur_byday) && patch.recur_byday.length) parts.push(`BYDAY=${patch.recur_byday.join(',')}`);
        if (patch.recur_bymonthday && Array.isArray(patch.recur_bymonthday) && patch.recur_bymonthday.length) parts.push(`BYMONTHDAY=${patch.recur_bymonthday.join(',')}`);
        if (patch.recur_week_of_month && patch.recur_day_of_week) parts.push(`BYDAY=${patch.recur_week_of_month}${patch.recur_day_of_week}`);
        if (patch.recur_until) parts.push(`UNTIL=${new Date(patch.recur_until).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/, 'Z')}`);
        if (patch.recur_count) parts.push(`COUNT=${patch.recur_count}`);
        return parts.join(';');
      })() : undefined,
    };

    // Compute authoritative valid recurrence_id set (no time window), capped by server policy (12/12months)
    try {
      const current = events.find(ev => ev.id === eventId);
      if (current) {
        const candidate = {
          ...current,
          dtstart: serverPatch.dtstart ?? current.dtstart,
          dtend: serverPatch.dtend ?? current.dtend,
          rrule: serverPatch.rrule === undefined ? current.rrule : serverPatch.rrule,
        };
        const start = new Date(candidate.dtstart);
        const windowStart = new Date(start.getTime() - 24*3600*1000);
        const windowEnd = new Date(start.getTime() + 370*24*3600*1000);
        const bases = expandBaseOccurrences(candidate, windowStart.toISOString(), windowEnd.toISOString(), { hardCap: 12, monthsLimit: 12 }) || [];
        const validRids = bases.map(b => new Date(b.recurrence_id).toISOString());

        // Ask server which instance data would be orphaned
        const orphans = await listOrphanedEventInstances(eventId, validRids);
        if (orphans.length > 0) {
          const count = orphans.length;
          const ok = window.confirm(`This change will remove ${count} edited occurrence(s). Proceed?`);
          if (ok) {
            const e = await updateEventAndPrune(eventId, serverPatch, validRids);
            await load();
            return e;
          }
        }
      }
    } catch (e) {
      console.warn('orphan preview failed, falling back to simple update', e);
    }

    // Fallback: simple update without pruning
    const e = await updateEvent(eventId, serverPatch);
    await load();
    return e;
  };
  const deleteBase = async (eventId) => {
    await deleteEvent(eventId);
    await load();
  };

  const editOccurrence = async (eventId, baseStartIso, patch) => {
    await upsertEventOverride(eventId, baseStartIso, {
      summary: patch.title,
      description: patch.description,
      location: patch.location,
      tzid: patch.tz,
      dtstart: patch.starts_at,
      dtend: patch.ends_at,
      status: 'CONFIRMED'
    });
    await load();
  };
  const cancelOccurrence = async (eventId, baseStartIso) => {
    await upsertEventOverride(eventId, baseStartIso, { status: 'CANCELLED' });
    await load();
  };
  const clearOccurrenceOverride = async (eventId, baseStartIso) => {
    await deleteEventOverrideRPC(eventId, baseStartIso);
    await load();
  };

  return {
    loading, err, events, overrides, occurrences, reload: load,
    createBase, updateBase, deleteBase,
    editOccurrence, cancelOccurrence, clearOccurrenceOverride,
  };
}
