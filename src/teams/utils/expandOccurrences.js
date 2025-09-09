
import { DOW, nthWeekdayOfMonth } from "./datetime";

/**
 * Expand recurring events between [fromIso, toIso] inclusive.
 * Supports:
 *  - recur_freq: "none" | "daily" | "weekly" | "monthly"
 *  - recur_interval: number (>=1)
 *  - recur_byday: text[] like ["MO","WE"] for weekly
 *  - recur_bymonthday: int[] (1..31) for monthly
 *  - recur_week_of_month: int | -1 (1..5 or -1 for last) used with recur_byday for monthly patterns like "3rd Tuesday"
 *  - recur_until: timestamptz (optional)
 *  - recur_count: int (optional)
 */
export function expandOccurrences(events, fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const out = [];

  for (const e of events) {
    const start = new Date(e.starts_at);
    const end = new Date(e.ends_at);
    const durMs = end - start;

    const freq = e.recur_freq || "none";
    const interval = Math.max(1, e.recur_interval || 1);
    const until = e.recur_until ? new Date(e.recur_until) : null;
    const countLimit = e.recur_count || Infinity;

    let emitted = 0;

    function pushOcc(dt) {
      const occStart = dt;
      const occEnd = new Date(occStart.getTime() + durMs);
      if (occStart > to) return false;
      if (occStart >= from) {
        out.push({ ...e, occ_start: occStart, occ_end: occEnd });
        emitted += 1;
      }
      return emitted < countLimit && (!until || occStart <= until);
    }

    if (freq === "none") {
      if (pushOcc(start) === false) {/* no-op */}
      continue;
    }

    if (freq === "daily") {
      // step by N days
      let k = 0;
      while (true) {
        const dt = new Date(start.getTime() + k * interval * 24 * 3600 * 1000);
        if (!pushOcc(dt)) break;
        k += 1;
        if (dt > to) break;
      }
      continue;
    }

    if (freq === "weekly") {
      const by = Array.isArray(e.recur_byday) ? e.recur_byday : [DOW[start.getUTCDay()]];
      const weekMs = 7 * 24 * 3600 * 1000;

      // anchor week: monday of the week of the original start (UTC)
      const anchorMonday = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate() - ((start.getUTCDay() + 6) % 7),
        0,0,0,0
      ));

      let w = 0;
      while (true) {
        const thisWeek = new Date(anchorMonday.getTime() + w * interval * weekMs);
        for (const code of by) {
          const wday = DOW.indexOf(code);
          if (wday < 0) continue;
          const day = new Date(thisWeek.getTime() + ((wday + 7) % 7) * 24 * 3600 * 1000);
          const occStart = new Date(Date.UTC(
            day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
            start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()
          ));
          if (!pushOcc(occStart)) { w = Infinity; break; }
        }
        if (w === Infinity) break;
        if (thisWeek > to) break;
        w += 1;
      }
      continue;
    }

    if (freq === "monthly") {
      const byMonthDay = Array.isArray(e.recur_bymonthday) ? e.recur_bymonthday : null;
      const byDay = Array.isArray(e.recur_byday) ? e.recur_byday : null;
      const wom = e.recur_week_of_month ?? null; // 1..5 or -1

      let m = 0;
      while (true) {
        const anchor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m*interval, 1));
        if (byMonthDay && byMonthDay.length) {
          for (const d of byMonthDay) {
            const dt = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), d, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
            if (dt.getUTCMonth() !== anchor.getUTCMonth()) continue; // skip overflow
            if (!pushOcc(dt)) { m = Infinity; break; }
          }
        } else if (byDay && wom) {
          for (const code of byDay) {
            const wday = DOW.indexOf(code);
            if (wday < 0) continue;
            const nth = nthWeekdayOfMonth(anchor.getUTCFullYear(), anchor.getUTCMonth(), wday, wom);
            if (!nth) continue;
            const dt = new Date(Date.UTC(nth.getUTCFullYear(), nth.getUTCMonth(), nth.getUTCDate(), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
            if (!pushOcc(dt)) { m = Infinity; break; }
          }
        } else {
          // default: same day-of-month as start
          const dt = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
          if (!pushOcc(dt)) { m = Infinity; break; }
        }
        if (m === Infinity) break;
        if (anchor > to) break;
        m += 1;
      }
      continue;
    }
  }

  // sort by occurrence start
  out.sort((a,b) => a.occ_start - b.occ_start);
  return out;
}
