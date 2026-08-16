/**
 * Business-type template catalog (Adaptive Intake 3f-1; owner direction
 * 2026-08-16) — data-only, shared by the client (Admin create-account form,
 * Settings) and the server (org seeding + additive template apply). One entry
 * per business type; a future type = one new entry here.
 *
 * When the owner provisions a client account they pick a Business type; the
 * new org is seeded from the matching template: its pipeline stage names and
 * its account-level vertical settings (industry / service model / delivery
 * type / revenue model). BOTH types share the SAME generic pipeline
 * (Leads → Contacted → Quoted → Won) and seed NO preset custom fields —
 * accounts customize their own stages and fields afterward, exactly like any
 * other tenant.
 *
 * The multi-vertical catalog (Cleaning, Landscaping, Med Spa, …) was
 * collapsed to exactly two business types on 2026-08-16 ("we will no longer
 * need multiple business types… Mainly we will be selling B2B but sometimes
 * we will sell B2C"). Legacy stored keys ('general','cleaning','landscaping',
 * …) are NOT in the catalog: verticalLabel() displays them as B2B and the
 * server's plain-org path / "apply B2B template" is the migration route.
 *
 * Nothing here is hardcoded per type in the UI: the Admin form and the
 * Settings "apply" affordance both iterate this catalog generically.
 *
 * NOTE: this module must stay dependency-free (no imports from types.ts or
 * db.ts) so both the browser bundle and the Bun server can import it.
 */

/** Industry categories per the adaptive-intake spec ('' = unspecified). */
export type VerticalIndustry = "home_services" | "mobile_personal" | "professional" | "other" | "";
export type VerticalServiceModel = "residential_only" | "commercial_only" | "both";
export type VerticalDeliveryType = "client_comes" | "we_go" | "both";
/** Owner request 2026-08-14 — how the new org's OWN business makes money:
 *  "sales" (one-off jobs/invoices) | "subscription" (recurring book). Seeded
 *  at account creation; the tenant can change it later in Settings. */
export type VerticalRevenueModel = "sales" | "subscription";

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
  /** Owner request 2026-08-14 — the revenue model seeded for a NEW org of
   *  this type. */
  revenueModel: VerticalRevenueModel;
  /** Ordered pipeline stage names to seed for a new org. */
  defaultStages: string[];
  /** Vertical-specific custom fields to seed for a new org. */
  defaultFields: VerticalFieldDef[];
}

/** B2B — the default business type (owner direction 2026-08-16: "Mainly we
 *  will be selling B2B"). Generic pipeline, no preset custom fields. */
export const B2B_VERTICAL: VerticalTemplate = {
  key: "b2b",
  label: "B2B",
  industry: "professional",
  serviceModel: "commercial_only",
  deliveryType: "both",
  revenueModel: "subscription",
  defaultStages: ["Leads", "Contacted", "Quoted", "Won"],
  defaultFields: [],
};

/** B2C — the second (and only other) business type. Same generic pipeline,
 *  no preset custom fields. */
export const B2C_VERTICAL: VerticalTemplate = {
  key: "b2c",
  label: "B2C",
  industry: "home_services",
  serviceModel: "residential_only",
  deliveryType: "both",
  revenueModel: "subscription",
  defaultStages: ["Leads", "Contacted", "Quoted", "Won"],
  defaultFields: [],
};

/** The two business types. Used by the server's sold-lead industry matching
 *  (verticalForIndustry) — industry text no longer maps to the retired
 *  catalog, so unmatched leads provision the plain default pipeline. */
export const VERTICALS: VerticalTemplate[] = [B2B_VERTICAL, B2C_VERTICAL];

/** All selectable business types in display order: B2B first (the default),
 *  then B2C. Used by the Admin create-account form and the Settings apply
 *  affordance. */
export const ALL_VERTICALS: VerticalTemplate[] = VERTICALS;

/** key → template. */
export const VERTICAL_MAP: Record<string, VerticalTemplate> = Object.fromEntries(
  VERTICALS.map((v) => [v.key, v]),
);

/** Resolve a business-type key → template, or null when unknown. Legacy keys
 *  from the retired catalog ('general', 'cleaning', 'landscaping', …) are no
 *  longer valid here — they resolve to null (the server's plain-org path) and
 *  display as B2B via verticalLabel. */
export function getVertical(key: string | null | undefined): VerticalTemplate | null {
  if (!key) return null;
  return VERTICAL_MAP[key] ?? null;
}

/** Display label for an org's stored vertical_key. Unknown / empty / legacy
 *  keys ('general','cleaning','landscaping',…) all display as B2B — the
 *  default business type (owner direction 2026-08-16). */
export function verticalLabel(key: string | null | undefined): string {
  return VERTICAL_MAP[key ?? ""]?.label ?? B2B_VERTICAL.label;
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
