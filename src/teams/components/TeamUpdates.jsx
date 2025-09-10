// src/teams/components/TeamUpdates.jsx
import { useEffect, useState } from "react";
import { Button, GhostButton, ErrorText, InfoText } from "components/ui";
import { listTeamUpdates } from "../teams.api";

function fmtAction(a) {
  const t = a?.action;
  const who = a?.actor_name || "Someone";
  const d = a?.details || {};
  const tname = d.title || d.event_title || "event";
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
  return `${who} did ${t}`;
}

export default function TeamUpdates({ team }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    if (!team?.id) return;
    setErr(""); setLoading(true);
    try {
      const r = await listTeamUpdates(team.id);
      setRows(r || []);
    } catch (e) { setErr(e.message || "Failed to load updates"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [team?.id]);

  return (
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
  );
}
