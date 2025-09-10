// src/teams/components/CalendarPanel.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import useCalendarData from "../hooks/useCalendarData";
import { composeStartEndISO, splitLocal, fmtRangeLocal, browserTZ } from "../utils/datetime";
import { listAttendance, setAttendance } from "../teams.api";

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


const onPanelKeyDown = (e, cancelButtonId) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const btn = document.getElementById(cancelButtonId);
    if (btn) btn.click();
  }
};


/* ------------------------------- Estimators ------------------------------- */
/** Estimate number of occurrences from a local start (date+time) until local end date (inclusive), interval=1. */
function estimateUntilCount({ recurFreq, startDate, startTime, untilDate, byday, byMonthday, weekOfMonth }) {
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
    const set = new Set((Array.isArray(byday) && byday.length ? byday : [DOW[start.getDay()] ]));
    const cur = new Date(start);
    while (cur <= until) {
      if (set.has(DOW[cur.getDay()])) {
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
    for (let i=0; i<=monthsSpan; i++) {
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
  return errs;
}

const toggleAttendance = async (occ) => {
  try {
    const key = `${occ.event_id}|${occ.base_start}`;
    const arr = attendanceMap.get(key) || [];
    const mine = arr.some(a => a.isMe);
    await setAttendance(occ.event_id, occ.base_start, !mine);
    await loadAttendance();
  } catch (e) {
    console.error("attendance toggle failed:", e);
  }
};

/* -------------------------------- Component ------------------------------- */
export default function CalendarPanel({ team }) {
  const tz = browserTZ();
  const today = new Date();
  const windowStartIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const windowEndIso = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 120).toISOString();

  +// Attendance cache keyed by `${event_id}|${occ_start ISO}`
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
         arr.push({ name: r.full_name || "Unknown", isMe: !!r._is_me });
         map.set(k, arr);
       });
     setAttendanceMap(map);
   } catch (e) {
     console.error("attendance load failed:", e);
   }
 };
 
 // (Re)load when window/team changes or occurrences list changes size
 useEffect(() => { loadAttendance(); },
   [team?.id, windowStartIso, windowEndIso, occurrences?.length]);


  const {
    loading, err, occurrences, events,
    createBase, updateBase, deleteBase,
    editOccurrence, cancelOccurrence, clearOccurrenceOverride,
  } = useCalendarData(team?.id, windowStartIso, windowEndIso);

  const upcoming = useMemo(() => occurrences, [occurrences]);

  const [mode, setMode] = useState("list"); // 'list' | 'create' | 'editSeries' | 'editOcc'
  const [banner, setBanner] = useState("");
  const [bannerErr, setBannerErr] = useState("");
  const [openDescKeys, setOpenDescKeys] = useState(() => new Set());

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
  const [cMonthlyMode, setCMonthlyMode] = useState("monthday"); // 'monthday' | 'week'
  const [cEndMode, setCEndMode] = useState("count"); // 'until'|'count'
  const [cUntilDate, setCUntilDate] = useState("");
  const [cCount, setCCount] = useState(6);

  const cUntilEstimate = useMemo(() => cFreq === "none" || cEndMode !== "until" ? null : estimateUntilCount({
    recurFreq: cFreq, startDate: cStartDate, startTime: cStartTime, untilDate: cUntilDate,
    byday: cByday, byMonthday: cByMonthday, weekOfMonth: cWeekOfMonth,
  }), [cFreq, cEndMode, cStartDate, cStartTime, cUntilDate, cByday, cByMonthday, cWeekOfMonth]);

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
        recur_interval: 1,
        recur_byday: cFreq === "weekly"
           ? cByday
           : (cFreq === "monthly" && cMonthlyMode === "week" ? cByday : null),
        recur_bymonthday: cFreq === "monthly" && cMonthlyMode === "monthday" && Number(cByMonthday) ? Number(cByMonthday) : null,
        recur_week_of_month: cFreq === "monthly" && cMonthlyMode === "week" && Number(cWeekOfMonth) ? Number(cWeekOfMonth) : null,
        recur_until,
        recur_count,
      });
      // reset & close
      setCTitle(""); setCDescription(""); setCLocation(""); setCCategory("rehearsal");
      setCStartDate(defaultStartDate); setCStartTime(defaultStartTime); setCEndTime(defaultEndTime);
      setCFreq("none"); setCByday(["MO"]); setCByMonthday(0); setCWeekOfMonth(0);
      setCEndMode("count"); setCUntilDate(""); setCCount(6);
      setMode("list");
      setBanner("Event created.");
    } catch (e) { setBannerErr(e.message || "Failed to create event"); }
  };

  /* ------------------------------ Edit Series ------------------------------ */
  const [sEd, setSEd] = useState(null);
  const [sRecurrenceMode, setSRecurrenceMode] = useState("none"); // 'none'|'until'|'count'
  const [sMonthlyMode, setSMonthlyMode] = useState("monthday");   // 'monthday' | 'week'
  
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
    const mode = (e.recur_freq === "none") ? "none" : (e.recur_until ? "until" : "count");
    const initMonthlyMode = e.recur_freq === "monthly"
      ? (recur_bymonthday ? "monthday" : "week")
      : "monthday";
    setSEd({
      ...e,
      recur_byday,
      recur_bymonthday,
      recur_week_of_month,
      _s: splitLocal(e.starts_at),
      _e: splitLocal(e.ends_at),
    });
    setSRecurrenceMode(mode);
    setSMonthlyMode(initMonthlyMode);
    setBanner(""); setBannerErr("");
    setMode("editSeries");
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
       // Normalize monthly choice so only one rule is saved
       if (recur_freq === "monthly") {
       if (sMonthlyMode === "monthday") {
         recur_bymonthday = Number(sEd.recur_bymonthday) || null;
         recur_week_of_month = null;
       } else {
         recur_week_of_month = Number(sEd.recur_week_of_month) || null;
         recur_bymonthday = null;
         recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday.slice(0,1) : null;
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
        recur_interval: 1,
        recur_byday,
        recur_bymonthday,
        recur_week_of_month,
        recur_until,
        recur_count,
      });

      cancelEditSeries();
      setBanner(recur_freq === "none" ? "Event updated (recurrence removed)." : "Event updated.");
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
      <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Calendar</h3>
      {err && <ErrorText>{err}</ErrorText>}
      {bannerErr && <ErrorText>{bannerErr}</ErrorText>}
      {banner && <InfoText>{banner}</InfoText>}

      {/* New event: only show in list mode (hidden while editing) */}
      {mode === "list" && (
        <Row style={{ marginBottom: 8 }}>
          <Button onClick={() => { setBanner(""); setBannerErr(""); setMode("create"); }}>New event</Button>
        </Row>
      )}

      {/* CREATE */}
      {mode === "create" && (
        <div style={styles.panel} onKeyDown={(e)=>onPanelKeyDown(e, "create_cancel_btn")}>
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
            <Input placeholder="Description" value={cDescription} onChange={(e)=>setCDescription(e.target.value)} style={{ minWidth: 500 }} />
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
                  Mode
                  <select value={cMonthlyMode} onChange={(e)=> {
                    const v = e.target.value;
                    setCMonthlyMode(v);
                    // Clear inactive fields to avoid conflicts
                    if (v === "monthday") { setCWeekOfMonth(0); setCByday(["MO"]); }
                    if (v === "week")     { setCByMonthday(0); }
                  }} style={styles.select}>
                    <option value="monthday">By month-day</option>
                    <option value="week">Week of month</option>
                  </select>
                </Label>

                {cMonthlyMode === "monthday" ? (
                  <Label>
                    By month-day
                    <Input type="number" min={1} max={31} value={Number(cByMonthday)||0}
                           onChange={(e)=>setCByMonthday(Number(e.target.value)||0)} style={{ width: 120 }} />
                  </Label>
                ) : (
                  <>
                    <Label>
                      Week-of-month (1..4, -1=last)
                      <Input type="number" min={-1} max={4} value={Number(cWeekOfMonth)||0}
                             onChange={(e)=>setCWeekOfMonth(Number(e.target.value)||0)} style={{ width: 140 }} />
                    </Label>
                    <Label>
                      Weekday
                      <select value={cByday[0] || "MO"} onChange={(e)=>setCByday([e.target.value])} style={styles.select}>
                        {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                      </select>
                    </Label>
                  </>
                )}
              </Row>
            )}
          </Row>

          {cFreq !== "none" && (
            <Row>
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
            <GhostButton id="create_cancel_btn" onClick={cancelCreate}>Cancel</GhostButton>
          </Row>
        </div>
      )}

      {/* EDIT SERIES */}
      {mode === "editSeries" && sEd && (
        <div style={styles.panel} onKeyDown={(e)=>onPanelKeyDown(e, "series_cancel_btn")}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit event</h4>

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
            <Input value={sEd.title || ""} onChange={(e)=>setSEd({ ...sEd, title: e.target.value })} />
            <Input placeholder="Location" value={sEd.location || ""} onChange={(e)=>setSEd({ ...sEd, location: e.target.value })} />
            <select value={sEd.category || "rehearsal"} onChange={(e)=>setSEd({ ...sEd, category: e.target.value })} style={styles.select}>
              {CATEGORIES.map((c)=> <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </Row>
          <Row>
            <Input placeholder="Description" value={sEd.description || ""} onChange={(e)=>setSEd({ ...sEd, description: e.target.value })} style={{ minWidth: 500 }} />
          </Row>

          <Row>
            <Input type="date" value={sEd._s.date} onChange={(ev)=>setSEd({ ...sEd, _s: { ...sEd._s, date: ev.target.value } })} />
            <Input type="time" value={sEd._s.time} onChange={(ev)=>setSEd({ ...sEd, _s: { ...sEd._s, time: ev.target.value } })} />
            <span style={{ alignSelf:"center", opacity:0.7 }}>→</span>
            <Input type="time" value={sEd._e.time} onChange={(ev)=>setSEd({ ...sEd, _e: { ...sEd._e, time: ev.target.value } })} />
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
                     <Label>
                       Mode
                       <select value={sMonthlyMode} onChange={(e)=>{
                         const v=e.target.value; setSMonthlyMode(v);
                         // Clear inactive fields
                         if (v==="monthday") setSEd({ ...sEd, recur_week_of_month: null, recur_byday: Array.isArray(sEd.recur_byday)? sEd.recur_byday : ["MO"] });
                         if (v==="week")     setSEd({ ...sEd, recur_bymonthday: null });
                       }} style={styles.select}>
                         <option value="monthday">By month-day</option>
                         <option value="week">Week of month</option>
                       </select>
                     </Label>
 
                     {sMonthlyMode === "monthday" ? (
                       <Label>Month-day
                         <Input type="number" min={1} max={31} value={sEd.recur_bymonthday || 0}
                                onChange={(e2)=>setSEd({ ...sEd, recur_bymonthday: Number(e2.target.value) || null, recur_week_of_month: null })} style={{ width: 120 }} />
                       </Label>
                     ) : (
                       <>
                         <Label>Week-of-month (1..4, -1=last)
                           <Input type="number" min={-1} max={4} value={sEd.recur_week_of_month || 0}
                                  onChange={(e2)=>setSEd({ ...sEd, recur_week_of_month: Number(e2.target.value) || null, recur_bymonthday: null })} style={{ width: 140 }} />
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
                       </>
                    )}
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
            <GhostButton id="series_cancel_btn" onClick={cancelEditSeries}>Cancel</GhostButton>
            <DangerButton onClick={deleteSeries}>
              {sRecurrenceMode === "none" ? "Delete event" : "Delete series"}
            </DangerButton>
          </Row>
        </div>
      )}

      {/* EDIT OCCURRENCE */}
      {mode === "editOcc" && oEd && (
        <div style={styles.panel} onKeyDown={(e)=>onPanelKeyDown(e, "occ_close_btn")}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit single occurrence</h4>

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
            <Input placeholder="Description" value={oEd.description} onChange={(e)=>setOEd({ ...oEd, description: e.target.value })} style={{ minWidth: 500 }} />
          </Row>
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
            <GhostButton id="occ_close_btn" onClick={cancelEditOccurrence}>Close</GhostButton>
          </Row>
        </div>
      )}

      {/* LIST */}
      {mode === "list" && (
        <>
          {loading ? (
            <p style={{ opacity: 0.8 }}>Loading calendar…</p>
          ) : upcoming.length === 0 ? (
            <p style={{ opacity: 0.8 }}>No upcoming events.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {upcoming.map((occ) => {
                const series = events.find(e => e.id === occ.event_id);
                const isRecurring = !!(series && series.recur_freq && series.recur_freq !== "none");
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
   {Number.isFinite(occ.occ_index) && Number.isFinite(occ.occ_total) && occ.occ_total > 0 && (
     <span style={{ opacity: 0.7, fontSize: 12 }}>
       · {occ.occ_index + 1} of {occ.occ_total}
     </span>
  )}
                          {occ.overridden && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(edited)</span>}
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
                        {(() => {
  const ak = `${occ.event_id}|${occ.base_start}`;
  const arr = attendanceMap.get(ak) || [];
  const mine = arr.some(a => a.isMe);
  const names = arr.map(a => a.name);

  return (
    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Button onClick={() => toggleAttendance(occ)}>
        {mine ? "Cancel my attendance" : "I’m attending"}
      </Button>

      {names.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", opacity: 0.9 }}>
          {names.map((n, i) => (
            <span key={i}
              style={{ border: "1px solid rgba(255,255,255,0.2)", padding: "2px 6px", borderRadius: 6 }}>
              {n}
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
                          <GhostButton onClick={() => openEditSeries(occ.event_id)}>Edit series</GhostButton>
                          <GhostButton onClick={() => openEditOccurrence(occ)}>Edit occurrence</GhostButton>
                          {/* Clear override removed from list */}
                          {/* Cancel occurrence moved to edit occurrence */}
                        </>
                      ) : (
                        <>
                          <GhostButton onClick={() => openEditSeries(occ.event_id)}>Edit event</GhostButton>
                          {/* Delete event lives in edit panel */}
                        </>
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
