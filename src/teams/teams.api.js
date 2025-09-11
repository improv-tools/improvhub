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
  // PostgREST can return a single row object or a one-item array depending on settings
  if (Array.isArray(data)) {
    if (!data.length) throw new Error("create_team returned no data");
    return data[0];
  }
  if (data && typeof data === 'object') return data;
  throw new Error("create_team returned no data");
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
  if (error) {
    const msg = error?.message || 'Unknown error';
    throw new Error(`Invite member failed: ${msg}`);
  }
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
  const row = { event_id: eventId, occ_start: baseStartIso, attending };
  const { error } = await supabase
    .from("team_event_attendance")
    .upsert([row], { onConflict: "event_id,occ_start,user_id" });
  if (error) throw new Error(error.message);
}

export async function listAttendance(teamId, windowStartIso, windowEndIso) {
  const { data, error } = await supabase
    .from("team_event_attendance_with_names")
    .select("*")
    .eq("team_id", teamId)
    .gte("occ_start", windowStartIso)
    .lte("occ_start", windowEndIso);
  if (error) throw new Error(error.message);
  return data || [];
}

/* ------------------------------- Invitations -------------------------------- */
export async function listMyInvitations() {
  const { data, error } = await supabase.rpc("list_my_invitations");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function acceptInvitation(teamId) {
  const { error } = await supabase.rpc("accept_invitation", { p_team_id: teamId });
  if (error) throw new Error(error.message);
}

export async function declineInvitation(teamId) {
  const { error } = await supabase.rpc("decline_invitation", { p_team_id: teamId });
  if (error) throw new Error(error.message);
}

export async function listTeamInvitations(teamId) {
  const { data, error } = await supabase
    .from('team_invitations_with_names')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function cancelInvitation(teamId, userId) {
  const { error } = await supabase
    .from('team_invitations')
    .update({ status: 'canceled' })
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('status', 'invited');
  if (error) throw new Error(error.message);
}

/* ------------------------------- Notifications ------------------------------ */
export async function listMyNotifications() {
  const { data, error } = await supabase.rpc('list_my_notifications');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function markNotificationRead(id) {
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id });
  if (error) throw new Error(error.message);
}

/* ------------------------------- Updates feed ------------------------------- */
export async function listTeamUpdates(teamId) {
  const { data, error } = await supabase.rpc('list_team_updates', { p_team_id: teamId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteNotification(id) {
  const { error } = await supabase.rpc('delete_notification', { p_id: id });
  if (error) throw new Error(error.message);
}

/* -------------------------- Show lineup: team invites ------------------------- */
export async function listTeamShowInvitations(teamId) {
  const { data, error } = await supabase
    .rpc('list_team_show_invitations', { p_team_id: teamId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function acceptTeamShowInvite(eventId, baseStartIso) {
  const { error } = await supabase
    .rpc('accept_team_show_invite', { p_event_id: eventId, p_occ_start: baseStartIso });
  if (error) {
    const msg = error?.message || error?.hint || error?.details || JSON.stringify(error);
    throw new Error(`[accept_team_show_invite] event=${eventId} occ=${baseStartIso}: ${msg}`);
  }
}

export async function acceptTeamShowInviteForTeam(eventId, baseStartIso, teamId) {
  const { error } = await supabase
    .rpc('accept_team_show_invite_for_team', { p_event_id: eventId, p_occ_start: baseStartIso, p_team_id: teamId });
  if (error) {
    const msg = error?.message || error?.hint || error?.details || JSON.stringify(error);
    throw new Error(`[accept_team_show_invite_for_team] event=${eventId} occ=${baseStartIso} team=${teamId}: ${msg}`);
  }
}

export async function declineTeamShowInvite(eventId, baseStartIso) {
  const { error } = await supabase
    .rpc('decline_team_show_invite', { p_event_id: eventId, p_occ_start: baseStartIso });
  if (error) {
    const msg = error?.message || error?.hint || error?.details || JSON.stringify(error);
    throw new Error(`[decline_team_show_invite] event=${eventId} occ=${baseStartIso}: ${msg}`);
  }
}

export async function declineTeamShowInviteForTeam(eventId, baseStartIso, teamId) {
  const { error } = await supabase
    .rpc('decline_team_show_invite_for_team', { p_event_id: eventId, p_occ_start: baseStartIso, p_team_id: teamId });
  if (error) {
    const msg = error?.message || error?.hint || error?.details || JSON.stringify(error);
    throw new Error(`[decline_team_show_invite_for_team] event=${eventId} occ=${baseStartIso} team=${teamId}: ${msg}`);
  }
}

/* -------------------------- Show lineup: performances in calendar ------------- */
export async function listTeamShowPerformances(teamId, windowStartIso, windowEndIso) {
  const { data, error } = await supabase
    .rpc('list_team_show_performances', { p_team_id: teamId, p_start: windowStartIso, p_end: windowEndIso });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function cancelTeamShowBooking(eventId, baseStartIso) {
  const { error } = await supabase
    .rpc('cancel_team_show_booking', { p_event_id: eventId, p_occ_start: baseStartIso });
  if (error) throw new Error(error.message);
}
