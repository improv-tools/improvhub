// src/teams/utils/expandOccurrences.js

const DOW = ["SU","MO","TU","WE","TH","FR","SA"];
const addDays = (d,n)=>{ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; };
const addMonths = (d,n)=>{ const x=new Date(d); x.setUTCMonth(x.getUTCMonth()+n); return x; };
const startOfDayUTC = (d)=>{ const x=new Date(d); x.setUTCHours(0,0,0,0); return x; };
const endOfDayUTC = (d)=>{ const x=new Date(d); x.setUTCHours(23,59,59,999); return x; };
const iso = (d)=> new Date(d).toISOString();

function nthWeekdayOfMonthUTC(year, month/*0-11*/, weekday/*0-6*/, nth/*1..4 or -1*/){
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month, 1));
    const delta = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + delta + (nth - 1)*7;
    return new Date(Date.UTC(year, month, day));
  }
  const last = new Date(Date.UTC(year, month + 1, 0));
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  const day = last.getUTCDate() - delta;
  return new Date(Date.UTC(year, month, day));
}

/**
 * Robust expander:
 * - Accepts scalar or array shapes for recur_* inputs
 * - Accepts recur_day_of_week (single) or recur_byday (array)
 * - Treats interval as 1
 * - Applies a 12-occurrence cap when count/until is present (matching UI)
 */
export function expandOccurrences(baseEvents, overrides, windowStartIso, windowEndIso) {
  const winStart = startOfDayUTC(windowStartIso);
  const winEnd = endOfDayUTC(windowEndIso);

  const overrideMap = new Map();
  (overrides || []).forEach(o => {
    overrideMap.set(`${o.event_id}|${iso(o.occ_start)}`, o);
  });

  const out = [];

  for (const ev of baseEvents) {
    const {
      id, title, description, location, category, tz,
      starts_at, ends_at,

      // DB/UI variants
      recur_freq = "none",
      recur_byday = null,           // text[] or null
      recur_day_of_week = null,     // text or null (single)
      recur_bymonthday = null,      // int or int[] or null
      recur_week_of_month = null,   // int or null

      recur_until = null,
      recur_count = null,
    } = ev;

    // ---------- Normalize inputs ----------
    // Normalized by-day array (weekly & monthly "week" mode)
    const normByDay = (() => {
      if (Array.isArray(recur_byday) && recur_byday.length) return recur_byday;
      if (recur_day_of_week) return [recur_day_of_week];
      return [];
    })();

    // Normalized month-day number
    const normByMonthday = (() => {
      if (Array.isArray(recur_bymonthday)) return recur_bymonthday[0] ?? null;
      return recur_bymonthday ?? null;
    })();

    // Normalized week-of-month number
    const normWeekOfMonth = (recur_week_of_month != null)
      ? Number(recur_week_of_month)
      : null;

    // Guard bad enum slips (if DB doesn’t have 'daily', treat as none here to avoid crash)
    const freq = (typeof recur_freq === "string") ? recur_freq : "none";

    const baseStart = new Date(starts_at);
    const baseEnd = new Date(ends_at);
    const durMs = baseEnd - baseStart;

    // Cap at 12 when either count or until is present (matches UI behaviour)
    const hasEnd = recur_count != null || recur_until != null;
    const maxOcc = recur_count != null ? Math.min(Number(recur_count) || 0, 12)
                                       : (hasEnd ? 12 : Number.POSITIVE_INFINITY);

    let occurrences = 0;

    const bounded = (d) => {
      if (occurrences >= maxOcc) return false;
      if (recur_until && d > new Date(recur_until)) return false;
      return true;
    };

    const pushOcc = (occStart) => {
      if (occurrences >= maxOcc) return;
      const occStartIso = iso(occStart);
      const occEndIso = iso(new Date(occStart.getTime() + durMs));
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
      occurrences++;
    };

    // ---------- Expand ----------
    if (freq === "none") {
      pushOcc(baseStart);
      continue;
    }

    if (freq === "daily") {
      let t = new Date(baseStart);
      while (t <= winEnd && bounded(t)) {
        if (t >= winStart) pushOcc(t);
        t = addDays(t, 1);
      }
      continue;
    }

    if (freq === "weekly") {
      // Use normalized by-day list; default to baseStart weekday if empty
      const days = (normByDay.length ? normByDay : [DOW[baseStart.getUTCDay()]]);
      const weekdays = days.map((d)=>DOW.indexOf(d)).filter((x)=>x>=0).sort((a,b)=>a-b);

      let anchor = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), baseStart.getUTCDate()));
      while (anchor <= winEnd && bounded(anchor)) {
        for (const wd of weekdays) {
          const day = addDays(anchor, (wd - anchor.getUTCDay() + 7) % 7);
          if (!bounded(day)) break;
          const occ = new Date(day);
          occ.setUTCHours(baseStart.getUTCHours(), baseStart.getUTCMinutes(), baseStart.getUTCSeconds(), baseStart.getUTCMilliseconds());
          if (occ >= winStart && occ <= winEnd) pushOcc(occ);
          if (occurrences >= maxOcc) break;
        }
        anchor = addDays(anchor, 7);
      }
      continue;
    }

    if (freq === "monthly") {
      let t = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), 1));
      while (t <= winEnd && bounded(t)) {
        const y = t.getUTCFullYear();
        const m = t.getUTCMonth();
        let dayDate = null;

        if (normByMonthday) {
          const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          const md = Math.min(Number(normByMonthday), last);
          dayDate = new Date(Date.UTC(y, m, md));
        } else if (normWeekOfMonth && Array.isArray(normByDay) && normByDay.length === 1) {
          const wd = DOW.indexOf(normByDay[0]);
          if (wd >= 0) dayDate = nthWeekdayOfMonthUTC(y, m, wd, Number(normWeekOfMonth));
        } else {
          // default same day-of-month as baseStart
          dayDate = new Date(Date.UTC(y, m, baseStart.getUTCDate()));
        }

        if (dayDate) {
          const occ = new Date(dayDate);
          occ.setUTCHours(baseStart.getUTCHours(), baseStart.getUTCMinutes(), baseStart.getUTCSeconds(), baseStart.getUTCMilliseconds());
          if (occ >= winStart && occ <= winEnd && bounded(occ)) pushOcc(occ);
        }
        t = addMonths(t, 1);
      }
      continue;
    }

    // Unknown freq: ignore to avoid crashing
  }

  out.sort((a,b)=> new Date(a.starts_at) - new Date(b.starts_at));
  return out;
}
