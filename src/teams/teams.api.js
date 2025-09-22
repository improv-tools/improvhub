// src/teams/teams.api.js
import { supabase } from "lib/supabaseClient";

/* ------------------------------- Teams list -------------------------------- */

export async function listMyTeams() {
  // Group-backed list (prototype)
  const { data, error } = await supabase.rpc("list_my_groups");
  if (error) throw new Error(error.message);
  return data || [];
}

/* ------------------------------ Team mgmt RPCs ----------------------------- */

export async function createTeam(name) {
  const { data, error } = await supabase.rpc("create_group", { p_name: name });
  if (error) throw new Error(error.message);
  // PostgREST can return a single row object or a one-item array depending on settings
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error("create_team returned no data");
  // Support either 'name' (legacy) or 'group_name' (prototype-safe)
  if (!('name' in row) && ('group_name' in row)) {
    row.name = row.group_name;
  }
  // Support either 'display_id' (legacy) or 'group_display_id' (prototype-safe)
  if (!('display_id' in row) && ('group_display_id' in row)) {
    row.display_id = row.group_display_id;
  }
  return row;
  throw new Error("create_team returned no data");
}

export async function listTeamMembersRPC(teamId) {
  const { data, error } = await supabase.rpc("list_group_members", { p_group_id: teamId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setMemberRoleRPC(teamId, userId, role) {
  const { error } = await supabase.rpc("set_group_member_role", { p_group_id: teamId, p_user_id: userId, p_role: role });
  if (error) throw new Error(error.message);
}

export async function addMemberByEmailRPC(teamId, email, role = "member") {
  // Send a notification-based invite; membership updates on acceptance
  const { error } = await supabase.rpc("invite_user_to_group_by_email", { p_group_id: teamId, p_email: email, p_role: role });
  if (error) throw new Error(error.message || 'Invite member failed');
}

export async function removeMemberRPC(teamId, userId) {
  const { error } = await supabase.rpc("remove_group_member", { p_group_id: teamId, p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function renameTeamRPC(teamId, name) {
  const { error } = await supabase.rpc("rename_group", { p_group_id: teamId, p_name: name });
  if (error) throw new Error(error.message);
}

export async function deleteTeamRPC(teamId) {
  const { error } = await supabase.rpc("delete_group", { p_group_id: teamId });
  if (error) throw new Error(error.message);
}

/* ------------------------------ Group taxonomy ------------------------------ */
export async function updateGroupTypes(groupId, types) {
  const payload = { types: Array.isArray(types) ? types : [] };
  const { error } = await supabase
    .from('group')
    .update(payload)
    .eq('group_id', groupId);
  if (error) throw new Error(error.message);
}

export async function updateGroupPublicListing(groupId, isPublic) {
  const { error } = await supabase
    .from('group')
    .update({ public_listing: !!isPublic })
    .eq('group_id', groupId);
  if (error) throw new Error(error.message);
}

/* ---------------------------- Owner notifications --------------------------- */
export async function listMyOwnerNotifications() {
  const { data, error } = await supabase.rpc('list_my_owner_notifications');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function listGroupOwnerNotifications(groupId) {
  const { data, error } = await supabase.rpc('list_group_notifications', { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function dismissOwnerNotification(id) {
  const { error } = await supabase.rpc('dismiss_owner_notification', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function respondOwnerNotification(id, response /* 'yes' | 'no' */) {
  const { error } = await supabase.rpc('respond_owner_notification', { p_id: id, p_response: response });
  if (error) throw new Error(error.message);
}

export async function listGroupOutgoingInvites(groupId) {
  const { data, error } = await supabase.rpc('list_group_outgoing_invites', { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function cancelGroupInvite(notificationId) {
  const { error } = await supabase.rpc('cancel_group_invite', { p_notification_id: notificationId });
  if (error) throw new Error(error.message);
}

/* --------------------------- Prototype calendar API ------------------------- */
export async function listGroupCalendars(groupId) {
  const { data, error } = await supabase.rpc('list_group_calendars', { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchGroupEvents(groupId, windowStartIso, windowEndIso, calIdsOverride) {
  const calIds = Array.isArray(calIdsOverride) ? calIdsOverride : (await listGroupCalendars(groupId)).map(c => c.id);
  if (!calIds.length) return [];
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .in('calendar_id', calIds)
    .lte('dtstart', windowEndIso)
    .order('dtstart', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function fetchGroupOverrides(groupId, windowStartIso, windowEndIso, calIdsOverride) {
  const calIds = Array.isArray(calIdsOverride) ? calIdsOverride : (await listGroupCalendars(groupId)).map(c => c.id);
  if (!calIds.length) return [];
  // Pull overrides for events on these calendars; optionally filter by recurrence window
  const { data, error } = await supabase
    .from('event_overrides')
    .select('*, events!inner(calendar_id)')
    .in('events.calendar_id', calIds)
    .gte('recurrence_id', windowStartIso)
    .lte('recurrence_id', windowEndIso);
  if (error) throw new Error(error.message);
  // Strip the joined event
  return (data || []).map(({ events, ...rest }) => rest);
}

export async function createGroupEvent(groupId, payload) {
  const { data, error } = await supabase.rpc('create_group_event', { p_group_id: groupId, p_event: payload });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function updateEvent(eventId, patch) {
  const { data, error } = await supabase.rpc('update_event', { p_event_id: eventId, p_patch: patch });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function listOrphanedEventInstances(eventId, validRids) {
  const { data, error } = await supabase.rpc('list_orphaned_event_instances', {
    p_event_id: eventId,
    p_valid_rids: Array.isArray(validRids) ? validRids : [],
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateEventAndPrune(eventId, patch, validRids) {
  const { data, error } = await supabase.rpc('update_event_and_prune', {
    p_event_id: eventId,
    p_patch: patch,
    p_valid_rids: Array.isArray(validRids) ? validRids : [],
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function deleteEvent(eventId) {
  const { error } = await supabase.rpc('delete_event', { p_event_id: eventId });
  if (error) throw new Error(error.message);
}

export async function upsertEventOverride(eventId, recurrenceIdIso, patch) {
  const { data, error } = await supabase.rpc('upsert_event_override', { p_event_id: eventId, p_recurrence_id: recurrenceIdIso, p_patch: patch });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

/* ------------------------------ Event staff API ---------------------------- */
export async function setEventStaffDefaults(eventId, staff) {
  const { error } = await supabase.rpc('set_event_staff_defaults', { p_event_id: eventId, p_staff: staff });
  if (error) throw new Error(error.message);
}

export async function setEventStaffInstance(eventId, recurrenceIdIso, staff) {
  const { error } = await supabase.rpc('set_event_staff_instance', { p_event_id: eventId, p_recurrence_id: recurrenceIdIso, p_staff: staff });
  if (error) throw new Error(error.message);
}

export async function deleteEventOverrideRPC(eventId, recurrenceIdIso) {
  const { error } = await supabase.rpc('delete_event_override', { p_event_id: eventId, p_recurrence_id: recurrenceIdIso });
  if (error) throw new Error(error.message);
}

export async function moveEventOverride(eventId, fromRidIso, toRidIso) {
  const { error } = await supabase.rpc('move_event_override', { p_event_id: eventId, p_from_rid: fromRidIso, p_to_rid: toRidIso });
  if (error) throw new Error(error.message);
}

/* ------------------------------ Staff helpers ------------------------------ */
export async function listGroupStaffCandidates(groupId) {
  const { data, error } = await supabase.rpc('list_group_staff_candidates', { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getEventStaffDefaults(eventId) {
  const { data, error } = await supabase.rpc('get_event_staff_defaults', { p_event_id: eventId });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getEventStaffInstance(eventId, recurrenceIdIso) {
  const { data, error } = await supabase.rpc('get_event_staff_instance', { p_event_id: eventId, p_recurrence_id: recurrenceIdIso });
  if (error) throw new Error(error.message);
  return data || [];
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
  try {
    const { data, error } = await supabase
      .rpc('list_team_show_invitations', { p_team_id: teamId });
    if (error) throw error;
    return data || [];
  } catch (err) {
    const msg = String(err?.message || err || '');
    // Gracefully degrade if legacy showrunner tables/views are absent
    if (/show_team_invitations|show_series|show_events|does not exist/i.test(msg)) return [];
    if (/could not find\s+the\s+function.*list_team_show_invitations|function\s+list_team_show_invitations|schema cache/i.test(msg)) return [];
    throw new Error(msg);
  }
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
  try {
    const { data, error } = await supabase
      .rpc('list_team_show_performances', { p_team_id: teamId, p_start: windowStartIso, p_end: windowEndIso });
    if (error) throw error;
    return data || [];
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (/show_team_invitations|show_series|show_events|does not exist/i.test(msg)) return [];
    if (/could not find\s+the\s+function.*list_team_show_performances|function\s+list_team_show_performances|schema cache/i.test(msg)) return [];
    throw new Error(msg);
  }
}

export async function cancelTeamShowBooking(eventId, baseStartIso) {
  const { error } = await supabase
    .rpc('cancel_team_show_booking', { p_event_id: eventId, p_occ_start: baseStartIso });
  if (error) throw new Error(error.message);
}
