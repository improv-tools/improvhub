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
  // Prefer create_team_with_admin(name), fall back to create_team(name)
  let resp = await supabase.rpc("create_team_with_admin", { p_name: name });
  if (resp.error && /does not exist/i.test(resp.error.message)) {
    resp = await supabase.rpc("create_team", { p_name: name });
  }
  if (resp.error) throw new Error(resp.error.message);
  // Expect the RPC to return { id, name, display_id }
  return resp.data;
}

/** Return full member list with display names & emails (RPC). */
export async function listTeamMembersRPC(teamId) {
  const { data, error } = await supabase.rpc("list_team_members", { p_team_id: teamId });
  if (error) throw new Error(error.message);
  return data || [];
}

/** Promote/demote a member (RPC). role: 'admin' | 'member' */
export async function setMemberRoleRPC(teamId, userId, role) {
  const { error } = await supabase.rpc("set_member_role", {
    p_team_id: teamId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

/** Add existing user by email (RPC). */
export async function addMemberByEmailRPC(teamId, email) {
  const { error } = await supabase.rpc("add_member_by_email", {
    p_team_id: teamId,
    p_email: email,
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

/** Rename team (RPC). Returns updated team. */
export async function renameTeamRPC(teamId, newName) {
  const { data, error } = await supabase.rpc("rename_team", {
    p_team_id: teamId,
    p_name: newName,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Delete team (RPC preferred; fallback to table delete if RPC absent). */
export async function deleteTeamRPC(teamId) {
  const call = await supabase.rpc("delete_team", { p_team_id: teamId });
  if (call.error) {
    if (/does not exist/i.test(call.error.message)) {
      const { error } = await supabase.from("teams").delete().eq("id", teamId);
      if (error) throw new Error(error.message);
      return;
    }
    throw new Error(call.error.message);
  }
}

/* ------------------------------- Calendar API ------------------------------ */

/** Create base event (one-off or series). */
export async function createTeamEvent(payload) {
  const { data, error } = await supabase
    .from("team_events")
    .insert([payload])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Delete whole series (or one-off) by removing base event row. */
export async function deleteTeamEvent(eventId) {
  const { error } = await supabase.from("team_events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);
}

/** Cancel ONE occurrence by base start (override upsert). */
export async function deleteEventOccurrence(eventId, baseStartIso) {
  const { error } = await supabase
    .from("team_event_overrides")
    .upsert(
      [{ event_id: eventId, occ_start: baseStartIso, canceled: true }],
      { onConflict: "event_id,occ_start" }
    );
  if (error) throw new Error(error.message);
}

/** Edit ONE occurrence (override upsert). */
export async function patchEventOccurrence(eventId, baseStartIso, patch) {
  const row = { event_id: eventId, occ_start: baseStartIso, canceled: false, ...patch };
  const { error } = await supabase
    .from("team_event_overrides")
    .upsert([row], { onConflict: "event_id,occ_start" });
  if (error) throw new Error(error.message);
}

/** Fetch base events for a team. */
export async function fetchTeamEvents(teamId) {
  const { data, error } = await supabase
    .from("team_events")
    .select("*")
    .eq("team_id", teamId);
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
