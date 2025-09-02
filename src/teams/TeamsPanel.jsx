import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { listMyTeams, createTeamWithAdmin, listTeamMembers } from "teams/teams.api";
import { H1, Tabs, Tab, Row, Button, Input, Label, InfoText, ErrorText } from "components/ui";

export default function TeamsPanel() {
  const { session } = useAuth();
  const user = session?.user;
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [selected, setSelected] = useState(null); // {id,name,display_id,role}
  const [members, setMembers] = useState([]);

  const refresh = async () => {
    setErr("");
    try {
      const list = await listMyTeams(user.id);
      setTeams(list);
      // if a team is selected, refresh its membership
      if (selected?.id) {
        const mem = await listTeamMembers(selected.id);
        setMembers(mem);
      }
    } catch (e) {
      setErr(e.message || "Failed to load teams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  const createTeam = async () => {
    if (!newName.trim()) return;
    setCreating(true); setErr("");
    try {
      const team = await createTeamWithAdmin(newName.trim(), user.id);
      setNewName("");
      await refresh();
      // focus new team
      const found = { ...team, role: "admin" };
      setSelected(found);
      const mem = await listTeamMembers(team.id);
      setMembers(mem);
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const openTeam = async (team) => {
    setSelected(team);
    setErr("");
    try {
      const mem = await listTeamMembers(team.id);
      setMembers(mem);
    } catch (e) {
      setErr(e.message || "Failed to load members");
    }
  };

  return (
    <>
      <H1>Teams</H1>
      {err && <ErrorText>{err}</ErrorText>}

      <Tabs>
        <Tab active={!selected} onClick={() => setSelected(null)}>My teams</Tab>
        <Tab active={!!selected} onClick={() => { if (selected) openTeam(selected); }}>
          {selected ? `${selected.name}` : "Details"}
        </Tab>
      </Tabs>

      {!selected ? (
        <>
          {loading ? (
            <p>Loading teams…</p>
          ) : (
            <>
              {teams.length === 0 ? (
                <p style={{ opacity: 0.8 }}>You don’t belong to any teams yet.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
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
                <Button onClick={createTeam} disabled={creating || !newName.trim()}>
                  {creating ? "Creating…" : "Create Team"}
                </Button>
              </Row>
              <InfoText>Duplicates allowed. A unique id like <code>Name#1</code> is generated.</InfoText>
            </>
          )}
        </>
      ) : (
        <TeamDetail team={selected} members={members} />
      )}
    </>
  );
}

function TeamDetail({ team, members }) {
  return (
    <>
      <p style={{ marginTop: 4 }}>
        <strong>{team.name}</strong> <span style={{ opacity:0.7 }}>({team.display_id})</span>
      </p>
      <p style={{ opacity: 0.8 }}>Your role: <strong>{team.role}</strong></p>

      <h3 style={{ margin: "16px 0 8px", fontSize: 16 }}>Members</h3>
      {members.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No members yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {members.map(m => (
            <li key={m.user_id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display:"flex", justifyContent:"space-between" }}>
                <code style={{ opacity: 0.8 }}>{m.user_id}</code>
                <span style={{ opacity: 0.8 }}>{m.role}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
