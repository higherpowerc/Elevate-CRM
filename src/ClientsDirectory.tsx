import { useCallback, useEffect, useMemo, useState } from "react";
/* Owner direction 2026-08-18 — the "Payment link" action MOVED from this
   Clients tab to the OWNER's Onboarding tab (src/Clients.tsx, scope
   "middle"). The ApiError value-import + handlePaymentLink now live there
   (same value-import pattern, live-test finding 2026-08-17). */
import { api, type ClientInput } from "./api";
import { money, type Client, type CustomFieldDef, type DashboardData, type Stage } from "./types";
import type { IntakeOrgSettings } from "./intakeRules";
import { ServiceChips } from "./bits";
import { usePii, blurPii } from "./pii";
import ClientModal from "./ClientModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import Accounts from "./Accounts";

interface Props {
  /** The tenant's ordered pipeline stages — needed by the shared client
   *  record modal. The directory's terminal (last) stage defines its set:
   *  only sold clients live here. Refreshed from /api/settings on load so a
   *  stage rename made in Settings applies to this tab immediately. */
  stages: Stage[];
  /** Owner request 2026-08-14: THIS tab is the independent client directory —
   *  the owner explicitly asked for a "Clients" tab. Owner request
   *  2026-08-15: the tab reads "Clients" in every workspace — owner and
   *  client accounts alike (the member-org "All clients" variant is gone).
   *  Purely presentational; data untouched. */
  ownerOrg?: boolean;
  /** Team-users UI (owner request 2026-08-14) — false for a restricted member
   *  with view-only "clients" access: the create/edit/archive/delete
   *  affordances are hidden (the server still 403s any write). Owner and org
   *  admins always pass true. */
  canEdit?: boolean;
  /** Owner live-test reorg 2026-08-18 — client-account management lives on
   *  THIS tab now (the owner's Clients tab is the single hub): the owner's
   *  org id (its own workspace is filtered out of the accounts list) and the
   *  impersonation callback ("View CRM" on an account). Only used when
   *  ownerOrg is true. */
  ownerOrgId?: number;
  onViewAccount?: (orgId: number) => Promise<void>;
}

/** The sold-customer directory (owner request 2026-08-14): every client in
 *  the account's TERMINAL pipeline stage (the last entry of the ordered
 *  stages — renamed-safe, never hardcoded "Sold") — the sold customers — with
 *  an Archived badge where applicable. No stage filtering and no
 *  Active/Archived segmentation: the sold set is shown, sorted
 *  alphabetically, with the rich client-record modal (edit/create — a new
 *  record lands in the terminal stage), archive/unarchive and delete. Reads
 *  the same /api/clients (per-org scoped) as the Leads pipeline tab —
 *  filtering happens client-side. For the OWNER this tab ALSO hosts the
 *  Accounts panel (create / view / reset password / delete client accounts —
 *  the account management moved here from Administration on 2026-08-18). */
