// src/teams/components/CalendarPanel.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import useCalendarData from "../hooks/useCalendarData";
import { composeStartEndISO, splitLocal, fmtRangeLocal, browserTZ } from "../utils/datetime";

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

function cap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

/* ----------- Occurrence estimator (caps at 13 to short-circuit) ----------- */
function dowStrToNum(s){ return ["SU","MO","TU","WE","TH","FR","SA"].indexOf(s); }
function lastDayOfMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function weekOfMonth(date){ return Math.floor((date.getDate()-1)/7)+1; }
function isLastWeekOfMonth(date){ return date.getDate()+7>lastDayOfMonth(date.getFullYear(), date.getMonth()); }
/** Returns {count, capped} where capped=true if we hit >12 and stopped early. */
function estimateUntilOccurrences({ startDate, recur_freq, byday, bymonthday, weekOfMonthNth }, untilDate){
  if (!startDate || !untilDate) return { count: 0, capped: false };
  const start = new Date(startDate+"T00:00:00"); // local
  const end = new Date(untilDate+"T23:59:59");
  if (isNaN(start) || isNaN(end) || end < start) return { count: 0, capped: false };

  let count = 0;
  const targetWeekdays = new Set((byday||[]).map(dowStrToNum).filter(n=>n>=0));
  const limit = 13; // we stop once >12

  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
    let match = false;
    if (recur_freq === "daily") {
      match = true;
    } else if (recur_freq === "weekly") {
      match = targetWeekdays.has(d.getDay());
    } else if (recur_freq === "monthly") {
      if (bymonthday) {
        match = d.getDate() === Number(bymonthday);
      } else if (weekOfMonthNth && targetWeekdays.size === 1) {
        const tgt = [...targetWeekdays][0];
        if (d.getDay() === tgt) {
          if (weekOfMonthNth === -1) {
            match = isLastWeekOfMonth(d);
          } else {
            match = weekOfMonth(d) === Number(weekOfMonthNth);
          }
        }
      }
    } else {
      // none: base event only
      match = d.getTime() === start.getTime();
    }
    if (match) {
      count += 1;
      if (count >= limit) return { count, capped: true };
    }
  }
  return { count, capped: false };
}

