// src/showrunner/components/ShowCalendarPanel.jsx
import { useMemo, useState, useEffect } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import useShowCalendarData from "../hooks/useShowCalendarData";
import { composeStartEndISO, splitLocal, fmtRangeLocal, browserTZ } from "../../teams/utils/datetime";
import { inviteTeamToShow, listShowLineup, cancelTeamShowInvite, resolveTeamIdByDisplayId, removeTeamFromShow, resolveTeamBriefByDisplayId, listSeriesLineup, inviteTeamToSeries, cancelTeamSeriesInvite, removeTeamFromSeries, upsertOccLineupStatus, clearOccLineupOverride } from "../shows.api";

const CATEGORIES = ["performance"]; // Showrunner shows are always performances
const TYPE_META = { performance: { icon: "🎤", label: "Performance" } };
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

// Estimate number of occurrences from local start until local end date (inclusive)
function estimateUntilCount({ recurFreq, startDate, startTime, untilDate, byday, byMonthday, weekOfMonth }) {
  if (!untilDate || !startDate || !startTime) return null;
  const pad = (n)=> String(n).padStart(2,"0");
  const start = new Date(`${startDate}T${startTime}:00`);
  const until = new Date(`${untilDate}T23:59:59`);
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
  const bail = ()=> count > 12;
  if (recurFreq === "daily") {
    count = Math.floor((Date.UTC(until.getFullYear(), until.getMonth(), until.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()))/dayMs)+1;
    return count;
  }
  if (recurFreq === "weekly") {
    const set = new Set((Array.isArray(byday) && byday.length ? byday : [DOW[start.getDay()]]));
    const cur = new Date(start);
    while (cur <= until) {
      if (set.has(DOW[cur.getDay()])) {
        const occ = new Date(cur);
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (occ >= start && occ <= until) { count++; if (bail()) return count; }
      }
      cur.setDate(cur.getDate()+1);
    }
    return count;
  }
  if (recurFreq === "monthly") {
    const startMonthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonthStart = new Date(until.getFullYear(), until.getMonth(), 1);
    const monthsSpan = (endMonthStart.getFullYear() - startMonthStart.getFullYear()) * 12 + (endMonthStart.getMonth() - startMonthStart.getMonth());
    for (let i=0;i<=monthsSpan;i++) {
      const y = startMonthStart.getFullYear() + Math.floor((startMonthStart.getMonth()+i)/12);
      const m = (startMonthStart.getMonth()+i)%12;
      let occDate = null;
      if (byMonthday) {
        const last = new Date(y, m + 1, 0).getDate();
        occDate = new Date(y, m, Math.min(Number(byMonthday), last));
      } else if (weekOfMonth && Array.isArray(byday) && byday.length === 1) {
        const wd = DOW.indexOf(byday[0]);
        if (wd>=0) occDate = nthWeekdayOfMonth(y, m, wd, Number(weekOfMonth));
      } else {
        occDate = new Date(y, m, start.getDate());
      }
      if (occDate) {
        const occ = new Date(occDate);
        occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (occ >= start && occ <= until) { count++; if (bail()) return count; }
      }
    }
    return count;
  }
  return 1;
}

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
  if (recurFreq === "weekly" && (!Array.isArray(recurByday) || recurByday.length === 0)) errs.push("Pick at least one weekday for weekly recurrence.");
  if (recurFreq === "monthly") {
    const byDayOk = !!(recurByMonthday && Number(recurByMonthday)>=1 && Number(recurByMonthday)<=31);
    const womOk = !!(recurWeekOfMonth && Number(recurWeekOfMonth)>=-1 && Number(recurWeekOfMonth)<=4 && Array.isArray(recurByday) && recurByday.length===1);
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
  if (startTime && endTime && startDate && endTime <= startTime) errs.push("End time must be after start time.");
  return errs;
}

