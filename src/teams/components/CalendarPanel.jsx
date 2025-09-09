// src/teams/components/CalendarPanel.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import useCalendarData from "../hooks/useCalendarData";
import { combineLocal, splitLocal, fmtRangeLocal, browserTZ } from "../utils/datetime";

const CATEGORIES = ["rehearsal", "social", "performance"];
const FREQUENCIES = ["none", "daily", "weekly", "monthly"];
const BYDAY = ["MO","TU","WE","TH","FR","SA","SU"];

function DateTimeRow({ valueIso, onChange }) {
  const { date, time } = splitLocal(valueIso);
  return (
    <Row>
      <Input type="date" value={date} onChange={(e)=>onChange(combineLocal(e.target.value, time))} />
      <Input type="time" value={time} onChange={(e)=>onChange(combineLocal(date, e.target.value))} />
    </Row>
  );
}

export default function CalendarPanel({ team }) {
  const tz = browserTZ();
  const today = new Date();
  const windowStartIso = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const windowEndIso = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 120).toISOString();

  const {
    loading, err, occurrences, events, reload,
    createBase, updateBase, deleteBase,
    editOccurrence, cancelOccurrence, clearOccurrenceOverride,
  } = useCalendarData(team?.id, windowStartIso, windowEndIso);

  // create form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("rehearsal");
  const [startIso, setStartIso] = useState("");
  const [duration, setDuration] = useState(60);
  const [recurFreq, setRecurFreq] = useState("none");
  const [recurInterval, setRecurInterval] = useState(1);
  const [recurByday, setRecurByday] = useState(["MO"]);
  const [recurByMonthday, setRecurByMonthday] = useState(0);
  const [recurWeekOfMonth, setRecurWeekOfMonth] = useState(0);
  const [recurUntil, setRecurUntil] = useState("");
  const [recurCount, setRecurCount] = useState("");

  const [msg, setMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // edit base event modal (simple inline editor)
  const [editing, setEditing] = useState(null); // event object or null
  const [ed, setEd] = useState(null); // local copy for editing

  const upcoming = useMemo(() => occurrences, [occurrences]);

  const toggleDay = (d) => {
    setRecurByday((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()
    );
  };

  const submitCreate = async () => {
    setErrMsg(""); setMsg("");
    if (!title.trim() || !startIso) { setErrMsg("Title and start required"); return; }
    const start = new Date(startIso);
    const end = new Date(start.getTime() + (Number(duration) || 60)*60000);

    const payload = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      category,
      tz,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      recur_freq: recurFreq,
      recur_interval: Number(recurInterval) || 1,
      recur_byday: recurFreq === "weekly" ? recurByday : null,
      recur_bymonthday: recurFreq === "monthly" && recurByMonthday ? Number(recurByMonthday) : null,
      recur_week_of_month: recurFreq === "monthly" && recurWeekOfMonth ? Number(recurWeekOfMonth) : null,
      recur_until: recurUntil || null,
      recur_count: recurCount ? Number(recurCount) : null,
    };

    setSaving(true);
    try {
      await createBase(payload);
      setTitle(""); setDescription(""); setLocation("");
      setCategory("rehearsal");
      setStartIso(""); setDuration(60);
      setRecurFreq("none"); setRecurInterval(1);
      setRecurByday(["MO"]); setRecurByMonthday(0); setRecurWeekOfMonth(0);
      setRecurUntil(""); setRecurCount("");
      setMsg("Event created.");
    } catch (e) {
      setErrMsg(e.message || "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  const openEditBase = (eventId) => {
    const e = events.find((x) => x.id === eventId);
    if (!e) return;
    setEditing(e);
    setEd({ ...e }); // shallow copy
  };

  const saveEditBase = async () => {
    const e = ed;
    if (!e) return;
    setErrMsg(""); setMsg("");
    try {
      await updateBase(e.id, {
        title: e.title ?? "",
        description: e.description ?? "",
        location: e.location ?? "",
        category: e.category ?? "rehearsal",
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        tz: e.tz,
        recur_freq: e.recur_freq,
        recur_interval: e.recur_interval,
        recur_byday: e.recur_freq === "weekly" ? e.recur_byday : null,
        recur_bymonthday: e.recur_freq === "monthly" ? e.recur_bymonthday : null,
        recur_week_of_month: e.recur_freq === "monthly" ? e.recur_week_of_month : null,
        recur_until: e.recur_until || null,
        recur_count: e.recur_count || null,
      });
      setEditing(null); setEd(null);
      setMsg("Event updated.");
    } catch (er) {
      setErrMsg(er.message || "Failed to update event");
    }
  };

  const removeBase = async (eventId) => {
    if (!window.confirm("Delete this entire event/series?")) return;
    setErrMsg(""); setMsg("");
    try {
      await deleteBase(eventId);
      setMsg("Event deleted.");
    } catch (er) {
      setErrMsg(er.message || "Failed to delete event");
    }
  };

  const editOne = async (occ) => {
    // simple prompt-driven per-occurrence edit; replace with nicer UI if you like
    const newTitle = window.prompt("Edit occurrence title", occ.title || "");
    if (newTitle == null) return;
    setErrMsg(""); setMsg("");
    try {
      await editOccurrence(occ.event_id, occ.base_start, { title: newTitle });
      setMsg("Occurrence updated.");
    } catch (er) {
      setErrMsg(er.message || "Failed to update occurrence");
    }
  };

  const cancelOne = async (occ) => {
    if (!window.confirm("Cancel just this occurrence?")) return;
    setErrMsg(""); setMsg("");
    try {
      await cancelOccurrence(occ.event_id, occ.base_start);
      setMsg("Occurrence canceled.");
    } catch (er) {
      setErrMsg(er.message || "Failed to cancel occurrence");
    }
  };

  const clearOneOverride = async (occ) => {
    if (!occ.overridden) return;
    setErrMsg(""); setMsg("");
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
        <Row>
          <DateTimeRow valueIso={startIso} onChange={setStartIso} />
          <Input type="number" min={15} step={15} value={duration} onChange={(e)=>setDuration(e.target.value)} style={{ width: 120 }} />
          <span style={{ alignSelf: "center", opacity: 0.8 }}>minutes</span>
        </Row>
        <Row>
          <select value={recurFreq} onChange={(e)=>setRecurFreq(e.target.value)} style={styles.select}>
            {FREQUENCIES.map((f)=> <option key={f} value={f}>{f}</option>)}
          </select>
          <Input type="number" min={1} value={recurInterval} onChange={(e)=>setRecurInterval(e.target.value)} style={{ width: 120 }} />
          <span style={{ alignSelf: "center", opacity: 0.8 }}>interval</span>

          {recurFreq === "weekly" && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {BYDAY.map((d)=>(
                <label key={d} style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                  <input type="checkbox" checked={recurByday.includes(d)} onChange={()=>toggleDay(d)} />
                  <span>{d}</span>
                </label>
              ))}
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

          <Label>
            Until (optional)
            <Input type="date" value={recurUntil ? splitLocal(recurUntil).date : ""} onChange={(e)=>setRecurUntil(e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : "")} />
          </Label>
          <Label>
            Count (optional)
            <Input type="number" min={1} value={recurCount} onChange={(e)=>setRecurCount(e.target.value)} style={{ width: 120 }} />
          </Label>
        </Row>
        <Row>
          <Button onClick={submitCreate} disabled={saving || !title.trim() || !startIso}>
            {saving ? "Saving…" : "Add"}
          </Button>
        </Row>
        <p style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>
          Times saved in UTC; event timezone recorded as <code>{tz}</code>. Recurrence supports: daily/weekly (by weekday)/monthly (by day or nth weekday).
        </p>
      </div>

      {/* Edit base event (inline panel when open) */}
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
          <Row>
            <span>Starts</span>
            <DateTimeRow
              valueIso={ed.starts_at}
              onChange={(v)=> {
                const dur = new Date(ed.ends_at) - new Date(ed.starts_at);
                const start = new Date(v);
                const end = new Date(start.getTime() + dur);
                setEd({ ...ed, starts_at: start.toISOString(), ends_at: end.toISOString() });
              }}
            />
          </Row>
          <Row>
            <Label>
              Frequency
              <select value={ed.recur_freq || "none"} onChange={(e)=>setEd({ ...ed, recur_freq: e.target.value })} style={styles.select}>
                {FREQUENCIES.map((f)=> <option key={f} value={f}>{f}</option>)}
              </select>
            </Label>
            <Label>
              Interval
              <Input type="number" min={1} value={ed.recur_interval || 1} onChange={(e)=>setEd({ ...ed, recur_interval: Number(e.target.value) })} style={{ width: 120 }} />
            </Label>
            {ed.recur_freq === "weekly" && (
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                {BYDAY.map((d)=> {
                  const cur = Array.isArray(ed.recur_byday) ? ed.recur_byday : [];
                  const chk = cur.includes(d);
                  return (
                    <label key={d} style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                      <input
                        type="checkbox"
                        checked={chk}
                        onChange={()=>{
                          const next = chk ? cur.filter(x=>x!==d) : [...cur, d].sort();
                          setEd({ ...ed, recur_byday: next });
                        }}
                      />
                      <span>{d}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {ed.recur_freq === "monthly" && (
              <Row>
                <Label>By month-day
                  <Input type="number" min={1} max={31} value={ed.recur_bymonthday || 0} onChange={(e)=>setEd({ ...ed, recur_bymonthday: Number(e.target.value) || null })} style={{ width: 120 }} />
                </Label>
                <Label>or week-of-month (1..4, -1=last)
                  <Input type="number" min={-1} max={4} value={ed.recur_week_of_month || 0} onChange={(e)=>setEd({ ...ed, recur_week_of_month: Number(e.target.value) || null })} style={{ width: 140 }} />
                </Label>
                <Label>Weekday
                  <select value={(Array.isArray(ed.recur_byday) && ed.recur_byday[0]) || "MO"} onChange={(e)=>setEd({ ...ed, recur_byday: [e.target.value] })} style={styles.select}>
                    {BYDAY.map((d)=> <option key={d} value={d}>{d}</option>)}
                  </select>
                </Label>
              </Row>
            )}
            <Label>Until
              <Input
                type="date"
                value={ed.recur_until ? splitLocal(ed.recur_until).date : ""}
                onChange={(e)=>setEd({ ...ed, recur_until: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null })}
              />
            </Label>
            <Label>Count
              <Input type="number" min={1} value={ed.recur_count || ""} onChange={(e)=>setEd({ ...ed, recur_count: e.target.value ? Number(e.target.value) : null })} style={{ width: 120 }} />
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
                <GhostButton onClick={() => editOne(occ)}>Edit occurrence</GhostButton>
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
