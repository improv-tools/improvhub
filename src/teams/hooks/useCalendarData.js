// src/teams/hooks/useCalendarData.js
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTeamEvents,
  fetchTeamEventOverrides,
  createTeamEvent,
  updateTeamEvent,
  deleteTeamEvent,
  patchEventOccurrence,
  deleteEventOccurrence,
  deleteEventOverride,
} from "../teams.api";
import { expandOccurrences } from "../utils/expandOccurrences";

export default function useCalendarData(teamId, windowStartIso, windowEndIso) {
  const [events, setEvents] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true); setErr("");
    try {
      const [ev, ov] = await Promise.all([
        fetchTeamEvents(teamId),
        fetchTeamEventOverrides(teamId),
      ]);
      setEvents(ev); setOverrides(ov);
    } catch (e) {
      setErr(e.message || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const occurrences = useMemo(() => {
    return expandOccurrences(events, overrides, windowStartIso, windowEndIso);
  }, [events, overrides, windowStartIso, windowEndIso]);

  // Mutations
  const createBase = async (payload) => {
    const e = await createTeamEvent(teamId, payload);
    await load();
    return e;
  };
  const updateBase = async (eventId, patch) => {
    const e = await updateTeamEvent(eventId, patch);
    await load();
    return e;
  };
  const deleteBase = async (eventId) => {
    await deleteTeamEvent(eventId);
    await load();
  };

  const editOccurrence = async (eventId, baseStartIso, patch) => {
    await patchEventOccurrence(eventId, baseStartIso, patch);
    await load();
  };
  const cancelOccurrence = async (eventId, baseStartIso) => {
    await deleteEventOccurrence(eventId, baseStartIso);
    await load();
  };
  const clearOccurrenceOverride = async (eventId, baseStartIso) => {
    await deleteEventOverride(eventId, baseStartIso);
    await load();
  };

  return {
    loading, err, events, overrides, occurrences, reload: load,
    createBase, updateBase, deleteBase,
    editOccurrence, cancelOccurrence, clearOccurrenceOverride,
  };
}
