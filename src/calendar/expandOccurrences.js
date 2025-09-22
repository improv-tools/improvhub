// src/calendar/expandOccurrences.js
// Lightweight client-side expansion of RFC5545-like events into concrete occurrences.
// Intentional isolation: swap this module out later with a server/edge-backed fetch
// that returns the same shape. Keep API surface small and documented.

/**
 * Parse a minimal RRULE string supporting FREQ, BYDAY, BYMONTHDAY, COUNT, UNTIL.
 * Example: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6"
 */
export function parseRRule(rrule) {
  if (!rrule || typeof rrule !== 'string') return null;
  const parts = Object.create(null);
  rrule.split(';').forEach(seg => {
    const [k, v] = seg.split('=');
    if (!k) return;
    const key = k.trim().toUpperCase();
    const val = (v || '').trim();
    switch (key) {
      case 'FREQ': parts.freq = val.toUpperCase(); break;
      case 'BYDAY': parts.byday = val ? val.split(',').map(s => s.trim().toUpperCase()) : undefined; break;
      case 'BYSETPOS': parts.bysetpos = val ? val.split(',').map(s => parseInt(s, 10)).filter(Number.isFinite) : undefined; break;
      case 'BYMONTHDAY': parts.bymonthday = val ? val.split(',').map(s => parseInt(s, 10)).filter(Number.isFinite) : undefined; break;
      case 'COUNT': parts.count = Number(val) || undefined; break;
      case 'INTERVAL': parts.interval = Math.max(1, Number(val) || 1); break;
      case 'UNTIL': {
        // Treat UNTIL as timestamp (UTC) if it looks like full ISO, else YYYYMMDD as 23:59:59
        if (/^\d{8}T\d{6}Z$/.test(val)) parts.until = new Date(val);
        else if (/^\d{8}$/.test(val)) {
          const y = val.slice(0,4), m = val.slice(4,6), d = val.slice(6,8);
          parts.until = new Date(`${y}-${m}-${d}T23:59:59Z`);
        } else {
          const dt = new Date(val);
          if (!isNaN(dt)) parts.until = dt;
        }
        break;
      }
      default: break;
    }
  });
  if (!parts.freq) return null;
  return parts;
}

const DOW = ['SU','MO','TU','WE','TH','FR','SA'];

