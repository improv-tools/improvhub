// src/teams/hooks/useCalendarData.js
import { useEffect, useMemo, useState } from "react";
import {
  listTeamEvents,
  listTeamEventOverrides,
  createTeamEvent,
  deleteTeamEvent,
  deleteEventOccurrence,
  upsertOccurrenceOverride,
} from "teams/teams.api";
import { expandOccurrences } from "teams/utils/expandOccurrences";

export function useCalendarData(teamId) {
  const [eventsBase, setEventsBase] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [err, setErr] = useState("");

  const windowFrom = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 24); d.setHours(0, 0, 0, 0); return d.toISOString();
  }, []);
  const windowTo = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 6); d.setHours(23, 59, 59, 999); return d.toISOString();
  }, []);

  const refresh = async () => {
    if (!teamId) return;
    setErr("");
    try {
      const evs = await listTeamEvents(teamId, windowFrom, windowTo);
      setEventsBase(evs);
      const ovs = await listTeamEventOverrides(teamId, windowFrom, windowTo);
      setOverrides(ovs);
    } catch (e) {
      setErr(e.message || "Failed to load events");
    }
  };

  useEffect(() => { if (teamId) refresh(); /* eslint-disable-next-line */ }, [teamId]);

  // merge overrides
  const occurrencesAll = useMemo(() => {
    const occ = expandOccurrences(eventsBase, windowFrom, windowTo);
    if (!overrides.length) return occ;

    const map = new Map();
    for (const o of overrides) {
      map.set(`${o.event_id}|${new Date(o.occ_start).toISOString()}`, o);
    }
    const out = [];
    for (const e of occ) {
      const key = `${e.id}|${e.occ_start.toISOString()}`;
      const o = map.get(key);
      if (!o) { out.push(e); continue; }
      if (o.canceled) continue;
      out.push({
        ...e,
        title: o.title ?? e.title,
        description: o.description ?? e.description,
        location: o.location ?? e.location,
        tz: o.tz ?? e.tz,
        occ_start: o.starts_at ? new Date(o.starts_at) : e.occ_start,
        occ_end: o.ends_at ? new Date(o.ends_at) : e.occ_end,
        category: o.category ?? e.category,
      });
    }
    out.sort((a, b) => a.occ_start - b.occ_start);
    return out;
  }, [eventsBase, overrides, windowFrom, windowTo]);

  const now = new Date();
  const upcomingOcc = useMemo(() => occurrencesAll.filter(o => o.occ_start >= now), [occurrencesAll]);
  const pastOccDesc = useMemo(() => {
    const arr = occurrencesAll.filter(o => o.occ_start < now);
    arr.sort((a, b) => b.occ_start - a.occ_start);
    return arr;
  }, [occurrencesAll]);

  // actions
  const createEvent = (payload) => createTeamEvent(payload).then(refresh);
  const deleteSeries = (eventId) => deleteTeamEvent(eventId).then(refresh);
  const deleteOccurrence = (eventId, occStartIso) => deleteEventOccurrence(eventId, occStartIso).then(refresh);
  const patchOccurrence = (eventId, occStartIso, updates) => upsertOccurrenceOverride(eventId, occStartIso, updates).then(refresh);

  return {
    err, setErr,
    occurrencesAll, upcomingOcc, pastOccDesc,
    refresh,
    createEvent, deleteSeries, deleteOccurrence, patchOccurrence,
  };
}
