// src/pages/Dashboard.jsx
import { useState, useEffect } from "react";
import { useAuth } from "auth/AuthContext";
import ProfilePanel from "profiles/ProfilePanel";
import TeamsPanel from "teams/TeamsPanel";
import CoachingPanel from "coaching/CoachingPanel";
import ShowrunnerPanel from "showrunner/ShowrunnerPanel";
import { listMyInvitations, acceptInvitation, declineInvitation, listMyNotifications, deleteNotification } from "teams/teams.api";
import { signOut } from "auth/auth.api";
import { CenterWrap, Card, H1, Tabs, Tab, GhostButton, Button, ErrorText, Row } from "components/ui";

export default function Dashboard() {
  const { session, displayName, user } = useAuth();
  const isCoach = !!user?.user_metadata?.coach;
  const isShowrunner = !!user?.user_metadata?.showrunner;
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
                        <div style={{ opacity: 0.7, fontSize: 12 }}>ID: {inv.display_id} · role: {inv.role}</div>
                      </div>
                      <Row>
                        <Button onClick={async ()=> {
                          try {
                            await acceptInvitation(inv.team_id);
                            await loadInvites();
                          } catch (e) {
                            setInvErr(e?.message || 'Failed to accept team invite');
                          }
                        }}>Accept</Button>
                        <GhostButton onClick={async ()=> {
                          try {
                            await declineInvitation(inv.team_id);
                            await loadInvites();
                          } catch (e) {
                            setInvErr(e?.message || 'Failed to decline team invite');
                          }
                        }}>Decline</GhostButton>
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
                    {notifs.map((n) => {
                      const p = n.payload || {};
                      const when = (iso) => iso ? new Date(iso).toLocaleString() : '';
                      const line = (() => {
                        switch (n.kind) {
                          case 'removed_from_team':
                            return `Removed from team: ${n.team_name ? n.team_name : `ID: ${n.display_id || n.team_id}`}`;
                          case 'event_deleted':
                            return `Event deleted: ${p.title || p.event_id || ''}${p.by_name ? ` (by ${p.by_name})` : ''}`;
                          case 'event_changed': {
                            const parts = [];
                            if (p.new_location && p.old_location !== p.new_location) parts.push(`location → ${p.new_location}`);
                            if (p.new_starts_at && p.old_starts_at !== p.new_starts_at) parts.push(`starts → ${when(p.new_starts_at)}`);
                            if (p.new_ends_at && p.old_ends_at !== p.new_ends_at) parts.push(`ends → ${when(p.new_ends_at)}`);
                            const by = p.by_name ? ` (by ${p.by_name})` : '';
                            return `Event updated: ${p.title || p.event_id || ''}${by}${parts.length ? ' · ' + parts.join(', ') : ''}`;
                          }
                          case 'occurrence_canceled': {
                            const by = p.by_name ? ` (by ${p.by_name})` : '';
                            return `Occurrence canceled: ${p.title || p.event_id || ''} · ${when(p.occ_start)}${by}`;
                          }
                          case 'occurrence_changed': {
                            const parts = [];
                            if (p.new_location) parts.push(`location → ${p.new_location}`);
                            if (p.new_starts_at) parts.push(`starts → ${when(p.new_starts_at)}`);
                            if (p.new_ends_at) parts.push(`ends → ${when(p.new_ends_at)}`);
                            const by = p.by_name ? ` (by ${p.by_name})` : '';
                            return `Occurrence updated: ${p.title || p.event_id || ''} · ${when(p.occ_start)}${by}${parts.length ? ' · ' + parts.join(', ') : ''}`;
                          }
                          default:
                            return n.kind;
                        }
                      })();
                      return (
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
                            <div style={{ fontWeight: 600 }}>{line}</div>
                            <div style={{ opacity: 0.7, fontSize: 12 }}>
                              {n.team_name || ''}
                              {n.display_id ? (n.team_name ? ` · ID: ${n.display_id}` : `ID: ${n.display_id}`) : ''}
                              {` · ${new Date(n.created_at).toLocaleString()}`}
                            </div>
                          </div>
                          <Row>
                            <GhostButton onClick={async ()=> { await deleteNotification(n.id); await loadNotifs(); }}>Dismiss</GhostButton>
                          </Row>
                        </li>
                      );
                    })}
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

          {isCoach && (
            <Tab value="coaching" label="Coaching">
              <CoachingPanel />
            </Tab>
          )}

          {isShowrunner && (
            <Tab value="showrunner" label="Showrunner">
              <ShowrunnerPanel />
            </Tab>
          )}

          <Tab value="profile" label="Profile">
            <ProfilePanel />
          </Tab>
        </Tabs>
      </Card>
    </CenterWrap>
  );
}
