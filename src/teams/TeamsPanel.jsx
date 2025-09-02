import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { listMyTeams, createTeam, listTeamMembersRPC, setMemberRoleRPC } from "teams/teams.api";
import { H1, Row, Button, GhostButton, Input, Label, InfoText, ErrorText, DangerButton } from "components/ui";
import { renameTeamRPC, deleteTeamRPC } from "teams/teams.api";

export default function TeamsPanel() {
  const { session } = useAuth();
  const user = session?.user;

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

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
      if (selected) {
      const s = list.find(t => t.id === selected.id);
      if (s) {
        setSelected(s);
      } else {
        setSelected(null);    // <- unselect if it was deleted
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
        <H1 style={{ marginBottom: 0 }}>{selected ? selected.name : "Teams"}</H1>
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

          <div style={{ marginTop: 16 }} />
          <Label>Team name
            <Input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="e.g. Writers Room" />
          </Label>
          <Row>
            <Button onClick={createNewTeam} disabled={creating || !newName.trim()}>
              {creating ? "Creating…" : "Create Team"}
            </Button>
          </Row>
          <InfoText>Duplicates allowed. A unique id like <code>Name#1</code> is generated.</InfoText>
        </>
      ) : (
        <TeamDetail
  team={selected}
  members={members}
  currentUserId={user.id}
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
    // update selection title immediately, refresh list to sync roles
    setSelected(prev => prev && prev.id === updated.id ? { ...prev, name: updated.name } : prev);
    refreshTeams();
  }}
  onDeleted={() => {
    // back to list after deletion
    setSelected(null);
    setMembers([]);
    refreshTeams();
  }}
   />
      )}
    </>
  );
}

function TeamDetail({ team, members, currentUserId, onChangeRole, onRenamed, onDeleted }) {
  const isAdmin = team.role === "admin";
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
      onRenamed?.(updated); // let parent refresh list/selection
    } catch (e) {
      setErr(e.message || "Rename failed");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 1500);
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete “${team.name}” permanently? This cannot be undone.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await deleteTeamRPC(team.id);
      onDeleted?.(); // parent should go back to list & refresh
    } catch (e) {
      setErr(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Header: click-to-rename */}
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
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
            <H1 style={{ margin: 0, cursor: isAdmin ? "pointer" : "default" }}
                onClick={() => isAdmin && setEditing(true)}>
              {team.name}
            </H1>
            {isAdmin && <GhostButton onClick={()=>setEditing(true)}>Rename</GhostButton>}
          </>
        )}
      </div>

      <p style={{ marginTop: 6, opacity: 0.8 }}>
        ID: <code>{team.display_id}</code> · Your role: <strong>{team.role}</strong>
      </p>

      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      <h3 style={{ margin: "16px 0 8px", fontSize: 16 }}>Members</h3>
      {members.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No members yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {members.map(m => (
            <li key={m.user_id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap: 12, alignItems: "center" }}>
                <div style={{ display: "grid" }}>
                  <strong>{m.full_name || m.email || m.user_id}</strong>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>{m.email || m.user_id}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ opacity: 0.8 }}>{m.role}</span>
                  {isAdmin && m.user_id !== currentUserId && (
                    <>
                      <Button style={{ padding: "6px 10px" }} onClick={() => onChangeRole(m.user_id, "admin")}>Make admin</Button>
                      <Button style={{ padding: "6px 10px" }} onClick={() => onChangeRole(m.user_id, "member")}>Make member</Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div style={{ marginTop: 18 }}>
          <DangerButton onClick={deleteTeam} disabled={busy}>Delete team</DangerButton>
        </div>
      )}
    </>
  );
}
