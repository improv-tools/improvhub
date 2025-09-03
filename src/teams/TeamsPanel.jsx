// src/teams/TeamsPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "auth/AuthContext";
import {
  listMyTeams,
  createTeam,
  listTeamMembersRPC,
  setMemberRoleRPC,
  renameTeamRPC,
  deleteTeamRPC,
  addMemberByEmailRPC,
  listTeamEvents,
  createTeamEvent,
  deleteTeamEvent,
  listTeamEventOverrides,
  deleteEventOccurrence,
  upsertOccurrenceOverride,
  splitEventSeries,
} from "teams/teams.api";
import {
  H1,
  Row,
  Button,
  GhostButton,
  Input,
  InfoText,
  ErrorText,
  DangerButton,
} from "components/ui";

/* ---------- helpers: time/recurrence on client ---------- */
const DOW = ["SU","MO","TU","WE","TH","FR","SA"];
function toIsoLocal(date) { return new Date(date).toISOString(); }
function fmtDT(d, tz, opts={}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", ...opts
  }).format(new Date(d));
}
function fmtTime(d, tz) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, hour: "2-digit", minute: "2-digit"
  }).format(new Date(d));
}
function minutesBetween(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  return Math.round(ms / 60000);
}
function nthWeekdayOfMonth(year, month /*0-11*/, weekday /*0-6*/, n /*1..5 or -1 last*/) {
  if (n === -1) {
    const last = new Date(Date.UTC(year, month+1, 0));
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month, last.getUTCDate() - diff));
  }
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n-1)*7;
  const dt = new Date(Date.UTC(year, month, day));
  if (dt.getUTCMonth() !== month) return null;
  return dt;
}

/** Expand base events into concrete occurrences inside [fromIso, toIso] */
function expandOccurrences(events, fromIso, toIso) {
  const from = new Date(fromIso), to = new Date(toIso);
  const out = [];
  for (const e of events) {
    const start = new Date(e.starts_at);
    const end = new Date(e.ends_at);
    const durMs = end - start;

    if (e.recur_freq === "none") {
      if (start >= from && start <= to) out.push({ ...e, occ_start: start, occ_end: new Date(start.getTime()+durMs) });
      continue;
    }

    let count = 0;
    const maxCount = e.recur_count || 1000; // safety cap
    const until = e.recur_until ? new Date(`${e.recur_until}T23:59:59Z`) : null;
    const interval = Math.max(1, e.recur_interval || 1);

    if (e.recur_freq === "weekly") {
      const by = (e.recur_byday && e.recur_byday.length) ? e.recur_byday : [DOW[start.getUTCDay()]];
      // find first week start on/after `from`
      const weekMs = 7*24*3600*1000;
      // align to the Monday of start's week (we'll still use DOW codes)
      const anchorWeekStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const anchorDow = anchorWeekStart.getUTCDay();
      const anchorMonday = new Date(anchorWeekStart.getTime() - ((anchorDow+6)%7)*24*3600*1000);

      // find the first candidate week >= from
      const weeksFromAnchor = Math.floor((from - anchorMonday) / weekMs);
      let k = Math.max(0, Math.floor(weeksFromAnchor / interval));
      while (true) {
        const thisWeek = new Date(anchorMonday.getTime() + k*interval*weekMs);
        for (const code of by) {
          const wday = DOW.indexOf(code);
          if (wday < 0) continue;
          const day = new Date(thisWeek.getTime() + ((wday+7)%7)*24*3600*1000);
          // copy time from original start
          const occStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
            start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
          const occEnd = new Date(occStart.getTime() + durMs);
          if (occStart > to) break;
          if ((until && occStart > until) || count >= maxCount) break;
          if (occEnd >= from && occStart <= to) {
            out.push({ ...e, occ_start: occStart, occ_end: occEnd });
            count++;
          }
        }
        // stop conditions
        const nextWeekStart = new Date(thisWeek.getTime() + interval*weekMs);
        if (nextWeekStart > to) break;
        if ((until && nextWeekStart > until) || count >= maxCount) break;
        k++;
      }
    } else if (e.recur_freq === "monthly") {
      const byMonthDay = e.recur_bymonthday && e.recur_bymonthday.length ? e.recur_bymonthday : [start.getUTCDate()];
      const byNth = e.recur_week_of_month ? { n: e.recur_week_of_month, dow: e.recur_day_of_week || DOW[start.getUTCDay()] } : null;
      // step month-by-month from the event's start
      let y = start.getUTCFullYear(), m = start.getUTCMonth();
      // fast-forward to first month where an occurrence could be >= from
      while (new Date(Date.UTC(y, m, 1)) < from) {
        m += interval; if (m > 11) { y += Math.floor(m/12); m = m % 12; }
        if ((until && new Date(Date.UTC(y, m, 1)) > until) || count >= maxCount) break;
      }
      while (true) {
        if (byNth) {
          const weekday = DOW.indexOf(byNth.dow);
          const dt = nthWeekdayOfMonth(y, m, weekday, byNth.n);
          if (dt) {
            const occStart = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
              start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
            const occEnd = new Date(occStart.getTime()+durMs);
            if (occStart > to) break;
            if ((until && occStart > until) || count >= maxCount) break;
            if (occEnd >= from && occStart <= to) { out.push({ ...e, occ_start: occStart, occ_end: occEnd }); count++; }
          }
        } else {
          for (const d of byMonthDay) {
            const dt = new Date(Date.UTC(y, m, d));
            if (dt.getUTCMonth() !== m) continue; // invalid day (e.g., Feb 30)
            const occStart = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
              start.getUTCHours(), start.getUTCMinutes(), start.getUTCHours()));
            occStart.setUTCHours(start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), 0);
            const occEnd = new Date(occStart.getTime()+durMs);
            if (occStart > to) break;
            if ((until && occStart > until) || count >= maxCount) break;
            if (occEnd >= from && occStart <= to) { out.push({ ...e, occ_start: occStart, occ_end: occEnd }); count++; }
          }
        }
        // next month block
        m += interval; if (m > 11) { y += Math.floor(m/12); m = m % 12; }
        const nextMonthStart = new Date(Date.UTC(y, m, 1));
        if (nextMonthStart > to) break;
        if ((until && nextMonthStart > until) || count >= maxCount) break;
      }
    }
  }
  // sort by occurrence start
  out.sort((a,b) => a.occ_start - b.occ_start);
  return out;
}
/* -------------------------------------------------------- */

