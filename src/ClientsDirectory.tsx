import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ClientInput } from "./api";
import { money, type Client, type CustomFieldDef, type Stage } from "./types";
import type { IntakeOrgSettings } from "./intakeRules";
import { ServiceChips } from "./bits";
import ClientModal from "./ClientModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

interface Props {
  /** The tenant's ordered pipeline stages — needed by the shared client
   *  record modal (a new record lands in the first stage). */
  stages: Stage[];
  /** Owner workspace (role=admin org) — owner direction 2026-08-14: the
   *  owner calls its pipeline records "leads", so the pipeline tab reads
   *  "Leads". THIS tab is the independent client directory — the owner
   *  explicitly asked for a "Clients" tab, and tenant orgs (role=member)
   *  keep "clients" wording everywhere (their tab reads "All clients").
   *  Purely presentational; data untouched. */
  ownerOrg?: boolean;
}

/** The independent client directory (owner request 2026-08-14): every client
 *  in the org regardless of pipeline stage — sold, archived, all of them, at
 *  a glance with an Archived badge where applicable. No stage filtering and
 *  no Active/Archived segmentation: the whole book is shown, sorted
 *  alphabetically, with the rich client-record modal (edit/create), archive/
 *  unarchive and delete. Reads the same /api/clients (per-org scoped) as the
 *  Leads pipeline tab — filtering happens client-side. */
export default function ClientsDirectory({ stages, ownerOrg = false }: Props) {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  /* Adaptive intake Phase 1/2: the org's account-level vertical config —
     drives which sections the client form shows. Loaded with settings. */
  const [intake, setIntake] = useState<IntakeOrgSettings>({
    industry: "",
    serviceModel: "both",
    deliveryType: "both",
    intakeOpts: [],
    customIntakeGroups: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; client: Client } | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);

  /** Loads the FULL client list (active AND archived) plus org settings —
   *  the directory shows every client, so unlike the pipeline tab there is no
   *  client-side archive filter at all. */
  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ clients }, { settings }] = await Promise.all([api.clients(true), api.settings()]);
      setClients(clients);
      setCustomFieldDefs(settings.customFields);
      setIntake({
        industry: settings.industry,
        serviceModel: settings.serviceModel,
        deliveryType: settings.deliveryType,
        intakeOpts: settings.intakeOpts,
        customIntakeGroups: settings.customIntakeGroups,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clients.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Every client in the book, filtered by the search box only — archived
   *  rows stay visible (with their badge) rather than being segmented away.
   *  A directory sorts alphabetically by name. */
  const visible = useMemo(() => {
    if (!clients) return [];
    const q = query.trim().toLowerCase();
    const rows = q
      ? clients.filter((c) =>
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
      : clients;
    return [...rows].sort((a, b) => a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" }));
  }, [clients, query]);

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

  const archived = clients.filter((c) => c.archived).length;
  const bookValue = clients.reduce((sum, c) => sum + (c.dealValue || 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{ownerOrg ? "Clients" : "All clients"}</h1>
          <p className="page-sub">
            {clients.length} clients · {archived} archived · book value{" "}
            <strong>{money(bookValue)}</strong>
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
            + New client
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
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
          <p className="empty-title">{clients.length === 0 ? "No clients yet" : "Nothing matches"}</p>
          <p className="empty-sub">
            {clients.length === 0
              ? "Add your first client and it shows up here — every client in the book, in every stage, at a glance."
              : "Try a different search — every client in the book is listed here."}
          </p>
          {clients.length === 0 && (
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
                        <span className="cell-name" title={c.companyName}>
                          {c.companyName}
                        </span>
                        <span className={`badge type-badge tone-${c.clientType === "commercial" ? "blue" : "teal"}`}>
                          {c.clientType === "commercial" ? "Commercial" : "Individual"}
                        </span>
                        {c.archived && <span className="chip chip-archived">archived</span>}
                      </div>
                      {c.industry && <div className="cell-sub">{c.industry}</div>}
                      {fullAddress && (
                        <div className="cell-sub addr-line" title={fullAddress}>
                          {fullAddress}
                        </div>
                      )}
                    </td>
                    <td data-label="Contact">
                      <div className="cell-contact">
                        {c.contactName || "—"}
                        {c.email && <div className="cell-sub" title={c.email}>{c.email}</div>}
                        {c.phone && <div className="cell-sub" title={c.phone}>{c.phone}</div>}
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
          stages={stages}
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
