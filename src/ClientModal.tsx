import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Client, CustomFieldDef, CustomField, ClientType, Stage } from "./types";
import { usePii, blurPii, PII_FIELD_KEYS } from "./pii";
import {
  getCustomGroupsFor,
  getIntakeLayout,
  intakeClientType,
  type IntakeField,
  type IntakeOrgSettings,
} from "./intakeRules";

interface Props {
  client?: Client;
  /** The tenant's ordered pipeline stages (Phase 3a) — drives the dropdown. */
  stages: Stage[];
  /** Optional stage a NEW record is pre-set to on create. Defaults to the
   *  first stage. The sold-customer directory passes its terminal stage so
   *  "Add new client" there creates a record that lands in the sold list. */
  defaultStage?: Stage;
  /** The tenant's custom-field definitions (Phase 3b) — each defined field
   *  gets its own typed input; values are stored keyed by field name. */
  customFieldDefs: CustomFieldDef[];
  /** Adaptive intake Phase 1/2: the org's account-level vertical config —
   *  the rules engine decides which sections/fields this form shows. */
  intake: IntakeOrgSettings;
  /** Owner 2026-08-20 sales rework — true only on the OWNER's Leads tab.
   *  Shows the "Demo outcome" editor (Sold / Not sold / Maybe + the
   *  maybe-outcome follow-up note) which lives in the edit modal — NOT a list
   *  column or dropdown. */
  ownerLeadsTab?: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (input: Omit<Client, "id" | "createdAt" | "updatedAt">, editing?: Client) => void;
}

/** Local YYYY-MM-DD — the same convention task dates use; the DNC date
 *  auto-fills to today when the DNC toggle is switched on. */
