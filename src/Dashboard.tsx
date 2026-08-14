import { useEffect, useState } from "react";
import { api } from "./api";
import { stageTone, money, fmtDate, type DashboardData, type Stage } from "./types";
import { StageBadge, ServiceChips } from "./bits";
import ProvisionNotices from "./ProvisionNotices";

interface Props {
  onGoToClients: () => void;
  /** The tenant's ordered pipeline stages (drives the breakdown grid + KPI). */
  stages: Stage[];
  /** Owner workspace (role=admin org) — owner direction 2026-08-14: the
   *  owner calls its pipeline records "leads", so this page's count, KPI
   *  labels, stage captions and empty state read "lead(s)" instead of
   *  "client(s)". Tenant orgs (role=member) keep "clients" everywhere.
   *  Purely presentational; data and stages are untouched. */
  ownerOrg?: boolean;
}

export default function Dashboard({ onGoToClients, stages, ownerOrg = false }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard."));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="skeleton-block" aria-label="Loading dashboard" />;

  const hasClients = data.totalClients > 0;
  const lastStage = stages.length > 0 ? stages[stages.length - 1] : "";

  /* Owner workspace labels its pipeline records "leads" (owner direction
     2026-08-14); tenant orgs keep "clients". Same page, same data — only
     the visible wording differs. */
  const bookWord = ownerOrg ? "lead" : "client";
  const activeKpi = ownerOrg ? "Active leads" : "Active clients";
  const pipelineNote = ownerOrg
    ? "Sum of deal values · active leads only — not revenue"
    : "Sum of deal values · active clients only — not revenue";
  const lastStageNote = lastStage
    ? ownerOrg
      ? `Leads in "${lastStage}" — your last pipeline stage`
      : `Clients in "${lastStage}" — your last pipeline stage`
    : "No stages configured";
  const stageCaption = ownerOrg ? "leads" : "clients";
  const emptyTitle = ownerOrg ? "No leads yet" : "No clients yet";
  const emptyCta = ownerOrg ? "Add a lead" : "Add a client";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Pipeline <em className="serif">overview</em>
          </h1>
          <p className="page-sub">
            {data.totalClients} {bookWord}{data.totalClients === 1 ? "" : "s"} in the book
            {data.archivedClients > 0 && ` · ${data.archivedClients} archived`}
          </p>
        </div>
      </div>

      {/* 3g-3 — owner-only: sold-lead auto-provisioning notices (dismissed on
          view; the Admin tab carries the full credentials). */}
      {ownerOrg && <ProvisionNotices />}

      <div className="kpi-row">
        <div className="card kpi">
          <span className="kpi-label">Projected pipeline</span>
          <span className="kpi-value lime">{money(data.projectedPipeline)}</span>
          <span className="kpi-note">{pipelineNote}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{activeKpi}</span>
          <span className="kpi-value">{data.totalClients - data.archivedClients}</span>
          <span className="kpi-note">Non-archived entries across all stages</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">In final stage</span>
          <span className="kpi-value">{lastStage ? data.stageCounts[lastStage] ?? 0 : 0}</span>
          <span className="kpi-note">{lastStageNote}</span>
        </div>
      </div>

      <h2 className="section-title">Stage breakdown</h2>
      <div className="stage-grid">
        {stages.map((stage, i) => (
          <div className="card stage-card" key={`${i}-${stage}`}>
            <div className="stage-top">
              <StageBadge stage={stage} index={i} />
              <span className="stage-num">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className={`stage-count tone-${stageTone(i)}`}>{data.stageCounts[stage] ?? 0}</div>
            <div className="stage-rule" />
            <div className="stage-bottom">
              <span className="stage-caption">{stageCaption}</span>
              <button className="link-btn" onClick={onGoToClients}>
                View →
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-title">Recently updated</h2>
      {hasClients ? (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Services</th>
                <th className="num">Deal</th>
                <th>Stage</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.recentClients.map((c) => (
                <tr key={c.id}>
                  <td className="cell-strong">{c.companyName}</td>
                  <td className="cell-muted">{c.contactName || "—"}</td>
                  <td>
                    <ServiceChips services={c.services} />
                  </td>
                  <td className="num cell-strong">{money(c.dealValue)}</td>
                  <td>
                    <StageBadge stage={c.stage} index={Math.max(0, stages.indexOf(c.stage))} />
                  </td>
                  <td className="cell-muted">{fmtDate(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty">
          <p className="empty-title">{emptyTitle}</p>
          <p className="empty-sub">Add your first prospect and the pipeline starts filling in.</p>
          <button className="btn btn-primary" onClick={onGoToClients}>
            {emptyCta}
          </button>
        </div>
      )}
    </div>
  );
}
