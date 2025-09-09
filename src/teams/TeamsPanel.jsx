// src/teams/TeamsPanel.jsx
import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import { Card, H1, Row, Input, Button, GhostButton, DangerButton, ErrorText, InfoText } from "components/ui";
import { useTeamsData } from "teams/hooks/useTeamsData";
import CalendarPanel from "teams/components/CalendarPanel";

export default function TeamsPanel() {
  const { user } = useAuth();
  const { teams, members, selected, loading, err, actions } = useTeamsData(user?.id);
  const [newTeam, setNewTeam] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(()=>{ /* initial load done in hook */ }, []);

  return (
    <div>
      <H1>Teams</H1>
      {err && <ErrorText>{err}</ErrorText>}

      <div style={{ display:"grid", gridTemplateColumns:"280px 1fr", gap:16, marginTop:16 }}>
        <div>
          <Row style={{ marginBottom: 8 }}>
            <Input placeholder="New team name" value={newTeam} onChange={e=>setNewTeam(e.target.value)} />
            <Button onClick={()=>{ if (newTeam.trim()) { actions.create(newTeam.trim()); setNewTeam(""); }}}>Create</Button>
          </Row>

          <div style={{ display:"grid", gap:8 }}>
            {teams.map(t => (
              <button key={t.id}
                onClick={() => actions.openTeam(t)}
                style={{
                  textAlign:"left",
                  padding:"8px 10px",
                  borderRadius:8,
                  border: `1px solid ${selected?.id===t.id ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)"}`,
                  background:"transparent",
                  color:"#fff",
                  cursor:"pointer",
                }}>
                <div style={{ fontWeight:600 }}>{t.name}</div>
                <div style={{ opacity:0.8, fontSize:12 }}>{t.display_id} · role: {t.role}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected && <InfoText>Select a team to manage members and calendar.</InfoText>}

          {selected && (
            <Card style={{ background:"transparent", border:"1px dashed rgba(255,255,255,0.2)" }}>
              <Row style={{ justifyContent:"space-between", marginBottom:8 }}>
                <H1 style={{ fontSize:22 }}>{selected.name}</H1>
                <DangerButton onClick={()=>{ if (confirm("Delete team?")) actions.remove(selected.id); }}>Delete team</DangerButton>
              </Row>

              <div style={{ display:"grid", gap:8, marginBottom:16 }}>
                <Row>
                  <Input placeholder="Invite by email…" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} />
                  <Button onClick={()=>{ if (inviteEmail.trim()) { actions.addMember(selected.id, inviteEmail.trim()); setInviteEmail(""); }}}>Invite</Button>
                </Row>
                <div style={{ fontWeight:600, marginTop:8 }}>Members</div>
                <div style={{ display:"grid", gap:6 }}>
                  {members.map(m => (
                    <Row key={m.user_id} style={{ justifyContent:"space-between" }}>
                      <div>
                        <div style={{ fontWeight:600 }}>{m.full_name || m.email}</div>
                        <div style={{ opacity:0.7, fontSize:12 }}>{m.role}</div>
                      </div>
                      <Row>
                        {m.role !== "admin" && (
                          <>
                            <GhostButton onClick={()=>actions.changeRole(selected.id, m.user_id, "member")}>Member</GhostButton>
                            <GhostButton onClick={()=>actions.changeRole(selected.id, m.user_id, "admin")}>Admin</GhostButton>
                          </>
                        )}
                        <DangerButton onClick={()=>actions.removeMember(selected.id, m.user_id)}>Remove</DangerButton>
                      </Row>
                    </Row>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 24 }}>
                <CalendarPanel team={selected} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
