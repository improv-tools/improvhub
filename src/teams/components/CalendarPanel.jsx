// src/teams/components/CalendarPanel.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import useCalendarData from "../hooks/useCalendarData";
import { composeStartEndISO, splitLocal, fmtRangeLocal, browserTZ } from "../utils/datetime";

const CATEGORIES = ["rehearsal", "social", "performance"];
const FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const BYDAY = ["MO","TU","WE","TH","FR","SA","SU"];

/* ------------------------------ Small widgets ------------------------------ */
function DateTimeRow({ startDate, startTime, endTime, onChange }) {
  return (
    <Row>
      <Input type="date" value={startDate} onChange={(e)=>onChange({ startDate: e.target.value })} />
      <Input type="time" value={startTime} onChange={(e)=>onChange({ startTime: e.target.value })} />
      <span style={{ alignSelf:"center", opacity:0.7 }}>→</span>
      <Input type="time" value={endTime} onChange={(e)=>onChange({ endTime: e.target.value })} />
    </Row>
  );
}

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
};

/* -------------------------------- Validators ------------------------------- */
function validateRecurrence({ recurFreq, endMode, endUntilDate, endCount, recurByday, recurByMonthday, recurWeekOfMonth }) {
  const errs = [];
  if (recurFreq === "none") return errs;

  if (endMode === "until") {
    if (!endUntilDate) errs.push("Please choose an 'Until' date.");
  } else if (endMode === "count") {
    const n = Number(endCount);
    if (!n || n < 1 || n > 12) errs.push("Count must be between 1 and 12.");
  } else {
    errs.push("Recurring events must end by 'Until' date or 'After N occurrences'.");
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

/* --------------------------------- Component -------------------------------- */
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

  // banners
  const [banner, setBanner] = useState("");
  const [bannerErr, setBannerErr] = useState("");

  const upcoming = useMemo(() => occurrences, [occurrences]);

  // one of: 'list' | 'create' | 'editSeries' | 'editOcc'
  const [mode, setMode] = useState("list");

  const now = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  const defaultStartDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const defaultStartTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const defaultEndTime   = `${pad((now.getHours()+1)%24)}:${pad(now.getMinutes())}`;

  /* --------------------------------- Create -------------------------------- */
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

  const cRecurrenceErrors = useMemo(() => validateRecurrence({
    recurFreq: cFreq,
    endMode: cEndMode,
    endUntilDate: cUntilDate,
    endCount: cCount,
    recurByday: cByday,
    recurByMonthday: cByMonthday,
    recurWeekOfMonth: cWeekOfMonth,
  }), [cFreq, cEndMode, cUntilDate, cCount, cByday, cByMonthday, cWeekOfMonth]);

  const cTimeErrors = useMemo(() => validateTimes({
    title: cTitle,
    startDate: cStartDate,
    startTime: cStartTime,
    endTime: cEndTime,
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
        else if (cEndMode === "count") recur_count = Math.max(1, Math.min(Number(cCount) || 1, 12));
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
    } catch (e) {
      setBannerErr(e.message || "Failed to create event");
    }
  };

  /* ------------------------------- Edit series ------------------------------ */
  const [sEd, setSEd] = useState(null); // full event row being edited (series)
  const openEditSeries = (eventId) => {
  const e = events.find((x) => x.id === eventId);
  if (!e) { setBannerErr("Could not load series."); return; }

  // Defaults to keep the form valid
  let recur_byday = e.recur_byday;
  if (e.recur_freq === "weekly" && (!Array.isArray(recur_byday) || recur_byday.length === 0)) {
    const DOW = ["SU","MO","TU","WE","TH","FR","SA"];
    const dow = DOW[new Date(e.starts_at).getDay()];
    recur_byday = [dow];
  }

  // For monthly, if both are empty, default to base day-of-month
  let recur_bymonthday = e.recur_bymonthday;
  let recur_week_of_month = e.recur_week_of_month;
  if (e.recur_freq === "monthly" && !recur_bymonthday && !recur_week_of_month) {
    recur_bymonthday = new Date(e.starts_at).getUTCDate();
  }

  setBanner(""); setBannerErr("");
  setSEd({
    ...e,
    recur_byday,
    recur_bymonthday,
    recur_week_of_month,
    _s: splitLocal(e.starts_at),
    _e: splitLocal(e.ends_at),
  });
  setMode("editSeries");
};

  const cancelEditSeries = () => { setSEd(null); setMode("list"); };

  const sRecurrenceErrors = useMemo(() => {
    if (!sEd) return [];
    return validateRecurrence({
      recurFreq: sEd.recur_freq || "none",
      endMode: sEd.recur_until ? "until" : (sEd.recur_count ? "count" : "count"),
      endUntilDate: sEd.recur_until ? splitLocal(sEd.recur_until).date : "",
      endCount: sEd.recur_count || "",
      recurByday: sEd.recur_byday,
      recurByMonthday: sEd.recur_bymonthday,
      recurWeekOfMonth: sEd.recur_week_of_month,
    });
  }, [sEd]);

  const sTimeErrors = useMemo(() => {
    if (!sEd) return [];
    return validateTimes({
      title: sEd.title,
      startDate: sEd._s.date,
      startTime: sEd._s.time,
      endTime: sEd._e.time,
    });
  }, [sEd]);

  const canSaveSeries = useMemo(() => {
    if (!sEd) return false;
    if (sTimeErrors.length) return false;
    if (sEd.recur_freq && sEd.recur_freq !== "none" && sRecurrenceErrors.length) return false;
    return true;
  }, [sEd, sTimeErrors, sRecurrenceErrors]);

  const saveEditSeries = async () => {
    if (!canSaveSeries || !sEd) return;
    setBanner(""); setBannerErr("");
    try {
      const { startIso, endIso } = composeStartEndISO(sEd._s.date, sEd._s.time, sEd._e.time);
      await updateBase(sEd.id, {
        title: sEd.title ?? "",
        description: sEd.description ?? "",
        location: sEd.location ?? "",
        category: sEd.category ?? "rehearsal",
        tz: sEd.tz || tz,
        starts_at: startIso,
        ends_at: endIso,
        recur_freq: sEd.recur_freq || "none",
        recur_interval: 1,
        recur_byday: sEd.recur_freq === "weekly" ? (Array.isArray(sEd.recur_byday) ? sEd.recur_byday : []) : null,
        recur_bymonthday: sEd.recur_freq === "monthly" ? (sEd.recur_bymonthday || null) : null,
        recur_week_of_month: sEd.recur_freq === "monthly" ? (sEd.recur_week_of_month || null) : null,
        recur_until: sEd.recur_until || null,
        recur_count: sEd.recur_count ? Math.min(Number(sEd.recur_count) || 1, 12) : null,
      });
      cancelEditSeries();
      setBanner("Event updated.");
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
    } catch (e) {
      setBannerErr(e.message || "Failed to delete event");
    }
  };

  /* ---------------------------- Edit ONE occurrence ------------------------- */
  const [oEd, setOEd] = useState(null); // { event_id, base_start, ... }
  const openEditOccurrence = (occ) => {
    const s = splitLocal(occ.starts_at);
    const e = splitLocal(occ.ends_at);
    setBanner(""); setBannerErr("");
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
    });
    setMode("editOcc");
  };
  const cancelEditOccurrence = () => { setOEd(null); setMode("list"); };

  const oTimeErrors = useMemo(() => {
    if (!oEd) return [];
    return validateTimes({
      title: oEd.title,
      startDate: oEd._sDate,
      startTime: oEd._sTime,
      endTime: oEd._eTime,
    });
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
    } catch (e) {
      setBannerErr(e.message || "Failed to update occurrence");
    }
  };

  const cancelOne = async (occ) => {
    if (!window.confirm("Cancel just this occurrence?")) return;
    setBanner(""); setBannerErr("");
    try {
      await cancelOccurrence(occ.event_id, occ.base_start);
      setBanner("Occurrence canceled.");
    } catch (e) {
      setBannerErr(e.message || "Failed to cancel occurrence");
    }
  };

  const clearOneOverride = async (occ) => {
    setBanner(""); setBannerErr("");
    try {
      await clearOccurrenceOverride(occ.event_id, occ.base_start);
      setBanner("Occurrence override cleared.");
    } catch (e) {
      setBannerErr(e.message || "Failed to clear override");
    }
  };

  /* ---------------------------------- UI ----------------------------------- */
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Calendar</h3>
      {err && <ErrorText>{err}</ErrorText>}
      {bannerErr && <ErrorText>{bannerErr}</ErrorText>}
      {banner && <InfoText>{banner}</InfoText>}

      {/* Top actions */}
      <Row style={{ marginBottom: 8 }}>
        <Button onClick={() => (mode === "create" ? setMode("list") : startCreate())} disabled={mode === "editSeries" || mode === "editOcc"}>
          {mode === "create" ? "Close new event" : "New event"}
        </Button>
      </Row>

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
              {CATEGORIES.map((c)=> <option key={c} value={c}>{c}</option>)}
            </select>
          </Row>
          <Row>
            <Input placeholder="Description" value={cDescription} onChange={(e)=>setCDescription(e.target.value)} style={{ minWidth: 500 }} />
          </Row>

          <DateTimeRow
            startDate={cStartDate}
            startTime={cStartTime}
            endTime={cEndTime}
            onChange={({startDate,startTime,endTime})=>{
              if (startDate !== undefined) setCStartDate(startDate);
              if (startTime !== undefined) setCStartTime(startTime);
              if (endTime !== undefined) setCEndTime(endTime);
            }}
          />

          {/* Recurrence */}
          <Row>
            <Label>
              Frequency
              <select value={cFreq} onChange={(e)=>setCFreq(e.target.value)} style={styles.select}>
                {FREQUENCIES.map((f)=> <option key={f} value={f}>{f}</option>)}
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

          {/* End options */}
          {cFreq !== "none" && (
            <Row>
              <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
                <input type="radio" name="c_endmode" checked={cEndMode==="until"} onChange={()=>setCEndMode("until")} />
                <span>Until</span>
              </label>
              {cEndMode==="until" && (
                <Input type="date" value={cUntilDate} onChange={(e)=>setCUntilDate(e.target.value)} />
              )}
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
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit event (series)</h4>

          {sTimeErrors.concat((sEd.recur_freq && sEd.recur_freq !== "none") ? sRecurrenceErrors : []).length > 0 && (
            <ErrorText>
              {sTimeErrors.concat((sEd.recur_freq && sEd.recur_freq !== "none") ? sRecurrenceErrors : []).map((e,i)=><div key={i}>• {e}</div>)}
            </ErrorText>
          )}

          <Row>
            <Input value={sEd.title || ""} onChange={(e)=>setSEd({ ...sEd, title: e.target.value })} />
            <Input placeholder="Location" value={sEd.location || ""} onChange={(e)=>setSEd({ ...sEd, location: e.target.value })} />
            <select value={sEd.category || "rehearsal"} onChange={(e)=>setSEd({ ...sEd, category: e.target.value })} style={styles.select}>
              {CATEGORIES.map((c)=> <option key={c} value={c}>{c}</option>)}
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

          <Row>
            <Label>
              Frequency
              <select value={sEd.recur_freq || "none"} onChange={(e2)=>setSEd({ ...sEd, recur_freq: e2.target.value })} style={styles.select}>
                {FREQUENCIES.map((f)=> <option key={f} value={f}>{f}</option>)}
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
                  <Input type="number" min={1} max={31} value={sEd.recur_bymonthday || 0} onChange={(e2)=>setSEd({ ...sEd, recur_bymonthday: Number(e2.target.value) || null })} style={{ width: 120 }} />
                </Label>
                <Label>or week-of-month (1..4, -1=last)
                  <Input type="number" min={-1} max={4} value={sEd.recur_week_of_month || 0} onChange={(e2)=>setSEd({ ...sEd, recur_week_of_month: Number(e2.target.value) || null })} style={{ width: 140 }} />
                </Label>
                <Label>Weekday
                  <select value={(Array.isArray(sEd.recur_byday) && sEd.recur_byday[0]) || "MO"} onChange={(e2)=>setSEd({ ...sEd, recur_byday: [e2.target.value] })} style={styles.select}>
                    {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                  </select>
                </Label>
              </Row>
            )}
          </Row>

          <Row>
            <Label>Until
              <Input
                type="date"
                value={sEd.recur_until ? splitLocal(sEd.recur_until).date : ""}
                onChange={(e2)=>setSEd({ ...sEd, recur_until: e2.target.value ? new Date(`${e2.target.value}T23:59:59`).toISOString() : null })}
              />
            </Label>
            <Label>Count (max 12)
              <Input
                type="number"
                min={1}
                max={12}
                value={sEd.recur_count || ""}
                onChange={(e2)=>setSEd({ ...sEd, recur_count: e2.target.value ? Math.max(1, Math.min(12, Number(e2.target.value) || 1)) : null })}
                style={{ width: 120 }}
              />
            </Label>
          </Row>

          <Row>
            <Button onClick={saveEditSeries} disabled={!canSaveSeries}>Save</Button>
            <GhostButton onClick={cancelEditSeries}>Cancel</GhostButton>
            <DangerButton onClick={deleteSeries}>Delete {sEd.recur_freq === "none" ? "event" : "series"}</DangerButton>
          </Row>
        </div>
      )}

      {/* EDIT OCCURRENCE */}
      {mode === "editOcc" && oEd && (
        <div style={styles.panel}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit single occurrence</h4>

          {oTimeErrors.length > 0 && (
            <ErrorText>
              {oTimeErrors.map((e,i)=><div key={i}>• {e}</div>)}
            </ErrorText>
          )}

          <Row>
            <Input value={oEd.title} onChange={(e)=>setOEd({ ...oEd, title: e.target.value })} />
            <Input placeholder="Location" value={oEd.location} onChange={(e)=>setOEd({ ...oEd, location: e.target.value })} />
            <select value={oEd.category} onChange={(e)=>setOEd({ ...oEd, category: e.target.value })} style={styles.select}>
              {CATEGORIES.map((c)=> <option key={c} value={c}>{c}</option>)}
            </select>
          </Row>
          <Row>
            <Input placeholder="Description" value={oEd.description} onChange={(e)=>setOEd({ ...oEd, description: e.target.value })} style={{ minWidth: 500 }} />
          </Row>
          <DateTimeRow
            startDate={oEd._sDate}
            startTime={oEd._sTime}
            endTime={oEd._eTime}
            onChange={({startDate,startTime,endTime})=>{
              if (startDate !== undefined) setOEd({ ...oEd, _sDate: startDate });
              if (startTime !== undefined) setOEd({ ...oEd, _sTime: startTime });
              if (endTime !== undefined) setOEd({ ...oEd, _eTime: endTime });
            }}
          />
          <Row>
            <Button onClick={saveEditOccurrence} disabled={!canSaveOccurrence}>Save occurrence</Button>
            <GhostButton onClick={cancelEditOccurrence}>Cancel</GhostButton>
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
                return (
                  <li
                    key={`${occ.event_id}|${occ.base_start}`}
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {occ.title || "(untitled)"}{" "}
                        <span style={{ opacity: 0.7, fontSize: 12 }}>· {occ.category || "rehearsal"}</span>
                        {occ.overridden && <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>(edited)</span>}
                      </div>
                      <div style={{ opacity: 0.8, fontSize: 12 }}>
                        {fmtRangeLocal(occ.starts_at, occ.ends_at, occ.tz)}
                      </div>
                      {occ.location && (
                        <div style={{ opacity: 0.8, fontSize: 12 }}>
                          📍 {occ.location}
                        </div>
                      )}
                    </div>
                    <Row>
                      {isRecurring ? (
  <>
    <GhostButton onClick={() => openEditSeries(occ.event_id)} disabled={mode !== "list"}>Edit series</GhostButton>
    <GhostButton onClick={() => openEditOccurrence(occ)} disabled={mode !== "list"}>Edit occurrence</GhostButton>
    {occ.overridden && <GhostButton onClick={() => clearOneOverride(occ)} disabled={mode !== "list"}>Clear override</GhostButton>}
    <DangerButton onClick={() => cancelOne(occ)} disabled={mode !== "list"}>Cancel occurrence</DangerButton>
  </>
) : (
  <>
    <GhostButton onClick={() => openEditSeries(occ.event_id)} disabled={mode !== "list"}>Edit event</GhostButton>
    <DangerButton
      onClick={async () => {
        setBanner(""); setBannerErr("");
        try { await deleteBase(occ.event_id); setBanner("Event deleted."); }
        catch (e) { setBannerErr(e.message || "Failed to delete event"); }
      }}
      disabled={mode !== "list"}
    >
      Delete event
    </DangerButton>
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