function addDays(dt, n) {
  const d = new Date(dt.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function sameDayUTC(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/**
 * Expand a single event into base occurrences (series instances), without overrides.
 * Supports FREQ: NONE | WEEKLY | MONTHLY (BYMONTHDAY or fallback to dtstart day-of-month), COUNT, UNTIL.
 * rdate/exdate are applied.
 */
export function expandBaseOccurrences(event, windowStart, windowEnd, { hardCap = 12, monthsLimit = 12 } = {}) {
  const out = [];
  const start = new Date(windowStart);
  const end = new Date(windowEnd);
  // Enforce a hard “within N months” cap relative to the window start
  const limitEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthsLimit, start.getUTCDate(), 23, 59, 59));
  const maxWindowEnd = end > limitEnd ? limitEnd : end;
  const dtstart = new Date(event.dtstart);
  const dtend = event.dtend ? new Date(event.dtend) : (event.duration_sec ? new Date(new Date(event.dtstart).getTime() + event.duration_sec * 1000) : null);
  const baseDurationMs = dtend ? (dtend.getTime() - dtstart.getTime()) : 0;

  // Helper to push if within window
  const pushIfInWindow = (occStart) => {
    if (out.length >= hardCap) return; // enforce per-event cap
    const s = new Date(occStart);
    const e = baseDurationMs ? new Date(s.getTime() + baseDurationMs) : null;
    if (e ? (e > start && s < maxWindowEnd) : (s >= start && s <= maxWindowEnd)) {
      out.push({ recurrence_id: s.toISOString(), start: s, end: e, source: 'series' });
    }
  };

  // Apply RDATEs at the end
  const rdates = Array.isArray(event.rdate) ? event.rdate.map(x => new Date(x)) : [];
  const exdates = new Set((Array.isArray(event.exdate) ? event.exdate : []).map(x => new Date(x).toISOString()));

  if (!event.rrule) {
    if (!exdates.has(dtstart.toISOString())) pushIfInWindow(dtstart);
  } else {
    const rule = parseRRule(event.rrule);
    if (!rule) {
      if (!exdates.has(dtstart.toISOString())) pushIfInWindow(dtstart);
    } else if (rule.freq === 'WEEKLY') {
      const byday = (rule.byday && rule.byday.length) ? new Set(rule.byday) : new Set([DOW[new Date(event.dtstart).getUTCDay()]]);
      let cursor = new Date(Date.UTC(dtstart.getUTCFullYear(), dtstart.getUTCMonth(), dtstart.getUTCDate(), dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds()));
      let n = 0;
      const until = rule.until ? new Date(Math.min(rule.until.getTime(), maxWindowEnd.getTime())) : maxWindowEnd;
      const maxN = Math.min(rule.count || hardCap, hardCap);
      const intervalWeeks = rule.interval || 1;
      // Anchor weekly intervals to start-of-week (Monday) of dtstart
      const startWeekAnchor = (() => {
        const d = new Date(Date.UTC(dtstart.getUTCFullYear(), dtstart.getUTCMonth(), dtstart.getUTCDate()));
        // JS: 0=Sun..6=Sat; we want Monday=1 anchor
        const dow = d.getUTCDay();
        const delta = (dow === 0 ? -6 : 1 - dow); // days to Monday
        d.setUTCDate(d.getUTCDate() + delta);
        d.setUTCHours(0,0,0,0);
        return d;
      })();
      // Iterate day-by-day within [min(start, dtstart), max(end, until)] bounds
      const maxEnd = until;
      while (cursor <= maxEnd && n < maxN) {
        const wk = DOW[cursor.getUTCDay()];
        if (byday.has(wk)) {
          // Check INTERVAL for weekly → only weeks separated by interval from anchor
          const curWeekAnchor = (() => {
            const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
            const dow = d.getUTCDay();
            const delta = (dow === 0 ? -6 : 1 - dow);
            d.setUTCDate(d.getUTCDate() + delta);
            d.setUTCHours(0,0,0,0);
            return d;
          })();
          const diffWeeks = Math.floor((curWeekAnchor - startWeekAnchor) / (7 * 24 * 60 * 60 * 1000));
          if (diffWeeks % intervalWeeks !== 0) { cursor = addDays(cursor, 1); continue; }
          const occ = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds()));
          if (occ >= dtstart && (!until || occ <= until)) {
            const iso = occ.toISOString();
            if (!exdates.has(iso)) { pushIfInWindow(occ); n++; }
            if (n >= maxN) break;
          }
        }
        cursor = addDays(cursor, 1);
      }
    } else if (rule.freq === 'MONTHLY') {
      // Simple monthly: BYMONTHDAY list or fallback to day-of-month from dtstart
      const startMonth = Date.UTC(dtstart.getUTCFullYear(), dtstart.getUTCMonth(), 1);
      const endMonthLimit = Date.UTC(maxWindowEnd.getUTCFullYear(), maxWindowEnd.getUTCMonth(), 1);
      const monthsSpan = Math.round((endMonth - startMonth) / (1000*60*60*24*30.4375)) + 2;
      const monthDays = (rule.bymonthday && rule.bymonthday.length) ? rule.bymonthday : [dtstart.getUTCDate()];
      const until = rule.until ? new Date(Math.min(rule.until.getTime(), maxWindowEnd.getTime())) : maxWindowEnd;
      const maxN = Math.min(rule.count || hardCap, hardCap);
      let n = 0;
      // Support ordinal weekdays via BYSETPOS with BYDAY, or inline ordinals like -1MO/1MO
      const bydayTokens = rule.byday || [];
      const byset = rule.bysetpos || [];
      const ordinalInline = bydayTokens.length === 1 && /^-?\d{1}[A-Z]{2}$/.test(bydayTokens[0]);
      const ordinalToken = ordinalInline ? parseInt(bydayTokens[0].slice(0, bydayTokens[0].length - 2), 10) : undefined;
      const weekdayToken = ordinalInline ? bydayTokens[0].slice(-2) : (bydayTokens.length === 1 ? bydayTokens[0] : undefined);

      const intervalMonths = rule.interval || 1;
      for (let i = -1; i <= monthsSpan; i += intervalMonths) {
        if (n >= maxN) break;
        const base = new Date(startMonth);
        const y = base.getUTCFullYear() + Math.floor((base.getUTCMonth() + i) / 12);
        const m = (base.getUTCMonth() + i + 1200) % 12; // guard negatives
        const monthStart = new Date(Date.UTC(y, m, 1));
        if (monthStart.getTime() > endMonthLimit) break;
        const lastDom = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const emitOcc = (occ) => {
          if (occ >= dtstart && (!until || occ <= until)) {
            const iso = occ.toISOString();
            if (!exdates.has(iso)) { pushIfInWindow(occ); n++; }
          }
        };

        if (weekdayToken && (ordinalToken || byset.length)) {
          // Compute nth weekday of the month
          const wd = DOW.indexOf(weekdayToken);
          if (wd >= 0) {
            const first = new Date(Date.UTC(y, m, 1, dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds()));
            // Find first occurrence of the weekday in month
            const firstWdDelta = (wd - first.getUTCDay() + 7) % 7;
            const firstWdDate = 1 + firstWdDelta;
            const applyNth = (nth) => {
              if (nth > 0) {
                const day = firstWdDate + (nth - 1) * 7;
                if (day >= 1 && day <= lastDom) emitOcc(new Date(Date.UTC(y, m, day, dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds())));
              } else {
                // last (-1): walk back from end of month to matching weekday
                const lastDate = new Date(Date.UTC(y, m + 1, 0, dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds()));
                let day = lastDate.getUTCDate();
                while (DOW[new Date(Date.UTC(y, m, day)).getUTCDay()] !== weekdayToken && day > 1) day--;
                emitOcc(new Date(Date.UTC(y, m, day, dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds())));
              }
            };
            if (ordinalToken) {
              applyNth(ordinalToken);
            } else if (byset.length) {
              for (const nth of byset) { if (n >= maxN) break; applyNth(nth); }
            }
          }
        } else {
          for (const dom of monthDays) {
            if (n >= maxN) break;
            const day = Math.min(Math.max(dom, 1), lastDom);
            const occ = new Date(Date.UTC(y, m, day, dtstart.getUTCHours(), dtstart.getUTCMinutes(), dtstart.getUTCSeconds()));
            emitOcc(occ);
          }
        }
        if (n >= maxN) break;
      }
    } else {
      // Unknown/unsupported FREQ → single instance
      if (!exdates.has(dtstart.toISOString())) pushIfInWindow(dtstart);
    }
  }

  // RDATEs: explicit additional instances
  for (const r of rdates) {
    if (out.length >= hardCap) break;
    const iso = r.toISOString();
    if (!exdates.has(iso)) pushIfInWindow(r);
  }

  return out.sort((a,b) => a.start - b.start);
}

