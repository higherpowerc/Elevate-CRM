import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
/* ApiError must be imported as a VALUE (not `type ApiError`) — it is used in
   `instanceof ApiError` below (the payment-link 503 branch). A type-only
   import is stripped by the bun build transpiler (no type-checker runs at
   build time), leaving a dangling `ApiError` reference in the bundle that
   throws ReferenceError at runtime — the payment-link 503 notice never
   rendered (live-test finding 2026-08-17, fixed in PR #68). */
import { api, ApiError, type ClientInput } from "./api";
import { money, fmtDate, type AgreementEnvelope, type Client, type CustomFieldDef, type Stage, type AgreementStatus, type PaymentStatus } from "./types";
import type { IntakeOrgSettings } from "./intakeRules";
import { StageBadge, ServiceChips } from "./bits";
import { usePii, blurPii } from "./pii";
import ClientModal from "./ClientModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import StageEditor from "./StageEditor";

/** Owner request 2026-08-14 — "lost" and "dnc" are STATUS views: they render
 *  the Lost section / DNC list instead of the pipeline table. The pipeline
 *  segs (Active/Archived/All) exclude lost leads from their counts. */
type Filter = "active" | "archived" | "all" | "lost" | "dnc";

/** Owner request 2026-08-15 — which slice of the org's ordered pipeline this
 *  pipeline view renders (positional, rename-safe — never hardcoded names):
 *    "all"    → every stage EXCEPT the terminal (last) one — the tenant
 *               (role=member) Leads tab, unchanged from PR #35.
 *    "first"  → only stages[0] — the OWNER's Leads tab (prospects only).
 *    "middle" → every stage between first and terminal — the OWNER's
 *               Onboarding tab (intake leads live here).
 *  The owner's three-bucket split is Leads = first, Onboarding = middle,
 *  Clients (directory) = terminal. */
export type StageScope = "all" | "first" | "middle";

interface Props {
  /** The tenant's ordered pipeline stages — the stage column dropdown and
   *  badge tones are driven by this list (Phase 3a). Refreshed from
   *  /api/settings on every load so a stage change made through the "Manage
   *  stages" shortcut shows up immediately. */
  stages: Stage[];
  /** Which pipeline slice to render (see StageScope above). Default "all". */
  scope?: StageScope;
  /** Owner workspace (role=admin org) — owner direction 2026-08-14: the
   *  owner calls its pipeline records "leads", so this page's headings, CTA
   *  and empty states read "Lead(s)" instead of "Client(s)". Tenant orgs
   *  (role=member) keep "clients" wording for their records. Purely
   *  presentational; data and stages are untouched. (2026-08-15: the nav tab
   *  labels themselves are unified — the pipeline tab reads "Leads" and the
   *  directory tab reads "Clients" in every workspace.) */
  ownerOrg?: boolean;
  /** Owner request 2026-08-14 — deep-linked stage filter: the Dashboard's
   *  "View →" on a stage card hands its stage name here, and this view opens
   *  with that stage chip selected. Names arrive from the org's CURRENT stage
   *  list (the dashboard cards are driven by the same settings), so a renamed
   *  stage deep-links to itself. null/undefined = "All". A name outside this
   *  view's scope (e.g. the terminal stage) is ignored → "All". */
  initialStage?: string | null;
  /** Team-users UI (owner request 2026-08-14) — false for a restricted member
   *  with view-only "clients" access: the create/edit/archive/delete
   *  affordances are hidden (the server still 403s any write). Owner and org
   *  admins always pass true. */
  canEdit?: boolean;
}

/** Short value label for a custom field chip, rendered per field type
 *  (Phase 3b): dates are formatted, checkboxes become ✓/✕, numbers stay raw. */
function cfChipLabel(def: CustomFieldDef, value: string): string {
  if (def.type === "checkbox") return value === "1" ? "✓" : "✕";
  if (def.type === "date") return fmtDate(value);
  return value;
}

/** GLOBAL name rule (owner direction 2026-08-16 — owner AND tenant pipeline
 *  tables): the primary cell shows the record's business name — EXCEPT an
 *  INDIVIDUAL record under the owner's "Business name" header, where
 *  companyName holds the person's FULL NAME and must never render as a
 *  business name: show the DBA name when present, else an em dash (PR #62).
 *  Tenant tables (header "Client") always show companyName — for an
 *  individual that IS their full name, exactly what the owner wants there.
 *  Commercial records always show companyName. */
function primaryName(ownerOrg: boolean, c: Client): string {
  return ownerOrg && c.clientType !== "commercial" ? c.dbaName || "—" : c.companyName;
}

/** GLOBAL contact rule (owner direction 2026-08-16 — owner AND tenant): the
 *  primary line of the Contact cell is the person's FULL NAME (companyName)
 *  for individual records — the universal "Contact name" field is hidden for
 *  individuals (their name is already captured by "Name *") and a leftover
 *  partial/redundant value must never render — and contactName for commercial
 *  records, followed by email + phone. */
function contactPrimary(c: Client): string {
  return c.clientType !== "commercial" ? c.companyName : c.contactName || "—";
}

/** Local YYYY-MM-DD — for the DNC quick row-action's "marked" date (owner
 *  cockpit A 2026-08-15). Same convention the task date inputs use. */
