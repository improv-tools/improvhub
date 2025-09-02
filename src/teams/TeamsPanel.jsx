// src/teams/TeamsPanel.jsx
import { useEffect, useState } from "react";
import { useAuth } from "auth/AuthContext";
import {
  listMyTeams,
  createTeam,
  listTeamMembersRPC,
  setMemberRoleRPC,
  renameTeamRPC,
  deleteTeamRPC,
  addMemberByEmailRPC,
} from "teams/teams.api";
import {
  H1,
  Row,
  Button,
  GhostButton,
  Input,
  Label,
  InfoText,
  ErrorText,
  DangerButton,
} from "components/ui";

export default function TeamsPanel() {
  const { session } = useAuth();
  const user = session?.user;

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // create (only shown in list view)
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // selection + members
  const [selected, setSelected] = useState(null); // { id, name, display_id, role }
  const [members, setMembers] = useState([]);

  // rename (header, admins only)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const refreshTeams = async () => {
    setErr("");
    try {
      const list = await listMyTeams(user.id);
      setTeams(list);
      setLoading(false);
      if (selected) {
        const s = list.find((t) => t.id === selected.id);
        if (s) {
          setSelected(s);
        } else {
          setSelected(null); // unselect if deleted
          setMembers([]);
        }
      }
    } catch (e) {
      setErr(e.message || "Failed to load teams");
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshTeams();
    // eslint-disable-next-line
  }, []);

  // keep rename draft synced to selection
  useEffect(() => {
    if (selected) {
      setEditingName(false);
      setNameDraft(selected.name || "");
    } else {
      setEditingName(false);
      setNameDraft("");
    }
  }, [selected?.id, selected?.name]);

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
    const value = newName.trim();
    if (!value) return;
    setCreating(true);
    setErr("");
    try {
      const team = await createTeam(value); // RPC: creator becomes admin
      setNewName("");
      await refreshTeams();
      await openTeam({ ...team, role: "admin" }); // jump into the new team
    } catch (e) {
      setErr(e.message || "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const doRename = async () => {
    if (!selected) return;
    const next = (nameDraft || "").trim();
    if (!next || next === selected.name) {
      setEditingName(false);
      return;
    }
    if (!window.confirm(`Rename team to “${next}”?`)) return;
    try {
      const updated = await renameTeamRPC(selected.id, next);
      // update local selection immediately
      setSelected((prev) =>
        prev && prev.id === updated.id ? { ...prev, name: updated.name } : prev
      );
      setEditingName(false);
      await refreshTeams(); // sync list
    } catch (e) {
      setErr(e.message || "Rename failed");
    }
  };

  return (
    <>
      {/* Header: back + team title (+ rename icon) OR just "Teams" */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          {selected && (
            <GhostButton onClick={backToList}>← All teams</GhostButton>
          )}

          {!selected && <H1 style={{ margin: 0 }}>Teams</H1>}

          {selected && !editingName && (
            <>
              <H1 style={{ margin: 0 }}>{selected.name}</H1>
              {selected.role === "admin" && (
                <button
                  aria-label="Rename team"
                  title="Rename team"
                  onClick={() => {
                    setEditingName(true);
                    setNameDraft(selected.name || "");
                  }}
                  style={styles.renameIcon}
                >
                  ✏️
                </button>
              )}
            </>
          )}

          {selected && editingName && (
            <>
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") await doRename();
                  if (e.key === "Escape") setEditingName(false);
                }}
                autoFocus
                style={{ minWidth: 220 }}
              />
              <Button
                onClick={doRename}
                disabled={!nameDraft.trim() || nameDraft.trim() === selected.name}
              >
                Save
              </Button>
              <GhostButton
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(selected.name || "");
                }}
              >
                Cancel
              </GhostButton>
            </>
          )}
        </div>
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
              {teams.map((t) => (
                <li
                  key={t.id}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer",
                  }}
                  onClick={() => openTeam(t)}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                    }}
                  >
                    <div>
                      <strong>{t.name}</strong>{" "}
                      <span style={{ opacity: 0.7 }}>({t.display_id})</span>
                    </div>
                    <span style={{ opacity: 0.7 }}>{t.role}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Create team (only in list view, at the bottom) */}
          <div style={{ marginTop: 16 }} />
          <Label>
            Team name
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Writers Room"
              onKeyDown={(e) => e.key === "Enter" && createNewTeam()}
            />
          </Label>
          <Row>
            <Button onClick={createNewTeam} disabled={creating || !newName.trim()}>
              {creating ? "Creating…" : "Create Team"}
            </Button>
          </Row>
          <InfoText>
            Duplicates allowed. A unique id like <code>Name#1</code> is generated.
          </InfoText>
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
          onAdded={async () => {
              const mem = await listTeamMembersRPC(selected.id);
              setMembers(mem);
              await refreshTeams();
          }}
          onDeleted={() => {
            // back to list after deletion
            setSelected(null);
            setMembers([]);
            refreshTeams();
          }}
        />
      )}
    </>
  );
}

