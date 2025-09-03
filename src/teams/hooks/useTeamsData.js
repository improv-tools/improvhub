
import { useEffect, useState } from "react";
import {
  listMyTeams,
  createTeam,
  listTeamMembersRPC,
  setMemberRoleRPC,
  renameTeamRPC,
  deleteTeamRPC,
  addMemberByEmailRPC,
  removeTeamMemberRPC, // if you added this RPC earlier
} from "teams/teams.api";

export function useTeamsData(userId) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(null);
  const [members, setMembers] = useState([]);

  const refreshTeams = async () => {
    setErr("");
    try {
      const list = await listMyTeams(userId);
      setTeams(list);
      setLoading(false);
      if (selected) {
        const s = list.find((t) => t.id === selected.id);
        if (s) setSelected(s);
        else { setSelected(null); setMembers([]); }
      }
    } catch (e) {
      setErr(e.message || "Failed to load teams");
      setLoading(false);
    }
  };

  useEffect(() => { if (userId) refreshTeams(); /* eslint-disable-next-line */ }, [userId]);

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

  const backToList = () => { setSelected(null); setMembers([]); };

  const createNewTeam = async (name) => {
    const team = await createTeam(name);
    await refreshTeams();
    await openTeam({ ...team, role: "admin" });
    return team;
  };

  const changeRole = async (teamId, userId, role) => {
    await setMemberRoleRPC(teamId, userId, role);
    const mem = await listTeamMembersRPC(teamId);
    setMembers(mem);
    await refreshTeams();
  };

  const addMember = async (teamId, email, role) => {
    await addMemberByEmailRPC(teamId, email, role);
    const mem = await listTeamMembersRPC(teamId);
    setMembers(mem);
  };

  const removeMember = async (teamId, userId) => {
    await removeTeamMemberRPC(teamId, userId);
    const mem = await listTeamMembersRPC(teamId);
    setMembers(mem);
  };

  const renameTeam = async (teamId, nextName) => {
    const updated = await renameTeamRPC(teamId, nextName);
    setSelected((prev) => (prev && prev.id === updated.id ? { ...prev, name: updated.name } : prev));
    await refreshTeams();
    return updated;
  };

  const deleteTeam = async (teamId) => {
    await deleteTeamRPC(teamId);
    setSelected(null);
    setMembers([]);
    await refreshTeams();
  };

  return {
    teams, loading, err,
    selected, members,
    setErr,
    refreshTeams, openTeam, backToList,
    createNewTeam, changeRole, addMember, removeMember,
    renameTeam, deleteTeam,
  };
}
