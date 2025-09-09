// src/teams/components/CalendarPanel.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import useCalendarData from "../hooks/useCalendarData";
import { composeStartEndISO, splitLocal, fmtRangeLocal, browserTZ } from "../utils/datetime";

const CATEGORIES = ["rehearsal", "social", "performance"];
const FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const BYDAY = ["MO","TU","WE","TH","FR","SA","SU"];

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

  // Create form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("rehearsal");

  const now = new Date();
  const pad = (n)=> String(n).padStart(2,"0");
  const defaultStartDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const defaultStartTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [endTime, setEndTime] = useState(pad((now.getHours()+1)%24)+":"+pad(now.getMinutes()));

  const [recurFreq, setRecurFreq] = useState("none");
  const [recurByday, setRecurByday] = useState(["MO"]);
  const [recurByMonthday, setRecurByMonthday] = useState(0);
  const [recurWeekOfMonth, setRecurWeekOfMonth] = useState(0);

  // End options: UNTIL or COUNT (max 12). No "Never".
  const [endMode, setEndMode] = useState("count");       // 'until' | 'count'
  const [endUntilDate, setEndUntilDate] = useState("");
  const [endCount, setEndCount] = useState(6);

  // Edit series panel
  const [editing, setEditing] = useState(null);
  const [ed, setEd] = useState(null);

  const [msg, setMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  // ✅ Declare `upcoming` once
  const upcoming = useMemo(() => occurrences, [occurrences]);

  const toggleDay = (d) => {
    setRecurByday((cur) => cur.includes(d) ? cur.filter(x=>x!==d) : [...cur, d].sort());
  };

  const handleDateTimeChange = (patch) => {
    if (patch.startDate !== undefined) setStartDate(patch.startDate);
    if (patch.startTime !== undefined) setStartTime(patch.startTime);
    if (patch.endTime !== undefined) setEndTime(patch.endTime);
  };

  const submitCreate = async () => {
    setMsg(""); setErrMsg("");

    if (!title.trim()) return setErrMsg("Title is required");
    if (!startDate || !startTime || !endTime) return setErrMsg("Start and end time are required");

    const { startIso, endIso } = composeStartEndISO(startDate, startTime, endTime);
    if (!startIso || !endIso) return setErrMsg("Invalid date/time");

    // Enforce end rule for recurring series: must have UNTIL or COUNT (≤12).
    let recur_until = null, recur_count = null;
    if (recurFreq !== "none") {
      if (endMode === "until") {
        if (!endUntilDate) return setErrMsg("Choose an 'until' date for recurring events");
        recur_until = new Date(`${endUntilDate}T23:59:59`).toISOString();
      } else if (endMode === "count") {
        const n = Math.max(1, Math.min(Number(endCount) || 1, 12));
        recur_count = n;
      } else {
        return setErrMsg("Recurring events must end by 'Until' or 'After N occurrences'.");
      }
    }

    const payload = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      category,
      tz,
      starts_at: startIso,
      ends_at: endIso,
      recur_freq: recurFreq,
      recur_interval: 1,              // fixed interval = 1
      recur_byday: recurFreq === "weekly" ? recurByday : null,
      recur_bymonthday: recurFreq === "monthly" && recurByMonthday ? Number(recurByMonthday) : null,
      recur_week_of_month: recurFreq === "monthly" && recurWeekOfMonth ? Number(recurWeekOfMonth) : null,
      recur_until,
      recur_count,
    };

    try {
      await createBase(payload);
      // reset
      setTitle(""); setDescription(""); setLocation("");
      setCategory("rehearsal");
      setStartDate(defaultStartDate); setStartTime(defaultStartTime);
      setEndTime(pad((now.getHours()+1)%24)+":"+pad(now.getMinutes()));
      setRecurFreq("none"); setRecurByday(["MO"]); setRecurByMonthday(0); setRecurWeekOfMonth(0);
      setEndMode("count"); setEndUntilDate(""); setEndCount(6);
      setMsg("Event created.");
    } catch (e) {
      setErrMsg(e.message || "Failed to create event");
    }
  };

  const openEditBase = (eventId) => {
    const e = events.find((x) => x.id === eventId);
    if (!e) return;
    setEditing(e);
    setEd({ ...e });
  };

  const saveEditBase = async () => {
    const e = ed;
    if (!e) return;
    setMsg(""); setErrMsg("");

    // Enforce end rule on edit as well.
    if (e.recur_freq && e.recur_freq !== "none") {
      const hasUntil = !!e.recur_until;
      const hasCount = e.recur_count != null && e.recur_count !== "";
      if (!hasUntil && !hasCount) {
        return setErrMsg("Recurring events must end by 'Until' date or 'After N occurrences' (≤12).");
      }
    }

    const patch = {
      title: e.title ?? "",
      description: e.description ?? "",
      location: e.location ?? "",
      category: e.category ?? "rehearsal",
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      tz: e.tz || tz,
      recur_freq: e.recur_freq || "none",
      recur_interval: 1,
      recur_byday: e.recur_freq === "weekly" ? (Array.isArray(e.recur_byday) ? e.recur_byday : []) : null,
      recur_bymonthday: e.recur_freq === "monthly" ? (e.recur_bymonthday || null) : null,
      recur_week_of_month: e.recur_freq === "monthly" ? (e.recur_week_of_month || null) : null,
      recur_until: e.recur_until || null,
      recur_count: e.recur_count ? Math.min(Number(e.recur_count) || 1, 12) : null,
    };

    try {
      await updateBase(e.id, patch);
      setEditing(null); setEd(null);
      setMsg("Event updated.");
    } catch (er) {
      setErrMsg(er.message || "Failed to update event");
    }
  };

  const removeBase = async (eventId) => {
    if (!window.confirm("Delete this entire event/series?")) return;
    setMsg(""); setErrMsg("");
    try {
      await deleteBase(eventId);
      setMsg("Event deleted.");
    } catch (er) {
      setErrMsg(er.message || "Failed to delete event");
    }
  };

  const editOne = async (occ) => {
    const newTitle = window.prompt("Edit occurrence title", occ.title || "");
    if (newTitle == null) return;
    setMsg(""); setErrMsg("");
    try {
      await editOccurrence(occ.event_id, occ.base_start, { title: newTitle });
      setMsg("Occurrence updated.");
    } catch (er) {
      setErrMsg(er.message || "Failed to update occurrence");
    }
  };

  const cancelOne = async (occ) => {
    if (!window.confirm("Cancel just this occurrence?")) return;
    setMsg(""); setErrMsg("");
    try {
      await cancelOccurrence(occ.event_id, occ.base_start);
      setMsg("Occurrence canceled.");
    } catch (er) {
      setErrMsg(er.message || "Failed to cancel occurrence");
    }
  };

  const clearOneOverride = async (occ) => {
    if (!occ.overridden) return;
    setMsg(""); setErrMsg("");
    try {
    await clearOccurrenceOverride(occ.event_id, occ.base_start);
      setMsg("Occurrence override cleared.");
    } catch (er) {
      setErrMsg(er.message || "Failed to clear override");
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Calendar</h3>
      {err && <ErrorText>{err}</ErrorText>}
      {errMsg && <ErrorText>{errMsg}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {/* Create event */}
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.8 }}>Create event</h4>
        <Row>
          <Input placeholder="Title" value={title} onChange={(e)=>setTitle(e.target.value)} style={{ minWidth: 200 }} />
          <Input placeholder="Location" value={location} onChange={(e)=>setLocation(e.target.value)} style={{ minWidth: 160 }} />
          <select value={category} onChange={(e)=>setCategory(e.target.value)} style={styles.select}>
            {CATEGORIES.map((c)=> <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Row>
          <Input placeholder="Description" value={description} onChange={(e)=>setDescription(e.target.value)} style={{ minWidth: 420 }} />
        </Row>
        <DateTimeRow
          startDate={startDate}
          startTime={startTime}
          endTime={endTime}
          onChange={handleDateTimeChange}
        />

        {/* Recurrence */}
        <Row>
          <Label>
            Frequency
            <select value={recurFreq} onChange={(e)=>setRecurFreq(e.target.value)} style={styles.select}>
              {FREQUENCIES.map((f)=> <option key={f} value={f}>{f}</option>)}
            </select>
          </Label>

          {recurFreq === "weekly" && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
              {BYDAY.map((d)=> {
                const chk = recurByday.includes(d);
                return (
                  <label key={d} style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                    <input type="checkbox" checked={chk} onChange={()=>toggleDay(d)} />
                    <span>{d}</span>
                  </label>
                );
              })}
            </div>
          )}

          {recurFreq === "monthly" && (
            <Row>
              <Label>
                By month-day
                <Input type="number" min={1} max={31} value={recurByMonthday} onChange={(e)=>setRecurByMonthday(e.target.value)} style={{ width: 120 }} />
              </Label>
              <Label>
                or week-of-month (1..4, -1=last)
                <Input type="number" min={-1} max={4} value={recurWeekOfMonth} onChange={(e)=>setRecurWeekOfMonth(e.target.value)} style={{ width: 140 }} />
              </Label>
              <Label>
                Weekday
                <select value={recurByday[0] || "MO"} onChange={(e)=>setRecurByday([e.target.value])} style={styles.select}>
                  {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                </select>
              </Label>
            </Row>
          )}
        </Row>

        {/* End options (ONLY Until / Count (≤12)) */}
        {recurFreq !== "none" && (
          <Row>
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="endmode" checked={endMode==="until"} onChange={()=>setEndMode("until")} />
              <span>Until</span>
            </label>
            {endMode==="until" && (
              <Input type="date" value={endUntilDate} onChange={(e)=>setEndUntilDate(e.target.value)} />
            )}
            <label style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
              <input type="radio" name="endmode" checked={endMode==="count"} onChange={()=>setEndMode("count")} />
              <span>After</span>
            </label>
            {endMode==="count" && (
              <>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={endCount}
                  onChange={(e)=>setEndCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                  style={{ width: 100 }}
                />
                <span style={{ alignSelf:"center", opacity:0.8 }}>occurrences (max 12)</span>
              </>
            )}
          </Row>
        )}

        <Row>
          <Button onClick={submitCreate} disabled={!title.trim() || !startDate || !startTime || !endTime}>
            Add
          </Button>
        </Row>
        <p style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>
          Interval is fixed at 1. Recurring events must end by an <strong>Until</strong> date or <strong>After N</strong> (≤12) occurrences.
        </p>
      </div>

      {/* Edit series panel (inline) */}
      {editing && ed && (
        <div style={{ border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Edit event</h4>
          <Row>
            <Input value={ed.title || ""} onChange={(e)=>setEd({ ...ed, title: e.target.value })} />
            <Input placeholder="Location" value={ed.location || ""} onChange={(e)=>setEd({ ...ed, location: e.target.value })} />
            <select value={ed.category || "rehearsal"} onChange={(e)=>setEd({ ...ed, category: e.target.value })} style={styles.select}>
              {CATEGORIES.map((c)=> <option key={c} value={c}>{c}</option>)}
            </select>
          </Row>
          <Row>
            <Input placeholder="Description" value={ed.description || ""} onChange={(e)=>setEd({ ...ed, description: e.target.value })} style={{ minWidth: 420 }} />
          </Row>

          {/* Start/end editors */}
          {(() => {
            const s = splitLocal(ed.starts_at); const e2 = splitLocal(ed.ends_at);
            return (
              <Row>
                <Input type="date" value={s.date} onChange={(ev)=>{
                  const { startIso, endIso } = composeStartEndISO(ev.target.value, s.time, e2.time);
                  setEd({ ...ed, starts_at: startIso, ends_at: endIso });
                }} />
                <Input type="time" value={s.time} onChange={(ev)=>{
                  const { startIso, endIso } = composeStartEndISO(s.date, ev.target.value, e2.time);
                  setEd({ ...ed, starts_at: startIso, ends_at: endIso });
                }} />
                <span style={{ alignSelf:"center", opacity:0.7 }}>→</span>
                <Input type="time" value={e2.time} onChange={(ev)=>{
                  const { startIso, endIso } = composeStartEndISO(s.date, s.time, ev.target.value);
                  setEd({ ...ed, starts_at: startIso, ends_at: endIso });
                }} />
              </Row>
            );
          })()}

          <Row>
            <Label>
              Frequency
              <select value={ed.recur_freq || "none"} onChange={(e2)=>setEd({ ...ed, recur_freq: e2.target.value })} style={styles.select}>
                {FREQUENCIES.map((f)=> <option key={f} value={f}>{f}</option>)}
              </select>
            </Label>

            {ed.recur_freq === "weekly" && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                {BYDAY.map((d)=> {
                  const cur = Array.isArray(ed.recur_byday) ? ed.recur_byday : [];
                  const chk = cur.includes(d);
                  return (
                    <label key={d} style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                      <input type="checkbox" checked={chk} onChange={()=>{
                        const next = chk ? cur.filter(x=>x!==d) : [...cur, d].sort();
                        setEd({ ...ed, recur_byday: next });
                      }} />
                      <span>{d}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {ed.recur_freq === "monthly" && (
              <Row>
                <Label>By month-day
                  <Input type="number" min={1} max={31} value={ed.recur_bymonthday || 0} onChange={(e2)=>setEd({ ...ed, recur_bymonthday: Number(e2.target.value) || null })} style={{ width: 120 }} />
                </Label>
                <Label>or week-of-month (1..4, -1=last)
                  <Input type="number" min={-1} max={4} value={ed.recur_week_of_month || 0} onChange={(e2)=>setEd({ ...ed, recur_week_of_month: Number(e2.target.value) || null })} style={{ width: 140 }} />
                </Label>
                <Label>Weekday
                  <select value={(Array.isArray(ed.recur_byday) && ed.recur_byday[0]) || "MO"} onChange={(e2)=>setEd({ ...ed, recur_byday: [e2.target.value] })} style={styles.select}>
                    {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                  </select>
                </Label>
              </Row>
            )}
          </Row>

          {/* End options on edit (ONLY Until / Count) */}
          <Row>
            <Label>Until
              <Input
                type="date"
                value={ed.recur_until ? splitLocal(ed.recur_until).date : ""}
                onChange={(e2)=>setEd({ ...ed, recur_until: e2.target.value ? new Date(`${e2.target.value}T23:59:59`).toISOString() : null })}
              />
            </Label>
            <Label>Count (max 12)
              <Input
                type="number"
                min={1}
                max={12}
                value={ed.recur_count || ""}
                onChange={(e2)=>setEd({ ...ed, recur_count: e2.target.value ? Math.max(1, Math.min(12, Number(e2.target.value) || 1)) : null })}
                style={{ width: 120 }}
              />
            </Label>
          </Row>

          <Row>
            <Button onClick={saveEditBase}>Save</Button>
            <GhostButton onClick={()=>{ setEditing(null); setEd(null); }}>Cancel</GhostButton>
            <DangerButton onClick={()=>removeBase(ed.id)}>Delete series</DangerButton>
          </Row>
        </div>
      )}

      {/* Occurrence list */}
      {loading ? (
        <p style={{ opacity: 0.8 }}>Loading calendar…</p>
      ) : upcoming.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No upcoming events.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {upcoming.map((occ) => (
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
                <GhostButton onClick={() => openEditBase(occ.event_id)}>Edit series</GhostButton>
                <GhostButton onClick={() => {
                  const s = splitLocal(occ.starts_at);
                  const e2 = splitLocal(occ.ends_at);
                  const newEnd = window.prompt("New end time (HH:MM)", e2.time);
                  if (!newEnd) return;
                  const { endIso } = composeStartEndISO(s.date, s.time, newEnd);
                  editOccurrence(occ.event_id, occ.base_start, { ends_at: endIso }).catch(err=>console.error(err));
                }}>Edit occurrence</GhostButton>
                {occ.overridden && <GhostButton onClick={() => clearOneOverride(occ)}>Clear override</GhostButton>}
                <DangerButton onClick={() => cancelOne(occ)}>Cancel occurrence</DangerButton>
              </Row>
            </li>
          ))}
        </ul>
      )}
    </div>
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
};
