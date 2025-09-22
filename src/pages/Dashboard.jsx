// src/pages/Dashboard.jsx
import { useState, useEffect } from "react";
import { useAuth } from "auth/AuthContext";
import ProfilePanel from "profiles/ProfilePanel";
import TeamsPanel from "teams/TeamsPanel";
import { listMyOwnerNotifications, dismissOwnerNotification, respondOwnerNotification } from "teams/teams.api";
import { signOut } from "auth/auth.api";
import { CenterWrap, Card, H1, Tabs, Tab, GhostButton, Button, ErrorText, Row } from "components/ui";

export default function Dashboard() {
  const { session, displayName, user } = useAuth();
  const [tab, setTab] = useState("home"); // 'home' | 'groups' | 'profile'
  const [notifs, setNotifs] = useState([]);
  const [notifsLoading, setNotifsLoading] = useState(true);
  const [notifsErr, setNotifsErr] = useState("");

  const loadNotifs = async () => {
    setNotifsErr(""); setNotifsLoading(true);
    try {
      const rows = await listMyOwnerNotifications();
      setNotifs(rows || []);
    } catch (e) { setNotifsErr(e.message || "Failed to load notifications"); }
    finally { setNotifsLoading(false); }
  };

  useEffect(() => { loadNotifs(); }, []);

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
              Use the <strong>Groups</strong> tab to create/join groups, or the <strong>Profile</strong> tab to update your display name.
            </p>
            <div style={{ marginTop: 18 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Notifications</h3>
              {/* Owner notifications (individual owner) */}
              <div style={{ marginTop: 12 }}>
                {notifsErr && <ErrorText>{notifsErr}</ErrorText>}
                {notifsLoading ? (
                  <p style={{ opacity: 0.8 }}>Loading…</p>
                ) : (notifs.length === 0 ? (
                  <p style={{ opacity: 0.8 }}>No notifications.</p>
                ) : (
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
                        opacity: n.dismissed_at ? 0.6 : 1,
                      }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{n.title || (n.type === 'ack' ? 'Action required' : 'Notification')}</div>
                          {n.body && <div style={{ opacity: 0.85, marginTop: 2 }}>{n.body}</div>}
                          <div style={{ opacity: 0.7, fontSize: 12 }}>{new Date(n.created_at).toLocaleString()}</div>
                        </div>
                        <Row>
                          {n.type === 'ack' && !n.ack_response && (
                            <>
                              <Button onClick={async ()=> { await respondOwnerNotification(n.id, 'yes'); await loadNotifs(); }}>Yes</Button>
                              <GhostButton onClick={async ()=> { await respondOwnerNotification(n.id, 'no'); await loadNotifs(); }}>No</GhostButton>
                            </>
                          )}
                          <GhostButton onClick={async ()=> { await dismissOwnerNotification(n.id); await loadNotifs(); }}>Dismiss</GhostButton>
                        </Row>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
            <GhostButton onClick={() => setTab("groups")} style={{ marginTop: 12 }}>
              Go to Groups →
            </GhostButton>
          </Tab>

          <Tab value="groups" label="Groups">
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
