import { useState, type FormEvent } from "react";
import { STAGES, SERVICES, type Client } from "./types";
import type { Service, Stage } from "./types";

interface Props {
  client?: Client;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Omit<Client, "id" | "createdAt" | "updatedAt">, editing?: Client) => void;
}

const empty = (): Omit<Client, "id" | "createdAt" | "updatedAt"> => ({
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  industry: "",
  services: [],
  dealValue: 0,
  stage: "Prospect",
  nextAction: "",
  notes: "",
  archived: false,
});

export default function ClientModal({ client, busy, onClose, onSave }: Props) {
  const [form, setForm] = useState(() =>
    client
      ? {
          companyName: client.companyName,
          contactName: client.contactName,
          email: client.email,
          phone: client.phone,
          industry: client.industry,
          services: [...client.services],
          dealValue: client.dealValue,
          stage: client.stage,
          nextAction: client.nextAction,
          notes: client.notes,
          archived: client.archived,
        }
      : empty(),
  );
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ReturnType<typeof empty>>(key: K, value: ReturnType<typeof empty>[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleService(s: Service) {
    setForm((f) => ({
      ...f,
      services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s],
    }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    setError(null);
    onSave({ ...form, dealValue: Number(form.dealValue) || 0 }, client);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={client ? "Edit client" : "New client"}>
      <div className="modal">
        <div className="modal-head">
          <h2>{client ? "Edit client" : "New client"}</h2>
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
          <div className="field-row">
            <label className="field grow">
              <span className="field-label">Company name *</span>
              <input
                value={form.companyName}
                onChange={(e) => set("companyName", e.target.value)}
                placeholder="Acme Studio"
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">Industry</span>
              <input
                value={form.industry}
                onChange={(e) => set("industry", e.target.value)}
                placeholder="Retail, Legal, SaaS…"
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field grow">
              <span className="field-label">Contact name</span>
              <input
                value={form.contactName}
                onChange={(e) => set("contactName", e.target.value)}
                placeholder="Jordan Lee"
              />
            </label>
            <label className="field grow">
              <span className="field-label">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="jordan@acme.com"
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Phone</span>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+1 555 000 1234"
              />
            </label>
            <label className="field">
              <span className="field-label">Deal value ($)</span>
              <input
                type="number"
                min="0"
                step="500"
                value={form.dealValue === 0 ? "" : String(form.dealValue)}
                onChange={(e) => set("dealValue", e.target.value === "" ? 0 : Number(e.target.value))}
                placeholder="12000"
              />
            </label>
            <label className="field">
              <span className="field-label">Stage</span>
              <select value={form.stage} onChange={(e) => set("stage", e.target.value as Stage)}>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="field">
            <legend className="field-label">Services</legend>
            <div className="check-grid">
              {SERVICES.map((s) => (
                <label className="check" key={s}>
                  <input
                    type="checkbox"
                    checked={form.services.includes(s)}
                    onChange={() => toggleService(s)}
                  />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="field-label">Next action</span>
            <input
              value={form.nextAction}
              onChange={(e) => set("nextAction", e.target.value)}
              placeholder="e.g. Send proposal by Friday"
            />
          </label>
          <label className="field">
            <span className="field-label">Notes</span>
            <textarea
              rows={4}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Scope notes, meeting takeaways, context…"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.archived}
              onChange={(e) => set("archived", e.target.checked)}
            />
            <span>Archived (hidden from dashboard counts)</span>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : client ? "Save changes" : "Create client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