function TeamDetail({ team, members, currentUserId, onChangeRole, onAdded, onDeleted }) {
  const isAdmin = team.role === "admin";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // NEW: invite by email
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  const invite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    setErr("");
    setMsg("");
    try {
      await addMemberByEmailRPC(team.id, email, inviteRole);
      setInviteEmail("");
      setInviteRole("member");
      setMsg("Member added ✓");
      onAdded?.(); // refresh roster in parent
      setTimeout(() => setMsg(""), 1500);
    } catch (e) {
      setErr(e.message || "Add member failed");
    } finally {
      setInviting(false);
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete “${team.name}” permanently? This cannot be undone.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await deleteTeamRPC(team.id);
      onDeleted?.(); // parent: back to list & refresh
    } catch (e) {
      setErr(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        ID: <code>{team.display_id}</code> · Your role: <strong>{team.role}</strong>
      </p>

      {err && <ErrorText>{err}</ErrorText>}
      {msg && <InfoText>{msg}</InfoText>}

      {/* NEW: Invite by email (admins only) */}
      {isAdmin && (
        <>
          <h3 style={{ margin: "16px 0 8px", fontSize: 16 }}>Add member</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Input
              placeholder="user@example.com"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && invite()}
              style={{ minWidth: 220 }}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{
                background: "#0f0f14",
                color: "white",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "10px 12px",
                outline: "none",
              }}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button onClick={invite} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? "Adding…" : "Add"}
            </Button>
          </div>
          <p style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
            Only existing accounts can be added.
          </p>
        </>
      )}

      <h3 style={{ margin: "16px 0 8px", fontSize: 16 }}>Members</h3>
      {members.length === 0 ? (
        <p style={{ opacity: 0.8 }}>No members yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {members.map((m) => (
            <li
              key={m.user_id}
              style={{
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid" }}>
                  <strong>{m.full_name || m.email || m.user_id}</strong>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>
                    {m.email || m.user_id}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ opacity: 0.8 }}>{m.role}</span>
                  {isAdmin && m.user_id !== currentUserId && (
                    <>
                      <Button
                        style={{ padding: "6px 10px" }}
                        onClick={() => onChangeRole(m.user_id, "admin")}
                      >
                        Make admin
                      </Button>
                      <Button
                        style={{ padding: "6px 10px" }}
                        onClick={() => onChangeRole(m.user_id, "member")}
                      >
                        Make member
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div style={{ marginTop: 18 }}>
          <DangerButton onClick={deleteTeam} disabled={busy}>
            Delete team
          </DangerButton>
        </div>
      )}
    </>
  );
}

const styles = {
  header: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  renameIcon: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 8,
    padding: "6px 8px",
    cursor: "pointer",
    color: "white",
  },
};
