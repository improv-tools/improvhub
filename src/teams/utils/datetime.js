
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

export function splitLocal(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

/** "13:05" -> "1:05 PM" based on local locale */
export function fmtTime(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Combine a local date+time in a target IANA tz and return ISO UTC string */
export function combineLocal(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const iso = `${dateStr}T${timeStr}:00`;
  const d = new Date(iso); // interpreted in user's local tz
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fmtRangeLocal(startIso, endIso, tzLabel) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const d = s.toLocaleDateString();
  const st = s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const et = e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${d} ${st}–${et}${tzLabel ? ` (${tzLabel})` : ""}`;
}

/** Minutes between two ISO/Date */
export function minutesBetween(aIso, bIso) {
  return Math.round((new Date(bIso) - new Date(aIso)) / 60000);
}

export function browserTZ() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
