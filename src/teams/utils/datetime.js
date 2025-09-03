export const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const pad = (n) => String(n).padStart(2, "0");

export function toLocalInput(date) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export function splitLocal(localT) {
  const [date, time] = (localT || "").split("T");
  return { date: date || "", time: time || "" };
}

export function combineLocal(date, time) {
  return date && time ? `${date}T${time}` : "";
}

export function fmtDT(d, tz, opts = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(new Date(d));
}

export function fmtTime(d, tz) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

export function minutesBetween(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  return Math.round(ms / 60000);
}

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