function localTodayStr(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Owner cockpit B (owner direction 2026-08-15; PR #53 adds the full
 *  DocuSign lifecycle) — the owner's Onboarding tab DocuSign agreement
 *  status vocabulary: badge label + badge tone + the select's option label.
 *  not_sent → gray (not started), sent → amber (waiting on the client),
 *  delivered → blue (opened by the signer), signed → green (complete),
 *  declined → red (the signer refused — a failure state). */
const AGREEMENT_META: Record<AgreementStatus, { label: string; tone: string }> = {
  not_sent: { label: "Not sent", tone: "tone-gray" },
  sent: { label: "Sent", tone: "tone-amber" },
  delivered: { label: "Delivered", tone: "tone-blue" },
  signed: { label: "Signed", tone: "tone-green" },
  declined: { label: "Declined", tone: "tone-red" },
};

/** Owner direction 2026-08-18 — the Payment column status vocabulary: badge
 *  label + tone. none → the cell renders a muted em dash (no link sent yet),
 *  sent → amber (link emailed, waiting on the client's payment — yellow),
 *  paid → green (payment received). Same badge/tone styling as the agreement
 *  badges (AGREEMENT_META). */
const PAYMENT_META: Record<PaymentStatus, { label: string; tone: string }> = {
  none: { label: "—", tone: "tone-gray" },
  sent: { label: "Sent", tone: "tone-amber" },
  paid: { label: "Paid", tone: "tone-green" },
};

/** Owner cockpit B (PR #53) — the compact DocuSign lifecycle stepper shown
 *  in the owner's Onboarding Agreement cell. The LINEAR stages render as a
 *  4-dot progress row (not_sent → sent → delivered → signed) with the
 *  current step highlighted and completed steps filled; "declined" is NOT a
 *  step in the bar — it renders as a distinct red failure state with the
 *  "Declined" label. Tooltips on the dots carry the stage names; the badge
 *  directly below the tracker shows the current status label. */
const AGREEMENT_STEPS: AgreementStatus[] = ["not_sent", "sent", "delivered", "signed"];

function AgreementTracker({ status }: { status: AgreementStatus }) {
  if (status === "declined") {
    return (
      <div className="agree-tracker declined" role="group" aria-label="Agreement declined">
        <span className="agree-tracker-fail">Declined</span>
      </div>
    );
  }
  const cur = AGREEMENT_STEPS.indexOf(status);
  return (
    <div className="agree-tracker" role="group" aria-label={`Agreement status: ${AGREEMENT_META[status].label}`}>
      {AGREEMENT_STEPS.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <span className={`agree-tracker-line${i <= cur ? " done" : ""}`} />}
          <span
            className={`agree-tracker-dot${i < cur ? " done" : ""}${i === cur ? " current" : ""}`}
            title={AGREEMENT_META[s].label}
          />
        </Fragment>
      ))}
    </div>
  );
}

