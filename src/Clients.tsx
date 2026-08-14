import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api, type ClientInput } from "./api";
import { money, fmtDate, type Client, type CustomFieldDef, type Stage } from "./types";
import type { IntakeOrgSettings } from "./intakeRules";
import { StageBadge, ServiceChips } from "./bits";
import ClientModal from "./ClientModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import StageEditor from "./StageEditor";

type Filter = "active" | "archived" | "all";

interface Props {
  /** The tenant's ordered pipeline stages — the stage column dropdown and
   *  badge tones are driven by this list (Phase 3a). Refreshed from
   *  /api/settings on every load so a stage change made through the "Manage
   *  stages" shortcut shows up immediately. */
  stages: Stage[];
  /** Owner workspace (role=admin org) — owner direction 2026-08-14: the
   *  owner calls its pipeline records "leads", so this page's headings, CTA
   *  and empty states read "Lead(s)" instead of "Client(s)". Tenant orgs
   *  (role=member) keep "Clients" everywhere — that tab holds their
   *  customers. Purely presentational; data and stages are untouched. */
  ownerOrg?: boolean;
}

/** Short value label for a custom field chip, rendered per field type
 *  (Phase 3b): dates are formatted, checkboxes become ✓/✕, numbers stay raw. */
function cfChipLabel(def: CustomFieldDef, value: string): string {
  if (def.type === "checkbox") return value === "1" ? "✓" : "✕";
  if (def.type === "date") return fmtDate(value);
  return value;
}

export default function Clients({ stages, ownerOrg = false }: Props) {
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
  // Local copy of the tenant's stages + per-stage counts, refreshed from the
  // settings endpoint (already fetched for custom fields) so stage changes
  // made in the "Manage stages" shortcut apply to this page immediately.
  const [orgStages, setOrgStages] = useState<Stage[]>(stages);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [stageModal, setStageModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
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

  const visible = useMemo(() => {
    if (!clients) return [];
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      const matchFilter =
        filter === "all" ? true : filter === "archived" ? c.archived : !c.archived;
      if (!matchFilter) return false;
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
    });
  }, [clients, filter, query]);

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

  if (!clients) {
    return error ? (
      <div className="alert alert-error">{error}</div>
    ) : (
      <div className="skeleton-block" aria-label="Loading clients" />
    );
  }

  const counts = {
    active: clients.filter((c) => !c.archived).length,
    archived: clients.filter((c) => c.archived).length,
  };

  /* Owner workspace labels its pipeline records "leads" (owner direction
     2026-08-14); tenant orgs keep "clients". Same page, same data — only
     the visible wording differs. */
  const heading = ownerOrg ? "Leads" : (<>
    Client <em className="serif">book</em>
  </>);
  const addCta = ownerOrg ? "+ New lead" : "+ New client";
  const emptyTitle = ownerOrg ? "No leads yet" : "No clients yet";
  const emptySub = ownerOrg
    ? "Add your first lead to start tracking the pipeline."
    : "Add your first client to start tracking the pipeline.";
  const emptyCta = ownerOrg ? "Add your first lead" : "Add your first client";

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
          {(["active", "archived", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? "seg-btn active" : "seg-btn"}
              onClick={() => setFilter(f)}
            >
              {f === "active" ? "Active" : f === "archived" ? "Archived" : "All"}
              <span className="seg-count">
                {f === "active" ? counts.active : f === "archived" ? counts.archived : clients.length}
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
      </div>

      {visible.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">{clients.length === 0 ? emptyTitle : "Nothing matches"}</p>
          <p className="empty-sub">
            {clients.length === 0
              ? emptySub
              : "Try a different search or filter."}
          </p>
          {clients.length === 0 && (
            <button className="btn btn-primary" onClick={() => setModal({ mode: "create" })}>
              {emptyCta}
            </button>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table clients-table">
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
                        {c.companyName}
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
                        {c.contactName || "—"}
                        {c.email && <div className="cell-sub">{c.email}</div>}
                        {c.phone && <div className="cell-sub">{c.phone}</div>}
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
                    <td className="cell-muted cell-next" data-label="Next action">
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
