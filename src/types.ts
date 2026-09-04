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

/** Owner cockpit B (owner direction 2026-08-15; PR #53 widens to the full
 *  DocuSign lifecycle) — per-client DocuSign agreement status:
 *  "not_sent" → "sent" → "delivered" → "signed", with "declined" as a
 *  terminal failure state (the signer refused). The OWNER's Onboarding tab
 *  tracks where each client is in completing forms; real DocuSign envelope
 *  sending is wired LATER (once the owner connects a DocuSign account) —
 *  today the owner sets the status manually. OWNER-workspace-only: tenant
 *  orgs never receive this field (absent from their API responses). */
export type AgreementStatus = "not_sent" | "sent" | "delivered" | "signed" | "declined";

/** Owner direction 2026-08-18 — per-client payment-link status for the
 *  $200/month subscription: "none" (no link sent yet) → "sent" (link emailed —
 *  yellow, waiting on the client) → "paid" (payment received — green). The
 *  OWNER's clients table renders this as the Payment column (next to Next
 *  action), with live updates from the server after the payment-link send and
 *  the manual mark-paid action. OWNER-workspace-only: tenant orgs never
 *  receive the field (absent from their API responses). */
export type PaymentStatus = "none" | "sent" | "paid";

/** Owner 2026-08-27 — the client package tier (the owner's 4 redefined
 *  package tiers). '' = unset. The tier is OWNER-only data (never in tenant
 *  responses), stored on the client/lead AND reflected on the account (org),
 *  and it drives auto Services tags + the per-tier onboarding checklist + the
 *  future billing tier. Per-tier pricing is the owner's call at charge time —
 *  no hard-coded rates. */
export type PackageTier = "" | "tier1" | "tier2" | "tier3" | "tier4";

/** The four package tiers, in display order (owner 2026-08-27). */
export const PACKAGE_TIERS: PackageTier[] = ["tier1", "tier2", "tier3", "tier4"];

/** Human label per tier (used by the intake selector, the create-account
 *  package selector and the accounts chip). */
export const TIER_LABELS: Record<PackageTier, string> = {
  "": "",
  tier1: "Tier 1 — Website only",
  tier2: "Tier 2 — Website + CRM",
  tier3: "Tier 3 — Website + CRM + Lead gen",
  tier4: "Tier 4 — Custom package",
};

/** The short package-tier label (fits a chip on the accounts table). */
export const TIER_SHORT_LABELS: Record<PackageTier, string> = {
  "": "",
  tier1: "Tier 1 · Website",
  tier2: "Tier 2 · Website + CRM",
  tier3: "Tier 3 · Website + CRM + Lead gen",
  tier4: "Tier 4 · Custom",
};

/** Auto Services tags each tier drives (owner 2026-08-27). When a tier is set
 *  the server merges these tags into the client's services list. */
