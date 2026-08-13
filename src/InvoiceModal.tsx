import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { INVOICE_STATUSES, invoiceStatusLabel, type Client, type Invoice, type InvoiceStatus } from "./types";
import type { InvoiceInput } from "./api";

interface Props {
  invoice: Invoice;
  clients: Client[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: Partial<InvoiceInput>, invoice: Invoice) => void;
}

export default function InvoiceModal({ invoice, clients, busy, onClose, onSave }: Props) {
  const [clientId, setClientId] = useState(invoice.clientId === null ? "" : String(invoice.clientId));
  const [amount, setAmount] = useState(invoice.amount > 0 ? String(invoice.amount) : "");
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [dueDate, setDueDate] = useState(invoice.dueDate);
  const [notes, setNotes] = useState(invoice.notes);
  const [error, setError] = useState<string | null>(null);

  // Esc closes the modal (keyboard nicety).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () => window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, [busy, onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const a = Number(amount);
    if (!amount.trim() || !Number.isFinite(a) || a <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    setError(null);
    onSave(
      {
        clientId: clientId === "" ? null : Number(clientId),
        amount: a,
        status,
        dueDate: dueDate.trim(),
        notes,
      },
      invoice,
    );
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Edit invoice">
      <div className="modal modal-sm">
        <div className="modal-head">
          <h2>Edit invoice</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="form modal-form">
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            <span className="field-label">Client</span>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client (standalone)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                  {c.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Amount (USD) *</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)}>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {invoiceStatusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Notes</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Invoice line items, payment terms…"
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
