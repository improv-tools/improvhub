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
    const d = new Date(); d.setMonth(d.getMonth() - 24); d.setHours(0,0,0,0); return d.toISOString();
  }, []);
  const windowTo = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 6); d.setHours(23,59,59,999); return d.toISOString();
  }, []);

  const refresh = async () => {
    if (!teamId) return;
    setErr("");
    try {
      const evs = await listTeamEvents(teamId, windowFrom, windowTo);
      setEventsBase(evs);
      const ovs = await listTeamEventOverrides(teamId, windowFrom, windowTo);
      setOverrides(ovs);
    } catch (e) { setErr(e.message || "Failed to load events"); }
  };

  useEffect(() => { if (teamId) refresh(); /* eslint-disable-next-line */ }, [teamId]);

  // Base occurrences (NO overrides) — use for reliable series ops
  const baseOccurrencesAll = useMemo(
    () => expandOccurrences(eventsBase, windowFrom, windowTo),
    [eventsBase, windowFrom, windowTo]
  );

  // Merged occurrences (WITH overrides) — use for display
  const occurrencesAll = useMemo(() => {
    const base = baseOccurrencesAll;
    if (!overrides.length) return base;
    const map = new Map();
    for (const o of overrides) map.set(`${o.event_id}|${new Date(o.occ_start).toISOString()}`, o);
    const out = [];
    for (const e of base) {
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
    out.sort((a,b)=>a.occ_start-b.occ_start);
    return out;
  }, [baseOccurrencesAll, overrides]);

  const now = new Date();
  const upcomingOcc = useMemo(() => occurrencesAll.filter(o => o.occ_start >= now), [occurrencesAll]);
  const pastOccDesc = useMemo(() => {
    const arr = occurrencesAll.filter(o => o.occ_start < now);
    arr.sort((a, b) => b.occ_start - a.occ_start);
    return arr;
  }, [occurrencesAll]);

  // --- Helpers for “series” operations work from BASE occurrences ---
  const getEventById = (eventId) => eventsBase.find(e => e.id === eventId) || null;
  const getBaseOccurrencesFor = (eventId) => baseOccurrencesAll.filter(o => o.id === eventId);
  const countFutureOccurrencesInSeries = (eventId) => {
    const n = new Date();
    return getBaseOccurrencesFor(eventId).filter(o => o.occ_start >= n).length;
  };

  // Human summary like “Every 3 weeks on Thursday until 2025-12-31”
  const dayName = (code) => ({SU:"Sunday",MO:"Monday",TU:"Tuesday",WE:"Wednesday",TH:"Thursday",FR:"Friday",SA:"Saturday"}[code] || code);
  const nthLabel = (n) => {
  if (n === -1) return "last";
  const v = Math.abs(n); // safety, though n should be positive here
  const mod10 = v % 10, mod100 = v % 100;
  const suffix =
    mod10 === 1 && mod100 !== 11 ? "st" :
    mod10 === 2 && mod100 !== 12 ? "nd" :
    mod10 === 3 && mod100 !== 13 ? "rd" : "th";
  return `${v}${suffix}`;
};

  const summarizeRecurrence = (ev) => {
    if (!ev || ev.recur_freq === "none") return "One-off";
    let s = ev.recur_freq === "weekly"
      ? `Every ${ev.recur_interval>1?`${ev.recur_interval} weeks`:"week"}`
      : `Every ${ev.recur_interval>1?`${ev.recur_interval} months`:"month"}`;
    if (ev.recur_freq === "weekly" && ev.recur_byday?.length) {
      s += ` on ${ev.recur_byday.map(dayName).join(", ")}`;
    }
    if (ev.recur_freq === "monthly") {
      if (ev.recur_week_of_month) s += ` on the ${nthLabel(ev.recur_week_of_month)} ${dayName(ev.recur_day_of_week||"")}`;
      else if (ev.recur_bymonthday?.length) s += ` on day ${ev.recur_bymonthday.join(", ")}`;
    }
    if (ev.recur_until) s += ` until ${ev.recur_until}`;
    else if (ev.recur_count) s += ` for ${ev.recur_count} occurrence(s)`;
    return s;
  };

  // --- API actions ---
  const createEvent = (payload) => createTeamEvent(payload).then(refresh);
  const deleteSeries = (eventId) => deleteTeamEvent(eventId).then(refresh);
  const deleteOccurrence = (eventId, occStartIso) => deleteEventOccurrence(eventId, occStartIso).then(refresh);
  const patchOccurrence = (eventId, occStartIso, updates) => upsertOccurrenceOverride(eventId, occStartIso, updates).then(refresh);

  // Apply updates to every FUTURE base occurrence (no new series)
  const applyFutureEdits = async (eventId, fromOccStartIso, updates) => {
    const from = new Date(fromOccStartIso);
    const targets = getBaseOccurrencesFor(eventId).filter(o => o.occ_start >= from);
    for (const o of targets) { // sequential to keep order + avoid rate spikes
      // eslint-disable-next-line no-await-in-loop
      await upsertOccurrenceOverride(eventId, o.occ_start.toISOString(), updates);
    }
    await refresh();
  };

  // Apply updates to the ENTIRE base series in the loaded window
  const applySeriesEdits = async (eventId, updates) => {
    const targets = getBaseOccurrencesFor(eventId);
    for (const o of targets) {
      // eslint-disable-next-line no-await-in-loop
      await upsertOccurrenceOverride(eventId, o.occ_start.toISOString(), updates);
    }
    await refresh();
  };

  return {
    err, setErr,
    occurrencesAll, upcomingOcc, pastOccDesc,
    refresh,
    createEvent, deleteSeries, deleteOccurrence, patchOccurrence,
    // new helpers for UI
    baseOccurrencesAll,
    getEventById,
    summarizeRecurrence,
    countFutureOccurrencesInSeries,
    applyFutureEdits,
    applySeriesEdits,
  };
}
