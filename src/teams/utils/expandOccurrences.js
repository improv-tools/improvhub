
import { DOW, nthWeekdayOfMonth } from "./datetime";

export function expandOccurrences(events, fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const out = [];

  for (const e of events) {
    const start = new Date(e.starts_at);
    const end = new Date(e.ends_at);
    const durMs = end - start;

    if (e.recur_freq === "none") {
      if (start >= from && start <= to) {
        out.push({ ...e, occ_start: start, occ_end: new Date(start.getTime() + durMs) });
      }
      continue;
    }

    let count = 0;
    const maxCount = e.recur_count || 1000;
    const until = e.recur_until ? new Date(`${e.recur_until}T23:59:59Z`) : null;
    const interval = Math.max(1, e.recur_interval || 1);

    if (e.recur_freq === "weekly") {
      const by = (e.recur_byday && e.recur_byday.length) ? e.recur_byday : [DOW[start.getUTCDay()]];
      const weekMs = 7 * 24 * 3600 * 1000;

      const anchorDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
      const anchorDow = anchorDate.getUTCDay();
      const anchorMonday = new Date(anchorDate.getTime() - ((anchorDow + 6) % 7) * 24 * 3600 * 1000);

      const weeksFromAnchor = Math.floor((from - anchorMonday) / weekMs);
      let k = Math.max(0, Math.floor(weeksFromAnchor / interval));

      while (true) {
        const thisWeek = new Date(anchorMonday.getTime() + k * interval * weekMs);
        for (const code of by) {
          const wday = DOW.indexOf(code);
          if (wday < 0) continue;
          const day = new Date(thisWeek.getTime() + ((wday + 7) % 7) * 24 * 3600 * 1000);
          const occStart = new Date(Date.UTC(
            day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
            start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()
          ));
          const occEnd = new Date(occStart.getTime() + durMs);

          if (occStart > to) break;
          if ((until && occStart > until) || count >= maxCount) break;
          if (occEnd >= from && occStart <= to) {
            out.push({ ...e, occ_start: occStart, occ_end: occEnd });
            count++;
          }
        }
        const nextWeekStart = new Date(thisWeek.getTime() + interval * weekMs);
        if (nextWeekStart > to) break;
        if ((until && nextWeekStart > until) || count >= maxCount) break;
        k++;
      }
    } else if (e.recur_freq === "monthly") {
      const byMonthDay = e.recur_bymonthday && e.recur_bymonthday.length ? e.recur_bymonthday : [start.getUTCDate()];
      const byNth = e.recur_week_of_month
        ? { n: e.recur_week_of_month, dow: e.recur_day_of_week || DOW[start.getUTCDay()] }
        : null;

      let y = start.getUTCFullYear();
      let m = start.getUTCMonth();

      while (new Date(Date.UTC(y, m, 1)) < from) {
        m += interval;
        if (m > 11) { y += Math.floor(m / 12); m = m % 12; }
        if ((until && new Date(Date.UTC(y, m, 1)) > until) || count >= maxCount) break;
      }

      while (true) {
        if (byNth) {
          const weekday = DOW.indexOf(byNth.dow);
          const dt = nthWeekdayOfMonth(y, m, weekday, byNth.n);
          if (dt) {
            const occStart = new Date(Date.UTC(
              dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
              start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()
            ));
            const occEnd = new Date(occStart.getTime() + durMs);
            if (occStart > to) break;
            if ((until && occStart > until) || count >= maxCount) break;
            if (occEnd >= from && occStart <= to) { out.push({ ...e, occ_start: occStart, occ_end: occEnd }); count++; }
          }
        } else {
          for (const d of byMonthDay) {
            const dt = new Date(Date.UTC(y, m, d));
            if (dt.getUTCMonth() !== m) continue;
            const occStart = new Date(Date.UTC(
              dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
              start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()
            ));
            const occEnd = new Date(occStart.getTime() + durMs);
            if (occStart > to) break;
            if ((until && occStart > until) || count >= maxCount) break;
            if (occEnd >= from && occStart <= to) { out.push({ ...e, occ_start: occStart, occ_end: occEnd }); count++; }
          }
        }
        m += interval;
        if (m > 11) { y += Math.floor(m / 12); m = m % 12; }
        const nextMonthStart = new Date(Date.UTC(y, m, 1));
        if (nextMonthStart > to) break;
        if ((until && nextMonthStart > until) || count >= maxCount) break;
      }
    }
  }

  out.sort((a, b) => a.occ_start - b.occ_start);
  return out;
}
