import { useEffect, useState } from "react";
import { api } from "./api";
import { stageTone, money, fmtDate, type DashboardData, type Stage } from "./types";
import { StageBadge, ServiceChips } from "./bits";
import ProvisionNotices from "./ProvisionNotices";

interface Props {
  /** Owner request 2026-08-14/15 — the Dashboard's stage cards deep-link into
   *  the pipeline. The callback hands the stage NAME to App, which routes it
   *  positionally (owner request 2026-08-15): first stage → Leads tab,
   *  middle stage → Onboarding tab (owner) / Leads tab (tenant), terminal
   *  stage → Clients directory tab. Each pipeline view opens with that
   *  stage's chip pre-selected; the empty-state CTA (no stage) opens the
   *  owner's Leads on "All". */
  onGoToStage: (stage?: string) => void;
  /** The tenant's ordered pipeline stages (drives the breakdown grid + KPI). */
  stages: Stage[];
  /** Owner workspace (role=admin org) — owner direction 2026-08-14: the
   *  owner calls its pipeline records "leads", so this page's count, KPI
   *  labels, stage captions and empty state read "lead(s)" instead of
   *  "client(s)". Tenant orgs (role=member) keep "clients" everywhere.
   *  Purely presentational; data and stages are untouched. */
  ownerOrg?: boolean;
  /** Owner request 2026-08-14 — the "+ New client" affordance on the owner
   *  dashboard provisions a client ACCOUNT (the owner's Clients = the orgs
   *  paying for the CRM), so the button routes to the Admin tab. The client
   *  account count renders underneath it. */
  onNewClient?: () => void;
}

/** Local YYYY-MM-DD — the same convention the task date inputs store
 *  (Tasks.tsx localToday), so overdue/due-soon comparisons stay consistent
 *  between the dashboard and the Task board. */
function localToday(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return localToday(new Date(y, m - 1, d + days));
}

