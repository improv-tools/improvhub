
import { useEffect, useMemo, useState } from "react";
import {
  fetchTeamEvents,
  fetchTeamEventOverrides,
} from "teams/teams.api";
import { expandOccurrences } from "teams/utils/expandOccurrences";

export function useCalendarData(teamId, range) {
  const [events, setEvents] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function refresh() {
    if (!teamId) return;
    setLoading(true);
    setErr("");
    try {
      const base = await fetchTeamEvents(teamId);
      setEvents(base);
      const ids = base.map(e => e.id);
      const ov = await fetchTeamEventOverrides(ids);
      setOverrides(ov);
    } catch (e) {
      setErr(e.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{ refresh(); /* eslint-disable-next-line */ }, [teamId]);

  const occurrences = useMemo(() => {
    if (!range) return [];
    const { start, end } = range;
    return expandOccurrences(events, start, end);
  }, [events, range]);

  return { events, overrides, occurrences, loading, err, refresh };
}
