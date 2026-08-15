/** Default pipeline stages — the list every org starts with. The signed-in
 *  tenant's own list comes from the API (user.stages / /api/settings) and
 *  drives the stage dropdown, dashboard breakdown and client badges.
 *  NOTE (3g-2, owner direction 2026-08-14): the owner workspace's pipeline is
 *  Leads → Onboarding → Sold; the server migrates the owner org's stored stages
 *  at boot. This client-side list is only a pre-auth UI fallback, kept in
 *  sync with the owner pipeline. Tenant orgs always receive their own
 *  (vertical-seeded or default) stages from the API. */
export const DEFAULT_STAGES = [
  "Leads",
  "Onboarding",
  "Sold",
];
export type Stage = string;

/** Badge/visual tones are assigned by stage-list position (the list is
 *  tenant-defined, so names can't be mapped to tones anymore). */
export const STAGE_TONES = ["gray", "blue", "amber", "violet", "lime", "teal"] as const;
export const stageTone = (index: number): string =>
  STAGE_TONES[((index % STAGE_TONES.length) + STAGE_TONES.length) % STAGE_TONES.length];

/** The custom-field value types a tenant can define (Phase 3b; 3f-1 adds
 *  "select" for vertical templates — a dropdown with options). */
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "checkbox", "select"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** A tenant's custom-field definition (from /api/settings). `options` is
 *  present only for type "select" — the dropdown choices. */
export interface CustomFieldDef {
  name: string;
  type: CustomFieldType;
  options?: string[];
}

/** A client's stored custom-field value (name must match a tenant definition). */
export interface CustomField {
  name: string;
  value: string;
}

/** Adaptive intake Phase 3 — custom conditional field groups. A tenant
 *  defines its own intake groups in Settings; the adaptive client modal
 *  renders the ENABLED groups whose appliesTo matches the client type. */
export type IntakeGroupAppliesTo = "commercial" | "individual" | "both";
export type IntakeGroupFieldKind = "text" | "yesno" | "select";

/** A field inside a custom intake group. `key` is the stable snake_case id
 *  values are stored under (in the client's customFields array, as
 *  {name: key, value}); select fields carry their `options`. */
export interface CustomIntakeField {
  key: string;
  label: string;
  kind: IntakeGroupFieldKind;
  options?: string[];
}

/** A tenant-defined custom conditional intake group. */
export interface CustomIntakeGroup {
  id: string;
  name: string;
  appliesTo: IntakeGroupAppliesTo;
  enabled: boolean;
  fields: CustomIntakeField[];
}

/** Phase 3e: every client is Commercial or Residential (required on create
 *  and edit; existing rows backfilled to residential). */
export type ClientType = "commercial" | "residential";

/** Owner request 2026-08-14 — how an org's own business makes money:
 *  "sales" (one-off jobs/invoices) | "subscription" (recurring book). Seeded
 *  by vertical at account creation; editable in Settings (and by the owner in
 *  Admin). Drives which money figure the client dashboard shows. */
export const REVENUE_MODELS = ["sales", "subscription"] as const;
export type RevenueModel = (typeof REVENUE_MODELS)[number];

/** Owner cockpit B (owner direction 2026-08-15) — per-client DocuSign
 *  agreement status: "not_sent" → "sent" → "signed". The OWNER's Onboarding
 *  tab tracks where each client is in completing forms; real DocuSign
 *  envelope sending is wired LATER (once the owner connects a DocuSign
 *  account) — today the owner sets the status manually. OWNER-workspace-only:
 *  tenant orgs never receive this field (absent from their API responses). */
export type AgreementStatus = "not_sent" | "sent" | "signed";

