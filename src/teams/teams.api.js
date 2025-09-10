// src/teams/teams.api.js
import { supabase } from "lib/supabaseClient";

/* ------------------------------- Teams list -------------------------------- */

export async function listMyTeams() {
  const { data, error } = await supabase.rpc("list_my_teams");
  if (error) throw new Error(error.message);
  return data || [];
}

/* ------------------------------ Team mgmt RPCs ----------------------------- */

export async function createTeam(name) {
  const { data, error } = await supabase.rpc("create_team", { p_name: name });
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("create_team returned no data");
  return data[0];
}

export async function listTeamMembersRPC(teamId) {
  const { data, error } = await supabase.rpc("list_team_members", {
    p_team_id: teamId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setMemberRoleRPC(teamId, userId, role) {
  const { error } = await supabase.rpc("set_member_role", {
    p_team_id: teamId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function addMemberByEmailRPC(teamId, email, role = "member") {
  const { error } = await supabase.rpc("add_member_by_email", {
    p_team_id: teamId,
    p_email: email,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function removeMemberRPC(teamId, userId) {
  const { error } = await supabase.rpc("remove_member", {
    p_team_id: teamId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export async function renameTeamRPC(teamId, name) {
  const { error } = await supabase.rpc("rename_team", {
    p_team_id: teamId,
    p_name: name,
  });
  if (error) throw new Error(error.message);
}

export async function deleteTeamRPC(teamId) {
  const { error } = await supabase.rpc("delete_team", { p_team_id: teamId });
  if (error) throw new Error(error.message);
}

/* ----------------------------- Team calendar API --------------------------- */
/** Base events (series). */
export async function fetchTeamEvents(teamId) {
  const { data, error } = await supabase
    .from("team_events")
    .select("*")
    .eq("team_id", teamId)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createTeamEvent(teamId, event) {
  const payload = { ...event, team_id: teamId };
  const { data, error } = await supabase
    .from("team_events")
    .insert(payload)
    .select("*")
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function updateTeamEvent(eventId, patch) {
  const { data, error } = await supabase.rpc("edit_team_event", {
    p_event_id: eventId,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
  // PostgREST may return a single row or a one-item array depending on settings:
  return Array.isArray(data) ? data[0] : data;
}

export async function deleteTeamEvent(eventId) {
  const { error } = await supabase.from("team_events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);
}

/** Per-occurrence overrides (including cancellation). */
export async function fetchTeamEventOverrides(teamId) {
  const { data, error } = await supabase
    .from("team_event_overrides")
    .select("*")
    .in(
      "event_id",
      (await supabase
        .from("team_events")
        .select("id")
        .eq("team_id", teamId)
      ).data?.map((r) => r.id) || []
    );
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Cancel one occurrence by its base start. */
export async function deleteEventOccurrence(eventId, baseStartIso) {
  const { error } = await supabase
    .from("team_event_overrides")
    .upsert(
      [{ event_id: eventId, occ_start: baseStartIso, canceled: true }],
      { onConflict: "event_id,occ_start" }
    );
  if (error) throw new Error(error.message);
}

/** Edit ONE occurrence by upserting an override. */
export async function patchEventOccurrence(eventId, baseStartIso, patch) {
  const row = { event_id: eventId, occ_start: baseStartIso, ...patch, canceled: false };
  const { error } = await supabase
    .from("team_event_overrides")
    .upsert(row, { onConflict: "event_id,occ_start" });
  if (error) throw new Error(error.message);
}

/** Remove an occurrence override (revert to base). */
export async function deleteEventOverride(eventId, baseStartIso) {
  const { error } = await supabase
    .from("team_event_overrides")
    .delete()
    .eq("event_id", eventId)
    .eq("occ_start", baseStartIso); // timestamptz equality

  if (error) throw new Error(error.message);
}
/* ------------------------------- Attendance -------------------------------- */
export async function setAttendance(eventId, baseStartIso, attending) {
  const { error } = await supabase
    .from("team_event_attendance")
    .upsert(
      [{ event_id: eventId, occ_start: baseStartIso, attending }],
      { onConflict: "event_id,occ_start,user_id" }
    );
  if (error) throw new Error(error.message);
}

export async function listAttendance(teamId, windowStartIso, windowEndIso) {
  const { data, error } = await supabase
    .from("team_event_attendance_with_names")
    .select("event_id, occ_start, user_id, attending, full_name, _is_me")
    .gte("occ_start", windowStartIso)
    .lte("occ_start", windowEndIso);
  if (error) throw new Error(error.message);
  return data || [];
}