function localToday(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Empty value for every field the intake form can touch (universal +
 *  adaptive). New keys default so the server's create defaults match. The
 *  adaptive keys are re-declared as required so form code never hits
 *  `possibly undefined` (the base Client type keeps them optional). */
type FormState = Omit<Client, "id" | "createdAt" | "updatedAt"> & {
  billingAddress: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingSame: boolean;
  preferredContactMethod: string;
  businessType: string;
  taxIdEin: string;
  apContact: string;
  poRequired: boolean;
  unitsLocations: string;
  propertyManagerName: string;
  propertyManagerContact: string;
  hoaName: string;
  hoaContact: string;
  accessInstructions: string;
  coiRequired: boolean;
  serviceContract: string;
  dbaName: string;
  einSsn: string;
  homeownerRenter: string;
  hoaRestrictions: string;
  parkingAccess: string;
  petOnPremises: boolean;
  preferredServiceLocation: string;
  /** Owner request 2026-08-14 — lost + DNC pipeline-status flags. */
  lost: boolean;
  lostReason: string;
  dnc: boolean;
  dncReason: string;
  dncDate: string;
  /** Owner 2026-08-20 sales rework — demo outcome ('', sold, not_sold, maybe)
   *  + the maybe-outcome follow-up note. Owned by the edit modal on the owner
   *  Leads tab. */
  demoOutcome: "" | "sold" | "not_sold" | "maybe";
  followUpNote: string;
};

export default function ClientModal({ client, stages, defaultStage, customFieldDefs, intake, ownerLeadsTab = false, busy, onClose, onSave }: Props) {
  /* Global privacy eye (2026-08-14 owner request) — blur PII (client/company names, phone, email, address) here too. */
  const pii = usePii();
  const createStage = defaultStage ?? stages[0] ?? "Leads";
  const empty = (): FormState => ({
    companyName: "",
    contactName: "",
    email: "",
    phone: "",
    industry: "",
    services: [],
    customFields: [],
    dealValue: 0,
    monthlyAmount: 0,
    stage: createStage,
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
    // Adaptive intake Phase 1: optional billing + intake fields.
    billingAddress: "",
    billingCity: "",
    billingState: "",
    billingZip: "",
    billingSame: true,
    preferredContactMethod: "",
    businessType: "",
    taxIdEin: "",
    apContact: "",
    poRequired: false,
    unitsLocations: "",
    propertyManagerName: "",
    propertyManagerContact: "",
    hoaName: "",
    hoaContact: "",
    accessInstructions: "",
    coiRequired: false,
    serviceContract: "",
    dbaName: "",
    einSsn: "",
    homeownerRenter: "",
    hoaRestrictions: "",
    parkingAccess: "",
    petOnPremises: false,
    preferredServiceLocation: "",
    lost: false,
    lostReason: "",
    dnc: false,
    dncReason: "",
    dncDate: "",
    demoOutcome: "",
    followUpNote: "",
  });
  const [form, setForm] = useState<FormState>(() =>
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
          monthlyAmount: client.monthlyAmount ?? 0,
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
          billingAddress: client.billingAddress ?? "",
          billingCity: client.billingCity ?? "",
          billingState: client.billingState ?? "",
          billingZip: client.billingZip ?? "",
          billingSame: client.billingSame ?? true,
          preferredContactMethod: client.preferredContactMethod ?? "",
          businessType: client.businessType ?? "",
          taxIdEin: client.taxIdEin ?? "",
          apContact: client.apContact ?? "",
          poRequired: client.poRequired ?? false,
          unitsLocations: client.unitsLocations ?? "",
          propertyManagerName: client.propertyManagerName ?? "",
          propertyManagerContact: client.propertyManagerContact ?? "",
          hoaName: client.hoaName ?? "",
          hoaContact: client.hoaContact ?? "",
          accessInstructions: client.accessInstructions ?? "",
          coiRequired: client.coiRequired ?? false,
          serviceContract: client.serviceContract ?? "",
          dbaName: client.dbaName ?? "",
          einSsn: client.einSsn ?? "",
          homeownerRenter: client.homeownerRenter ?? "",
          hoaRestrictions: client.hoaRestrictions ?? "",
          parkingAccess: client.parkingAccess ?? "",
          petOnPremises: client.petOnPremises ?? false,
          preferredServiceLocation: client.preferredServiceLocation ?? "",
          lost: client.lost ?? false,
          lostReason: client.lostReason ?? "",
          dnc: client.dnc ?? false,
          dncReason: client.dncReason ?? "",
          dncDate: client.dncDate ?? "",
          demoOutcome: (client.demoOutcome ?? "") as "" | "sold" | "not_sold" | "maybe",
          followUpNote: client.followUpNote ?? "",
        }
      : empty(),
  );
  const [serviceDraft, setServiceDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The Business name / LLC tab is collapsed by default; auto-expands when
   *  editing a client that already has a DBA or EIN/SSN on file. */
  const [llcOpen, setLlcOpen] = useState(() => !!(client?.dbaName || client?.einSsn));

  // Esc closes the modal (keyboard nicety).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () => window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, [busy, onClose]);

  /** The adaptive layout — recomputed when the client type or the business
   *  type (HOA narrowing) changes. Sections with no fields render nothing. */
  const sections = useMemo(
    () => getIntakeLayout(intake, intakeClientType(form.clientType), form.businessType),
    [intake, form.clientType, form.businessType],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** String/number/boolean setter for dynamically-keyed fields (the rules
   *  engine's keys are not statically known, so the generic `set` can't be
   *  used). */
  function setField(key: keyof FormState, value: string | number | boolean) {
    setForm((f) => ({ ...f, [key]: value }) as FormState);
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
      setError("Choose Commercial or Individual.");
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
    // Adaptive intake Phase 3: values from the org's ENABLED custom intake
    // groups that apply to this client type — stored by group field key in
    // the SAME customFields array. Yes/no fields always send 1/0; text and
    // select fields send only non-empty values.
    for (const g of getCustomGroupsFor(intake, intakeClientType(form.clientType))) {
      for (const f of g.fields) {
        const value = valueOf(f.key).trim();
        if (f.kind === "yesno") {
          customFields.push({ name: f.key, value: value === "1" ? "1" : "0" });
        } else if (value) {
          customFields.push({ name: f.key, value });
        }
      }
    }
    const billingSame = form.billingSame !== false;
    setError(null);
    onSave(
      {
        ...form,
        billingSame,
        // When billing is the same as the service address the address values
        // are omitted from the save (nothing to store).
        ...(billingSame
          ? {}
          : {
              billingAddress: form.billingAddress.trim(),
              billingCity: form.billingCity.trim(),
              billingState: form.billingState.trim(),
              billingZip: form.billingZip.trim(),
            }),
        customFields,
        dealValue: Number(form.dealValue) || 0,
        monthlyAmount: Number(form.monthlyAmount) || 0,
        // Owner request 2026-08-14 — lost/DNC: cleared flags ship cleared
        // metadata (the server normalizes anyway — this keeps the payload
        // honest for the modal's own optimistic render).
        lost: form.lost,
        lostReason: form.lost ? form.lostReason.trim() : "",
        dnc: form.dnc,
        dncReason: form.dnc ? form.dncReason.trim() : "",
        dncDate: form.dnc ? form.dncDate : "",
        // Owner 2026-08-20 sales rework — demo outcome + follow-up note ship
        // with the save (owner Leads tab only in the UI; the server persists
        // them solely for the owner org).
        demoOutcome: form.demoOutcome ?? "",
        followUpNote: (form.followUpNote ?? "").trim(),
      },
      client,
    );
  }

  /* ── Field renderers ─────────────────────────────────────────────── */

  /** Display value of a form field (numbers render as their string form). */
  function displayValue(f: IntakeField): string {
    const raw = form[f.key as keyof FormState];
    if (typeof raw === "number") return raw === 0 ? "" : String(raw);
    return typeof raw === "string" ? raw : "";
  }

  /** Grid-cell fields: text input, textarea, select, datalist, yes/no. */
  function renderCell(f: IntakeField) {
    const key = f.key as keyof FormState;
    const value = displayValue(f);
    /* Phase 3 — a field of a tenant-defined custom intake group. Values live
       in the client's customFields by the group field key (NOT a form prop),
       so binding goes through valueOf/setValue. */
    if (f.kind === "customgroup") {
      const gk = f.groupKey ?? f.key;
      const gkValue = valueOf(gk);
      if (f.groupKind === "yesno") {
        const checked = gkValue === "1";
        return (
          <div className="field" key={f.key}>
            <span className="field-label">{f.label}</span>
            <div className="seg yesno-seg" role="radiogroup" aria-label={f.label}>
              <button
                type="button"
                role="radio"
                aria-checked={checked}
                className={checked ? "seg-btn active" : "seg-btn"}
                onClick={() => setValue(gk, "1")}
              >
                Yes
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!checked}
                className={!checked ? "seg-btn active" : "seg-btn"}
                onClick={() => setValue(gk, "0")}
              >
                No
              </button>
            </div>
          </div>
        );
      }
      if (f.groupKind === "select") {
        return (
          <label className="field" key={f.key}>
            <span className="field-label">{f.label}</span>
            <select
              value={gkValue}
              onChange={(e) => setValue(gk, e.target.value)}
              aria-label={f.label}
            >
              <option value="">—</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        );
      }
      // text
      return (
        <label className="field" key={f.key}>
          <span className="field-label">{f.label}</span>
          <input
            type="text"
            value={gkValue}
            onChange={(e) => setValue(gk, e.target.value)}
            maxLength={500}
            aria-label={f.label}
          />
        </label>
      );
    }
    if (f.kind === "yesno") {
      const checked = form[key] === true;
      return (
        <div className="field" key={f.key}>
          <span className="field-label">{f.label}</span>
          <div className="seg yesno-seg" role="radiogroup" aria-label={f.label}>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              className={checked ? "seg-btn active" : "seg-btn"}
              onClick={() => setField(key, true)}
            >
              Yes
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!checked}
              className={!checked ? "seg-btn active" : "seg-btn"}
              onClick={() => setField(key, false)}
            >
              No
            </button>
          </div>
        </div>
      );
    }
    if (f.kind === "select") {
      /* The "Stage" field's options are the org's own pipeline stages (the
         intake layout carries no options for it); every other select carries
         its own. On create the stage is pre-set (first stage by default, or
         the terminal stage when adding from the sold-customer directory). */
      const opts = f.key === "stage" ? stages : (f.options ?? []);
      return (
        <label className="field" key={f.key}>
          <span className="field-label">{f.label}</span>
          <select
            value={value}
            onChange={(e) => setField(key, e.target.value)}
            aria-label={f.label}
          >
            <option value="">—</option>
            {opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      );
    }
    if (f.kind === "datalist") {
      return (
        <label className="field" key={f.key}>
          <span className="field-label">{f.label}</span>
          <input
            value={value}
            onChange={(e) => setField(key, e.target.value)}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
            list="intake-business-types"
            aria-label={f.label}
          />
          <datalist id="intake-business-types">
            {(f.options ?? []).map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>
      );
    }
    if (f.kind === "textarea") {
      return (
        <label className="field intake-block" key={f.key}>
          <span className="field-label">{f.label}</span>
          <textarea
            rows={4}
            value={value}
            onChange={(e) => setField(key, e.target.value)}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
          />
        </label>
      );
    }
    // text
    const isMoneyField = f.key === "dealValue" || f.key === "monthlyAmount";
    return (
      <label className="field" key={f.key}>
        <span className="field-label">{f.label}</span>
        <input
          type={isMoneyField ? "number" : f.key === "website" ? "url" : f.key === "email" ? "email" : "text"}
          min={isMoneyField ? 0 : undefined}
          step={isMoneyField ? "any" : undefined}
          value={value}
          onChange={(e) =>
            isMoneyField
              ? setField(key, e.target.value === "" ? 0 : Number(e.target.value))
              : setField(key, e.target.value)
          }
          className={PII_FIELD_KEYS.has(f.key) && pii ? "pii-blur" : undefined}
          placeholder={f.placeholder}
          maxLength={f.maxLength}
          required={f.key === "companyName"}
          autoFocus={f.key === "companyName"}
          aria-label={f.label}
        />
      </label>
    );
  }

  /** Full-width blocks: address, billing, LLC tab, services, custom fields,
   *  archived. */
  function renderBlock(f: IntakeField) {
    switch (f.kind) {
      case "address":
        return (
          <fieldset className="field addr-group intake-block" key={f.key}>
            <legend className="field-label">Service address</legend>
            <div className="field">
              <input
                value={form.address}
                className={pii ? "pii-blur" : undefined}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Street address"
                maxLength={200}
                aria-label="Service street address"
              />
            </div>
            <div className="form-row-3">
              <label className="field">
                <span className="field-label">City</span>
                <input
                  value={form.city}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="Seattle"
                  maxLength={100}
                />
              </label>
              <label className="field">
                <span className="field-label">State</span>
                <input
                  value={form.state}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("state", e.target.value)}
                  placeholder="WA"
                  maxLength={50}
                />
              </label>
              <label className="field">
                <span className="field-label">ZIP / postal</span>
                <input
                  value={form.zip}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("zip", e.target.value)}
                  placeholder="98101"
                  maxLength={20}
                />
              </label>
            </div>
          </fieldset>
        );
      case "billing":
        return (
          <fieldset className="field addr-group intake-block" key={f.key}>
            <legend className="field-label">Billing address</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={form.billingSame !== false}
                onChange={(e) => set("billingSame", e.target.checked)}
              />
              <span>Same as service address</span>
            </label>
            {form.billingSame === false && (
              <div className="billing-fields">
                <div className="field">
                  <input
                    value={form.billingAddress}
                    className={pii ? "pii-blur" : undefined}
                    onChange={(e) => set("billingAddress", e.target.value)}
                    placeholder="Billing street address"
                    maxLength={200}
                    aria-label="Billing street address"
                  />
                </div>
                <div className="form-row-3">
                  <label className="field">
                    <span className="field-label">Billing city</span>
                    <input
                      value={form.billingCity}
                      className={pii ? "pii-blur" : undefined}
                      onChange={(e) => set("billingCity", e.target.value)}
                      placeholder="Seattle"
                      maxLength={100}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Billing state</span>
                    <input
                      value={form.billingState}
                      className={pii ? "pii-blur" : undefined}
                      onChange={(e) => set("billingState", e.target.value)}
                      placeholder="WA"
                      maxLength={50}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Billing ZIP / postal</span>
                    <input
                      value={form.billingZip}
                      className={pii ? "pii-blur" : undefined}
                      onChange={(e) => set("billingZip", e.target.value)}
                      placeholder="98101"
                      maxLength={20}
                    />
                  </label>
                </div>
              </div>
            )}
          </fieldset>
        );
      case "llc":
        return (
          <div className="llc-tab intake-block" key={f.key}>
            <button
              type="button"
              className="llc-toggle"
              onClick={() => setLlcOpen((o) => !o)}
              aria-expanded={llcOpen}
            >
              <span className="llc-caret" aria-hidden="true">
                {llcOpen ? "▾" : "▸"}
              </span>
              <span>Business name / LLC</span>
              <span className="llc-note">optional</span>
            </button>
            {llcOpen && (
              <div className="llc-body form-grid">
                <label className="field">
                  <span className="field-label">Business / DBA name</span>
                  <input
                    value={form.dbaName}
                    className={pii ? "pii-blur" : undefined}
                    onChange={(e) => set("dbaName", e.target.value)}
                    placeholder="e.g. Jane Doe Detailing LLC"
                    maxLength={200}
                  />
                </label>
                <label className="field">
                  <span className="field-label">EIN or SSN</span>
                  <input
                    value={form.einSsn}
                    className={pii ? "pii-blur" : undefined}
                    onChange={(e) => set("einSsn", e.target.value)}
                    placeholder="For 1099 clients"
                    maxLength={50}
                  />
                </label>
              </div>
            )}
          </div>
        );
      case "services":
        return (
          <fieldset className="field intake-block" key={f.key}>
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
        );
      case "custom":
        return (
          <div className="field intake-block" key={f.key}>
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
                  if (def.type === "select") {
                    return (
                      <label className="field" key={def.name}>
                        <span className="field-label">{def.name}</span>
                        <select value={value} onChange={(e) => setValue(def.name, e.target.value)}>
                          <option value="">—</option>
                          {(def.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
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
        );
      case "archived":
        return (
          <label className="check intake-block" key={f.key}>
            <input
              type="checkbox"
              checked={form.archived}
              onChange={(e) => set("archived", e.target.checked)}
            />
            <span>Archived (hidden from dashboard counts)</span>
          </label>
        );
      default:
        return null;
    }
  }

  /** Grid-cell kinds render through renderCell; everything else (address,
   *  billing, LLC, services, custom, archived) renders as a full-width block. */
  const CELL_KINDS = new Set(["text", "textarea", "yesno", "select", "datalist", "customgroup"]);

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
                  {t === "commercial" ? "Commercial" : "Individual"}
                </button>
              ))}
            </div>
          </div>
          {sections.map((section) =>
            section.fields.length === 0 ? null : (
              <section className="intake-section" key={section.id} aria-label={section.title}>
                <div className="intake-section-title">{section.title}</div>
                <div className="form-grid intake-grid">
                  {section.fields.map((f) =>
                    CELL_KINDS.has(f.kind) ? renderCell(f) : renderBlock(f),
                  )}
                </div>
              </section>
            ),
          )}
          {/* Owner 2026-08-20 sales rework — DEMO OUTCOME (owner Leads tab
              ONLY, in the edit modal — NOT a list column/dropdown). The owner
              records the demo result here: Sold / Not sold / Maybe. 'sold'
              relocates the lead to the Onboarding bucket (the same positional
              path "Start Onboarding" used); 'maybe' keeps the lead on Leads
              and stores a follow-up note (shown here when Maybe is set) so
              the owner can pick it up later; 'not_sold' keeps the lead on
              Leads and can be flagged lost below. The scheduled demo time +
              meeting link are shown read-only for reference. */}
          {ownerLeadsTab && (
            <section className="intake-section" aria-label="Demo outcome">
              <div className="intake-section-title">Demo outcome</div>
              {(client?.demoScheduledAt || client?.demoMeetingLink) && (
                <p className="cell-muted demo-sched-line">
                  {client?.demoScheduledAt ? `Demo scheduled for ${client.demoScheduledAt}.` : ""}{" "}
                  {client?.demoMeetingLink ? `Meeting link: ${client.demoMeetingLink}` : ""}
                </p>
              )}
              <div className="form-grid intake-grid">
                <div className="field intake-block demo-outcome-block">
                  <span className="field-label">Demo result</span>
                  <select
                    className="demo-outcome-field"
                    value={form.demoOutcome}
                    aria-label="Demo outcome"
                    onChange={(e) => set("demoOutcome", e.target.value as "" | "sold" | "not_sold" | "maybe")}
                  >
                    <option value="">— No demo recorded —</option>
                    <option value="sold">Sold</option>
                    <option value="not_sold">Not sold</option>
                    <option value="maybe">Maybe</option>
                  </select>
                  {form.demoOutcome === "maybe" && (
                    <div className="field status-reason">
                      <span className="field-label">Follow-up note</span>
                      <textarea
                        value={form.followUpNote}
                        onChange={(e) => set("followUpNote", e.target.value)}
                        placeholder="What to follow up on with this lead"
                        rows={3}
                        maxLength={600}
                        aria-label="Follow-up note"
                      />
                      <span className="field-hint">Saving keeps this lead on Leads and stores the note here for follow-up.</span>
                    </div>
                  )}
                  {form.demoOutcome === "not_sold" && (
                    <span className="field-hint">Keep the lead on Leads and use Lead status below to mark it lost if it is not interested.</span>
                  )}
                </div>
              </div>
            </section>
          )}
          {/* Owner request 2026-08-14 — Lead status: the lost + DNC flags.
              Rendered OUTSIDE the adaptive intake engine so these controls
              exist for every record and every workspace (owner + client
              accounts alike); the DNC warning banner shows prominently while
              the flag is set. The DNC date auto-fills to today when the
              toggle is switched on (editable after). */}
          <section className="intake-section" aria-label="Lead status">
            <div className="intake-section-title">Lead status</div>
            {form.dnc && (
              <div className="alert alert-warn dnc-banner" role="alert">
                <strong>Do not call/contact</strong>
                <span>
                  {form.dncDate ? ` marked ${form.dncDate}` : ""}
                  {form.dncReason ? ` — ${form.dncReason}` : ""}
                </span>
              </div>
            )}
            <div className="form-grid intake-grid">
              <div className="field intake-block">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.lost}
                    onChange={(e) => {
                      set("lost", e.target.checked);
                      if (!e.target.checked) set("lostReason", "");
                    }}
                  />
                  <span>Mark as lost (not interested)</span>
                </label>
                {form.lost && (
                  <div className="field status-reason">
                    <span className="field-label">Lost reason</span>
                    <input
                      value={form.lostReason}
                      onChange={(e) => set("lostReason", e.target.value)}
                      placeholder="Why this lead is lost"
                      maxLength={300}
                      aria-label="Lost reason"
                    />
                  </div>
                )}
              </div>
              <div className="field intake-block">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.dnc}
                    onChange={(e) => {
                      set("dnc", e.target.checked);
                      if (e.target.checked && !form.dncDate) set("dncDate", localToday());
                      if (!e.target.checked) {
                        set("dncReason", "");
                        set("dncDate", "");
                      }
                    }}
                  />
                  <span>Do not contact (DNC)</span>
                </label>
                {form.dnc && (
                  <>
                    <div className="field status-reason">
                      <span className="field-label">DNC reason</span>
                      <input
                        value={form.dncReason}
                        onChange={(e) => set("dncReason", e.target.value)}
                        placeholder="e.g. Asked not to be contacted"
                        maxLength={300}
                        aria-label="DNC reason"
                      />
                    </div>
                    <div className="field status-reason">
                      <span className="field-label">DNC date</span>
                      <input
                        type="date"
                        value={form.dncDate}
                        onChange={(e) => set("dncDate", e.target.value)}
                        aria-label="DNC date"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
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
