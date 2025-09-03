// src/teams/components/CalendarPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { Button, GhostButton, Input, ErrorText, DangerButton, InfoText } from "components/ui";
import { fmtTime, toLocalInput, splitLocal, combineLocal, minutesBetween } from "teams/utils/datetime";

const MAJOR_TIMEZONES = [
  "Europe/London","UTC","America/New_York","America/Chicago","America/Los_Angeles","America/Toronto",
  "America/Sao_Paulo","Europe/Paris","Europe/Berlin","Europe/Madrid","Europe/Rome",
  "Asia/Tokyo","Asia/Seoul","Asia/Hong_Kong","Asia/Singapore","Asia/Kolkata",
  "Australia/Sydney","Pacific/Auckland","Africa/Johannesburg",
];

function monthsBetweenInclusive(startISO, endISO) {
  const s = new Date(startISO), e = new Date(endISO);
  let m = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) m -= 1;
  return Math.max(0, m);
}

export default function CalendarPanel({
  team,
  occurrencesAll,
  upcomingOcc,
  pastSlice, pastHasMore, onPastMore,
  createEvent, deleteSeries, deleteOccurrence, patchOccurrence, refreshCalendar,
  // helpers from hook (may be undefined; panel has fallbacks too):
  getEventById, summarizeRecurrence, countFutureOccurrencesInSeries,
  applyFutureEdits, applySeriesEdits,
}) {
  // Tabs
  const [tab, setTab] = useState("upcoming"); // 'upcoming' | 'past'
  useEffect(() => {
    setEditingKey(null);
    setEdit(null);
    setExpanded(new Set());
    setFormErr("");
    setSaveMsg("");
  }, [tab]);

  // Add form state
  const defaultTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [loc, setLoc] = useState("");
  const [cat, setCat] = useState("rehearsal");
  const [tz, setTz] = useState(defaultTZ);

  const [sDate, setSDate] = useState("");
  const [sTime, setSTime] = useState("");
  const [eDate, setEDate] = useState("");
  const [eTime, setETime] = useState("");
  const [durMin, setDurMin] = useState(60);

  const [freq, setFreq] = useState("none"); // none | weekly | monthly
  const [interval, setInterval] = useState(1);
  const [byDay, setByDay] = useState(["MO"]);
  const [monthMode, setMonthMode] = useState("bymonthday"); // bymonthday | bynth
  const [byMonthDay, setByMonthDay] = useState([1]);
  const [weekOfMonth, setWeekOfMonth] = useState(1);
  const [dayOfWeek, setDayOfWeek] = useState("MO");
  const [endMode, setEndMode] = useState("never"); // never | until | count
  const [until, setUntil] = useState("");
  const [count, setCount] = useState(10);

  const [formErr, setFormErr] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  // keep end synced when start changes
  const startLocal = combineLocal(sDate, sTime);
  const endLocal   = combineLocal(eDate, eTime);

  const onChangeStartDate = (v) => {
    setSDate(v);
    if (v && sTime) {
      const start = new Date(combineLocal(v, sTime));
      const end = new Date(start.getTime() + durMin * 60000);
      const n = splitLocal(toLocalInput(end));
      setEDate(n.date); setETime(n.time);
    }
  };
  const onChangeStartTime = (v) => {
    setSTime(v);
    if (sDate && v) {
      const start = new Date(combineLocal(sDate, v));
      const end = new Date(start.getTime() + durMin * 60000);
      const n = splitLocal(toLocalInput(end));
      setEDate(n.date); setETime(n.time);
    }
  };
  const onChangeEndDate = (v) => {
    setEDate(v);
    if (sDate && sTime && v && eTime) {
      const start = new Date(combineLocal(sDate, sTime));
      const end = new Date(combineLocal(v, eTime));
      const d = (end - start) / 60000;
      if (d > 0) setDurMin(d);
    }
  };
  const onChangeEndTime = (v) => {
    setETime(v);
    if (sDate && sTime && eDate && v) {
      const start = new Date(combineLocal(sDate, sTime));
      const end = new Date(combineLocal(eDate, v));
      const d = (end - start) / 60000;
      if (d > 0) setDurMin(d);
    }
  };

  // Validation: base + recurrence guardrails
  const inlineError = useMemo(() => {
    if (!showAdd) return "";
    if (!title.trim()) return "Title is required.";
    if (!startLocal || !endLocal) return "Start and end are required.";
    if (new Date(startLocal) < new Date()) return "Start time is in the past.";
    if (new Date(endLocal) <= new Date(startLocal)) return "End must be after start.";

    if (freq !== "none") {
      if (endMode === "never") return "Repeating events must have an end (count or until).";
      if (endMode === "count" && (!count || count < 1 || count > 12))
        return "Occurrences must be between 1 and 12.";
      if (endMode === "until") {
        if (!until) return "Please choose an 'until' date.";
        const months = monthsBetweenInclusive(startLocal, new Date(until).toISOString());
        if (months > 12) return "Repeating events must end within 12 months.";
      }
    }
    return "";
  }, [showAdd, title, startLocal, endLocal, freq, endMode, count, until]);

  const saveEvent = async () => {
    setFormErr(""); setSaveMsg("");
    if (inlineError) { setFormErr(inlineError); return; }
    try {
      await createEvent({
        team_id: team.id,
        title: title.trim(),
        description: desc || null,
        location: loc || null,
        category: cat,
        tz,
        starts_at: new Date(startLocal).toISOString(),
        ends_at: new Date(endLocal).toISOString(),
        recur_freq: freq,
        recur_interval: interval,
        recur_byday: freq === "weekly" ? byDay : null,
        recur_bymonthday: (freq === "monthly" && monthMode === "bymonthday") ? byMonthDay : null,
        recur_week_of_month: (freq === "monthly" && monthMode === "bynth") ? weekOfMonth : null,
        recur_day_of_week: (freq === "monthly" && monthMode === "bynth") ? dayOfWeek : null,
        recur_count: endMode === "count" ? count : null,
        recur_until: endMode === "until" ? until : null,
      });
      // reset
      setShowAdd(false);
      setTitle(""); setDesc(""); setLoc(""); setCat("rehearsal");
      setSDate(""); setSTime(""); setEDate(""); setETime(""); setTz(defaultTZ);
      setFreq("none"); setInterval(1); setByDay(["MO"]);
      setMonthMode("bymonthday"); setByMonthDay([1]); setWeekOfMonth(1); setDayOfWeek("MO");
      setEndMode("never"); setUntil(""); setCount(10);
      setSaveMsg("Event created ✓"); setTimeout(()=>setSaveMsg(""), 1200);
    } catch (e) {
      setFormErr(e.message || "Failed to save event");
    }
  };

  // --- Editing (one open at a time) ---
  const [editingKey, setEditingKey] = useState(null); // `${prefix}${eventId}@${ms}`
  const [edit, setEdit] = useState(null);
  const [editErr, setEditErr] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set()); // title toggles

  const toggleExpanded = (rowKey) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(rowKey) ? n.delete(rowKey) : n.add(rowKey);
      return n;
    });
  };

  const startEdit = (occ, rowKey) => {
    setEditingKey(rowKey);
    setEditErr("");
    const s = splitLocal(toLocalInput(occ.occ_start));
    const e = splitLocal(toLocalInput(occ.occ_end));
    setEdit({
      title: occ.title, description: occ.description || "", location: occ.location || "",
      tz: occ.tz, category: occ.category,
      startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time,
      base: occ, // includes base_start + recur fields
    });
  };
  const cancelEdit = () => { setEditingKey(null); setEdit(null); setEditErr(""); setEditBusy(false); };

  const validateEditTimes = () => {
    const s = combineLocal(edit.startDate, edit.startTime);
    const e = combineLocal(edit.endDate, edit.endTime);
    if (!edit.title.trim()) return "Title required.";
    if (!s || !e) return "Start and end are required.";
    if (new Date(s) < new Date()) return "Start is in the past.";
    if (new Date(e) <= new Date(s)) return "End must be after start.";
    return "";
  };

  // Client-side fallbacks (if props not provided)
  const fallbackFutureEdits = async (eventId, fromBaseISO, patch) => {
    const fromMs = new Date(fromBaseISO).getTime();
    const now = Date.now();
    const targets = occurrencesAll.filter(o =>
      o.id === eventId &&
      (o.base_start?.getTime?.() ?? o.occ_start.getTime()) >= fromMs &&
      o.occ_end.getTime() >= now
    );
    for (const occ of targets) {
      await patchOccurrence(eventId, (occ.base_start || occ.occ_start).toISOString(), patch);
    }
  };
  const fallbackSeriesEdits = async (eventId, patch) => {
    const now = Date.now();
    const targets = occurrencesAll.filter(o => o.id === eventId && o.occ_end.getTime() >= now);
    for (const occ of targets) {
      await patchOccurrence(eventId, (occ.base_start || occ.occ_start).toISOString(), patch);
    }
  };

  // Save just this occurrence (or standalone)
  const saveOccurrenceOnly = async () => {
    const err = validateEditTimes();
    if (err) { setEditErr(err); return; }
    setEditBusy(true); setEditErr("");
    try {
      const sISO = new Date(combineLocal(edit.startDate, edit.startTime)).toISOString();
      const eISO = new Date(combineLocal(edit.endDate, edit.endTime)).toISOString();
      await patchOccurrence(edit.base.id, (edit.base.base_start || edit.base.occ_start).toISOString(), {
        title: edit.title, description: edit.description || null, location: edit.location || null,
        tz: edit.tz, category: edit.category, starts_at: sISO, ends_at: eISO,
      });
      cancelEdit();
      await refreshCalendar();
    } catch (e) {
      setEditErr(e.message || "Save failed");
    } finally { setEditBusy(false); }
  };

  // Save from now on (series)
  const saveFuture = async () => {
    const err = validateEditTimes();
    if (err) { setEditErr(err); return; }
    if (!window.confirm("Apply these changes to all FUTURE occurrences in this team’s series? This affects the whole team.")) return;
    setEditBusy(true); setEditErr("");
    try {
      const sISO = new Date(combineLocal(edit.startDate, edit.startTime)).toISOString();
      const eISO = new Date(combineLocal(edit.endDate, edit.endTime)).toISOString();
      const patch = {
        title: edit.title, description: edit.description || null, location: edit.location || null,
        tz: edit.tz, category: edit.category, starts_at: sISO, ends_at: eISO,
      };
      if (typeof applyFutureEdits === "function") {
        await applyFutureEdits(edit.base.id, (edit.base.base_start || edit.base.occ_start).toISOString(), patch);
      } else {
        await fallbackFutureEdits(edit.base.id, (edit.base.base_start || edit.base.occ_start).toISOString(), patch);
      }
      cancelEdit();
      await refreshCalendar();
    } catch (e) {
      setEditErr(e.message || "Save failed");
    } finally { setEditBusy(false); }
  };

  // Save entire series (in loaded range)
  const saveSeries = async () => {
    const err = validateEditTimes();
    if (err) { setEditErr(err); return; }
    if (!window.confirm("Apply these changes to the ENTIRE team series in the loaded range? This affects the whole team.")) return;
    setEditBusy(true); setEditErr("");
    try {
      const sISO = new Date(combineLocal(edit.startDate, edit.startTime)).toISOString();
      const eISO = new Date(combineLocal(edit.endDate, edit.endTime)).toISOString();
      const patch = {
        title: edit.title, description: edit.description || null, location: edit.location || null,
        tz: edit.tz, category: edit.category, starts_at: sISO, ends_at: eISO,
      };
      if (typeof applySeriesEdits === "function") {
        await applySeriesEdits(edit.base.id, patch);
      } else {
        await fallbackSeriesEdits(edit.base.id, patch);
      }
      cancelEdit();
      await refreshCalendar();
    } catch (e) {
      setEditErr(e.message || "Save failed");
    } finally { setEditBusy(false); }
  };

  // Delete helpers then close editor
  const confirmDeleteOccurrence = async (occ) => {
    if (!window.confirm("Delete this occurrence for everyone on the team?")) return;
    try {
      await deleteOccurrence(occ.id, (occ.base_start || occ.occ_start).toISOString());
    } finally {
      cancelEdit();
      await refreshCalendar();
    }
  };

  const confirmDeleteSeries = async (eventId) => {
    const ev = typeof getEventById === "function" ? getEventById(eventId) : null;
    const summary = ev && typeof summarizeRecurrence === "function" ? summarizeRecurrence(ev) : "";
    const remaining = typeof countFutureOccurrencesInSeries === "function"
      ? countFutureOccurrencesInSeries(eventId)
      : occurrencesAll.filter(o => o.id === eventId && o.occ_end.getTime() >= Date.now()).length;

    if (!window.confirm(
      `Delete the ENTIRE series for the team?\n\n${ev?.title || "This series"}${summary ? ` — ${summary}` : ""}\nThis will remove ${remaining} future occurrence(s).`
    )) return;

    try {
      if (typeof deleteSeries === "function") {
        await deleteSeries(eventId);
      } else {
        // Fallback: cancel all future occurrences
        const now = Date.now();
        const targets = occurrencesAll.filter(o => o.id === eventId && o.occ_end.getTime() >= now);
        for (const occ of targets) {
          await deleteOccurrence(eventId, (occ.base_start || occ.occ_start).toISOString());
        }
      }
    } finally {
      cancelEdit();
      await refreshCalendar();
    }
  };

  // Render helpers
  const DateAndTime = ({ occ }) => {
    const dateStr = occ.occ_start.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
    const mins = minutesBetween(occ.occ_start, occ.occ_end);
    const duration = mins < 180 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${(mins / 60).toFixed(1)}h`;
    return (
      <div style={{ opacity: 0.8, fontSize: 12 }}>
        {dateStr} · {fmtTime(occ.occ_start, occ.tz)}–{fmtTime(occ.occ_end, occ.tz)} ({occ.tz}, {duration})
        {occ.location ? ` · ${occ.location}` : ""}
      </div>
    );
  };

  const renderDetailsBlock = (occ, isExpanded) => {
    if (!isExpanded) return null;
    return (
      <div style={{ marginTop: 6, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
        <div style={{ opacity: 0.9, fontSize: 13, whiteSpace: "pre-wrap" }}>
          {occ.description?.trim() ? occ.description : <span style={{ opacity: 0.7 }}>(No description)</span>}
        </div>
      </div>
    );
  };

  const renderEventRow = (occ, { past }) => {
    const prefix = past ? "past|" : "";
    const rowKey = `${prefix}${occ.id}@${occ.occ_start.getTime()}`;
    const isEditing = editingKey === rowKey;
    const isExpanded = expanded.has(rowKey);
    const isSeries = (occ.recur_freq && occ.recur_freq !== "none");

    return (
      <li key={rowKey} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", opacity: past ? 0.55 : 1 }}>
        {/* Summary line */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div>
            <button
              type="button"
              onClick={() => toggleExpanded(rowKey)}
              style={{ all: "unset", cursor: "pointer", fontWeight: 700 }}
              title={isExpanded ? "Hide details" : "Show details"}
            >
              {occ.title}
            </button>{" "}
            <span style={{ opacity: 0.7 }}>({occ.category})</span>
            <DateAndTime occ={occ} />
            {renderDetailsBlock(occ, isExpanded)}
          </div>

          {/* Actions */}
          {!past && (
            <div style={{ display: "flex", gap: 8 }}>
              {!isEditing && <GhostButton onClick={() => startEdit(occ, rowKey)}>Edit</GhostButton>}
            </div>
          )}
          {past && (
            <div style={{ display: "flex", gap: 8 }}>
              <DangerButton onClick={() => confirmDeleteOccurrence(occ)}>Delete</DangerButton>
            </div>
          )}
        </div>

        {/* Edit panel (only one at a time) */}
        {!past && isEditing && (
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {editErr && <ErrorText>{editErr}</ErrorText>}
            <Input placeholder="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            <Input placeholder="Description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <Input placeholder="Location" value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                value={edit.category}
                onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                style={styles.select}
              >
                <option value="rehearsal">Rehearsal</option>
                <option value="social">Social</option>
                <option value="performance">Performance</option>
              </select>
              <select
                value={edit.tz}
                onChange={(e) => setEdit({ ...edit, tz: e.target.value })}
                style={styles.select}
              >
                {MAJOR_TIMEZONES.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>

            {/* Date+Time */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label>Start:&nbsp;
                <input type="date" value={edit.startDate} onChange={(e) => {
                  const v = e.target.value;
                  const oldStart = combineLocal(edit.startDate, edit.startTime);
                  const oldEnd   = combineLocal(edit.endDate, edit.endTime);
                  const dur = (new Date(oldEnd) - new Date(oldStart)) || 60*60000;
                  const start = combineLocal(v, edit.startTime);
                  if (start) {
                    const nextEnd = new Date(new Date(start).getTime() + dur);
                    const n = splitLocal(toLocalInput(nextEnd));
                    setEdit({ ...edit, startDate: v, endDate: n.date, endTime: n.time });
                  } else setEdit({ ...edit, startDate: v });
                }}/>
              </label>
              <input type="time" step="60" value={edit.startTime} onChange={(e) => {
                const v = e.target.value;
                const oldStart = combineLocal(edit.startDate, edit.startTime);
                const oldEnd   = combineLocal(edit.endDate, edit.endTime);
                const dur = (new Date(oldEnd) - new Date(oldStart)) || 60*60000;
                const start = combineLocal(edit.startDate, v);
                if (start) {
                  const nextEnd = new Date(new Date(start).getTime() + dur);
                  const n = splitLocal(toLocalInput(nextEnd));
                  setEdit({ ...edit, startTime: v, endDate: n.date, endTime: n.time });
                } else setEdit({ ...edit, startTime: v });
              }}/>
              <label style={{ marginLeft: 12 }}>End:&nbsp;
                <input type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })}/>
              </label>
              <input type="time" step="60" value={edit.endTime} onChange={(e) => setEdit({ ...edit, endTime: e.target.value })}/>
            </div>

            {/* Save options + Delete (in edit) */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={saveOccurrenceOnly} disabled={editBusy}>
                {(edit?.base?.recur_freq && edit.base.recur_freq !== "none") ? "Save this occurrence" : "Save"}
              </Button>
              {(edit?.base?.recur_freq && edit.base.recur_freq !== "none") && (
                <>
                  <Button onClick={saveFuture} disabled={editBusy}>Save from now on (series)</Button>
                  <Button onClick={saveSeries} disabled={editBusy}>Save entire series</Button>
                </>
              )}
              <DangerButton onClick={() => confirmDeleteOccurrence(edit.base)} disabled={editBusy}>
                Delete (this occurrence)
              </DangerButton>
              {(edit?.base?.recur_freq && edit.base.recur_freq !== "none") && (
                <DangerButton onClick={() => confirmDeleteSeries(edit.base.id)} disabled={editBusy}>
                  Delete series…
                </DangerButton>
              )}
              <GhostButton onClick={cancelEdit} disabled={editBusy}>Cancel</GhostButton>
            </div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>
              Note: These actions affect <strong>the whole team</strong>, not just you.
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <h3 style={{ margin: "8px 0", fontSize: 16 }}>Calendar</h3>

      {/* Tabs: Upcoming / Past */}
      <div style={{ display: "flex", gap: 8, margin: "6px 0 10px" }}>
        <button onClick={() => setTab("upcoming")} style={tab==="upcoming" ? styles.tabActive : styles.tabBtn}>Upcoming</button>
        <button onClick={() => setTab("past")} style={tab==="past" ? styles.tabActive : styles.tabBtn}>Past</button>
      </div>

      {saveMsg && <InfoText>{saveMsg}</InfoText>}
      {tab === "upcoming" ? (
        <>
          {upcomingOcc.length === 0 ? (
            <p style={{ opacity: 0.8 }}>No upcoming events.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {upcomingOcc.map(occ => renderEventRow(occ, { past: false }))}
            </ul>
          )}

          {/* Add event */}
          <div style={{ marginTop: 12 }}>
            {!showAdd ? (
              <GhostButton onClick={() => setShowAdd(true)}>+ Add event</GhostButton>
            ) : (
              <>
                {(inlineError || formErr) && <ErrorText>{inlineError || formErr}</ErrorText>}
                <div style={{ display: "grid", gap: 8 }}>
                  <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <Input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
                  <Input placeholder="Location (optional)" value={loc} onChange={(e) => setLoc(e.target.value)} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select value={cat} onChange={(e) => setCat(e.target.value)} style={styles.select}>
                      <option value="rehearsal">Rehearsal</option>
                      <option value="social">Social</option>
                      <option value="performance">Performance</option>
                    </select>
                    <select value={tz} onChange={(e) => setTz(e.target.value)} style={styles.select}>
                      {MAJOR_TIMEZONES.map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <label>Start:&nbsp;<input type="date" value={sDate} onChange={(e)=>onChangeStartDate(e.target.value)} /></label>
                    <input type="time" step="60" value={sTime} onChange={(e)=>onChangeStartTime(e.target.value)} />
                    <label style={{ marginLeft: 12 }}>End:&nbsp;<input type="date" value={eDate} onChange={(e)=>onChangeEndDate(e.target.value)} /></label>
                    <input type="time" step="60" value={eTime} onChange={(e)=>onChangeEndTime(e.target.value)} />
                  </div>

                  {/* Recurrence UI */}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ opacity: 0.8 }}>Repeat:</span>
                      <select value={freq} onChange={(e) => setFreq(e.target.value)} style={styles.select}>
                        <option value="none">Does not repeat</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>

                      {freq === "weekly" && (
                        <>
                          <span style={{ opacity: 0.8 }}>every</span>
                          <Input type="number" min={1} value={interval} onChange={(e)=>setInterval(parseInt(e.target.value || "1",10))} style={{ width: 70 }} />
                          <span style={{ opacity: 0.8 }}>week(s) on</span>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {["MO","TU","WE","TH","FR","SA","SU"].map(code => (
                              <label key={code} style={{ display:"inline-flex", gap:6, alignItems:"center", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, padding:"4px 8px" }}>
                                <input
                                  type="checkbox"
                                  checked={byDay.includes(code)}
                                  onChange={(e)=> setByDay(prev => e.target.checked ? [...new Set([...prev, code])] : prev.filter(x=>x!==code))}
                                />
                                {code}
                              </label>
                            ))}
                          </div>
                        </>
                      )}

                      {freq === "monthly" && (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ opacity: 0.8 }}>every</span>
                            <Input type="number" min={1} value={interval} onChange={(e)=>setInterval(parseInt(e.target.value || "1",10))} style={{ width: 70 }} />
                            <span style={{ opacity: 0.8 }}>month(s)</span>
                          </div>
                          <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                            <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                              <input type="radio" checked={monthMode==="bymonthday"} onChange={()=>setMonthMode("bymonthday")} />
                              By date:
                              <Input
                                type="text"
                                value={byMonthDay.join(",")}
                                onChange={(e)=>{
                                  const arr = e.target.value.split(",").map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n));
                                  setByMonthDay(arr.length?arr:[1]);
                                }}
                                placeholder="e.g. 1 or 1,15,30"
                                style={{ width: 160 }}
                              />
                            </label>
                            <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                              <input type="radio" checked={monthMode==="bynth"} onChange={()=>setMonthMode("bynth")} />
                              By weekday:
                              <select value={weekOfMonth} onChange={(e)=>setWeekOfMonth(parseInt(e.target.value,10))} style={styles.select}>
                                <option value={1}>1st</option><option value={2}>2nd</option><option value={3}>3rd</option><option value={4}>4th</option><option value={5}>5th</option><option value={-1}>Last</option>
                              </select>
                              <select value={dayOfWeek} onChange={(e)=>setDayOfWeek(e.target.value)} style={styles.select}>
                                {["SU","MO","TU","WE","TH","FR","SA"].map(code => <option key={code} value={code}>{code}</option>)}
                              </select>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* End conditions with limits */}
                    {freq !== "none" && (
                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                        <span style={{ opacity: 0.8 }}>Ends:</span>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input type="radio" checked={endMode==="never"} onChange={()=>setEndMode("never")} /> Never (disabled)
                        </label>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input type="radio" checked={endMode==="until"} onChange={()=>setEndMode("until")} /> Until
                          <input type="date" value={until} onChange={(e)=>setUntil(e.target.value)} disabled={endMode!=="until"} />
                          <span style={{ opacity: 0.7, fontSize: 12 }}>(≤ 12 months)</span>
                        </label>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input type="radio" checked={endMode==="count"} onChange={()=>setEndMode("count")} /> For
                          <Input type="number" min={1} max={12} value={count} onChange={(e)=>setCount(parseInt(e.target.value || "1",10))} style={{ width: 80 }} />
                          occurrence(s) (max 12)
                        </label>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <Button onClick={saveEvent} disabled={!!inlineError}>Save event</Button>
                    <GhostButton onClick={() => setShowAdd(false)}>Cancel</GhostButton>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        // PAST tab
        <>
          {pastSlice.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No past events in the loaded range.</p>
          ) : (
            <>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {pastSlice.map((occ) => renderEventRow(occ, { past: true }))}
              </ul>
              {pastHasMore && (
                <div style={{ marginTop: 10 }}>
                  <GhostButton onClick={onPastMore}>Get more</GhostButton>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
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
  tabBtn: {
    background: "transparent",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
  },
  tabActive: {
    background: "transparent",
    color: "white",
    border: "1px solid rgba(255,255,255,0.4)",
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
  },
};
