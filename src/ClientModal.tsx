import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Client, CustomFieldDef, CustomField, ClientType, PropertyEnrichmentResult, Stage } from "./types";
import { api } from "./api";
import { PACKAGE_TIERS, TIER_LABELS, TIER_SERVICE_TAGS, type PackageTier } from "./types";
import { CLIENT_TIMEZONES, timezoneLabel } from "./timezone";
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
  /** Owner 2026-08-27 — true only in the OWNER workspace (Clients/Leads tabs
   *  + the sold-customer directory). Shows the package-tier selector. The tier
   *  is OWNER-only data — tenants never see the selector nor the field. */
  ownerOrg?: boolean;
  /** Housing wholesale vertical customization — intake matches property table data only. */
  isWholesale?: boolean;
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
  /** Owner 2026-08-27 — package tier ('' unset | tier1..4). Owner-only: the
   *  selector renders only in the owner workspace. */
  tier: PackageTier;
  /** Owner 2026-08-27 — IANA timezone ( unset = the owner's Arizona/MST).
   *  Owner-only: the selector renders only in the owner workspace. */
  timezone: string;
  /** User direction 2026-09-04 — listing agent contact info (wholesale). */
  agentName: string;
  agentEmail: string;
  agentPhone: string;
};

export default function ClientModal({ client, stages, defaultStage, customFieldDefs, intake, ownerLeadsTab = false, ownerOrg = false, isWholesale = false, busy, onClose, onSave }: Props) {
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
    clientType: isWholesale ? "single_family" : "commercial",
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
    businessType: "Wholesale Real Estate",
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
    tier: "",
    timezone: "",
    agentName: "",
    agentEmail: "",
    agentPhone: "",
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
          tier: (client.tier ?? "") as PackageTier,
          timezone: client.timezone ?? "",
          agentName: client.agentName ?? "",
          agentEmail: client.agentEmail ?? "",
          agentPhone: client.agentPhone ?? "",
        }
      : empty(),
  );
  const [serviceDraft, setServiceDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The Business name / LLC tab is collapsed by default; auto-expands when
   *  editing a client that already has a DBA or EIN/SSN on file. */
  const [llcOpen, setLlcOpen] = useState(() => !!(client?.dbaName || client?.einSsn));
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichSuccess, setEnrichSuccess] = useState<string | null>(null);
  const [enrichedData, setEnrichedData] = useState<PropertyEnrichmentResult | null>(null);

  const handleAutoEnrich = async () => {
    const fullQuery = `${form.address}, ${form.city} ${form.state} ${form.zip}`.replace(/^[\s,]+|[\s,]+$/g, "");
    if (!fullQuery) {
      setEnrichError("Please enter at least a property street address first.");
      return;
    }
    setEnriching(true);
    setEnrichError(null);
    setEnrichSuccess(null);
    try {
      const res = await api.lookupProperty(fullQuery);
      if (res.property) {
        const p = res.property;
        setEnrichedData(p);
        setForm((prev) => {
          const nextCustom = [...prev.customFields];
          const setCustom = (name: string, val: string | number) => {
            const idx = nextCustom.findIndex((c) => c.name === name);
            if (idx >= 0) nextCustom[idx] = { name, value: String(val) };
            else nextCustom.push({ name, value: String(val) });
          };
          if (p.bedrooms) setCustom("bedrooms", p.bedrooms);
          if (p.bathrooms) setCustom("bathrooms", p.bathrooms);
          if (p.squareFootage) setCustom("squareFootage", p.squareFootage);
          if (p.yearBuilt) setCustom("yearBuilt", p.yearBuilt);
          if (p.estimatedValue) setCustom("estimatedValue", p.estimatedValue);
          if (p.estimatedRent) setCustom("rentEstimate", p.estimatedRent);

          return {
            ...prev,
            address: p.addressLine1 || prev.address,
            city: p.city || prev.city,
            state: p.state || prev.state,
            zip: p.zipCode || prev.zip,
            dealValue: p.estimatedValue || prev.dealValue,
            companyName: prev.companyName || p.ownerName || "",
            customFields: nextCustom,
          };
        });
        setEnrichSuccess(`Auto-enriched specs & AVM ($${p.estimatedValue.toLocaleString()}) via ${p.source === "rentcast" ? "RentCast API" : "Property Valuation Engine"}!`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to auto-enrich property.";
      setEnrichError(msg);
    } finally {
      setEnriching(false);
    }
  };

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
      setError("Business / Company name is required.");
      return;
    }
    setError(null);
    const subCost = Number(form.monthlyAmount) || 0;
    const bType = form.businessType?.trim() || "Wholesale Real Estate";
    onSave(
      {
        ...form,
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        businessType: bType,
        clientType: form.clientType === "residential" ? "residential" : "commercial",
        monthlyAmount: subCost,
        dealValue: Number(form.dealValue) || subCost,
        stage: form.stage || createStage,
        services: [...form.services],
        customFields: form.customFields,
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

  function submitWholesale(e: FormEvent) {
    e.preventDefault();
    if (!form.address.trim()) {
      setError("Property address is required.");
      return;
    }
    const sellerName = form.companyName.trim() || form.contactName.trim() || "Property Owner";
    let ct = form.clientType;
    if (!ct || ct === "residential") {
      ct = "single_family";
    }

    setError(null);
    onSave(
      {
        ...form,
        companyName: sellerName,
        contactName: sellerName,
        clientType: ct,
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        zip: form.zip.trim(),
        agentName: form.agentName.trim(),
        agentEmail: form.agentEmail.trim(),
        agentPhone: form.agentPhone.trim(),
        services: [...form.services],
        stage: form.stage || (stages[0] ?? "Leads"),
        dealValue: Number(form.dealValue) || 0,
        monthlyAmount: 0,
        billingSame: true,
        customFields: form.customFields,
        lost: false,
        lostReason: "",
        dnc: false,
        dncReason: "",
        dncDate: "",
        demoOutcome: "",
        followUpNote: "",
        tier: "",
        timezone: "",
      },
      client,
    );
  }

  if (isWholesale) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label={client ? "Edit Property" : "New Property"}>
        <div className="modal modal-lg">
          <div className="modal-head">
            <h2>{client ? "Edit Property" : "New Property"}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
              ✕
            </button>
          </div>
          <form onSubmit={submitWholesale} className="form modal-form">
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}

            {/* Auto-Enrichment Toolbar */}
            <div
              style={{
                background: "var(--surface-sunken, rgba(255,255,255,0.03))",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "14px 16px",
                marginBottom: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <strong style={{ fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>⚡</span> Property Lead Auto-Enrichment
                  </strong>
                  <span style={{ fontSize: "12px", color: "var(--text-dim)", display: "block" }}>
                    Pull beds, baths, sqft, year built, AVM market value & comps automatically.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleAutoEnrich}
                  disabled={enriching || !form.address.trim()}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {enriching ? "🔍 Enriching..." : "⚡ Auto-Enrich Data"}
                </button>
              </div>

              {enrichError && (
                <div className="alert alert-error" style={{ margin: 0, fontSize: "12px", padding: "6px 10px" }}>
                  {enrichError}
                </div>
              )}
              {enrichSuccess && (
                <div className="alert alert-success" style={{ margin: 0, fontSize: "12px", padding: "6px 10px" }}>
                  ✓ {enrichSuccess}
                </div>
              )}

              {enrichedData && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                    gap: "8px",
                    background: "var(--surface)",
                    padding: "10px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    fontSize: "12px",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--text-dim)", display: "block" }}>AVM Value</span>
                    <strong style={{ color: "var(--primary)" }}>${enrichedData.estimatedValue.toLocaleString()}</strong>
                  </div>
                  {enrichedData.estimatedRent ? (
                    <div>
                      <span style={{ color: "var(--text-dim)", display: "block" }}>Market Rent</span>
                      <strong>${enrichedData.estimatedRent.toLocaleString()}/mo</strong>
                    </div>
                  ) : null}
                  <div>
                    <span style={{ color: "var(--text-dim)", display: "block" }}>Specs</span>
                    <strong>{enrichedData.bedrooms}b / {enrichedData.bathrooms}ba • {enrichedData.squareFootage} sqft</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", display: "block" }}>Year / Type</span>
                    <strong>{enrichedData.yearBuilt || "N/A"} • {enrichedData.propertyType}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* 1. Property Address */}
            <fieldset className="field addr-group intake-block">
              <legend className="field-label" style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)" }}>
                📍 Property Address *
              </legend>
              <div className="field">
                <input
                  value={form.address}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Street address (e.g. 123 Maple Street)"
                  maxLength={200}
                  required
                  autoFocus
                  aria-label="Property street address"
                />
              </div>
              <div className="form-row-3">
                <label className="field">
                  <span className="field-label">City</span>
                  <input
                    value={form.city}
                    className={pii ? "pii-blur" : undefined}
                    onChange={(e) => set("city", e.target.value)}
                    placeholder="Phoenix"
                    maxLength={100}
                  />
                </label>
                <label className="field">
                  <span className="field-label">State</span>
                  <input
                    value={form.state}
                    className={pii ? "pii-blur" : undefined}
                    onChange={(e) => set("state", e.target.value)}
                    placeholder="AZ"
                    maxLength={50}
                  />
                </label>
                <label className="field">
                  <span className="field-label">ZIP</span>
                  <input
                    value={form.zip}
                    className={pii ? "pii-blur" : undefined}
                    onChange={(e) => set("zip", e.target.value)}
                    placeholder="85001"
                    maxLength={20}
                  />
                </label>
              </div>
            </fieldset>

            {/* 2. Property Type */}
            <div className="field">
              <span className="field-label" style={{ fontWeight: 600, fontSize: "14px" }}>Property Type</span>
              <div className="seg seg-type" role="radiogroup" aria-label="Property type">
                {[
                  { value: "single_family", label: "Single Family" },
                  { value: "multi_family", label: "Multi Family" },
                  { value: "commercial", label: "Commercial" },
                ].map((t) => {
                  const isChecked =
                    form.clientType === t.value ||
                    (!form.clientType && t.value === "single_family") ||
                    (form.clientType === "residential" && t.value === "single_family");
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={isChecked}
                      className={isChecked ? "seg-btn active" : "seg-btn"}
                      onClick={() => set("clientType", t.value as ClientType)}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Owner */}
            <section className="intake-section" aria-label="Owner">
              <div className="intake-section-title">👤 Owner</div>
              <div className="form-grid intake-grid">
                <label className="field">
                  <span className="field-label">Owner name *</span>
                  <input
                    type="text"
                    value={form.companyName}
                    onChange={(e) => set("companyName", e.target.value)}
                    className={pii ? "pii-blur" : undefined}
                    placeholder="e.g. John Smith"
                    maxLength={200}
                    required
                    aria-label="Owner name"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Owner email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    className={pii ? "pii-blur" : undefined}
                    placeholder="john@example.com"
                    maxLength={200}
                    aria-label="Owner email"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Owner phone</span>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    className={pii ? "pii-blur" : undefined}
                    placeholder="+1 555 000 1234"
                    maxLength={50}
                    aria-label="Owner phone"
                  />
                </label>
              </div>
            </section>

            {/* 4. Listing Agent */}
            <section className="intake-section" aria-label="Listing Agent">
              <div className="intake-section-title">💼 Listing Agent (Optional)</div>
              <div className="form-grid intake-grid">
                <label className="field">
                  <span className="field-label">Agent name</span>
                  <input
                    type="text"
                    value={form.agentName}
                    onChange={(e) => set("agentName", e.target.value)}
                    className={pii ? "pii-blur" : undefined}
                    placeholder="e.g. Sarah Johnson"
                    maxLength={200}
                    aria-label="Agent name"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Agent email</span>
                  <input
                    type="email"
                    value={form.agentEmail}
                    onChange={(e) => set("agentEmail", e.target.value)}
                    className={pii ? "pii-blur" : undefined}
                    placeholder="sarah@realty.com"
                    maxLength={200}
                    aria-label="Agent email"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Agent phone</span>
                  <input
                    type="tel"
                    value={form.agentPhone}
                    onChange={(e) => set("agentPhone", e.target.value)}
                    className={pii ? "pii-blur" : undefined}
                    placeholder="+1 555 000 9876"
                    maxLength={50}
                    aria-label="Agent phone"
                  />
                </label>
              </div>
            </section>

            {/* 5. Structure (Deal Offer) */}
            <section className="intake-section" aria-label="Structure (Deal Offer)">
              <div className="intake-section-title">🏷️ Structure (Deal Offer)</div>
              <div className="field">
                <span className="field-label">Deal Structures / Offer Types</span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                  {["Cash MAO", "Subject-To", "Seller Financing", "Novation"].map((opt) => {
                    const active = form.services.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={active ? "seg-btn active" : "seg-btn"}
                        style={{ padding: "6px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: 500 }}
                        onClick={() => {
                          if (active) {
                            removeService(opt);
                          } else {
                            setForm((f) => ({ ...f, services: [...f.services, opt] }));
                          }
                        }}
                      >
                        {active ? "✓ " : "+ "}{opt}
                      </button>
                    );
                  })}
                </div>
                {form.services.length > 0 && (
                  <div className="chips" style={{ marginTop: "6px" }}>
                    {form.services.map((s) => (
                      <span className="chip" key={s}>
                        {s}
                        <button
                          type="button"
                          className="chip-remove"
                          onClick={() => removeService(s)}
                          aria-label={`Remove structure ${s}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="chip-add" style={{ marginTop: "8px" }}>
                  <input
                    value={serviceDraft}
                    onChange={(e) => setServiceDraft(e.target.value)}
                    onKeyDown={onServiceKey}
                    placeholder="Or type another deal structure & press Enter…"
                    aria-label="Add custom deal structure"
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addService}>
                    Add
                  </button>
                </div>
              </div>
            </section>

            {/* 6. Pipeline Stage */}
            <section className="intake-section" aria-label="Pipeline Stage">
              <div className="intake-section-title">📊 Stage</div>
              <div className="field">
                <span className="field-label">Current Stage</span>
                <select
                  value={form.stage}
                  onChange={(e) => set("stage", e.target.value)}
                  aria-label="Pipeline stage"
                >
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : client ? "Save changes" : "Create Property"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={client ? "Edit Lead" : "New Lead"}>
      <div className="modal">
        <div className="modal-head">
          <h2>{client ? "Edit Lead" : "New Lead"}</h2>
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

          {/* 1. Workspace Type */}
          <div className="field">
            <label className="field-label" style={{ fontWeight: 600, fontSize: "14px", marginBottom: "8px", display: "block" }}>
              🏢 Workspace Type *
            </label>
            <div className="seg seg-type" role="radiogroup" aria-label="Workspace type">
              {[
                { value: "Wholesale Real Estate", label: "Wholesale Real Estate" },
                { value: "B2B", label: "B2B" },
                { value: "B2C", label: "B2C" },
              ].map((t) => {
                const isChecked =
                  form.businessType === t.value ||
                  (!form.businessType && t.value === "Wholesale Real Estate");
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={isChecked}
                    className={isChecked ? "seg-btn active" : "seg-btn"}
                    onClick={() => set("businessType", t.value)}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Contact Information */}
          <section className="intake-section" aria-label="Contact information" style={{ marginTop: "18px" }}>
            <div className="intake-section-title" style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>
              👤 Contact Information
            </div>
            <div className="form-grid intake-grid">
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field-label">Business / Company Name *</span>
                <input
                  value={form.companyName}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("companyName", e.target.value)}
                  placeholder="e.g. Apex Property Investments"
                  maxLength={200}
                  required
                  autoFocus
                />
              </label>
              <label className="field">
                <span className="field-label">Contact Name</span>
                <input
                  value={form.contactName}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("contactName", e.target.value)}
                  placeholder="e.g. John Doe"
                  maxLength={100}
                />
              </label>
              <label className="field">
                <span className="field-label">Email Address</span>
                <input
                  type="email"
                  value={form.email}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="john@example.com"
                  maxLength={100}
                />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field-label">Phone Number</span>
                <input
                  type="tel"
                  value={form.phone}
                  className={pii ? "pii-blur" : undefined}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(555) 000-0000"
                  maxLength={50}
                />
              </label>
            </div>
          </section>

          {/* 3. Subscription Cost */}
          <section className="intake-section" aria-label="Subscription cost" style={{ marginTop: "18px" }}>
            <div className="intake-section-title" style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>
              💳 Subscription Cost
            </div>
            <label className="field">
              <span className="field-label">Monthly Subscription Cost ($ / month)</span>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <span style={{ position: "absolute", left: "12px", color: "var(--muted)", fontWeight: 600 }}>$</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="199"
                  value={form.monthlyAmount === 0 ? "" : String(form.monthlyAmount)}
                  onChange={(e) => {
                    const val = e.target.value === "" ? 0 : Number(e.target.value);
                    set("monthlyAmount", val);
                    set("dealValue", val);
                  }}
                  style={{ paddingLeft: "26px", fontSize: "15px" }}
                  aria-label="Monthly subscription cost in dollars"
                />
              </div>
              <span className="field-hint">
                The recurring monthly subscription cost for this client's workspace.
              </span>
            </label>
          </section>

          {/* Stage selector */}
          {stages && stages.length > 0 && (
            <div className="field" style={{ marginTop: "18px" }}>
              <span className="field-label">Pipeline Stage</span>
              <select
                value={form.stage}
                onChange={(e) => set("stage", e.target.value)}
                style={{ fontSize: "14px", padding: "8px 12px" }}
              >
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="modal-actions" style={{ marginTop: "24px" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : client ? "Save changes" : "Create Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
