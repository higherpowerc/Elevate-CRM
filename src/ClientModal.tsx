import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Client, CustomFieldDef, CustomField, ClientType, Stage } from "./types";

interface Props {
  client?: Client;
  /** The tenant's ordered pipeline stages (Phase 3a) — drives the dropdown. */
  stages: Stage[];
  /** The tenant's custom-field definitions (Phase 3b) — each defined field
   *  gets its own typed input; values are stored keyed by field name. */
  customFieldDefs: CustomFieldDef[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: Omit<Client, "id" | "createdAt" | "updatedAt">, editing?: Client) => void;
}

export default function ClientModal({ client, stages, customFieldDefs, busy, onClose, onSave }: Props) {
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
    clientType: "residential",
    address: "",
    city: "",
    state: "",
    zip: "",
    website: "",
    leadSource: "",
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
          clientType: client.clientType,
          address: client.address,
          city: client.city,
          state: client.state,
          zip: client.zip,
          website: client.website,
          leadSource: client.leadSource,
        }
      : empty(),
  );
  const [serviceDraft, setServiceDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Esc closes the modal (keyboard nicety).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () => window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, [busy, onClose]);

  function set<K extends keyof ReturnType<typeof empty>>(key: K, value: ReturnType<typeof empty>[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Current value for a defined field, by exact name (values are stored
   *  with the canonical definition name). */
  function valueOf(name: string): string {
    const f = form.customFields.find((cf) => cf.name === name);
    return f ? f.value : "";
  }

  function setValue(name: string, value: string) {
    setForm((f) => {
      const exists = f.customFields.some((cf) => cf.name === name);
      const customFields: CustomField[] = exists
        ? f.customFields.map((cf) => (cf.name === name ? { ...cf, value } : cf))
        : [...f.customFields, { name, value }];
      return { ...f, customFields };
    });
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

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.companyName.trim()) {
      setError(form.clientType === "commercial" ? "Company name is required." : "Name is required.");
      return;
    }
    // Phase 3e: the segmented toggle must be one of the two types — a choice
    // is forced before saving (the server enforces it too).
    if (form.clientType !== "commercial" && form.clientType !== "residential") {
      setError("Choose Commercial or Residential.");
      return;
    }
    // Build the payload custom fields from the tenant's definitions: every
    // checkbox is sent (0/1); text/number/date fields are sent only when they
    // have a value (empty values are omitted — the server treats them as
    // unset, and all custom fields are optional).
    const customFields: CustomField[] = [];
    for (const def of customFieldDefs) {
      const value = valueOf(def.name).trim();
      if (def.type === "checkbox") {
        customFields.push({ name: def.name, value: value === "1" ? "1" : "0" });
      } else if (value) {
        customFields.push({ name: def.name, value });
      }
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
          <div className="field">
            <span className="field-label">Client type *</span>
            <div className="seg seg-type" role="radiogroup" aria-label="Client type">
              {(["commercial", "residential"] as ClientType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={form.clientType === t}
                  className={form.clientType === t ? "seg-btn active" : "seg-btn"}
                  onClick={() => set("clientType", t)}
                >
                  {t === "commercial" ? "Commercial" : "Residential"}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">
                {form.clientType === "commercial" ? "Company name *" : "Name *"}
              </span>
              <input
                value={form.companyName}
                onChange={(e) => set("companyName", e.target.value)}
                placeholder={form.clientType === "commercial" ? "e.g. Acme Landscaping" : "e.g. Jane Doe"}
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

          <fieldset className="field addr-group">
            <legend className="field-label">Address</legend>
            <div className="field">
              <input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Street address"
                maxLength={200}
              />
            </div>
            <div className="form-row-3">
              <label className="field">
                <span className="field-label">City</span>
                <input
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="Seattle"
                  maxLength={100}
                />
              </label>
              <label className="field">
                <span className="field-label">State</span>
                <input
                  value={form.state}
                  onChange={(e) => set("state", e.target.value)}
                  placeholder="WA"
                  maxLength={50}
                />
              </label>
              <label className="field">
                <span className="field-label">ZIP / postal</span>
                <input
                  value={form.zip}
                  onChange={(e) => set("zip", e.target.value)}
                  placeholder="98101"
                  maxLength={20}
                />
              </label>
            </div>
          </fieldset>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">Website</span>
              <input
                type="url"
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://acme.com"
                maxLength={200}
              />
            </label>
            <label className="field">
              <span className="field-label">Lead source</span>
              <input
                value={form.leadSource}
                onChange={(e) => set("leadSource", e.target.value)}
                placeholder="Referral, Website, Walk-in…"
                maxLength={100}
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
            {customFieldDefs.length === 0 ? (
              <p className="field-hint cf-none-hint">
                No custom fields defined for this workspace yet. Add them in Settings — they will
                appear here on every client.
              </p>
            ) : (
              <div className="cf-values">
                {customFieldDefs.map((def) => {
                  const value = valueOf(def.name);
                  if (def.type === "checkbox") {
                    return (
                      <label className="check cf-check" key={def.name}>
                        <input
                          type="checkbox"
                          checked={value === "1"}
                          onChange={(e) => setValue(def.name, e.target.checked ? "1" : "0")}
                        />
                        <span>{def.name}</span>
                      </label>
                    );
                  }
                  return (
                    <label className="field" key={def.name}>
                      <span className="field-label">{def.name}</span>
                      <input
                        type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
                        step={def.type === "number" ? "any" : undefined}
                        value={value}
                        onChange={(e) => setValue(def.name, e.target.value)}
                        placeholder={def.type === "date" ? "YYYY-MM-DD" : def.type === "number" ? "0" : ""}
                      />
                    </label>
                  );
                })}
              </div>
            )}
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