export const TIER_SERVICE_TAGS: Record<PackageTier, string[]> = {
  "": [],
  tier1: ["Website"],
  tier2: ["Website", "CRM"],
  tier3: ["Website", "CRM", "Lead gen"],
  tier4: ["Custom package"],
};

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
  /** Owner direction 2026-08-18 — payment-link status + the emailed link URL
   *  and paid-at timestamp. OWNER-workspace-only (tenant responses never
   *  carry the keys). Optional so tenant code never has to know about them. */
  paymentStatus?: PaymentStatus;
  paymentLinkUrl?: string;
  paidAt?: string;
  /** Phase 5 — the owner-entered amount (USD cents) the last Stripe payment
   *  link was sent for. OWNER-only, like paymentStatus. */
  paymentAmountCents?: number;
  /** Owner workflow views (2026-08-21) — whether a workspace has been
   *  provisioned for this sold client (0 = none yet; a positive org id means
   *  an account was built). OWNER-only (tenant responses never carry the key). */
  provisionedOrgId?: number;
  /** Owner 2026-08-20 sales rework — the demo-call outcome recorded on a lead
   *  after a demo: '' (no demo yet) | 'sold' | 'not_sold' | 'maybe'. 'sold' is
   *  a RECORDED state — it does NOT auto-create a client account (the owner
   *  creates one after sold + signed agreements + paid). OWNER-workspace-only;
   *  additive to `stage`, never a replacement. */
  demoOutcome?: "" | "sold" | "not_sold" | "maybe";
  /** The "YYYY-MM-DDTHH:MM" a demo call was scheduled for ('' = none); mirrors
   *  the appointments table. OWNER-workspace-only. */
  demoScheduledAt?: string;
  /** The Zoom/Google Meet URL the owner pasted when scheduling a demo ('' =
   *  none) — included plainly in the invite email. OWNER-workspace-only. */
  demoMeetingLink?: string;
  /** The owner's follow-up note captured with a 'maybe' demo outcome ('' =
   *  none) — surfaced in the edit modal on the owner Leads tab.
   *  OWNER-workspace-only. */
  followUpNote?: string;
  /** Owner 2026-08-20 — true when this record's `stage` is NOT in its org's
   *  current stage list, so the UI can surface it in an "out of pipeline"
   *  bucket rather than silently dropping it from every tab. OWNER-workspace-
   *  only. */
  orphanedStage?: boolean;
  /** Owner 2026-08-26 — true when this sold client's provisionedOrgId points
   *  to an org that no longer exists (a deleted account left the Sold record
   *  behind). OWNER-only; the Finance subscription-MRR computation skips these
   *  so an orphaned/dead record can never inflate MRR. */
  orphanedAccount?: boolean;
  /** Owner 2026-08-27 — INACTIVE CLIENTS window (backlog cb1c9700): true when
   *  the linked account (org) is marked INACTIVE (canceled, data retained) and
   *  sits in the Clients tab's "Inactive clients" window. OWNER-only, the SAME
   *  rule as orphanedAccount; the Finance active-client filters mirror this so
   *  an inactive account never counts as active. */
  canceledAccount?: boolean;
  /** Owner 2026-08-27 (Finance active-client fix, backlog 61e598ec) — true
   *  when this record sits in its org's TERMINAL ("Sold") pipeline stage, i.e.
   *  the lead flow is complete. Feeds the Finance cockpit's contracted
   *  active-client definition (terminal + agreement signed + payment received)
   *  and the paying-clients hub. OWNER-workspace-only: present on owner-org
   *  responses only; tenant orgs never receive the key. */
  soldStage?: boolean;
  /** Owner 2026-08-27 — this client/lead's package tier ('' unset | tier1..4),
   *  the owner's 4 package tiers. OWNER-workspace-only: present on owner-org
   *  responses only (tenant orgs never receive the key). Optional so the
   *  tenant-facing code never has to know about it. Drives auto Services tags
   *  + the per-tier onboarding checklist + the future billing tier. */
  tier?: PackageTier;
  /** Owner 2026-08-27 — this lead/client's IANA timezone (e.g.
   *  "America/New_York"). '' = unset (treated as the owner's Arizona/MST).
   *  Drives the calendar/appointments auto-conversion: the owner schedules in
   *  their fixed MST and the client's local time is shown converted across
   *  DST. OWNER-workspace-only, the same isolation rule as tier /
   *  agreementStatus: tenant orgs never receive the key. */
  timezone?: string;
  createdAt: string;
  updatedAt: string;
}

/** Owner 2026-08-20 sales rework — a demo-call appointment on the owner's
 *  calendar. `scheduledAt` is a local "YYYY-MM-DDTHH:MM" string; `status` ∈
 *  scheduled | confirmed | held | cancelled. */
