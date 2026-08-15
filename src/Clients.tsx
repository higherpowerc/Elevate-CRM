import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api, type ClientInput } from "./api";
import { money, fmtDate, type Client, type CustomFieldDef, type Stage } from "./types";
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
}

/** Short value label for a custom field chip, rendered per field type
 *  (Phase 3b): dates are formatted, checkboxes become ✓/✕, numbers stay raw. */
function cfChipLabel(def: CustomFieldDef, value: string): string {
  if (def.type === "checkbox") return value === "1" ? "✓" : "✕";
  if (def.type === "date") return fmtDate(value);
  return value;
}

export default function Clients({ stages, scope = "all", ownerOrg = false, initialStage = null }: Props) {
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
          <button className="btn btn-ghost" onClick={() => setStageModal(true)} title="Rename, reorder or remove your pipeline stages">
            Manage stages
          </button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
            {addCta}
          </button>
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
          {scoped.length === 0 && filter !== "lost" && filter !== "dnc" && (
            <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
              {emptyCta}
            </button>
          )}
        </div>
      ) : filter === "lost" || filter === "dnc" ? (
        /* Owner request 2026-08-14 — the Lost section / DNC list. Lost rows
           show the lost reason + a "Restore to pipeline" action (clears the
           flag); DNC rows carry the warning banner inline. Both share the
           stage chip filter and the search box with the pipeline table. */
        <div className="card table-wrap">
          <table className="table clients-table">
            <colgroup>
              <col style={{ width: "26%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "38%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Client</th>
                <th>Stage</th>
                <th>{filter === "lost" ? "Lost reason" : "Do-not-contact"}</th>
                <th className="actions-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className={c.archived ? "row-archived" : ""}>
                  <td className="cell-strong" data-label="Client">
                    <div className="cell-company">
                      <span className={`cell-name${blurPii(pii)}`} title={c.companyName}>
                        {c.companyName}
                      </span>
                      {c.lost && <span className="chip chip-lost">Lost</span>}
                      {c.dnc && <span className="chip chip-dnc">DNC</span>}
                      {c.archived && <span className="chip chip-archived">archived</span>}
                    </div>
                    {c.industry && <div className="cell-sub">{c.industry}</div>}
                  </td>
                  <td data-label="Stage">
                    <StageBadge stage={c.stage} index={Math.max(0, orgStages.indexOf(c.stage))} />
                  </td>
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
                      <button
                        className="icon-btn"
                        title="Edit"
                        aria-label={`Edit ${c.companyName}`}
                        onClick={() => setModal({ mode: "edit", client: c })}
                      >
                        Edit
                      </button>
                      {filter === "lost" && (
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
                      <button
                        className="icon-btn"
                        title={c.archived ? "Unarchive" : "Archive"}
                        aria-label={c.archived ? "Unarchive" : "Archive"}
                        onClick={() => handleArchive(c)}
                      >
                        {c.archived ? "Restore" : "Archive"}
                      </button>
                      <button
                        className="icon-btn danger"
                        title="Delete"
                        aria-label={`Delete ${c.companyName}`}
                        onClick={() => setDeleting(c)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table clients-table">
            <colgroup>
              <col style={{ width: "21%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Services</th>
                <th className="num">Deal</th>
                <th>Stage</th>
                <th>Next action</th>
                <th className="actions-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const fullAddress = [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");
                return (
                  <tr key={c.id} className={c.archived ? "row-archived" : ""}>
                    <td className="cell-strong" data-label="Client">
                      <div className="cell-company">
                        <span className={`cell-name${blurPii(pii)}`} title={c.companyName}>
                          {c.companyName}
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
                        <span className={pii ? "pii-blur" : undefined}>{c.contactName || "—"}</span>
                        {c.email && <div className={`cell-sub${blurPii(pii)}`} title={c.email}>{c.email}</div>}
                        {c.phone && <div className={`cell-sub${blurPii(pii)}`} title={c.phone}>{c.phone}</div>}
                      </div>
                    </td>
                    <td data-label="Services">
                      <ServiceChips services={c.services} />
                    </td>
                    <td className="num cell-strong" data-label="Deal">
                      {money(c.dealValue)}
                    </td>
                    <td data-label="Stage">
                      <div className="stage-cell">
                        <StageBadge stage={c.stage} index={Math.max(0, orgStages.indexOf(c.stage))} />
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
                      </div>
                    </td>
                    <td className="cell-muted cell-next" data-label="Next action" title={c.nextAction || undefined}>
                      {c.nextAction || "—"}
                    </td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        <button className="icon-btn" title="Edit" aria-label={`Edit ${c.companyName}`} onClick={() => setModal({ mode: "edit", client: c })}>
                          Edit
                        </button>
                        <button
                          className="icon-btn"
                          title={c.archived ? "Unarchive" : "Archive"}
                          aria-label={c.archived ? "Unarchive" : "Archive"}
                          onClick={() => handleArchive(c)}
                        >
                          {c.archived ? "Restore" : "Archive"}
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Delete"
                          aria-label={`Delete ${c.companyName}`}
                          onClick={() => setDeleting(c)}
                        >
                          Delete
                        </button>
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
          /* Owner request 2026-08-15 — "+ New lead" defaults to the bucket's
             first stage: the owner Leads tab → stages[0], the owner
             Onboarding tab → the FIRST MIDDLE stage (stages[1]). The tenant
             pipeline and the old default already land on stages[0]. */
          defaultStage={scope === "middle" ? orgStages[1] : undefined}
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
                onSaved={() => {
                  setStageModal(false);
                  load();
                }}
              />
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
