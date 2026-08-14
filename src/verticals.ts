/**
 * Vertical template catalog (Adaptive Intake 3f-1) — data-only, shared by the
 * client (Admin create-account form, Settings) and the server (org seeding +
 * additive template apply). One entry per vertical; a future vertical = one
 * new entry here.
 *
 * When the owner provisions a client account they pick a Business type; the
 * new org is seeded from the matching template: its pipeline stage names, its
 * vertical-specific custom fields, and its account-level vertical settings
 * (industry / service model / delivery type). Every vertical shares ONE layout
 * engine — the template only pre-seeds per-org stages and custom fields, which
 * the tenant can rename/reorder/edit afterward exactly like any other tenant.
 *
 * Nothing here is hardcoded per vertical in the UI: the Admin form and the
 * Settings "apply" affordance both iterate this catalog generically.
 *
 * NOTE: this module must stay dependency-free (no imports from types.ts or
 * db.ts) so both the browser bundle and the Bun server can import it.
 */

/** Industry categories per the adaptive-intake spec ('' = unspecified). */
export type VerticalIndustry = "home_services" | "mobile_personal" | "professional" | "other" | "";
export type VerticalServiceModel = "residential_only" | "commercial_only" | "both";
export type VerticalDeliveryType = "client_comes" | "we_go" | "both";

/** A vertical-specific custom-field definition at the template level: the
 *  vocabulary is text / yesno / select (select fields carry their options).
 *  `templateFieldDefs()` maps these onto the stored org custom-field shape
 *  (text → text, yesno → checkbox, select → select + options). */
export interface VerticalFieldDef {
  label: string;
  type: "text" | "yesno" | "select";
  options?: string[];
}

export interface VerticalTemplate {
  /** Stable snake_case id (also stored on orgs.vertical_key). */
  key: string;
  /** Display name in the Admin create form and Settings. */
  label: string;
  industry: VerticalIndustry;
  serviceModel: VerticalServiceModel;
  deliveryType: VerticalDeliveryType;
  /** Ordered pipeline stage names to seed for a new org. */
  defaultStages: string[];
  /** Vertical-specific custom fields to seed for a new org. */
  defaultFields: VerticalFieldDef[];
}

/** The "no preset" option — current behavior (default stages, no seeded
 *  fields). Included in the catalog so the Admin select and the server treat
 *  it uniformly; applying it never touches stages or fields. */
export const GENERAL_VERTICAL: VerticalTemplate = {
  key: "general",
  label: "General (no preset)",
  industry: "",
  serviceModel: "both",
  deliveryType: "both",
  defaultStages: [],
  defaultFields: [],
};

/** Business types the owner can pick when provisioning a client account.
 *  Stage names are the owner's exact lists (title-cased); custom fields are
 *  the PM's proposals — typed (text/yesno/select) and org-scoped. */
