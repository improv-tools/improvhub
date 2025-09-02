import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { listMyTeams, createTeam, listTeamMembersRPC, setMemberRoleRPC } from "teams/teams.api";
import { H1, Row, Button, GhostButton, Input, Label, InfoText, ErrorText } from "components/ui";

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
        const s = list.find(t => t.id === selected.id) || selected;
        setSelected(s);
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
        />
      )}
    </>
  );
}

function TeamDetail({ team, members, currentUserId, onChangeRole }) {
  const isAdmin = team.role === "admin";

  return (
    <>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        ID: <code>{team.display_id}</code> · Your role: <strong>{team.role}</strong>
      </p>

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
    </>
  );
}
