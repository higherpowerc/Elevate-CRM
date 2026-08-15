/**
 * Adaptive intake — pure rules engine (owner spec 2026-08-13, Step 4).
 *
 * The client New/Edit modal renders whichever sections/fields this engine
 * returns; a field shows iff (client-type gate) AND (industry gate) AND
 * (optional gate if ➖). The engine is a pure function of the org's vertical
 * config + the selected client type (+ the current business-type value, which
 * narrows the HOA sub-fields), so new verticals can be added without touching
 * the form.
 *
 * Mapping notes (resolved ambiguities, per the Phase 2 brief):
 * - "Individual" == stored client_type "residential" (labels only; no API
 *   change). The modal maps before calling in.
 * - service_model / delivery_type are accepted for future rules but do not
 *   gate any current field — visibility is keyed on industry + intake_opts +
 *   client type, exactly as the brief's QA scenarios describe.
 * - PO required shows for Commercial in every industry EXCEPT mobile_personal
 *   and professional (brief: "HOA/PM/COI/PO never for professional").
 * - HOA name/contact additionally require businessType ∈ {HOA, Property
 *   Management} (spec Step 3 B).
 * - pet_on_premises / parking_access: for home_services they are ➖ optional
 *   (need the matching intake opt); for mobile_personal they always show.
 */
import type { ClientType } from "./types";
import type { CustomIntakeGroup, IntakeGroupFieldKind } from "./types";

/** The UI-level client type used by the intake form. "individual" maps to the
 *  stored "residential" value — see the note above. */
export type IntakeClientType = "commercial" | "individual";

/** The subset of OrgSettings the engine reads (whole object is fine to pass —
 *  the engine ignores serviceModel/deliveryType today). */
export interface IntakeOrgSettings {
  industry: string;
  serviceModel: string;
  deliveryType: string;
  intakeOpts: string[];
  /** Owner request 2026-08-14 — the org's revenue model ("sales" |
   *  "subscription"). "subscription" orgs get the per-client "Monthly amount"
   *  field in the universal section. */
  revenueModel?: "sales" | "subscription";
  /** Adaptive intake Phase 3: tenant-defined custom conditional field groups
   *  (rendered for every industry, not just "other"). */
  customIntakeGroups?: CustomIntakeGroup[];
}

/** The business-type datalist options (spec Step 3 B — org-configurable later). */
export const BUSINESS_TYPES = [
  "Property Management",
  "HOA",
  "Retail",
  "Office",
  "Restaurant",
  "Other",
] as const;

/** Preferred contact method options (spec Step 3 A). */
export const CONTACT_METHODS = ["Phone", "Email", "Text (SMS)", "Mail", "Other"] as const;

export type IntakeFieldKind =
  | "text" // single-line input
  | "textarea" // multi-line input (full width)
  | "yesno" // segmented Yes / No
  | "select" // dropdown (options; empty default)
  | "datalist" // input with datalist suggestions
  | "address" // service-address block (street/city/state/zip)
  | "billing" // billing block (same-as toggle + address when unchecked)
  | "llc" // collapsed Business name / LLC tab (dba_name + ein_ssn)
  | "services" // service chip editor
  | "custom" // tenant custom fields
  | "archived" // archived checkbox
  | "customgroup"; // Phase 3: a field of a tenant-defined custom intake group

export interface IntakeField {
  /** Client record key (camelCase — matches the API / Client type). */
  key: string;
  label: string;
  kind: IntakeFieldKind;
  placeholder?: string;
  maxLength?: number;
  /** For select / datalist fields. */
  options?: readonly string[];
  /** Phase 3 (customgroup fields only): the intake-group field key values are
   *  stored under (client customFields {name: key, value}) and its kind. */
  groupKey?: string;
  groupKind?: IntakeGroupFieldKind;
}

export interface IntakeSection {
  id: string;
  title: string;
  fields: IntakeField[];
}

const homeServices = (industry: string) => industry === "home_services";
const mobilePersonal = (industry: string) => industry === "mobile_personal";
const professional = (industry: string) => industry === "professional";

/** Map the stored client type to the UI-level intake type. */
export function intakeClientType(clientType: ClientType): IntakeClientType {
  return clientType === "commercial" ? "commercial" : "individual";
}

/**
 * The org's ENABLED custom intake groups that apply to the given client type
 * (Phase 3). Pure rule: enabled AND (appliesTo is "both" OR matches the
 * client type). Works for every industry — "other" and the presets alike —
 * so owners can extend the form beyond the built-in verticals.
 */
