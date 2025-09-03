// src/teams/TeamsPanel.jsx
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "auth/AuthContext";

import {
  listMyTeams,
  createTeam,
  listTeamMembersRPC,
  setMemberRoleRPC,
  addMemberByEmailRPC,     // must exist in teams.api (RPC that adds existing user by email)
  removeMemberRPC,         // RPC to remove a member from team
  renameTeamRPC,
  deleteTeamRPC,
  // Calendar API
  createTeamEvent,
  deleteTeamEvent,
  deleteEventOccurrence,
  patchEventOccurrence,
} from "teams/teams.api";

import { useCalendarData } from "teams/hooks/useCalendarData";
import CalendarPanel from "teams/components/CalendarPanel";

import {
  H1, Row, Button, GhostButton, Input, Label, InfoText, ErrorText, DangerButton
} from "components/ui";

export default function TeamsPanel() {
  const { session } = useAuth();
  const user = session?.user;

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [selected, setSelected] = useState(null); // { id, name, display_id, role }
  const [members, setMembers] = useState([]);

  const refreshTeams = async () => {
    setErr("");
    try {
      const list = await listMyTeams(user.id);
      setTeams(list);
      setLoading(false);
      // keep selection in sync
      if (selected) {
        const s = list.find(t => t.id === selected.id);
        if (s) {
          setSelected(s);
        } else {
          setSelected(null);
          setMembers([]);
        }
      }
    } catch (e) {
      setErr(e.message || "Failed to load teams");
      setLoading(false);
    }
  };

  useEffect(() => { refreshTeams(); /* eslint-disable-next-line */ }, []);

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

  const backToList = () => {
    setSelected(null);
    setMembers([]);
  };

  const createNewTeam = async () => {
    if (!newName.trim()) return;
    setCreating(true); setErr("");
    try {
      const team = await createTeam(newName.trim()); // RPC: also adds you as admin
      setNewName("");
      setShowCreate(false);
      await refreshTeams();
      await openTeam({ ...team, role: "admin" });   // jump into the new team
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {selected && <GhostButton onClick={backToList}>← All teams</GhostButton>}
        <H1 style={{ margin: 0, lineHeight: 1.1 }}>{selected ? selected.name : "Teams"}</H1>
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
              {teams.map(t => (
                <li key={t.id}
                    style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}
                    onClick={() => openTeam(t)}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                    <div><strong>{t.name}</strong> <span style={{ opacity:0.7 }}>({t.display_id})</span></div>
                    <span style={{ opacity: 0.7 }}>{t.role}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Create team toggle at bottom */}
          <div style={{ marginTop: 16 }} />
          {!showCreate ? (
            <GhostButton onClick={() => setShowCreate(true)}>+ Create team</GhostButton>
          ) : (
            <div style={{ display:"grid", gap:8, marginTop: 8 }}>
              <Label>Team name
                <Input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="e.g. Writers Room" />
              </Label>
              <Row>
                <Button onClick={createNewTeam} disabled={creating || !newName.trim()}>
                  {creating ? "Creating…" : "Create Team"}
                </Button>
                <GhostButton onClick={()=>{ setShowCreate(false); setNewName(""); }}>Cancel</GhostButton>
              </Row>
              <InfoText>Duplicates allowed. A unique id like <code>Name#1</code> is generated.</InfoText>
            </div>
          )}
        </>
      ) : (
        <TeamDetail
          team={selected}
          members={members}
          currentUserId={user.id}
          onMembersRefresh={async () => {
            const mem = await listTeamMembersRPC(selected.id);
            setMembers(mem);
          }}
          onChangeRole={async (uId, role) => {
            try {
              await setMemberRoleRPC(selected.id, uId, role);
              const mem = await listTeamMembersRPC(selected.id);
              setMembers(mem);
              await refreshTeams();
            } catch (e) {
              setErr(e.message || "Failed to update role");
            }
          }}
          onRenamed={(updated) => {
            setSelected(prev => prev && prev.id === updated.id ? { ...prev, name: updated.name } : prev);
            refreshTeams();
          }}
          onDeleted={() => {
            setSelected(null);
            setMembers([]);
            refreshTeams();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Detail                                   */
/* -------------------------------------------------------------------------- */

function TeamDetail({ team, members, currentUserId, onChangeRole, onRenamed, onDeleted, onMembersRefresh }) {
  const [subTab, setSubTab] = useState("members"); // 'members' | 'calendar'

  // rename
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => setName(team.name), [team.id, team.name]);

  const submitRename = async () => {
    const next = name.trim();
    if (!next || next === team.name) { setEditing(false); return; }
    if (!window.confirm(`Rename team to “${next}”?`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const updated = await renameTeamRPC(team.id, next);
      setEditing(false);
      setMsg("Team renamed ✓");
      onRenamed?.(updated);
    } catch (e) {
      setErr(e.message || "Rename failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 1500);
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete “${team.name}” permanently? This cannot be undone.`)) return;
    setBusy(true); setErr("");
    try {
      await deleteTeamRPC(team.id);
      onDeleted?.();
    } catch (e) {
      setErr(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  // Add member UI
  const [showAdd, setShowAdd] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const adminCount = useMemo(() => members.filter(m => m.role === "admin").length, [members]);

  const addMember = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setAdding(true); setErr(""); setMsg("");
    try {
      await addMemberByEmailRPC(team.id, email);
      setInviteEmail("");
      setShowAdd(false);
      await onMembersRefresh?.();
      setMsg("Member added ✓"); setTimeout(()=>setMsg(""), 1500);
    } catch (e) {
      setErr(e.message || "Add member failed");
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (userId, isSelf, isAdmin) => {
    if (isSelf && isAdmin && adminCount <= 1) {
      alert("You are the last admin and cannot leave the team. Assign another admin first.");
      return;
    }
    const action = isSelf ? "leave this team" : "remove this member";
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;
    try {
      await removeMemberRPC(team.id, userId);
      await onMembersRefresh?.();
    } catch (e) {
      setErr(e.message || "Failed to remove member");
    }
  };

  /* --------------------------- Calendar wiring --------------------------- */
  const cal = useCalendarData(team.id);

  return (
    <>
      {/* Header: name + tiny rename icon */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop: 8 }}>
        {editing ? (
          <>
            <Input
              value={name}
              onChange={(e)=>setName(e.target.value)}
              onKeyDown={(e)=> e.key === "Enter" && submitRename()}
              autoFocus
              style={{ minWidth: 220 }}
            />
            <Button onClick={submitRename} disabled={busy || !name.trim()}>Save</Button>
            <GhostButton onClick={()=>{ setEditing(false); setName(team.name); }}>Cancel</GhostButton>
          </>
        ) : (
          <>
            <H1 style={{ margin: 0, lineHeight: 1.1 }}>{team.name}</H1>
            {/* subtle pencil icon */}
            {team.role === "admin" && (
              <GhostButton onClick={()=>setEditing(true)} title="Rename team" aria-label="Rename team">✏️</GhostButton>
            )}
          </>
        )}
      </div>

      <p style={{ marginTop: 6, opacity: 0.8 }}>
        ID: <code>{team.display_id}</code> · Your role: <strong>{team.role}</strong>
      </p>

      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {/* Sub tabs */}
      <div style={{ display:"flex", gap:8, margin:"6px 0 12px" }}>
        <button
          style={subTab==="members" ? styles.tabActive : styles.tabBtn}
          onClick={()=>setSubTab("members")}
        >Members</button>
        <button
          style={subTab==="calendar" ? styles.tabActive : styles.tabBtn}
          onClick={()=>setSubTab("calendar")}
        >Calendar</button>
      </div>

      {subTab === "members" ? (
        <>
          {members.length === 0 ? (
            <p style={{ opacity: 0.8 }}>No members yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {members.map(m => {
                const isSelf = m.user_id === currentUserId;
                const isAdmin = m.role === "admin";
                return (
                  <li key={m.user_id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap: 12, alignItems: "center" }}>
                      <div style={{ display: "grid" }}>
                        <strong>{m.display_name || m.full_name || m.email || m.user_id}</strong>
                        <span style={{ opacity: 0.7, fontSize: 12 }}>{m.email || m.user_id}</span>
                      </div>

                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ opacity: 0.8 }}>{m.role}</span>

                        {/* Single role toggle button (don’t show both) */}
                        {team.role === "admin" && m.user_id !== currentUserId && (
                          m.role === "admin" ? (
                            <Button style={{ padding:"6px 10px" }} onClick={() => onChangeRole(m.user_id, "member")}>Make member</Button>
                          ) : (
                            <Button style={{ padding:"6px 10px" }} onClick={() => onChangeRole(m.user_id, "admin")}>Make admin</Button>
                          )
                        )}

                        {/* Remove / Leave */}
                        {isSelf ? (
                          <DangerButton style={{ padding:"6px 10px" }} onClick={() => removeMember(m.user_id, true, isAdmin)}>
                            Leave
                          </DangerButton>
                        ) : (
                          team.role === "admin" && (
                            <DangerButton style={{ padding:"6px 10px" }} onClick={() => removeMember(m.user_id, false, isAdmin)}>
                              Remove
                            </DangerButton>
                          )
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Add member toggle */}
          <div style={{ marginTop: 12 }}>
            {!showAdd ? (
              team.role === "admin" && <GhostButton onClick={()=>setShowAdd(true)}>+ Add member</GhostButton>
            ) : (
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <Input
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e)=>setInviteEmail(e.target.value)}
                  style={{ minWidth: 240 }}
                />
                <Button onClick={addMember} disabled={adding || !inviteEmail.trim()}>Add</Button>
                <GhostButton onClick={()=>{ setShowAdd(false); setInviteEmail(""); }}>Cancel</GhostButton>
              </div>
            )}
          </div>

          {team.role === "admin" && (
            <div style={{ marginTop: 18 }}>
              <DangerButton onClick={deleteTeam} disabled={busy}>Delete team</DangerButton>
            </div>
          )}
        </>
      ) : (
        // Calendar subtab
        <CalendarPanel
          team={team}
          /* from hook */
          occurrencesAll={cal.occurrencesAll}
          upcomingOcc={cal.upcomingOcc}
          pastSlice={cal.pastSlice}
          pastHasMore={cal.pastHasMore}
          onPastMore={cal.onPastMore}
          refreshCalendar={cal.refresh}
          getEventById={cal.getEventById}
          summarizeRecurrence={cal.summarizeRecurrence}
          countFutureOccurrencesInSeries={cal.countFutureOccurrencesInSeries}
          applyFutureEdits={cal.applyFutureEdits}
          applySeriesEdits={cal.applySeriesEdits}
          /* API functions */
          createEvent={createTeamEvent}
          deleteSeries={deleteTeamEvent}
          deleteOccurrence={deleteEventOccurrence}
          patchOccurrence={patchEventOccurrence}
        />
      )}
    </>
  );
}

const styles = {
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