/* -------------------------------- Validators ------------------------------ */
function validateTimes({ title, startDate, startTime, endTime }) {
  const errs = [];
  if (!title?.trim()) errs.push("Title is required.");
  if (!startDate) errs.push("Start date is required.");
  if (!startTime) errs.push("Start time is required.");
  if (!endTime) errs.push("End time is required.");
  return errs;
}
function validateRecurrence({ recurrenceMode, recurFreq, endUntilDate, endCount, recurByday, recurByMonthday, recurWeekOfMonth, startDate }) {
  const errs = [];
  if (recurrenceMode === "none") return errs;

  if (recurrenceMode === "until") {
    if (!endUntilDate) errs.push("Please choose an 'Until' date.");
    // Live cap: if “until” would create >12, error now.
    if (endUntilDate) {
      const { count, capped } = estimateUntilOccurrences({
        startDate,
        recur_freq: recurFreq,
        byday: recurByday,
        bymonthday: recurByMonthday || null,
        weekOfMonthNth: recurWeekOfMonth || null,
      }, endUntilDate);
      if (count === 0) errs.push("Chosen 'Until' date produces 0 occurrences.");
      if (capped) errs.push("This 'Until' date would create more than 12 occurrences. Please shorten the range or use Count (≤12).");
    }
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

/* -------------------------------- Component ------------------------------- */
export default function CalendarPanel({ team }) {
  const tz = browserTZ();
  const today = new Date();
  const windowStartIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const windowEndIso = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 120).toISOString();

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
  const [cEndMode, setCEndMode] = useState("count"); // 'until'|'count'
  const [cUntilDate, setCUntilDate] = useState("");
  const [cCount, setCCount] = useState(6);

  const cTimeErrors = useMemo(() => validateTimes({
    title: cTitle, startDate: cStartDate, startTime: cStartTime, endTime: cEndTime,
  }), [cTitle, cStartDate, cStartTime, cEndTime]);

  const cRecurrenceErrors = useMemo(() => validateRecurrence({
    recurrenceMode: cFreq === "none" ? "none" : (cEndMode === "until" ? "until" : "count"),
    recurFreq: cFreq, endUntilDate: cUntilDate, endCount: cCount,
    recurByday: cByday, recurByMonthday: cByMonthday, recurWeekOfMonth: cWeekOfMonth,
    startDate: cStartDate,
  }), [cFreq, cEndMode, cUntilDate, cCount, cByday, cByMonthday, cWeekOfMonth, cStartDate]);

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
        if (cEndMode === "until") {
          // Final guard: block >12 on submit too
          const { capped } = estimateUntilOccurrences({
            startDate: cStartDate, recur_freq: cFreq, byday: cByday,
            bymonthday: cByMonthday || null, weekOfMonthNth: cWeekOfMonth || null,
          }, cUntilDate);
          if (capped) { setBannerErr("This 'Until' would create more than 12 occurrences. Please shorten the range or use Count (≤12)."); return; }
          recur_until = new Date(`${cUntilDate}T23:59:59`).toISOString();
        } else {
          recur_count = Math.max(1, Math.min(Number(cCount) || 1, 12));
        }
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
        recur_byday: cFreq === "weekly" ? cByday : null,
        recur_bymonthday: cFreq === "monthly" && cByMonthday ? Number(cByMonthday) : null,
        recur_week_of_month: cFreq === "monthly" && cWeekOfMonth ? Number(cWeekOfMonth) : null,
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

  const openEditSeries = (eventId) => {
    const e = events.find((x) => x.id === eventId);
    if (!e) { setBannerErr("Could not load event."); return; }

    // Make weekly/monthly valid defaults
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

    setSEd({
      ...e,
      recur_byday,
      recur_bymonthday,
      recur_week_of_month,
      _s: splitLocal(e.starts_at),
      _e: splitLocal(e.ends_at),
    });
    setSRecurrenceMode(mode);
    setBanner(""); setBannerErr("");
    setMode("editSeries");
  };
  const cancelEditSeries = () => { setSEd(null); setMode("list"); };

  const sTimeErrors = useMemo(() => {
    if (!sEd) return [];
    return validateTimes({ title: sEd.title, startDate: sEd._s.date, startTime: sEd._s.time, endTime: sEd._e.time });
  }, [sEd]);

  const sRecurrenceErrors = useMemo(() => {
    if (!sEd) return [];
    const untilDate = sRecurrenceMode === "until" ? (sEd.recur_until ? splitLocal(sEd.recur_until).date : "") : "";
    const countVal = sRecurrenceMode === "count" ? (sEd.recur_count || "") : "";
    const freq = sRecurrenceMode === "none" ? "none" : (sEd.recur_freq === "none" ? "weekly" : sEd.recur_freq);
    return validateRecurrence({
      recurrenceMode: sRecurrenceMode,
      recurFreq: freq,
      endUntilDate: untilDate,
      endCount: countVal,
      recurByday: sEd.recur_byday,
      recurByMonthday: sEd.recur_bymonthday,
      recurWeekOfMonth: sEd.recur_week_of_month,
      startDate: sEd._s.date,
    });
  }, [sEd, sRecurrenceMode]);

  const canSaveSeries = useMemo(() => {
    if (!sEd) return false;
    if (sTimeErrors.length) return false;
    if (sRecurrenceMode !== "none" && sRecurrenceErrors.length) return false;
    return true;
  }, [sEd, sTimeErrors, sRecurrenceMode, sRecurrenceErrors]);

  const switchRecurrenceMode = (mode) => {
    setSRecurrenceMode(mode);
    setSEd(prev => {
      const next = { ...prev };
      if (mode === "none") {
        next.recur_freq = "none";
        next.recur_until = null;
        next.recur_count = null;
        next.recur_byday = null;
        next.recur_bymonthday = null;
        next.recur_week_of_month = null;
      } else if (mode === "until") {
        next.recur_count = null; // clear count
        if (next.recur_freq === "none") next.recur_freq = "weekly";
      } else if (mode === "count") {
        next.recur_until = null; // clear until
        if (next.recur_freq === "none") next.recur_freq = "weekly";
      }
      return next;
    });
  };

  const saveEditSeries = async () => {
    if (!canSaveSeries || !sEd) return;
    setBanner(""); setBannerErr("");
    try {
      const { startIso, endIso } = composeStartEndISO(sEd._s.date, sEd._s.time, sEd._e.time);

      // Build recurrence patch per selected mode; enforce until<=12
      let recur_freq = sEd.recur_freq;
      let recur_until = null;
      let recur_count = null;
      let recur_byday = null, recur_bymonthday = null, recur_week_of_month = null;

      if (sRecurrenceMode === "none") {
        recur_freq = "none";
      } else {
        if (recur_freq === "none") recur_freq = "weekly";
        if (sRecurrenceMode === "until") {
          const untilDate = sEd.recur_until ? splitLocal(sEd.recur_until).date : null;
          if (!untilDate) { setBannerErr("Choose an 'Until' date."); return; }
          const { capped } = estimateUntilOccurrences({
            startDate: sEd._s.date, recur_freq, byday: sEd.recur_byday,
            bymonthday: sEd.recur_bymonthday || null, weekOfMonthNth: sEd.recur_week_of_month || null,
          }, untilDate);
          if (capped) { setBannerErr("This 'Until' would create more than 12 occurrences. Please shorten the range or use Count (≤12)."); return; }
          recur_until = new Date(`${untilDate}T23:59:59`).toISOString();
        } else if (sRecurrenceMode === "count") {
          const n = Math.max(1, Math.min(Number(sEd.recur_count) || 1, 12));
          if (n <= 1) {
            // 4) Count 1 -> make non-recurring
            recur_freq = "none";
          } else {
            recur_count = n;
          }
        }
        if (recur_freq === "weekly") recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
        if (recur_freq === "monthly") {
          recur_bymonthday = sEd.recur_bymonthday || null;
          recur_week_of_month = sEd.recur_week_of_month || null;
          recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
        }
      }

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
      setBanner(recur_freq === "none" ? "Event updated (made non-recurring)." : "Event updated.");
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

  const canSaveOccurrence = useMemo(() => {
    if (!oEd) return false;
    if (oTimeErrors.length) return false;
    return true;
  }, [oEd, oTimeErrors]);

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
  const mapsHref = (loc) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`;

  /* -------------------------------- Render --------------------------------- */
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Calendar</h3>
      {err && <ErrorText>{err}</ErrorText>}
      {bannerErr && <ErrorText>{bannerErr}</ErrorText>}
      {banner && <InfoText>{banner}</InfoText>}

      {/* New event button: only in list mode (hidden while editing) */}
      {mode === "list" && (
        <Row style={{ marginBottom: 8 }}>
          <Button onClick={() => { setBanner(""); setBannerErr(""); setMode("create"); }}>New event</Button>
        </Row>
      )}

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

      {/* EDIT SERIES */}
      {mode === "editSeries" && sEd && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit event</h4>

          {/* Switch between None / Until / Count */}
          <Row>
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="s_recmod" checked={sRecurrenceMode==="none"} onChange={()=>switchRecurrenceMode("none")} />
              <span>No recurrence</span>
            </label>
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="s_recmod" checked={sRecurrenceMode==="until"} onChange={()=>switchRecurrenceMode("until")} />
              <span>Recurring · Until</span>
            </label>
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="s_recmod" checked={sRecurrenceMode==="count"} onChange={()=>switchRecurrenceMode("count")} />
              <span>Recurring · Count</span>
            </label>
          </Row>

          {/* Validation messages */}
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

          {/* Recurrence rules only when recurring */}
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

              {/* Until / Count inputs */}
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
                      value={sEd.recur_count ?? 6}
                      onChange={(e2)=>{
                        const val = Math.max(1, Math.min(12, Number(e2.target.value) || 1));
                        if (val <= 1) {
                          // 4) Count reduced to 1 -> remove recurrence immediately
                          setBanner("Count set to 1 — converted to non-recurring.");
                          switchRecurrenceMode("none");
                        } else {
                          setSEd({ ...sEd, recur_count: val });
                        }
                      }}
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

      {/* EDIT OCCURRENCE */}
      {mode === "editOcc" && oEd && (
        <div style={styles.panel}>
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
            {/* 1) Clear override ONLY here */}
            {oEd.overridden && <GhostButton onClick={clearOneOverride}>Clear override</GhostButton>}
            <DangerButton onClick={cancelOne}>Cancel occurrence</DangerButton>
            <GhostButton onClick={cancelEditOccurrence}>Close</GhostButton>
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
                        <div style={styles.titleLink} onClick={() => {
                          setOpenDescKeys(prev => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            return next;
                          });
                        }}>
                          {occ.title || "(untitled)"}{" "}
                          <span style={{ opacity: 0.7, fontSize: 12 }}>· {cap(occ.category || "rehearsal")}</span>
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
                        {openDescKeys.has(key) && occ.description && (
                          <div style={{ marginTop: 6, opacity: 0.9 }}>{occ.description}</div>
                        )}
                      </div>
                    </div>

                    <Row>
                      {isRecurring ? (
                        <>
                          <GhostButton onClick={() => openEditSeries(occ.event_id)}>Edit series</GhostButton>
                          <GhostButton onClick={() => openEditOccurrence(occ)}>Edit occurrence</GhostButton>
                          {/* Clear override & cancel are NOT shown in list anymore */}
                        </>
                      ) : (
                        <>
                          <GhostButton onClick={() => openEditSeries(occ.event_id)}>Edit event</GhostButton>
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
