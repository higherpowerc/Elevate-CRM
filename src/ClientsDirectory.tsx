import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ClientInput } from "./api";
import { money, type Client, type CustomFieldDef, type DashboardData, type Stage } from "./types";
import type { IntakeOrgSettings } from "./intakeRules";
import { ServiceChips } from "./bits";
import { usePii, blurPii } from "./pii";
import ClientModal from "./ClientModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

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
}

/** The sold-customer directory (owner request 2026-08-14): every client in
 *  the account's TERMINAL pipeline stage (the last entry of the ordered
 *  stages — renamed-safe, never hardcoded "Sold") — the sold customers — with
 *  an Archived badge where applicable. No stage filtering and no
 *  Active/Archived segmentation: the sold set is shown, sorted
 *  alphabetically, with the rich client-record modal (edit/create — a new
 *  record lands in the terminal stage), archive/unarchive and delete. Reads
 *  the same /api/clients (per-org scoped) as the Leads pipeline tab —
 *  filtering happens client-side. */
export default function ClientsDirectory({ stages, ownerOrg = false }: Props) {
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

  if (!clients) {
    return error ? (
      <div className="alert alert-error">{error}</div>
    ) : (
      <div className="skeleton-block" aria-label="Loading clients" />
    );
  }

  /* The sold set (terminal-stage clients) — drives the header counts, the
     empty state and the (tenant-only, owner direction 2026-08-15) "+ New
     client" default stage. */
  const sold = clients.filter((c) => c.stage === terminalStage);
  const archived = sold.filter((c) => c.archived).length;
  const bookValue = sold.reduce((sum, c) => sum + (c.dealValue || 0), 0);

  return (
    <div className="page">
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
        {!ownerOrg && (
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
          {sold.length === 0 && !ownerOrg && (
            <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
              + New client
            </button>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table clients-table">
            <colgroup>
              <col style={{ width: "30%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "24%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Client</th>
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
          defaultStage={terminalStage}
          customFieldDefs={customFieldDefs}
          intake={intake}
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
          confirmLabel="Delete permanently"
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
