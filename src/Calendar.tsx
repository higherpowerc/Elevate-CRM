import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import type { Appointment } from "./types";
import { fmtDemoTime, DEMO_TZ_SHORT } from "./demoTime";

/** Owner 2026-08-20 sales rework — the owner's Calendar view. Lists all
 *  demo-call appointments (every org's, with the linked client name) sorted by
 *  time. V1 surfaces them in a simple chronological list grouped by date
 *  (a full grid/agenda can come later); each demo call that was scheduled from
 *  a lead appears here the moment "Schedule demo call" is clicked. */
const STATUS_META: Record<Appointment["status"], { label: string; tone: string }> = {
  scheduled: { label: "Scheduled", tone: "tone-blue" },
  confirmed: { label: "Confirmed", tone: "tone-green" },
  held: { label: "Held", tone: "tone-gray" },
  cancelled: { label: "Cancelled", tone: "tone-red" },
};

const DEMO_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEMO_MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
/** "2026-08-26T16:00" -> "Wed, Aug 26". The weekday is derived only from the
 *  ymd wall-clock date (constructed at local noon so the day never crosses a
 *  timezone boundary), so the displayed day can never shift. */
function fmtDay(dt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dt ?? "");
  if (!m) return (dt ?? "").slice(0, 10);
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dtObj = new Date(y, mo - 1, d, 12); // noon local: safe, day-stable
  return `${DEMO_WEEKDAYS[dtObj.getDay()]}, ${DEMO_MONTHS_SHORT[mo - 1]} ${d}`;
}
function fmtTime(dt: string): string {
  // Scheduled demo times are stored as naive "YYYY-MM-DDTHH:MM" Arizona wall
  // clock. Format the HH:MM portion directly (never via a Date object, which
  // would shift into the viewer's local timezone) as 12-hour AM/PM + MST.
  const t = (dt ?? "").slice(11);
  return /^\d{1,2}:\d{2}$/.test(t) ? `${fmtDemoTime(t)} ${DEMO_TZ_SHORT}` : dt;
}

export default function Calendar() {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { appointments } = await api.appointments();
      setAppointments(appointments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the calendar.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments ?? []) {
      const key = (a.scheduledAt || "").slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [appointments]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Calendar{" "}
            <em className="serif" style={{ color: "var(--accent, #d6ff3f)" } as CSSProperties}>
              demo calls
            </em>
          </h1>
          <p className="page-sub">
            {appointments ? `${appointments.length} demo call${appointments.length === 1 ? "" : "s"} scheduled` : "Loading…"}
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {!appointments ? (
        <div className="skeleton-block" aria-label="Loading calendar" />
      ) : appointments.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">No demo calls scheduled</p>
          <p className="empty-sub">
            Use "Schedule demo call" on a lead and the call shows up here, with the lead emailed a confirmation.
          </p>
        </div>
      ) : (
        <div className="calendar-list">
          {groups.map(([day, list]) => (
            <section className="calendar-day" key={day}>
              <h2 className="calendar-day-head">{fmtDay(day)}</h2>
              <div className="calendar-rows">
                {list.map((a) => {
                  const meta = STATUS_META[a.status] ?? STATUS_META.scheduled;
                  return (
                    <div className="card calendar-row" key={a.id}>
                      <div className="calendar-time">{fmtTime(a.scheduledAt)}</div>
                      <div className="calendar-main">
                        <div className="calendar-title">
                          <strong>{a.title}</strong>
                          <span className={`badge ${meta.tone}`}>{meta.label}</span>
                        </div>
                        <div className="calendar-sub">
                          {a.clientName ? <span>{a.clientName}</span> : <span className="cell-muted">Unlinked lead</span>}
                          <span className="cell-muted">· {a.duration} min</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
