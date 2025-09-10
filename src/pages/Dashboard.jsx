// src/pages/Dashboard.jsx
import { useState, useEffect } from "react";
import { useAuth } from "auth/AuthContext";
import ProfilePanel from "profiles/ProfilePanel";
import TeamsPanel from "teams/TeamsPanel";
import { listMyInvitations, acceptInvitation, declineInvitation, listMyNotifications, deleteNotification } from "teams/teams.api";
import { signOut } from "auth/auth.api";
import { CenterWrap, Card, H1, Tabs, Tab, GhostButton, Button, ErrorText, Row } from "components/ui";

export default function Dashboard() {
  const { session, displayName } = useAuth();
  const [tab, setTab] = useState("home"); // 'home' | 'teams' | 'profile'
  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invErr, setInvErr] = useState("");
  const [notifs, setNotifs] = useState([]);
  const [notifsLoading, setNotifsLoading] = useState(true);
  const [notifsErr, setNotifsErr] = useState("");

  const loadInvites = async () => {
    setInvErr(""); setInvitesLoading(true);
    try {
      const rows = await listMyInvitations();
      setInvites(rows || []);
    } catch (e) { setInvErr(e.message || "Failed to load invitations"); }
    finally { setInvitesLoading(false); }
  };

  const loadNotifs = async () => {
    setNotifsErr(""); setNotifsLoading(true);
    try {
      const rows = await listMyNotifications();
      setNotifs(rows || []);
    } catch (e) { setNotifsErr(e.message || "Failed to load notifications"); }
    finally { setNotifsLoading(false); }
  };

  useEffect(() => { loadInvites(); loadNotifs(); }, []);

  return (
    <CenterWrap>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <H1 style={{ margin: 0 }}>ImprovHub</H1>
          <GhostButton onClick={signOut}>Sign out</GhostButton>
        </div>

        <Tabs value={tab} onChange={setTab}>
          <Tab value="home" label="Home">
            <p style={{ opacity: 0.9, marginTop: 4 }}>
              Hi <strong>{displayName || (session?.user?.email ?? "there")}</strong>!
            </p>
            <p style={{ opacity: 0.8, marginTop: 8 }}>
              Use the <strong>Teams</strong> tab to create/join teams, or the <strong>Profile</strong> tab to update your display name.
            </p>
            <div style={{ marginTop: 18 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Notifications</h3>
              {invErr && <ErrorText>{invErr}</ErrorText>}
              {invitesLoading ? (
                <p style={{ opacity: 0.8 }}>Loading…</p>
              ) : (invites.filter(i => i.status === 'invited').length === 0 ? (
                <p style={{ opacity: 0.8 }}>No new invitations.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {invites.filter(i => i.status === 'invited').map((inv) => (
                    <li key={inv.id} style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>Invitation: {inv.team_name}</div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>{inv.display_id} · role: {inv.role}</div>
                      </div>
                      <Row>
                        <Button onClick={async ()=> { await acceptInvitation(inv.team_id); await loadInvites(); }}>Accept</Button>
                        <GhostButton onClick={async ()=> { await declineInvitation(inv.team_id); await loadInvites(); }}>Decline</GhostButton>
                      </Row>
                    </li>
                  ))}
                </ul>
              ))}
              {/* Other notifications */}
              <div style={{ marginTop: 12 }}>
                {notifsErr && <ErrorText>{notifsErr}</ErrorText>}
                {notifsLoading ? (
                  <p style={{ opacity: 0.8 }}>Loading…</p>
                ) : (notifs.length === 0 ? null : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {notifs.map((n) => (
                      <li key={n.id} style={{
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        opacity: n.read_at ? 0.8 : 1,
                      }}>
                        <div>
                          {n.kind === 'removed_from_team' ? (
                            <div style={{ fontWeight: 600 }}>Removed from team: {n.team_name || n.display_id || n.team_id}</div>
                          ) : (
                            <div style={{ fontWeight: 600 }}>{n.kind}</div>
                          )}
                          <div style={{ opacity: 0.7, fontSize: 12 }}>{new Date(n.created_at).toLocaleString()}</div>
                        </div>
                        <Row>
                          <GhostButton onClick={async ()=> { await deleteNotification(n.id); await loadNotifs(); }}>Dismiss</GhostButton>
                        </Row>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
            <GhostButton onClick={() => setTab("teams")} style={{ marginTop: 12 }}>
              Go to Teams →
            </GhostButton>
          </Tab>

          <Tab value="teams" label="Teams">
            <TeamsPanel />
          </Tab>

          <Tab value="profile" label="Profile">
            <ProfilePanel />
          </Tab>
        </Tabs>
      </Card>
    </CenterWrap>
  );
}
