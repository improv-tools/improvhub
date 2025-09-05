// src/teams/teams.api.js
import { supabase } from "lib/supabaseClient";

/**
 * Create a base team event (one-off or series).
 * payload must include: team_id, title, tz, starts_at, ends_at
 * and optional recurrence fields (recur_*).
 */
export async function createTeamEvent(payload) {
  const { data, error } = await supabase
    .from("team_events")
    .insert([payload])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Cancel ONE occurrence by base start.
 * Writes/updates an override row with canceled = true keyed by (event_id, occ_start).
 */
export async function deleteEventOccurrence(eventId, baseStartIso) {
  const { error } = await supabase
    .from("team_event_overrides")
    .upsert(
      [{ event_id: eventId, occ_start: baseStartIso, canceled: true }],
      { onConflict: "event_id,occ_start" }
    );
  if (error) throw new Error(error.message);
}

/** Delete whole series (or one-off) by removing the base event. */
export async function deleteTeamEvent(eventId) {
  const { error } = await supabase
    .from("team_events")
    .delete()
    .eq("id", eventId);
  if (error) throw new Error(error.message);
}

/**
 * Edit ONE occurrence (creates/updates override for that base start).
 * `patch` can include: title, description, location, tz, category, starts_at, ends_at
 */
export async function patchEventOccurrence(eventId, baseStartIso, patch) {
  const row = { event_id: eventId, occ_start: baseStartIso, canceled: false, ...patch };
  const { error } = await supabase
    .from("team_event_overrides")
    .upsert([row], { onConflict: "event_id,occ_start" });
  if (error) throw new Error(error.message);
}

/* ---------------------------- Calendar data fetch --------------------------- */

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
