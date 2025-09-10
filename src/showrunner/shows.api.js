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
  if (!data?.length) throw new Error("create_show_series returned no data");
  return data[0];
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

