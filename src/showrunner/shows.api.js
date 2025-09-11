// src/showrunner/shows.api.js
import { supabase } from "lib/supabaseClient";

/* ----------------------------- Series management ---------------------------- */
export async function listMySeries() {
  const { data, error } = await supabase.rpc("list_my_show_series");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createSeries(name) {
  const { data, error } = await supabase.rpc("create_show_series", { p_name: name });
  if (error) throw new Error(error.message);
  if (Array.isArray(data)) {
    if (!data.length) throw new Error("create_show_series returned no data");
    return data[0];
  }
  if (data && typeof data === 'object') return data;
  throw new Error("create_show_series returned no data");
}

export async function renameSeriesRPC(seriesId, name) {
  const { error } = await supabase.rpc("rename_show_series", { p_series_id: seriesId, p_name: name });
  if (error) throw new Error(error.message);
}

export async function deleteSeriesRPC(seriesId) {
  const { error } = await supabase.rpc("delete_show_series", { p_series_id: seriesId });
  if (error) throw new Error(error.message);
}

/* ---------------------------------- Events ---------------------------------- */
export async function fetchShowEvents(seriesId) {
  const { data, error } = await supabase
    .from("show_events")
    .select("*")
    .eq("series_id", seriesId)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createShowEvent(seriesId, event) {
  const payload = { ...event, series_id: seriesId };
  const { data, error } = await supabase
    .from("show_events")
    .insert(payload)
    .select("*")
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function updateShowEvent(eventId, patch) {
  const { data, error } = await supabase.rpc("edit_show_event", { p_event_id: eventId, p_patch: patch });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function deleteShowEvent(eventId) {
  const { error } = await supabase.from("show_events").delete().eq("id", eventId);
  if (error) throw new Error(error.message);
}

/* ------------------------------- Occurrence edit ---------------------------- */
export async function fetchShowEventOverrides(seriesId) {
  const { data, error } = await supabase
    .from("show_event_overrides")
    .select("*")
    .in(
      "event_id",
      (await supabase.from("show_events").select("id").eq("series_id", seriesId)).data?.map(r => r.id) || []
    );
  if (error) throw new Error(error.message);
  return data || [];
}

export async function patchShowOccurrence(eventId, baseStartIso, patch) {
  const row = { event_id: eventId, occ_start: baseStartIso, ...patch, canceled: false };
  const { error } = await supabase
    .from("show_event_overrides")
    .upsert(row, { onConflict: "event_id,occ_start" });
  if (error) throw new Error(error.message);
}

export async function deleteShowOccurrence(eventId, baseStartIso) {
  const { error } = await supabase
    .from("show_event_overrides")
    .upsert([{ event_id: eventId, occ_start: baseStartIso, canceled: true }], { onConflict: "event_id,occ_start" });
  if (error) throw new Error(error.message);
}

export async function deleteShowOverride(eventId, baseStartIso) {
  const { error } = await supabase
    .from("show_event_overrides")
    .delete()
    .eq("event_id", eventId)
    .eq("occ_start", baseStartIso);
  if (error) throw new Error(error.message);
}

/* ----------------------------------- Lineup ---------------------------------- */
export async function listShowLineup(eventId, baseStartIso) {
  const { data, error } = await supabase
    .rpc("list_show_lineup", { p_event_id: eventId, p_occ_start: baseStartIso });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function inviteTeamToShow(eventId, baseStartIso, teamId) {
  const { error } = await supabase
    .rpc("invite_team_to_show", { p_event_id: eventId, p_occ_start: baseStartIso, p_team_id: teamId });
  if (error) throw new Error(error.message);
}

export async function cancelTeamShowInvite(eventId, baseStartIso, teamId) {
  const { error } = await supabase
    .rpc("cancel_team_show_invite", { p_event_id: eventId, p_occ_start: baseStartIso, p_team_id: teamId });
  if (error) throw new Error(error.message);
}

export async function resolveTeamIdByDisplayId(displayId) {
  const { data, error } = await supabase.rpc("team_id_by_display_id", { p_display_id: displayId });
  if (error) throw new Error(error.message);
  return data || null; // may be null/undefined if not found
}

export async function removeTeamFromShow(eventId, baseStartIso, teamId) {
  const { error } = await supabase
    .rpc('remove_team_from_show', { p_event_id: eventId, p_occ_start: baseStartIso, p_team_id: teamId });
  if (error) throw new Error(error.message);
}

export async function resolveTeamBriefByDisplayId(displayId) {
  const { data, error } = await supabase.rpc('team_brief_by_display_id', { p_display_id: displayId });
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (Array.isArray(data)) return data[0] || null;
  return data;
}

// Series-level lineup
export async function listSeriesLineup(eventId) {
  const { data, error } = await supabase.rpc('list_series_lineup', { p_event_id: eventId });
  if (error) throw new Error(error.message);
  return data || [];
}
export async function inviteTeamToSeries(eventId, teamId) {
  const { error } = await supabase.rpc('invite_team_to_series', { p_event_id: eventId, p_team_id: teamId });
  if (error) throw new Error(error.message);
}
export async function cancelTeamSeriesInvite(eventId, teamId) {
  const { error } = await supabase.rpc('cancel_team_series_invite', { p_event_id: eventId, p_team_id: teamId });
  if (error) throw new Error(error.message);
}
export async function removeTeamFromSeries(eventId, teamId) {
  const { error } = await supabase.rpc('remove_team_from_series', { p_event_id: eventId, p_team_id: teamId });
  if (error) throw new Error(error.message);
}

// Occurrence override upsert
export async function upsertOccLineupStatus(eventId, baseStartIso, teamId, status) {
  const { error } = await supabase.rpc('upsert_occ_lineup_status', { p_event_id: eventId, p_occ_start: baseStartIso, p_team_id: teamId, p_status: status });
  if (error) throw new Error(error.message);
}

export async function clearOccLineupOverride(eventId, baseStartIso, teamId) {
  const { error } = await supabase.rpc('clear_occ_lineup_override', { p_event_id: eventId, p_occ_start: baseStartIso, p_team_id: teamId });
  if (error) throw new Error(error.message);
}
