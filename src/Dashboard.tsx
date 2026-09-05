import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { api } from "./api";
import { stageTone, money, fmtDate, type Buyer, type Client, type DashboardData, type Invoice, type Stage, type Transaction } from "./types";
import { StageBadge, ServiceChips } from "./bits";
import { usePii, blurPii } from "./pii";
import ProvisionNotices from "./ProvisionNotices";
import { getMatchesByProperty, getPropertyPrice, getCustomField } from "./buyBoxUtils";

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
  /** Navigate to Buy Box Matcher tab */
  onGoToBuyBox?: () => void;
  /** Navigate to Cash Buyers directory tab */
  onGoToBuyers?: () => void;
  /** Navigate to Transactions & Escrow Hub */
  onGoToTransactions?: () => void;
  /** The tenant's ordered pipeline stages (drives the breakdown grid + KPI). */
  stages: Stage[];
  /** Owner workspace (role=admin org) — owner direction 2026-08-14: the
   *  owner calls its pipeline records "leads", so this page's count, KPI
   *  labels, stage captions and empty state read "lead(s)" instead of
   *  "client(s)". Tenant orgs (role=member) keep "clients" everywhere.
   *  Purely presentational; data and stages are untouched. */
  ownerOrg?: boolean;
  /** Wholesale CRM workspace — terminology shifts to properties */
  isWholesale?: boolean;
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

const REVENUE_COLORS_KEY = "crm:revenue-card-colors";
const DEFAULT_REVENUE_COLORS = {
  totalBilled: "#171a1f",
  paid: "#13251a",
  outstanding: "#201d14",
  overdue: "#291719",
};

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

