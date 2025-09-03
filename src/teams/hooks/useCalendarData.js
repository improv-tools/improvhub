// src/teams/hooks/useCalendarData.js
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTeamEvents,
  fetchTeamEventOverrides,
} from "teams/teams.api";

/* ----------------------------- Date helpers ----------------------------- */

const DAY = 24 * 60 * 60 * 1000;

const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function jsDowToCode(js) { return DOW[js]; }
function codeToJsDow(code) { return DOW.indexOf(code); }

function addDays(d, n) {
  const nd = new Date(d.getTime());
  nd.setDate(nd.getDate() + n);
  return nd;
}
function addWeeks(d, n) { return addDays(d, 7 * n); }
function addMonths(d, n) {
  const nd = new Date(d.getTime());
  const day = nd.getDate();
  nd.setMonth(nd.getMonth() + n);
  // keep same day if possible
  if (nd.getDate() < day) nd.setDate(0);
  return nd;
}
function clamp(a, min, max) { return Math.max(min, Math.min(max, a)); }

/* -------------------------- Recurrence expansion -------------------------- */
/**
 * Expand base events into occurrence objects within [from, to].
 * Each returned occurrence has:
 *  {
 *    id, team_id, title, description, location, tz, category,
 *    occ_start: Date, occ_end: Date,
 *    base_start: Date,           // ALWAYS the original base occurrence start
 *    recur_* fields copied from event for UI checks
 *  }
 */
export function expandOccurrences(baseEvents, from, to) {
  const out = [];

  for (const e of baseEvents) {
    const start = new Date(e.starts_at);
    const end   = new Date(e.ends_at);

    const common = {
      id: e.id,
      team_id: e.team_id,
      title: e.title,
      description: e.description,
      location: e.location,
      tz: e.tz,
      category: e.category || "rehearsal",
      recur_freq: e.recur_freq || "none",
      recur_interval: e.recur_interval || 1,
      recur_byday: e.recur_byday || null,            // text[]
      recur_bymonthday: e.recur_bymonthday || null,  // int[]
      recur_week_of_month: e.recur_week_of_month || null, // int (1..5 or -1)
      recur_day_of_week: e.recur_day_of_week || null,     // text (SU..SA)
      recur_count: e.recur_count || null,            // int
      recur_until: e.recur_until ? new Date(e.recur_until) : null, // Date
    };

    const freq = common.recur_freq;

    if (freq === "none" || !freq) {
      // one-off
      if (end >= from && start <= to) {
        out.push({
          ...common,
          occ_start: new Date(start),
          occ_end: new Date(end),
          base_start: new Date(start),
        });
      }
      continue;
    }

    // Recurring
    const interval = Math.max(1, common.recur_interval || 1);
    const until = common.recur_until ? new Date(common.recur_until) : null;
    const countLimit = common.recur_count || Infinity;

    // series safety limits: don't expand more than 24 months ahead
    const hardUntil = addMonths(new Date(), 24);
    const hardTo = new Date(Math.min(hardUntil.getTime(), to.getTime()));

    let generated = 0;

    if (freq === "weekly") {
      // weekly on specified byday(s)
      const by = (common.recur_byday && common.recur_byday.length)
        ? common.recur_byday
        : [jsDowToCode(start.getDay())];

      // find the week "epoch": the Monday/Sunday of the start's week
      // We'll iterate by 'interval' weeks and within each week emit selected weekdays.
      // Use Sunday as week start to align with js getDay() 0..6 (SU..SA).
      const firstWeekStart = addDays(start, -start.getDay()); // Sunday of start's week

      // iterate weeks
      for (let week = 0; ; week += interval) {
        const weekStart = addWeeks(firstWeekStart, week);
        // bail if the week is far beyond range
        if (weekStart > hardTo) break;

        for (const code of by) {
          const targetDow = codeToJsDow(code);
          if (targetDow < 0) continue;

          const dayStart = new Date(weekStart.getTime());
          dayStart.setDate(weekStart.getDate() + ((targetDow - weekStart.getDay() + 7) % 7));
          // align time-of-day to base event
          dayStart.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
          const dayEnd = new Date(dayStart.getTime() + (end - start));

          // skip occurrences before the original start datetime
          if (dayStart < start) continue;

          // enforce until and from/to window
          if (until && dayStart > until) continue;
          if (dayEnd < from) continue;
          if (dayStart > hardTo) continue;

          out.push({
            ...common,
            occ_start: dayStart,
            occ_end: dayEnd,
            base_start: dayStart,
          });
          generated++;
          if (generated >= countLimit) break;
        }
        if (generated >= countLimit) break;
      }
    } else if (freq === "monthly") {
      // Two modes: by specific day(s) of month, or by "nth weekday"
      const byMonthDays = common.recur_bymonthday; // e.g. [1,15,30]
      const nth = common.recur_week_of_month;      // 1..5 or -1 (last)
      const dow = common.recur_day_of_week;        // SU..SA

      let cursor = new Date(start);
      // normalize to first occurrence month
      cursor.setDate(1);
      cursor.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());

      let loops = 0;
      while (cursor <= hardTo && loops < 1000) {
        // for this month, generate matches
        const monthStart = new Date(cursor);
        const monthEnd = addMonths(monthStart, 1);
        monthEnd.setDate(0); // last day prev month

        const candidates = [];

        if (byMonthDays && byMonthDays.length) {
          for (const d of byMonthDays) {
            const dom = clamp(d, 1, monthEnd.getDate());
            const dStart = new Date(monthStart);
            dStart.setDate(dom);
            const occStart = new Date(dStart);
            const occEnd = new Date(occStart.getTime() + (end - start));
            candidates.push({ occStart, occEnd });
          }
        } else if (nth && dow) {
          const targetDow = codeToJsDow(dow);
          if (nth === -1) {
            // last weekday of month
            const last = new Date(monthEnd);
            // go back to target dow
            const delta = (last.getDay() - targetDow + 7) % 7;
            last.setDate(last.getDate() - delta);
            const occStart = new Date(last);
            const occEnd = new Date(occStart.getTime() + (end - start));
            candidates.push({ occStart, occEnd });
          } else {
            // nth weekday: find first occurrence of that dow
            const first = new Date(monthStart);
            const delta = (targetDow - first.getDay() + 7) % 7;
            first.setDate(first.getDate() + delta);
            const nDate = new Date(first);
            nDate.setDate(first.getDate() + 7 * (nth - 1));
            if (nDate.getMonth() === monthStart.getMonth()) {
              const occStart = new Date(nDate);
              const occEnd = new Date(occStart.getTime() + (end - start));
              candidates.push({ occStart, occEnd });
            }
          }
        } else {
          // default: same day-of-month as original start
          const dom = clamp(start.getDate(), 1, monthEnd.getDate());
          const dStart = new Date(monthStart);
          dStart.setDate(dom);
          const occStart = new Date(dStart);
          const occEnd = new Date(occStart.getTime() + (end - start));
          candidates.push({ occStart, occEnd });
        }

        for (const c of candidates) {
          // set time-of-day from base start
          c.occStart.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
          // skip occurrences before first start
          if (c.occStart < start) continue;

          if (until && c.occStart > until) continue;
          if (c.occEnd < from) continue;
          if (c.occStart > hardTo) continue;

          out.push({
            ...common,
            occ_start: c.occStart,
            occ_end: c.occEnd,
            base_start: c.occStart,
          });
          generated++;
          if (generated >= countLimit) break;
        }
        if (generated >= countLimit) break;

        cursor = addMonths(cursor, interval);
        loops++;
      }
    } else {
      // Unknown freq: treat as one-off
      if (end >= from && start <= to) {
        out.push({
          ...common,
          occ_start: new Date(start),
          occ_end: new Date(end),
          base_start: new Date(start),
        });
      }
    }
  }

  // sort by start
  out.sort((a, b) => a.occ_start - b.occ_start);
  return out;
}

