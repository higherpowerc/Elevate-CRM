import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Client, CustomField, Stage } from "./types";

interface Props {
  client?: Client;
  /** The tenant's ordered pipeline stages (Phase 3a) — drives the dropdown. */
  stages: Stage[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: Omit<Client, "id" | "createdAt" | "updatedAt">, editing?: Client) => void;
}

export default function ClientModal({ client, stages, busy, onClose, onSave }: Props) {
  const defaultStage = stages[0] ?? "Prospect";
  const empty = (): Omit<Client, "id" | "createdAt" | "updatedAt"> => ({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
    industry: "",
    services: [],
    customFields: [],
    dealValue: 0,
    stage: defaultStage,
    nextAction: "",
    notes: "",
    archived: false,
  });
  const [form, setForm] = useState(() =>
    client
      ? {
          companyName: client.companyName,
          contactName: client.contactName,
          email: client.email,
          phone: client.phone,
          industry: client.industry,
          services: [...client.services],
          customFields: client.customFields.map((f) => ({ ...f })),
          dealValue: client.dealValue,
          stage: client.stage,
          nextAction: client.nextAction,
          notes: client.notes,
          archived: client.archived,
        }
      : empty(),
  );
  const [serviceDraft, setServiceDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof ReturnType<typeof empty>>(key: K, value: ReturnType<typeof empty>[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /* ── Services: free-form chip editor ─────────────────────────────── */

  function addService() {
    const t = serviceDraft.trim();
    if (!t) return;
    if (t.length > 100) {
      setError("Service names must be under 100 characters.");
      return;
    }
    setForm((f) =>
      f.services.some((s) => s.toLowerCase() === t.toLowerCase())
        ? f
        : { ...f, services: [...f.services, t] },
    );
    setServiceDraft("");
  }

  function removeService(s: string) {
    setForm((f) => ({ ...f, services: f.services.filter((x) => x !== s) }));
  }

  function onServiceKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addService();
    } else if (e.key === "Backspace" && serviceDraft === "" && form.services.length > 0) {
      removeService(form.services[form.services.length - 1]);
    }
  }

  /* ── Custom fields ───────────────────────────────────────────────── */

  function addField() {
    setForm((f) => ({ ...f, customFields: [...f.customFields, { label: "", value: "" }] }));
  }

  function setField(i: number, key: keyof CustomField, v: string) {
    setForm((f) => ({
      ...f,
      customFields: f.customFields.map((cf, j) => (j === i ? { ...cf, [key]: v } : cf)),
    }));
  }

  function removeField(i: number) {
    setForm((f) => ({ ...f, customFields: f.customFields.filter((_, j) => j !== i) }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.companyName.trim()) {
      setError("Company name is required.");
      return;
    }
    const customFields = form.customFields
      .map((cf) => ({ label: cf.label.trim(), value: cf.value.trim() }))
      .filter((cf) => cf.label !== "" || cf.value !== "");
    if (customFields.some((cf) => !cf.label)) {
      setError("Every custom field needs a label (or remove the empty row).");
      return;
    }
    setError(null);
    onSave({ ...form, customFields, dealValue: Number(form.dealValue) || 0 }, client);
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={client ? "Edit client" : "New client"}>
      <div className="modal modal-lg">
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
          <div className="form-grid">
            <label className="field">
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
                placeholder="HVAC, Legal, Retail…"
              />
            </label>
            <label className="field">
              <span className="field-label">Contact name</span>
              <input
                value={form.contactName}
                onChange={(e) => set("contactName", e.target.value)}
                placeholder="Jordan Lee"
              />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="jordan@acme.com"
              />
            </label>
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
                step="any"
                value={form.dealValue === 0 ? "" : String(form.dealValue)}
                onChange={(e) => set("dealValue", e.target.value === "" ? 0 : Number(e.target.value))}
                placeholder="9500.50"
              />
            </label>
            <label className="field">
              <span className="field-label">Stage</span>
              <select value={form.stage} onChange={(e) => set("stage", e.target.value as Stage)}>
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Next action</span>
              <input
                value={form.nextAction}
                onChange={(e) => set("nextAction", e.target.value)}
                placeholder="e.g. Send proposal by Friday"
              />
            </label>
          </div>

          <fieldset className="field">
            <legend className="field-label">Services</legend>
            <div className="chips">
              {form.services.map((s) => (
                <span className="chip" key={s}>
                  {s}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeService(s)}
                    aria-label={`Remove service ${s}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {form.services.length === 0 && <span className="cell-muted chip-hint">No services yet</span>}
            </div>
            <div className="chip-add">
              <input
                value={serviceDraft}
                onChange={(e) => setServiceDraft(e.target.value)}
                onKeyDown={onServiceKey}
                placeholder="Type a service — any industry (e.g. Installation) — press Enter"
                aria-label="Add a service"
              />
              <button type="button" className="btn btn-ghost btn-sm" onClick={addService}>
                Add
              </button>
            </div>
          </fieldset>

          <div className="field">
            <span className="field-label">Custom fields</span>
            <div className="cf-list">
              {form.customFields.map((cf, i) => (
                <div className="cf-row" key={i}>
                  <input
                    value={cf.label}
                    onChange={(e) => setField(i, "label", e.target.value)}
                    placeholder="Label (e.g. License #)"
                    aria-label={`Custom field ${i + 1} label`}
                  />
                  <input
                    value={cf.value}
                    onChange={(e) => setField(i, "value", e.target.value)}
                    placeholder="Value"
                    aria-label={`Custom field ${i + 1} value`}
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => removeField(i)}
                    aria-label={`Remove custom field ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-sm cf-add" onClick={addField}>
              + Add custom field
            </button>
          </div>

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
