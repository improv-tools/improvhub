// src/teams/utils/expandOccurrences.js

const DOW = ["SU","MO","TU","WE","TH","FR","SA"];

function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function addMonths(d, n) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth()+n); return x; }

function isoUTC(d) { return new Date(d).toISOString(); }
function startOfDayUTC(d) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function endOfDayUTC(d) { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; }

function nthWeekdayOfMonthUTC(year, month /*0-11*/, weekday /*0-6, 0=Sun*/, nth /*1..4 or -1 for last*/) {
  if (nth > 0) {
    // find first `weekday`, then add (nth-1)*7
    const first = new Date(Date.UTC(year, month, 1));
    const delta = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + delta + (nth - 1) * 7;
    return new Date(Date.UTC(year, month, day));
  } else {
    // last weekday
    const last = new Date(Date.UTC(year, month + 1, 0)); // last day of month
    const delta = (last.getUTCDay() - weekday + 7) % 7;
    const day = last.getUTCDate() - delta;
    return new Date(Date.UTC(year, month, day));
  }
}

/**
 * Expand base events to concrete occurrences between [windowStart, windowEnd] (ISO strings).
 * Overrides: array of rows { event_id, occ_start, ... , canceled, starts_at?, ends_at?, title? ... }
 */
export function expandOccurrences(baseEvents, overrides, windowStartIso, windowEndIso) {
  const winStart = startOfDayUTC(windowStartIso);
  const winEnd = endOfDayUTC(windowEndIso);
  const overrideMap = new Map(); // key: `${event_id}|${occ_startIso}`

  (overrides || []).forEach((o) => {
    overrideMap.set(`${o.event_id}|${new Date(o.occ_start).toISOString()}`, o);
  });

  const out = [];

  for (const ev of baseEvents) {
    const {
      id, title, description, location, category, tz,
      starts_at, ends_at,
      recur_freq = "none",
      recur_interval = 1,
      recur_byday = null,          // array of "MO"... strings, or null
      recur_bymonthday = null,     // integer 1..31 or null
      recur_week_of_month = null,  // 1..4 or -1 (last) or null
      recur_until = null,          // ISO or null
      recur_count = null           // int or null
    } = ev;

    const baseStart = new Date(starts_at);
    const baseEnd = new Date(ends_at);
    const durMs = baseEnd - baseStart;

    const until = recur_until ? new Date(recur_until) : null;

    let occurrences = 0;

    const pushOcc = (occStart) => {
      const occStartIso = isoUTC(occStart);
      const occEndIso = isoUTC(new Date(occStart.getTime() + durMs));
      if (occStart < winStart || occStart > winEnd) return;

      const key = `${id}|${occStartIso}`;
      const ov = overrideMap.get(key);
      if (ov?.canceled) return;

      out.push({
        event_id: id,
        base_start: occStartIso,
        starts_at: ov?.starts_at || occStartIso,
        ends_at: ov?.ends_at || occEndIso,
        title: ov?.title ?? title,
        description: ov?.description ?? description,
        location: ov?.location ?? location,
        category: ov?.category ?? category,
        tz: ov?.tz ?? tz,
        overridden: !!ov && !ov.canceled,
      });
    };

    const bounded = (d) => {
      if (until && d > until) return false;
      if (recur_count && occurrences >= recur_count) return false;
      return true;
    };

    if (recur_freq === "none") {
      pushOcc(baseStart);
      continue;
    }

    if (recur_freq === "daily") {
      let t = new Date(baseStart);
      while (t <= winEnd && bounded(t)) {
        if (t >= winStart) pushOcc(t);
        occurrences++;
        t = addDays(t, Math.max(1, recur_interval));
      }
      continue;
    }

    if (recur_freq === "weekly") {
      const days = Array.isArray(recur_byday) && recur_byday.length
        ? recur_byday
        : [DOW[baseStart.getUTCDay()]];
      // normalize to ints 0..6
      const weekdays = days.map((d) => DOW.indexOf(d)).filter((x) => x >= 0).sort((a,b)=>a-b);

      // advance by week interval
      let anchor = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate()));
      while (anchor <= winEnd && bounded(anchor)) {
        for (const wd of weekdays) {
          const day = addDays(anchor, (wd - anchor.getUTCDay() + 7) % 7);
          if (!bounded(day)) break;
          // keep time-of-day
          const occ = new Date(day);
          occ.setUTCHours(baseStart.getUTCHours(), baseStart.getUTCMinutes(), baseStart.getUTCSeconds(), baseStart.getUTCMilliseconds());
          if (occ >= winStart && occ <= winEnd) pushOcc(occ);
          occurrences++;
          if (recur_count && occurrences >= recur_count) break;
        }
        anchor = addDays(anchor, 7 * Math.max(1, recur_interval));
      }
      continue;
    }

    if (recur_freq === "monthly") {
      let t = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), 1));
      // find the first month >= base month within window
      while (t < winStart) t = addMonths(t, Math.max(1, recur_interval));
      // iterate months
      while (t <= winEnd && bounded(t)) {
        const y = t.getUTCFullYear();
        const m = t.getUTCMonth();

        let dayDate = null;

        if (recur_bymonthday) {
          dayDate = new Date(Date.UTC(y, m, Math.min(recur_bymonthday, new Date(Date.UTC(y, m + 1, 0)).getUTCDate())));
        } else if (recur_week_of_month && Array.isArray(recur_byday) && recur_byday.length === 1) {
          const wd = DOW.indexOf(recur_byday[0]);
          if (wd >= 0) dayDate = nthWeekdayOfMonthUTC(y, m, wd, recur_week_of_month);
        } else {
          // default to same day-of-month as base
          dayDate = new Date(Date.UTC(y, m, baseStart.getUTCDate()));
        }

        if (dayDate) {
          const occ = new Date(dayDate);
          occ.setUTCHours(baseStart.getUTCHours(), baseStart.getUTCMinutes(), baseStart.getUTCSeconds(), baseStart.getUTCMilliseconds());
          if (occ >= winStart && occ <= winEnd && bounded(occ)) {
            pushOcc(occ);
            occurrences++;
          }
        }
        t = addMonths(t, Math.max(1, recur_interval));
      }
      continue;
    }
  }

  // Sort by actual shown start
  out.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return out;
}