export const VERTICALS: VerticalTemplate[] = [
  {
    key: "cleaning",
    label: "Cleaning",
    industry: "home_services",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Leads", "Quotes", "Recurring bookings", "Cleaners"],
    defaultFields: [
      { label: "Service frequency", type: "select", options: ["Weekly", "Biweekly", "Monthly"] },
      { label: "Pets on premises", type: "yesno" },
      { label: "Access instructions", type: "text" },
      { label: "Assigned cleaner", type: "text" },
    ],
  },
  {
    key: "plumbing",
    label: "Plumbing",
    industry: "home_services",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Leads", "Dispatch", "Jobs", "Estimates", "Recurring service"],
    defaultFields: [
      { label: "Emergency service", type: "yesno" },
      { label: "Permit required", type: "yesno" },
      { label: "Warranty", type: "text" },
      { label: "Fixture / equipment type", type: "text" },
    ],
  },
  {
    key: "landscaping",
    label: "Landscaping",
    industry: "home_services",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Leads", "Quotes", "Recurring clients", "Crews", "Jobs"],
    defaultFields: [
      { label: "Property size", type: "text" },
      { label: "Service frequency", type: "select", options: ["Weekly", "Biweekly", "Monthly", "One-time"] },
      { label: "Full-service vs mowing", type: "select", options: ["Full-service", "Mowing only"] },
      { label: "Assigned crew", type: "text" },
    ],
  },
  {
    key: "pest_control",
    label: "Pest Control",
    industry: "home_services",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Leads", "Inspections", "Recurring treatments", "Renewals"],
    defaultFields: [
      { label: "Pest type", type: "select", options: ["Ants", "Rodents", "Termites", "Bed bugs", "Cockroaches", "Mosquitoes", "Other"] },
      { label: "Treatment frequency", type: "select", options: ["Monthly", "Quarterly", "Semi-annual", "Annual", "One-time"] },
      { label: "Renewal reminder", type: "text" },
      { label: "COI required", type: "yesno" },
    ],
  },
  {
    key: "pool_service",
    label: "Pool Service",
    industry: "home_services",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Customers", "Routes", "Recurring service", "Repairs"],
    defaultFields: [
      { label: "Pool type", type: "select", options: ["In-ground", "Above-ground"] },
      { label: "Route assignment", type: "text" },
      { label: "Service day", type: "text" },
      { label: "Repairs needed", type: "text" },
    ],
  },
  {
    key: "painting",
    label: "Painting",
    industry: "home_services",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Leads", "Estimates", "Projects", "Crews", "Payments"],
    defaultFields: [
      { label: "Interior / exterior", type: "select", options: ["Interior", "Exterior", "Both"] },
      { label: "Square footage", type: "text" },
      { label: "Paint brand preference", type: "text" },
      { label: "Assigned crew", type: "text" },
    ],
  },
  {
    key: "flooring",
    label: "Flooring",
    industry: "home_services",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Leads", "Measurements", "Estimates", "Installations"],
    defaultFields: [
      { label: "Material", type: "select", options: ["Hardwood", "Laminate", "Tile", "Carpet", "Vinyl", "Concrete", "Other"] },
      { label: "Rooms / measurements", type: "text" },
      { label: "Subfloor condition", type: "text" },
      { label: "Installation date", type: "text" },
    ],
  },
  {
    key: "med_spa",
    label: "Med Spa",
    industry: "mobile_personal",
    serviceModel: "both",
    deliveryType: "client_comes",
    defaultStages: ["Leads", "Consultations", "Booked", "Treatments", "Retention"],
    defaultFields: [
      { label: "License number", type: "text" },
      { label: "Consultation date", type: "text" },
      { label: "Treatment types", type: "select", options: ["Botox / injectables", "Laser", "Facials", "Body contouring", "IV therapy", "Other"] },
      { label: "Insurance", type: "text" },
    ],
  },
  {
    key: "real_estate",
    label: "Real Estate",
    industry: "professional",
    serviceModel: "both",
    deliveryType: "we_go",
    defaultStages: ["Leads", "Tours", "Offers", "Under Contract", "Closed"],
    defaultFields: [
      { label: "Property type", type: "select", options: ["Single-family", "Condo", "Townhouse", "Multi-family", "Commercial", "Land"] },
      { label: "Listing vs buying", type: "select", options: ["Listing", "Buying", "Both"] },
      { label: "Closing date", type: "text" },
      { label: "MLS #", type: "text" },
    ],
  },
];

/** All selectable business types in display order: General first, then the
 *  verticals. Used by the Admin create-account form and the Settings apply
 *  affordance. */
export const ALL_VERTICALS: VerticalTemplate[] = [GENERAL_VERTICAL, ...VERTICALS];

/** key → template for the real verticals (General is handled explicitly —
 *  see getVertical). */
export const VERTICAL_MAP: Record<string, VerticalTemplate> = Object.fromEntries(
  VERTICALS.map((v) => [v.key, v]),
);

/** Resolve a vertical key → template, or null when unknown. "general" (and the
 *  empty string) resolve to the no-preset template. */
export function getVertical(key: string | null | undefined): VerticalTemplate | null {
  if (!key) return GENERAL_VERTICAL;
  return VERTICAL_MAP[key] ?? (key === GENERAL_VERTICAL.key ? GENERAL_VERTICAL : null);
}

/** Display label for an org's stored vertical_key ("" = General). */
export function verticalLabel(key: string | null | undefined): string {
  if (!key) return GENERAL_VERTICAL.label;
  return VERTICAL_MAP[key]?.label ?? GENERAL_VERTICAL.label;
}

/** Stored org custom-field shape (orgs.custom_fields entries). */
export interface StoredFieldDef {
  name: string;
  type: "text" | "number" | "date" | "checkbox" | "select";
  options?: string[];
}

/** Map template-level field defs (text/yesno/select) onto the stored org
 *  custom-field shape: yesno → checkbox (the app's existing yes/no field type,
 *  stored "1"/"0"), select keeps its options. */
export function templateFieldDefs(fields: VerticalFieldDef[]): StoredFieldDef[] {
  return fields.map((f) => {
    if (f.type === "select") {
      return { name: f.label, type: "select", options: f.options ?? [] };
    }
    return { name: f.label, type: f.type === "yesno" ? "checkbox" : "text" };
  });
}