export default function ShowCalendarPanel({ series }) {
  const tz = browserTZ();
  const today = new Date();
  const windowStartIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const windowEndIso = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 120).toISOString();

  const { loading, err, occurrences, events, createBase, updateBase, deleteBase, editOccurrence, cancelOccurrence, clearOccurrenceOverride } = useShowCalendarData(series?.id, windowStartIso, windowEndIso);
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

  // Create
  const [cTitle, setCTitle] = useState("");
  const [cDescription, setCDescription] = useState("");
  const [cLocation, setCLocation] = useState("");
  const [cCategory] = useState("performance");
  const [cAllowTeams, setCAllowTeams] = useState(false);
  const [cAllowIndividuals, setCAllowIndividuals] = useState(false);
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
  // Lineup (create-first-occurrence)
  const [cLineupItems, setCLineupItems] = useState([]); // { display_id, id?, name? }
  const [cLineupInput, setCLineupInput] = useState("");
  const [cLineupErr, setCLineupErr] = useState("");

  const cUntilEstimate = useMemo(() => cFreq === "none" || cEndMode !== "until" ? null : estimateUntilCount({ recurFreq: cFreq, startDate: cStartDate, startTime: cStartTime, untilDate: cUntilDate, byday: cByday, byMonthday: cByMonthday, weekOfMonth: cWeekOfMonth }), [cFreq, cEndMode, cStartDate, cStartTime, cUntilDate, cByday, cByMonthday, cWeekOfMonth]);
  const cRecurrenceErrors = useMemo(() => validateRecurrence({ recurrenceMode: cFreq === "none" ? "none" : (cEndMode === "until" ? "until" : "count"), recurFreq: cFreq, endUntilDate: cUntilDate, endCount: cCount, recurByday: cByday, recurByMonthday: cByMonthday, recurWeekOfMonth: cWeekOfMonth, occEstimate: cUntilEstimate }), [cFreq, cEndMode, cUntilDate, cCount, cByday, cByMonthday, cWeekOfMonth, cUntilEstimate]);
  const cTimeErrors = useMemo(() => validateTimes({ title: cTitle, startDate: cStartDate, startTime: cStartTime, endTime: cEndTime }), [cTitle, cStartDate, cStartTime, cEndTime]);
  const canSaveCreate = useMemo(() => { if (cTimeErrors.length) return false; if (cFreq !== "none" && cRecurrenceErrors.length) return false; return true; }, [cTimeErrors, cRecurrenceErrors, cFreq]);

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
      const created = await createBase({
        title: cTitle.trim(),
        description: cDescription.trim(),
        location: cLocation.trim(),
        category: cCategory,
        allow_team_applications: !!cAllowTeams,
        allow_individual_applications: !!cAllowIndividuals,
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
      // Invite any queued teams (by display_id)
      // - For single shows: create per-occurrence invite for this show
      // - For recurring shows: invite to all occurrences (no series-level defaults anymore)
      if (Array.isArray(cLineupItems) && cLineupItems.length && created?.id) {
        const inviteErrors = [];
        for (const it of cLineupItems) {
          try {
            const teamId = it.id || await resolveTeamIdByDisplayId(it.display_id);
            if (!teamId) {
              inviteErrors.push(`Team not found: ${it.display_id || it.id || 'unknown'}`);
              continue;
            }
            if (cFreq === 'none') {
              await inviteTeamToShow(created.id, startIso, teamId);
            } else {
              await inviteTeamToSeries(created.id, teamId);
            }
          } catch (e) {
            const msg = e?.message || 'Unknown invite error';
            inviteErrors.push(`${it.display_id || it.id || 'team'}: ${msg}`);
            console.warn('Invite error', it, e);
          }
        }
        if (inviteErrors.length) {
          setBannerErr(`Show created, but some invites failed: ${inviteErrors.join('; ')}`);
        }
      }
      setCTitle(""); setCDescription(""); setCLocation("");
      setCStartDate(defaultStartDate); setCStartTime(defaultStartTime); setCEndTime(defaultEndTime);
      setCFreq("none"); setCByday(["MO"]); setCByMonthday(0); setCWeekOfMonth(0);
      setCEndMode("count"); setCUntilDate(""); setCCount(6);
      setCLineupItems([]); setCLineupInput(""); setCLineupErr("");
      setMode("list");
      if (!bannerErr) setBanner("Show created.");
    } catch (e) { setBannerErr(e.message || "Failed to create show"); }
  };

  // Edit series
  const [sEd, setSEd] = useState(null);
  const [sRecurrenceMode, setSRecurrenceMode] = useState("none");
  const [sMonthlyMode, setSMonthlyMode] = useState("monthday"); // edit-series monthly mode
  const [sLineupBase, setSLineupBase] = useState(null); // selected occurrence base start for lineup in series edit
  const openEditSeries = (eventId) => {
    const e = events.find(x => x.id === eventId);
    if (!e) { setBannerErr("Could not load show."); return; }
    let recur_byday = e.recur_byday;
    if (e.recur_freq === "weekly" && (!Array.isArray(recur_byday) || recur_byday.length === 0)) {
      const DOW = ["SU","MO","TU","WE","TH","FR","SA"];
      recur_byday = [DOW[new Date(e.starts_at).getDay()]];
    }
    let recur_bymonthday = e.recur_bymonthday;
    let recur_week_of_month = e.recur_week_of_month;
    if (e.recur_freq === "monthly" && !recur_bymonthday && !recur_week_of_month) recur_bymonthday = new Date(e.starts_at).getUTCDate();
    const mode = (e.recur_freq === "none") ? "none" : (e.recur_until ? "until" : "count");
    setSEd({ ...e, recur_byday, recur_bymonthday, recur_week_of_month, _s: splitLocal(e.starts_at), _e: splitLocal(e.ends_at), _baseStart: e.starts_at });
    if (e.recur_freq === 'monthly') setSMonthlyMode(e.recur_bymonthday ? 'monthday' : 'week'); else setSMonthlyMode('monthday');
    // Pick default lineup occurrence for series: next future occurrence or first
    const evOccs = (occurrences || []).filter(o => o.event_id === eventId);
    let pick = null; const nowMs = Date.now();
    pick = evOccs.find(o => new Date(o.starts_at).getTime() > nowMs) || evOccs[0] || null;
    setSLineupBase(pick ? pick.base_start : null);
    setSRecurrenceMode(mode);
    setBanner(""); setBannerErr(""); setMode("editSeries");
  };
  const cancelEditSeries = () => { setSEd(null); setMode("list"); };
  const sTimeErrors = useMemo(() => sEd ? validateTimes({ title: sEd.title, startDate: sEd._s.date, startTime: sEd._s.time, endTime: sEd._e.time }) : [], [sEd]);
  const sUntilEstimate = useMemo(() => {
    if (!sEd || sRecurrenceMode !== "until") return null;
    const untilDate = sEd.recur_until ? splitLocal(sEd.recur_until).date : "";
    return estimateUntilCount({ recurFreq: sEd.recur_freq || "none", startDate: sEd._s.date, startTime: sEd._s.time, untilDate, byday: sEd.recur_byday, byMonthday: sEd.recur_bymonthday, weekOfMonth: sEd.recur_week_of_month });
  }, [sEd, sRecurrenceMode]);
  const sRecurrenceErrors = useMemo(() => {
    if (!sEd) return [];
    const untilDate = sEd?.recur_until ? splitLocal(sEd.recur_until).date : "";
    return validateRecurrence({ recurrenceMode: sRecurrenceMode, recurFreq: sEd.recur_freq || "none", endUntilDate: untilDate, endCount: sEd.recur_count || "", recurByday: sEd.recur_byday, recurByMonthday: sEd.recur_bymonthday, recurWeekOfMonth: sEd.recur_week_of_month, occEstimate: sUntilEstimate });
  }, [sEd, sRecurrenceMode, sUntilEstimate]);
  const canSaveSeries = useMemo(() => sEd && !sTimeErrors.length && (sRecurrenceMode === "none" || !sRecurrenceErrors.length), [sEd, sTimeErrors, sRecurrenceMode, sRecurrenceErrors]);
  const saveEditSeries = async () => {
    if (!canSaveSeries || !sEd) return;
    setBanner(""); setBannerErr("");
    try {
      let recur_freq = sEd.recur_freq || "none";
      let recur_until = null; let recur_count = null;
      let recur_byday = null, recur_bymonthday = null, recur_week_of_month = null;
      if (sRecurrenceMode === "none") {
        recur_freq = "none";
      } else if (sRecurrenceMode === "until") {
        recur_freq = recur_freq === "none" ? "weekly" : recur_freq;
        recur_until = sEd.recur_until || null;
        if (recur_freq === "weekly") recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
        if (recur_freq === "monthly") {
          recur_bymonthday = sEd.recur_bymonthday || null;
          recur_week_of_month = sEd.recur_week_of_month || null;
          recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : [];
        }
      } else if (sRecurrenceMode === "count") {
        const n = Math.max(1, Math.min(Number(sEd.recur_count) || 1, 12));
        if (n <= 1) recur_freq = "none"; else { recur_freq = recur_freq === "none" ? "weekly" : recur_freq; recur_count = n; if (recur_freq === "weekly") recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : []; if (recur_freq === "monthly") { recur_bymonthday = sEd.recur_bymonthday || null; recur_week_of_month = sEd.recur_week_of_month || null; recur_byday = Array.isArray(sEd.recur_byday) ? sEd.recur_byday : []; } }
      }
      const { startIso, endIso } = composeStartEndISO(sEd._s.date, sEd._s.time, sEd._e.time);
      await updateBase(sEd.id, { title: sEd.title ?? "", description: sEd.description ?? "", location: sEd.location ?? "", category: 'performance', allow_team_applications: !!sEd.allow_team_applications, allow_individual_applications: !!sEd.allow_individual_applications, tz: sEd.tz || tz, starts_at: startIso, ends_at: endIso, recur_freq, recur_interval: 1, recur_byday, recur_bymonthday, recur_week_of_month, recur_until, recur_count });
      setSEd(null); setMode("list"); setBanner(recur_freq === "none" ? "Show updated (recurrence removed)." : "Show updated.");
    } catch (e) { setBannerErr(e.message || "Failed to update show"); }
  };
  const deleteSeriesEvent = async () => { if (!sEd) return; if (!window.confirm("Delete this entire show/series?")) return; setBanner(""); setBannerErr(""); try { await deleteBase(sEd.id); setSEd(null); setMode("list"); setBanner("Show deleted."); } catch (e) { setBannerErr(e.message || "Failed to delete show"); } };

  // Edit single occurrence
  const [oEd, setOEd] = useState(null);
  const openEditOccurrence = (occ) => {
    const s = splitLocal(occ.starts_at);
    const e = splitLocal(occ.ends_at);
    const base = events.find(x => x.id === occ.event_id) || {};
    setOEd({
      event_id: occ.event_id,
      base_start: occ.base_start,
      title: occ.title || "",
      description: occ.description || "",
      location: occ.location || "",
      _sDate: s.date,
      _sTime: s.time,
      _eTime: e.time,
      overridden: !!occ.overridden,
      _allowTeams: !!base.allow_team_applications,
      _allowIndividuals: !!base.allow_individual_applications,
    });
    setBanner(""); setBannerErr(""); setMode("editOcc");
  };
  const cancelEditOccurrence = () => { setOEd(null); setMode("list"); };
  const oTimeErrors = useMemo(() => oEd ? validateTimes({ title: oEd.title, startDate: oEd._sDate, startTime: oEd._sTime, endTime: oEd._eTime }) : [], [oEd]);
  const canSaveOccurrence = useMemo(() => !!oEd && oTimeErrors.length === 0, [oEd, oTimeErrors]);
  const saveEditOccurrence = async () => {
    if (!canSaveOccurrence || !oEd) return;
    setBanner(""); setBannerErr("");
    try {
      const { startIso, endIso } = composeStartEndISO(oEd._sDate, oEd._sTime, oEd._eTime);
      await editOccurrence(oEd.event_id, oEd.base_start, {
        title: oEd.title.trim(),
        description: oEd.description.trim(),
        location: oEd.location.trim(),
        tz,
        starts_at: startIso,
        ends_at: endIso,
      });
      // Persist application flags at series level when edited here
      await updateBase(oEd.event_id, {
        allow_team_applications: !!oEd._allowTeams,
        allow_individual_applications: !!oEd._allowIndividuals,
      });
      cancelEditOccurrence();
      setBanner("Occurrence updated.");
    } catch (e) { setBannerErr(e.message || "Failed to update occurrence"); }
  };
  const cancelOne = async () => { if (!oEd) return; if (!window.confirm("Cancel just this occurrence?")) return; setBanner(""); setBannerErr(""); try { await cancelOccurrence(oEd.event_id, oEd.base_start); cancelEditOccurrence(); setBanner("Occurrence canceled."); } catch (e) { setBannerErr(e.message || "Failed to cancel occurrence"); } };
  const clearOneOverride = async () => { if (!oEd) return; setBanner(""); setBannerErr(""); try { await clearOccurrenceOverride(oEd.event_id, oEd.base_start); cancelEditOccurrence(); setBanner("Occurrence override cleared."); } catch (e) { setBannerErr(e.message || "Failed to clear override"); } };

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Calendar</h3>
      {err && <ErrorText>{err}</ErrorText>}
      {bannerErr && <ErrorText>{bannerErr}</ErrorText>}
      {banner && <InfoText>{banner}</InfoText>}

      {mode === "list" && (
        <Row style={{ marginBottom: 8 }}>
          <Button onClick={() => { setBanner(""); setBannerErr(""); setMode("create"); }}>New show</Button>
        </Row>
      )}

      {/* CREATE */}
      {mode === "create" && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.8 }}>Create show</h4>
          {cTimeErrors.concat(cFreq !== "none" ? cRecurrenceErrors : []).length > 0 && (
            <ErrorText>{cTimeErrors.concat(cFreq !== "none" ? cRecurrenceErrors : []).map((e,i)=><div key={i}>• {e}</div>)}</ErrorText>
          )}
          <Row>
            <Input placeholder="Title" value={cTitle} onChange={(e)=>setCTitle(e.target.value)} style={{ minWidth: 220 }} />
            <Input placeholder="Location" value={cLocation} onChange={(e)=>setCLocation(e.target.value)} style={{ minWidth: 180 }} />
            <span style={{ alignSelf:"center", opacity:0.8 }}>Type: Performance</span>
          </Row>
          <Row>
            <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" checked={cAllowTeams} onChange={(e)=>setCAllowTeams(e.target.checked)} />
              <span>Teams can apply</span>
            </label>
            <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" checked={cAllowIndividuals} onChange={(e)=>setCAllowIndividuals(e.target.checked)} />
              <span>Individuals can apply (Jam)</span>
            </label>
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
                  <select value={cMonthlyMode} onChange={(e)=>{ const v = e.target.value; setCMonthlyMode(v); if (v === "monthday") { setCWeekOfMonth(0); setCByday(["MO"]); } if (v === "week") { setCByMonthday(0); } }} style={styles.select}>
                    <option value="monthday">By month-day</option>
                    <option value="week">Week of month</option>
                  </select>
                </Label>
                {cMonthlyMode === "monthday" ? (
                  <Label>
                    By month-day
                    <Input type="number" min={1} max={31} value={Number(cByMonthday)||0} onChange={(e)=>setCByMonthday(Number(e.target.value)||0)} style={{ width: 120 }} />
                  </Label>
                ) : (
                  <>
                    <Label>Week-of-month (1..4, -1=last)<Input type="number" min={-1} max={4} value={Number(cWeekOfMonth)||0} onChange={(e)=>setCWeekOfMonth(Number(e.target.value)||0)} style={{ width: 140 }} /></Label>
                    <Label>Weekday
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
                  <Input type="number" min={1} max={12} value={cCount} onChange={(e)=>setCCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ width: 100 }} />
                  <span style={{ alignSelf:"center", opacity:0.8 }}>occurrences (max 12)</span>
                </>
              )}
            </Row>
          )}
          {/* Lineup on create */}
          <div style={{ marginTop: 18 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 14, opacity: 0.85 }}>
              {cFreq === 'none' ? 'Lineup (this show)' : 'Residency (applies to all nights)'}
            </h4>
            <p style={{ margin: 0, opacity: 0.75, fontSize: 13 }}>
              {cFreq === 'none'
                ? 'Add team IDs to invite to this show.'
                : 'Add team IDs to the Residency (series default lineup). You can override per night later in Edit Occurrence.'}
            </p>
            <Row>
              <Input placeholder="Team ID (e.g. MyTeam#1)" value={cLineupInput} onChange={(e)=>{ setCLineupInput(e.target.value); setCLineupErr(""); }} onKeyDown={async (e)=>{ if (e.key==='Enter' && cLineupInput.trim()) { const v = cLineupInput.trim(); try { const brief = await resolveTeamBriefByDisplayId(v); if (!brief) { setCLineupErr('No team found with that ID'); return; } if (!cLineupItems.some(x=>x.display_id===v)) setCLineupItems([...cLineupItems, { display_id: v, id: brief.id, name: brief.name }]); setCLineupInput(""); } catch (err) { setCLineupErr(err.message || 'Lookup failed'); } } }} style={{ minWidth: 260 }} />
              <Button onClick={async ()=>{ const v = cLineupInput.trim(); if (!v) return; try { const brief = await resolveTeamBriefByDisplayId(v); if (!brief) { setCLineupErr('No team found with that ID'); return; } if (!cLineupItems.some(x=>x.display_id===v)) setCLineupItems([...cLineupItems, { display_id: v, id: brief.id, name: brief.name }]); setCLineupInput(""); } catch (err) { setCLineupErr(err.message || 'Lookup failed'); } }} disabled={!cLineupInput.trim()}>Add team</Button>
              {cLineupItems.length > 0 && (
                <GhostButton onClick={()=>{ setCLineupItems([]); setCLineupErr(""); }}>Clear</GhostButton>
              )}
            </Row>
            {cLineupErr && <ErrorText>{cLineupErr}</ErrorText>}
            {cLineupItems.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, marginTop: 10 }}>
                {cLineupItems.map((it) => (
                  <li key={it.display_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 8, marginBottom: 8 }}>
                    <span>
                      {it.name ? (<><strong>{it.name}</strong> <span style={{ opacity: 0.75, fontSize: 12 }}>· ID: {it.display_id}</span></>) : (<span style={{ fontFamily: 'monospace' }}>ID: {it.display_id}</span>)}
                    </span>
                    <GhostButton onClick={()=> setCLineupItems(cLineupItems.filter(x=>x.display_id!==it.display_id))}>Remove</GhostButton>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Row>
            <Button onClick={submitCreate} disabled={!canSaveCreate}>Create</Button>
            <GhostButton onClick={()=>setMode("list")}>Cancel</GhostButton>
          </Row>
        </div>
      )}

      {/* EDIT SERIES */}
      {mode === "editSeries" && sEd && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit show</h4>
          {(sTimeErrors.length || (sRecurrenceMode!=="none" && sRecurrenceErrors.length)) > 0 && (
            <ErrorText>{[...sTimeErrors, ...(sRecurrenceMode!=="none" ? sRecurrenceErrors : [])].map((e,i)=><div key={i}>• {e}</div>)}</ErrorText>
          )}
          <Row>
            <Input value={sEd.title || ""} onChange={(e)=>setSEd({ ...sEd, title: e.target.value })} />
            <Input placeholder="Location" value={sEd.location || ""} onChange={(e)=>setSEd({ ...sEd, location: e.target.value })} />
            <span style={{ alignSelf:"center", opacity:0.8 }}>Type: Performance</span>
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
          <Row>
            <span style={{ alignSelf:"center", opacity:0.8 }}>Type: Performance</span>
            <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" checked={!!sEd.allow_team_applications} onChange={(e)=>setSEd({ ...sEd, allow_team_applications: e.target.checked })} />
              <span>Teams can apply</span>
            </label>
            <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" checked={!!sEd.allow_individual_applications} onChange={(e)=>setSEd({ ...sEd, allow_individual_applications: e.target.checked })} />
              <span>Individuals can apply (Jam)</span>
            </label>
          </Row>

          {/* Recurrence controls: allow switching between single and recurring */}
          <Row>
            <Label>
              Frequency
              <select value={sEd.recur_freq || 'none'} onChange={(e)=>{
                const v = e.target.value;
                const next = { ...sEd, recur_freq: v };
                // default byday for weekly if none
                if (v === 'weekly' && (!Array.isArray(next.recur_byday) || next.recur_byday.length === 0)) {
                  const DOW = ["SU","MO","TU","WE","TH","FR","SA"]; const wd = DOW[new Date(sEd._s ? `${sEd._s.date}T${sEd._s.time}:00` : sEd.starts_at).getDay()];
                  next.recur_byday = [wd || 'MO'];
                }
                setSEd(next);
                if (v === 'none') setSRecurrenceMode('none'); else if (sRecurrenceMode === 'none') setSRecurrenceMode('count');
              }} style={styles.select}>
                {FREQUENCIES.map((f)=> <option key={f} value={f}>{cap(f)}</option>)}
              </select>
            </Label>
            {/* Weekly specifics */}
            {sEd.recur_freq === 'weekly' && (
              <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                {BYDAY.map((d)=>{
                  const chk = Array.isArray(sEd.recur_byday) && sEd.recur_byday.includes(d);
                  return (
                    <label key={d} style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
                      <input type="checkbox" checked={!!chk} onChange={()=>{
                        const arr = Array.isArray(sEd.recur_byday) ? [...sEd.recur_byday] : [];
                        const next = chk ? arr.filter(x=>x!==d) : [...arr, d].sort();
                        setSEd({ ...sEd, recur_byday: next });
                      }} />
                      <span>{d}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {/* Monthly specifics */}
            {sEd.recur_freq === 'monthly' && (
              <Row>
                <Label>Mode
                  <select value={sMonthlyMode} onChange={(e)=>setSMonthlyMode(e.target.value)} style={styles.select}>
                    <option value="monthday">By month-day</option>
                    <option value="week">Week of month</option>
                  </select>
                </Label>
                {sMonthlyMode === 'monthday' ? (
                  <Label>By month-day
                    <Input type="number" min={1} max={31} value={Number(sEd.recur_bymonthday)||0} onChange={(e)=>setSEd({ ...sEd, recur_bymonthday: Math.max(1, Math.min(31, Number(e.target.value)||0)) })} style={{ width: 120 }} />
                  </Label>
                ) : (
                  <>
                    <Label>Week-of-month (1..4, -1=last)
                      <Input type="number" min={-1} max={4} value={Number(sEd.recur_week_of_month)||0} onChange={(e)=>setSEd({ ...sEd, recur_week_of_month: Number(e.target.value)||0 })} style={{ width: 140 }} />
                    </Label>
                    <Label>Weekday
                      <select value={(Array.isArray(sEd.recur_byday) && sEd.recur_byday[0]) || 'MO'} onChange={(e)=>setSEd({ ...sEd, recur_byday: [e.target.value] })} style={styles.select}>
                        {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                      </select>
                    </Label>
                  </>
                )}
              </Row>
            )}
          </Row>

          {/* Recurrence mode (end strategy) */}
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
          <Row>
            {sRecurrenceMode === "until" && (
              <Label>Until
                <Input type="date" value={sEd.recur_until ? splitLocal(sEd.recur_until).date : ""} onChange={(e2)=>setSEd({ ...sEd, recur_until: e2.target.value ? new Date(`${e2.target.value}T23:59:59`).toISOString() : null })} />
              </Label>
            )}
            {sRecurrenceMode === "count" && (
              <Label>Count (max 12)
                <Input type="number" min={1} max={12} value={sEd.recur_count || 6} onChange={(e2)=>setSEd({ ...sEd, recur_count: Math.max(1, Math.min(12, Number(e2.target.value) || 1)) })} style={{ width: 120 }} />
              </Label>
            )}
          </Row>
          {/* Lineup section: for single shows (non-recurring) manage the only night here */}
          {sRecurrenceMode === 'none' && sEd && (
            <div style={{ marginTop: 18 }}>
              {/* Remove duplicate header; OccLineup renders its own header */}
              <OccLineup eventId={sEd.id} baseStart={sEd._baseStart} />
            </div>
          )}

          {/* Lineup section for recurring series: one default list applied to all nights */}
          {sRecurrenceMode !== 'none' && sEd && (
            <div style={{ marginTop: 18 }}>
              <SeriesLineup eventId={sEd.id} />
            </div>
          )}

          {/* Action buttons at the bottom, below lineup when present */}
          <Row>
            <Button onClick={saveEditSeries} disabled={!canSaveSeries}>Save</Button>
            <GhostButton onClick={cancelEditSeries}>Cancel</GhostButton>
            <DangerButton onClick={deleteSeriesEvent}>{sRecurrenceMode === "none" ? "Delete show" : "Delete series"}</DangerButton>
          </Row>
        </div>
      )}

      {/* EDIT OCCURRENCE */}
      {mode === "editOcc" && oEd && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit single occurrence</h4>
          {oTimeErrors.length > 0 && (<ErrorText>{oTimeErrors.map((e,i)=><div key={i}>• {e}</div>)}</ErrorText>)}
          <Row>
            <Input value={oEd.title} onChange={(e)=>setOEd({ ...oEd, title: e.target.value })} />
            <Input placeholder="Location" value={oEd.location} onChange={(e)=>setOEd({ ...oEd, location: e.target.value })} />
            <span style={{ alignSelf:"center", opacity:0.8 }}>Type: Performance</span>
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
            <span style={{ alignSelf:"center", opacity:0.8 }}>Type: Performance</span>
            <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" checked={!!oEd._allowTeams} onChange={(e)=>setOEd({ ...oEd, _allowTeams: e.target.checked })} />
              <span>Teams can apply</span>
            </label>
            <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
              <input type="checkbox" checked={!!oEd._allowIndividuals} onChange={(e)=>setOEd({ ...oEd, _allowIndividuals: e.target.checked })} />
              <span>Individuals can apply (Jam)</span>
            </label>
          </Row>
          {/* Lineup management for this night (buttons below) */}
          <OccLineup eventId={oEd.event_id} baseStart={oEd.base_start} />

          <Row>
            <Button onClick={saveEditOccurrence} disabled={!canSaveOccurrence}>Save occurrence</Button>
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
            <p style={{ opacity: 0.8 }}>No upcoming shows.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {upcoming.map((occ) => {
                const series = events.find(e => e.id === occ.event_id);
                const isRecurring = !!(series && series.recur_freq && series.recur_freq !== "none");
                const key = `${occ.event_id}|${occ.base_start}`;
                const typeMeta = TYPE_META[occ.category] || { icon: "📅", label: cap(occ.category || "event") };
                return (
                  <li key={key} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 12, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span title={typeMeta.label} aria-label={typeMeta.label} style={{ fontSize: 18, lineHeight: "20px" }}>{typeMeta.icon}</span>
                      <div>
                        <div style={styles.titleLink} onClick={() => setOpenDesc(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}>
                          {occ.title || "(untitled)"}{" "}
                          {Number.isFinite(occ.occ_index) && Number.isFinite(occ.occ_total) && occ.occ_total > 0 && (
                            <span style={{ opacity: 0.7, fontSize: 12 }}>· {occ.occ_index + 1} of {occ.occ_total}</span>
                          )}
                          {occ.overridden && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(edited)</span>}
                        </div>
                        <div style={{ opacity: 0.8, fontSize: 12 }}>
                          {fmtRangeLocal(occ.starts_at, occ.ends_at, occ.tz)}
                          {occ.location && (<>{" · "}<a href={mapsHref(occ.location)} target="_blank" rel="noopener noreferrer" style={{ color: "#7aa2ff" }}>📍 {occ.location}</a></>)}
                        </div>
                        {openDescKeys.has(key) && occ.description && (<div style={{ marginTop: 6, opacity: 0.9 }}>{occ.description}</div>)}
                      </div>
                    </div>
                    <Row>
                      {isRecurring ? (
                        <>
                          <GhostButton onClick={() => openEditSeries(occ.event_id)}>Edit series</GhostButton>
                          <GhostButton onClick={() => openEditOccurrence(occ)}>Edit occurrence</GhostButton>
                        </>
                      ) : (
                        <GhostButton onClick={() => openEditSeries(occ.event_id)}>Edit show</GhostButton>
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

function OccLineup({ eventId, baseStart, hideHeader = false }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try { setRows(await listShowLineup(eventId, baseStart)); }
    catch (e) { setErr(e.message || 'Failed to load lineup'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [eventId, baseStart]);

  const add = async () => {
    const disp = input.trim(); if (!disp) return;
    setBusy(true); setErr("");
    try {
      const teamId = await resolveTeamIdByDisplayId(disp);
      if (!teamId) { setErr('No team found with that ID'); setBusy(false); return; }
      await inviteTeamToShow(eventId, baseStart, teamId);
      setInput("");
      await load();
    } catch (e) { setErr(e.message || 'Invite failed'); }
    finally { setBusy(false); }
  };

  const cancel = async (teamId) => {
    if (!window.confirm('Remove this team from the lineup?')) return;
    setBusy(true); setErr("");
    try { await upsertOccLineupStatus(eventId, baseStart, teamId, 'canceled'); await load(); }
    catch (e) { setErr(e.message || 'Remove failed'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 18 }}>
      {!hideHeader && (
        <h4 style={{ margin: '0 0 6px', fontSize: 14, opacity: 0.85 }}>Lineup</h4>
      )}
      {loading ? (
        <p style={{ opacity: 0.8 }}>Loading lineup…</p>
      ) : (
        <>
          <Row>
            <Input placeholder="Team ID (e.g. MyTeam#1)" value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') add(); }} style={{ minWidth: 260 }} />
            <Button onClick={add} disabled={busy || !input.trim()}>Invite team</Button>
          </Row>
          {err && <ErrorText>{err}</ErrorText>}
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 10 }}>
            {rows.length === 0 && <li style={{ opacity: 0.8 }}>No teams invited yet.</li>}
            {rows.map((r) => (
              <li key={`${r.team_id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {r.team_name || (r.team_display_id ? `ID: ${r.team_display_id}` : `ID: ${r.team_id}`)}
                    {r.team_name && (r.team_display_id || r.team_id) && (
                      <span style={{ opacity: 0.75, fontSize: 12, marginLeft: 8 }}>
                        · ID: {r.team_display_id || r.team_id}
                      </span>
                    )}
                  </div>
                  <div style={{ opacity: 0.9, fontSize: 12, color: (r.status === 'canceled' || r.status === 'declined') ? '#ff6b6b' : 'rgba(255,255,255,0.75)' }}>{r.status}</div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {(r.status === 'canceled' || r.status === 'declined') ? (
                    <GhostButton onClick={async ()=>{ if (!window.confirm('Dismiss this team from the lineup?')) return; try { await upsertOccLineupStatus(eventId, baseStart, r.team_id, 'dismissed'); await load(); } catch(e){ setErr(e.message || 'Dismiss failed'); } }}>Dismiss</GhostButton>
                  ) : (
                    <GhostButton onClick={() => cancel(r.team_id)}>Remove</GhostButton>
                  )}
                  {(r.status === 'canceled' || r.status === 'dismissed') && (
                    <GhostButton onClick={async ()=>{ try { await clearOccLineupOverride(eventId, baseStart, r.team_id); await load(); } catch(e){ setErr(e.message || 'Clear override failed'); } }}>Clear override</GhostButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SeriesLineup({ eventId }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try { setRows(await listSeriesLineup(eventId)); }
    catch (e) { setErr(e.message || 'Failed to load lineup'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [eventId]);

  const add = async () => {
    const disp = input.trim(); if (!disp) return;
    setBusy(true); setErr("");
    try {
      const brief = await resolveTeamBriefByDisplayId(disp);
      if (!brief?.id) { setErr('No team found with that ID'); setBusy(false); return; }
      await inviteTeamToSeries(eventId, brief.id);
      setInput("");
      await load();
    } catch (e) { setErr(e.message || 'Invite failed'); }
    finally { setBusy(false); }
  };

  const cancel = async (teamId) => {
    if (!window.confirm('Remove this team from the series default lineup?')) return;
    setBusy(true); setErr("");
    try { await cancelTeamSeriesInvite(eventId, teamId); await load(); }
    catch (e) { setErr(e.message || 'Remove failed'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 18 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 14, opacity: 0.85 }}>Residency</h4>
      {loading ? (
        <p style={{ opacity: 0.8 }}>Loading lineup…</p>
      ) : (
        <>
          <Row>
            <Input placeholder="Team ID (e.g. MyTeam#1)" value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') add(); }} style={{ minWidth: 260 }} />
            <Button onClick={add} disabled={busy || !input.trim()}>Invite team</Button>
          </Row>
          {err && <ErrorText>{err}</ErrorText>}
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 10 }}>
            {rows.length === 0 && <li style={{ opacity: 0.8 }}>No teams invited yet.</li>}
            {rows.map((r) => (
              <li key={`${r.team_id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {r.team_name || (r.team_display_id ? `ID: ${r.team_display_id}` : `ID: ${r.team_id}`)}
                    {r.team_name && (r.team_display_id || r.team_id) && (
                      <span style={{ opacity: 0.75, fontSize: 12, marginLeft: 8 }}>
                        · ID: {r.team_display_id || r.team_id}
                      </span>
                    )}
                  </div>
                  <div style={{ opacity: 0.9, fontSize: 12 }}>
                    {r.status === 'invited' ? 'Residency' : r.status}
                  </div>
                </div>
                <GhostButton onClick={() => cancel(r.team_id)}>Remove</GhostButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
