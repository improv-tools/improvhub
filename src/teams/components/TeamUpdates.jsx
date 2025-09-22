// src/teams/components/TeamUpdates.jsx
import { useEffect, useState } from "react";
import { Button, GhostButton, ErrorText, InfoText, Row } from "components/ui";
import { listTeamUpdates, listGroupOwnerNotifications, dismissOwnerNotification, respondOwnerNotification, listGroupOutgoingInvites, cancelGroupInvite } from "../teams.api";

function fmtAction(a) {
  const t = a?.action;
  const who = a?.actor_name || "Someone";
  const d = a?.details || {};
  const tname = d.title || d.event_title || "";
  const occDate = (d.occ_start || d.occ_date)
    ? new Date(d.occ_start || d.occ_date).toLocaleDateString()
    : null;
  const occ = d.occ_start ? ` (${new Date(d.occ_start).toLocaleString()})` : "";
  const target = d.target_name || d.target_user_name || null;
  if (t === 'member_removed') return `${who} removed ${target || 'a member'}`;
  if (t === 'role_changed') return `${who} set ${target || 'a member'} to ${d.new_role}`;
  if (t === 'event_created') return `${who} created “${tname}”`;
  if (t === 'event_updated') return `${who} updated “${tname}”`;
  if (t === 'event_deleted') return `${who} deleted “${tname}”`;
  if (t === 'occurrence_canceled') return `${who} canceled an occurrence of “${tname}”${occ}`;
  if (t === 'occurrence_edited') return `${who} edited an occurrence of “${tname}”${occ}`;
  if (t === 'occurrence_override_cleared') return `${who} cleared an override for “${tname}”${occ}`;
  if (t === 'invite_sent') return `${who} invited ${target || 'a member'}${d.role ? ` (${d.role})` : ''}`;
  if (t === 'invite_accepted') return `${target || 'A member'} accepted an invite`;
  if (t === 'invite_declined') return `${target || 'A member'} declined an invite`;
  if (t === 'invite_canceled') return `${who} canceled an invite for ${target || 'a member'}`;
  if (t === 'attendance_changed') return `${d.by_name || who} marked ${d.attending ? 'Attending' : 'Not Attending'} for “${tname}”${occ}`;
  if (t === 'team_renamed') return `${who} renamed the team to “${d.new_name}”`;
  // Show lineup (showrunner bookings)
  const prod = d.production_name || who;
  const onDate = occDate ? ` on ${occDate}` : "";
  if (t === 'show_lineup_invited') return `${prod} invited the team to perform “${tname || prod}”${onDate}`;
  if (t === 'show_lineup_accepted') return `${who} accepted “${tname || prod}”${onDate}`;
  if (t === 'show_lineup_declined') return `${who} declined “${tname || prod}”${onDate}`;
  if (t === 'invite_withdrawn') return `${prod} withdrew an invitation for “${tname || prod}”${onDate}`;
  if (t === 'show_booking_removed') return `${prod} removed a booking for “${tname || prod}”${onDate}`;
  if (t === 'show_lineup_canceled') return `${prod} canceled a booking for “${tname || prod}”${onDate}`;
  if (t === 'show_lineup_removed') return `${prod} removed a booking for “${tname || prod}”${onDate}`;
  return `${who} did ${t}`;
}

