import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import type { Appointment } from "./types";

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

function fmtDay(dt: string): string {
  const d = new Date(dt);
  return Number.isNaN(d.getTime())
    ? dt.slice(0, 10)
    : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(dt: string): string {
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt.slice(11) : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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