export default function TeamsPanel() {
  const { session } = useAuth();
  const user = session?.user;

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // list view: create (hidden until toggled)
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // selection + members
  const [selected, setSelected] = useState(null); // { id, name, display_id, role }
  const [members, setMembers] = useState([]);

  // subtab inside team: 'members' | 'calendar'
  const [subTab, setSubTab] = useState("members");

  // rename (header)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // calendar state
  const [eventsBase, setEventsBase] = useState([]);
  const [calErr, setCalErr] = useState("");
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [overrides, setOverrides] = useState([]);

  // add event form fields
  const defaultTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [evTitle, setEvTitle] = useState("");
  const [evDesc, setEvDesc] = useState("");
  const [evLoc, setEvLoc] = useState("");
  const [evCat, setEvCat] = useState("rehearsal");
  const [evTZ, setEvTZ] = useState(defaultTZ);
  const [evStart, setEvStart] = useState(""); // "YYYY-MM-DDTHH:MM"
  const [evEnd, setEvEnd] = useState("");     // "YYYY-MM-DDTHH:MM"

  const [evFreq, setEvFreq] = useState("none");              // none|weekly|monthly
  const [evInterval, setEvInterval] = useState(1);           // 1,2,3...
  const [evByDay, setEvByDay] = useState(["MO"]);            // for weekly
  const [evMonthMode, setEvMonthMode] = useState("bymonthday"); // bymonthday|bynth
  const [evByMonthDay, setEvByMonthDay] = useState([1]);     // e.g. [15]
  const [evWeekOfMonth, setEvWeekOfMonth] = useState(1);     // 1..5 or -1
  const [evDayOfWeek, setEvDayOfWeek] = useState("MO");
  const [evEndMode, setEvEndMode] = useState("never");       // never|until|count
  const [evUntil, setEvUntil] = useState("");                // YYYY-MM-DD
  const [evCount, setEvCount] = useState(10);

  const refreshTeams = async () => {
    setErr("");
    try {
      const list = await listMyTeams(user.id);
      setTeams(list);
      setLoading(false);
      if (selected) {
        const s = list.find(t => t.id === selected.id);
        if (s) setSelected(s);
        else { setSelected(null); setMembers([]); }
      }
    } catch (e) {
      setErr(e.message || "Failed to load teams");
      setLoading(false);
    }
  };

  useEffect(() => { refreshTeams(); /* eslint-disable-next-line */ }, []);

  // keep rename draft and reset subtab/forms on team change
  useEffect(() => {
    if (selected) {
      setEditingName(false);
      setNameDraft(selected.name || "");
      setSubTab("members"); // default when opening a team
      setShowAddEvent(false);
    } else {
      setEditingName(false);
      setNameDraft("");
    }
  }, [selected?.id, selected?.name]);

  const openTeam = async (team) => {
    setSelected(team); setErr("");
    try {
      const mem = await listTeamMembersRPC(team.id);
      setMembers(mem);
    } catch (e) {
      setErr(e.message || "Failed to load members");
    }
  };

  const backToList = () => { setSelected(null); setMembers([]); };

  const createNewTeam = async () => {
    const value = newName.trim(); if (!value) return;
    setCreating(true); setErr("");
    try {
      const team = await createTeam(value);
      setNewName(""); setShowCreate(false);
      await refreshTeams(); await openTeam({ ...team, role: "admin" });
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally { setCreating(false); }
  };

  const doRename = async () => {
    if (!selected) return;
    const next = (nameDraft || "").trim();
    if (!next || next === selected.name) { setEditingName(false); return; }
    if (!window.confirm(`Rename team to “${next}”?`)) return;
    try {
      const updated = await renameTeamRPC(selected.id, next);
      setSelected(prev => prev && prev.id === updated.id ? { ...prev, name: updated.name } : prev);
      setEditingName(false);
      await refreshTeams();
    } catch (e) { setErr(e.message || "Rename failed"); }
  };

  // ---- Calendar: load base events and expand to occurrences (next 6 months)
  const windowFrom = useMemo(() => {
    const now = new Date(); now.setHours(0,0,0,0); return now.toISOString();
  }, []);
  const windowTo = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth()+6); d.setHours(23,59,59,999); return d.toISOString();
  }, []);

