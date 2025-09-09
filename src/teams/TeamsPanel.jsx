// src/teams/TeamsPanel.jsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "auth/AuthContext";
import {
  // Teams & members
  listMyTeams,            // returns [{ id, name, display_id, role }]
  createTeam,
  listTeamMembersRPC,     // MUST pass teamId: supabase.rpc("list_team_members", { p_team_id: teamId })
  setMemberRoleRPC,
  addMemberByEmailRPC,
  removeMemberRPC,
  renameTeamRPC,
  deleteTeamRPC,
} from "./teams.api";
import CalendarPanel from "./components/CalendarPanel";
import {
  Card, H1, Label, Input, Button, GhostButton, DangerButton, ErrorText, InfoText, Row,
} from "components/ui";

export default function TeamsPanel() {
  const { session } = useAuth();
  const currentUserId = session?.user?.id;

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [selected, setSelected] = useState(null); // current team object
  const [members, setMembers] = useState([]);

  // create team UI
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // invite UI (when team is open)
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  const isAdmin = useMemo(() => {
    if (!selected) return false;
    const me = members.find((m) => m.user_id === currentUserId);
    return me?.role === "admin";
  }, [members, currentUserId, selected]);

  useEffect(() => {
    (async () => {
      setErr(""); setMsg(""); setLoading(true);
      try {
        const data = await listMyTeams();
        setTeams(data || []);
      } catch (e) {
        setErr(e.message || "Failed to load teams");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadMembers = async (team) => {
    if (!team?.id) return;
    setErr(""); setMsg("");
    try {
      // ✅ Option A fix: pass the team id to the RPC wrapper
      const mem = await listTeamMembersRPC(team.id);
      setMembers(mem);
    } catch (e) {
      setErr(e.message || "Failed to load members");
    }
  };

  const openTeam = async (team) => {
    setSelected(team);
    setMembers([]);
    await loadMembers(team);
  };

  const backToList = () => {
    setSelected(null);
    setMembers([]);
    setShowInvite(false);
    setInviteEmail("");
    setInviteRole("member");
  };

  const createNewTeam = async () => {
    if (!newName.trim()) return;
    setCreating(true); setErr(""); setMsg("");
    try {
      const t = await createTeam(newName.trim());
      // ensure role visible in list (server usually returns with role:'admin' for creator)
      setTeams((ts) => [t, ...ts]);
      setNewName("");
      await openTeam(t);
    } catch (e) {
      setErr(e.message || "Failed to create team");
    } finally {
      setCreating(false);
    }
  };

  const renameTeam = async () => {
    const name = window.prompt("Rename team", selected?.name || "");
    if (!name || !name.trim()) return;
    setErr(""); setMsg("");
    try {
      await renameTeamRPC(selected.id, name.trim());
      setSelected({ ...selected, name: name.trim() });
      setTeams((ts) => ts.map((t) => (t.id === selected.id ? { ...t, name: name.trim() } : t)));
      setMsg("Team renamed.");
    } catch (e) {
      setErr(e.message || "Failed to rename team");
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm("Delete team? This cannot be undone.")) return;
    setErr(""); setMsg("");
    try {
      await deleteTeamRPC(selected.id);
      setTeams((ts) => ts.filter((t) => t.id !== selected.id));
      backToList();
      setMsg("Team deleted.");
    } catch (e) {
      setErr(e.message || "Failed to delete team");
    }
  };

  const leaveTeam = async () => {
    if (!window.confirm("Leave this team?")) return;
    setErr(""); setMsg("");
    try {
      await removeMemberRPC(selected.id, currentUserId);
      setTeams((ts) => ts.filter((t) => t.id !== selected.id));
      backToList();
      setMsg("You left the team.");
    } catch (e) {
      setErr(e.message || "Failed to leave team");
    }
  };

  const inviteMember = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true); setErr(""); setMsg("");
    try {
      await addMemberByEmailRPC(selected.id, inviteEmail.trim(), inviteRole);
      setInviteEmail("");
      setInviteRole("member");
      setShowInvite(false);
      await loadMembers(selected);
      setMsg("Invitation added.");
    } catch (e) {
      setErr(e.message || "Failed to add member");
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (userId, role) => {
    setErr(""); setMsg("");
    try {
      await setMemberRoleRPC(selected.id, userId, role);
      await loadMembers(selected);
      setMsg("Role updated.");
    } catch (e) {
      setErr(e.message || "Failed to update role");
    }
  };

  const removeMember = async (userId) => {
    if (!window.confirm("Remove this member from the team?")) return;
    setErr(""); setMsg("");
    try {
      await removeMemberRPC(selected.id, userId);
      await loadMembers(selected);
      setMsg("Member removed.");
    } catch (e) {
      setErr(e.message || "Failed to remove member");
    }
  };

  if (loading) return <p style={{ opacity: 0.8 }}>Loading teams…</p>;

  return (
    <Card style={{ marginTop: 16 }}>
      <H1>Teams</H1>
      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {!selected ? (
        <>
          <Label>
            Create new team
            <Row>
              <Input
                placeholder="Team name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <Button disabled={creating || !newName.trim()} onClick={createNewTeam}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </Row>
          </Label>

          <div style={{ marginTop: 20 }}>
            <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Your teams</h3>
            {teams.length === 0 ? (
              <p style={{ opacity: 0.8 }}>No teams yet. Create one above.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {teams.map((t) => (
                  <li
                    key={t.id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        {t.display_id} · you are {t.role}
                      </div>
                    </div>
                    <Row>
                      <GhostButton onClick={() => openTeam(t)}>Open</GhostButton>
                    </Row>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <Row>
            <GhostButton onClick={backToList}>← Back</GhostButton>
            <div style={{ flex: 1 }} />
            {isAdmin ? (
              <>
                <GhostButton onClick={renameTeam}>Rename</GhostButton>
                <DangerButton onClick={deleteTeam}>Delete team</DangerButton>
              </>
            ) : (
              <DangerButton onClick={leaveTeam}>Leave team</DangerButton>
            )}
          </Row>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>{selected.name}</h3>
            <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 12 }}>
              {selected.display_id}
            </div>

            <h3 style={{ margin: "12px 0 8px", fontSize: 16 }}>Members</h3>

            {/* Invite box (admins only) */}
            {isAdmin && (
              <>
                {!showInvite ? (
                  <GhostButton onClick={() => setShowInvite(true)}>Invite member</GhostButton>
                ) : (
                  <Row>
                    <Input
                      placeholder="email@example.com"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      style={{ minWidth: 260 }}
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      style={styles.select}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button disabled={inviting || !inviteEmail.trim()} onClick={inviteMember}>
                      {inviting ? "Adding…" : "Add"}
                    </Button>
                    <GhostButton
                      onClick={() => {
                        setShowInvite(false);
                        setInviteEmail("");
                        setInviteRole("member");
                      }}
                    >
                      Cancel
                    </GhostButton>
                  </Row>
                )}
              </>
            )}

            {members.length === 0 ? (
              <p style={{ opacity: 0.8, marginTop: 10 }}>No members yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                {members.map((m) => {
                  const isSelf = m.user_id === currentUserId;
                  const canEdit = isAdmin && !isSelf;
                  const display = m.display_name || m.email || m.user_id;

                  return (
                    <li
                      key={m.user_id}
                      style={{
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {display} {isSelf ? <span style={{ opacity: 0.6 }}>(you)</span> : null}
                        </div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>{m.role}</div>
                      </div>

                      <Row>
                        {canEdit && (
                          <>
                            <select
                              value={m.role}
                              onChange={(e) => changeRole(m.user_id, e.target.value)}
                              style={styles.select}
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                            <DangerButton onClick={() => removeMember(m.user_id)}>Remove</DangerButton>
                          </>
                        )}
                        {!isAdmin && isSelf && (
                          <DangerButton onClick={leaveTeam}>Leave</DangerButton>
                        )}
                      </Row>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Calendar mounted below members */}
            <CalendarPanel team={selected} />
          </div>
        </>
      )}
    </Card>
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
