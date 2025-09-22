// src/teams/components/CalendarPanel.jsx
import { useMemo, useState, useEffect } from "react";
import { Button, GhostButton, DangerButton, Label, Input, Textarea, ErrorText, InfoText, Row } from "components/ui";
import { useAuth } from "auth/AuthContext";
import useCalendarData from "../hooks/useCalendarData";
import { composeStartEndISO, splitLocal, fmtRangeLocal, browserTZ } from "../utils/datetime";
import { parseRRule, expandBaseOccurrences } from "../../calendar/expandOccurrences";
import { deleteEventOverrideRPC, listAttendance, setAttendance, listGroupStaffCandidates, getEventStaffDefaults, getEventStaffInstance } from "../teams.api";

const CATEGORIES = ["rehearsal", "social", "performance"];
const TYPE_META = {
  rehearsal: { icon: "🎭", label: "Rehearsal" },
  social: { icon: "🎉", label: "Social" },
  performance: { icon: "🎤", label: "Performance" },
};
const FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const BYDAY = ["MO","TU","WE","TH","FR","SA","SU"];

const styles = {
  select: {
    background: "#0f0f14",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
  },
  panel: { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 12, marginBottom: 16 },
  titleLink: { cursor: "pointer", textDecoration: "underline", fontWeight: 600 },
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ------------------------------- Estimators ------------------------------- */
/** Estimate number of occurrences from a local start (date+time) until local end date (inclusive), interval=1. */
function estimateUntilCount({ recurFreq, startDate, startTime, untilDate, byday, byMonthday, weekOfMonth, interval = 1 }) {
  if (!untilDate || !startDate || !startTime) return null;
  const pad = (n)=> String(n).padStart(2,"0");
  const start = new Date(`${startDate}T${startTime}:00`);      // local
  const until = new Date(`${untilDate}T23:59:59`);             // inclusive
  if (Number.isNaN(start) || Number.isNaN(until)) return null;
  if (until < start) return 0;

  const dayMs = 24*60*60*1000;

  const DOW = ["SU","MO","TU","WE","TH","FR","SA"];
  const nthWeekdayOfMonth = (y, m, weekday, nth) => {
    if (nth > 0) {
      const first = new Date(y, m, 1);
      const delta = (weekday - first.getDay() + 7) % 7;
      const day = 1 + delta + (nth - 1)*7;
      return new Date(y, m, day);
    }
    const last = new Date(y, m + 1, 0);
    const delta = (last.getDay() - weekday + 7) % 7;
    const day = last.getDate() - delta;
    return new Date(y, m, day);
  };

  let count = 0;
  const bailIfTooMany = () => count > 12;

  if (recurFreq === "daily") {
    count = Math.floor((Date.UTC(until.getFullYear(), until.getMonth(), until.getDate()) -
                        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / dayMs) + 1;
    return count;
  }

  if (recurFreq === "weekly") {
    const intervalWeeks = Math.max(1, Number(interval) || 1);
    const set = new Set((Array.isArray(byday) && byday.length ? byday : [DOW[start.getDay()] ]));
    const cur = new Date(start);
    const weekAnchor = (d) => {
      const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dow = a.getDay(); // 0=Sun..6=Sat
      const delta = (dow === 0 ? -6 : 1 - dow); // shift to Monday
      a.setDate(a.getDate() + delta);
      a.setHours(0,0,0,0);
      return a;
    };
    const startWeekAnchor = weekAnchor(start);
    while (cur <= until) {
      if (set.has(DOW[cur.getDay()])) {
        const curWeekAnchor = weekAnchor(cur);
        const diffWeeks = Math.floor((curWeekAnchor - startWeekAnchor) / (7 * 24 * 60 * 60 * 1000));
        if (diffWeeks % intervalWeeks !== 0) { cur.setDate(cur.getDate()+1); continue; }
        // same clock time as 'start'
        const occ = new Date(cur);
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (occ >= start && occ <= until) { count++; if (bailIfTooMany()) return count; }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  if (recurFreq === "monthly") {
    const startMonthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonthStart = new Date(until.getFullYear(), until.getMonth(), 1);
    const monthsSpan = (endMonthStart.getFullYear() - startMonthStart.getFullYear()) * 12 +
                       (endMonthStart.getMonth() - startMonthStart.getMonth());
    const step = Math.max(1, Number(interval) || 1);
    for (let i=0; i<=monthsSpan; i+=step) {
      const y = startMonthStart.getFullYear() + Math.floor((startMonthStart.getMonth() + i)/12);
      const m = (startMonthStart.getMonth() + i) % 12;

      let occDate = null;
      if (byMonthday) {
        const last = new Date(y, m + 1, 0).getDate();
        occDate = new Date(y, m, Math.min(Number(byMonthday), last));
      } else if (weekOfMonth && Array.isArray(byday) && byday.length === 1) {
        const wd = DOW.indexOf(byday[0]);
        if (wd >= 0) occDate = nthWeekdayOfMonth(y, m, wd, Number(weekOfMonth));
      } else {
        // default same day-of-month as start
        occDate = new Date(y, m, start.getDate());
      }

      if (occDate) {
        const occ = new Date(occDate);
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (occ >= start && occ <= until) { count++; if (bailIfTooMany()) return count; }
      }
    }
    return count;
  }

  // "none" or unknown
  return 1;
}

/* ------------------------------ Validators ------------------------------ */
function validateRecurrence({ recurrenceMode, recurFreq, endUntilDate, endCount, recurByday, recurByMonthday, recurWeekOfMonth, occEstimate }) {
  const errs = [];
  if (recurrenceMode === "none") return errs;

  if (recurrenceMode === "until") {
    if (!endUntilDate) errs.push("Please choose an 'Until' date.");
    if (occEstimate != null && occEstimate > 12) errs.push(`The chosen "Until" date generates ${occEstimate} occurrences (max 12). Choose an earlier date or switch to Count.`);
  } else if (recurrenceMode === "count") {
    const n = Number(endCount);
    if (!n || n < 1 || n > 12) errs.push("Count must be between 1 and 12.");
  }

  if (recurFreq === "weekly" && (!Array.isArray(recurByday) || recurByday.length === 0)) {
    errs.push("Pick at least one weekday for weekly recurrence.");
  }

  if (recurFreq === "monthly") {
    const byDayOk = !!(recurByMonthday && Number(recurByMonthday) >= 1 && Number(recurByMonthday) <= 31);
    const womOk = !!(recurWeekOfMonth && Number(recurWeekOfMonth) >= -1 && Number(recurWeekOfMonth) <= 4 && Array.isArray(recurByday) && recurByday.length === 1);
    if (!byDayOk && !womOk) errs.push("For monthly recurrence, set a month-day or a week-of-month with one weekday.");
  }

  return errs;
}
function validateTimes({ title, startDate, startTime, endTime }) {
  const errs = [];
  if (!title?.trim()) errs.push("Title is required.");
  if (!startDate) errs.push("Start date is required.");
  if (!startTime) errs.push("Start time is required.");
  if (!endTime) errs.push("End time is required.");
  // Disallow end time earlier than or equal to start time on the same day
  if (startTime && endTime && startDate) {
    // 'HH:MM' string comparison is safe here
    if (endTime <= startTime) errs.push("End time must be after start time.");
  }
  return errs;
}

/* -------------------------------- Component ------------------------------- */
export default function CalendarPanel({ team }) {
  const { displayName } = useAuth();
  const tz = browserTZ();
  const today = new Date();
  const windowStartIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const windowEndIso   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 120).toISOString();

  const {
    loading, err, occurrences, events,
    createBase, updateBase, deleteBase,
    editOccurrence, cancelOccurrence, clearOccurrenceOverride,
  } = useCalendarData(team?.id, windowStartIso, windowEndIso);

  const upcoming = useMemo(() => occurrences, [occurrences]);

  // Legacy show-bookings/invitations removed; prototype calendar shows only group-owned events
  const [invErr, setInvErr] = useState("");

  // ---------- Attendance (safe integration) ----------
  // Map key: `${event_id}|${occ_start ISO}` -> [{ name, isMe }]
  const [attendanceMap, setAttendanceMap] = useState(new Map());

  const loadAttendance = async () => {
    if (!team?.id) return;
    try {
      const rows = await listAttendance(team.id, windowStartIso, windowEndIso);
      const map = new Map();
     (rows || [])
       .filter(r => r.attending)
       .forEach(r => {
         const k = `${r.event_id}|${new Date(r.occ_start).toISOString()}`;
         const arr = map.get(k) || [];
         // Prefer auth display name for self; otherwise fall back to server-provided name.
         // If the server provided an email-like string, show the part before '@' (avoid full emails).
         let n = r.full_name || "Unknown";
         if (r._is_me && displayName) {
           n = displayName;
         } else if (typeof n === 'string' && n.includes('@')) {
           n = n.split('@')[0];
         }
         arr.push({ name: n, isMe: !!r._is_me });
         map.set(k, arr);
       });
     setAttendanceMap(map);
    } catch (e) {
      // Don't break the page if the view isn't ready
      console.warn("attendance load failed:", e?.message || e);
      setAttendanceMap(new Map());
    }
  };

  useEffect(() => { loadAttendance(); },
    [team?.id, windowStartIso, windowEndIso, occurrences?.length]);

  const toggleAttendance = async (occ) => {
    try {
      const key = `${occ.event_id}|${occ.base_start}`;
      const arr = attendanceMap.get(key) || [];
      const mine = arr.some(a => a.isMe);
      await setAttendance(occ.event_id, occ.base_start, !mine);
      await loadAttendance();
    } catch (e) {
      console.warn("attendance toggle failed:", e?.message || e);
    }
  };
  // ---------------------------------------------------

  const [mode, setMode] = useState("list"); // 'list' | 'create' | 'editSeries' | 'editOcc'
  const [banner, setBanner] = useState("");
  const [bannerErr, setBannerErr] = useState("");
  const [openDescKeys, setOpenDescKeys] = useState(() => new Set());
  const [orphanFix, setOrphanFix] = useState(null); // { eventId, items:[{recurrence_id, display, suggestRid}] }

  const now = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  const defaultStartDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const defaultStartTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const defaultEndTime   = `${pad((now.getHours()+1)%24)}:${pad(now.getMinutes())}`;
  const mapsHref = (loc) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`;

  /* -------------------------------- Create -------------------------------- */
  const [cTitle, setCTitle] = useState("");
  const [cDescription, setCDescription] = useState("");
  const [cLocation, setCLocation] = useState("");
  const [cCategory, setCCategory] = useState("rehearsal");
  const [cStartDate, setCStartDate] = useState(defaultStartDate);
  const [cStartTime, setCStartTime] = useState(defaultStartTime);
  const [cEndTime, setCEndTime]     = useState(defaultEndTime);

  const [cFreq, setCFreq] = useState("none");
  const [cByday, setCByday] = useState(["MO"]);
  const [cByMonthday, setCByMonthday] = useState(0);
  const [cWeekOfMonth, setCWeekOfMonth] = useState(0);
  const [cInterval, setCInterval] = useState(1);
  const [cEndMode, setCEndMode] = useState("count"); // 'until'|'count'
  const [cUntilDate, setCUntilDate] = useState("");
  const [cCount, setCCount] = useState(6);

  const cUntilEstimate = useMemo(() => cFreq === "none" || cEndMode !== "until" ? null : estimateUntilCount({
    recurFreq: cFreq, startDate: cStartDate, startTime: cStartTime, untilDate: cUntilDate,
    byday: cByday, byMonthday: cByMonthday, weekOfMonth: cWeekOfMonth, interval: cInterval,
  }), [cFreq, cEndMode, cStartDate, cStartTime, cUntilDate, cByday, cByMonthday, cWeekOfMonth, cInterval]);

  const cRecurrenceErrors = useMemo(() => validateRecurrence({
    recurrenceMode: cFreq === "none" ? "none" : (cEndMode === "until" ? "until" : "count"),
    recurFreq: cFreq, endUntilDate: cUntilDate, endCount: cCount,
    recurByday: cByday, recurByMonthday: cByMonthday, recurWeekOfMonth: cWeekOfMonth,
    occEstimate: cUntilEstimate,
  }), [cFreq, cEndMode, cUntilDate, cCount, cByday, cByMonthday, cWeekOfMonth, cUntilEstimate]);

  const cTimeErrors = useMemo(() => validateTimes({
    title: cTitle, startDate: cStartDate, startTime: cStartTime, endTime: cEndTime,
  }), [cTitle, cStartDate, cStartTime, cEndTime]);

  const canSaveCreate = useMemo(() => {
    if (cTimeErrors.length) return false;
    if (cFreq !== "none" && cRecurrenceErrors.length) return false;
    return true;
  }, [cTimeErrors, cRecurrenceErrors, cFreq]);

  const startCreate = () => { setBanner(""); setBannerErr(""); setMode("create"); };
  const cancelCreate = () => { setMode("list"); };

  const submitCreate = async () => {
    if (!canSaveCreate) return;
    setBanner(""); setBannerErr("");
    try {
      const { startIso, endIso } = composeStartEndISO(cStartDate, cStartTime, cEndTime);
      let recur_until = null, recur_count = null;
      if (cFreq !== "none") {
        if (cEndMode === "until") recur_until = new Date(`${cUntilDate}T23:59:59`).toISOString();
        else recur_count = Math.max(1, Math.min(Number(cCount) || 1, 12));
      }
      await createBase({
        title: cTitle.trim(),
        description: cDescription.trim(),
        location: cLocation.trim(),
        category: cCategory,
        tz,
        starts_at: startIso,
        ends_at: endIso,
        recur_freq: cFreq,
        recur_interval: Math.max(1, Number(cInterval) || 1),
        recur_byday: cFreq === "weekly" ? cByday : null,
        recur_bymonthday: cFreq === "monthly" && cByMonthday ? Number(cByMonthday) : null,
        recur_week_of_month: cFreq === "monthly" && cWeekOfMonth ? Number(cWeekOfMonth) : null,
        recur_until,
        recur_count,
      });
      // reset & close
      setCTitle(""); setCDescription(""); setCLocation(""); setCCategory("rehearsal");
      setCStartDate(defaultStartDate); setCStartTime(defaultStartTime); setCEndTime(defaultEndTime);
      setCFreq("none"); setCByday(["MO"]); setCByMonthday(0); setCWeekOfMonth(0); setCInterval(1);
      setCEndMode("count"); setCUntilDate(""); setCCount(6);
      setMode("list");
      setBanner("Event created.");
    } catch (e) { setBannerErr(e.message || "Failed to create event"); }
  };

  /* ------------------------------ Edit Series ------------------------------ */
  const [sEd, setSEd] = useState(null);
  const [sEndTouched, setSEndTouched] = useState(false);
  const [sRecurrenceMode, setSRecurrenceMode] = useState("none"); // 'none'|'until'|'count'
  const [seriesStaff, setSeriesStaff] = useState([]);
  const [staffCandidates, setStaffCandidates] = useState([]);

  const openEditSeries = (eventId) => {
    const e = events.find((x) => x.id === eventId);
    if (!e) { setBannerErr("Could not load event."); return; }

    // sane defaults
    let recur_byday = e.recur_byday;
    if (e.recur_freq === "weekly" && (!Array.isArray(recur_byday) || recur_byday.length === 0)) {
      const DOW = ["SU","MO","TU","WE","TH","FR","SA"];
      recur_byday = [DOW[new Date(e.starts_at).getDay()]];
    }
    let recur_bymonthday = e.recur_bymonthday;
    let recur_week_of_month = e.recur_week_of_month;
    if (e.recur_freq === "monthly" && !recur_bymonthday && !recur_week_of_month) {
      recur_bymonthday = new Date(e.starts_at).getUTCDate();
    }
    // Derive recurrence fields from RRULE if present
    let recur_freq = e.recur_freq || "none";
    let recur_interval = 1;
    let recur_until = e.recur_until || null;
    let recur_count = e.recur_count || null;
    if (e.rrule) {
      const rule = parseRRule(e.rrule);
      if (rule && rule.freq) {
        recur_freq = rule.freq.toLowerCase();
        recur_interval = rule.interval || 1;
        if (rule.until) recur_until = rule.until.toISOString();
        if (rule.count) recur_count = rule.count;
        if (rule.freq === 'WEEKLY') {
          recur_byday = Array.isArray(rule.byday) && rule.byday.length ? rule.byday : recur_byday;
        }
        if (rule.freq === 'MONTHLY') {
          // Prefer inline BYMONTHDAY if present
          if (Array.isArray(rule.bymonthday) && rule.bymonthday.length) {
            recur_bymonthday = rule.bymonthday[0];
          }
        }
      }
    }
    const mode = (recur_freq === "none") ? "none" : (recur_until ? "until" : (recur_count ? "count" : "count"));

    const durationMin = Math.max(1, Math.round((new Date(e.ends_at) - new Date(e.starts_at)) / 60000));
    setSEd({
      ...e,
      recur_byday,
      recur_bymonthday,
      recur_week_of_month,
      recur_interval,
      recur_until,
      recur_count,
      _s: splitLocal(e.starts_at),
      _e: splitLocal(e.ends_at),
      _durMin: durationMin,
    });
    setSEndTouched(false);
    setSRecurrenceMode(mode);
    setBanner(""); setBannerErr("");
    setMode("editSeries");
    // Load staff + candidates for this group/event
    (async()=>{
      try {
        const [cands, rows] = await Promise.all([
          team?.id ? listGroupStaffCandidates(team.id) : Promise.resolve([]),
          getEventStaffDefaults(eventId),
        ]);
        setStaffCandidates(cands || []);
        setSeriesStaff((rows || []).map(r => ({ owner_id: r.owner_id, role: r.role, billing_name: r.billing_name || '', billing_ord: r.billing_ord || null, notes: r.notes || '' })));
      } catch(e) {
        console.warn('load staff defaults failed', e);
        setStaffCandidates([]); setSeriesStaff([]);
      }
    })();
  };
  const cancelEditSeries = () => { setSEd(null); setMode("list"); };

  const sUntilEstimate = useMemo(() => {
    if (!sEd || sRecurrenceMode !== "until") return null;
    const untilDate = sEd.recur_until ? splitLocal(sEd.recur_until).date : "";
    return estimateUntilCount({
      recurFreq: sEd.recur_freq || "none",
      startDate: sEd._s.date,
      startTime: sEd._s.time,
      untilDate,
      byday: sEd.recur_byday,
      byMonthday: sEd.recur_bymonthday,
      weekOfMonth: sEd.recur_week_of_month,
      interval: sEd.recur_interval || 1,
    });
  }, [sEd, sRecurrenceMode]);

  const sTimeErrors = useMemo(() => {
    if (!sEd) return [];
    return validateTimes({ title: sEd.title, startDate: sEd._s.date, startTime: sEd._s.time, endTime: sEd._e.time });
  }, [sEd]);

  const sRecurrenceErrors = useMemo(() => {
    if (!sEd) return [];
    const untilDate = sEd?.recur_until ? splitLocal(sEd.recur_until).date : "";
    return validateRecurrence({
      recurrenceMode: sRecurrenceMode,
      recurFreq: sEd.recur_freq || "none",
      endUntilDate: untilDate,
      endCount: sEd.recur_count || "",
      recurByday: sEd.recur_byday,
      recurByMonthday: sEd.recur_bymonthday,
      recurWeekOfMonth: sEd.recur_week_of_month,
      occEstimate: sUntilEstimate,
    });
  }, [sEd, sRecurrenceMode, sUntilEstimate]);

  const canSaveSeries = useMemo(() => {
    if (!sEd) return false;
    if (sTimeErrors.length) return false;
    if (sRecurrenceMode !== "none" && sRecurrenceErrors.length) return false;
    return true;
  }, [sEd, sTimeErrors, sRecurrenceMode, sRecurrenceErrors]);

  const saveEditSeries = async () => {
    if (!canSaveSeries || !sEd) return;
    setBanner(""); setBannerErr("");
    try {
      // Map UI mode to payload
      let recur_freq = sEd.recur_freq || "none";
      let recur_until = null;
      let recur_count = null;
      let recur_byday = null, recur_bymonthday = null, recur_week_of_month = null;

      if (sRecurrenceMode === "none") {
        recur_freq = "none";
      } else if (sRecurrenceMode === "until") {
        recur_freq = recur_freq === "none" ? "weekly" : recur_freq;
        // keep user's chosen rule fields
        recur_until = sEd.recur_until || null;
        if (recur_freq === "weekly") recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
        if (recur_freq === "monthly") {
          recur_bymonthday = sEd.recur_bymonthday || null;
          recur_week_of_month = sEd.recur_week_of_month || null;
          recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
        }
      } else if (sRecurrenceMode === "count") {
        // If count <= 1 => remove recurrence entirely
        const n = Math.max(1, Math.min(Number(sEd.recur_count) || 1, 12));
        if (n <= 1) {
          recur_freq = "none";
        } else {
          recur_freq = recur_freq === "none" ? "weekly" : recur_freq;
          recur_count = n;
          if (recur_freq === "weekly") recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
          if (recur_freq === "monthly") {
            recur_bymonthday = sEd.recur_bymonthday || null;
            recur_week_of_month = sEd.recur_week_of_month || null;
            recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
          }
        }
      }
      const { startIso, endIso } = composeStartEndISO(sEd._s.date, sEd._s.time, sEd._e.time);

      await updateBase(sEd.id, {
        title: sEd.title ?? "",
        description: sEd.description ?? "",
        location: sEd.location ?? "",
        category: sEd.category ?? "rehearsal",
        tz: sEd.tz || tz,
        starts_at: startIso,
        ends_at: endIso,
        recur_freq,
        recur_interval: Math.max(1, Number(sEd.recur_interval) || 1),
        recur_byday,
        recur_bymonthday,
        recur_week_of_month,
        recur_until,
        recur_count,
        staff_defaults: seriesStaff,
      });

      cancelEditSeries();
      setBanner(recur_freq === "none" ? "Event updated (recurrence removed)." : "Event updated.");
      // After update, reload and check for orphan overrides for this series
      try {
        await reload();
        const ev = events.find(e => e.id === sEd.id);
        if (ev) {
          const base = expandBaseOccurrences(ev, windowStartIso, windowEndIso, { hardCap: 500 });
          const baseSet = new Set((base || []).map(b => new Date(b.recurrence_id).toISOString()));
          const orphans = (overrides || []).filter(o => o.parent_event_id === sEd.id && !baseSet.has(new Date(o.recurrence_id).toISOString()));
          if (orphans.length) {
            // Build suggestions: nearest base occurrence to current override dtstart or recurrence_id
            const baseDates = (base || []).map(b => new Date(b.recurrence_id).getTime());
            const items = orphans.map(o => {
              const cur = new Date(o.dtstart || o.recurrence_id).getTime();
              let best = null, bestDiff = Infinity;
              for (const t of baseDates) { const d = Math.abs(t - cur); if (d < bestDiff) { bestDiff = d; best = t; } }
              return {
                recurrence_id: new Date(o.recurrence_id).toISOString(),
                display: new Date(o.dtstart || o.recurrence_id).toLocaleString(),
                suggestRid: best ? new Date(best).toISOString() : null,
              };
            });
            setOrphanFix({ eventId: sEd.id, items });
          }
        }
      } catch (e) {
        console.warn('orphan check failed', e);
      }
    } catch (e) {
      setBannerErr(e.message || "Failed to update event");
    }
  };

  const deleteSeries = async () => {
    if (!sEd) return;
    if (!window.confirm("Delete this entire event/series?")) return;
    setBanner(""); setBannerErr("");
    try {
      await deleteBase(sEd.id);
      cancelEditSeries();
      setBanner("Event deleted.");
    } catch (e) { setBannerErr(e.message || "Failed to delete event"); }
  };

  /* ----------------------------- Edit Occurrence ---------------------------- */
  const [oEd, setOEd] = useState(null);
  const [instanceStaff, setInstanceStaff] = useState([]);
  const openEditOccurrence = (occ) => {
    const s = splitLocal(occ.starts_at);
    const e = splitLocal(occ.ends_at);
    setOEd({
      event_id: occ.event_id,
      base_start: occ.base_start,
      title: occ.title || "",
      description: occ.description || "",
      location: occ.location || "",
      category: occ.category || "rehearsal",
      _sDate: s.date,
      _sTime: s.time,
      _eTime: e.time,
      overridden: !!occ.overridden,
    });
    setBanner(""); setBannerErr("");
    setMode("editOcc");
    // Load instance-level staff rows
    (async()=>{
      try {
        const [cands, rows] = await Promise.all([
          team?.id ? listGroupStaffCandidates(team.id) : Promise.resolve([]),
          getEventStaffInstance(occ.event_id, occ.base_start),
        ]);
        setStaffCandidates(cands || []);
        setInstanceStaff((rows || []).map(r => ({ owner_id: r.owner_id, role: r.role, billing_name: r.billing_name || '', billing_ord: r.billing_ord || null, notes: r.notes || '' })));
      } catch(e) { console.warn('load instance staff failed', e); setInstanceStaff([]); }
    })();
  };
  const cancelEditOccurrence = () => { setOEd(null); setMode("list"); };

  const oTimeErrors = useMemo(() => {
    if (!oEd) return [];
    return validateTimes({ title: oEd.title, startDate: oEd._sDate, startTime: oEd._sTime, endTime: oEd._eTime });
  }, [oEd]);
  const canSaveOccurrence = useMemo(() => !oEd ? false : oTimeErrors.length === 0, [oEd, oTimeErrors]);

  const saveEditOccurrence = async () => {
    if (!canSaveOccurrence || !oEd) return;
    setBanner(""); setBannerErr("");
    try {
      const { startIso, endIso } = composeStartEndISO(oEd._sDate, oEd._sTime, oEd._eTime);
      await editOccurrence(oEd.event_id, oEd.base_start, {
        title: oEd.title.trim(),
        description: oEd.description.trim(),
        location: oEd.location.trim(),
        category: oEd.category,
        tz,
        starts_at: startIso,
        ends_at: endIso,
        instance_staff: instanceStaff,
      });
      cancelEditOccurrence();
      setBanner("Occurrence updated.");
    } catch (e) { setBannerErr(e.message || "Failed to update occurrence"); }
  };

  const cancelOne = async () => {
    if (!oEd) return;
    if (!window.confirm("Cancel just this occurrence?")) return;
    setBanner(""); setBannerErr("");
    try {
      await cancelOccurrence(oEd.event_id, oEd.base_start);
      cancelEditOccurrence();
      setBanner("Occurrence canceled.");
    } catch (e) { setBannerErr(e.message || "Failed to cancel occurrence"); }
  };

  const clearOneOverride = async () => {
    if (!oEd) return;
    setBanner(""); setBannerErr("");
    try {
      await clearOccurrenceOverride(oEd.event_id, oEd.base_start);
      cancelEditOccurrence();
      setBanner("Occurrence override cleared.");
    } catch (e) { setBannerErr(e.message || "Failed to clear override"); }
  };

  /* ------------------------------ Helpers/UI ------------------------------- */
  const toggleDesc = (key) => {
    setOpenDescKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  /* -------------------------------- Render --------------------------------- */
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Calendar</h3>
        {mode === "list" && (
          <GhostButton onClick={() => { setBanner(""); setBannerErr(""); setMode("create"); }} style={{ padding: "6px 10px" }}>
            + New event
          </GhostButton>
        )}
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0 12px" }} />
      {err && <ErrorText>{err}</ErrorText>}
      {bannerErr && <ErrorText>{bannerErr}</ErrorText>}
      {banner && <InfoText>{banner}</InfoText>}
      {orphanFix && orphanFix.items?.length > 0 && (
        <div style={{ border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Some edited occurrences no longer match the series</div>
          <div style={{ opacity: 0.85, marginBottom: 8 }}>These overrides no longer align with the series. Dates shown are the override's actual occurrence time. You can prune them to revert to the series.</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {orphanFix.items.map((it, idx) => (
              <li key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems:'center', padding: '4px 0' }}>
                <span>{it.display}</span>
              </li>
            ))}
          </ul>
          <Row style={{ marginTop: 8 }}>
            <Button onClick={async ()=>{
              if (!window.confirm(`Prune ${orphanFix.items.length} override(s)? This will remove their custom edits and revert to the series.`)) return;
              try {
                for (const it of orphanFix.items) {
                  await deleteEventOverrideRPC(orphanFix.eventId, it.recurrence_id);
                }
                await reload();
                setOrphanFix(null);
                setBanner('Orphan overrides pruned.');
              } catch(e) { setBannerErr(e?.message||'Failed to prune'); }
            }}>Prune all</Button>
            <GhostButton onClick={()=> setOrphanFix(null)}>Ignore</GhostButton>
          </Row>
        </div>
      )}

      {/* New event button moved to header */}

      {/* CREATE */}
      {mode === "create" && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.8 }}>Create event</h4>

          {cTimeErrors.concat(cFreq !== "none" ? cRecurrenceErrors : []).length > 0 && (
            <ErrorText>
              {cTimeErrors.concat(cFreq !== "none" ? cRecurrenceErrors : []).map((e,i)=><div key={i}>• {e}</div>)}
            </ErrorText>
          )}

          <Row>
            <Input placeholder="Title" value={cTitle} onChange={(e)=>setCTitle(e.target.value)} style={{ minWidth: 220 }} />
            <Input placeholder="Location" value={cLocation} onChange={(e)=>setCLocation(e.target.value)} style={{ minWidth: 180 }} />
            <select value={cCategory} onChange={(e)=>setCCategory(e.target.value)} style={styles.select}>
              {CATEGORIES.map((c)=> <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </Row>
          <Row>
            <Textarea placeholder="Description" value={cDescription} onChange={(e)=>setCDescription(e.target.value)} maxLength={500} rows={3} style={{ minWidth: 500 }} />
          </Row>

          <Row>
            <Input type="date" value={cStartDate} onChange={(e)=>setCStartDate(e.target.value)} />
            <Input type="time" value={cStartTime} onChange={(e)=>setCStartTime(e.target.value)} />
            <span style={{ alignSelf:"center", opacity:0.7 }}>→</span>
            <Input type="time" value={cEndTime} onChange={(e)=>setCEndTime(e.target.value)} />
          </Row>

          <Row>
            <Label>
              Frequency
              <select value={cFreq} onChange={(e)=>setCFreq(e.target.value)} style={styles.select}>
                {FREQUENCIES.map((f)=> <option key={f} value={f}>{cap(f)}</option>)}
              </select>
            </Label>

            {cFreq === "weekly" && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                {BYDAY.map((d)=> {
                  const chk = cByday.includes(d);
                  return (
                    <label key={d} style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                      <input type="checkbox" checked={chk} onChange={()=> setCByday(chk ? cByday.filter(x=>x!==d) : [...cByday, d].sort()) } />
                      <span>{d}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {cFreq === "monthly" && (
              <Row>
                <Label>
                  By month-day
                  <Input type="number" min={1} max={31} value={cByMonthday} onChange={(e)=>setCByMonthday(e.target.value)} style={{ width: 120 }} />
                </Label>
                <Label>
                  or week-of-month (1..4, -1=last)
                  <Input type="number" min={-1} max={4} value={cWeekOfMonth} onChange={(e)=>setCWeekOfMonth(e.target.value)} style={{ width: 140 }} />
                </Label>
                <Label>
                  Weekday
                  <select value={cByday[0] || "MO"} onChange={(e)=>setCByday([e.target.value])} style={styles.select}>
                    {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                  </select>
                </Label>
              </Row>
            )}
          </Row>

          {cFreq !== "none" && (
            <Row>
              <Label>
                Every
                <Input type="number" min={1} max={12} value={cInterval}
                       onChange={(e)=> setCInterval(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                       style={{ width: 90 }} />
                <span style={{ marginLeft: 6 }}>
                  {cFreq === 'weekly' ? (cInterval === 1 ? 'week' : 'weeks') : (cFreq === 'monthly' ? (cInterval === 1 ? 'month' : 'months') : 'intervals')}
                </span>
              </Label>
              <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
                <input type="radio" name="c_endmode" checked={cEndMode==="until"} onChange={()=>setCEndMode("until")} />
                <span>Until</span>
              </label>
              {cEndMode==="until" && <Input type="date" value={cUntilDate} onChange={(e)=>setCUntilDate(e.target.value)} />}
              <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
                <input type="radio" name="c_endmode" checked={cEndMode==="count"} onChange={()=>setCEndMode("count")} />
                <span>After</span>
              </label>
              {cEndMode==="count" && (
                <>
                  <Input type="number" min={1} max={12} value={cCount}
                    onChange={(e)=>setCCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ width: 100 }} />
                  <span style={{ alignSelf:"center", opacity:0.8 }}>occurrences (max 12)</span>
                </>
              )}
            </Row>
          )}

          <Row>
            <Button onClick={submitCreate} disabled={!canSaveCreate}>Create</Button>
            <GhostButton onClick={cancelCreate}>Cancel</GhostButton>
          </Row>
        </div>
      )}

      {/* MANAGE SERIES / EVENT (series-level editor) */}
      {mode === "editSeries" && sEd && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>{sRecurrenceMode === 'none' ? 'Manage Event' : 'Manage Series'}</h4>

          {/* Switch: No recurrence / Until / Count */}
          <Row>
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="s_recmod" checked={sRecurrenceMode==="none"} onChange={()=>setSRecurrenceMode("none")} />
              <span>No recurrence</span>
            </label>
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="s_recmod" checked={sRecurrenceMode==="until"} onChange={()=>setSRecurrenceMode("until")} />
              <span>Recurring · Until</span>
            </label>
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="s_recmod" checked={sRecurrenceMode==="count"} onChange={()=>setSRecurrenceMode("count")} />
              <span>Recurring · Count</span>
            </label>
          </Row>

          {/* Validation */}
          { (sTimeErrors.length || (sRecurrenceMode!=="none" && sRecurrenceErrors.length)) > 0 && (
            <ErrorText>
              {[...sTimeErrors, ...(sRecurrenceMode!=="none" ? sRecurrenceErrors : [])].map((e,i)=><div key={i}>• {e}</div>)}
            </ErrorText>
          )}

          <Row>
            {sEd.recur_freq !== 'none' && (
              <Label>
                Every
                <Input type="number" min={1} max={12} value={sEd.recur_interval || 1}
                       onChange={(e)=> setSEd({ ...sEd, recur_interval: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                       style={{ width: 90 }} />
                <span style={{ marginLeft: 6 }}>
                  {sEd.recur_freq === 'weekly' ? ((sEd.recur_interval||1) === 1 ? 'week' : 'weeks') : (sEd.recur_freq === 'monthly' ? ((sEd.recur_interval||1) === 1 ? 'month' : 'months') : 'intervals')}
                </span>
              </Label>
            )}
            <Input value={sEd.title || ""} onChange={(e)=>setSEd({ ...sEd, title: e.target.value })} />
            <Input placeholder="Location" value={sEd.location || ""} onChange={(e)=>setSEd({ ...sEd, location: e.target.value })} />
            <select value={sEd.category || "rehearsal"} onChange={(e)=>setSEd({ ...sEd, category: e.target.value })} style={styles.select}>
              {CATEGORIES.map((c)=> <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </Row>
          <Row>
            <Textarea placeholder="Description" value={sEd.description || ""} onChange={(e)=>setSEd({ ...sEd, description: e.target.value })} maxLength={500} rows={3} style={{ minWidth: 500 }} />
          </Row>

          {/* Staff: series defaults */}
          <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Staff (series defaults)</div>
            <StaffEditor staff={seriesStaff} setStaff={setSeriesStaff} candidates={staffCandidates} />
          </div>

          <Row>
            <Input type="date" value={sEd._s.date} onChange={(ev)=>{
              const newDate = ev.target.value;
              let next = { ...sEd, _s: { ...sEd._s, date: newDate } };
              if (!sEndTouched && sEd._durMin) {
                const base = new Date(`${newDate}T${sEd._s.time}:00`);
                const end = new Date(base.getTime() + sEd._durMin*60000);
                const pad = (n)=> String(n).padStart(2, '0');
                next = { ...next, _e: { ...sEd._e, time: `${pad(end.getHours())}:${pad(end.getMinutes())}` } };
              }
              setSEd(next);
            }} />
            <Input type="time" value={sEd._s.time} onChange={(ev)=>{
              const newTime = ev.target.value;
              let next = { ...sEd, _s: { ...sEd._s, time: newTime } };
              if (!sEndTouched && sEd._durMin) {
                const base = new Date(`${sEd._s.date}T${newTime}:00`);
                const end = new Date(base.getTime() + sEd._durMin*60000);
                const pad = (n)=> String(n).padStart(2, '0');
                next = { ...next, _e: { ...sEd._e, time: `${pad(end.getHours())}:${pad(end.getMinutes())}` } };
              }
              setSEd(next);
            }} />
            <span style={{ alignSelf:"center", opacity:0.7 }}>→</span>
            <Input type="time" value={sEd._e.time} onChange={(ev)=>{ setSEndTouched(true); setSEd({ ...sEd, _e: { ...sEd._e, time: ev.target.value } }); }} />
          </Row>

          {sRecurrenceMode !== "none" && (
            <>
              <Row>
                <Label>
                  Frequency
                  <select
                    value={sEd.recur_freq === "none" ? "weekly" : sEd.recur_freq}
                    onChange={(e2)=>setSEd({ ...sEd, recur_freq: e2.target.value })}
                    style={styles.select}
                  >
                    {FREQUENCIES.filter(f=>f!=="none").map((f)=> <option key={f} value={f}>{cap(f)}</option>)}
                  </select>
                </Label>

                {sEd.recur_freq === "weekly" && (
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                    {BYDAY.map((d)=> {
                      const cur = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
                      const chk = cur.includes(d);
                      return (
                        <label key={d} style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                          <input
                            type="checkbox"
                            checked={chk}
                            onChange={()=>{
                              const next = chk ? cur.filter(x=>x!==d) : [...cur, d].sort();
                              setSEd({ ...sEd, recur_byday: next });
                            }}
                          />
                          <span>{d}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {sEd.recur_freq === "monthly" && (
                  <Row>
                    <Label>By month-day
                      <Input type="number" min={1} max={31} value={sEd.recur_bymonthday || 0}
                             onChange={(e2)=>setSEd({ ...sEd, recur_bymonthday: Number(e2.target.value) || null })} style={{ width: 120 }} />
                    </Label>
                    <Label>or week-of-month (1..4, -1=last)
                      <Input type="number" min={-1} max={4} value={sEd.recur_week_of_month || 0}
                             onChange={(e2)=>setSEd({ ...sEd, recur_week_of_month: Number(e2.target.value) || null })} style={{ width: 140 }} />
                    </Label>
                    <Label>Weekday
                      <select
                        value={(Array.isArray(sEd.recur_byday) && sEd.recur_byday[0]) || "MO"}
                        onChange={(e2)=>setSEd({ ...sEd, recur_byday: [e2.target.value] })}
                        style={styles.select}
                      >
                        {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                      </select>
                    </Label>
                  </Row>
                )}
              </Row>

              <Row>
                {sRecurrenceMode === "until" && (
                  <Label>Until
                    <Input
                      type="date"
                      value={sEd.recur_until ? splitLocal(sEd.recur_until).date : ""}
                      onChange={(e2)=>setSEd({ ...sEd, recur_until: e2.target.value ? new Date(`${e2.target.value}T23:59:59`).toISOString() : null })}
                    />
                  </Label>
                )}
                {sRecurrenceMode === "count" && (
                  <Label>Count (max 12)
                    <Input
                      type="number"
                      min={1} max={12}
                      value={sEd.recur_count || 6}
                      onChange={(e2)=>setSEd({ ...sEd, recur_count: Math.max(1, Math.min(12, Number(e2.target.value) || 1)) })}
                      style={{ width: 120 }}
                    />
                  </Label>
                )}
              </Row>
            </>
          )}

          <Row>
            <Button onClick={saveEditSeries} disabled={!canSaveSeries}>Save</Button>
            <GhostButton onClick={cancelEditSeries}>Cancel</GhostButton>
            <DangerButton onClick={deleteSeries}>
              {sRecurrenceMode === "none" ? "Delete event" : "Delete series"}
            </DangerButton>
          </Row>
        </div>
      )}

      {/* MANAGE SINGLE OCCURRENCE (instance-level editor) */}
      {mode === "editOcc" && oEd && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Manage Event</h4>

          {oTimeErrors.length > 0 && (
            <ErrorText>{oTimeErrors.map((e,i)=><div key={i}>• {e}</div>)}</ErrorText>
          )}

          <Row>
            <Input value={oEd.title} onChange={(e)=>setOEd({ ...oEd, title: e.target.value })} />
            <Input placeholder="Location" value={oEd.location} onChange={(e)=>setOEd({ ...oEd, location: e.target.value })} />
            <select value={oEd.category} onChange={(e)=>setOEd({ ...oEd, category: e.target.value })} style={styles.select}>
              {CATEGORIES.map((c)=> <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </Row>
          <Row>
            <Textarea placeholder="Description" value={oEd.description} onChange={(e)=>setOEd({ ...oEd, description: e.target.value })} maxLength={500} rows={3} style={{ minWidth: 500 }} />
          </Row>

          {/* Staff: occurrence-specific */}
          <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Staff (this occurrence)</div>
            <StaffEditor staff={instanceStaff} setStaff={setInstanceStaff} candidates={staffCandidates} />
          </div>
          <Row>
            <Input type="date" value={oEd._sDate} onChange={(e)=>setOEd({ ...oEd, _sDate: e.target.value })} />
            <Input type="time" value={oEd._sTime} onChange={(e)=>setOEd({ ...oEd, _sTime: e.target.value })} />
            <span style={{ alignSelf:"center", opacity:0.7 }}>→</span>
            <Input type="time" value={oEd._eTime} onChange={(e)=>setOEd({ ...oEd, _eTime: e.target.value })} />
          </Row>

          <Row>
            <Button onClick={saveEditOccurrence} disabled={!canSaveOccurrence}>Save occurrence</Button>
            {/* Clear override visible ONLY here */}
            {oEd.overridden && <GhostButton onClick={clearOneOverride}>Clear override</GhostButton>}
            <DangerButton onClick={cancelOne}>Cancel occurrence</DangerButton>
            <GhostButton onClick={cancelEditOccurrence}>Close</GhostButton>
          </Row>
        </div>
      )}

      {/* LIST */}
      {mode === "list" && (
        <>
          {/* Legacy show invitations removed in prototype schema */}

          {loading ? (
            <p style={{ opacity: 0.8 }}>Loading calendar…</p>
          ) : upcoming.length === 0 ? (
            <p style={{ opacity: 0.8 }}>No upcoming events.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {upcoming
                .sort((a,b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
                .map((occ) => {
                const series = events.find(e => e.id === occ.event_id);
                const isRecurring = !!(series && ((series.recur_freq && series.recur_freq !== "none") || series.rrule));
                const key = `${occ.event_id}|${occ.base_start}`;
                const typeMeta = TYPE_META[occ.category] || { icon: "📅", label: cap(occ.category || "event") };
                return (
                  <li
                    key={key}
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span title={typeMeta.label} aria-label={typeMeta.label} style={{ fontSize: 18, lineHeight: "20px" }}>
                        {typeMeta.icon}
                      </span>
                      <div>
                        {/* Header row: title + actions aligned */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div>
                            <div
                              style={styles.titleLink}
                              onClick={() => {
                                setOpenDescKeys(prev => {
                                  const next = new Set(prev);
                                  next.has(key) ? next.delete(key) : next.add(key);
                                  return next;
                                });
                              }}
                            >
                              {occ.title || "(untitled)"}{" "}
                              {(() => {
                                const showSeriesIndex = isRecurring && Number.isFinite(occ.occ_index) && Number.isFinite(occ.occ_total);
                                const ak = `${occ.event_id}|${occ.base_start}`;
                                const attendingCount = (attendanceMap.get(ak) || []).length;
                                return (
                                  <>
                                    {showSeriesIndex && (
                                      <span style={{ opacity: 0.7, fontSize: 12 }}>
                                        · {occ.occ_index + 1} of {occ.occ_total}
                                      </span>
                                    )}
                                    {attendingCount > 0 && (
                                      <span style={{ opacity: 0.7, fontSize: 12, marginLeft: 6 }}>
                                        · {attendingCount} attending
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                              {occ.overridden && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(edited)</span>}
                            </div>
                          </div>
                          {/* actions moved back to right column */}
                        </div>
                        <div style={{ opacity: 0.8, fontSize: 12 }}>
                          {fmtRangeLocal(occ.starts_at, occ.ends_at, occ.tz)}
                          {occ.location && (
                            <>
                              {" · "}
                              <a href={mapsHref(occ.location)} target="_blank" rel="noopener noreferrer" style={{ color: "#7aa2ff" }}>
                                📍 {occ.location}
                              </a>
                            </>
                          )}
                        </div>

                        {/* Attendance UI */}
                        {(() => {
  const ak = `${occ.event_id}|${occ.base_start}`;
  const arr = attendanceMap.get(ak) || [];
  const mine = arr.some(a => a.isMe);

  return (
    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        onClick={() => toggleAttendance(occ)}
        title={mine ? "Click to mark Not Attending" : "Click to mark Attending"}
        style={{
          border: `1px solid ${mine ? "#34d399" : "#f87171"}`,
          borderRadius: 999,
          padding: "6px 10px",
          fontSize: 12,
          cursor: "pointer",
          color: mine ? "#34d399" : "#f87171",
          background: "transparent",
        }}
      >
        {mine ? "Attending" : "Not Attending"}
      </button>

      {arr.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", opacity: 0.9 }}>
          {arr.map((a, i) => (
            <span key={i}
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                padding: "2px 6px",
                borderRadius: 6,
                fontSize: 12,
              }}>
              {a.name}{a.isMe ? " (you)" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
})()}

                        {openDescKeys.has(key) && occ.description && (
                          <div style={{ marginTop: 6, opacity: 0.9 }}>
                            {occ.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <Row>
                      {isRecurring ? (
                        <>
                        <GhostButton onClick={() => openEditSeries(occ.event_id)}>Manage Series</GhostButton>
                        <GhostButton onClick={() => openEditOccurrence(occ)}>Manage Event</GhostButton>
                      </>
                    ) : (
                        <GhostButton onClick={() => openEditSeries(occ.event_id)}>Manage Event</GhostButton>
                    )}
                    </Row>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------ Staff Editor ------------------------------ */
const ROLE_KINDS = ['performer','producer','host','promoter','crew'];
function StaffEditor({ staff, setStaff, candidates }) {
  const [selOwner, setSelOwner] = useState("");
  const [selRole, setSelRole] = useState("performer");
  const [billingName, setBillingName] = useState("");
  const [billingOrd, setBillingOrd] = useState("");

  const add = () => {
    if (!selOwner) return;
    const owner_id = selOwner;
    const role = selRole;
    const row = { owner_id, role, billing_name: billingName.trim() || null, billing_ord: billingOrd ? Number(billingOrd) : null, notes: null };
    setStaff([...(staff || []), row]);
    setSelOwner(""); setBillingName(""); setBillingOrd("");
  };

  const removeAt = (i) => setStaff((staff || []).filter((_, idx) => idx !== i));

  const nameFor = (owner_id) => {
    const c = (candidates || []).find(c => c.owner_id === owner_id);
    return c ? c.display_name : owner_id;
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={selOwner} onChange={(e) => setSelOwner(e.target.value)} style={styles.select}>
          <option value="">Select person/group…</option>
          {(candidates || []).map(c => (
            <option key={c.owner_id} value={c.owner_id}>
              {c.display_name} {c.kind === 'group' ? '(group)' : ''}
            </option>
          ))}
        </select>
        <select value={selRole} onChange={(e) => setSelRole(e.target.value)} style={styles.select}>
          {ROLE_KINDS.map(r => (
            <option key={r} value={r}>{cap(r)}</option>
          ))}
        </select>
        <Input placeholder="Billing name (optional)" value={billingName} onChange={(e) => setBillingName(e.target.value)} style={{ minWidth: 200 }} />
        <Input type="number" placeholder="Order" value={billingOrd} onChange={(e) => setBillingOrd(e.target.value)} style={{ width: 100 }} />
        <Button onClick={add} disabled={!selOwner}>Add</Button>
      </div>

      {(staff || []).length === 0 ? (
        <div style={{ opacity: 0.75, marginTop: 8 }}>No staff assigned.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
          {staff.map((r, idx) => (
            <li key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 8px', marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{nameFor(r.owner_id)}</div>
                <div style={{ opacity: 0.8, fontSize: 12 }}>
                  {cap(r.role)}
                  {r.billing_name ? ` · ${r.billing_name}` : ''}
                  {Number.isFinite(r.billing_ord) ? ` · #${r.billing_ord}` : ''}
                </div>
              </div>
              <GhostButton onClick={() => removeAt(idx)}>Remove</GhostButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