export default function Dashboard({
  onGoToStage,
  onGoToLost,
  onGoToBuyBox,
  onGoToBuyers,
  onGoToTransactions,
  stages,
  ownerOrg = false,
  isWholesale = false,
}: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);

  useEffect(() => {
    if (!isWholesale) return;
    api.clients().then((res) => setAllClients(res.clients)).catch(() => {});
    api.transactions().then((res) => setTransactions(res.transactions || [])).catch(() => {});
    api.buyers().then((res) => setBuyers(res.buyers || [])).catch(() => {});
  }, [isWholesale]);

  const activeTransactions = useMemo(() => {
    return transactions.filter((t) => t.status === "under_contract" || t.status === "sent" || t.status === "signed");
  }, [transactions]);

  const totalEscrowFees = useMemo(() => {
    return activeTransactions.reduce((sum, t) => sum + (Number(t.assignmentFee) || 0), 0);
  }, [activeTransactions]);

  const webhookLeadsCount = useMemo(() => {
    return allClients.filter((c) => (c.leadSource || "").toLowerCase().includes("webhook")).length;
  }, [allClients]);

  const buyBoxMatches = useMemo(() => {
    if (!isWholesale || allClients.length === 0) return [];
    const props = allClients.filter(
      (c) => !c.archived && !c.lost && c.clientType !== "buyer" && c.stage !== "Buyer",
    );
    const buyrs = allClients.filter(
      (c) => !c.archived && !c.lost && (c.clientType === "buyer" || c.stage === "Buyer"),
    );
    return getMatchesByProperty(props, buyrs);
  }, [isWholesale, allClients]);

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
  const [revenueCardColors, setRevenueCardColors] = useState(DEFAULT_REVENUE_COLORS);

  /* Global privacy eye (2026-08-14 owner request): blur client/company names
     on this page too (task overview rows + Recently updated). The eye itself
     lives in the top nav (App.tsx); this just consumes its state. */
  const pii = usePii();

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(REVENUE_COLORS_KEY) ?? "null");
      if (stored && typeof stored === "object") setRevenueCardColors((colors) => ({ ...colors, ...stored }));
    } catch {
      /* use defaults when browser storage is unavailable */
    }
  }, []);

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
  const isPropView = isWholesale || !ownerOrg;
  const bookWord = ownerOrg ? "lead" : isPropView ? "propertie" : "client";
  const activeKpi = ownerOrg ? "Active leads" : "Properties";
  /* Owner direction 2026-08-28 — the owner's pipeline money card is renamed
     "Lead Opportunities" and now equals the ACTIVE-leads deal-value sum: the
     exact Active-bin definition from the owner's Leads view (not lost, not
     archived, not 'maybe' — the server mirrors that predicate on the
     projectedPipeline field), so the note names active leads. Client
     accounts keep their "Projected pipeline" card + all-stage wording
     unchanged (owner direction: rename the OWNER card only). */
  const leadOppNote = "Total deal value of active leads · not revenue";
  const pipelineNote = isWholesale
    ? "All assignment fees that have not been sold · active pipeline"
    : isPropView
      ? "Sum of deal values · active properties only — not revenue"
      : "Sum of deal values · active clients only — not revenue";
  const lastStageNote = lastStage
    ? ownerOrg
      ? `Leads in "${lastStage}" — your last pipeline stage`
      : isPropView
        ? `Properties in "${lastStage}" — your last pipeline stage`
        : `Clients in "${lastStage}" — your last pipeline stage`
    : "No stages configured";
  /* Owner cockpit A — the "Onboarding" KPI note (owner workspace). */
  const onboardingNote = midStage
    ? `Leads in "${midStage}" — your onboarding pipeline`
    : "No middle stage configured";
  const stageCaption = ownerOrg ? "leads" : isPropView ? "properties" : "clients";
  const emptyTitle = ownerOrg ? "No leads yet" : isPropView ? "No properties yet" : "No clients yet";
  const emptyCta = ownerOrg ? "Add a lead" : isPropView ? "Add a property" : "Add a client";
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
  const moneyKpiLabel = isPropView
    ? "Sold (Assignment Fees)"
    : isSubscription
      ? "Subscriptions"
      : "Sales this month";
  const moneyKpiValue = isPropView
    ? (data.soldAssignmentFees ?? 0)
    : isSubscription
      ? data.subscriptionsTotal
      : data.salesThisMonth;
  const moneyKpiNote = isPropView
    ? "Total assignment fees from properties marked Sold in stages"
    : isSubscription
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
    <div className="page page-stack dashboard">
      <div className="page-head">
        <div>
          <h1>
            Pipeline <em className="serif">overview</em>
          </h1>
          <p className="page-sub">
            {data.totalClients} {isPropView ? (data.totalClients === 1 ? "property" : "properties") : `${bookWord}${data.totalClients === 1 ? "" : "s"}`} in the book
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
              {isWholesale ? "Projected Assignment fees" : "Projected pipeline"}
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
            <span className={`kpi-value lime${blur(moneyHidden)}`}>
              {money(isWholesale && data.projectedAssignmentFees !== undefined ? data.projectedAssignmentFees : data.projectedPipeline)}
            </span>
            <span className="kpi-note">{pipelineNote}</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">{activeKpi}</span>
            <span className="kpi-value">{activeClients}</span>
            <span className="kpi-note">{isPropView ? "Non-archived properties across all stages" : "Non-archived, non-lost entries across all stages"}</span>
          </div>
          <div className="card kpi">
            <span className="kpi-label">{isPropView ? "Sold Properties" : "In final stage"}</span>
            <span className="kpi-value">{lastStage ? data.stageCounts[lastStage] ?? 0 : 0}</span>
            <span className="kpi-note">{lastStageNote}</span>
          </div>
        </div>
      )}

      {/* Wholesale Operations Pulse Strip */}
      {isWholesale && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "12px",
            marginTop: "16px",
            marginBottom: "20px",
          }}
        >
          <div
            className="card"
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "rgba(214, 255, 63, 0.12)",
              color: "var(--primary, #d6ff3f)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              flexShrink: 0,
            }}>
              ⚡
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--muted, #94a3b8)", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.04em" }}>
                Lead Ingestion
              </div>
              <div style={{ fontSize: "15px", fontWeight: 700 }}>
                {webhookLeadsCount > 0 ? `${webhookLeadsCount} Webhook Leads` : "Webhooks Active"}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted, #94a3b8)" }}>
                PropStream & BatchLeads connected
              </div>
            </div>
          </div>

          <div
            className="card"
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: onGoToBuyers ? "pointer" : "default",
            }}
            onClick={onGoToBuyers}
          >
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "rgba(56, 189, 248, 0.12)",
              color: "#38bdf8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              flexShrink: 0,
            }}>
              👥
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--muted, #94a3b8)", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.04em" }}>
                Cash Buyer Network
              </div>
              <div style={{ fontSize: "15px", fontWeight: 700 }}>
                {buyers.length} Vetted Buyers
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted, #94a3b8)" }}>
                Active in your dispo directory
              </div>
            </div>
          </div>

          <div
            className="card"
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              cursor: onGoToTransactions ? "pointer" : "default",
            }}
            onClick={onGoToTransactions}
          >
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "rgba(16, 185, 129, 0.12)",
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              flexShrink: 0,
            }}>
              💼
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--muted, #94a3b8)", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.04em" }}>
                Title & Escrow
              </div>
              <div style={{ fontSize: "15px", fontWeight: 700 }}>
                {activeTransactions.length > 0 ? `${activeTransactions.length} Deals in Escrow` : "0 in Escrow"}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted, #94a3b8)" }}>
                {activeTransactions.length > 0 ? `${money(totalEscrowFees)} fees pending` : "Contracts & Title Portal"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wholesale Deal Clocks & Escrow Radar */}
      {isWholesale && activeTransactions.length > 0 && (
        <section aria-label="Escrow Radar" style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <h2 className="section-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>⏱️ Deal Clocks & Escrow Radar</span>
                <span className="badge tone-amber" style={{ fontSize: "0.78rem" }}>
                  {activeTransactions.length} in Escrow ({money(totalEscrowFees)} fees)
                </span>
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: "0.85rem", color: "var(--muted, #94a3b8)" }}>
                Active transactions under contract with inspection contingency countdowns & title milestones
              </p>
            </div>
            {onGoToTransactions && (
              <button type="button" className="btn btn-ghost" onClick={onGoToTransactions} style={{ fontSize: "0.82rem" }}>
                Open Transaction Hub →
              </button>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
            {activeTransactions.slice(0, 3).map((tx) => {
              const urgencyTone = tx.inspectionUrgency === "urgent" ? "tone-red" : tx.inspectionUrgency === "warning" ? "tone-amber" : "tone-lime";
              const titleMilestoneLabel = tx.titleStatus === "clear_to_close" ? "Clear to Close ✓" : tx.titleStatus === "payoff_ordered" ? "Payoff Ordered" : tx.titleStatus === "prelim_review" ? "Prelim Review" : "In Escrow";

              return (
                <div
                  key={tx.id}
                  className="card"
                  style={{
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "12px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                      <span className="badge" style={{ fontSize: "0.72rem", textTransform: "uppercase" }}>
                        {tx.contractType.toUpperCase()}
                      </span>
                      <span className={`badge ${urgencyTone}`} style={{ fontWeight: 700, fontSize: "0.75rem" }}>
                        {tx.daysLeftInspection != null ? (
                          tx.daysLeftInspection > 0 ? `⏱️ ${tx.daysLeftInspection}d left` : "Inspection Expired"
                        ) : "Active Contingency"}
                      </span>
                    </div>

                    <h3 className={`cell-strong ${blurPii(pii)}`} style={{ margin: "4px 0", fontSize: "0.95rem", fontWeight: 700 }}>
                      {tx.propertyAddress}
                    </h3>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--muted, #94a3b8)", marginTop: "6px" }}>
                      <span>Title: {tx.titleCompanyName || "Escrow"}</span>
                      <span style={{ color: tx.titleStatus === "clear_to_close" ? "#10b981" : "inherit", fontWeight: 600 }}>
                        {titleMilestoneLabel}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
                    <div>
                      <span style={{ fontSize: "0.72rem", color: "var(--muted, #94a3b8)", display: "block" }}>Assignment Fee</span>
                      <strong style={{ fontSize: "0.95rem", color: "var(--primary, #d6ff3f)" }}>{money(tx.assignmentFee || 0)}</strong>
                    </div>
                    {onGoToTransactions && (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={onGoToTransactions}
                        style={{ fontSize: "0.8rem" }}
                      >
                        Details →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isWholesale && (
        <section aria-label="Buy Box Matches" style={{ marginTop: "24px", marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
            <div>
              <h2 className="section-title" style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <span>🎯 Buy Box Matches</span>
                <span className="badge tone-blue" style={{ fontSize: "0.78rem" }}>
                  {buyBoxMatches.reduce((acc, g) => acc + g.matches.length, 0)} Active Match{buyBoxMatches.reduce((acc, g) => acc + g.matches.length, 0) === 1 ? "" : "es"}
                </span>
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                Deals in your pipeline matching your Cash & Creative Financing buyers' criteria
              </p>
            </div>
            {onGoToBuyBox && (
              <button type="button" className="btn btn-ghost" onClick={onGoToBuyBox} style={{ fontSize: "0.82rem" }}>
                Open Buy Box Matcher →
              </button>
            )}
          </div>

          {buyBoxMatches.length === 0 ? (
            <div className="card" style={{ padding: "20px", textAlign: "center" }}>
              <p style={{ margin: "0 0 6px", fontWeight: 600 }}>No deals currently match your buyers' criteria</p>
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
                Add more end buyers with cash/creative financing criteria, or add properties to your pipeline.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
              {buyBoxMatches.slice(0, 4).map((group) => {
                const prop = group.property;
                const topMatch = group.matches[0];
                const buyer = topMatch.buyer;
                const rawStrat = getCustomField(buyer, "Buyer Type") || buyer.services?.join(" · ") || "Cash Buyer";
                const stratCount = (buyer.services && buyer.services.length > 0)
                  ? buyer.services.length
                  : (rawStrat.split(/[,/]+/).filter(Boolean).length || 1);
                return (
                  <div
                    key={prop.id}
                    className="card"
                    style={{
                      padding: "16px",
                      border: "1px solid rgba(88, 166, 255, 0.3)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div>
                          <span className="badge tone-blue" style={{ fontSize: "0.72rem", marginBottom: "4px" }}>
                            {group.matches.length} Compatible Buyer{group.matches.length === 1 ? "" : "s"}
                          </span>
                          <h3 className={`cell-strong ${blurPii(pii)}`} style={{ margin: "2px 0", fontSize: "1rem", fontWeight: 700 }}>
                            {prop.address || prop.companyName}
                          </h3>
                          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                            {[prop.city, prop.state].filter(Boolean).join(", ") || "Location unlisted"}
                          </div>
                        </div>
                        <span className="badge tone-lime" style={{ fontWeight: 800, fontSize: "0.8rem" }}>
                          {topMatch.matchScore}% Match
                        </span>
                      </div>

                      <div style={{ padding: "10px", backgroundColor: "rgba(255,255,255,0.03)", borderRadius: "6px", margin: "10px 0" }}>
                        <div style={{ fontSize: "0.78rem", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>
                          Top Matched Buyer:
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span className={`cell-strong ${blurPii(pii)}`} style={{ fontWeight: 600 }}>
                            {buyer.companyName}
                          </span>
                          <span
                            className="badge tone-blue"
                            style={{ fontWeight: 700, fontSize: "0.75rem", minWidth: "24px", padding: "1px 6px", textAlign: "center" }}
                            title={`Buy Strategies (${stratCount}): ${rawStrat}`}
                          >
                            {stratCount}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "var(--accent, #58a6ff)", marginTop: "4px" }}>
                          ✓ {topMatch.reasons[0]?.detail || "Budget & criteria fit"}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border, #30363d)", paddingTop: "10px", marginTop: "6px" }}>
                      <span style={{ fontSize: "0.85rem", color: "var(--lime, #3fb950)", fontWeight: 700 }}>
                        {money(getPropertyPrice(prop))}
                      </span>
                      {onGoToBuyBox && (
                        <button
                          type="button"
                          className="link"
                          onClick={onGoToBuyBox}
                          style={{ fontSize: "0.82rem", color: "var(--accent, #58a6ff)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          View Dispo Matches →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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
            <div className="card kpi revenue-card-billed">
              <span className="kpi-label">Total billed</span>
              <span className={`kpi-value lime${blur(moneyHidden)}`}>{money(revenue.invoiced)}</span>
              <span className="kpi-note">All invoices — draft + sent + paid</span>
            </div>
            <div className="card kpi revenue-card-paid">
              <span className="kpi-label">Paid</span>
              <span className={`kpi-value green${blur(moneyHidden)}`}>{money(revenue.paid)}</span>
              <span className="kpi-note">Marked paid — money in</span>
            </div>
            <div className="card kpi revenue-card-outstanding">
              <span className="kpi-label">Outstanding</span>
              <span className={`kpi-value${blur(moneyHidden)}`}>{money(revenue.outstanding)}</span>
              <span className="kpi-note">Sent, not yet paid</span>
            </div>
            <div className="card kpi revenue-card-overdue">
              <span className="kpi-label">Overdue</span>
              <span className={`kpi-value red${blur(moneyHidden)}`}>{money(revenue.overdue)}</span>
              <span className="kpi-note">Sent, past due date</span>
            </div>
          </div>
        </section>
      )}


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
                <th>{isWholesale ? "Property Address" : "Company"}</th>
                <th>{isWholesale ? "Seller / Owner" : "Contact"}</th>
                <th>{isWholesale ? "Deal Structure" : "Services"}</th>
                <th className="num">{isWholesale ? "Est. Value / ARV" : "Deal"}</th>
                <th>Stage</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.recentClients.map((c) => (
                <tr key={c.id}>
                  <td className="cell-strong">
                    <span className={`cell-name${blurPii(pii)}`} title={c.address || c.companyName}>
                      {c.address || c.companyName}
                    </span>
                    {isWholesale && (c.city || c.state) && (
                      <span style={{ display: "block", fontSize: "11px", color: "var(--muted, #94a3b8)", fontWeight: 400 }}>
                        {[c.city, c.state, c.zip].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="cell-muted">
                    <span className={`cell-name${blurPii(pii)}`} title={c.contactName || c.companyName || undefined}>
                      {c.contactName || c.companyName || "—"}
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