/* ------------------------------- Main hook -------------------------------- */

export function useCalendarData(teamId) {
  const [eventsBase, setEventsBase] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pastPage, setPastPage] = useState(25);

  // Window: 6 months back to 18 months ahead
  const windowFrom = useMemo(() => addMonths(new Date(), -6), []);
  const windowTo   = useMemo(() => addMonths(new Date(), 18), []);

  const refresh = useCallback(async () => {
    if (!teamId) {
      setEventsBase([]); setOverrides([]); return;
    }
    setLoading(true);
    try {
      const base = await fetchTeamEvents(teamId);
      setEventsBase(base);
      const ids = base.map(e => e.id);
      const ovs = await fetchTeamEventOverrides(ids);
      setOverrides(ovs);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Build merged list and carry base_start for precise RPC keys
  const occurrencesAll = useMemo(() => {
    const base = expandOccurrences(eventsBase, windowFrom, windowTo);

    const oMap = new Map();
    for (const o of overrides) {
      const key = `${o.event_id}|${new Date(o.occ_start).toISOString()}`;
      oMap.set(key, o);
    }

    const merged = [];
    for (const e of base) {
      const key = `${e.id}|${e.occ_start.toISOString()}`;
      const o = oMap.get(key);
      if (!o) {
        merged.push({ ...e, base_start: e.occ_start });
      } else {
        if (o.canceled) continue; // skip canceled
        merged.push({
          ...e,
          base_start: e.occ_start,
          title:       o.title       ?? e.title,
          description: o.description ?? e.description,
          location:    o.location    ?? e.location,
          tz:          o.tz          ?? e.tz,
          occ_start:   o.starts_at ? new Date(o.starts_at) : e.occ_start,
          occ_end:     o.ends_at   ? new Date(o.ends_at)   : e.occ_end,
          category:    o.category    ?? e.category,
        });
      }
    }

    // de-dupe & sort
    const map = new Map();
    merged.forEach(m => map.set(`${m.id}|${m.occ_start.getTime()}`, m));
    const arr = [...map.values()];
    arr.sort((a,b) => a.occ_start - b.occ_start);
    return arr;
  }, [eventsBase, overrides, windowFrom, windowTo]);

  // Partition by END time so ongoing "now" stays in Upcoming
  const upcomingOcc = useMemo(() => {
    const now = Date.now();
    return occurrencesAll.filter(o => o.occ_end.getTime() >= now);
  }, [occurrencesAll]);

  const pastOccDesc = useMemo(() => {
    const now = Date.now();
    const arr = occurrencesAll.filter(o => o.occ_end.getTime() < now);
    arr.sort((a, b) => b.occ_start - a.occ_start);
    return arr;
  }, [occurrencesAll]);

  const pastSlice = useMemo(() => pastOccDesc.slice(0, pastPage), [pastOccDesc, pastPage]);
  const pastHasMore = pastOccDesc.length > pastSlice.length;
  const onPastMore = () => setPastPage(p => p + 25);

  /* ---------------------------- Helper functions ---------------------------- */

  const getEventById = useCallback(
    (eventId) => eventsBase.find(e => e.id === eventId) || null,
    [eventsBase]
  );

  const summarizeRecurrence = useCallback((e) => {
    if (!e) return "";
    if (!e.recur_freq || e.recur_freq === "none") return "one-off";
    if (e.recur_freq === "weekly") {
      const by = e.recur_byday?.length ? e.recur_byday.join(",") : DOW[e.occ_start?.getDay?.() ?? 0];
      const every = e.recur_interval || 1;
      const endStr = e.recur_until ? ` until ${new Date(e.recur_until).toLocaleDateString()}` :
        (e.recur_count ? ` for ${e.recur_count} times` : "");
      return `Every ${every} week(s) on ${by}${endStr}`;
    }
    if (e.recur_freq === "monthly") {
      const every = e.recur_interval || 1;
      let on = "same day each month";
      if (e.recur_bymonthday?.length) on = `day ${e.recur_bymonthday.join(",")}`;
      else if (e.recur_week_of_month && e.recur_day_of_week) on = `${ordinal(e.recur_week_of_month)} ${e.recur_day_of_week}`;
      const endStr = e.recur_until ? ` until ${new Date(e.recur_until).toLocaleDateString()}` :
        (e.recur_count ? ` for ${e.recur_count} times` : "");
      return `Every ${every} month(s) on ${on}${endStr}`;
    }
    return e.recur_freq;
  }, []);

  function ordinal(n) {
    if (n === -1) return "last";
    const s = ["th","st","nd","rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const countFutureOccurrencesInSeries = useCallback((eventId) => {
    const now = Date.now();
    return occurrencesAll.filter(o => o.id === eventId && o.occ_end.getTime() >= now).length;
  }, [occurrencesAll]);

  /* -------- Optional: series edit helpers (Calendar has fallbacks) --------- */

  // Apply patch to all FUTURE occurrences (>= fromBaseISO) for this series
  const applyFutureEdits = useCallback(async (eventId, fromBaseISO, patch) => {
    // client-side batch: upsert overrides for each future base occurrence
    const fromMs = new Date(fromBaseISO).getTime();
    const now = Date.now();
    const targets = occurrencesAll.filter(o =>
      o.id === eventId &&
      (o.base_start?.getTime?.() ?? o.occ_start.getTime()) >= fromMs &&
      o.occ_end.getTime() >= now
    );
    // Use RPC-like batching with multiple upserts (sequential to respect RLS)
    for (const occ of targets) {
      const baseISO = (occ.base_start || occ.occ_start).toISOString();
      // lazy import to avoid circular dep
      const { supabase } = await import("lib/supabase");
      const row = { event_id: eventId, occ_start: baseISO, canceled: false, ...patch };
      const { error } = await supabase
        .from("team_event_overrides")
        .upsert([row], { onConflict: "event_id,occ_start" });
      if (error) throw new Error(error.message);
    }
  }, [occurrencesAll]);

  // Apply patch to ENTIRE series (future only, in loaded range)
  const applySeriesEdits = useCallback(async (eventId, patch) => {
    const now = Date.now();
    const targets = occurrencesAll.filter(o =>
      o.id === eventId && o.occ_end.getTime() >= now
    );
    for (const occ of targets) {
      const baseISO = (occ.base_start || occ.occ_start).toISOString();
      const { supabase } = await import("lib/supabase");
      const row = { event_id: eventId, occ_start: baseISO, canceled: false, ...patch };
      const { error } = await supabase
        .from("team_event_overrides")
        .upsert([row], { onConflict: "event_id,occ_start" });
      if (error) throw new Error(error.message);
    }
  }, [occurrencesAll]);

  return {
    loading,
    occurrencesAll,
    upcomingOcc,
    pastOccDesc,
    pastSlice,
    pastHasMore,
    onPastMore,
    refresh,

    // helpers
    getEventById,
    summarizeRecurrence,
    countFutureOccurrencesInSeries,
    applyFutureEdits,
    applySeriesEdits,
  };
}