const refreshCalendar = async () => {
  if (!selected) return;
  setCalErr("");
  try {
    const evs = await listTeamEvents(selected.id, windowFrom, windowTo);
    setEventsBase(evs);

    // NEW: load per-occurrence overrides/cancellations
    const ovs = await listTeamEventOverrides(selected.id, windowFrom, windowTo);
    setOverrides(ovs);
  } catch (e) {
    setCalErr(e.message || "Failed to load events");
  }
};

  useEffect(() => {
    if (selected) refreshCalendar();
    // eslint-disable-next-line
  }, [selected?.id]);

const occurrences = useMemo(() => {
  const occ = expandOccurrences(eventsBase, windowFrom, windowTo);
  if (!overrides.length) return occ;

  // Index overrides by "eventId|occurrenceStartIso"
  const map = new Map();
  for (const o of overrides) {
    map.set(`${o.event_id}|${new Date(o.occ_start).toISOString()}`, o);
  }

  const out = [];
  for (const e of occ) {
    const key = `${e.id}|${e.occ_start.toISOString()}`;
    const o = map.get(key);
    if (!o) { out.push(e); continue; }
    if (o.canceled) continue; // skip this occurrence

    // Apply per-occurrence overrides
    out.push({
      ...e,
      title: o.title ?? e.title,
      description: o.description ?? e.description,
      location: o.location ?? e.location,
      tz: o.tz ?? e.tz,
      occ_start: o.starts_at ? new Date(o.starts_at) : e.occ_start,
      occ_end:   o.ends_at   ? new Date(o.ends_at)   : e.occ_end,
      category: o.category ?? e.category,
    });
  }

  out.sort((a,b) => a.occ_start - b.occ_start);
  return out;
}, [eventsBase, overrides, windowFrom, windowTo]);

  const saveEvent = async () => {
    if (!selected) return;
    // build payload
    const payload = {
      team_id: selected.id,
      title: evTitle.trim(),
      description: evDesc || null,
      location: evLoc || null,
      category: evCat,
      tz: evTZ,
      starts_at: new Date(evStart).toISOString(),
      ends_at: new Date(evEnd).toISOString(),
      recur_freq: evFreq,
      recur_interval: evInterval,
      recur_byday: evFreq === "weekly" ? evByDay : null,
      recur_bymonthday: (evFreq === "monthly" && evMonthMode === "bymonthday") ? evByMonthDay : null,
      recur_week_of_month: (evFreq === "monthly" && evMonthMode === "bynth") ? evWeekOfMonth : null,
      recur_day_of_week: (evFreq === "monthly" && evMonthMode === "bynth") ? evDayOfWeek : null,
      recur_count: evEndMode === "count" ? evCount : null,
      recur_until: evEndMode === "until" ? evUntil : null,
    };
    if (!payload.title || !evStart || !evEnd) { setCalErr("Please fill title, start and end."); return; }
    try {
      await createTeamEvent(payload);
      setShowAddEvent(false);
      // reset form
      setEvTitle(""); setEvDesc(""); setEvLoc(""); setEvCat("rehearsal");
      setEvStart(""); setEvEnd(""); setEvTZ(defaultTZ);
      setEvFreq("none"); setEvInterval(1); setEvByDay(["MO"]);
      setEvMonthMode("bymonthday"); setEvByMonthDay([1]); setEvWeekOfMonth(1); setEvDayOfWeek("MO");
      setEvEndMode("never"); setEvUntil(""); setEvCount(10);
      await refreshCalendar();
    } catch (e) {
      setCalErr(e.message || "Failed to create event");
    }
  };

  const removeEvent = async (evId) => {
    if (!window.confirm("Delete this event?")) return;
    try {
      await deleteTeamEvent(evId);
      await refreshCalendar();
    } catch (e) {
      setCalErr(e.message || "Failed to delete event");
    }
  };

  return (
    <>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          {selected && <GhostButton style={styles.backBtn} onClick={backToList}>← All teams</GhostButton>}
          {!selected && <H1 style={{ margin: 0 }}>Teams</H1>}
          {selected && !editingName && (
            <div style={styles.titleWrap}>
              <H1 style={styles.titleH1}>{selected.name}</H1>
              {selected.role === "admin" && (
                <button
                  aria-label="Rename team"
                  title="Rename team"
                  onClick={() => { setEditingName(true); setNameDraft(selected.name || ""); }}
                  style={styles.renameIcon}
                >✏️</button>
              )}
            </div>
          )}
          {selected && editingName && (
            <>
              <Input value={nameDraft} onChange={(e)=>setNameDraft(e.target.value)}
                     onKeyDown={async (e)=>{ if (e.key==="Enter") await doRename(); if (e.key==="Escape") setEditingName(false); }}
                     autoFocus style={{ minWidth: 220 }} />
              <Button onClick={doRename} disabled={!nameDraft.trim() || nameDraft.trim()===selected.name}>Save</Button>
              <GhostButton onClick={()=>{ setEditingName(false); setNameDraft(selected.name||""); }}>Cancel</GhostButton>
            </>
          )}
        </div>
      </div>

      {err && <ErrorText>{err}</ErrorText>}

      {!selected ? (
        <>
          {loading ? <p>Loading teams…</p> : teams.length === 0 ? (
            <p style={{ opacity: 0.8 }}>You don’t belong to any teams yet.</p>
          ) : (
            <ul style={{ listStyle:"none", padding:0, margin:"12px 0 0" }}>
              {teams.map(t => (
                <li key={t.id}
                    style={{ padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.06)", cursor:"pointer" }}
                    onClick={()=>openTeam(t)}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                    <div><strong>{t.name}</strong> <span style={{ opacity:0.7 }}>({t.display_id})</span></div>
                    <span style={{ opacity:0.7 }}>{t.role}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Create team (hidden until toggled) */}
          <div style={{ marginTop: 12 }} />
          {!showCreate ? (
            <GhostButton onClick={()=>setShowCreate(true)}>+ Create team</GhostButton>
          ) : (
            <>
              <div style={styles.inlineInvite}>
                <Input value={newName} onChange={(e)=>setNewName(e.target.value)}
                       placeholder="e.g. Writers Room"
                       onKeyDown={(e)=> e.key==="Enter" && createNewTeam()}
                       style={{ minWidth: 220 }} />
                <Button onClick={createNewTeam} disabled={creating || !newName.trim()}>
                  {creating ? "Creating…" : "Create"}
                </Button>
                <GhostButton onClick={()=>{ setShowCreate(false); setNewName(""); }}>Cancel</GhostButton>
              </div>
              <InfoText style={{ marginTop: 6 }}>Duplicates allowed. A unique id like <code>Name#1</code> is generated.</InfoText>
            </>
          )}
        </>
      ) : (
        <TeamDetail
          team={selected}
          members={members}
          currentUserId={user.id}
          subTab={subTab}
          setSubTab={setSubTab}
          onChangeRole={async (uId, role) => {
            try {
              await setMemberRoleRPC(selected.id, uId, role);
              const mem = await listTeamMembersRPC(selected.id);
              setMembers(mem);
              await refreshTeams();
            } catch (e) { setErr(e.message || "Failed to update role"); }
          }}
          // calendar props
          calErr={calErr}
          occurrences={occurrences}
          showAddEvent={showAddEvent}
          setShowAddEvent={setShowAddEvent}
          evState={{
            evTitle, setEvTitle, evDesc, setEvDesc, evLoc, setEvLoc, evCat, setEvCat,
            evTZ, setEvTZ, evStart, setEvStart, evEnd, setEvEnd,
            evFreq, setEvFreq, evInterval, setEvInterval,
            evByDay, setEvByDay, evMonthMode, setEvMonthMode,
            evByMonthDay, setEvByMonthDay, evWeekOfMonth, setEvWeekOfMonth,
            evDayOfWeek, setEvDayOfWeek, evEndMode, setEvEndMode, evUntil, setEvUntil, evCount, setEvCount
          }}
          onSaveEvent={saveEvent}
          onDeleteEvent={removeEvent}
          onDeleted={() => { setSelected(null); setMembers([]); refreshTeams(); }}
        />
      )}
    </>
  );
}

function TeamDetail({
  team, members, currentUserId, subTab, setSubTab,
  onChangeRole, calErr, occurrences,
  showAddEvent, setShowAddEvent, evState, onSaveEvent, onDeleteEvent, onDeleted
}) {
  const isAdmin = team.role === "admin";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const deleteTeam = async () => {
    if (!window.confirm(`Delete “${team.name}” permanently? This cannot be undone.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try { await deleteTeamRPC(team.id); onDeleted?.(); }
    catch (e) { setErr(e.message || "Delete failed"); }
    finally { setBusy(false); }
  };

  return (
    <>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        ID: <code>{team.display_id}</code> · Your role: <strong>{team.role}</strong>
      </p>

      {/* Sub-tabs */}
      <div style={{ display:"flex", gap:8, margin:"8px 0 12px" }}>
        <GhostButton onClick={()=>setSubTab("members")} style={subTab==="members"?styles.subActive:null}>Members</GhostButton>
        <GhostButton onClick={()=>setSubTab("calendar")} style={subTab==="calendar"?styles.subActive:null}>Calendar</GhostButton>
      </div>

      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {subTab === "members" ? (
        <>
          <h3 style={{ margin:"8px 0 8px", fontSize:16 }}>Members</h3>
          {members.length === 0 ? (
            <p style={{ opacity: 0.8 }}>No members yet.</p>
          ) : (
            <ul style={{ listStyle:"none", padding:0, margin:0 }}>
              {members.map(m => (
                <li key={m.user_id} style={{ padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center" }}>
                    <div style={{ display:"grid" }}>
                      <strong>{m.display_name || m.email || m.user_id}</strong>
                      <span style={{ opacity:0.7, fontSize:12 }}>{m.email || m.user_id}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ opacity:0.8 }}>{m.role}</span>
                      {team.role === "admin" && m.user_id !== currentUserId && (
                        <Button style={{ padding:"6px 10px" }}
                          onClick={()=> onChangeRole(m.user_id, m.role === "admin" ? "member" : "admin")}>
                          {m.role === "admin" ? "Make member" : "Make admin"}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Add member (toggle) */}
          <AddMemberRow teamId={team.id} />
          {isAdmin && (
            <div style={{ marginTop: 18 }}>
              <DangerButton onClick={deleteTeam} disabled={busy}>Delete team</DangerButton>
            </div>
          )}
        </>
      ) : (
        <CalendarPanel
          team={team}
          occurrences={occurrences}
          showAddEvent={showAddEvent}
          setShowAddEvent={setShowAddEvent}
          evState={evState}
          onSaveEvent={onSaveEvent}
          onDeleteEvent={onDeleteEvent}
          calErr={calErr}
        />
      )}
    </>
  );
}

function AddMemberRow({ teamId }) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");

  const add = async () => {
    const email = inviteEmail.trim(); if (!email) return;
    setInviting(true); setErr(""); setMsg("");
    try {
      await addMemberByEmailRPC(teamId, email, inviteRole);
      setInviteEmail(""); setInviteRole("member"); setMsg("Member added ✓");
      setTimeout(()=>setMsg(""),1500);
    } catch(e) { setErr(e.message || "Add failed"); }
    finally { setInviting(false); }
  };

  return (
    <>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}
      <div style={{ marginTop:12 }}>
        <GhostButton onClick={(e)=> {
          const row = e.currentTarget.nextSibling;
          row.style.display = row.style.display === "none" ? "flex" : "none";
        }}>+ Add member</GhostButton>
        <div style={{ display:"none", ...styles.inlineInvite }}>
          <Input placeholder="user@example.com" type="email"
                 value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}
                 onKeyDown={e=> e.key==="Enter" && add()} style={{ minWidth:220 }}/>
          <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={styles.select}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button onClick={add} disabled={inviting || !inviteEmail.trim()}>{inviting ? "Adding…" : "Add"}</Button>
        </div>
      </div>
    </>
  );
}

function CalendarPanel({ team, occurrences, showAddEvent, setShowAddEvent, evState, onSaveEvent, onDeleteEvent, calErr }) {
  const {
    evTitle, setEvTitle, evDesc, setEvDesc, evLoc, setEvLoc, evCat, setEvCat,
    evTZ, setEvTZ, evStart, setEvStart, evEnd, setEvEnd,
    evFreq, setEvFreq, evInterval, setEvInterval,
    evByDay, setEvByDay, evMonthMode, setEvMonthMode,
    evByMonthDay, setEvByMonthDay, evWeekOfMonth, setEvWeekOfMonth,
    evDayOfWeek, setEvDayOfWeek, evEndMode, setEvEndMode, evUntil, setEvUntil, evCount, setEvCount
  } = evState;

  // duration tracking (minutes)
  const [durMin, setDurMin] = useState(60);
  useEffect(() => {
    if (evStart && evEnd) {
      const d = (new Date(evEnd) - new Date(evStart)) / 60000;
      if (d > 0) setDurMin(d);
    }
  }, [evStart, evEnd]);

  const nowIso = new Date().toISOString();
  const [localErr, setLocalErr] = useState("");

  const validate = () => {
    setLocalErr("");
    if (!evTitle.trim()) return "Title is required.";
    if (!evStart || !evEnd) return "Start and end are required.";
    if (new Date(evStart) < new Date()) return "Start time is in the past.";
    if (new Date(evEnd) <= new Date(evStart)) return "End must be after start.";
    return "";
  };

  const onChangeStart = (val) => {
    setEvStart(val);
    // keep duration consistent (shift end)
    if (val) {
      const nextEnd = new Date(new Date(val).getTime() + durMin * 60000);
      setEvEnd(nextEnd.toISOString().slice(0,16));
    }
  };

  const onChangeEnd = (val) => {
    setEvEnd(val);
    if (evStart && val) {
      const d = (new Date(val) - new Date(evStart)) / 60000;
      if (d > 0) setDurMin(d);
    }
  };

  // EDIT occurrence state
  const [editingKey, setEditingKey] = useState(null); // `${eventId}|${occIso}`
  const [edit, setEdit] = useState(null); // {title, desc, ... start, end, tz, cat}
  const beginEdit = (occ) => {
    if (occ.occ_start < new Date()) { alert("Cannot edit a past occurrence."); return; }
    setEditingKey(`${occ.id}|${occ.occ_start.toISOString()}`);
    setEdit({
      title: occ.title,
      description: occ.description || "",
      location: occ.location || "",
      tz: occ.tz,
      starts_at: occ.occ_start.toISOString().slice(0,16),
      ends_at: occ.occ_end.toISOString().slice(0,16),
      category: occ.category,
      base: occ, // keep original
    });
  };
  const cancelEdit = () => { setEditingKey(null); setEdit(null); };

  const saveEditOccurrenceOnly = async () => {
    if (!edit) return;
    // validate
    if (!edit.title.trim()) return alert("Title required.");
    if (new Date(edit.starts_at) < new Date()) return alert("Start is in the past.");
    if (new Date(edit.ends_at) <= new Date(edit.starts_at)) return alert("End must be after start.");
    try {
      await upsertOccurrenceOverride(edit.base.id, edit.base.occ_start.toISOString(), {
        title: edit.title,
        description: edit.description || null,
        location: edit.location || null,
        tz: edit.tz,
        starts_at: new Date(edit.starts_at).toISOString(),
        ends_at: new Date(edit.ends_at).toISOString(),
        category: edit.category,
      });
      cancelEdit();
      window.dispatchEvent(new Event("refreshCalendar")); // signal parent
    } catch (e) { alert(e.message || "Failed to save occurrence."); }
  };

  const saveEditThisAndFuture = async () => {
    if (!edit) return;
    if (edit.base.recur_freq === "none") return saveEditOccurrenceOnly(); // no series to split
    if (!window.confirm("Apply these changes to this and all future occurrences?")) return;
    if (new Date(edit.starts_at) < new Date()) return alert("Start is in the past.");
    try {
      await splitEventSeries(
        edit.base,
        edit.base.occ_start.toISOString(),
        {
          title: edit.title,
          description: edit.description || null,
          location: edit.location || null,
          tz: edit.tz,
          starts_at: new Date(edit.starts_at).toISOString(),
          ends_at: new Date(edit.ends_at).toISOString(),
          category: edit.category,
        }
      );
      cancelEdit();
      window.dispatchEvent(new Event("refreshCalendar"));
    } catch (e) { alert(e.message || "Failed to update series."); }
  };

  // listen for refresh signal from edits
  useEffect(() => {
    const h = () => { /* parent controls actual reload via prop */ };
    window.addEventListener("refreshCalendar", h);
    return () => window.removeEventListener("refreshCalendar", h);
  }, []);

  const onClickDelete = async (occ) => {
    if (occ.recur_freq === "none") {
      if (!window.confirm("Delete this event?")) return;
      await onDeleteEvent(occ.id);
      return;
    }
    // two-step simple prompt
    if (window.confirm("Delete this occurrence only? (OK = this occurrence, Cancel = entire series)")) {
      await deleteEventOccurrence(occ.id, occ.occ_start.toISOString());
      window.dispatchEvent(new Event("refreshCalendar"));
    } else {
      if (window.confirm("Delete the entire series? This cannot be undone.")) {
        await onDeleteEvent(occ.id);
      }
    }
  };

  return (
    <>
      <h3 style={{ margin:"8px 0", fontSize:16 }}>Calendar</h3>
      {(calErr || localErr) && <ErrorText>{calErr || localErr}</ErrorText>}

      {occurrences.length === 0 ? (
        <p style={{ opacity:0.8 }}>No upcoming events.</p>
      ) : (
        <ul style={{ listStyle:"none", padding:0, margin:0 }}>
          {occurrences.map(occ => {
            const mins = minutesBetween(occ.occ_start, occ.occ_end);
            const duration = mins < 180 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${(mins/60).toFixed(1)}h`;
            const key = `${occ.id}|${occ.occ_start.toISOString()}`;
            const isEditing = editingKey === key;

            return (
              <li key={key} style={{ padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                {!isEditing ? (
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:12 }}>
                    <div>
                      <strong>{occ.title}</strong>{" "}
                      <span style={{ opacity:0.7 }}>({occ.category})</span>
                      <div style={{ opacity:0.8, fontSize:12 }}>
                        {fmtDT(occ.occ_start, occ.tz, { month:"short", day:"2-digit" })} ·{" "}
                        {fmtTime(occ.occ_start, occ.tz)}–{fmtTime(occ.occ_end, occ.tz)}
                        {" "}({occ.tz}, {duration})
                        {occ.location ? ` · ${occ.location}` : ""}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <GhostButton onClick={()=>beginEdit(occ)}>Edit</GhostButton>
                      <GhostButton onClick={()=>onClickDelete(occ)}>Delete</GhostButton>
                    </div>
                  </div>
                ) : (
                  <div style={{ display:"grid", gap:6 }}>
                    <Input placeholder="Title" value={edit.title} onChange={e=>setEdit({...edit, title:e.target.value})}/>
                    <Input placeholder="Description" value={edit.description} onChange={e=>setEdit({...edit, description:e.target.value})}/>
                    <Input placeholder="Location" value={edit.location} onChange={e=>setEdit({...edit, location:e.target.value})}/>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <select value={edit.category} onChange={e=>setEdit({...edit, category:e.target.value})} style={styles.select}>
                        <option value="rehearsal">Rehearsal</option>
                        <option value="social">Social</option>
                        <option value="performance">Performance</option>
                      </select>
                      <Input placeholder="Time zone" value={edit.tz} onChange={e=>setEdit({...edit, tz:e.target.value})}/>
                    </div>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      <input type="datetime-local" step="60"
                        value={edit.starts_at}
                        onChange={e=>setEdit({...edit, starts_at:e.target.value,
                          ends_at: (() => {
                            const d = (new Date(edit.ends_at) - new Date(edit.starts_at)) || 3600000;
                            const next = new Date(e.target.value); return new Date(next.getTime()+d).toISOString().slice(0,16);
                          })()
                        })} />
                      <input type="datetime-local" step="60"
                        value={edit.ends_at}
                        onChange={e=>setEdit({...edit, ends_at:e.target.value})}/>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <Button onClick={saveEditOccurrenceOnly}>Save this occurrence</Button>
                      {edit.base.recur_freq !== "none" && (
                        <Button onClick={saveEditThisAndFuture}>Save this & future</Button>
                      )}
                      <GhostButton onClick={cancelEdit}>Cancel</GhostButton>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Add Event */}
      <div style={{ marginTop:12 }}>
        {!showAddEvent ? (
          <GhostButton onClick={()=>setShowAddEvent(true)}>+ Add event</GhostButton>
        ) : (
          <>
            <div style={{ display:"grid", gap:8 }}>
              <div style={{ display:"grid", gap:6 }}>
                <Input placeholder="Title" value={evTitle} onChange={e=>setEvTitle(e.target.value)} />
                <Input placeholder="Description (optional)" value={evDesc} onChange={e=>setEvDesc(e.target.value)} />
                <Input placeholder="Location (optional)" value={evLoc} onChange={e=>setEvLoc(e.target.value)} />
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <select value={evCat} onChange={e=>setEvCat(e.target.value)} style={styles.select}>
                    <option value="rehearsal">Rehearsal</option>
                    <option value="social">Social</option>
                    <option value="performance">Performance</option>
                  </select>
                  <Input placeholder="Time zone (e.g. Europe/London)" value={evTZ} onChange={e=>setEvTZ(e.target.value)} />
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <input type="datetime-local" step="60"
                         value={evStart} onChange={e=>onChangeStart(e.target.value)} />
                  <input type="datetime-local" step="60"
                         value={evEnd} onChange={e=>onChangeEnd(e.target.value)} />
                </div>
              </div>

              {/* Recurrence */}
              <div style={{ borderTop:"1px solid rgba(255,255,255,0.12)", paddingTop:8 }}>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <span style={{ opacity:0.8 }}>Repeat:</span>
                  <select value={evFreq} onChange={e=>setEvFreq(e.target.value)} style={styles.select}>
                    <option value="none">Does not repeat</option>
                    <option value="weekly">Weekly</option>
                    {/* Fortnightly is just weekly interval=2 */}
                    <option value="weekly-2">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                  </select>

                  {evFreq.startsWith("weekly") && (
                    <>
                      <span style={{ opacity:0.8 }}>every</span>
                      <Input type="number" min={1}
                        value={evFreq==="weekly-2" ? 2 : evInterval}
                        onChange={e=>setEvInterval(parseInt(e.target.value||'1',10))}
                        disabled={evFreq==="weekly-2"} style={{ width:70 }} />
                      <span style={{ opacity:0.8 }}>week(s) on</span>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {["MO","TU","WE","TH","FR","SA","SU"].map(code => (
                          <label key={code} style={{ display:"inline-flex", gap:6, alignItems:"center", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, padding:"4px 8px" }}>
                            <input type="checkbox" checked={evByDay.includes(code)}
                              onChange={(e)=>{
                                setEvByDay(prev => e.target.checked ? [...new Set([...prev, code])] : prev.filter(x=>x!==code));
                              }}/>
                            {code}
                          </label>
                        ))}
                      </div>
                    </>
                  )}

                  {evFreq === "monthly" && (
                    <div style={{ display:"grid", gap:6 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ opacity:0.8 }}>every</span>
                        <Input type="number" min={1} value={evInterval} onChange={e=>setEvInterval(parseInt(e.target.value||'1',10))} style={{ width:70 }} />
                        <span style={{ opacity:0.8 }}>month(s)</span>
                      </div>
                      <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                        <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                          <input type="radio" checked={evMonthMode==="bymonthday"} onChange={()=>setEvMonthMode("bymonthday")} />
                          By date:
                          <Input type="text" value={evByMonthDay.join(",")} onChange={e=>{
                            const arr = e.target.value.split(",").map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n));
                            setEvByMonthDay(arr.length?arr:[1]);
                          }} placeholder="e.g. 1 or 1,15,30" style={{ width:160 }} />
                        </label>
                        <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                          <input type="radio" checked={evMonthMode==="bynth"} onChange={()=>setEvMonthMode("bynth")} />
                          By weekday:
                          <select value={evWeekOfMonth} onChange={e=>setEvWeekOfMonth(parseInt(e.target.value,10))} style={styles.select}>
                            <option value={1}>1st</option><option value={2}>2nd</option>
                            <option value={3}>3rd</option><option value={4}>4th</option>
                            <option value={5}>5th</option><option value={-1}>Last</option>
                          </select>
                          <select value={evDayOfWeek} onChange={e=>setEvDayOfWeek(e.target.value)} style={styles.select}>
                            {["SU","MO","TU","WE","TH","FR","SA"].map(code => <option key={code} value={code}>{code}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* End conditions */}
                {(evFreq !== "none") && (
                  <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", marginTop:8 }}>
                    <span style={{ opacity:0.8 }}>Ends:</span>
                    <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                      <input type="radio" checked={evEndMode==="never"} onChange={()=>setEvEndMode("never")} /> Never
                    </label>
                    <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                      <input type="radio" checked={evEndMode==="until"} onChange={()=>setEvEndMode("until")} /> Until
                      <input type="date" value={evUntil} onChange={e=>setEvUntil(e.target.value)} disabled={evEndMode!=="until"} />
                    </label>
                    <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                      <input type="radio" checked={evEndMode==="count"} onChange={()=>setEvEndMode("count")} /> For
                      <Input type="number" min={1} value={evCount} onChange={e=>setEvCount(parseInt(e.target.value||'1',10))} style={{ width:80 }} />
                      occurrence(s)
                    </label>
                  </div>
                )}
              </div>

              <div style={{ display:"flex", gap:8, marginTop:8 }}>
                <Button
                  onClick={()=>{
                    // map fortnightly to weekly interval=2
                    if (evFreq === "weekly-2") setEvInterval(2);
                    const msg = validate();
                    if (msg) { setLocalErr(msg); return; }
                    onSaveEvent();
                  }}
                  disabled={!!validate()}
                >
                  Save event
                </Button>
                <GhostButton onClick={()=>{ setShowAddEvent(false); setLocalErr(""); }}>
                  Cancel
                </GhostButton>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}


const styles = {
  header: { display:"flex", gap:10, alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", marginBottom:12 },
  headerLeft: { display:"flex", alignItems:"center", gap:8 },
  backBtn: { height:40, display:"inline-flex", alignItems:"center" },
  titleWrap: { display:"inline-flex", alignItems:"center", height:40, gap:8 },
  titleH1: { margin:0, height:40, lineHeight:"40px", display:"inline-flex", alignItems:"center" },
  renameIcon: { background:"transparent", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, padding:"6px 8px", cursor:"pointer", color:"white", height:40, display:"inline-flex", alignItems:"center" },
  subActive: { border: "1px solid rgba(255,255,255,0.4)", borderRadius: 10 },
  inlineInvite: { display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" },
  select: { background:"#0f0f14", color:"white", border:"1px solid rgba(255,255,255,0.2)", borderRadius:10, padding:"10px 12px", outline:"none" },
};