export interface Client {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  industry: string;
  services: string[];
  customFields: CustomField[];
  dealValue: number;
  stage: Stage;
  nextAction: string;
  notes: string;
  archived: boolean;
  clientType: ClientType;
  address: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  leadSource: string;
  /** Adaptive intake Phase 1: optional billing + intake fields (all
   *  optional — the intake form drives which ones a tenant actually uses;
   *  the server always returns them, defaulting to '' / false). */
  billingAddress?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingSame?: boolean;
  preferredContactMethod?: string;
  businessType?: string;
  taxIdEin?: string;
  apContact?: string;
  poRequired?: boolean;
  unitsLocations?: string;
  propertyManagerName?: string;
  propertyManagerContact?: string;
  hoaName?: string;
  hoaContact?: string;
  accessInstructions?: string;
  coiRequired?: boolean;
  serviceContract?: string;
  dbaName?: string;
  einSsn?: string;
  homeownerRenter?: string;
  hoaRestrictions?: string;
  parkingAccess?: string;
  petOnPremises?: boolean;
  preferredServiceLocation?: string;
  /** Owner request 2026-08-14 — lost + DNC pipeline-status flags. `lost`
   *  leads are excluded from pipeline counts/KPIs and the pipeline rows; the
   *  Lost section on the Leads tab lists them. `dnc` is do-not-call: the
   *  warning banner shows in the record modal and the DNC list. */
  lost: boolean;
  lostReason: string;
  dnc: boolean;
  dncReason: string;
  dncDate: string;
  /** Owner request 2026-08-14 — this record's monthly amount (USD) in the
   *  org's OWN subscription book (used when the org's revenue_model =
   *  "subscription"). */
  monthlyAmount: number;
  /** Owner cockpit B (owner direction 2026-08-15) — DocuSign agreement
   *  status. OWNER-workspace-only: present on owner-org responses only
   *  (tenant orgs never receive the key). Optional so the client modal and
   *  tenant code never have to know about it. */
  agreementStatus?: AgreementStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  title: string;
  clientId: number | null;
  clientName: string;
  dueDate: string;
  done: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const INVOICE_STATUSES = ["draft", "sent", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface Invoice {
  id: number;
  clientId: number | null;
  clientName: string;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** One row of the dashboard "Task overview" upcoming list. */
export interface DashboardUpcomingTask {
  id: number;
  title: string;
  dueDate: string;
  done: boolean;
  clientName: string;
}

/** Org-scoped task aggregates for the dashboard Task overview panel. */
export interface DashboardTaskAgg {
  open: number;
  overdue: number;
  dueSoon: number;
  done: number;
  upcoming: DashboardUpcomingTask[];
}

/** stageCounts keys are the tenant's own stage names (dynamic). */
export interface DashboardData {
  stageCounts: Record<string, number>;
  projectedPipeline: number;
  totalClients: number;
  archivedClients: number;
  recentClients: Client[];
  /** Task overview (2026-08-14 owner request) — same org scoping as the rest. */
  tasks: DashboardTaskAgg;
  /** Owner request 2026-08-14 — MRR + vertical revenue dashboards.
   *  salesThisMonth / subscriptionsTotal / revenueModel are the session ORG's
   *  own money (present for every workspace); clientMrr + orgCount are the
   *  OWNER's cross-org figures and exist ONLY in the admin response — a
   *  member never receives them (isolation). */
  salesThisMonth: number;
  subscriptionsTotal: number;
  revenueModel: RevenueModel;
  clientMrr?: number;
  orgCount?: number;
}

export interface User {
  id: number;
  email: string;
  /** Org the user belongs to — every row the API returns is scoped to this. */
  orgId: number;
  /** Phase 1: `admin` behaves like `member` inside their own org. */
  role: "admin" | "member";
  /** Tenant display name (e.g. "Elevate Studio") — shown next to the email in the nav. */
  orgName?: string;
  /** The tenant's ordered pipeline stages (Phase 3a). */
  stages?: string[];
  /** The tenant's brand accent (hex). */
  accentColor?: string;
  created_at?: string;
}

/** A tenant (org) as listed in the owner's Admin view. */
export interface Org {
  id: number;
  name: string;
  createdAt: string;
  userCount: number;
  clientCount: number;
  /** 3g-3: the org's first member login email. */
  loginEmail?: string;
  /** 3g-3: the plaintext temp password — set ONLY for auto-provisioned orgs,
   *  and only until the member's first successful login clears it. Owner-only
   *  (the Admin list); never reachable from tenant-scoped endpoints. */
  tempPassword?: string;
  /** 3k: plaintext temp password from the Admin tab's per-tenant "Reset
   *  password" action — same delivery semantics as tempPassword (cleared on
   *  the member's first login). Owner-only. */
  resetPassword?: string;
  /** 3g-3: owner-org client id this workspace was auto-provisioned from
   *  (absent for manually created accounts). */
  provisionedFromClient?: number;
  /** 3g-3: the sold lead's name this workspace was auto-provisioned from. */
  provisionedFromClientName?: string;
  /** Owner request 2026-08-14 — what this client pays per month (USD, 0 until
   *  Phase 5 pricing). Owner-set in Admin; visible to the tenant in Settings. */
  monthlySubscriptionAmount?: number;
  /** Owner request 2026-08-14 — how this client's OWN business makes money
   *  ("sales" | "subscription"). Seeded by vertical; tenant-editable in
   *  Settings, owner-overridable in Admin. */
  revenueModel?: RevenueModel;
}
/** 3g-3: an owner notification that a sold lead got auto-provisioned. */
export interface ProvisionEvent {
  id: number;
  clientName: string;
  orgName: string;
  orgId: number;
  createdAt: string;
}

/** Shape of /api/auth/me, /api/auth/login, /api/admin/impersonate and
 *  /api/auth/impersonate-return responses (Phase 3d). `impersonating` is
 *  always present; `impersonatedFrom` (the admin user id) is set only while
 *  the current session is an owner impersonation. */
export interface MeResponse {
  user: User;
  impersonating: boolean;
  impersonatedFrom?: number;
}

/** Tenant created through the Admin "create client account" form. */
export interface CreatedOrg {
  id: number;
  name: string;
  createdAt: string;
}

export interface CreatedOrgUser {
  id: number;
  email: string;
  orgId: number;
  role: "admin" | "member";
}

/** Org settings (Phase 3a/3b): branding + per-tenant pipeline stages
 *  + per-tenant custom fields. */
export interface OrgSettings {
  orgName: string;
  accentColor: string;
  stages: string[];
  /** Client count per stage (all clients incl. archived) — used by Settings
   *  to warn before a stage with clients is removed. */
  stageCounts: Record<string, number>;
  /** The tenant's custom-field definitions (Phase 3b) — drive the client
   *  form fields and how values are rendered. */
  customFields: CustomFieldDef[];
  /** Adaptive intake Phase 1: account-level vertical config (set once per
   *  CRM account; drives which conditional intake fields the form shows). */
  serviceModel: "residential_only" | "commercial_only" | "both";
  deliveryType: "client_comes" | "we_go" | "both";
  /** '' means unspecified/other. */
  industry: "home_services" | "mobile_personal" | "professional" | "other" | "";
  /** Enabled optional (➖) intake groups: business_llc_tab, hoa_restrictions,
   *  pet_on_premises, parking_access. */
  intakeOpts: string[];
  /** Adaptive intake Phase 3: the tenant's custom conditional field groups
   *  (defined in Settings; rendered by the intake modal per their rules). */
  customIntakeGroups: CustomIntakeGroup[];
  /** Adaptive intake 3f-1: the org's business type (vertical template key;
   *  '' = no preset / General). */
  verticalKey: string;
  /** Owner request 2026-08-14 — how this org's OWN business makes money:
   *  "sales" | "subscription". Tenant-editable in Settings (owner override in
   *  Admin). */
  revenueModel: RevenueModel;
  /** Owner request 2026-08-14 — what this org pays the owner per month (USD,
   *  owner-set in Admin; the tenant can see it here but not change it). */
  monthlySubscriptionAmount: number;
}

/** Stored invoice status → badge tone. "Overdue" is not stored — it is
 *  computed client-side when status === "sent" and dueDate < today. */
export const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "gray",
  sent: "blue",
  paid: "green",
};

export const invoiceStatusLabel = (s: InvoiceStatus): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

export const money = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n ?? 0);

export const fmtDate = (iso: string): string => {
  try {
    return new Date(iso + (iso.includes("T") ? "" : "Z")).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};