export interface Appointment {
  id: number;
  orgId: number;
  clientId: number | null;
  clientName: string;
  title: string;
  scheduledAt: string;
  duration: number;
  status: "scheduled" | "confirmed" | "held" | "cancelled";
  notes: string;
  /** Owner 2026-08-27 — the linked client's IANA timezone ('' if unlinked or
   *  unset). Populated by the server so the calendar UI can show the client's
   *  local time alongside the owner's stored MST time. Owner-only concept; a
   *  tenant never receives another account's timezone. */
  clientTimezone?: string;
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

/* ── Support tickets (owner direction 2026-08-15) ───────────────────────
 * Clients submit tickets from their own workspace; the owner sees every
 * account's tickets and works them OPEN → IN_PROGRESS → RESOLVED → CLOSED.
 * Status is owner-moved (tenants only create + read); priority is chosen by
 * the submitter (LOW | NORMAL | HIGH, default NORMAL) and owner-adjustable. */
export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export interface Ticket {
  id: number;
  /** The submitting account's org id (always the caller's own org). */
  orgId: number;
  /** Submitting org's name — present ONLY in the owner's response (tenants
   *  never receive other orgs' names; their own rows carry no orgName key). */
  orgName?: string;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  /** Human-readable ticket number (owner direction 2026-08-25), e.g. TKT-1001 —
   *  stable, derived from id. Present for owner and tenant responses. */
  ticketNo: string;
  createdAt: string;
  updatedAt: string;
}

/** Stored ticket status → badge tone (the same palette the stage badges use). */
export const TICKET_STATUS_TONE: Record<TicketStatus, string> = {
  OPEN: "blue",
  IN_PROGRESS: "amber",
  RESOLVED: "green",
  CLOSED: "gray",
};

/** A support-ticket reply (owner direction, backlog 58435d2b). OWNER-only —
 *  the "agent draft-reply review queue": a reviewer drafts a reply that stays
 *  status="draft" (awaiting owner approval) and it is ONLY emailed to the
 *  submitting account after the owner confirms it ("sent"). Tenants never
 *  receive any reply — this type is only ever present in the owner's view. */
export interface TicketReply {
  id: number;
  ticketId: number;
  author: string;
  body: string;
  status: "draft" | "sent";
  sentAt: string;
  createdAt: string;
}
export const ticketReplyLabel = (s: "draft" | "sent"): string =>
  s === "draft" ? "Draft · awaiting approval" : "Sent";
/** Stored ticket priority → badge tone. HIGH is red so urgent tickets pop. */
export const TICKET_PRIORITY_TONE: Record<TicketPriority, string> = {
  LOW: "gray",
  NORMAL: "blue",
  HIGH: "red",
};

export const ticketStatusLabel = (s: TicketStatus): string =>
  s === "IN_PROGRESS" ? "In progress" : s.charAt(0) + s.slice(1).toLowerCase();

export const ticketPriorityLabel = (p: TicketPriority): string =>
  p.charAt(0) + p.slice(1).toLowerCase();

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
  /** Owner direction 2026-08-26 — the new "Lost" window: LOST (soft) clients
   *  in this org, restorable but excluded from every active pipeline KPI.
   *  Org-scoped (isolation) — a tenant only ever sees their own lost rows. */
  lostClients?: {
    id: number;
    companyName: string;
    contactName: string;
    email: string;
    dealValue: number;
    stage: string;
    lostReason: string;
    clientType: string;
  }[];
}

export interface User {
  id: number;
  email: string;
  /** Org the user belongs to — every row the API returns is scoped to this. */
  orgId: number;
  /** Phase 1: `admin` behaves like `member` inside their own org. */
  role: "admin" | "member";
  /** Team users (owner request 2026-08-14) — the session user's per-tab
   *  access grants (clients | tasks | finance | settings | support →
   *  {edit: bool}). Absent tab = no access; {edit:false} = view-only. Org
   *  admins (role='admin' and the account's original owner login) bypass
   *  permissions entirely and always receive {}. New key on /api/auth/me +
   *  login (additive — the UI ignores it until the team-users UI ships). */
  permissions?: TabPermissions;
  /** Team-users UI (owner request 2026-08-14) — effective org admin: stored
   *  role='admin' OR the org's original owner login (first user by MIN id).
   *  Additive key on /api/auth/me + login; drives the Settings "Team members"
   *  section and admin-bypass rendering. */
  isOrgAdmin?: boolean;
  /** Tenant display name (e.g. "Revzenta") — shown next to the email in the nav. */
  orgName?: string;
  /** Branding rename (2026-08-18) — true when this session is the platform
   *  OWNER (owner org AND role='admin', the server's isOwnerSession). Drives
   *  the owner cockpit (Admin/Onboarding/Documents tabs, MRR, provisioning)
   *  so the client never compares the org NAME string. Additive key on
   *  /api/auth/me + login. */
  isOwner?: boolean;
  /** Optional display name (additive, owner live-test 2026-08-28) — the nav
   *  prefers it over the raw email when present; not yet sent by the server,
   *  so owner sessions fall back to "Owner" and tenant users to their email. */
  name?: string;
  /** Wholesale Biz custom menu (owner 2026-09-04) — the session org's
   *  business type (orgs.vertical_key). Switches a client workspace to the
   *  wholesale tab set when it equals "wholesalebiz". Additive on
   *  /api/auth/me + login. */
  verticalKey?: string;
  /** The tenant's ordered pipeline stages (Phase 3a). */
  stages?: string[];
  /** The tenant's brand accent (hex). */
  accentColor?: string;
  /** Dashboard color picker (owner 2026-08-29): the account's dashboard
   *  numbers/text color (hex); unset/empty -> theme defaults. */
  dashboardColor?: string;
  created_at?: string;
}

