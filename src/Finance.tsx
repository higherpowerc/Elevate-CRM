import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, type InvoiceInput } from "./api";
import { usePii, blurPii } from "./pii";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_TONE,
  fmtDate,
  invoiceStatusLabel,
  money,
  type Client,
  type Invoice,
  type InvoiceStatus,
} from "./types";
import InvoiceModal from "./InvoiceModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import SearchableSelect from "./SearchableSelect";

type Filter = "all" | InvoiceStatus;

/** Local YYYY-MM-DD so `<input type="date">` values compare correctly. */
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Overdue is computed, not stored: a sent invoice past its due date. */
function isOverdue(inv: Invoice): boolean {
  return inv.status === "sent" && !!inv.dueDate && inv.dueDate < localToday();
}

export default function Finance({ canEdit = true }: { canEdit?: boolean }) {
  /* Team-users UI (owner request 2026-08-14) — false for a restricted member
     with view-only "finance" access: the add/status/edit/delete affordances
     are hidden (the server still 403s any write). Owner and org admins
     always pass true. */
  /* Global privacy eye (2026-08-14 owner request) — blur PII (client/company names, phone, email, address) here too. */
  const pii = usePii();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // Quick-add row
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("draft");
  const amountRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ invoices }, { clients }] = await Promise.all([api.invoices(), api.clients(true)]);
      setInvoices(invoices);
      setClients(clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoices.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (!invoices) return [];
    const q = query.trim().toLowerCase();
    return invoices.filter((i) => {
      const matchFilter = filter === "all" || i.status === filter;
      if (!matchFilter) return false;
      if (!q) return true;
      // Match by client name (case-insensitive); invoices with no client
      // surface only under the "unassigned" keyword.
      if (i.clientName) return i.clientName.toLowerCase().includes(q);
      return q === "unassigned";
    });
  }, [invoices, filter, query]);

  /** Clients whose name matches the search query — used to hint the empty
   *  state when a search finds no invoices but does match a client. */
  const clientMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return clients.filter((c) => c.companyName.toLowerCase().includes(q));
  }, [clients, query]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: invoices?.length ?? 0, draft: 0, sent: 0, paid: 0 };
    if (invoices) {
      for (const i of invoices) c[i.status] += 1;
    }
    return c;
  }, [invoices]);

  const totals = useMemo(() => {
    let invoiced = 0;
    let paid = 0;
    let outstanding = 0;
    let overdue = 0;
    if (invoices) {
      for (const i of invoices) {
        invoiced += i.amount;
        if (i.status === "paid") paid += i.amount;
        if (i.status === "sent") {
          outstanding += i.amount;
          if (isOverdue(i)) overdue += i.amount;
        }
      }
    }
    return { invoiced, paid, outstanding, overdue };
  }, [invoices]);

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    const a = Number(amount);
    if (!amount.trim() || !Number.isFinite(a) || a <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createInvoice({
        clientId: clientId === "" ? null : Number(clientId),
        amount: a,
        status,
        dueDate: dueDate.trim(),
      });
      setClientId("");
      setAmount("");
      setDueDate("");
      setStatus("draft");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(inv: Invoice, next: InvoiceStatus) {
    setBusy(true);
    setError(null);
    try {
      await api.updateInvoice(inv.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(data: Partial<InvoiceInput>, editing: Invoice) {
    setBusy(true);
    setError(null);
    try {
      await api.updateInvoice(editing.id, data);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteInvoice(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!invoices) {
    return error ? (
      <div className="alert alert-error">{error}</div>
    ) : (
      <div className="skeleton-block" aria-label="Loading invoices" />
    );
  }

  const totalCount = invoices.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            <em className="serif">Finance</em> ledger
          </h1>
          <p className="page-sub">
            {totalCount} invoice{totalCount === 1 ? "" : "s"} · {money(totals.outstanding)} outstanding
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="kpi-row kpi-row-4">
        <div className="card kpi">
          <span className="kpi-label">Total invoiced</span>
          <span className="kpi-value lime">{money(totals.invoiced)}</span>
          <span className="kpi-note">Draft + sent + paid amounts</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Paid</span>
          <span className="kpi-value green">{money(totals.paid)}</span>
          <span className="kpi-note">Marked paid — money in</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Outstanding</span>
          <span className="kpi-value">{money(totals.outstanding)}</span>
          <span className="kpi-note">Sent, not yet paid</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Overdue</span>
          <span className="kpi-value red">{money(totals.overdue)}</span>
          <span className="kpi-note">Sent, past due date</span>
        </div>
      </div>

      {canEdit && (
      <form className="card inv-add" onSubmit={handleQuickAdd}>
        <SearchableSelect
          piiBlur={pii}
          className="inv-add-client"
          value={clientId}
          onChange={setClientId}
          options={clients.map((c) => ({
            value: String(c.id),
            label: c.companyName + (c.archived ? " (archived)" : ""),
          }))}
          placeholder="Search clients…"
          ariaLabel="Invoice client"
          emptyLabel="No client"
        />
        <div className="inv-add-amount">
          <span className="inv-dollar" aria-hidden="true">
            $
          </span>
          <input
            type="number"
            ref={amountRef}
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-label="Invoice amount"
          />
        </div>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Invoice due date"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
          aria-label="Invoice status"
        >
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {invoiceStatusLabel(s)}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={busy}>
          Add
        </button>
      </form>
      )}

      <div className="toolbar">
        <div className="seg">
          {(["all", ...INVOICE_STATUSES] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? "seg-btn active" : "seg-btn"}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : invoiceStatusLabel(f)}
              <span className="seg-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search clients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />
      </div>

      {visible.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">
            {totalCount === 0
              ? "No invoices yet"
              : query.trim()
                ? "Nothing matches"
                : filter === "all"
                  ? "Nothing here"
                  : `No ${filter} invoices`}
          </p>
          <p className="empty-sub">
            {totalCount === 0
              ? "Add your first invoice above — link it to a client or keep it standalone."
              : query.trim()
                ? clientMatches.length > 0
                  ? `${clientMatches.length} client${clientMatches.length === 1 ? "" : "s"} match${
                      clientMatches.length === 1 ? "es" : ""
                    } “${query.trim()}” — invoices appear here once linked to a client.`
                  : "Try a different search or status."
                : "Try a different status tab."}
          </p>
          {canEdit && totalCount === 0 && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setFilter("all");
                setQuery("");
                amountRef.current?.focus();
              }}
            >
              Add an invoice
            </button>
          )}
        </div>
      ) : (
        <ul className="card inv-list">
          {visible.map((inv) => {
            const overdue = isOverdue(inv);
            return (
              <li key={inv.id} className="inv">
                <div className="inv-body">
                  <div className="inv-client">
                    {inv.clientName ? (
                      <span className={`chip${blurPii(pii)}`}>{inv.clientName}</span>
                    ) : (
                      <span className="inv-noclient">No client</span>
                    )}
                    {inv.notes && <span className="inv-notes">{inv.notes}</span>}
                  </div>
                  <div className="inv-meta">
                    <span className="inv-amount">{money(inv.amount)}</span>
                    {overdue ? (
                      <span className="badge tone-red">Overdue</span>
                    ) : (
                      <span className={`badge tone-${INVOICE_STATUS_TONE[inv.status]}`}>
                        {invoiceStatusLabel(inv.status)}
                      </span>
                    )}
                    {inv.dueDate && (
                      <span className={`inv-due${overdue ? " overdue" : ""}`}>
                        {overdue ? "Overdue · " : "Due "}
                        {fmtDate(inv.dueDate)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="row-actions">
                  {canEdit && inv.status === "draft" && (
                    <button className="icon-btn" onClick={() => handleStatus(inv, "sent")} disabled={busy}>
                      Mark sent
                    </button>
                  )}
                  {canEdit && inv.status === "sent" && (
                    <button className="icon-btn" onClick={() => handleStatus(inv, "paid")} disabled={busy}>
                      Mark paid
                    </button>
                  )}
                  {canEdit && (
                  <button className="icon-btn" onClick={() => setEditing(inv)} aria-label={`Edit invoice ${inv.id}`}>
                    Edit
                  </button>
                  )}
                  {canEdit && (
                  <button
                    className="icon-btn danger"
                    onClick={() => setDeleting(inv)}
                    aria-label={`Delete invoice ${inv.id}`}
                  >
                    Delete
                  </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <InvoiceModal
          invoice={editing}
          clients={clients}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete invoice?"
          entity={
            <>
              {money(deleting.amount)} invoice
              {deleting.clientName ? <> for <span className={pii ? "pii-blur" : undefined}>{deleting.clientName}</span></> : ""}
            </>
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
