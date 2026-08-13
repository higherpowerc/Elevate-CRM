/** Default pipeline stages — the list every org starts with. The signed-in
 *  tenant's own list comes from the API (user.stages / /api/settings) and
 *  drives the stage dropdown, dashboard breakdown and client badges. */
export const DEFAULT_STAGES = [
  "Prospect",
  "Intake",
  "Kickoff",
  "Build",
  "Launch",
  "Retainer",
];
export type Stage = string;

/** Badge/visual tones are assigned by stage-list position (the list is
 *  tenant-defined, so names can't be mapped to tones anymore). */
export const STAGE_TONES = ["gray", "blue", "amber", "violet", "lime", "teal"] as const;
export const stageTone = (index: number): string =>
  STAGE_TONES[((index % STAGE_TONES.length) + STAGE_TONES.length) % STAGE_TONES.length];

/** The four custom-field value types a tenant can define (Phase 3b). */
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "checkbox"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** A tenant's custom-field definition (from /api/settings). */
export interface CustomFieldDef {
  name: string;
  type: CustomFieldType;
}

/** A client's stored custom-field value (name must match a tenant definition). */
export interface CustomField {
  name: string;
  value: string;
}

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

/** stageCounts keys are the tenant's own stage names (dynamic). */
export interface DashboardData {
  stageCounts: Record<string, number>;
  projectedPipeline: number;
  totalClients: number;
  archivedClients: number;
  recentClients: Client[];
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
