// src/teams/TeamsPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "auth/AuthContext";
import {
  // teams & members
  listMyTeams,
  createTeam,
  listTeamMembersRPC,
  setMemberRoleRPC,
  renameTeamRPC,
  deleteTeamRPC,
  addMemberByEmailRPC,
  // events
  listTeamEvents,
  createTeamEvent,
  deleteTeamEvent,
  // overrides / per-occurrence edits
  listTeamEventOverrides,
  deleteEventOccurrence,
  upsertOccurrenceOverride,
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

/* ===========================
   Time & recurrence helpers
   =========================== */
const DOW = ["SU","MO","TU","WE","TH","FR","SA"];
function fmtDT(d, tz, opts = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(new Date(d));
}
function fmtTime(d, tz) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}
function minutesBetween(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  return Math.round(ms / 60000);
}
function nthWeekdayOfMonth(year, month /*0-11*/, weekday /*0-6*/, n /*1..5 or -1 last*/) {
  if (n === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month, last.getUTCDate() - diff));
  }
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const dt = new Date(Date.UTC(year, month, day));
  if (dt.getUTCMonth() !== month) return null;
  return dt;
}
// Helpers for local date+time <-> combined value
const pad = (n) => String(n).padStart(2, "0");
function toLocalInput(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`; // local
}
function splitLocal(localT) {
  const [date, time] = (localT || "").split("T");
  return { date: date || "", time: time || "" };
}
function combineLocal(date, time) {
  return date && time ? `${date}T${time}` : "";
}

/** Expand base events into concrete occurrences inside [fromIso, toIso] */
function expandOccurrences(events, fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const out = [];

  for (const e of events) {
    const start = new Date(e.starts_at);
    const end = new Date(e.ends_at);
    const durMs = end - start;

    if (e.recur_freq === "none") {
      if (start >= from && start <= to) {
        out.push({ ...e, occ_start: start, occ_end: new Date(start.getTime() + durMs) });
      }
      continue;
    }

    let count = 0;
    const maxCount = e.recur_count || 1000;
    const until = e.recur_until ? new Date(`${e.recur_until}T23:59:59Z`) : null;
    const interval = Math.max(1, e.recur_interval || 1);

    if (e.recur_freq === "weekly") {
      const by = (e.recur_byday && e.recur_byday.length) ? e.recur_byday : [DOW[start.getUTCDay()]];
      const weekMs = 7 * 24 * 3600 * 1000;

      // anchor Monday of the week containing the original start
      const anchorDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const anchorDow = anchorDate.getUTCDay();
      const anchorMonday = new Date(anchorDate.getTime() - ((anchorDow + 6) % 7) * 24 * 3600 * 1000);

      // find first candidate week >= from
      const weeksFromAnchor = Math.floor((from - anchorMonday) / weekMs);
      let k = Math.max(0, Math.floor(weeksFromAnchor / interval));

      while (true) {
        const thisWeek = new Date(anchorMonday.getTime() + k * interval * weekMs);
        for (const code of by) {
          const wday = DOW.indexOf(code);
          if (wday < 0) continue;
          const day = new Date(thisWeek.getTime() + ((wday + 7) % 7) * 24 * 3600 * 1000);
          const occStart = new Date(Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            start.getUTCHours(),
            start.getUTCMinutes(),
            start.getUTCSeconds()
          ));
          const occEnd = new Date(occStart.getTime() + durMs);

          if (occStart > to) break;
          if ((until && occStart > until) || count >= maxCount) break;
          if (occEnd >= from && occStart <= to) {
            out.push({ ...e, occ_start: occStart, occ_end: occEnd });
            count++;
          }
        }
        const nextWeekStart = new Date(thisWeek.getTime() + interval * weekMs);
        if (nextWeekStart > to) break;
        if ((until && nextWeekStart > until) || count >= maxCount) break;
        k++;
      }
    } else if (e.recur_freq === "monthly") {
      const byMonthDay = e.recur_bymonthday && e.recur_bymonthday.length ? e.recur_bymonthday : [start.getUTCDate()];
      const byNth = e.recur_week_of_month
        ? { n: e.recur_week_of_month, dow: e.recur_day_of_week || DOW[start.getUTCDay()] }
        : null;

      let y = start.getUTCFullYear();
      let m = start.getUTCMonth();

      // fast-forward months to get to/near window start
      while (new Date(Date.UTC(y, m, 1)) < from) {
        m += interval;
        if (m > 11) { y += Math.floor(m / 12); m = m % 12; }
        if ((until && new Date(Date.UTC(y, m, 1)) > until) || count >= maxCount) break;
      }

      while (true) {
        if (byNth) {
          const weekday = DOW.indexOf(byNth.dow);
          const dt = nthWeekdayOfMonth(y, m, weekday, byNth.n);
          if (dt) {
            const occStart = new Date(Date.UTC(
              dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
              start.getUTCHours(), start.getUTCMinutes(), start.getUTCHours()
            ));
            const occEnd = new Date(occStart.getTime() + durMs);
            if (occStart > to) break;
            if ((until && occStart > until) || count >= maxCount) break;
            if (occEnd >= from && occStart <= to) { out.push({ ...e, occ_start: occStart, occ_end: occEnd }); count++; }
          }
        } else {
          for (const d of byMonthDay) {
            const dt = new Date(Date.UTC(y, m, d));
            if (dt.getUTCMonth() !== m) continue; // invalid date for this month
            const occStart = new Date(Date.UTC(
              dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
              start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()
            ));
            const occEnd = new Date(occStart.getTime() + durMs);
            if (occStart > to) break;
            if ((until && occStart > until) || count >= maxCount) break;
            if (occEnd >= from && occStart <= to) { out.push({ ...e, occ_start: occStart, occ_end: occEnd }); count++; }
          }
        }

        // next month block
        m += interval;
        if (m > 11) { y += Math.floor(m / 12); m = m % 12; }
        const nextMonthStart = new Date(Date.UTC(y, m, 1));
        if (nextMonthStart > to) break;
        if ((until && nextMonthStart > until) || count >= maxCount) break;
      }
    }
  }

  out.sort((a, b) => a.occ_start - b.occ_start);
  return out;
}

/* ===========================
   Component
   =========================== */
export default function TeamsPanel() {
  const { session } = useAuth();
  const user = session?.user;

  // teams list
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

  // subtab inside team
  const [subTab, setSubTab] = useState("members"); // 'members' | 'calendar'

  // rename (header)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  // calendar state
  const [eventsBase, setEventsBase] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [calErr, setCalErr] = useState("");
  const [showAddEvent, setShowAddEvent] = useState(false);

  // add event form
  const defaultTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [evTitle, setEvTitle] = useState("");
  const [evDesc, setEvDesc] = useState("");
  const [evLoc, setEvLoc] = useState("");
  const [evCat, setEvCat] = useState("rehearsal");
  const [evTZ, setEvTZ] = useState(defaultTZ);
  // separate date & time inputs
  const [evStartDate, setEvStartDate] = useState(""); // "YYYY-MM-DD"
  const [evStartTime, setEvStartTime] = useState(""); // "HH:MM"
  const [evEndDate, setEvEndDate]     = useState("");
  const [evEndTime, setEvEndTime]     = useState("");
  // recurrence
  const [evFreq, setEvFreq] = useState("none"); // none | weekly | monthly
  const [evInterval, setEvInterval] = useState(1);
  const [evByDay, setEvByDay] = useState(["MO"]);
  const [evMonthMode, setEvMonthMode] = useState("bymonthday"); // bymonthday | bynth
  const [evByMonthDay, setEvByMonthDay] = useState([1]);
  const [evWeekOfMonth, setEvWeekOfMonth] = useState(1);
  const [evDayOfWeek, setEvDayOfWeek] = useState("MO");
  const [evEndMode, setEvEndMode] = useState("never"); // never | until | count
  const [evUntil, setEvUntil] = useState("");
  const [evCount, setEvCount] = useState(10);

  // duration tracking for start/end sync (minutes)
  const [durMin, setDurMin] = useState(60);

  const refreshTeams = async () => {
    setErr("");
    try {
      const list = await listMyTeams(user.id);
      setTeams(list);
      setLoading(false);
      if (selected) {
        const s = list.find((t) => t.id === selected.id);
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
      setSubTab("members");
      setShowAddEvent(false);
    } else {
      setEditingName(false);
      setNameDraft("");
    }
  }, [selected?.id, selected?.name]);

  const openTeam = async (team) => {
    setSelected(team);
    setErr("");
    try {
      const mem = await listTeamMembersRPC(team.id);
      setMembers(mem);
    } catch (e) {
      setErr(e.message || "Failed to load members");
    }
  };

  const backToList = () => { setSelected(null); setMembers([]); };

  const createNewTeam = async () => {
    const value = newName.trim();
    if (!value) return;
    setCreating(true);
    setErr("");
    try {
      const team = await createTeam(value); // RPC: creator becomes admin
      setNewName("");
      setShowCreate(false);
      await refreshTeams();
      await openTeam({ ...team, role: "admin" }); // jump into the new team
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const doRename = async () => {
    if (!selected) return;
    const next = (nameDraft || "").trim();
    if (!next || next === selected.name) { setEditingName(false); return; }
    if (!window.confirm(`Rename team to “${next}”?`)) return;
    try {
      const updated = await renameTeamRPC(selected.id, next);
      setSelected((prev) => (prev && prev.id === updated.id ? { ...prev, name: updated.name } : prev));
      setEditingName(false);
      await refreshTeams();
    } catch (e) { setErr(e.message || "Rename failed"); }
  };

  // ---- Calendar: load a wide window (past 24mo to +6mo) so we can paginate past
  const windowFrom = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 24); d.setHours(0, 0, 0, 0); return d.toISOString();
  }, []);
  const windowTo = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 6); d.setHours(23, 59, 59, 999); return d.toISOString();
  }, []);

  const refreshCalendar = async () => {
    if (!selected) return;
    setCalErr("");
    try {
      const evs = await listTeamEvents(selected.id, windowFrom, windowTo);
      setEventsBase(evs);
      const ovs = await listTeamEventOverrides(selected.id, windowFrom, windowTo);
      setOverrides(ovs);
    } catch (e) {
      setCalErr(e.message || "Failed to load events");
    }
  };

  useEffect(() => { if (selected) refreshCalendar(); /* eslint-disable-next-line */ }, [selected?.id]);

  // merge overrides & expand
  const occurrencesAll = useMemo(() => {
    const occ = expandOccurrences(eventsBase, windowFrom, windowTo);
    if (!overrides.length) return occ;

    const map = new Map();
    for (const o of overrides) {
      map.set(`${o.event_id}|${new Date(o.occ_start).toISOString()}`, o);
    }
    const out = [];
    for (const e of occ) {
      const key = `${e.id}|${e.occ_start.toISOString()}`;
      const o = map.get(key);
      if (!o) { out.push(e); continue; }
      if (o.canceled) continue;
      out.push({
        ...e,
        title: o.title ?? e.title,
        description: o.description ?? e.description,
        location: o.location ?? e.location,
        tz: o.tz ?? e.tz,
        occ_start: o.starts_at ? new Date(o.starts_at) : e.occ_start,
        occ_end: o.ends_at ? new Date(o.ends_at) : e.occ_end,
        category: o.category ?? e.category,
      });
    }
    out.sort((a, b) => a.occ_start - b.occ_start);
    return out;
  }, [eventsBase, overrides, windowFrom, windowTo]);

  const now = new Date();
  const upcomingOcc = useMemo(() => occurrencesAll.filter(o => o.occ_start >= now), [occurrencesAll]);
  const pastOccDesc = useMemo(() => {
    const arr = occurrencesAll.filter(o => o.occ_start < now);
    arr.sort((a,b) => b.occ_start - a.occ_start); // newest first
    return arr;
  }, [occurrencesAll]);
  const [pastPage, setPastPage] = useState(1); // 25 per page
  const pastPageSize = 25;
  const pastSlice = useMemo(() => pastOccDesc.slice(0, pastPage * pastPageSize), [pastOccDesc, pastPage]);

  // ------ Add Event: duration tracking / syncing ------
  useEffect(() => {
    if (evStartDate && evStartTime && evEndDate && evEndTime) {
      const d = (new Date(combineLocal(evEndDate, evEndTime)) - new Date(combineLocal(evStartDate, evStartTime))) / 60000;
      if (d > 0) setDurMin(d);
    }
  }, [evStartDate, evStartTime, evEndDate, evEndTime]);

  const onChangeStartDate = (val) => {
    setEvStartDate(val);
    if (val && evStartTime) {
      const start = new Date(combineLocal(val, evStartTime));
      const end = new Date(start.getTime() + durMin * 60000);
      const local = toLocalInput(end);
      const { date, time } = splitLocal(local);
      setEvEndDate(date);
      setEvEndTime(time);
    }
  };
  const onChangeStartTime = (val) => {
    setEvStartTime(val);
    if (evStartDate && val) {
      const start = new Date(combineLocal(evStartDate, val));
      const end = new Date(start.getTime() + durMin * 60000);
      const local = toLocalInput(end);
      const { date, time } = splitLocal(local);
      setEvEndDate(date);
      setEvEndTime(time);
    }
  };
  const onChangeEndDate = (val) => {
    setEvEndDate(val);
    if (evStartDate && evStartTime && val && evEndTime) {
      const start = new Date(combineLocal(evStartDate, evStartTime));
      const end = new Date(combineLocal(val, evEndTime));
      const d = (end - start) / 60000;
      if (d > 0) setDurMin(d);
    }
  };
  const onChangeEndTime = (val) => {
    setEvEndTime(val);
    if (evStartDate && evStartTime && evEndDate && val) {
      const start = new Date(combineLocal(evStartDate, evStartTime));
      const end = new Date(combineLocal(evEndDate, val));
      const d = (end - start) / 60000;
      if (d > 0) setDurMin(d);
    }
  };

  const [localErr, setLocalErr] = useState("");
  const startLocal = combineLocal(evStartDate, evStartTime);
  const endLocal   = combineLocal(evEndDate, evEndTime);

  const inlineError = useMemo(() => {
    if (!showAddEvent) return "";
    if (!evTitle.trim()) return "Title is required.";
    if (!startLocal || !endLocal) return "Start and end are required.";
    if (new Date(startLocal) < new Date()) return "Start time is in the past.";
    if (new Date(endLocal) <= new Date(startLocal)) return "End must be after start.";
    return "";
  }, [showAddEvent, evTitle, startLocal, endLocal]);

  const saveEvent = async () => {
    if (!selected) return;
    const payload = {
      team_id: selected.id,
      title: evTitle.trim(),
      description: evDesc || null,
      location: evLoc || null,
      category: evCat,
      tz: evTZ,
      starts_at: new Date(startLocal).toISOString(),
      ends_at: new Date(endLocal).toISOString(),
      recur_freq: evFreq,
      recur_interval: evInterval,
      recur_byday: evFreq === "weekly" ? evByDay : null,
      recur_bymonthday: (evFreq === "monthly" && evMonthMode === "bymonthday") ? evByMonthDay : null,
      recur_week_of_month: (evFreq === "monthly" && evMonthMode === "bynth") ? evWeekOfMonth : null,
      recur_day_of_week: (evFreq === "monthly" && evMonthMode === "bynth") ? evDayOfWeek : null,
      recur_count: evEndMode === "count" ? evCount : null,
      recur_until: evEndMode === "until" ? evUntil : null,
    };
    if (!payload.title || !startLocal || !endLocal) { setCalErr("Please fill title, start and end."); return; }
    if (inlineError) { setLocalErr(inlineError); return; }

    try {
      await createTeamEvent(payload);
      setShowAddEvent(false);
      // reset form
      setEvTitle(""); setEvDesc(""); setEvLoc(""); setEvCat("rehearsal");
      setEvStartDate(""); setEvStartTime(""); setEvEndDate(""); setEvEndTime(""); setEvTZ(defaultTZ);
      setEvFreq("none"); setEvInterval(1); setEvByDay(["MO"]);
      setEvMonthMode("bymonthday"); setEvByMonthDay([1]); setEvWeekOfMonth(1); setEvDayOfWeek("MO");
      setEvEndMode("never"); setEvUntil(""); setEvCount(10);
      setLocalErr("");
      await refreshCalendar();
    } catch (e) {
      setCalErr(e.message || "Failed to create event");
    }
  };

  const removeEventSeries = async (eventId) => {
    await deleteTeamEvent(eventId);
    await refreshCalendar();
  };
  const removeEventOccurrence = async (eventId, occStartIso) => {
    await deleteEventOccurrence(eventId, occStartIso);
    await refreshCalendar();
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
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") await doRename();
                  if (e.key === "Escape") setEditingName(false);
                }}
                autoFocus
                style={{ minWidth: 220 }}
              />
              <Button
                onClick={doRename}
                disabled={!nameDraft.trim() || nameDraft.trim() === selected.name}
              >
                Save
              </Button>
              <GhostButton onClick={() => { setEditingName(false); setNameDraft(selected.name || ""); }}>
                Cancel
              </GhostButton>
            </>
          )}
        </div>
      </div>

      {err && <ErrorText>{err}</ErrorText>}

      {!selected ? (
        <>
          {loading ? (
            <p>Loading teams…</p>
          ) : teams.length === 0 ? (
            <p style={{ opacity: 0.8 }}>You don’t belong to any teams yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
              {teams.map((t) => (
                <li
                  key={t.id}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer",
                  }}
                  onClick={() => openTeam(t)}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                    }}
                  >
                    <div>
                      <strong>{t.name}</strong>{" "}
                      <span style={{ opacity: 0.7 }}>({t.display_id})</span>
                    </div>
                    <span style={{ opacity: 0.7 }}>{t.role}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Create team (hidden until toggled) */}
          <div style={{ marginTop: 12 }} />
          {!showCreate ? (
            <GhostButton onClick={() => setShowCreate(true)}>+ Create team</GhostButton>
          ) : (
            <>
              <div style={styles.inlineInvite}>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Writers Room"
                  onKeyDown={(e) => e.key === "Enter" && createNewTeam()}
                  style={{ minWidth: 220 }}
                />
                <Button onClick={createNewTeam} disabled={creating || !newName.trim()}>
                  {creating ? "Creating…" : "Create"}
                </Button>
                <GhostButton onClick={() => { setShowCreate(false); setNewName(""); }}>
                  Cancel
                </GhostButton>
              </div>
              <InfoText style={{ marginTop: 6 }}>
                Duplicates allowed. A unique id like <code>Name#1</code> is generated.
              </InfoText>
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
          upcomingOcc={upcomingOcc}
          pastOccDesc={pastOccDesc}
          pastSlice={pastSlice}
          pastHasMore={pastOccDesc.length > pastSlice.length}
          onPastMore={() => setPastPage(p => p + 1)}
          showAddEvent={showAddEvent}
          setShowAddEvent={setShowAddEvent}
          evState={{
            evTitle, setEvTitle, evDesc, setEvDesc, evLoc, setEvLoc, evCat, setEvCat,
            evTZ, setEvTZ,
            evStartDate, setEvStartDate, evStartTime, setEvStartTime,
            evEndDate, setEvEndDate, evEndTime, setEvEndTime,
            evFreq, setEvFreq, evInterval, setEvInterval,
            evByDay, setEvByDay, evMonthMode, setEvMonthMode,
            evByMonthDay, setEvByMonthDay, evWeekOfMonth, setEvWeekOfMonth,
            evDayOfWeek, setEvDayOfWeek, evEndMode, setEvEndMode, evUntil, setEvUntil, evCount, setEvCount
          }}
          durMin={durMin}
          onChangeStartDate={onChangeStartDate}
          onChangeStartTime={onChangeStartTime}
          onChangeEndDate={onChangeEndDate}
          onChangeEndTime={onChangeEndTime}
          inlineError={inlineError}
          localErr={localErr}
          setLocalErr={setLocalErr}
          onSaveEvent={saveEvent}
          onDeleteEventSeries={removeEventSeries}
          onDeleteEventOccurrence={removeEventOccurrence}
          onRefreshCalendar={refreshCalendar}
          occurrencesAll={occurrencesAll}
        />
      )}
    </>
  );
}

function TeamDetail({
  team, members, currentUserId, subTab, setSubTab,
  onChangeRole, calErr,
  upcomingOcc, pastOccDesc, pastSlice, pastHasMore, onPastMore,
  showAddEvent, setShowAddEvent, evState, durMin,
  onChangeStartDate, onChangeStartTime, onChangeEndDate, onChangeEndTime,
  inlineError, localErr, setLocalErr,
  onSaveEvent, onDeleteEventSeries, onDeleteEventOccurrence, onRefreshCalendar,
  occurrencesAll
}) {
  const isAdmin = team.role === "admin";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Add member UI
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  const addMember = async () => {
    const email = inviteEmail.trim(); if (!email) return;
    setInviting(true); setErr(""); setMsg("");
    try {
      await addMemberByEmailRPC(team.id, email, inviteRole);
      setInviteEmail(""); setInviteRole("member");
      setShowInvite(false);
      setMsg("Member added ✓");
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setErr(e.message || "Add member failed");
    } finally {
      setInviting(false);
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete “${team.name}” permanently? This cannot be undone.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try { await deleteTeamRPC(team.id); window.location.hash = ""; window.location.reload(); }
    catch (e) { setErr(e.message || "Delete failed"); }
    finally { setBusy(false); }
  };

  return (
    <>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        ID: <code>{team.display_id}</code> · Your role: <strong>{team.role}</strong>
      </p>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 8, margin: "8px 0 12px" }}>
        <GhostButton onClick={() => setSubTab("members")} style={subTab === "members" ? styles.subActive : null}>Members</GhostButton>
        <GhostButton onClick={() => setSubTab("calendar")} style={subTab === "calendar" ? styles.subActive : null}>Calendar</GhostButton>
      </div>

      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {subTab === "members" ? (
        <>
          <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Members</h3>
          {members.length === 0 ? (
            <p style={{ opacity: 0.8 }}>No members yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {members.map((m) => (
                <li key={m.user_id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "grid" }}>
                      <strong>{m.display_name || m.email || m.user_id}</strong>
                      <span style={{ opacity: 0.7, fontSize: 12 }}>{m.email || m.user_id}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ opacity: 0.8 }}>{m.role}</span>
                      {team.role === "admin" && m.user_id !== currentUserId && (
                        <Button
                          style={{ padding: "6px 10px" }}
                          onClick={() => onChangeRole(m.user_id, m.role === "admin" ? "member" : "admin")}
                        >
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
          <div style={{ marginTop: 12 }}>
            {!showInvite ? (
              <GhostButton onClick={() => setShowInvite(true)}>+ Add member</GhostButton>
            ) : (
              <div style={styles.inlineInvite}>
                <Input
                  placeholder="user@example.com"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addMember()}
                  style={{ minWidth: 220 }}
                />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={styles.select}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <Button onClick={addMember} disabled={inviting || !inviteEmail.trim()}>
                  {inviting ? "Adding…" : "Add"}
                </Button>
                <GhostButton onClick={() => { setShowInvite(false); setInviteEmail(""); setInviteRole("member"); }}>
                  Cancel
                </GhostButton>
              </div>
            )}
          </div>

          {isAdmin && (
            <div style={{ marginTop: 18 }}>
              <DangerButton onClick={deleteTeam} disabled={busy}>Delete team</DangerButton>
            </div>
          )}
        </>
      ) : (
        <CalendarPanel
          team={team}
          upcomingOcc={upcomingOcc}
          pastSlice={pastSlice}
          pastHasMore={pastHasMore}
          onPastMore={onPastMore}
          showAddEvent={showAddEvent}
          setShowAddEvent={setShowAddEvent}
          evState={evState}
          durMin={durMin}
          onChangeStartDate={onChangeStartDate}
          onChangeStartTime={onChangeStartTime}
          onChangeEndDate={onChangeEndDate}
          onChangeEndTime={onChangeEndTime}
          inlineError={inlineError}
          localErr={localErr}
          setLocalErr={setLocalErr}
          onSaveEvent={onSaveEvent}
          onDeleteEventSeries={onDeleteEventSeries}
          onDeleteEventOccurrence={onDeleteEventOccurrence}
          onRefreshCalendar={onRefreshCalendar}
          calErr={calErr}
          occurrencesAll={occurrencesAll}
        />
      )}
    </>
  );
}

function CalendarPanel({
  team,
  upcomingOcc,
  pastSlice, pastHasMore, onPastMore,
  showAddEvent, setShowAddEvent,
  evState, durMin, onChangeStartDate, onChangeStartTime, onChangeEndDate, onChangeEndTime,
  inlineError, localErr, setLocalErr, onSaveEvent,
  onDeleteEventSeries, onDeleteEventOccurrence, onRefreshCalendar,
  calErr, occurrencesAll
}) {
  const {
    evTitle, setEvTitle, evDesc, setEvDesc, evLoc, setEvLoc, evCat, setEvCat,
    evTZ, setEvTZ,
    evStartDate, evStartTime, evEndDate, evEndTime,
    evFreq, setEvFreq, evInterval, setEvInterval,
    evByDay, setEvByDay, evMonthMode, setEvMonthMode,
    evByMonthDay, setEvByMonthDay, evWeekOfMonth, setEvWeekOfMonth,
    evDayOfWeek, setEvDayOfWeek, evEndMode, setEvEndMode, evUntil, setEvUntil, evCount, setEvCount
  } = evState;

  // EDIT occurrence state
  const [editingKey, setEditingKey] = useState(null); // `${eventId}|${occIso}`
  const [edit, setEdit] = useState(null); // { title, description, location, tz, startDate, startTime, endDate, endTime, category, base }

  const beginEdit = (occ) => {
    if (occ.occ_start < new Date()) { alert("Cannot edit a past occurrence."); return; }
    const startLocal = toLocalInput(occ.occ_start);
    const endLocal   = toLocalInput(occ.occ_end);
    const s = splitLocal(startLocal), e = splitLocal(endLocal);

    setEditingKey(`${occ.id}|${occ.occ_start.toISOString()}`);
    setEdit({
      title: occ.title,
      description: occ.description || "",
      location: occ.location || "",
      tz: occ.tz,
      startDate: s.date, startTime: s.time,
      endDate: e.date,   endTime: e.time,
      category: occ.category,
      base: occ,
    });
  };
  const cancelEdit = () => { setEditingKey(null); setEdit(null); };

  // Save just this occurrence
  const saveEditOccurrenceOnly = async () => {
    if (!edit) return;
    const startLocal = combineLocal(edit.startDate, edit.startTime);
    const endLocal   = combineLocal(edit.endDate, edit.endTime);
    if (!edit.title.trim()) return alert("Title required.");
    if (new Date(startLocal) < new Date()) return alert("Start is in the past.");
    if (new Date(endLocal) <= new Date(startLocal)) return alert("End must be after start.");
    try {
      await upsertOccurrenceOverride(edit.base.id, edit.base.occ_start.toISOString(), {
        title: edit.title,
        description: edit.description || null,
        location: edit.location || null,
        tz: edit.tz,
        starts_at: new Date(startLocal).toISOString(),
        ends_at: new Date(endLocal).toISOString(),
        category: edit.category,
      });
      cancelEdit();
      await onRefreshCalendar();
    } catch (e) { alert(e.message || "Failed to save occurrence."); }
  };

  // Save for all FUTURE occurrences in this series (no new series)
  const saveEditFuture = async () => {
    if (!edit) return;
    if (!window.confirm("Apply these changes to all future occurrences in this series?")) return;

    const startLocal = combineLocal(edit.startDate, edit.startTime);
    const endLocal   = combineLocal(edit.endDate, edit.endTime);
    if (new Date(startLocal) < new Date()) return alert("Start is in the past.");
    if (new Date(endLocal) <= new Date(startLocal)) return alert("End must be after start.");

    try {
      const toPatch = occurrencesAll
        .filter(o => o.id === edit.base.id && o.occ_start >= edit.base.occ_start);

      for (const o of toPatch) {
        // eslint-disable-next-line no-await-in-loop
        await upsertOccurrenceOverride(o.id, o.occ_start.toISOString(), {
          title: edit.title,
          description: edit.description || null,
          location: edit.location || null,
          tz: edit.tz,
          starts_at: new Date(combineLocal(edit.startDate, edit.startTime)).toISOString(),
          ends_at:   new Date(combineLocal(edit.endDate,   edit.endTime)).toISOString(),
          category: edit.category,
        });
      }

      cancelEdit();
      await onRefreshCalendar();
    } catch (e) { alert(e.message || "Failed to update future occurrences."); }
  };

  // Save for the ENTIRE series (past+future in loaded window) — no new series
  const saveEditSeries = async () => {
    if (!edit) return;
    if (!window.confirm("Apply these changes to the entire series (past & future in the loaded range)?")) return;

    const startLocal = combineLocal(edit.startDate, edit.startTime);
    const endLocal   = combineLocal(edit.endDate, edit.endTime);
    if (new Date(endLocal) <= new Date(startLocal)) return alert("End must be after start.");

    try {
      const toPatch = occurrencesAll.filter(o => o.id === edit.base.id);
      for (const o of toPatch) {
        // eslint-disable-next-line no-await-in-loop
        await upsertOccurrenceOverride(o.id, o.occ_start.toISOString(), {
          title: edit.title,
          description: edit.description || null,
          location: edit.location || null,
          tz: edit.tz,
          starts_at: new Date(combineLocal(edit.startDate, edit.startTime)).toISOString(),
          ends_at:   new Date(combineLocal(edit.endDate,   edit.endTime)).toISOString(),
          category: edit.category,
        });
      }
      cancelEdit();
      await onRefreshCalendar();
    } catch (e) { alert(e.message || "Failed to update series."); }
  };

  const onClickDelete = async (occ) => {
    if (occ.occ_start < new Date()) { alert("Cannot delete a past occurrence."); return; }
    if (occ.recur_freq === "none") {
      if (!window.confirm("Delete this event?")) return;
      await onDeleteEventSeries(occ.id);
      return;
    }
    // Prompt: this occurrence vs series
    if (window.confirm("Delete this occurrence only? (OK = this occurrence, Cancel = entire series)")) {
      await onDeleteEventOccurrence(occ.id, occ.occ_start.toISOString());
      await onRefreshCalendar();
    } else {
      if (window.confirm("Delete the entire series? This cannot be undone.")) {
        await onDeleteEventSeries(occ.id);
      }
    }
  };

  return (
    <>
      <h3 style={{ margin: "8px 0", fontSize: 16 }}>Calendar</h3>
      {(calErr || localErr || (showAddEvent ? inlineError : "")) && (
        <ErrorText>{calErr || localErr || inlineError}</ErrorText>
      )}

      {/* UPCOMING */}
      {upcomingOcc.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No upcoming events.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {upcomingOcc.map((occ) => {
            const mins = minutesBetween(occ.occ_start, occ.occ_end);
            const duration = mins < 180 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${(mins / 60).toFixed(1)}h`;
            const key = `${occ.id}|${occ.occ_start.toISOString()}`;
            const isEditing = editingKey === key;

            return (
              <li key={key} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {!isEditing ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div>
                      <strong>{occ.title}</strong>{" "}
                      <span style={{ opacity: 0.7 }}>({occ.category})</span>
                      <div style={{ opacity: 0.8, fontSize: 12 }}>
                        {fmtDT(occ.occ_start, occ.tz, { month: "short", day: "2-digit" })} ·{" "}
                        {fmtTime(occ.occ_start, occ.tz)}–{fmtTime(occ.occ_end, occ.tz)} ({occ.tz}, {duration})
                        {occ.location ? ` · ${occ.location}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <GhostButton onClick={() => beginEdit(occ)}>Edit</GhostButton>
                      <GhostButton onClick={() => onClickDelete(occ)}>Delete</GhostButton>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
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
                      <Input placeholder="Time zone" value={edit.tz} onChange={(e) => setEdit({ ...edit, tz: e.target.value })} />
                    </div>

                    {/* Date + Time for editing */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <label>Start:&nbsp;
                        <input
                          type="date"
                          value={edit.startDate}
                          onChange={(e) => {
                            const v = e.target.value;
                            const oldStart = combineLocal(edit.startDate, edit.startTime);
                            const oldEnd   = combineLocal(edit.endDate, edit.endTime);
                            const dur = (new Date(oldEnd) - new Date(oldStart)) || 60*60000;
                            const start = combineLocal(v, edit.startTime);
                            if (start) {
                              const nextEnd = new Date(new Date(start).getTime() + dur);
                              const n = splitLocal(toLocalInput(nextEnd));
                              setEdit({ ...edit, startDate: v, endDate: n.date, endTime: n.time });
                            } else {
                              setEdit({ ...edit, startDate: v });
                            }
                          }}
                        />
                      </label>
                      <input
                        type="time"
                        step="60"
                        value={edit.startTime}
                        onChange={(e) => {
                          const v = e.target.value;
                          const oldStart = combineLocal(edit.startDate, edit.startTime);
                          const oldEnd   = combineLocal(edit.endDate, edit.endTime);
                          const dur = (new Date(oldEnd) - new Date(oldStart)) || 60*60000;
                          const start = combineLocal(edit.startDate, v);
                          if (start) {
                            const nextEnd = new Date(new Date(start).getTime() + dur);
                            const n = splitLocal(toLocalInput(nextEnd));
                            setEdit({ ...edit, startTime: v, endDate: n.date, endTime: n.time });
                          } else {
                            setEdit({ ...edit, startTime: v });
                          }
                        }}
                      />
                      <label style={{ marginLeft: 12 }}>End:&nbsp;
                        <input
                          type="date"
                          value={edit.endDate}
                          onChange={(e) => setEdit({ ...edit, endDate: e.target.value })}
                        />
                      </label>
                      <input
                        type="time"
                        step="60"
                        value={edit.endTime}
                        onChange={(e) => setEdit({ ...edit, endTime: e.target.value })}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button onClick={saveEditOccurrenceOnly}>Save this occurrence</Button>
                      <Button onClick={saveEditFuture}>Save future in series</Button>
                      <Button onClick={saveEditSeries}>Save entire series</Button>
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
      <div style={{ marginTop: 12 }}>
        {!showAddEvent ? (
          <GhostButton onClick={() => setShowAddEvent(true)}>+ Add event</GhostButton>
        ) : (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <Input placeholder="Title" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} />
                <Input placeholder="Description (optional)" value={evDesc} onChange={(e) => setEvDesc(e.target.value)} />
                <Input placeholder="Location (optional)" value={evLoc} onChange={(e) => setEvLoc(e.target.value)} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select value={evCat} onChange={(e) => setEvCat(e.target.value)} style={styles.select}>
                    <option value="rehearsal">Rehearsal</option>
                    <option value="social">Social</option>
                    <option value="performance">Performance</option>
                  </select>
                  <Input placeholder="Time zone (e.g. Europe/London)" value={evTZ} onChange={(e) => setEvTZ(e.target.value)} />
                </div>

                {/* Date + Time pickers */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <label>Start:&nbsp;
                    <input type="date" value={evStartDate} onChange={(e) => onChangeStartDate(e.target.value)} />
                  </label>
                  <input type="time" step="60" value={evStartTime} onChange={(e) => onChangeStartTime(e.target.value)} />
                  <label style={{ marginLeft: 12 }}>End:&nbsp;
                    <input type="date" value={evEndDate} onChange={(e) => onChangeEndDate(e.target.value)} />
                  </label>
                  <input type="time" step="60" value={evEndTime} onChange={(e) => onChangeEndTime(e.target.value)} />
                </div>
              </div>

              {/* Recurrence */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ opacity: 0.8 }}>Repeat:</span>
                  <select value={evFreq} onChange={(e) => setEvFreq(e.target.value)} style={styles.select}>
                    <option value="none">Does not repeat</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>

                  {evFreq === "weekly" && (
                    <>
                      <span style={{ opacity: 0.8 }}>every</span>
                      <Input
                        type="number"
                        min={1}
                        value={evInterval}
                        onChange={(e) => setEvInterval(parseInt(e.target.value || "1", 10))}
                        style={{ width: 70 }}
                      />
                      <span style={{ opacity: 0.8 }}>week(s) on</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((code) => (
                          <label
                            key={code}
                            style={{
                              display: "inline-flex",
                              gap: 6,
                              alignItems: "center",
                              border: "1px solid rgba(255,255,255,0.2)",
                              borderRadius: 8,
                              padding: "4px 8px",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={evByDay.includes(code)}
                              onChange={(e) => {
                                setEvByDay((prev) =>
                                  e.target.checked ? [...new Set([...prev, code])] : prev.filter((x) => x !== code)
                                );
                              }}
                            />
                            {code}
                          </label>
                        ))}
                      </div>
                    </>
                  )}

                  {evFreq === "monthly" && (
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ opacity: 0.8 }}>every</span>
                        <Input
                          type="number"
                          min={1}
                          value={evInterval}
                          onChange={(e) => setEvInterval(parseInt(e.target.value || "1", 10))}
                          style={{ width: 70 }}
                        />
                        <span style={{ opacity: 0.8 }}>month(s)</span>
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            checked={evMonthMode === "bymonthday"}
                            onChange={() => setEvMonthMode("bymonthday")}
                          />
                          By date:
                          <Input
                            type="text"
                            value={evByMonthDay.join(",")}
                            onChange={(e) => {
                              const arr = e.target.value
                                .split(",")
                                .map((s) => parseInt(s.trim(), 10))
                                .filter((n) => !isNaN(n));
                              setEvByMonthDay(arr.length ? arr : [1]);
                            }}
                            placeholder="e.g. 1 or 1,15,30"
                            style={{ width: 160 }}
                          />
                        </label>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input type="radio" checked={evMonthMode === "bynth"} onChange={() => setEvMonthMode("bynth")} />
                          By weekday:
                          <select
                            value={evWeekOfMonth}
                            onChange={(e) => setEvWeekOfMonth(parseInt(e.target.value, 10))}
                            style={styles.select}
                          >
                            <option value={1}>1st</option>
                            <option value={2}>2nd</option>
                            <option value={3}>3rd</option>
                            <option value={4}>4th</option>
                            <option value={5}>5th</option>
                            <option value={-1}>Last</option>
                          </select>
                          <select
                            value={evDayOfWeek}
                            onChange={(e) => setEvDayOfWeek(e.target.value)}
                            style={styles.select}
                          >
                            {["SU", "MO", "TU", "WE", "TH", "FR", "SA"].map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* End conditions */}
                {evFreq !== "none" && (
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <span style={{ opacity: 0.8 }}>Ends:</span>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" checked={evEndMode === "never"} onChange={() => setEvEndMode("never")} /> Never
                    </label>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" checked={evEndMode === "until"} onChange={() => setEvEndMode("until")} /> Until
                      <input type="date" value={evUntil} onChange={(e) => setEvUntil(e.target.value)} disabled={evEndMode !== "until"} />
                    </label>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="radio" checked={evEndMode === "count"} onChange={() => setEvEndMode("count")} /> For
                      <Input
                        type="number"
                        min={1}
                        value={evCount}
                        onChange={(e) => setEvCount(parseInt(e.target.value || "1", 10))}
                        style={{ width: 80 }}
                      />
                      occurrence(s)
                    </label>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Button
                  onClick={() => {
                    if (inlineError) { setLocalErr(inlineError); return; }
                    onSaveEvent();
                  }}
                  disabled={!!inlineError}
                >
                  Save event
                </Button>
                <GhostButton onClick={() => { setShowAddEvent(false); setLocalErr(""); }}>
                  Cancel
                </GhostButton>
              </div>
            </div>
          </>
        )}
      </div>

      {/* PAST EVENTS */}
      <h4 style={{ margin: "18px 0 8px", fontSize: 14, opacity: 0.9 }}>Past events</h4>
      {pastSlice.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No past events in the loaded range.</p>
      ) : (
        <>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {pastSlice.map((occ) => {
              const mins = minutesBetween(occ.occ_start, occ.occ_end);
              const duration = mins < 180 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${(mins / 60).toFixed(1)}h`;
              const key = `past|${occ.id}|${occ.occ_start.toISOString()}`;
              return (
                <li key={key} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", opacity: 0.55 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div>
                      <strong>{occ.title}</strong>{" "}
                      <span style={{ opacity: 0.7 }}>({occ.category})</span>
                      <div style={{ opacity: 0.8, fontSize: 12 }}>
                        {fmtDT(occ.occ_start, occ.tz, { month: "short", day: "2-digit" })} ·{" "}
                        {fmtTime(occ.occ_start, occ.tz)}–{fmtTime(occ.occ_end, occ.tz)} ({occ.tz}, {duration})
                        {occ.location ? ` · ${occ.location}` : ""}
                      </div>
                    </div>
                    {/* read-only; no actions */}
                  </div>
                </li>
              );
            })}
          </ul>
          {pastHasMore && (
            <div style={{ marginTop: 10 }}>
              <GhostButton onClick={onPastMore}>Get more</GhostButton>
            </div>
          )}
        </>
      )}
    </>
  );
}

const styles = {
  header: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  backBtn: {
    height: 40,
    display: "inline-flex",
    alignItems: "center",
  },
  titleWrap: {
    display: "inline-flex",
    alignItems: "center",
    height: 40,
    gap: 8,
  },
  titleH1: {
    margin: 0,
    height: 40,
    lineHeight: "40px",
    display: "inline-flex",
    alignItems: "center",
  },
  renameIcon: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 8,
    padding: "6px 8px",
    cursor: "pointer",
    color: "white",
    height: 40,
    display: "inline-flex",
    alignItems: "center",
  },
  subActive: {
    border: "1px solid rgba(255,255,255,0.4)",
    borderRadius: 10,
  },
  inlineInvite: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  select: {
    background: "#0f0f14",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
  },
};
