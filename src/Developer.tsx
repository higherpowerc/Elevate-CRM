import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import {
  DEV_STATUS_LABEL,
  DEV_STATUS_TONE,
  fmtDate,
  type DevApproval,
  type DevRun,
  type DevRunDetail,
} from "./types";

/* Developer Command Center — Phase A (owner-only; PM-orchestrated, owner-approved
 * 2026-08-19).
 *
 * This is NOT an automation console. It is an honest request-capture + audit +
 * approval portal. The owner captures a plain-English dev request; the actual
 * PR → QA → deploy loop happens externally on the existing workflow. This tab
 * records the intent (the run), a chronological step log, and the owner's
 * explicit merge-gate decision. No LLM / API keys / autonomous agents live here
 * (Phases B/C/D are deliberately not built). Renders only in the owner
 * workspace — App.tsx gates the nav item on isOwnerOrg, and the server's
 * /api/dev/* routes are requireAdmin, so tenants can never reach them. */

export default function Developer() {
  const [runs, setRuns] = useState<DevRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* New request form */
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [creating, setCreating] = useState(false);

  /* Expanded-run detail cache: id -> detail */
  const [details, setDetails] = useState<Record<number, DevRunDetail>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await api.devRuns();
      setRuns(res.runs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dev runs.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createRun() {
    if (!title.trim() || !request.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.createDevRun(title.trim(), request.trim());
      setTitle("");
      setRequest("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create the request.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleDetail(id: number) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!details[id]) {
      try {
        const d = await api.devRunDetail(id);
        setDetails((map) => ({ ...map, [id]: d }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load run detail.");
      }
    }
  }

  async function decide(id: number, action: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const note = notes[id] ?? "";
      const res =
        action === "approve"
          ? await api.devRunApprove(id, note)
          : await api.devRunReject(id, note);
      setDetails((map) => ({
        ...map,
        [id]: { ...(map[id] ?? { run: res.run, steps: [], approvals: [] }), run: res.run },
      }));
      setNotes((n) => ({ ...n, [id]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  async function advance(id: number, status: "awaiting_approval" | "merged") {
    setBusy(id);
    setError(null);
    try {
      const res = await api.devRunStatus(id, status);
      setDetails((map) => ({
        ...map,
        [id]: { ...(map[id] ?? { run: res.run, steps: [], approvals: [] }), run: res.run },
      }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed.");
    } finally {
      setBusy(null);
    }
  }

  const detail = expanded ? details[expanded] : undefined;
  const approvals = detail?.approvals ?? [];
  const mergeApproval = approvals.find((a) => a.gate === "merge");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Developer <em className="serif">command center</em>
          </h1>
          <p className="page-sub">
            Capture a development request, record its step log, and grant the explicit
            owner approval required before any merge or production change. The team runs
            the actual build / QA / deploy on the existing workflow — this tab records the
            intent and the approval gate. Owner workspace only.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* New request form */}
      <div className="card admin-form">
        <div className="admin-card-head">
          <h2 className="admin-card-title">New development request</h2>
          <p className="admin-card-sub">
            Describe the change in plain English. This creates an audit record; the team
            turns it into a branch, PR, QA run and deploy through the normal workflow.
          </p>
        </div>
        <div className="form">
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="dev-input dev-input-text"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Add CSV export for the Clients tab"
            />
          </label>
          <label className="field">
            <span className="field-label">Request</span>
            <textarea
              className="dev-input dev-input-textarea"
              rows={5}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Describe what you want built or changed, and why…"
            />
          </label>
          <button
            className="btn btn-primary"
            type="button"
            disabled={creating || !title.trim() || !request.trim()}
            onClick={createRun}
          >
            {creating ? "Capturing…" : "Capture request"}
          </button>
        </div>
      </div>

      {/* Runs list */}
      <div className="card admin-form">
        <div className="admin-card-head">
          <h2 className="admin-card-title">Requests</h2>
          <p className="admin-card-sub">
            {loaded ? `${runs.length} request${runs.length === 1 ? "" : "s"} recorded` : "Loading…"}
          </p>
        </div>

        {loaded && runs.length === 0 && (
          <p className="page-sub" style={{ padding: "8px 0" }}>
            No development requests recorded yet.
          </p>
        )}

        {runs.map((r) => {
          const tone = DEV_STATUS_TONE[r.status] ?? "gray";
          const open = expanded === r.id;
          const d = open ? details[r.id] : undefined;
          return (
            <div key={r.id} className="dev-run">
              <button
                className="dev-run-head"
                type="button"
                onClick={() => toggleDetail(r.id)}
                aria-expanded={open}
              >
                <span className="dev-run-title">{r.title}</span>
                <span className={`badge tone-${tone}`}>{DEV_STATUS_LABEL[r.status] ?? r.status}</span>
              </button>
              {open && d && (
                <div className="dev-run-body">
                  <p className="page-sub">{r.request}</p>

                  {/* Approval gate */}
                  <div className="dev-gate">
                    {mergeApproval && mergeApproval.status === "approved" ? (
                      <div className="alert alert-success" role="status">
                        Merge gate <strong>approved</strong> by {mergeApproval.decidedBy}
                        {mergeApproval.note ? ` — ${mergeApproval.note}` : ""}.
                      </div>
                    ) : mergeApproval && mergeApproval.status === "rejected" ? (
                      <div className="alert alert-error" role="alert">
                        Merge gate <strong>rejected</strong> by {mergeApproval.decidedBy}
                        {mergeApproval.note ? ` — ${mergeApproval.note}` : ""}.
                      </div>
                    ) : (
                      <div className="dev-gate-pending">
                        <div className="admin-card-title">Merge / production gate</div>
                        <p className="page-sub" style={{ margin: "4px 0 10px" }}>
                          No merge or production change should ship from this request until you
                          approve the gate below.
                        </p>
                        <div className="dev-actions">
                          <input
                            className="dev-input dev-note"
                            type="text"
                            placeholder="Optional note…"
                            value={notes[r.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          />
                          <button
                            className="btn btn-primary"
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => decide(r.id, "approve")}
                          >
                            Approve &amp; allow merge
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => decide(r.id, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                    {/* Lifecycle actions (awaiting approval / merged) */}
                    {(r.status === "captured" || r.status === "awaiting_approval") && (
                      <div className="dev-actions" style={{ marginTop: 8 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => advance(r.id, "awaiting_approval")}
                        >
                          Mark awaiting approval
                        </button>
                      </div>
                    )}
                    {(r.status === "approved" || r.status === "merged") && (
                      <div className="dev-actions" style={{ marginTop: 8 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => advance(r.id, "merged")}
                        >
                          Mark merged (after team confirms)
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Steps timeline */}
                  <div className="dev-steps">
                    <div className="admin-card-title" style={{ margin: "12px 0 6px" }}>
                      Step log
                    </div>
                    {d.steps.length === 0 && <p className="page-sub">No steps recorded.</p>}
                    {d.steps.map((s) => (
                      <div key={s.id} className="dev-step">
                        <span className={`badge tone-${DEV_STATUS_TONE[s.kind as DevRun["status"]] ?? "gray"}`}>
                          {s.kind}
                        </span>
                        <span className="dev-step-detail">{s.detail}</span>
                        <span className="dev-step-meta">
                          {s.actor || "—"} · {fmtDate(s.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Approval history */}
                  {(approvals.length > 1 || (mergeApproval && mergeApproval.status !== "pending")) && (
                    <div className="dev-approvals">
                      <div className="admin-card-title" style={{ margin: "12px 0 6px" }}>
                        Approval history
                      </div>
                      {approvals.map((a: DevApproval) => (
                        <div key={a.id} className="dev-step">
                          <span className={`badge tone-${a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "amber"}`}>
                            {a.status}
                          </span>
                          <span className="dev-step-detail">
                            {a.gate} gate · requested by {a.requestedBy}
                            {a.decidedBy ? ` · decided by ${a.decidedBy}` : ""}
                            {a.note ? ` — ${a.note}` : ""}
                          </span>
                          <span className="dev-step-meta">{a.decidedAt ? fmtDate(a.decidedAt) : fmtDate(a.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
