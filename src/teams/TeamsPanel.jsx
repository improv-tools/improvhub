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
  updateGroupTypes,
  updateGroupPublicListing,
} from "./teams.api";
import CalendarPanel from "./components/CalendarPanel";
import TeamUpdates from "./components/TeamUpdates";
import TeamMembers from "./components/TeamMembers";
import {
  Card, H1, Label, Input, Button, GhostButton, DangerButton, ErrorText, InfoText, Row, Tabs, Tab,
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
  const [invites, setInvites] = useState([]);
  const [teamTab, setTeamTab] = useState("updates"); // 'updates' | 'members' | 'calendar' | 'admin'
  const [typesDraft, setTypesDraft] = useState([]);
  const [savingTypes, setSavingTypes] = useState(false);
  const [publicDraft, setPublicDraft] = useState(false);
  const [savingPublic, setSavingPublic] = useState(false);

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

  const loadInvites = async (team) => {
    if (!team?.id) return;
    try {
      const rows = await (await import('./teams.api')).then(m => m);
    } catch {}
  };

  const openTeam = async (team) => {
    // Clear any prior banners when opening a team
    setErr("");
    setMsg("");
    setSelected(team);
    setTypesDraft(Array.isArray(team?.types) ? [...team.types] : []);
    setPublicDraft(!!team?.public_listing);
    setMembers([]);
    setTeamTab("updates");
    await loadMembers(team);
  };

  const backToList = () => {
    // Clear banners when leaving a team
    setErr("");
    setMsg("");
    setSelected(null);
    setTypesDraft([]);
    setPublicDraft(false);
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
    const name = window.prompt("Rename group", selected?.name || "");
    if (!name || !name.trim()) return;
    setErr(""); setMsg("");
    try {
      await renameTeamRPC(selected.id, name.trim());
      setSelected({ ...selected, name: name.trim() });
      setTeams((ts) => ts.map((t) => (t.id === selected.id ? { ...t, name: name.trim() } : t)));
      setMsg("Group renamed.");
    } catch (e) {
      setErr(e.message || "Failed to rename group");
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm("Delete group? This cannot be undone.")) return;
    setErr(""); setMsg("");
    try {
      await deleteTeamRPC(selected.id);
      setTeams((ts) => ts.filter((t) => t.id !== selected.id));
      backToList();
      setMsg("Group deleted.");
    } catch (e) {
      setErr(e.message || "Failed to delete group");
    }
  };

  const leaveTeam = async () => {
    if (!window.confirm("Leave this group?")) return;
    setErr(""); setMsg("");
    try {
      await removeMemberRPC(selected.id, currentUserId);
      setTeams((ts) => ts.filter((t) => t.id !== selected.id));
      backToList();
      setMsg("You left the group.");
    } catch (e) {
      setErr(e.message || "Failed to leave group");
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
      // Refresh invites list
      try {
        const { listTeamInvitations } = await import('./teams.api');
        const inv = await listTeamInvitations(selected.id);
        setInvites(inv);
      } catch {}
      setMsg("Invitation added.");
    } catch (e) {
      setErr(e.message || "Failed to add member");
    } finally {
      setInviting(false);
    }
  };

  const TYPES = [
    { key: 'act', label: 'Act' },
    { key: 'practice_group', label: 'Practice Group' },
    { key: 'school', label: 'School' },
    { key: 'theatre', label: 'Theatre' },
    { key: 'producer', label: 'Producer' },
  ];

  const toggleType = (key) => {
    setTypesDraft((cur) => {
      const set = new Set(cur || []);
      if (set.has(key)) set.delete(key); else set.add(key);
      return Array.from(set);
    });
  };

  const saveTypes = async () => {
    if (!selected?.id) return;
    setSavingTypes(true); setErr(""); setMsg("");
    try {
      await updateGroupTypes(selected.id, typesDraft);
      setSelected((s) => ({ ...s, types: [...typesDraft] }));
      setTeams((ts) => ts.map((t) => t.id === selected.id ? { ...t, types: [...typesDraft] } : t));
      setMsg('Group types updated.');
    } catch (e) {
      setErr(e.message || 'Failed to update group types');
    } finally { setSavingTypes(false); }
  };

  // Handlers for TeamMembers component (accept teamId explicitly)
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

  const handleChangeRole = async (teamId, userId, role) => {
    setErr("");
    try {
      await setMemberRoleRPC(teamId, userId, role);
      if (selected?.id === teamId) await loadMembers(selected);
    } catch (e) { setErr(e.message || "Failed to update role"); }
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

  const cancelInvite = async (teamId, userId) => {
    setErr("");
    try {
      const { cancelInvitation, listTeamInvitations } = await import('./teams.api');
      await cancelInvitation(teamId, userId);
      const inv = await listTeamInvitations(teamId);
      setInvites(inv);
    } catch (e) { setErr(e.message || "Failed to cancel invitation"); }
  };

  const handleAddMember = async (teamId, email, role) => {
    setErr("");
    try {
      await addMemberByEmailRPC(teamId, email, role);
      if (selected?.id === teamId) await loadMembers(selected);
      // Refresh invites immediately so pending invitation appears without tab change
      try {
        const { listTeamInvitations } = await import('./teams.api');
        const inv = await listTeamInvitations(teamId);
        setInvites(inv);
      } catch (e) {
        console.warn('Failed to refresh invitations', e?.message || e);
      }
    } catch (e) { setErr(e.message || "Failed to add member"); }
  };

  const handleRemoveMember = async (teamId, userId) => {
    if (!window.confirm("Remove this member from the team?")) return;
    setErr("");
    try {
      await removeMemberRPC(teamId, userId);
      if (selected?.id === teamId) await loadMembers(selected);
    } catch (e) { setErr(e.message || "Failed to remove member"); }
  };

  const handleLeaveTeam = async (teamId, userId) => {
    if (!window.confirm("Leave this group?")) return;
    setErr(""); setMsg("");
    try {
      await removeMemberRPC(teamId, userId);
      // If it's me and the current team, navigate back
      if (userId === currentUserId && selected?.id === teamId) {
        setTeams((ts) => ts.filter((t) => t.id !== teamId));
        backToList();
      } else if (selected?.id === teamId) {
        await loadMembers(selected);
      }
      setMsg(userId === currentUserId ? "You left the group." : "Member removed.");
    } catch (e) { setErr(e.message || "Failed to leave group"); }
  };

  const handleDeleteTeam = async (teamId) => {
    if (!window.confirm("Delete group? This cannot be undone.")) return;
    setErr(""); setMsg("");
    try {
      await deleteTeamRPC(teamId);
      setTeams((ts) => ts.filter((t) => t.id !== teamId));
      if (selected?.id === teamId) backToList();
      setMsg("Group deleted.");
    } catch (e) { setErr(e.message || "Failed to delete group"); }
  };

  if (loading) return <p style={{ opacity: 0.8 }}>Loading groups…</p>;

  return (
    <Card style={{ marginTop: 16 }}>
      {!selected && <H1>Groups</H1>}
      {err && <ErrorText style={{ marginBottom: 8 }}>{err}</ErrorText>}
      {msg && <InfoText style={{ marginBottom: 8 }}>{msg}</InfoText>}

      {!selected ? (
        <>
          <Label>
            Create new group
            <Row>
              <Input
                placeholder="Group name"
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
            <h3 style={{ margin: "8px 0 8px", fontSize: 16 }}>Your groups</h3>
            {teams.length === 0 ? (
              <p style={{ opacity: 0.8 }}>No groups yet. Create one above.</p>
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
                        ID: {t.display_id} · you are {t.role}{t.public_listing ? ' · public' : ''}
                        {Array.isArray(t.types) && t.types.length ? ` · types: ${t.types.map((x)=> (String(x).replace(/_/g,' '))).map(s => s.charAt(0).toUpperCase()+s.slice(1)).join(', ')}` : ''}
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
          <Row style={{ marginTop: 0, marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20 }}>
              <GhostButton onClick={backToList} style={{ padding: "6px 10px", fontSize: 16 }}>Groups</GhostButton>
              <span style={{ opacity: 0.6 }}>→</span>
              <span style={{ fontWeight: 800, fontSize: 22 }}>{selected.name}</span>
              <span style={{ opacity: 0.7, fontSize: 12 }}>ID: {selected.display_id}</span>
            </div>
          </Row>

          <div style={{ marginTop: 16 }}>

            <Tabs
              value={teamTab}
              onChange={(v) => { setTeamTab(v); setErr(""); setMsg(""); }}
              style={{ marginTop: 8, marginBottom: 16 }}
            >
              <Tab value="updates" label="Updates">
                <TeamUpdates team={selected} isAdmin={isAdmin} />
              </Tab>
              <Tab value="members" label="Members">
                <TeamMembers
                  team={selected}
                  members={members}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  onChangeRole={handleChangeRole}
                  onAddMember={handleAddMember}
                  onRemoveMember={handleRemoveMember}
                  onLeaveTeam={handleLeaveTeam}
                  onDeleteTeam={handleDeleteTeam}
                  showDeleteTeamControl={false}
                />
              </Tab>
              <Tab value="calendar" label="Calendar">
                <CalendarPanel team={selected} />
              </Tab>
              {isAdmin && (
                <Tab value="admin" label="Admin">
                  <div style={{ display: "grid", gap: 12 }}>
                    <h3 style={{ margin: "16px 0 6px", fontSize: 16 }}>Group administration</h3>
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", margin: "6px 0 12px" }} />
                    <div>
                      <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Group taxonomy</h4>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {TYPES.map(t => (
                          <label key={t.key} style={{ display:'inline-flex', alignItems:'center', gap:6, border:'1px solid rgba(255,255,255,0.15)', borderRadius:8, padding:'6px 10px' }}>
                            <input type="checkbox" checked={typesDraft?.includes(t.key)} onChange={()=>toggleType(t.key)} />
                            <span>{t.label}</span>
                          </label>
                        ))}
                      </div>
                      <Row style={{ marginTop: 8 }}>
                        <Button onClick={saveTypes} disabled={savingTypes}>
                          {savingTypes ? 'Saving…' : 'Save types'}
                        </Button>
                      </Row>
                    </div>
                    <div>
                      <h4 style={{ margin: '12px 0 6px', fontSize: 14 }}>Public listing</h4>
                      <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
                        <input type="checkbox" checked={!!publicDraft} onChange={(e)=> setPublicDraft(e.target.checked)} />
                        <span>List this group publicly</span>
                      </label>
                      <Row style={{ marginTop: 8 }}>
                        <Button onClick={async ()=> { setSavingPublic(true); setErr(''); setMsg(''); try { await updateGroupPublicListing(selected.id, publicDraft); setSelected(s=>({...s, public_listing: !!publicDraft})); setTeams(ts=> ts.map(t => t.id===selected.id ? { ...t, public_listing: !!publicDraft } : t)); setMsg('Public listing updated.'); } catch(e){ setErr(e.message||'Failed to update'); } finally { setSavingPublic(false); } }} disabled={savingPublic}>
                          {savingPublic ? 'Saving…' : 'Save visibility'}
                        </Button>
                      </Row>
                    </div>
                    <Row>
                      <GhostButton onClick={renameTeam}>Rename group</GhostButton>
                      <DangerButton onClick={deleteTeam}>Delete group</DangerButton>
                    </Row>
                  </div>
                </Tab>
              )}
            </Tabs>
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
