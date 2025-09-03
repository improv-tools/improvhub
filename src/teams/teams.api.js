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
  const { error } = await supabase.rpc("admin_add_member_by_email", {
    p_team_id: teamId,
    p_email: email,
    p_role: role,
  });
  if (error) throw error;
  // no return data
}

// --- EVENTS API ---
// list events that may occur within [from, to] (server returns base events, client expands)
export async function listTeamEvents(teamId, fromIso, toIso) {
  const { data, error } = await supabase.rpc("list_team_events", {
    p_team_id: teamId,
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  return data || [];
}

// create event (with recurrence fields)
export async function createTeamEvent(payload) {
  const { data, error } = await supabase.rpc("create_team_event", {
    p_team_id: payload.team_id,
    p_title: payload.title,
    p_description: payload.description || null,
    p_location: payload.location || null,
    p_category: payload.category,           // 'rehearsal' | 'social' | 'performance'
    p_tz: payload.tz,                       // IANA TZ string
    p_starts_at: payload.starts_at,         // ISO
    p_ends_at: payload.ends_at,             // ISO
    p_recur_freq: payload.recur_freq || 'none',          // 'none'|'weekly'|'monthly'
    p_recur_interval: payload.recur_interval || 1,       // 1,2,3...
    p_recur_byday: payload.recur_byday || null,          // ['MO','WE']
    p_recur_bymonthday: payload.recur_bymonthday || null,// [15]
    p_recur_week_of_month: payload.recur_week_of_month || null, // 1..5 or -1
    p_recur_day_of_week: payload.recur_day_of_week || null,     // 'MO'
    p_recur_count: payload.recur_count || null,
    p_recur_until: payload.recur_until || null,          // '2025-12-31'
  });
  if (error) throw error;
  return data;
}

export async function deleteTeamEvent(eventId) {
  const { error } = await supabase.rpc("delete_team_event", { p_event_id: eventId });
  if (error) throw error;
}

// --- Overrides/series helpers ---
export async function listTeamEventOverrides(teamId, fromIso, toIso) {
  const { data, error } = await supabase.rpc("list_team_event_overrides", {
    p_team_id: teamId, p_from: fromIso, p_to: toIso,
  });
  if (error) throw error;
  return data || [];
}

export async function deleteEventOccurrence(eventId, occStartIso) {
  const { error } = await supabase.rpc("delete_event_occurrence", {
    p_event_id: eventId, p_occ_start: occStartIso,
  });
  if (error) throw error;
}

export async function upsertOccurrenceOverride(eventId, occStartIso, patch) {
  const { error } = await supabase.rpc("upsert_event_occurrence_override", {
    p_event_id: eventId,
    p_occ_start: occStartIso,
    p_title: patch.title ?? null,
    p_description: patch.description ?? null,
    p_location: patch.location ?? null,
    p_tz: patch.tz ?? null,
    p_starts_at: patch.starts_at ?? null,
    p_ends_at: patch.ends_at ?? null,
    p_category: patch.category ?? null,
  });
  if (error) throw error;
}

export async function splitEventSeries(event, fromOccStartIso, patch) {
  const { data, error } = await supabase.rpc("split_event_series", {
    p_event_id: event.id,
    p_from_occ_start: fromOccStartIso,
    p_title: patch.title ?? event.title,
    p_description: patch.description ?? event.description,
    p_location: patch.location ?? event.location,
    p_category: patch.category ?? event.category,
    p_tz: patch.tz ?? event.tz,
    p_starts_at: patch.starts_at ?? event.starts_at,
    p_ends_at: patch.ends_at ?? event.ends_at,
    p_recur_freq: event.recur_freq,
    p_recur_interval: event.recur_interval,
    p_recur_byday: event.recur_byday,
    p_recur_bymonthday: event.recur_bymonthday,
    p_recur_week_of_month: event.recur_week_of_month,
    p_recur_day_of_week: event.recur_day_of_week,
    p_recur_count: event.recur_count,
    p_recur_until: event.recur_until,
  });
  if (error) throw error;
  return data;
}

export async function removeTeamMemberRPC(teamId, userId) {
  const { error } = await supabase.rpc("remove_team_member", {
    p_team_id: teamId,
    p_user_id: userId,
  });
  if (error) throw error;
}