export default function TeamUpdates({ team, isAdmin }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // Legacy updates feed (pre-prototype) may not exist in this schema
  const [legacyDisabled, setLegacyDisabled] = useState(false);
  const [gNotifs, setGNotifs] = useState([]);
  const [gLoading, setGLoading] = useState(true);
  const [gErr, setGErr] = useState("");
  const [outInv, setOutInv] = useState([]);
  const [outLoading, setOutLoading] = useState(true);
  const [outErr, setOutErr] = useState("");

  const load = async () => {
    if (!team?.id) return;
    setErr(""); setLoading(true);
    try {
      const r = await listTeamUpdates(team.id);
      setRows(r || []);
    } catch (e) {
      const msg = String(e?.message || e || "");
      // If the legacy function/view is missing or broken, quietly disable this section
      if (/list_team_updates|relation .* does not exist|ambiguous/i.test(msg)) {
        console.warn('[TeamUpdates] Disabling legacy updates feed:', msg);
        setLegacyDisabled(true);
        setRows([]);
        setErr("");
      } else {
        setErr(msg || "Failed to load updates");
      }
    }
    finally { setLoading(false); }
  };
  const loadG = async () => {
    if (!team?.id) return;
    setGErr(""); setGLoading(true);
    try {
      const r = await listGroupOwnerNotifications(team.id);
      setGNotifs(r || []);
    } catch (e) { setGErr(e.message || "Failed to load group notifications"); }
    finally { setGLoading(false); }
  };
  const loadOut = async () => {
    if (!team?.id) return;
    setOutErr(""); setOutLoading(true);
    try {
      const r = await listGroupOutgoingInvites(team.id);
      setOutInv(r || []);
    } catch (e) { setOutErr(e.message || "Failed to load outgoing invites"); }
    finally { setOutLoading(false); }
  };

  useEffect(() => { load(); loadG(); loadOut(); }, [team?.id]);

  return (
    <>
    {!legacyDisabled && (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Updates</h3>
        <GhostButton style={{ padding: "6px 10px" }} onClick={load}>Refresh</GhostButton>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0 12px" }} />

      {err && <ErrorText>{err}</ErrorText>}
      {loading ? (
        <p style={{ opacity: 0.8 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No updates in the last 90 days.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rows.map((a) => (
            <li key={a.id} style={{
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>{fmtAction(a)}</div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>{new Date(a.created_at).toLocaleString()}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
    )}
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Group notifications</h3>
        <GhostButton style={{ padding: "6px 10px" }} onClick={loadG}>Refresh</GhostButton>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0 12px" }} />

      {gErr && <ErrorText>{gErr}</ErrorText>}
      {gLoading ? (
        <p style={{ opacity: 0.8 }}>Loading…</p>
      ) : gNotifs.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No notifications.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {gNotifs.map((n) => (
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
                {isAdmin && n.type === 'ack' && !n.ack_response && (
                  <>
                    <Button onClick={async ()=> { await respondOwnerNotification(n.id, 'yes'); await loadG(); }}>Yes</Button>
                    <GhostButton onClick={async ()=> { await respondOwnerNotification(n.id, 'no'); await loadG(); }}>No</GhostButton>
                  </>
                )}
                {isAdmin && (
                  <GhostButton onClick={async ()=> { await dismissOwnerNotification(n.id); await loadG(); }}>Dismiss</GhostButton>
                )}
              </Row>
            </li>
          ))}
        </ul>
      )}
    </div>
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Outgoing invites</h3>
        <GhostButton style={{ padding: "6px 10px" }} onClick={loadOut}>Refresh</GhostButton>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0 12px" }} />

      {outErr && <ErrorText>{outErr}</ErrorText>}
      {outLoading ? (
        <p style={{ opacity: 0.8 }}>Loading…</p>
      ) : outInv.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No pending invites.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {outInv.map((n) => (
            <li key={n.id} style={{
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                {(() => {
                  const p = n?.payload || {};
                  const target = p.target_user_name || p.target_user_email || 'User';
                  const who = p.invited_by_name || '';
                  const role = p.role || '';
                  return (
                    <>
                      <div style={{ fontWeight: 600 }}>{`Invitation to ${target}`}</div>
                      <div style={{ opacity: 0.85, marginTop: 2 }}>
                        {role ? `Role: ${role}` : ''}{who ? (role ? ' · ' : '') + `Invited by ${who}` : ''}
                      </div>
                    </>
                  );
                })()}
                {/* Suppress generic body text for outgoing invites */}
                <div style={{ opacity: 0.7, fontSize: 12 }}>{new Date(n.created_at).toLocaleString()}</div>
              </div>
              <Row>
                {isAdmin && (
                  <GhostButton onClick={async ()=> { await cancelGroupInvite(n.id); await loadOut(); }}>Cancel invite</GhostButton>
                )}
              </Row>
            </li>
          ))}
        </ul>
      )}
    </div>
    </>
  );
}