export default function ClientsDirectory({ stages, ownerOrg = false, canEdit = true, ownerOrgId, onViewAccount }: Props) {
  /* Global privacy eye (2026-08-14 owner request) — blur client
     names/addresses/contact details in the directory rows. */
  const pii = usePii();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  /* Local copy of the tenant's stages, refreshed from the settings endpoint
     so a stage rename/reorder in Settings applies to the terminal-stage
     membership of this tab immediately. */
  const [orgStages, setOrgStages] = useState<Stage[]>(stages);
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
  const [error, setError] = useState<string | null>(null);
  /* Owner request 2026-08-14/15 — the owner's Clients tab (sold-customer
     directory) leads with the Client MRR KPI: sum of the owner's own client
     records' deal values in the terminal/"Sold" stage (paying clients sold),
     excluding lost and archived records. The dashboard endpoint returns
     clientMrr ONLY for admin sessions, so members never fetch it. */
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; client: Client } | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);

  /* Owner workflow views (2026-08-25) — "Sold · no account yet": every SOLD
     (terminal-stage) client who has no provisioned workspace yet
     (provisioned_org_id 0) — sold regardless of whether they've paid — still
     needs the owner to build their account. The "Build account" action reuses
     the shared sold-lead provisioning path. Computed lazily below (needs
     terminalStage). */
  const [buildingId, setBuildingId] = useState<number | null>(null);
  const [buildNotice, setBuildNotice] = useState<string | null>(null);
  async function handleBuildAccount(c: Client) {
    setBuildingId(c.id);
    setError(null);
    setBuildNotice(null);
    try {
      const r = await api.adminProvisionClient(c.id);
      setBuildNotice(`Account built for ${c.companyName} — login sent to ${r.email}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build this account.");
    } finally {
      setBuildingId(null);
    }
  }

  /** Loads the FULL client list (active AND archived) plus org settings —
   *  the directory filters it to the terminal stage client-side. */
  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ clients }, { settings }] = await Promise.all([api.clients(true), api.settings()]);
      setClients(clients);
      setCustomFieldDefs(settings.customFields);
      setOrgStages(settings.stages);
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

  /* Privacy eye (3m pattern): same localStorage key as the Dashboard so the
     blur choice carries across tabs. Money visible by default. */
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
      /* storage unavailable — the toggle just won't persist */
    }
  }, [moneyHidden]);

  useEffect(() => {
    if (!ownerOrg) return;
    api
      .dashboard()
      .then(setDash)
      .catch(() => setDash(null));
  }, [ownerOrg]);

  /* Terminal stage = LAST entry of the org's ordered stages (positional —
     renamed-safe). Only clients in this stage are shown. */
  const terminalStage = orgStages.length > 0 ? orgStages[orgStages.length - 1] : "";

  /** Only terminal-stage (sold) clients, filtered by the search box —
   *  archived rows stay visible (with their badge) rather than being
   *  segmented away. A directory sorts alphabetically by name. */
  const visible = useMemo(() => {
    if (!clients) return [];
    const q = query.trim().toLowerCase();
    const sold = clients.filter((c) => c.stage === terminalStage);
    const rows = q
      ? sold.filter((c) =>
          [
            c.companyName,
            c.contactName,
            c.email,
            c.phone,
            c.industry,
            c.address,
            c.city,
            c.state,
            c.zip,
            c.website,
            c.leadSource,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : sold;
    return [...rows].sort((a, b) => a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" }));
  }, [clients, query, terminalStage]);

  /* Sold-but-unbuilt (owner direction 2026-08-25): every CLIENT who reached
     the terminal ("sold") stage yet has no provisioned workspace
     (provisioned_org_id 0) — sold regardless of payment status. These still
     need the owner to build their account. (Declared BEFORE the early
     returns below so the hook order never changes between the loading and
     loaded renders — a hook after the `if (!clients)` return crashed the
     whole app with a Rules-of-Hooks violation on the owner Clients tab.) */
  const soldUnbuilt = useMemo(
    () =>
      ownerOrg && clients
        ? clients.filter(
            (c) => c.stage === terminalStage && (c.provisionedOrgId ?? 0) === 0 && !c.lost,
          )
        : [],
    [ownerOrg, clients, terminalStage],
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
  /* Owner direction 2026-08-26 — "Mark lost": a SOFT terminal state. The
     client stays in the system (restorable from the Dashboard Lost window)
     but drops out of every active pipeline count (Sold stage, Sold MRR,
     sold-unbuilt). Spreads the freshly-loaded record with lost flipped on —
     the same payload shape the rest of the app uses for edits (the server
     requires companyName + clientType on every PUT and writes a column only
     when present in the body). */
  async function handleMarkLost(c: Client) {
    setBusy(true);
    setError(null);
    try {
      await api.updateClient(c.id, { ...c, lost: true } as Parameters<typeof api.updateClient>[1]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark this client lost.");
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

  /* Owner 2026-08-20 sales rework — "I don't want a clients sold bin there
     should only be a client accounts tab." The OWNER's Clients tab is now the
     CLIENT ACCOUNTS list (the Accounts panel / workspace directory) — NOT the
     terminal-stage "sold customers" table. The reminder that the pipeline
     still HAS a terminal stage (and that sold records live there) is handled
     by the Onboarding → terminal flow; this tab no longer renders a sold
     directory. Client ACCOUNTS (role=member) keep the original sold-customer
     directory below — that is *their* widgets. */
  if (ownerOrg) {
    return (
      <div className="page page-stack">
        <div className="page-head">
          <div>
            <h1>
              Client accounts{" "}
              <em className="serif">— the client list</em>
            </h1>
            <p className="page-sub">
              Every sold client in your book — account built or not — plus the account workspace list
              below. Create one, open a client's CRM, or reset/delete. Build an account for any sold
              client that doesn't have one yet.
            </p>
          </div>
        </div>
        {ownerOrg && soldUnbuilt.length > 0 && (
          <div className="card paid-unbuilt">
            <div className="admin-card-head">
              <h2 className="h3 admin-card-title">
                <em className="serif">Sold</em> · no account yet
              </h2>
              <p className="admin-card-sub">
                These sold clients don't have a CRM workspace yet — build their account below.
              </p>
            </div>
            <ul className="inv-list" style={{ margin: 0 }}>
              {soldUnbuilt.map((c) => (
                <li key={c.id} className="inv">
                  <div className="inv-body">
                    <div className="inv-client">
                      <span className={`chip${blurPii(pii)}`}>{c.companyName}</span>
                      {c.paymentStatus === "paid" ? (
                        <span className="inv-notes">Paid · no account yet</span>
                      ) : (
                        <span className="inv-notes">Sold · no account yet</span>
                      )}
                      {/* Owner 2026-08-27 — the deal value on every
                          sold-unbuilt row (money at a glance, matching the
                          accounts table's Deal value column). */}
                      <span className="inv-notes" title="Deal value">
                        Deal {money(c.dealValue)}
                      </span>
                    </div>
                  </div>
                  <div className="row-actions">
                    <button
                      className="icon-btn"
                      onClick={() => handleBuildAccount(c)}
                      disabled={buildingId !== null}
                    >
                      {buildingId === c.id ? "Building…" : "Build account"}
                    </button>
                    <button
                      className="icon-btn"
                      title="Mark lost — removes from the active pipeline (restorable from the Dashboard Lost window)"
                      aria-label={`Mark ${c.companyName} lost`}
                      onClick={() => handleMarkLost(c)}
                      disabled={busy}
                    >
                      Mark lost
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {buildNotice && (
          <div className="alert alert-success" role="status">
            {buildNotice}
          </div>
        )}
        {ownerOrgId && onViewAccount && <Accounts ownerOrgId={ownerOrgId} onViewAccount={onViewAccount} />}
      </div>
    );
  }

  /* The sold set (terminal-stage clients) — drives the header counts, the
     empty state and the (tenant-only, owner direction 2026-08-15) "+ New
     client" default stage. */
  const sold = clients.filter((c) => c.stage === terminalStage);
  const archived = sold.filter((c) => c.archived).length;
  const bookValue = sold.reduce((sum, c) => sum + (c.dealValue || 0), 0);

  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p className="page-sub">
            {sold.length} {sold.length === 1 ? "client" : "clients"} · {archived} archived · book value{" "}
            <strong>{money(bookValue)}</strong>
          </p>
        </div>
        {/* Owner direction 2026-08-15 — client/lead creation entry points
            are fixed: the ONLY place to add a client is the Admin tab's
            "create client account" form, and the ONLY place to add a lead is
            the Leads tab. The owner's Clients directory therefore carries no
            "+ New client" entry point. Client accounts keep this button —
            their directory is their own sold customers and the CTA is part
            of their workspace (untouched). */}
        {!ownerOrg && canEdit && (
          <div className="page-actions">
            {/* A new record added from the sold-customer directory is created
                pre-set to the terminal stage — the natural meaning of adding to
                a sold/customers list. */}
            <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
              + New client
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Owner request 2026-08-14 — Client MRR on the owner's Clients tab,
          with the same blur/eye treatment as the dashboard money figures. */}
      {ownerOrg && (
        <div className="kpi-row">
          <div className="card kpi">
            <span className="kpi-label kpi-label-row">
              Client MRR
              <button
                type="button"
                className="eye-btn"
                onClick={() => setMoneyHidden((v) => !v)}
                aria-label={moneyHidden ? "Show amounts" : "Hide amounts"}
                aria-pressed={moneyHidden}
                title={moneyHidden ? "Show amounts" : "Hide amounts"}
              >
                {moneyHidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </span>
            <span className={`kpi-value lime${moneyHidden ? " money-blur" : ""}`}>
              {money(dash?.clientMrr ?? 0)}
            </span>
            <span className="kpi-note">Deal value of sold clients — records in your last pipeline stage</span>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search company, contact, phone, address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />
      </div>

      {visible.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">{sold.length === 0 ? "No sold clients yet" : "Nothing matches"}</p>
          <p className="empty-sub">
            {sold.length === 0
              ? "Move a client into your final pipeline stage and it shows up here — this directory holds your sold customers."
              : "Try a different search — sold clients are listed here."}
          </p>
          {sold.length === 0 && !ownerOrg && canEdit && (
            <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
              + New client
            </button>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table clients-table">
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Client/business name</th>
                <th>Address</th>
                <th>Contact</th>
                <th>Services</th>
                <th className="num">Deal</th>
                <th className="actions-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const fullAddress = [c.address, c.city, c.state, c.zip].filter(Boolean).join(", ");
                return (
                  <tr key={c.id} className={c.archived ? "row-archived" : ""}>
                    <td className="cell-strong" data-label="Client/business name">
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
                    </td>
                    <td data-label="Address">
                      {fullAddress ? (
                        <div className={`cell-sub addr-line${blurPii(pii)}`} title={fullAddress}>
                          {fullAddress}
                        </div>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                    <td data-label="Contact">
                      <div className="cell-contact">
                        {c.email && <div className={`cell-sub${blurPii(pii)}`} title={c.email}>{c.email}</div>}
                        {c.phone && <div className={`cell-sub${blurPii(pii)}`} title={c.phone}>{c.phone}</div>}
                        {!c.email && !c.phone && <span className="cell-muted">—</span>}
                      </div>
                    </td>
                    <td data-label="Services">
                      <ServiceChips services={c.services} />
                    </td>
                    <td className="num cell-strong" data-label="Deal">
                      {money(c.dealValue)}
                    </td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        {canEdit && (
                          <button className="icon-btn" title="Edit" aria-label={`Edit ${c.companyName}`} onClick={() => setModal({ mode: "edit", client: c })}>
                            Edit
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ownerOrg && ownerOrgId && onViewAccount && (
        /* Owner live-test reorg 2026-08-18 — the owner's Clients tab is the
           single hub for ACCOUNT management: provision a workspace, view a
           client's CRM, reset a password, or delete an account. The records
           directory above stays the heart of the tab. */
        <Accounts ownerOrgId={ownerOrgId} onViewAccount={onViewAccount} />
      )}

      {modal && (
        <ClientModal
          client={modal.mode === "edit" ? modal.client : undefined}
          stages={orgStages}
          defaultStage={terminalStage}
          customFieldDefs={customFieldDefs}
          intake={intake}
          ownerOrg={ownerOrg}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
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
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
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