export function getCustomGroupsFor(
  settings: IntakeOrgSettings,
  clientType: IntakeClientType,
): CustomIntakeGroup[] {
  return (settings.customIntakeGroups ?? []).filter(
    (g) => g.enabled && (g.appliesTo === "both" || g.appliesTo === clientType),
  );
}

/**
 * The full adaptive form layout for an org + client-type (+ business-type)
 * combination: an ordered list of sections; each section's fields render in
 * order. Sections with zero fields are omitted by the caller. Universal is
 * always first and always present.
 */
export function getIntakeLayout(
  settings: IntakeOrgSettings,
  clientType: IntakeClientType,
  businessType?: string,
): IntakeSection[] {
  const industry = settings.industry ?? "";
  const opts = new Set(settings.intakeOpts ?? []);
  const commercial = clientType === "commercial";
  const bt = (businessType ?? "").trim();
  const hoaShown = bt === "HOA" || bt === "Property Management";

  const sections: IntakeSection[] = [];

  /* ── Universal (always — both client types, every industry) ─────────── */
  sections.push({
    id: "universal",
    title: "Universal",
    fields: [
      {
        key: "companyName",
        label: commercial ? "Company name *" : "Name *",
        kind: "text",
        placeholder: commercial ? "e.g. Acme Landscaping" : "e.g. Jane Doe",
        maxLength: 200,
      },
      { key: "contactName", label: "Contact name", kind: "text", placeholder: "Jordan Lee", maxLength: 200 },
      { key: "email", label: "Email", kind: "text", placeholder: "jordan@acme.com", maxLength: 200 },
      { key: "phone", label: "Phone", kind: "text", placeholder: "+1 555 000 1234", maxLength: 50 },
      { key: "dealValue", label: "Deal value ($)", kind: "text", placeholder: "9500.50" },
      /* Owner request 2026-08-14 — the per-client monthly amount shows ONLY
         for "subscription"-model orgs (their customers on recurring billing);
         sales-model orgs keep the form exactly as before. */
      ...(settings.revenueModel === "subscription"
        ? [{ key: "monthlyAmount", label: "Monthly amount ($)", kind: "text", placeholder: "e.g. 49.00" } as IntakeField]
        : []),
      { key: "stage", label: "Stage", kind: "select" },
      { key: "nextAction", label: "Next action", kind: "text", placeholder: "e.g. Send proposal by Friday", maxLength: 500 },
      { key: "address", label: "Address", kind: "address" },
      { key: "billing", label: "Billing address", kind: "billing" },
      {
        key: "preferredContactMethod",
        label: "Preferred contact method",
        kind: "select",
        options: CONTACT_METHODS,
      },
      {
        key: "leadSource",
        label: "Referral source",
        kind: "text",
        placeholder: "Referral, Website, Walk-in…",
        maxLength: 100,
      },
      { key: "website", label: "Website", kind: "text", placeholder: "https://acme.com", maxLength: 200 },
      { key: "notes", label: "Notes", kind: "textarea", placeholder: "Scope notes, meeting takeaways, context…" },
      { key: "services", label: "Services", kind: "services" },
      { key: "custom", label: "Custom fields", kind: "custom" },
      { key: "archived", label: "Archived", kind: "archived" },
    ],
  });

  /* ── Commercial intake (only when the client type is Commercial) ─────── */
  if (commercial) {
    const commercialFields: IntakeField[] = [
      {
        key: "businessType",
        label: "Business type",
        kind: "datalist",
        options: BUSINESS_TYPES,
        placeholder: "Property Management, HOA, Retail…",
        maxLength: 120,
      },
      { key: "taxIdEin", label: "Tax ID / EIN", kind: "text", placeholder: "EIN or tax ID", maxLength: 50 },
      {
        key: "apContact",
        label: "Accounts payable contact",
        kind: "text",
        placeholder: "If different from the primary contact",
        maxLength: 200,
      },
    ];
    // PO required: Commercial, but never for mobile_personal or professional
    // (spec Step 4 table + Phase 2 brief).
    if (!mobilePersonal(industry) && !professional(industry)) {
      commercialFields.push({ key: "poRequired", label: "PO required", kind: "yesno" });
    }
    commercialFields.push({
      key: "unitsLocations",
      label: "Units / locations",
      kind: "text",
      placeholder: "e.g. 12 units across 3 sites",
      maxLength: 200,
    });
    sections.push({ id: "commercial", title: "Business intake", fields: commercialFields });

    /* Home-services sub-group (only industry = home_services AND commercial) */
    if (homeServices(industry)) {
      sections.push({
        id: "home-commercial",
        title: "Home services",
        fields: [
          {
            key: "propertyManagerName",
            label: "Property manager name",
            kind: "text",
            placeholder: "Who manages the property",
            maxLength: 200,
          },
          {
            key: "propertyManagerContact",
            label: "Property manager contact",
            kind: "text",
            placeholder: "Phone / email",
            maxLength: 200,
          },
          // HOA name/contact only when the business type is HOA or Property Management.
          ...(hoaShown
            ? [
                { key: "hoaName", label: "HOA name", kind: "text", placeholder: "Association name", maxLength: 200 } as IntakeField,
                { key: "hoaContact", label: "HOA contact", kind: "text", placeholder: "Phone / email", maxLength: 200 } as IntakeField,
              ]
            : []),
          {
            key: "accessInstructions",
            label: "Access instructions",
            kind: "textarea",
            placeholder: "Gate codes, key/lockbox, tenant notification requirements…",
            maxLength: 2000,
          },
          { key: "coiRequired", label: "Certificate of insurance required", kind: "yesno" },
          {
            key: "serviceContract",
            label: "Service contract",
            kind: "textarea",
            placeholder: "Recurring maintenance agreement details…",
            maxLength: 2000,
          },
        ],
      });
    }
  }

  /* ── Individual intake (only when the client type is Individual) ─────── */
  if (!commercial) {
    const individualFields: IntakeField[] = [];
    // Business name / LLC tab — collapsed, only if the tenant enabled it (➖).
    if (opts.has("business_llc_tab")) {
      individualFields.push({ key: "llc", label: "Business name / LLC", kind: "llc" });
    }
    sections.push({ id: "individual", title: "Individual intake", fields: individualFields });

    /* Home-services sub-group (industry = home_services AND individual) */
    if (homeServices(industry)) {
      sections.push({
        id: "home-individual",
        title: "Home services",
        fields: [
          {
            key: "homeownerRenter",
            label: "Homeowner / renter",
            kind: "select",
            options: ["Homeowner", "Renter"],
          },
          // ➖ optional — only when the tenant enabled the group.
          ...(opts.has("hoa_restrictions")
            ? [
                {
                  key: "hoaRestrictions",
                  label: "HOA restrictions",
                  kind: "textarea",
                  placeholder: "Exterior work rules, approval needs…",
                  maxLength: 2000,
                } as IntakeField,
              ]
            : []),
          ...(opts.has("parking_access")
            ? [
                {
                  key: "parkingAccess",
                  label: "Parking / access",
                  kind: "textarea",
                  placeholder: "Where to park, gate codes, driveway notes…",
                  maxLength: 2000,
                } as IntakeField,
              ]
            : []),
          ...(opts.has("pet_on_premises")
            ? [{ key: "petOnPremises", label: "Pet on premises", kind: "yesno" } as IntakeField]
            : []),
        ],
      });
    }

    /* Mobile-personal sub-group (industry = mobile_personal AND individual) —
       always-on fields (spec Step 4: ✅ Shown). */
    if (mobilePersonal(industry)) {
      sections.push({
        id: "mobile-individual",
        title: "Mobile personal",
        fields: [
          {
            key: "parkingAccess",
            label: "Parking / access",
            kind: "textarea",
            placeholder: "Where to park, gate codes, driveway notes…",
            maxLength: 2000,
          },
          { key: "petOnPremises", label: "Pet on premises", kind: "yesno" },
          {
            key: "preferredServiceLocation",
            label: "Preferred service location",
            kind: "text",
            placeholder: "If not home — e.g. workplace",
            maxLength: 200,
          },
        ],
      });
    }
  }

  /* ── Custom conditional field groups (Phase 3) ────────────────────────
     The org's OWN groups — defined in Settings, rendered for every industry.
     Each enabled group whose appliesTo matches the client type becomes its
     own section titled by the group name; fields are text / yesno / select
     and their values live in the client's customFields by group field key. */
  for (const g of getCustomGroupsFor(settings, clientType)) {
    sections.push({
      id: `custom-${g.id}`,
      title: g.name,
      fields: g.fields.map((f) => ({
        key: f.key,
        label: f.label,
        kind: "customgroup",
        groupKey: f.key,
        groupKind: f.kind,
        ...(f.options ? { options: f.options } : {}),
      })),
    });
  }

  return sections;
}
