// src/teams/teams.api.js
import { supabase } from "lib/supabaseClient";

/* ------------------------------- Teams list -------------------------------- */

/** RPC-based: returns [{ id, name, display_id, role }] for the signed-in user. */
export async function listMyTeams() {
  const { data, error } = await supabase.rpc("list_my_teams");
  if (error) throw new Error(error.message);
  return data || [];
}

/* ------------------------------ Team mgmt RPCs ----------------------------- */

/** Create a team and add caller as admin (expects RPC). */
export async function createTeam(name) {
  // Prefer RPC for permission checks; fallback to direct insert if RPC missing.
  const { data, error } = await supabase.rpc("create_team", { p_name: name });
  if (!error) return data;
  // Fallback: direct insert + membership for current user
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) throw new Error("Not signed in");
  const ins = await supabase.from("teams").insert({ name, display_id: name }).select("*").single();
  if (ins.error) throw new Error(ins.error.message);
  const mem = await supabase.from("team_members").insert({ team_id: ins.data.id, user_id: user.user.id, role: "admin" });
  if (mem.error) throw new Error(mem.error.message);
  return ins.data;
}

export async function listTeamMembersRPC(teamId) {
  const { data, error } = await supabase.rpc("list_team_members", { p_team_id: teamId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function setMemberRoleRPC(teamId, userId, role) {
  const { error } = await supabase.rpc("set_member_role", {
    p_team_id: teamId, p_user_id: userId, p_role: role,
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

/** Add existing user by email (RPC). */
export async function addMemberByEmailRPC(teamId, email, role = "member") {
  const { error } = await supabase.rpc("add_member_by_email", {
    p_team_id: teamId,
    p_email: email,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

/** Remove a member (or leave team if userId = caller) (RPC). */
export async function removeMemberRPC(teamId, userId) {
  const { error } = await supabase.rpc("remove_member", {
    p_team_id: teamId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------ Calendar / Events -------------------------- */

export async function fetchTeamEvents(teamId) {
  const { data, error } = await supabase
    .from("team_events")
    .select("*")
    .eq("team_id", teamId)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Fetch overrides for a set of event ids. */
export async function fetchTeamEventOverrides(eventIds) {
  if (!eventIds || eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("team_event_overrides")
    .select("*")
    .in("event_id", eventIds);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createTeamEvent(event) {
  const { data, error } = await supabase.from("team_events").insert(event).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateTeamEvent(id, patch) {
  const { data, error } = await supabase.from("team_events").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTeamEvent(id) {
  const { error } = await supabase.from("team_events").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Overrides allow exceptions or cancellations for a specific occurrence */
export async function createEventOverride(override) {
  const { data, error } = await supabase.from("team_event_overrides").insert(override).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteEventOverride(id) {
  const { error } = await supabase.from("team_event_overrides").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
