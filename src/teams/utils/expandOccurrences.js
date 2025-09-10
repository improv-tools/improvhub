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
 * Expand recurring/base events to concrete occurrences within a window.
 * Max 12 occurrences when either recur_count or recur_until is provided.
 * Interval is treated as 1 (no interval UI).
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
      recur_freq = "none",
      recur_byday = null,
      recur_bymonthday = null,
      recur_week_of_month = null,
      recur_until = null,
      recur_count = null
    } = ev;

    const baseStart = new Date(starts_at);
    const baseEnd = new Date(ends_at);
    const durMs = baseEnd - baseStart;

    const hasEnd = recur_count != null || recur_until != null;
    const maxOcc = recur_count != null ? Math.min(Number(recur_count) || 0, 12) : (hasEnd ? 12 : Number.POSITIVE_INFINITY);

    let occurrences = 0;

    const pushOcc = (occStart) => {
      if (occurrences >= maxOcc) return;
      const occ_index = occurrences;
      const occ_total = (recur_count != null ? Math.min(Number(recur_count) || 0, 12) : null);

      const occStartIso = iso(occStart);
      const occEndIso = iso(new Date(occStart.getTime() + durMs));
      if (occStart < winStart || occStart > winEnd) return;

      const key = `${id}|${occStartIso}`;
      const ov = overrideMap.get(key);
      if (ov?.canceled) return;

      out.push({
        event_id: id,
        occ_index,
        occ_total,
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

    if (recur_freq === "none") {
      pushOcc(baseStart);
      continue;
    }

    const until = recur_until ? new Date(recur_until) : null;

    const bounded = (d) => {
      if (occurrences >= maxOcc) return false;
      if (until && d > until) return false;
      return true;
    };

    // ... daily, weekly, monthly logic unchanged, but calls pushOcc()
    // (omitted here for brevity; matches your original with the above enhancements)

    if (recur_freq === "monthly") {
      let t = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), 1));
      while (t <= winEnd && bounded(t)) {
        const y = t.getUTCFullYear();
        const m = t.getUTCMonth();
        let dayDate = null;

        if (recur_bymonthday) {
          const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          dayDate = new Date(Date.UTC(y, m, Math.min(recur_bymonthday, last)));
        } else if (recur_week_of_month && Array.isArray(recur_byday) && recur_byday.length === 1) {
          const wd = DOW.indexOf(recur_byday[0]);
          if (wd >= 0) dayDate = nthWeekdayOfMonthUTC(y, m, wd, recur_week_of_month);
        } else {
          dayDate = new Date(Date.UTC(y, m, baseStart.getUTCDate()));
        }

        if (dayDate) {
          const occ = new Date(dayDate);
          occ.setUTCHours(baseStart.getUTCHours(), baseStart.getUTCMinutes(), baseStart.getUTCSeconds(), baseStart.getUTCMilliseconds());
          if (occ >= winStart && occ <= winEnd && bounded(occ)) pushOcc(occ);
        }
        t = addMonths(t, 1);
      }
    }
  }

  out.sort((a,b)=> new Date(a.starts_at) - new Date(b.starts_at));
  return out;
}
