import { supabase } from "lib/supabaseClient";

// List teams for current user from their membership rows (safe with RLS)
export async function listMyTeams(userId) {
  const { data, error } = await supabase
    .from("team_members")
    .select("role, teams:team_id ( id, name, display_id )")
    .eq("user_id", userId);
  if (error) throw error;
  return (data || [])
    .map(r => ({ id: r.teams?.id, name: r.teams?.name, display_id: r.teams?.display_id, role: r.role }))
    .filter(Boolean);
}

export async function createTeam(name) {
  const { data, error } = await supabase.rpc("create_team", { p_name: name });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

// === RPCs ===
export async function listTeamMembersRPC(teamId) {
  const { data, error } = await supabase.rpc("get_team_members", { p_team_id: teamId });
  if (error) throw error;
  return data || [];
}

export async function setMemberRoleRPC(teamId, userId, role) {
  const { error } = await supabase.rpc("admin_set_member_role", {
    p_team_id: teamId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw error;
}

export async function renameTeamRPC(teamId, newName) {
  const { data, error } = await supabase.rpc("admin_rename_team", {
    p_team_id: teamId,
    p_name: newName,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data; // { id, name, display_id }
}

export async function deleteTeamRPC(teamId) {
  const { error } = await supabase.rpc("admin_delete_team", { p_team_id: teamId });
  if (error) throw error;
}

export async function addMemberByEmailRPC(teamId, email, role = "member") {
  const { data, error } = await supabase.rpc("admin_add_member_by_email", {
    p_team_id: teamId,
    p_email: email,
    p_role: role,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data; // { user_id, role, email, full_name }
}