/** Due tone + label for an upcoming task row (mirrors Tasks.tsx dueTone). */
function dueInfo(dueDate: string): { tone: "" | "overdue" | "today" | "soon"; label: string } {
  if (!dueDate) return { tone: "", label: "" };
  const today = localToday();
  const soon = addDaysKey(today, 7);
  if (dueDate < today) return { tone: "overdue", label: `Overdue · ${fmtDate(dueDate)}` };
  if (dueDate === today) return { tone: "today", label: `Due today · ${fmtDate(dueDate)}` };
  if (dueDate <= soon) return { tone: "soon", label: `Due ${fmtDate(dueDate)}` };
  return { tone: "", label: `Due ${fmtDate(dueDate)}` };
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function Dashboard({ onGoToStage, stages, ownerOrg = false, onNewClient }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Privacy eye (2026-08-14 owner request): blur/hide every money figure on
     the dashboard (the projected-pipeline KPI and the Deal column of Recently
     updated) until toggled. Default visible; the choice persists per browser
     via localStorage. */
  const MONEY_HIDDEN_KEY = "crm:money-hidden";
  const [moneyHidden, setMoneyHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MONEY_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(MONEY_HIDDEN_KEY, moneyHidden ? "1" : "0");
    } catch {
      /* storage unavailable (private mode) — the toggle just won't persist */
    }
  }, [moneyHidden]);

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
  /* Owner request 2026-08-14 — lost leads are excluded from every pipeline
     KPI. The "Active" count is the sum of the (server-side) stageCounts —
     which already exclude lost + archived — rather than totalClients minus
     archived (totalClients stays the "in the book" record count). */
  const activeClients = Object.values(data.stageCounts).reduce((sum, n) => sum + (n ?? 0), 0);

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
  const moneyTitle = moneyHidden ? "Show amounts" : "Hide amounts";
  const blur = (on: boolean) => (on ? " money-blur" : "");

  /* Owner request 2026-08-14 — money KPI by workspace:
       OWNER  → "Client MRR" = SUM of what every client account pays per month
                (the sales cockpit figure for selling the CRM).
       MEMBER → their OWN business's money: "Sales this month" (invoices dated
                this calendar month) or "Subscriptions" (their clients'
                recurring monthly amounts), per the org's revenue model. */
  const isSubscription = data.revenueModel === "subscription";
  const moneyKpiLabel = isSubscription ? "Subscriptions" : "Sales this month";
  const moneyKpiValue = isSubscription ? data.subscriptionsTotal : data.salesThisMonth;
  const moneyKpiNote = isSubscription
    ? data.subscriptionsTotal === 0
      ? "No subscriptions yet — set a monthly amount per client"
      : "Sum of your clients' monthly recurring amounts"
    : data.salesThisMonth === 0
      ? "No invoices this month yet"
      : "Invoices dated this month";

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
        {/* Owner request 2026-08-14 — the owner's dashboard carries the
            "+ New client" affordance (provision a client ACCOUNT → Admin tab)
            with the client-account count underneath. */}
        {ownerOrg && (
          <div className="page-actions page-actions-col">
            {onNewClient && (
              <button className="btn btn-primary" onClick={onNewClient}>
                + New client
              </button>
            )}
            <span className="page-actions-sub">
              {data.orgCount ?? 0} client account{(data.orgCount ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>

      {/* 3g-3 — owner-only: sold-lead auto-provisioning notices (dismissed on
          view; the Admin tab carries the full credentials). */}
      {ownerOrg && <ProvisionNotices />}

      <div className="kpi-row">
        {/* Owner request 2026-08-14 — workspace money KPI: owner sees Client
            MRR (across every client account); members see their own business's
            money per their revenue model. Both respect the privacy eye. */}
        {ownerOrg ? (
          <div className="card kpi">
            <span className="kpi-label kpi-label-row">
              Client MRR
              <button
                type="button"
                className="eye-btn"
                onClick={() => setMoneyHidden((v) => !v)}
                aria-label={moneyTitle}
                aria-pressed={moneyHidden}
                title={moneyTitle}
              >
                {moneyHidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </span>
            <span className={`kpi-value lime${blur(moneyHidden)}`}>{money(data.clientMrr ?? 0)}</span>
            <span className="kpi-note">Monthly subscription revenue from all client accounts</span>
          </div>
        ) : (
          <div className="card kpi">
            <span className="kpi-label kpi-label-row">
              {moneyKpiLabel}
              <button
                type="button"
                className="eye-btn"
                onClick={() => setMoneyHidden((v) => !v)}
                aria-label={moneyTitle}
                aria-pressed={moneyHidden}
                title={moneyTitle}
              >
                {moneyHidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </span>
            <span className={`kpi-value lime${blur(moneyHidden)}`}>{money(moneyKpiValue)}</span>
            <span className="kpi-note">{moneyKpiNote}</span>
          </div>
        )}
        <div className="card kpi">
          <span className="kpi-label kpi-label-row">
            Projected pipeline
            <button
              type="button"
              className="eye-btn"
              onClick={() => setMoneyHidden((v) => !v)}
              aria-label={moneyTitle}
              aria-pressed={moneyHidden}
              title={moneyTitle}
            >
              {moneyHidden ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
          <span className={`kpi-value lime${blur(moneyHidden)}`}>{money(data.projectedPipeline)}</span>
          <span className="kpi-note">{pipelineNote}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">{activeKpi}</span>
          <span className="kpi-value">{activeClients}</span>
          <span className="kpi-note">Non-archived, non-lost entries across all stages</span>
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
              <button
                className="link-btn"
                onClick={() => onGoToStage(stage)}
                aria-label={`View ${stage} in the pipeline`}
              >
                View →
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Task overview (2026-08-14 owner request) — org-scoped task stats
          plus the next few open tasks with a due date. Compact so the page
          still fits the no-scroll layout; wording is task-centric (the same
          for owner and tenant orgs). */}
      <h2 className="section-title">Task overview</h2>
      <div className="card task-overview">
        <div className="task-stats">
          <div className="task-stat">
            <span className="task-stat-num">{data.tasks.open}</span>
            <span className="task-stat-label">Open</span>
          </div>
          <div className="task-stat">
            <span className={`task-stat-num${data.tasks.overdue > 0 ? " danger" : ""}`}>{data.tasks.overdue}</span>
            <span className="task-stat-label">Overdue</span>
          </div>
          <div className="task-stat">
            <span className="task-stat-num">{data.tasks.dueSoon}</span>
            <span className="task-stat-label">Due soon</span>
          </div>
          <div className="task-stat">
            <span className="task-stat-num muted">{data.tasks.done}</span>
            <span className="task-stat-label">Done</span>
          </div>
        </div>
        <div className="task-overview-rule" />
        <div className="task-upcoming">
          <span className="task-upcoming-label">Upcoming</span>
          {data.tasks.upcoming.length > 0 ? (
            <ul className="task-upcoming-list">
              {data.tasks.upcoming.map((t) => {
                const due = dueInfo(t.dueDate);
                return (
                  <li className="task-upcoming-item" key={t.id}>
                    <span className="task-upcoming-title" title={t.title}>
                      {t.title}
                    </span>
                    {t.clientName && <span className="chip">{t.clientName}</span>}
                    <span className={`task-upcoming-due${due.tone ? ` ${due.tone}` : ""}`}>{due.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="task-upcoming-empty">
              {data.tasks.open === 0 && data.tasks.done === 0
                ? "No tasks yet — add one from the Tasks tab."
                : "Nothing due — you're all set."}
            </span>
          )}
        </div>
      </div>

      <h2 className="section-title">Recently updated</h2>
      {hasClients ? (
        <div className="card table-wrap">
          <table className="table">
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "17%" }} />
            </colgroup>
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
                  <td className="cell-strong">
                    <span className="cell-name" title={c.companyName}>
                      {c.companyName}
                    </span>
                  </td>
                  <td className="cell-muted">
                    <span className="cell-name" title={c.contactName || undefined}>
                      {c.contactName || "—"}
                    </span>
                  </td>
                  <td>
                    <ServiceChips services={c.services} />
                  </td>
                  <td className="num cell-strong">
                    <span className={blur(moneyHidden)}>{money(c.dealValue)}</span>
                  </td>
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
          <button className="btn btn-primary" onClick={() => onGoToStage()}>
            {emptyCta}
          </button>
        </div>
      )}
    </div>
  );
}