export default function Clients({ stages, scope = "all", ownerOrg = false, initialStage = null, canEdit = true }: Props) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  /* Adaptive intake Phase 1/2: the org's account-level vertical config —
     drives which sections the client form shows. Loaded with settings. */
  const [intake, setIntake] = useState<IntakeOrgSettings>({
    industry: "",
    serviceModel: "both",
    deliveryType: "both",
    intakeOpts: [],
    revenueModel: "sales",
    customIntakeGroups: [],
  });
  // Local copy of the tenant's stages + per-stage counts, refreshed from the
  // settings endpoint (already fetched for custom fields) so stage changes
  // made in the "Manage stages" shortcut apply to this page immediately.
  const [orgStages, setOrgStages] = useState<Stage[]>(stages);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [stageModal, setStageModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Global privacy eye (2026-08-14 owner request) — blur client names/addresses/
     contact details in the pipeline rows while the top-nav eye is on. */
  const pii = usePii();
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  /* Owner request 2026-08-14 — stage chip filter (null = "All"). Initialized
     from the dashboard deep-link (initialStage) when this view mounts; the
     chips row below selects/toggles it. Composes with the Active/Archived/All
     toggle and search — all three intersect in the visible memo. */
  const [stageFilter, setStageFilter] = useState<string | null>(initialStage);

  /* Owner request 2026-08-14/15 — positional pipeline buckets (rename-safe,
     never hardcoded stage names). FIRST = stages[0], TERMINAL = stages[last],
     MIDDLE = everything between. `scopedStages` is the slice of the ordered
     stages this view renders per its `scope` prop:
       "all"    → all but the terminal stage (tenant Leads — PR #35 behavior)
       "first"  → stages[0] (owner Leads)
       "middle" → stages[1..last-1] (owner Onboarding)
     Derived from orgStages (refreshed from settings on every load) so a
     rename/reorder made in "Manage stages" applies here immediately. */
  const scopedStages = useMemo<Stage[]>(() => {
    if (scope === "first") return orgStages.length > 0 ? [orgStages[0]] : [];
    if (scope === "middle") return orgStages.length > 2 ? orgStages.slice(1, -1) : [];
    return orgStages.length > 0 ? orgStages.slice(0, -1) : [];
  }, [scope, orgStages]);
  /* The Dashboard deep-links "View →" per stage card; a stage outside this
     view's scope (e.g. the terminal stage) has no chip here, so the link
     opens the pipeline on "All" (the stale stage name is ignored). */
  const activeStageFilter = stageFilter && scopedStages.includes(stageFilter) ? stageFilter : null;
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; client: Client } | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);

  /** Loads the FULL client list (active AND archived) plus org settings.
   *  The tab buttons filter this in-memory list client-side, so archived
   *  clients stay visible on the Archived/All tabs. Fetching only active
   *  clients here made archived ones invisible in the UI — every mutation
   *  below refetches the same complete list. */
  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ clients }, { settings }] = await Promise.all([api.clients(true), api.settings()]);
      setClients(clients);
      setCustomFieldDefs(settings.customFields);
      setOrgStages(settings.stages);
      setStageCounts(settings.stageCounts);
      setIntake({
        industry: settings.industry,
        serviceModel: settings.serviceModel,
        deliveryType: settings.deliveryType,
        intakeOpts: settings.intakeOpts,
        revenueModel: settings.revenueModel,
        customIntakeGroups: settings.customIntakeGroups,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clients.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Esc closes the "Manage stages" modal (keyboard nicety).
  useEffect(() => {
    if (!stageModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setStageModal(false);
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () => window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, [stageModal, busy]);

  /** Shared search predicate — the pipeline rows, the Lost section and the
   *  DNC list all filter on the same search box. */
  const matchesQuery = useCallback(
    (c: Client): boolean => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [
        c.companyName,
        c.contactName,
        c.email,
        c.industry,
        c.address,
        c.city,
        c.state,
        c.phone,
        c.leadSource,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    },
    [query],
  );

  const visible = useMemo(() => {
    if (!clients) return [];
    /* Owner request 2026-08-14 — the Lost / DNC views list every record in
       THIS view's stage scope with the flag set (the stage chip + search
       still intersect). */
    if (filter === "lost") {
      return clients.filter(
        (c) =>
          c.lost &&
          scopedStages.includes(c.stage) &&
          (!activeStageFilter || c.stage === activeStageFilter) &&
          matchesQuery(c),
      );
    }
    if (filter === "dnc") {
      return clients.filter(
        (c) =>
          c.dnc &&
          scopedStages.includes(c.stage) &&
          (!activeStageFilter || c.stage === activeStageFilter) &&
          matchesQuery(c),
      );
    }
    return clients.filter((c) => {
      /* Positional pipeline buckets (owner request 2026-08-14/15): only
         clients whose stage is inside THIS view's scoped stage slice are
         pipeline records here. Everything else — for the owner that means the
         terminal (sold) stage and the other pipeline bucket — lives on its
         own tab, archived or not. */
      if (!scopedStages.includes(c.stage)) return false;
      /* Owner request 2026-08-14 — lost leads are excluded from the visible
         pipeline rows (they live in the Lost section). */
      if (c.lost) return false;
      const matchFilter =
        filter === "all" ? true : filter === "archived" ? c.archived : !c.archived;
      if (!matchFilter) return false;
      /* Stage chip filter — intersects with the toggle above and the search
         below. A selected chip narrows to exactly that pipeline stage. */
      if (activeStageFilter && c.stage !== activeStageFilter) return false;
      return matchesQuery(c);
    });
  }, [clients, filter, query, activeStageFilter, scopedStages, matchesQuery]);

  /* Owner request 2026-08-14 — chip counts. Non-archived clients per stage,
     computed live from the same loaded list the table renders, so the chips
     always agree with the dashboard's stage breakdown (which is also
     non-archived per stage) and with the "Active" count above. Only the
     stages IN THIS VIEW's scope get chips (sold/terminal customers are not
     pipeline prospects; the other owner bucket has its own tab). */
  const stageCountsActive = useMemo(() => {
    const m: Record<string, number> = {};
    if (clients) {
      for (const c of clients) {
        if (c.archived) continue;
        if (c.lost) continue; // lost leads never count toward pipeline chips
        if (!scopedStages.includes(c.stage)) continue;
        m[c.stage] = (m[c.stage] ?? 0) + 1;
      }
    }
    return m;
  }, [clients, scopedStages]);

  const totalValue = useMemo(
    () => visible.filter((c) => !c.archived).reduce((sum, c) => sum + (c.dealValue || 0), 0),
    [visible],
  );

  async function handleSave(input: ClientInput, editing?: Client) {
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.updateClient(editing.id, input);
      else await api.createClient(input);
      setModal(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteClient(deleting.id);
      setDeleting(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStageMove(c: Client, stage: Stage) {
    setBusy(true);
    setError(null);
    try {
      await api.updateClient(c.id, { ...c, stage });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(c: Client) {
    setBusy(true);
    setError(null);
    try {
      await api.updateClient(c.id, { ...c, archived: !c.archived });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Owner request 2026-08-14 — restore a lost lead to the pipeline: clears
   *  the lost flag (the reason is cleared server-side too). */
  async function handleRestore(c: Client) {
    setBusy(true);
    setError(null);
    try {
      await api.updateClient(c.id, { ...c, lost: false });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Owner cockpit A (owner direction 2026-08-15) — Leads-tab quick status
   *  actions, the SAME update path as the stage picker (api.updateClient):
   *  "Lost" flags the lead lost (it leaves the pipeline for the Lost
   *  section); "DNC" toggles the do-not-call flag (stamping today's date
   *  when turning it on). Reasons are optional — add them via the edit
   *  modal. The refetch after the update keeps the row in sync either way. */
  async function handleFlag(c: Client, flag: "lost" | "dnc") {
    setBusy(true);
    setError(null);
    try {
      if (flag === "lost") {
        await api.updateClient(c.id, { ...c, lost: true });
      } else {
        const turningOn = !c.dnc;
        await api.updateClient(c.id, {
          ...c,
          dnc: turningOn,
          dncDate: turningOn ? localTodayStr() : "",
          dncReason: "",
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed.");
    } finally {
      setBusy(false);
    }
  }

  /* Native e-signature (owner direction 2026-08-15; replaces the PR #53
     manual tracker) — OWNER Onboarding tab only. "Send Agreements" calls the
     REAL internal signer: the server renders the owner's template with the
     client's details, generates the PDF, mints the unique sign token and
     emails the client the /sign/<token> link. The tracker (Not sent → Sent →
     Delivered → Signed/Declined) advances automatically from server state.
     Live-test finding #1 (2026-08-15): when the email send FAILED, the notice
     turns amber and carries the full signing link so the owner can copy/send
     it manually instead of believing the link went out. */
  const [sendNotice, setSendNotice] = useState<{
    kind: "success" | "warn";
    text: string;
    signUrl?: string;
  } | null>(null);
  const [audit, setAudit] = useState<AgreementEnvelope | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  async function handleSendAgreement(c: Client) {
    setBusy(true);
    setError(null);
    setSendNotice(null);
    try {
      const r = await api.sendAgreement(c.id);
      if (r.emailStatus === "sent") {
        setSendNotice({
          kind: "success",
          text: `Agreement sent to ${r.emailTo} — the sign link is valid for 30 days.`,
        });
      } else {
        // The envelope advanced to Sent and the link EXISTS (it is returned in
        // the response) — only the email failed. Never show a green "sent";
        // give the owner the URL to forward manually.
        setSendNotice({
          kind: "warn",
          text: `Agreement link generated, but the email failed to send: ${r.emailError ?? "unknown error"}`,
          signUrl: r.signUrl,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agreement send failed.");
    } finally {
      setBusy(false);
    }
  }
  /* Owner direction 2026-08-18 — the "Payment link" action MOVED from the
     Clients tab (ClientsDirectory.tsx) to the OWNER's Onboarding tab: the
     onboarding flow ends with sending the client their $200/month
     subscription payment link. Placeholder until STRIPE_SECRET_KEY is set —
     the endpoint returns 503 { error: "Stripe not configured" } when the
     key is missing and this notice explains the keys are not connected yet;
     when the key IS set the same call creates a real Payment Link for
     $200.00/month and emails it to the client — the notice then shows the
     link. Owner-workspace-only, scope "middle". */
  const [payNotice, setPayNotice] = useState<{ kind: "success" | "warn"; text: string } | null>(null);
  async function handlePaymentLink(c: Client) {
    // Owner direction 2026-08-18 — the payment link must NOT be operational
    // until the client's agreement is fully signed. The button is disabled
    // until then (see the Onboarding row), and the server enforces the same
    // rule (409) — this early return is a cheap belt-and-suspenders guard.
    if (c.agreementStatus !== "signed") return;
    // Phase 5 (owner direction 2026-08-18) — the owner types the bill amount
    // at send time; no hard-coded rates. Prefill from the client's stored
    // monthly subscription amount when there is one.
    const prefill = c.monthlyAmount > 0 ? String(c.monthlyAmount) : "";
    const entered = window.prompt(
      `Bill ${c.companyName} — enter the payment amount in USD (e.g. 200 or 199.99).`,
      prefill,
    );
    if (entered === null) return; // canceled
    const amount = Number(entered);
    if (!entered.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid payment amount in dollars.");
      return;
    }
    setBusy(true);
    setError(null);
    setPayNotice(null);
    try {
      const r = await api.clientPaymentLink(c.id, { amount, interval: "month" });
      setPayNotice({
        kind: "success",
        text: `Payment link for ${money(r.amountCents / 100)} sent to ${r.emailTo}: ${r.url}`,
      });
      // Live update: the Payment column flips none → Sent (yellow) via the
      // same refetch the agreement lifecycle uses.
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        setPayNotice({
          kind: "warn",
          text: "Stripe is not connected yet. Once Stripe keys are added, this button will generate and send a payment link to the client.",
        });
      } else {
        setError(e instanceof Error ? e.message : "Payment link failed.");
      }
    } finally {
      setBusy(false);
    }
  }
  /** Owner direction 2026-08-18 — manual "mark paid" (interim): flips the
   *  Payment column yellow (Sent) → green (Paid) via the owner-only
   *  payment-paid endpoint. A Stripe webhook auto-flips it in Phase 5; this
   *  is the manual path during live testing. The refetch after the call makes
   *  the row show Paid immediately (same live-update lifecycle as the
   *  agreement status). */
  async function handleMarkPaid(c: Client) {
    setBusy(true);
    setError(null);
    setPayNotice(null);
    try {
      await api.clientPaymentPaid(c.id);
      setPayNotice({
        kind: "success",
        text: `Payment recorded as received for ${c.companyName} — the Payment column now shows Paid.`,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark the payment as received.");
    } finally {
      setBusy(false);
    }
  }
  /** Native e-signature — the owner's agreement audit view: status, signer
   *  name, timestamp, IP address, consent, expiry and the PDF copy. */
  async function openAudit(c: Client) {
    setAuditError(null);
    setAudit(null);
    try {
      const { agreements } = await api.agreements();
      const env = agreements.find((a) => a.clientId === c.id);
      if (!env) {
        setAuditError("No agreement has been sent to this client yet.");
        return;
      }
      setAudit(env);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "Could not load the agreement record.");
    }
  }

  if (!clients) {
    return error ? (
      <div className="alert alert-error">{error}</div>
    ) : (
      <div className="skeleton-block" aria-label="Loading clients" />
    );
  }

  /* Positional buckets: the view's Active/Archived/All counts cover the
     scoped stage slice only — clients in other buckets (the owner's other
     pipeline tab, or the terminal/sold stage for tenants) are counted on
     their own tabs, not here. */
  const scoped = clients.filter((c) => scopedStages.includes(c.stage));
  /* Owner request 2026-08-14 — lost leads are excluded from the pipeline seg
     counts (Active/Archived/All); they surface on the "Lost" seg (and DNC
     carries its own list). */
  const counts = {
    active: scoped.filter((c) => !c.archived && !c.lost).length,
    archived: scoped.filter((c) => c.archived && !c.lost).length,
    all: scoped.filter((c) => !c.lost).length,
    lost: scoped.filter((c) => c.lost).length,
    dnc: scoped.filter((c) => c.dnc).length,
  };

  /* Owner cockpit A (owner direction 2026-08-15) — the owner's LEADS tab
     (scope "first", the prospects bucket) gets the cockpit quick actions:
     the "Business name" column label, the unwrapped full-name rows, the
     "Start Onboarding" action (moves the lead into the MIDDLE stage — the
     onboarding position, positional + rename-safe) and the Lost / DNC row
     buttons with the pipeline-row Archive action removed (archiving stays
     available on the Clients directory and the Onboarding tab). Client
     accounts (role=member) and the owner's Onboarding tab are untouched —
     they keep "Client", the truncated cells and the Archive row action. */
  const ownerLeadsTab = ownerOrg && scope === "first";
  const onboardingStage =
    ownerOrg && scope === "first" && orgStages.length > 2 ? orgStages[1] : null;
  /* Owner cockpit B (owner direction 2026-08-15) — the OWNER's ONBOARDING
     tab (scope "middle") drops the Services column in favor of the DocuSign
     Agreement column (status badge + select) and gains the "Send Agreements"
     quick action in the Next-action stack. Owner-workspace-only: client
     accounts (role=member) and the owner Leads tab keep their Services
     column and never see agreement status. */
  const ownerOnboardingTab = ownerOrg && scope === "middle";

  /* Owner request 2026-08-15 — the owner's three-bucket pipeline: the Leads
     tab is the FIRST stage ("prospects"), the Onboarding tab is the MIDDLE
     stages ("intake leads"), the Clients tab is the terminal stage (sold).
     Tenant orgs (role=member) keep the single pipeline — every stage except
     terminal — with "clients" wording for their records. Same page, same
     data — only the visible wording and the scoped stage slice differ. */
  const heading = scope === "middle" ? "Onboarding" : ownerOrg ? "Leads" : (<>
    Client <em className="serif">book</em>
  </>);
  const addCta = ownerOrg ? "+ New lead" : "+ New client";
  const emptyTitle = scope === "middle" ? "No onboarding clients yet"
    : ownerOrg && scope === "first" ? "No prospects yet"
    : ownerOrg ? "No leads yet" : "No clients yet";
  const emptySub = scope === "middle"
    ? "Intake leads between your first and final pipeline stages live here — move one into your final stage and it becomes a client."
    : ownerOrg && scope === "first"
    ? "Add your first prospect to start tracking the pipeline."
    : ownerOrg
    ? "Add your first lead to start tracking the pipeline."
    : "Add your first client to start tracking the pipeline.";
  const emptyCta = scope === "middle"
    ? "Add your first lead"
    : ownerOrg && scope === "first"
    ? "Add your first prospect"
    : ownerOrg ? "Add your first lead" : "Add your first client";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{heading}</h1>
          <p className="page-sub">
            {counts.active} active · {counts.archived} archived · active book value{" "}
            <strong>{money(totalValue)}</strong>
          </p>
        </div>
        <div className="page-actions">
          {canEdit && (
            <button className="btn btn-ghost" onClick={() => setStageModal(true)} title="Rename, reorder or remove your pipeline stages">
              Manage stages
            </button>
          )}
          {/* Live-test finding 2026-08-17 — leads can ONLY be added from the
              Leads tab (entry-point rule, PR #47). The Onboarding tab
              (scope "middle") no longer renders the "+ New lead" button. */}
          {canEdit && scope !== "middle" && (
            <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
              {addCta}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="toolbar">
        <div className="seg">
          {/* Owner request 2026-08-14 — the seg row gains "Lost" (the Lost
              section: leads marked not-interested, out of the pipeline
              counts) and "DNC" (do-not-call list with its warning). */}
          {(["active", "archived", "all", "lost", "dnc"] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? "seg-btn active" : "seg-btn"}
              onClick={() => setFilter(f)}
            >
              {f === "active" ? "Active" : f === "archived" ? "Archived" : f === "all" ? "All" : f === "lost" ? "Lost" : "DNC"}
              <span className="seg-count">
                {f === "active" ? counts.active : f === "archived" ? counts.archived : f === "all" ? counts.all : f === "lost" ? counts.lost : counts.dnc}
              </span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search company, contact, industry…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />
        {/* Owner request 2026-08-14/15 — stage chip row: "All" + one chip per
            stage IN THIS VIEW's scope, each with its live non-archived count
            (same numbers as the dashboard stage breakdown). The tenant Leads
            tab scopes to every non-terminal stage; the owner Leads tab scopes
            to the FIRST stage; the owner Onboarding tab scopes to the MIDDLE
            stages. Stages outside the scope (terminal/sold — the other owner
            bucket) get no chip here — they live on their own tabs. Clicking a
            chip filters the table to that stage; clicking the active chip
            again toggles it off; "All" clears. Stage names come from the
            org's CURRENT stages (orgStages, refreshed with every load), so
            renames show up here immediately. */}
        <div className="stage-chips" role="group" aria-label="Filter by stage">
          <button
            type="button"
            className={activeStageFilter === null ? "stage-chip active" : "stage-chip"}
            aria-pressed={activeStageFilter === null}
            onClick={() => setStageFilter(null)}
          >
            All
            <span className="seg-count">{counts.active}</span>
          </button>
          {scopedStages.map((s) => (
            <button
              type="button"
              key={s}
              className={activeStageFilter === s ? "stage-chip active" : "stage-chip"}
              aria-pressed={activeStageFilter === s}
              onClick={() => setStageFilter((cur) => (cur === s ? null : s))}
            >
              {s}
              <span className="seg-count">{stageCountsActive[s] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">
            {filter === "lost"
              ? "No lost leads"
              : filter === "dnc"
                ? "No DNC entries"
                : scoped.length === 0
                  ? emptyTitle
                  : "Nothing matches"}
          </p>
          <p className="empty-sub">
            {filter === "lost"
              ? "Leads you mark as lost show up here — they stay out of your pipeline counts."
              : filter === "dnc"
                ? "Leads with a do-not-contact flag show up here with their warning."
                : scoped.length === 0
                  ? emptySub
                  : "Try a different search or filter."}
          </p>
          {/* Live-test finding 2026-08-17 — same entry-point rule for the
              empty state: no add-lead CTA on the Onboarding tab. */}
          {canEdit && scoped.length === 0 && filter !== "lost" && filter !== "dnc" && scope !== "middle" && (
            <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
              {emptyCta}
            </button>
          )}
        </div>
      ) : filter === "lost" || filter === "dnc" ? (
        /* Owner request 2026-08-14 — the Lost section / DNC list. Lost rows
           show the lost reason + a "Restore to pipeline" action (clears the
           flag); DNC rows carry the warning banner inline. Both share the
           stage chip filter and the search box with the pipeline table.

           Owner direction 2026-08-15 (#50) — the owner's Leads tab has NO
           Stage column at all, and that includes the Lost/DNC rows: the
           Stage header AND the StageBadge cell are hidden there too (the
           colgroup drops the Stage col and rebalances to 100%). Tenants and
           the owner's Onboarding tab keep their Stage column. */
        <div className="card table-wrap">
          <table className={`table clients-table${ownerOrg ? " owner-leads" : ""}`}>
            <colgroup>
              <col style={{ width: ownerLeadsTab ? "30%" : "26%" }} />
              {!ownerLeadsTab && <col style={{ width: "14%" }} />}
              <col style={{ width: "38%" }} />
              <col style={{ width: ownerLeadsTab ? "32%" : "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>{ownerOrg ? "Business name" : "Client"}</th>
                {!ownerLeadsTab && <th>Stage</th>}
                <th>{filter === "lost" ? "Lost reason" : "Do-not-contact"}</th>
                <th className="actions-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className={c.archived ? "row-archived" : ""}>
                  <td className="cell-strong" data-label={ownerOrg ? "Business name" : "Client"}>
                    <div className="cell-company">
                      <span className={`cell-name${blurPii(pii)}`} title={primaryName(ownerOrg, c)}>
                        {primaryName(ownerOrg, c)}
                      </span>
                      {c.lost && <span className="chip chip-lost">Lost</span>}
                      {c.dnc && <span className="chip chip-dnc">DNC</span>}
                      {c.archived && <span className="chip chip-archived">archived</span>}
                    </div>
                    {c.industry && <div className="cell-sub">{c.industry}</div>}
                  </td>
                  {!ownerLeadsTab && (
                    <td data-label="Stage" className="lost-dnc-stage-cell">
                      <StageBadge stage={c.stage} index={Math.max(0, orgStages.indexOf(c.stage))} />
                    </td>
                  )}
                  <td data-label={filter === "lost" ? "Lost reason" : "Do-not-contact"}>
                    {filter === "lost" ? (
                      <span className="cell-muted" title={c.lostReason}>
                        {c.lostReason || "No reason given"}
                      </span>
                    ) : (
                      <span className="dnc-banner-row">
                        Do not call/contact — marked {c.dncDate || "—"}
                        {c.dncReason ? `: ${c.dncReason}` : ""}
                      </span>
                    )}
                  </td>
                  <td data-label="Actions">
                    <div className="row-actions">
                      {canEdit && (
                        <button
                          className="icon-btn"
                          title="Edit"
                          aria-label={`Edit ${c.companyName}`}
                          onClick={() => setModal({ mode: "edit", client: c })}
                        >
                          Edit
                        </button>
                      )}
                      {canEdit && filter === "lost" && (
                        <button
                          className="icon-btn"
                          title="Restore to pipeline — clears the lost flag"
                          aria-label={`Restore ${c.companyName} to pipeline`}
                          onClick={() => handleRestore(c)}
                          disabled={busy}
                        >
                          Restore
                        </button>
                      )}
                      {canEdit && (
                        <button
                          className="icon-btn"
                          title={c.archived ? "Unarchive" : "Archive"}
                          aria-label={c.archived ? "Unarchive" : "Archive"}
                          onClick={() => handleArchive(c)}
                        >
                          {c.archived ? "Restore" : "Archive"}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          className="icon-btn danger"
                          title="Delete"
                          aria-label={`Delete ${c.companyName}`}
                          onClick={() => setDeleting(c)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className={`table clients-table${ownerOrg ? " owner-leads" : ""}`}>
            <colgroup>
              {/* Owner cockpit A — the owner's Leads tab rebalances the fixed
                  columns: a touch more room for the (unwrapped) business-name
                  column, the Next-action stack and the extra Lost/DNC actions
                  while the 3i table-fit rule still holds (100% total). Owner
                  bug report 2026-08-15 — the owner's LEADS tab drops the
                  Stage column entirely. Owner direction 2026-08-18 — the
                  Payment column sits between Next action and Actions in every
                  OWNER view (Leads: 7 cols 19/15/11/9/17/10/19; Onboarding +
                  Clients directory: 8 cols 17/14/10/8/13/12/10/16). Tenant
                  views keep their exact 7-col layout (21/15/11/8/15/12/18). */}
              {ownerLeadsTab ? (
                <>
                  <col style={{ width: "19%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "19%" }} />
                </>
              ) : ownerOrg ? (
                <>
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "16%" }} />
                </>
              ) : (
                <>
                  <col style={{ width: "21%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "18%" }} />
                </>
              )}
            </colgroup>
            <thead>
              <tr>
                <th>{ownerOrg ? "Business name" : "Client"}</th>
                <th>Contact</th>
                {/* Owner cockpit B — the owner's Onboarding tab replaces the
                    Services column with the DocuSign Agreement column; client
                    accounts and the owner Leads tab keep "Services". */}
                <th>{ownerOnboardingTab ? "Agreement" : "Services"}</th>
                <th className="num">Deal</th>
                {!ownerLeadsTab && <th>Stage</th>}
                <th>Next action</th>
                {/* Owner direction 2026-08-18 — the Payment column: owner
                    views only (tenants never see the key in the payload), sits
                    between Next action and Actions. */}
                {ownerOrg && <th>Payment</th>}
                <th className="actions-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const fullAddress = [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");
                return (
                  <tr key={c.id} className={c.archived ? "row-archived" : ""}>
                    <td className="cell-strong" data-label={ownerOrg ? "Business name" : "Client"}>
                      <div className="cell-company">
                        <span className={`cell-name${blurPii(pii)}`} title={primaryName(ownerOrg, c)}>
                          {primaryName(ownerOrg, c)}
                        </span>
                        <span className={`badge type-badge tone-${c.clientType === "commercial" ? "blue" : "teal"}`}>
                          {c.clientType === "commercial" ? "Commercial" : "Individual"}
                        </span>
                        {c.lost && <span className="chip chip-lost">Lost</span>}
                        {c.dnc && <span className="chip chip-dnc">DNC</span>}
                        {c.archived && <span className="chip chip-archived">archived</span>}
                      </div>
                      {c.industry && <div className="cell-sub">{c.industry}</div>}
                      {fullAddress && (
                        <div className={`cell-sub addr-line${blurPii(pii)}`} title={fullAddress}>
                          {fullAddress}
                        </div>
                      )}
                      {(() => {
                        // Compact summary: first 2 custom-field values that have
                        // a matching tenant definition (removed fields drop out).
                        const defByName = new Map(customFieldDefs.map((d) => [d.name.toLowerCase(), d]));
                        const chips = c.customFields
                          .map((cf) => ({ def: defByName.get(cf.name.toLowerCase()), cf }))
                          .filter((x): x is { def: CustomFieldDef; cf: { name: string; value: string } } =>
                            !!x.def && (x.def.type === "checkbox" ? true : x.cf.value.trim() !== ""),
                          )
                          .slice(0, 2);
                        if (chips.length === 0) return null;
                        return (
                          <div className="cf-line" aria-label="Custom fields">
                            {chips.map(({ def, cf }) => (
                              <span className="cf-chip" key={cf.name}>
                                {def.name}: {cfChipLabel(def, cf.value)}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td data-label="Contact">
                      <div className="cell-contact">
                        <span className={pii ? "pii-blur" : undefined}>{contactPrimary(c)}</span>
                        {c.email && <div className={`cell-sub${blurPii(pii)}`} title={c.email}>{c.email}</div>}
                        {c.phone && <div className={`cell-sub${blurPii(pii)}`} title={c.phone}>{c.phone}</div>}
                      </div>
                    </td>
                    {ownerOnboardingTab ? (
                      /* Owner cockpit B (owner direction 2026-08-15; PR #53) —
                         the owner's Onboarding tab tracks each client's
                         DocuSign agreement status: a compact lifecycle
                         tracker (Not sent → Sent → Delivered → Signed with
                         the current step highlighted; Declined renders as a
                         red failure state), the tone badge, and a select
                         that moves the status manually. Real DocuSign
                         sending is wired LATER — manual today. */
                      <td data-label="Agreement">
                        <div className="agree-cell">
                          <AgreementTracker status={c.agreementStatus ?? "not_sent"} />
                          <span className={`badge ${AGREEMENT_META[c.agreementStatus ?? "not_sent"].tone}`}>
                            {AGREEMENT_META[c.agreementStatus ?? "not_sent"].label}
                          </span>
                        </div>
                      </td>
                    ) : (
                      <td data-label="Services">
                        <ServiceChips services={c.services} />
                      </td>
                    )}
                    <td className="num cell-strong" data-label="Deal">
                      {money(c.dealValue)}
                    </td>
                    {!ownerLeadsTab && (
                      <td data-label="Stage">
                        {/* Owner direction 2026-08-15 (PR #53) — the OWNER's
                            Onboarding tab shows ONLY the blue StageBadge in
                            the Stage column (no stage select): the owner
                            moves records via the edit modal, and the row
                            keeps its quick actions. Client accounts
                            (role=member) keep badge + select — their core
                            stage picker — and the owner Leads tab has no
                            Stage column at all. */}
                        <div className="stage-cell">
                          <StageBadge stage={c.stage} index={Math.max(0, orgStages.indexOf(c.stage))} />
                          {!ownerOnboardingTab && canEdit && (
                            <select
                              className="stage-select"
                              value={c.stage}
                              aria-label={`Move ${c.companyName} to stage`}
                              onChange={(e) => handleStageMove(c, e.target.value as Stage)}
                              disabled={busy}
                            >
                              {orgStages.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                    )}
                    <td data-label="Next action">
                      {/* Owner cockpit A — the Next-action cell becomes a
                          small stack: the (possibly wrapped) next-action
                          text with the "Start Onboarding" quick action
                          underneath (owner Leads tab only — moves the lead
                          into the MIDDLE stage via the same update path as
                          the stage picker). */}
                      <div className="cell-next-stack">
                        {/* Owner bug report 2026-08-15 — the owner's Leads tab
                            shows ONLY the "Start Onboarding" quick action under
                            Next action: the next-action text span is hidden
                            there (ownerLeadsTab) so the cell reads clean. Owner
                            direction 2026-08-15 — the owner's ONBOARDING tab
                            shows ONLY the "Send Agreements" quick action too
                            (span hidden when ownerOnboardingTab). Client
                            accounts keep the text span exactly as before. */}
                        {!ownerLeadsTab && !ownerOnboardingTab && (
                          <span className="cell-muted cell-next" title={c.nextAction || undefined}>
                            {c.nextAction || "—"}
                          </span>
                        )}
                        {onboardingStage && (
                          <button
                            type="button"
                            className="start-onboarding-btn"
                            title={`Start onboarding — move ${c.companyName} to ${onboardingStage}`}
                            aria-label={`Start onboarding for ${c.companyName}`}
                            onClick={() => handleStageMove(c, onboardingStage)}
                            disabled={busy}
                          >
                            Start Onboarding
                          </button>
                        )}
                        {/* Owner cockpit B — the owner's Onboarding tab:
                            "Send Agreements" marks the client's DocuSign
                            agreement status as Sent (the Agreement column
                            updates immediately via the refetch). Manual for
                            now — real DocuSign envelope sending is wired
                            LATER once the owner connects a DocuSign account. */}
                        {ownerOnboardingTab && c.agreementStatus !== "signed" && (
                          <button
                            type="button"
                            className="send-agreements-btn"
                            title={`Send ${c.companyName} the agreement — the client gets a unique email link to review and sign`}
                            aria-label={`Send agreement to ${c.companyName}`}
                            onClick={() => handleSendAgreement(c)}
                            disabled={busy}
                          >
                            {(c.agreementStatus ?? "not_sent") !== "not_sent" ? "Re-send" : "Send Agreements"}
                          </button>
                        )}
                      </div>
                    </td>
                    {ownerOrg && (
                      /* Owner direction 2026-08-18 — the Payment column: live
                         status of the $200/month subscription payment link,
                         matching the agreement-status pattern (server-persisted
                         paymentStatus, refetched by the list lifecycle — no
                         polling). none → muted dash; sent → amber badge (title
                         carries the emailed link URL); paid → green badge
                         (title carries when the payment was received). The
                         owner's Onboarding tab adds a tiny "Mark paid" action
                         next to the Sent badge (interim manual flip until the
                         Phase 5 Stripe webhook). */
                      <td data-label="Payment">
                        {c.paymentStatus === "none" || !c.paymentStatus ? (
                          <span className="cell-muted">—</span>
                        ) : (
                          <div className="pay-cell">
                            <span
                              className={`badge ${PAYMENT_META[c.paymentStatus].tone}`}
                              title={
                                c.paymentStatus === "sent"
                                  ? `Payment link: ${c.paymentLinkUrl || "sent to client"}`
                                  : c.paymentStatus === "paid" && c.paidAt
                                    ? `Paid ${new Date(c.paidAt).toLocaleString()}`
                                    : PAYMENT_META[c.paymentStatus].label
                              }
                            >
                              {PAYMENT_META[c.paymentStatus].label}
                            </span>
                            {ownerOnboardingTab && canEdit && c.paymentStatus === "sent" && (
                              <button
                                type="button"
                                className="icon-btn"
                                title="Mark the client's payment as received"
                                aria-label={`Mark payment received for ${c.companyName}`}
                                onClick={() => handleMarkPaid(c)}
                                disabled={busy}
                              >
                                Mark paid
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    <td data-label="Actions">
                      <div className="row-actions">
                        {canEdit && (
                          <button className="icon-btn" title="Edit" aria-label={`Edit ${c.companyName}`} onClick={() => setModal({ mode: "edit", client: c })}>
                            Edit
                          </button>
                        )}
                        {/* Owner live-test finding 2026-08-15 — "place the audit
                            button under actions": the agreement Audit button
                            moves OUT of the Agreement-status cell and INTO the
                            ACTIONS column (next to Edit/Delete), same behavior
                            (opens the audit details: status, signer, timestamp,
                            IP, PDF). Owner Onboarding tab only, and only once an
                            agreement has actually been sent. */}
                        {ownerOnboardingTab && (c.agreementStatus ?? "not_sent") !== "not_sent" && (
                          <button
                            type="button"
                            className="icon-btn"
                            title="View agreement details — status, signer, timestamp, IP, PDF"
                            aria-label={`Agreement details for ${c.companyName}`}
                            onClick={() => openAudit(c)}
                            disabled={busy}
                          >
                            Audit
                          </button>
                        )}
                        {/* Owner direction 2026-08-18 — the "Payment link"
                            action MOVED from the Clients tab to the OWNER's
                            Onboarding tab (scope middle, owner org only —
                            NOT the Leads view, NOT tenant views, NOT the
                            Lost/DNC table). With no STRIPE_SECRET_KEY the
                            server answers 503 and the notice explains the
                            keys are not connected yet; once the key is set
                            the same button generates + emails a real Payment
                            Link for the $200/month subscription. */}
                        {ownerOnboardingTab && canEdit && (
                          <button
                            type="button"
                            className="icon-btn"
                            title={
                              c.agreementStatus === "signed"
                                ? "Send a payment link for the $200/month subscription"
                                : "Agreement must be signed before sending a payment link"
                            }
                            aria-label={`Send payment link to ${c.companyName}`}
                            onClick={() => handlePaymentLink(c)}
                            disabled={busy || c.agreementStatus !== "signed"}
                          >
                            Payment link
                          </button>
                        )}
                        {/* Owner cockpit A — owner Leads tab only: quick Lost /
                            DNC flags (same update path as the stage picker);
                            the pipeline-row Archive action is removed per the
                            owner (archiving lives on the Clients directory and
                            the Onboarding tab). Client accounts keep their
                            Archive row action exactly as before. */}
                        {ownerLeadsTab && (
                          <button
                            className="icon-btn"
                            title="Mark as lost — moves the lead to the Lost section"
                            aria-label={`Mark ${c.companyName} as lost`}
                            onClick={() => handleFlag(c, "lost")}
                            disabled={busy}
                          >
                            Lost
                          </button>
                        )}
                        {ownerLeadsTab && (
                          <button
                            className="icon-btn"
                            title={c.dnc ? "Clear the do-not-call flag" : "Mark do-not-call"}
                            aria-label={c.dnc ? `Clear DNC for ${c.companyName}` : `Mark ${c.companyName} as DNC`}
                            onClick={() => handleFlag(c, "dnc")}
                            disabled={busy}
                          >
                            DNC
                          </button>
                        )}
                        {canEdit && (
                          <button
                            className="icon-btn danger"
                            title="Delete"
                            aria-label={`Delete ${c.companyName}`}
                            onClick={() => setDeleting(c)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ClientModal
          client={modal.mode === "edit" ? modal.client : undefined}
          stages={orgStages}
          customFieldDefs={customFieldDefs}
          intake={intake}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
      {stageModal && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Manage pipeline stages">
          <div className="modal modal-lg">
            <div className="modal-head">
              <h2>
                Manage <em className="serif">stages</em>
              </h2>
              <button className="icon-btn" onClick={() => setStageModal(false)} aria-label="Close" disabled={busy}>
                ✕
              </button>
            </div>
            <div className="modal-form">
              <p className="field-hint">
                Rename, reorder and shape your pipeline. Renaming a stage keeps its clients;
                removing one is blocked while clients are still in it.
              </p>
              <StageEditor
                initialStages={orgStages}
                stageCounts={stageCounts}
                canEdit={canEdit}
                onSaved={() => {
                  setStageModal(false);
                  load();
                }}
              />
            </div>
          </div>
        </div>
      )}
      {sendNotice && (
        <div
          className={sendNotice.kind === "success" ? "alert alert-success" : "alert alert-warn"}
          role={sendNotice.kind === "success" ? "status" : "alert"}
        >
          {sendNotice.text}
          {sendNotice.signUrl && (
            <p className="created-line">
              Signing link: <code className="sign-url">{sendNotice.signUrl}</code> — copy it and
              send it to the client manually.
            </p>
          )}
        </div>
      )}
      {payNotice && (
        <div
          className={payNotice.kind === "success" ? "alert alert-success" : "alert alert-warn"}
          role={payNotice.kind === "success" ? "status" : "alert"}
        >
          {payNotice.text}
        </div>
      )}
      {(audit || auditError) && (
        <div className="modal-overlay" onClick={() => { setAudit(null); setAuditError(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Agreement details">
            <div className="modal-head">
              <h3>
                Agreement <em className="serif">details</em>
              </h3>
            </div>
            <div className="modal-body">
              {auditError ? (
                <p className="cell-muted">{auditError}</p>
              ) : audit ? (
                <div className="audit-grid">
                  <p><span>Client</span>{audit.clientName}</p>
                  <p><span>Status</span>{AGREEMENT_META[audit.status].label}</p>
                  {audit.signerName && <p><span>Signed by</span>{audit.signerName}</p>}
                  {audit.signedAt && <p><span>Signed at</span>{new Date(audit.signedAt).toLocaleString()}</p>}
                  {audit.ipAddress && <p><span>IP address</span>{audit.ipAddress}</p>}
                  <p><span>Consent</span>{audit.consent ? "Explicit consent recorded" : "No consent recorded"}</p>
                  <p><span>Link expires</span>{new Date(audit.expiresAt).toLocaleString()}</p>
                  <p><span>PDF</span><a href={`/agreement-pdf/${audit.pdfId}`} target="_blank" rel="noreferrer">Open agreement PDF</a></p>
                </div>
              ) : null}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => { setAudit(null); setAuditError(null); }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete client?"
          entity={deleting.companyName}
          note={
            <p className="confirm-delete-note">
              Archive the record instead if you want to keep it.
            </p>
          }
          confirmLabel="Delete permanently"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
