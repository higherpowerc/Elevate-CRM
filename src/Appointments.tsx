import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import type { Appointment } from "./types";
import { fmtDemoTime, DEMO_TZ_SHORT, fmtDemoDateTime } from "./demoTime";
/** Appointments production (backlog 5a104eae) — the full Appointment entity,
 *  usable in BOTH the owner workspace (the owner's schedule across accounts,
 *  plus create/edit/cancel/status) and each client workspace (their own org's
 *  appointments; create-for-self only when the account toggle is ON). Row-level
 *  isolation is server-enforced: owner uses /api/appointments, tenant uses
 *  /api/org/appointments scoped to their org. The owner Calendar (Calendar.tsx)
 *  remains the owner's demo-call view; this is the general appointments tab. */
const STATUS_META: Record<Appointment["status"], { label: string; tone: string }> = {
  scheduled: { label: "Scheduled", tone: "tone-blue" },
  confirmed: { label: "Confirmed", tone: "tone-green" },
  held: { label: "Held", tone: "tone-gray" },
  cancelled: { label: "Cancelled", tone: "tone-red" },
};
const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MOS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(dt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dt ?? "");
  if (!m) return (dt ?? "").slice(0, 10);
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12);
  return `${WDAYS[d.getDay()]}, ${MOS[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}`;
}
function fmtTime(dt: string): string {
  const t = (dt ?? "").slice(11);
  return /^\d{1,2}:\d{2}$/.test(t) ? `${fmtDemoTime(t)} ${DEMO_TZ_SHORT}` : dt;
}
function defaultSlot(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export default function Appointments({ ownerOrg }: { ownerOrg: boolean }) {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [allowSelf, setAllowSelf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newSlot, setNewSlot] = useState(defaultSlot);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      if (ownerOrg) {
        const r = await api.appointments();
        setAppointments(r.appointments);
      } else {
        const r = await api.orgAppointments();
        setAppointments(r.appointments);
        setAllowSelf(r.allowSelfSchedule);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load appointments.");
    }
  }, [ownerOrg]);
  useEffect(() => {
    load();
  }, [load]);
  const create = useCallback(async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (ownerOrg) {
        await api.createAppointment({ title: newTitle.trim(), scheduledAt: newSlot });
      } else {
        await api.createOrgAppointment(newTitle.trim(), newSlot);
      }
      setNewTitle("");
      setNewSlot(defaultSlot());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create appointment.");
    } finally {
      setBusy(false);
    }
  }, [ownerOrg, newTitle, newSlot, load]);
  const setStatus = useCallback(
    async (id: number, status: Appointment["status"]) => {
      setError(null);
      try {
        await api.patchAppointment(id, { status });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update appointment.");
      }
    },
    [load],
  );
  const cancel = useCallback(
    async (id: number) => {
      setError(null);
      try {
        await api.cancelAppointment(id);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to cancel appointment.");
      }
    },
    [load],
  );
  const groups = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments ?? []) {
      const k = (a.scheduledAt || "").slice(0, 10);
      const l = map.get(k) ?? [];
      l.push(a);
      map.set(k, l);
    }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [appointments]);
  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>
            Appointments{" "}
            <em className="serif" style={{ color: "var(--accent, #d6ff3f)" } as CSSProperties}>
              {ownerOrg ? "owner" : "you"}
            </em>
          </h1>
          <p className="page-sub">
            {appointments ? `${appointments.length} appointment${appointments.length === 1 ? "" : "s"}` : "Loading…"}
          </p>
        </div>
      </div>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="card">
        <h3>Schedule an appointment</h3>
        {!ownerOrg && !allowSelf && (
          <p className="cell-muted">Self-scheduling is disabled for this account. Contact the owner to book a time.</p>
        )}
        {(ownerOrg || allowSelf) && (
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={ownerOrg ? "Title (e.g. Onboarding call — Acme)" : "What's this appointment for?"}
              style={{ minWidth: "220px", flex: "1" }}
            />
            <input type="datetime-local" value={newSlot} onChange={(e) => setNewSlot(e.target.value)} />
            <button className="btn btn-primary" onClick={create} disabled={busy || !newTitle.trim()}>
              {busy ? "Scheduling…" : "Schedule"}
            </button>
          </div>
        )}
      </div>
      {!appointments ? (
        <div className="skeleton-block" aria-label="Loading appointments" />
      ) : appointments.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">No appointments</p>
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
                          {a.clientName ? <span>{a.clientName}</span> : <span className="cell-muted">Unlinked</span>}
                          <span className="cell-muted">· {a.duration} min</span>
                        </div>
                      </div>
                      <div className="calendar-actions">
                        {ownerOrg && a.status !== "cancelled" && (
                          <>
                            {a.status === "scheduled" && (
                              <button className="btn btn-ghost btn-sm" onClick={() => setStatus(a.id, "confirmed")}>
                                Confirm
                              </button>
                            )}
                            {a.status !== "held" && (
                              <button className="btn btn-ghost btn-sm" onClick={() => setStatus(a.id, "held")}>
                                Held
                              </button>
                            )}
                            <button className="btn btn-ghost btn-sm" onClick={() => cancel(a.id)}>
                              Cancel
                            </button>
                          </>
                        )}
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
