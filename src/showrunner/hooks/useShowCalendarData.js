// src/showrunner/hooks/useShowCalendarData.js
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchShowEvents,
  fetchShowEventOverrides,
  createShowEvent,
  updateShowEvent,
  deleteShowEvent,
  patchShowOccurrence,
  deleteShowOccurrence,
  deleteShowOverride,
} from "../shows.api";
import { expandOccurrences } from "../../teams/utils/expandOccurrences";

export default function useShowCalendarData(seriesId, windowStartIso, windowEndIso) {
  const [events, setEvents] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!seriesId) return;
    setLoading(true); setErr("");
    try {
      const [ev, ov] = await Promise.all([
        fetchShowEvents(seriesId),
        fetchShowEventOverrides(seriesId),
      ]);
      setEvents(ev); setOverrides(ov);
    } catch (e) {
      setErr(e.message || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [seriesId]);

  useEffect(() => { load(); }, [load]);

  const occurrences = useMemo(() => expandOccurrences(events, overrides, windowStartIso, windowEndIso), [events, overrides, windowStartIso, windowEndIso]);

  // Mutations
  const createBase = async (payload) => { const e = await createShowEvent(seriesId, payload); await load(); return e; };
  const updateBase = async (eventId, patch) => { const e = await updateShowEvent(eventId, patch); await load(); return e; };
  const deleteBase = async (eventId) => { await deleteShowEvent(eventId); await load(); };

  const editOccurrence = async (eventId, baseStartIso, patch) => { await patchShowOccurrence(eventId, baseStartIso, patch); await load(); };
  const cancelOccurrence = async (eventId, baseStartIso) => { await deleteShowOccurrence(eventId, baseStartIso); await load(); };
  const clearOccurrenceOverride = async (eventId, baseStartIso) => { await deleteShowOverride(eventId, baseStartIso); await load(); };

  return { loading, err, events, overrides, occurrences, reload: load, createBase, updateBase, deleteBase, editOccurrence, cancelOccurrence, clearOccurrenceOverride };
}

