// src/teams/components/TeamMembers.jsx
import { useMemo, useState } from "react";
import { Button, GhostButton, Input, DangerButton, InfoText, ErrorText } from "components/ui";

export default function TeamMembers({
  team, members, currentUserId, isAdmin,
  onChangeRole, onAddMember, onRemoveMember, onLeaveTeam, onDeleteTeam,
  showDeleteTeamControl = true,
}) {
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  const adminCount = useMemo(() => members.filter(m => m.role === "admin").length, [members]);

  const addMember = async () => {
    const email = inviteEmail.trim(); if (!email) return;
    setInviting(true); setErr(""); setMsg("");
    try {
      await onAddMember(team.id, email, inviteRole);
      setInviteEmail(""); setInviteRole("member"); setShowInvite(false);
      setMsg("Member added ✓"); setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setErr(e.message || "Add member failed");
    } finally { setInviting(false); }
  };

  const remove = async (m) => {
    if (m.role === "admin" && adminCount === 1) { alert("You cannot remove the last admin from the team."); return; }
    if (!window.confirm("Remove this member from the team?")) return;
    await onRemoveMember(team.id, m.user_id);
  };

  const leave = async (m) => {
    if (m.role === "admin" && adminCount === 1) { alert("You are the last admin and cannot leave the team."); return; }
    if (!window.confirm("Leave this team?")) return;
    await onLeaveTeam(team.id, m.user_id);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Members</h3>
        {isAdmin && !showInvite && (
          <GhostButton style={{ padding: "6px 10px" }} onClick={() => setShowInvite(true)}>+ Add member</GhostButton>
        )}
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0 12px" }} />

      {/* Add member form (inline under header) */}
      {isAdmin && showInvite && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <Input
            placeholder="user@example.com"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
            style={{ minWidth: 220 }}
          />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={styles.select}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button onClick={addMember} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? "Adding…" : "Add"}
          </Button>
          <GhostButton onClick={() => { setShowInvite(false); setInviteEmail(""); setInviteRole("member"); }}>
            Cancel
          </GhostButton>
        </div>
      )}
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {members.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No members yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {members.map((m) => {
            const isSelf = m.user_id === currentUserId;
            return (
              <li key={m.user_id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ display: "grid" }}>
                    <strong>{m.display_name || m.email || m.user_id}</strong>
                    <span style={{ opacity: 0.7, fontSize: 12 }}>{m.email || m.user_id}</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ opacity: 0.8 }}>{m.role}</span>

                    {/* Self: Leave */}
                    {isSelf ? (
                      <DangerButton style={{ padding: "6px 10px" }} onClick={() => leave(m)}>Leave</DangerButton>
                    ) : (
                      <>
                        {/* Admin-only controls on others */}
                        {isAdmin && (
                          <>
                            <Button
                              style={{ padding: "6px 10px" }}
                              onClick={() => onChangeRole(team.id, m.user_id, m.role === "admin" ? "member" : "admin")}
                            >
                              {m.role === "admin" ? "Make member" : "Make admin"}
                            </Button>
                            <GhostButton style={{ padding: "6px 10px" }} onClick={() => remove(m)}>
                              Remove
                            </GhostButton>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* (invite toggle moved to header) */}

      {isAdmin && showDeleteTeamControl && (
        <div style={{ marginTop: 18 }}>
          <DangerButton onClick={() => onDeleteTeam(team.id)}>Delete team</DangerButton>
        </div>
      )}
    </>
  );
}

const styles = {
  select: {
    background: "#0f0f14",
    color: "white",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
  },
};
