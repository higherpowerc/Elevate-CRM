import { useEffect, useState } from "react";
import { api } from "./api";
import { stageTone, money, fmtDate, type DashboardData, type Invoice, type Stage } from "./types";
import { StageBadge, ServiceChips } from "./bits";
import { usePii, blurPii } from "./pii";
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
  /** Owner direction 2026-08-26 — the Dashboard "Lost" KPI card's "View →"
   *  deep-link. Hands control to App, which switches to the owner Leads view
   *  with its "Lost" filter active (the Lost listing). Owner-only; tenants
   *  never render the Lost card, so they never call this. */
  onGoToLost: () => void;
  /** The tenant's ordered pipeline stages (drives the breakdown grid + KPI). */
  stages: Stage[];
  /** Owner workspace (role=admin org) — owner direction 2026-08-14: the
   *  owner calls its pipeline records "leads", so this page's count, KPI
   *  labels, stage captions and empty state read "lead(s)" instead of
   *  "client(s)". Tenant orgs (role=member) keep "clients" everywhere.
   *  Purely presentational; data and stages are untouched. */
  ownerOrg?: boolean;
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

export default function Dashboard({ onGoToStage, onGoToLost, stages, ownerOrg = false }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Owner revenue summary (owner 2026-08-20) — the OWNER's dashboard
     surfaces real invoice-based revenue (the same figures the Finance tab
     shows for its Total invoiced / Paid / Outstanding / Overdue KPIs) so the
     owner can watch revenue without leaving the dashboard. Computed from the
     same /api/invoices source the Finance ledger uses — never fabricated.
     Owner-only; client accounts show nothing extra. A failed invoice fetch
     is non-fatal (the summary just stays hidden). */
  const [revenue, setRevenue] = useState<{
    invoiced: number;
    paid: number;
    outstanding: number;
    overdue: number;
  } | null>(null);

  /* Global privacy eye (2026-08-14 owner request): blur client/company names
     on this page too (task overview rows + Recently updated). The eye itself
     lives in the top nav (App.tsx); this just consumes its state. */
  const pii = usePii();

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

  /* Owner revenue summary — fetch the org's invoices (owner-only) and reduce
     them to the same four figures the Finance tab shows. Mirrors the totals
     computation in src/Finance.tsx so both stay in lockstep. */
  useEffect(() => {
    if (!ownerOrg) return;
    let alive = true;
    api
      .invoices()
      .then(({ invoices }) => {
        if (!alive) return;
        let invoiced = 0;
        let paid = 0;
        let outstanding = 0;
        let overdue = 0;
        for (const i of invoices) {
          invoiced += i.amount;
          if (i.status === "paid") paid += i.amount;
          if (i.status === "sent") {
            outstanding += i.amount;
            if (i.dueDate && i.dueDate < localToday()) overdue += i.amount;
          }
        }
        setRevenue({ invoiced, paid, outstanding, overdue });
      })
      .catch(() => {
        /* non-fatal — the revenue summary just stays hidden */
      });
    return () => {
      alive = false;
    };
  }, [ownerOrg]);

  /* Owner direction 2026-08-26 — the Dashboard Lost KPI card is read-only:
     it shows ONLY the lost count + a "View →" deep-link to the Lost listing
     (the owner Leads view, Lost filter). Restore / delete of a lost client
     happens on that Lost listing (the Clients segs / edit modal) — never in
     this card. Restore/delete here were removed by owner direction 2026-08-26
     so the card "looks just like the others". The server-side lostClients
     payload is unchanged (still org-scoped; tenants never receive it). */

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div className="skeleton-block" aria-label="Loading dashboard" />;

  const hasClients = data.totalClients > 0;
  const firstStage = stages.length > 0 ? stages[0] : "";
  const lastStage = stages.length > 0 ? stages[stages.length - 1] : "";
  /* Owner cockpit A (owner direction 2026-08-15) — the OWNER's "Active
     leads" KPI counts ONLY the FIRST stage (the Leads position): the owner's
     pipeline is a three-bucket split (Leads = first, Onboarding = middle,
     Clients = terminal), and the sales cockpit's "Active leads" means the
     prospects bucket, not every non-lost record. Positional + rename-safe.
     Client accounts (role=member) keep the original behavior: their "Active
     clients" is the sum of the (server-side) stageCounts — which already
     exclude lost + archived — rather than totalClients minus archived. */
  const activeClients = ownerOrg
    ? stages.length > 0
      ? (data.stageCounts[stages[0]] ?? 0)
      : 0
    : Object.values(data.stageCounts).reduce((sum, n) => sum + (n ?? 0), 0);
  /* Owner cockpit A (owner direction 2026-08-15) — the owner's "Onboarding"
     KPI watches the MIDDLE stage (the one between first and terminal — the
     intake bucket of the three-bucket pipeline) instead of the terminal
     stage. Positional + rename-safe; falls back to the last-stage KPI only
     when the pipeline has no middle bucket (< 3 stages). */
  const midStage = stages.length > 2 ? stages[1] : "";

  /* Owner workspace labels its pipeline records "leads" (owner direction
     2026-08-14); tenant orgs keep "clients". Same page, same data — only
     the visible wording differs. */
  const bookWord = ownerOrg ? "lead" : "client";
  const activeKpi = ownerOrg ? "Active leads" : "Active clients";
  /* Owner direction 2026-08-28 — the owner's pipeline money card is renamed
     "Lead Opportunities" and now equals the ACTIVE-leads deal-value sum: the
     exact Active-bin definition from the owner's Leads view (not lost, not
     archived, not 'maybe' — the server mirrors that predicate on the
     projectedPipeline field), so the note names active leads. Client
     accounts keep their "Projected pipeline" card + all-stage wording
     unchanged (owner direction: rename the OWNER card only). */
  const leadOppNote = "Total deal value of active leads · not revenue";
  const pipelineNote = "Sum of deal values · active clients only — not revenue";
  const lastStageNote = lastStage
    ? ownerOrg
      ? `Leads in "${lastStage}" — your last pipeline stage`
      : `Clients in "${lastStage}" — your last pipeline stage`
    : "No stages configured";
  /* Owner cockpit A — the "Onboarding" KPI note (owner workspace). */
  const onboardingNote = midStage
    ? `Leads in "${midStage}" — your onboarding pipeline`
    : "No middle stage configured";
  const stageCaption = ownerOrg ? "leads" : "clients";
  const emptyTitle = ownerOrg ? "No leads yet" : "No clients yet";
  const emptyCta = ownerOrg ? "Add a lead" : "Add a client";
  const moneyTitle = moneyHidden ? "Show amounts" : "Hide amounts";
  const blur = (on: boolean) => (on ? " money-blur" : "");

  /* Owner request 2026-08-14/15 — money KPI by workspace:
       OWNER  → "Client MRR" = SUM of the owner's own client records' deal
                values in the terminal/"Sold" stage (paying clients sold),
                excluding lost and archived records (owner direction
                2026-08-15 — the sales cockpit figure for selling the CRM).
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

  /* Owner direction 2026-08-15 (refined during live test) — the shared
     per-stage cards (count + View deep-link, positional/rename-safe) are now
     TENANT-ONLY: they feed the standalone "Stage breakdown" card that client
     accounts keep exactly as before. The OWNER no longer renders them at all
     — the six-card "Pipeline overview" KPI row (below) carries every
     pipeline figure the owner sees. */
  const stageCards = stages.map((stage, i) => (
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
  ));

  return (
    <div className="page page-stack">
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

      {/* Owner direction 2026-08-15 (refined again during live test) — the
          OWNER's Dashboard shows the pipeline exactly ONCE: a six-card KPI
          row (Lead Opportunities + Sold MRR money figures with the
          privacy-eye toggle, then the three bucket counts — Active leads with
          a Leads deep-link, Onboarding with an Onboarding deep-link, Sold,
          Lost). Owner direction 2026-08-28: the owner money card is renamed
          "Lead Opportunities" and shows the ACTIVE-leads deal-value sum
          (maybe leads excluded — they live in the Maybe bin).
          The old duplicate KPI cards, the five-row single card, and the
          per-stage grid are GONE — no pipeline figure appears twice anywhere
          on the owner's page. TENANT dashboards keep their KPI row (own money
          card, Projected pipeline, Active clients, In final stage) and their
          standalone "Stage breakdown" card exactly as before. */}
      {ownerOrg ? (
        <div className="kpi-row">
          <div className="card kpi">
            <span className="kpi-label kpi-label-row">
              Lead Opportunities
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
            <span className="kpi-note">{leadOppNote}</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label kpi-label-row">
              Sold MRR
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
            <span className="kpi-note">Monthly subscriptions of sold clients — records in your last pipeline stage</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">{activeKpi}</span>
            <span className="kpi-value">{activeClients}</span>
            <span className="kpi-note">Non-archived, non-lost leads in your first stage</span>
            {firstStage && (
              <button
                className="link-btn"
                onClick={() => onGoToStage(firstStage)}
                aria-label={`View ${firstStage} in the pipeline`}
              >
                View →
              </button>
            )}
          </div>
          <div className="card kpi">
            <span className="kpi-label">Onboarding</span>
            <span className="kpi-value">{midStage ? data.stageCounts[midStage] ?? 0 : 0}</span>
            <span className="kpi-note">{onboardingNote}</span>
            {midStage && (
              <button
                className="link-btn"
                onClick={() => onGoToStage(midStage)}
                aria-label={`View ${midStage} in the Onboarding pipeline`}
              >
                View →
              </button>
            )}
          </div>
          <div className="card kpi">
            <span className="kpi-label">Sold</span>
            <span className="kpi-value">{lastStage ? data.stageCounts[lastStage] ?? 0 : 0}</span>
            <span className="kpi-note">{lastStageNote}</span>
            {lastStage && (
              <button
                className="link-btn"
                onClick={() => onGoToStage(lastStage)}
                aria-label={`View ${lastStage} in the clients view`}
              >
                View →
              </button>
            )}
          </div>
          {/* Owner direction 2026-08-26 — the "Lost" window became a KPI card
              in this row, placed immediately after Sold (owner asked it "look
              just like the others" and sit next to Sold). It renders exactly
              like the sibling count cards: kpi-label "Lost", the lost count
              as the kpi-value, a note, and a "View →" link that opens the
              Lost listing (owner Leads view, Lost filter). No inline list, no
              Restore/Delete here — restore/delete live on the Lost listing.
              Owner-only — tenants never render it, and lostClients is
              org-scoped server-side. */}
          <div className="card kpi">
            <span className="kpi-label">Lost</span>
            <span className="kpi-value">{(data.lostClients ?? []).length}</span>
            <span className="kpi-note">kept on record · restorable</span>
            <button
              className="link-btn"
              onClick={onGoToLost}
              aria-label="View lost leads"
            >
              View →
            </button>
          </div>
        </div>
      ) : (
        <div className="kpi-row">
          {/* Workspace money KPI: members see their own business's money per
              their revenue model. Both respect the privacy eye. */}
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
      )}

      {/* Owner direction 2026-08-15 (refined during live test) — the OWNER
          renders no standalone stage grid: the six-card KPI row above
          carries every pipeline figure (it replaces the per-stage cards).
          TENANT dashboards keep the standalone "Stage breakdown" card
          exactly as before (same heading, same grid). */}
      {ownerOrg ? null : (
        <>
          <h2 className="section-title">Stage breakdown</h2>
          <div className="stage-grid">{stageCards}</div>
        </>
      )}

      {/* Owner revenue summary (owner 2026-08-20) — real invoice-based
          revenue figures on the owner dashboard, mirroring the Finance tab
          KPIs (Total billed / Paid / Outstanding / Overdue). Computed from
          /api/invoices. Owner-only; client accounts render nothing here. */}
      {ownerOrg && revenue && (
        <section aria-label="Revenue summary">
          <h2 className="section-title">Revenue</h2>
          <div className="kpi-row kpi-row-4">
            <div className="card kpi">
              <span className="kpi-label">Total billed</span>
              <span className={`kpi-value lime${blur(moneyHidden)}`}>{money(revenue.invoiced)}</span>
              <span className="kpi-note">All invoices — draft + sent + paid</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Paid</span>
              <span className={`kpi-value green${blur(moneyHidden)}`}>{money(revenue.paid)}</span>
              <span className="kpi-note">Marked paid — money in</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Outstanding</span>
              <span className={`kpi-value${blur(moneyHidden)}`}>{money(revenue.outstanding)}</span>
              <span className="kpi-note">Sent, not yet paid</span>
            </div>
            <div className="card kpi">
              <span className="kpi-label">Overdue</span>
              <span className={`kpi-value red${blur(moneyHidden)}`}>{money(revenue.overdue)}</span>
              <span className="kpi-note">Sent, past due date</span>
            </div>
          </div>
        </section>
      )}

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
                    <span className={`task-upcoming-title${blurPii(pii)}`} title={t.title}>
                      {t.title}
                    </span>
                    {t.clientName && <span className={`chip${blurPii(pii)}`}>{t.clientName}</span>}
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
                    <span className={`cell-name${blurPii(pii)}`} title={c.companyName}>
                      {c.companyName}
                    </span>
                  </td>
                  <td className="cell-muted">
                    <span className={`cell-name${blurPii(pii)}`} title={c.contactName || undefined}>
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
