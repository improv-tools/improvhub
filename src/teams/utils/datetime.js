
export const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const pad = (n) => String(n).padStart(2, "0");

/** Convert a Date/ISO to an <input type="datetime-local"> value */
export function toLocalInput(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/** Split "YYYY-MM-DDTHH:mm" into [date, time] */
export function splitLocal(localT) {
  if (!localT) return ["",""];
  const [date, time] = localT.split("T");
  return [date || "", time || ""];
}

/** "13:05" -> "1:05 PM" based on local locale */
export function fmtTime(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Combine a local date+time in a target IANA tz and return ISO UTC string */
export function combineLocal(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);

  // Build a Date as if in the provided timezone.
  // Trick: format that wall time in the target tz and extract the UTC parts via Intl.
  const dt = new Date(Date.UTC(y, (m-1), d, hh, mm, 0));

  // We need the offset for the target tz at that moment.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(dt).reduce((acc,p) => (acc[p.type]=p.value, acc), {});

  // Construct a string "YYYY-MM-DDTHH:mm:ss" as seen in that tz, then parse as if UTC.
  const localLike = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
  // Now parse back to Date to get accurate UTC instant corresponding to the local wall time
  const asUtc = new Date(localLike);
  return asUtc.toISOString();
}

/** Minutes between two ISO/Date */
export function minutesBetween(a, b) {
  const A = (a instanceof Date) ? a : new Date(a);
  const B = (b instanceof Date) ? b : new Date(b);
  return Math.round((B - A) / 60000);
}

/** Find the nth weekday of a month in UTC (month 0-11, weekday 0-6) */
export function nthWeekdayOfMonth(year, month /*0-11*/, weekday /*0-6*/, n /*1..5 or -1 last*/) {
  if (n === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const diff = (last.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month, last.getUTCDate() - diff));
  }
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  const dt = new Date(Date.UTC(year, month, day));
  if (dt.getUTCMonth() !== month) return null;
  return dt;
}
