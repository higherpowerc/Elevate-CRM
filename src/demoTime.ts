/** Demo-call time conventions (owner 2026-08-21).
 *
 *  All demo times are Arizona Mountain Standard Time — America/Phoenix,
 *  fixed UTC-7, NO daylight saving. The stored value is a naive
 *  "YYYY-MM-DDTHH:MM" Arizona wall-clock string (demo_scheduled_at /
 *  appointment.scheduledAt), so formatting here is PURE STRING MATH — we never
 *  round-trip through a Date object or a timezone API, which guarantees the
 *  displayed time can never shift or drift regardless of the viewer's browser
 *  timezone. */
export const DEMO_TZ_NAME = "Arizona (MST)";
/** Short suffix for compact surfaces (Calendar time, invites). */
export const DEMO_TZ_SHORT = "MST";

/** "08:00" -> "8:00 AM", "16:00" -> "4:00 PM". 12-hour clock with AM/PM.
 *  Invalid input is returned unchanged so callers never render a lie. */
export function fmtDemoTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return hhmm;
  const hh = parseInt(m[1], 10);
  const mm = m[2];
  const ap = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${mm} ${ap}`;
}

const DEMO_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-26T16:00" -> "Aug 26, 2026 at 4:00 PM (Arizona (MST))".
 *  Used for the lead-row text and the Schedule-Demo success notice. */
export function fmtDemoDateTime(dt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})$/.exec((dt ?? "").trim());
  if (!m) return dt;
  const [, y, mo, d, hh, mm] = m;
  const month = DEMO_MONTHS[parseInt(mo, 10) - 1] ?? mo;
  const time12 = fmtDemoTime(`${hh}:${mm}`);
  return `${month} ${parseInt(d, 10)}, ${y} at ${time12} (${DEMO_TZ_NAME})`;
}