/* ── Team users per client account (owner request 2026-08-14) ─────────────
 * The five tenant tabs a restricted member can be granted (the Dashboard is
 * always visible; tenants never see "Leads" — owner-only). Server-enforced:
 * reads of a tab the member lacks → 403; writes on a tab they have view-only
 * → 403. Org admins bypass everything. */
/** Wholesale Real Estate vertical (owner direction 2026-09-04) — one end
 *  buyer on the wholesale account's Buyers list. Org-scoped; tenant-only. */
export interface Buyer {
  id: number;
  name: string;
  phone: string;
  /** What they buy, e.g. "3BR/2BA under $150k, any city in Maricopa". */
  criteria: string;
  /** What they've bought (free text). */
  bought: string;
  createdAt: string;
  updatedAt: string;
}
export const TENANT_TABS = ["clients", "tasks", "finance", "settings", "support"] as const;
export type TenantTab = (typeof TENANT_TABS)[number];

export interface TabPermission {
  edit: boolean;
}
export type TabPermissions = Partial<Record<TenantTab, TabPermission>>;

/** One row of the org member list / management responses
 *  (GET /api/org/members, POST/PATCH responses). Never contains password
 *  material — hashes stay server-side. */
export interface OrgMember {
  id: number;
  email: string;
  role: "admin" | "member";
  permissions: TabPermissions;
  createdAt: string;
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
  /** Owner request 2026-08-25 — the day of the month this client account is
   *  billed ('' = not set). Owner-set inline on the Client accounts table;
   *  owner-only data (never in tenant responses). */
  billingCycleDate?: string;
  /** Phase 5 prep — account lifecycle: 'active' | 'canceled' ('' when the
   *  server predates the migration). A canceled account's users are blocked;
   *  the data stays retained until retentionUntil. */
  status?: string;
  canceledAt?: string;
  retentionUntil?: string;
  /** Owner 2026-08-27 — this client account's package tier ('' unset |
   *  tier1..4). Set by the Create-account package selector and carried from the
   *  linked sold lead on auto-provision; editable via the owner. Owner-only
   *  admin data (never in tenant responses). */
  tier?: PackageTier;
  /** Owner 2026-08-27 — the account's AUTO-SEEDED onboarding checklist
   *  progress (done/total item counts; 0/0 until a tier is set). The items
   *  themselves come from /api/admin/orgs/:id/onboarding. Owner-only admin
   *  data (never in tenant responses). */
  onboardingTotal?: number;
  onboardingDone?: number;
}

/** Owner 2026-08-27 — one item of a client account's auto-seeded onboarding
 *  checklist (the package-selector feature). Items are chosen by the account's
 *  package tier at creation and re-seeded when the tier changes. Owner-only
 *  admin data: tenants never see the checklist. */
export interface OnboardingItem {
  id: number;
  label: string;
  position: number;
  done: boolean;
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
  /** Dashboard color picker (owner 2026-08-29): '' = theme defaults. */
  dashboardColor: string;
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
  /** Appointments production (backlog 5a104eae): 1 = this account's clients
   *  may schedule appointments for themselves; 0 = view/reschedule only. */
  allowSelfSchedule: boolean;
  /** Native e-signature (owner direction 2026-08-15) — the OWNER org's
   *  editable agreement template. Absent from tenant settings responses. */
  agreementTemplate?: string;
  /** Owner-only: is the Agreements-editor PIN set? (never the hash) */
  agreementsPinSet?: boolean;
}
/** Native e-signature — one agreement envelope (audit record) per sent
 *  agreement, owner-workspace only. status flows sent → delivered →
 *  signed | declined; the audit fields are populated by the public sign page. */
export interface AgreementEnvelope {
  id: number;
  clientId: number;
  clientName: string;
  clientEmail: string;
  status: AgreementStatus;
  expiresAt: number;
  pdfId: string;
  signerName: string;
  signedAt: string | null;
  ipAddress: string;
  consent: boolean;
  createdAt: string;
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
