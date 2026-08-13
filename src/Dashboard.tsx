import { useEffect, useState } from "react";
import { api } from "./api";
import { stageTone, money, fmtDate, type DashboardData, type Stage } from "./types";
import { StageBadge, ServiceChips } from "./bits";

interface Props {
  onGoToClients: () => void;
  /** The tenant's ordered pipeline stages (drives the breakdown grid + KPI). */
  stages: Stage[];
}

export default function Dashboard({ onGoToClients, stages }: Props) {
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Pipeline <em className="serif">overview</em>
          </h1>
          <p className="page-sub">
            {data.totalClients} client{data.totalClients === 1 ? "" : "s"} in the book
            {data.archivedClients > 0 && ` · ${data.archivedClients} archived`}
          </p>
        </div>
      </div>

      <div className="kpi-row">
        <div className="card kpi">
          <span className="kpi-label">Projected pipeline</span>
          <span className="kpi-value lime">{money(data.projectedPipeline)}</span>
          <span className="kpi-note">Sum of deal values · active clients only — not revenue</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Active clients</span>
          <span className="kpi-value">{data.totalClients - data.archivedClients}</span>
          <span className="kpi-note">Non-archived entries across all stages</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">In final stage</span>
          <span className="kpi-value">{lastStage ? data.stageCounts[lastStage] ?? 0 : 0}</span>
          <span className="kpi-note">
            {lastStage ? `Clients in "${lastStage}" — your last pipeline stage` : "No stages configured"}
          </span>
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
              <span className="stage-caption">clients</span>
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
          <p className="empty-title">No clients yet</p>
          <p className="empty-sub">Add your first prospect and the pipeline starts filling in.</p>
          <button className="btn btn-primary" onClick={onGoToClients}>
            Add a client
          </button>
        </div>
      )}
    </div>
  );
}