/**
 * Merge overrides into base occurrences. Overrides are keyed by recurrence_id (the base start).
 * Returns an array of { eventId, overrideId|null, recurrence_id, start, end, data }.
 */
export function mergeOverrides(event, baseOccurrences, overrides = []) {
  if (!Array.isArray(baseOccurrences)) return [];
  const byRid = new Map();
  overrides.filter(o => o.parent_event_id === event.id).forEach(o => {
    if (o.recurrence_id) byRid.set(new Date(o.recurrence_id).toISOString(), o);
  });
  return baseOccurrences.map(occ => {
    const ov = byRid.get(occ.recurrence_id);
    if (!ov) return { eventId: event.id, overrideId: null, recurrence_id: occ.recurrence_id, start: occ.start, end: occ.end, source: 'series', event, override: null };
    const start = ov.dtstart ? new Date(ov.dtstart) : occ.start;
    const end = ov.dtend ? new Date(ov.dtend) : (occ.end || (ov.duration_sec ? new Date(start.getTime() + ov.duration_sec * 1000) : null));
    return { eventId: event.id, overrideId: ov.id, recurrence_id: occ.recurrence_id, start, end, source: 'override', event, override: ov };
  });
}

/**
 * Expand a list of events + overrides for a time window.
 * events: [{ id, dtstart, dtend?, duration_sec?, rrule?, rdate?, exdate?, summary, ... }]
 * overrides: [{ id, parent_event_id, recurrence_id, dtstart?, dtend?, duration_sec? ... }]
 */
export function expandEvents({ events = [], overrides = [], windowStart, windowEnd, capPerEvent = 500 }) {
  const out = [];
  for (const ev of events) {
    const bases = expandBaseOccurrences(ev, windowStart, windowEnd, { hardCap: capPerEvent });
    const merged = mergeOverrides(ev, bases, overrides);
    out.push(...merged);
  }
  return out.sort((a,b) => a.start - b.start);
}

export default { parseRRule, expandBaseOccurrences, mergeOverrides, expandEvents };
