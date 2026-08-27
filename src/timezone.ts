/** Calendar/appointments timezone auto-conversion (owner 2026-08-27).
 *
 *  The owner's timezone is Arizona MST — America/Phoenix, fixed UTC-7, NO
 *  daylight saving. Appointment times are STORED as naive "YYYY-MM-DDTHH:MM"
 *  Arizona wall-clock strings (that is the owner's Appointments/Calendar view,
 *  and the value we persist). Each lead/client carries an IANA timezone so the
 *  UI can show the client's own local time — correctly converted across DST
 *  (e.g. Eastern is UTC-5 in winter, UTC-4 in summer, while Arizona stays a
 *  constant UTC-7).
 *
 *  All conversion is PURE STRING MATH on a naive wall clock — we never call
 *  `getHours()`/`toLocaleString()` on a Date whose host timezone could shift
 *  the result. Then a lead in New York saying "3pm Eastern" is recorded
 *  against the owner's MST clock (12pm MST in summer, 1pm MST in winter) and
 *  an owner picking a slot in MST sees the client's local time beside it. */
import { DEMO_TZ_SHORT, DEMO_TZ_NAME } from "./demoTime";

/** The owner's fixed timezone — Arizona Mountain Standard Time, UTC-7, no DST. */
export const OWNER_TIMEZONE = "America/Phoenix";

/** A lead/client's timezone falls back to the owner's when unset (''). */
export const DEFAULT_CLIENT_TIMEZONE = OWNER_TIMEZONE;

/** The IANA timezones the owner can set on a lead/client. `value` is what is
 *  STORED; `label` is the human option shown in the intake selector. The
 *  empty value means "unset" (treated as the owner's MST). */
export const CLIENT_TIMEZONES: { value: string; label: string }[] = [
  { value: "", label: "— Unset (use Arizona / MST) —" },
  { value: "America/Phoenix", label: "Arizona (MST, UTC-7, no DST)" },
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
];

/** True when v is '' (unset) or one of the known IANA values. Used by the
 *  server to validate a client's timezone write, and by the UI. */
export function isKnownTimezone(v: unknown): boolean {
  return (
    typeof v === "string" &&
    (v === "" || CLIENT_TIMEZONES.some((t) => t.value === v))
  );
}

/** Human label for a stored IANA value (falls back to a friendly "Arizona/
 *  MST" when unset and to the raw value when unknown). */
export function timezoneLabel(tz: string): string {
  if (!tz) return DEMO_TZ_NAME;
  const hit = CLIENT_TIMEZONES.find((t) => t.value === tz);
  return hit ? hit.label : tz;
}

/** Short label for a stored IANA value — the parenthetical tag shown next to
 *  a converted time. Unset/unknown falls back to the owner's "MST". */
export function timezoneShort(tz: string): string {
  if (!tz) return DEMO_TZ_SHORT;
  if (tz === OWNER_TIMEZONE) return DEMO_TZ_SHORT;
  switch (tz) {
    case "America/New_York":
      return "Eastern";
    case "America/Chicago":
      return "Central";
    case "America/Denver":
      return "Mountain";
    case "America/Los_Angeles":
      return "Pacific";
    case "America/Anchorage":
      return "Alaska";
    case "Pacific/Honolulu":
      return "Hawaii";
    default:
      return tz;
  }
}

/** Offset (ms) of the IANA zone from UTC at the given UTC instant — negative
 *  west of Greenwich (NY summer = -4h = -14400000). Derived by formatting the
 *  instant in the zone and diffing the resulting wall clock against UTC. */
function zoneOffsetMs(iana: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour % 24,
    +parts.minute,
    +parts.second,
  );
  return asUTC - at.getTime();
}

/** Convert a naive "YYYY-MM-DDTHH:MM" wall clock from one IANA zone to
 *  another, accounting for DST where applicable (Arizona stays UTC-7; Eastern
 *  is UTC-5 winter / UTC-4 summer). We iterate a couple of times so the
 *  offsets are evaluated at the correct instant even across a DST boundary.
 *  Invalid input is returned unchanged so callers never render a lie. */
export function convertNaive(dt: string, fromTz: string, toTz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec((dt ?? "").trim());
  if (!m) return dt;
  const [, y, mo, d, hh, mm] = m;
  const wall = Date.UTC(+y, +mo - 1, +d, +hh, +mm);
  // wall = instant + offset(from)  →  instant = wall - offset(from)
  // then wall'(to) = instant + offset(to) = wall - offset(from) + offset(to)
  let utc = wall;
  for (let i = 0; i < 3; i++) {
    utc = wall - zoneOffsetMs(fromTz, new Date(utc)) + zoneOffsetMs(toTz, new Date(utc));
  }
  const r = new Date(utc);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${r.getUTCFullYear()}-${p(r.getUTCMonth() + 1)}-${p(r.getUTCDate())}T${p(
    r.getUTCHours(),
  )}:${p(r.getUTCMinutes())}`;
}

/** Convert a stored MST appointment time to the client's local wall clock.
 *  Unset/unknown client timezone → unchanged (already the owner's MST). */
export function mstToClientLocal(mstDt: string, clientTz: string): string {
  if (!clientTz) return mstDt;
  return convertNaive(mstDt, OWNER_TIMEZONE, clientTz);
}

/** Convert a client's local wall clock (what they stated) to the owner's MST
 *  for storage. Unset/unknown client timezone → unchanged (already MST). */
export function clientLocalToMst(localDt: string, clientTz: string): string {
  if (!clientTz) return localDt;
  return convertNaive(localDt, clientTz, OWNER_TIMEZONE);
}
