
import { useEffect, useState } from "react";
import {
  listMyTeams,
  createTeam,
  listTeamMembersRPC,
  setMemberRoleRPC,
  renameTeamRPC,
  deleteTeamRPC,
  addMemberByEmailRPC,
  removeMemberRPC,
} from "teams/teams.api";

export function useTeamsData(userId) {
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function refreshTeams() {
    setLoading(true);
    setErr("");
    try {
      const list = await listMyTeams();
      setTeams(list);
      // keep selection in sync
      if (selected) {
        const s = list.find(t => t.id === selected.id);
        if (!s) { setSelected(null); setMembers([]); } else { setSelected(s); }
      }
    } catch (e) {
      setErr(e.message || "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshTeams(); /* eslint-disable-next-line */ }, []);

  async function create(name) {
    await createTeam(name);
    await refreshTeams();
  }

  async function openTeam(team) {
    setSelected(team);
    const mem = await listTeamMembersRPC(team.id);
    setMembers(mem);
  }

  async function changeRole(teamId, uid, role) {
    await setMemberRoleRPC(teamId, uid, role);
    const mem = await listTeamMembersRPC(teamId);
    setMembers(mem);
    await refreshTeams();
  }

  async function addMember(teamId, email, role="member") {
    await addMemberByEmailRPC(teamId, email, role);
    const mem = await listTeamMembersRPC(teamId);
    setMembers(mem);
  }

  async function removeMember(teamId, uid) {
    await removeMemberRPC(teamId, uid);
    const mem = await listTeamMembersRPC(teamId);
    setMembers(mem);
    await refreshTeams();
  }

  async function rename(teamId, name) {
    await renameTeamRPC(teamId, name);
    await refreshTeams();
  }

  async function remove(teamId) {
    await deleteTeamRPC(teamId);
    await refreshTeams();
    if (selected?.id === teamId) { setSelected(null); setMembers([]); }
  }

  return {
    teams, members, selected, loading, err,
    actions: { refreshTeams, create, openTeam, changeRole, addMember, removeMember, rename, remove },
  };
}
