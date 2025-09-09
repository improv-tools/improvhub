// src/teams/components/CalendarPanel.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, Input, ErrorText, InfoText } from "components/ui";
import { useCalendarData } from "teams/hooks/useCalendarData";
import { toLocalInput, splitLocal, combineLocal, fmtTime, minutesBetween } from "teams/utils/datetime";
import { createTeamEvent, deleteTeamEvent } from "teams/teams.api";

export default function CalendarPanel({ team }) {
  const [rangeMonths, setRangeMonths] = useState(2);
  const now = new Date();
  const startISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + rangeMonths, 1));
  const endISO = end.toISOString();

  const { occurrences, loading, err, events, refresh } = useCalendarData(team?.id, { start: startISO, end: endISO });

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [loc, setLoc] = useState("");
  const [cat, setCat] = useState("rehearsal");
  const [localStart, setLocalStart] = useState(toLocalInput(new Date()));
  const [localEnd, setLocalEnd] = useState(toLocalInput(new Date(Date.now() + 60*60*1000)));

  async function addEvent() {
    const [d1,t1] = splitLocal(localStart);
    const [d2,t2] = splitLocal(localEnd);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const starts_at = combineLocal(d1, t1, tz);
    const ends_at = combineLocal(d2, t2, tz);
    await createTeamEvent({
      team_id: team.id,
      title, description: desc, location: loc, category: cat,
      starts_at, ends_at, tz,
      recur_freq: "none", recur_interval: 1,
    });
    setShowAdd(false); setTitle(""); setDesc(""); setLoc("");
    await refresh();
  }

  async function removeEvent(id) {
    if (!confirm("Delete this event?")) return;
    await deleteTeamEvent(id);
    await refresh();
  }

  const byEvent = useMemo(()=>{
    const m = new Map();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <h2 style={{ margin:0, fontSize:20 }}>Calendar</h2>
        <div>
          <GhostButton onClick={()=>setShowAdd(v=>!v)}>{showAdd ? "Close" : "Add event"}</GhostButton>
        </div>
      </div>

      {showAdd && (
        <div style={{ display:"grid", gap:8, marginBottom:12 }}>
          <Input placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} />
          <Input placeholder="Description" value={desc} onChange={e=>setDesc(e.target.value)} />
          <Input placeholder="Location" value={loc} onChange={e=>setLoc(e.target.value)} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <Input type="datetime-local" value={localStart} onChange={e=>setLocalStart(e.target.value)} />
            <Input type="datetime-local" value={localEnd} onChange={e=>setLocalEnd(e.target.value)} />
          </div>
          <Button onClick={addEvent} disabled={!title.trim()}>Create</Button>
        </div>
      )}

      {err && <ErrorText>{err}</ErrorText>}
      {loading && <InfoText>Loading…</InfoText>}

      {!loading && occurrences.length === 0 && <InfoText>No events upcoming.</InfoText>}

      <div style={{ display:"grid", gap:8 }}>
        {occurrences.map((o, idx) => {
          const base = byEvent.get(o.id);
          return (
            <div key={idx} style={{ border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, padding:10 }}>
              <div style={{ fontWeight:600 }}>{base?.title}</div>
              <div style={{ opacity:0.8, fontSize:12 }}>
                {fmtTime(o.occ_start)} → {fmtTime(o.occ_end)} · {base?.location || "—"}
              </div>
              <div style={{ marginTop:6 }}>
                <DangerButton onClick={()=>removeEvent(base.id)}>Delete base event</DangerButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
