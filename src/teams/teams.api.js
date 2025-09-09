// src/teams/teams.api.js
import { supabase } from "lib/supabaseClient";

/* ------------------------------- Teams list -------------------------------- */

/** RPC: returns [{ id, name, display_id, role }] for the signed-in user. */
export async function listMyTeams() {
  const { data, error } = await supabase.rpc("list_my_teams");
  if (error) throw new Error(error.message);
  return data || [];
}

/* ------------------------------ Team mgmt RPCs ----------------------------- */

export async function createTeam(name) {
  const { data, error } = await supabase.rpc("create_team", { p_name: name });
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error("create_team returned no data");
  return data[0]; // { id, name, display_id, role:'admin' }
}

export async function listTeamMembersRPC(teamId) {
  const { data, error } = await supabase.rpc("list_team_members", { p_team_id: teamId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setMemberRoleRPC(teamId, userId, role) {
  const { error } = await supabase.rpc("set_member_role", {
    p_team_id: teamId, p_user_id: userId, p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function addMemberByEmailRPC(teamId, email, role = "member") {
  const { error } = await supabase.rpc("add_member_by_email", {
    p_team_id: teamId, p_email: email, p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function removeMemberRPC(teamId, userId) {
  const { error } = await supabase.rpc("remove_member", {
    p_team_id: teamId, p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function renameTeamRPC(teamId, name) {
  const { error } = await supabase.rpc("rename_team", { p_team_id: teamId, p_name: name });
  if (error) throw new Error(error.message);
}

export async function deleteTeamRPC(teamId) {
  const { error } = await supabase.rpc("delete_team", { p_team_id: teamId });
  if (error) throw new Error(error.message);
}

/* ----------------------------- Team calendar API --------------------------- */
/** List base events for a team (UTC timestamps). */
export async function fetchTeamEvents(teamId) {
  const { data, error } = await supabase
    .from("team_events")
    .select("*")
    .eq("team_id", teamId)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Create a new base event for a team. */
export async function createTeamEvent(teamId, event) {
  const payload = { ...event, team_id: teamId };
  const { data, error } = await supabase.from("team_events").insert(payload).select("*").limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

/** Update a base event. */
export async function updateTeamEvent(eventId, patch) {
  const { data, error } = await supabase
    .from("team_events")
    .update(patch)
    .eq("id", eventId)
    .select("*")
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

/** Delete a base event. */
export async function deleteTeamEvent(eventId) {
  const { error } = await supabase.from("team_events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);
}
