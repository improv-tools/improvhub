// src/teams/components/CalendarPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { Button, GhostButton, DangerButton, Label, Input, ErrorText, InfoText, Row } from "components/ui";
import {
  fetchTeamEvents,
  createTeamEvent,
  deleteTeamEvent,
} from "../teams.api";

/** Combine a local date+time into an ISO string (uses browser tz). */
function combineLocal(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const iso = `${dateStr}T${timeStr}:00`;
  const d = new Date(iso); // interpreted in the user's local timezone
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const browserTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export default function CalendarPanel({ team }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // create form
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60); // minutes
  const [saving, setSaving] = useState(false);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return events.filter(e => new Date(e.ends_at).getTime() >= now);
  }, [events]);

  useEffect(() => {
    if (!team?.id) return;
    (async () => {
      setErr(""); setMsg(""); setLoading(true);
      try {
        const data = await fetchTeamEvents(team.id);
        setEvents(data);
      } catch (e) {
        setErr(e.message || "Failed to load events");
      } finally {
        setLoading(false);
      }
    })();
  }, [team?.id]);

  const addEvent = async () => {
    setErr(""); setMsg("");
    if (!title.trim() || !date || !time) return;
    const startIso = combineLocal(date, time);
    if (!startIso) { setErr("Invalid date/time"); return; }
    const startMs = Date.parse(startIso);
    const endMs = startMs + (Number(duration) || 60) * 60 * 1000;
    const payload = {
      title: title.trim(),
      description: "",
      location: "",
      category: "rehearsal", // adjust if you use others
      tz: browserTZ,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      recur_freq: "none",
      recur_interval: 1,
    };
    setSaving(true);
    try {
      const created = await createTeamEvent(team.id, payload);
      setEvents((es) => [...es, created].sort((a,b) => new Date(a.starts_at) - new Date(b.starts_at)));
      setTitle(""); setDate(""); setTime(""); setDuration(60);
      setMsg("Event created.");
    } catch (e) {
      setErr(e.message || "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  const removeEvent = async (id) => {
    if (!window.confirm("Delete this event?")) return;
    setErr(""); setMsg("");
    try {
      await deleteTeamEvent(id);
      setEvents((es) => es.filter(e => e.id !== id));
      setMsg("Event deleted.");
    } catch (e) {
      setErr(e.message || "Failed to delete event");
    }
  };

  if (loading) return <p style={{ opacity: 0.8 }}>Loading calendar…</p>;

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Calendar</h3>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.8 }}>Create event</h4>
        <Row>
          <Input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} style={{ minWidth: 200 }} />
          <Input type="date" value={date} onChange={e=>setDate(e.target.value)} />
          <Input type="time" value={time} onChange={e=>setTime(e.target.value)} />
          <Input type="number" min={15} step={15} value={duration} onChange={e=>setDuration(e.target.value)} style={{ width: 120 }} />
          <Button onClick={addEvent} disabled={saving || !title.trim() || !date || !time}>
            {saving ? "Saving…" : "Add"}
          </Button>
        </Row>
        <p style={{ opacity: 0.6, fontSize: 12, marginTop: 8 }}>
          Times saved in UTC. Event timezone recorded as <code>{browserTZ}</code> for later display.
        </p>
      </div>

      {upcoming.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No upcoming events.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {upcoming.map((e) => {
            const start = new Date(e.starts_at);
            const end = new Date(e.ends_at);
            const range = `${start.toLocaleString()} – ${end.toLocaleTimeString()}`;
            return (
              <li key={e.id} style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                padding: 12,
                marginBottom: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{e.title || "(untitled)"}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>{range} ({e.tz || "UTC"})</div>
                </div>
                <Row>
                  <DangerButton onClick={() => removeEvent(e.id)}>Delete</DangerButton>
                </Row>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
