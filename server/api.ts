import {
  db,
  DEFAULT_STAGES,
  parseStages,
  parseCustomFields,
  parseIntakeOpts,
  parseCustomIntakeGroups,
  getOrg,
  getOwnerOrgId,
  isOwnerOrg,
  TENANT_TABS,
  isTenantTab,
  parsePermissions,
  type TenantTab,
  INVOICE_STATUSES,
  isInvoiceStatus,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  isTicketStatus,
  isTicketPriority,
  isCustomFieldType,
  isServiceModel,
  isDeliveryType,
  isIndustry,
  isIntakeOptGroup,
  isIntakeGroupAppliesTo,
  isIntakeGroupFieldKind,
  INTAKE_OPT_GROUPS,
  DEFAULT_ORG_NAME,
  ensureDefaultOrg,
  type ClientRow,
  type CustomField,
  type CustomFieldDef,
  type CustomFieldType,
  type CustomIntakeField,
  type CustomIntakeGroup,
  type IntakeGroupFieldKind,
  type Role,
  type Stage,
  type TaskRow,
  type InvoiceRow,
  type InvoiceStatus,
  type TicketRow,
  type TicketStatus,
  type TicketPriority,
  type TabPermissions,
} from "./db";
import {
  VERTICALS,
  VERTICAL_MAP,
  getVertical,
  templateFieldDefs,
  type StoredFieldDef,
  type VerticalTemplate,
} from "../src/verticals";
import {
  createSession,
  verifySession,
  verifySessionPayload,
  verifyPassword,
  getUserByEmail,
  getUserById,
  userCount,
  hashPassword,
  toUser,
} from "./auth";
import { sendIntakeEmail, sendWelcomeEmail, sendPasswordResetEmail, sendAgreementEmail, sendPaymentLinkEmail, appUrlFrom, RESEND_KEY_MISSING_ERROR, type SendEmailResult } from "./email";
import { stripeClient } from "./stripe";
import {
  AGREEMENT_TOKEN_TTL_MS,
  hashAgreementToken,
  getEnvelopeForClient,
  getEnvelopeByTokenHash,
  sendAgreement,
  resolveAgreement,
} from "./agreements";
import { randomBytes } from "node:crypto";

export const SESSION_COOKIE = "elevate_session";
/** Map a sendEmail result to the emailStatus vocabulary the UI renders:
 *  "sent" (delivered), "skipped" (RESEND_API_KEY unset — deliberate no-op),
 *  or "failed" (Resend/network rejected the send). */
export function emailStatusOf(r: SendEmailResult): "sent" | "failed" | "skipped" {
  if (r.ok) return "sent";
  return r.error === RESEND_KEY_MISSING_ERROR ? "skipped" : "failed";
}

type JsonValue = unknown;

function json(data: JsonValue, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return part.slice(idx + 1).trim();
  }
  return null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
/** Best-effort client IP for the e-signature audit trail: X-Forwarded-For
 *  first (the app runs behind Render's proxy in production), else the socket
 *  address via Bun's server.requestIP (the index.ts fetch handler passes the
 *  server through handleApi). Empty string when neither is available. */
function clientIp(req: Request, server?: { requestIP(req: Request): { address: string } | null } | null): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim() !== "") return xff.split(",")[0].trim();
  try {
    const ip = server?.requestIP(req);
    if (ip?.address) return ip.address;
  } catch {
    /* ignore */
  }
  return "";
}

/** Authenticated session context: who the user is AND which org they belong
 *  to. Every data route scopes its queries by orgId — the org always comes
 *  from the session, never from the request body. */
interface AuthContext {
  userId: number;
  orgId: number;
  role: Role;
}

/** Phase 5 prep — self-serve cancel: "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"
 *  for the user-facing retention date ('' → "the end of the 30-day retention
 *  period" as a defensive fallback). */
function retentionDateLabel(raw: string | null | undefined): string {
  const d = (raw ?? "").trim();
  return d.length >= 10 ? d.slice(0, 10) : "the end of the 30-day retention period";
}

/** Returns { userId, orgId, role } or a 401 Response. */
function requireAuth(req: Request): AuthContext | Response {
  const token = getCookie(req, SESSION_COOKIE);
  const userId = verifySession(token);
  if (!userId) return err("Not signed in.", 401);
  const user = getUserById(userId);
  if (!user) return err("Not signed in.", 401);
  // Phase 5 prep - self-serve cancel: a canceled org's users are blocked on
  // EVERY authed route (not just login), so an already-issued session dies the
  // moment the org is canceled. The message names the retention date so the
  // user knows their data is not gone, just inaccessible. The owner org can
  // never be canceled (the cancel route guards it), so this branch is
  // unreachable for the platform admin.
  const org = getOrg(user.orgId);
  if (org && org.status === "canceled") {
    return err(
      `This account has been canceled. Your data is retained until ${retentionDateLabel(org.retention_until)}. Contact support if this was a mistake.`,
      403,
    );
  }
  return { userId: user.id, orgId: user.orgId, role: user.role };
}

/** requireAuth + the user must be the platform OWNER — the Revzenta
 *  workspace org AND role='admin'. Tenant org admins (role='admin' users in
 *  client accounts, team-users feature) are NOT the owner: every /api/admin
 *  route and the tickets PATCH stay owner-only, exactly as before. */
function requireAdmin(req: Request): AuthContext | Response {
  const auth = requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin" || !isOwnerOrg(auth.orgId)) return err("Forbidden.", 403);
  return auth;
}

/** True when the session user is the platform owner's own session: the owner
 *  org AND role='admin'. During an owner impersonation the session is the
 *  tenant's user, so this is false — matching the pre-feature behavior where
 *  owner behavior (client MRR, agreement status, all-org tickets, owner KPI
 *  shapes) keyed off role='admin'. A tenant org admin (role='admin' in a
 *  client account) is also false — owner workspace only. */
function isOwnerSession(auth: AuthContext): boolean {
  return auth.role === "admin" && isOwnerOrg(auth.orgId);
}

/** True when the session user is an org admin of their OWN account: stored
 *  role='admin' (the owner, or an admin team member) OR the org's original
 *  owner login (its first user — every existing single-user account
 *  automatically treats its user as admin; no stored-role migration). Org
 *  admins bypass all tab permissions and manage the org's team members. */
function isOrgAdmin(auth: AuthContext): boolean {
  if (auth.role === "admin") return true;
  const first = db
    .query("SELECT MIN(id) AS id FROM users WHERE org_id = ?")
    .get(auth.orgId) as { id: number | null } | null;
  return first?.id === auth.userId;
}

/** Number of org admins in an account: stored role='admin' users, plus the
 *  org's original owner login once (it is a structural admin even when its
 *  stored role is 'member' — the "no migration" rule). Used by the
 *  last-admin protection on member demote/remove. */
function orgAdminCount(orgId: number): number {
  const stored = db
    .query("SELECT COUNT(*) AS c FROM users WHERE org_id = ? AND role = 'admin'")
    .get(orgId) as { c: number };
  const first = db
    .query("SELECT MIN(id) AS id, role FROM users WHERE org_id = ?")
    .get(orgId) as { id: number | null; role: Role | null } | null;
  let count = stored.c;
  if (first && first.id !== null && first.role !== "admin") count += 1;
  return count;
}

/** The session user's stored per-tab permissions (restricted members only —
 *  org admins bypass and never consult this). */
function orgPermissions(userId: number): TabPermissions {
  const row = db.query("SELECT permissions FROM users WHERE id = ?").get(userId) as
    | { permissions: string | null }
    | null;
  return parsePermissions(row?.permissions ?? null);
}

function canReadTab(auth: AuthContext, tab: TenantTab): boolean {
  if (isOrgAdmin(auth)) return true;
  return orgPermissions(auth.userId)[tab] !== undefined;
}
function canEditTab(auth: AuthContext, tab: TenantTab): boolean {
  if (isOrgAdmin(auth)) return true;
  return orgPermissions(auth.userId)[tab]?.edit === true;
}

/** Per-tab read/write gates — return a 403 Response when a RESTRICTED member
 *  lacks the tab (absent = no access) or has it view-only. Org admins and the
 *  owner always pass. Dashboard is deliberately NOT gated (always visible —
 *  it is the member's own org's money overview). */
function denyTabRead(auth: AuthContext, tab: TenantTab): Response | null {
  return canReadTab(auth, tab) ? null : err("Forbidden.", 403);
}
function denyTabWrite(auth: AuthContext, tab: TenantTab): Response | null {
  return canEditTab(auth, tab) ? null : err("Forbidden.", 403);
}

/** requireAuth + the user must be an org admin of their OWN account (owner or
 *  tenant org admin) — the gate for the /api/org/members management routes. */
function requireOrgAdmin(auth: AuthContext): Response | null {
  return isOrgAdmin(auth) ? null : err("Forbidden.", 403);
}

/**
 * Phase 3d — owner impersonation. If the current session is an impersonation,
 * returns the admin user id who started it — but only when that user still
 * exists and is still the platform owner (owner org + role admin). Any other
 * session returns null. The `imp` field lives inside the HMAC-signed session
 * payload, so a client can neither forge an impersonation nor attach one to a
 * normal session.
 */
function impersonationFrom(req: Request): number | null {
  const payload = verifySessionPayload(getCookie(req, SESSION_COOKIE));
  if (!payload || typeof payload.imp !== "number") return null;
  const admin = getUserById(payload.imp);
  if (!admin || admin.role !== "admin" || !isOwnerOrg(admin.orgId)) return null;
  return payload.imp;
}

/* ── Password reset (3k, owner request) ────────────────────────────────
 * Forgot-password flow: a single-use token (45-minute expiry) is emailed to
 * the user; the server stores ONLY a SHA-256 hash of it (never the raw
 * token). Redemption updates the bound user's password_hash — the token is
 * tied to a user_id and therefore to one org, so it can never change a
 * different tenant's password. As an extra multi-tenant guard, an
 * AUTHENTICATED user from a different org gets a 403 when trying to redeem
 * a token that belongs to another org (the normal emailed-link flow is
 * unauthenticated and uses the token itself as the credential). */

const RESET_TOKEN_TTL_MS = 45 * 60 * 1000; // 45 minutes
const RESET_TOKEN_BYTES = 32; // 64 hex chars of entropy

function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString("hex");
}

/** SHA-256 hash of a reset token — the only thing ever stored/logged. The
 *  "pwreset::" prefix keeps reset-token hashes distinct from any other use. */
function hashResetToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update("pwreset::" + token).digest("hex");
}

/** The generic forgot-password response — identical whether or not the email
 *  belongs to an account, so the endpoint never leaks which emails are
 *  registered. */
const FORGOT_OK = {
  ok: true,
  message: "If an account exists for that email, a reset link is on its way.",
};

/* ── Client row → API shape ─────────────────────────────────────────── */

/** Owner direction 2026-08-18 — payment-link status vocabulary for the
 *  $200/month subscription (owner-only, like agreementStatus):
 *  "none" (no link sent yet) | "sent" (link emailed — yellow) | "paid"
 *  (payment received — green). */
const PAYMENT_STATUSES = ["none", "sent", "paid"] as const;
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === "string" && (PAYMENT_STATUSES as readonly string[]).includes(v);
}


/** Owner cockpit B (owner direction 2026-08-15) — `ownerOrg` (the caller's
 *  role is admin) controls whether the DocuSign agreement status appears in
 *  the serialized client. Tenant orgs (role=member) get the exact same shape
 *  as before this change — no agreementStatus key, ever. */
function toClient(row: ClientRow, ownerOrg = false) {
  let services: string[] = [];
  try {
    const parsed = JSON.parse(row.services);
    if (Array.isArray(parsed)) services = parsed.filter((s) => typeof s === "string");
  } catch {
    /* keep empty */
  }
  let customFields: CustomField[] = [];
  try {
    const parsed = JSON.parse(row.custom_fields);
    if (Array.isArray(parsed)) {
      customFields = parsed
        .filter(
          (f) =>
            f !== null &&
            typeof f === "object" &&
            typeof ((f as Record<string, unknown>).name ?? (f as Record<string, unknown>).label) === "string",
        )
        .map((f) => {
          const obj = f as Record<string, unknown>;
          // Phase 3b stores {name, value}; pre-3b rows used {label, value}.
          const name = typeof obj.name === "string" ? obj.name : (obj.label as string);
          return {
            name,
            value: typeof obj.value === "string" ? obj.value : "",
          };
        });
    }
  } catch {
    /* keep empty */
  }
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    industry: row.industry,
    services,
    customFields,
    dealValue: row.deal_value,
    stage: row.stage,
    nextAction: row.next_action,
    notes: row.notes,
    archived: row.archived === 1,
    clientType: row.client_type,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    website: row.website,
    leadSource: row.lead_source,
    // Adaptive intake Phase 1: optional billing + intake fields.
    billingAddress: row.billing_address,
    billingCity: row.billing_city,
    billingState: row.billing_state,
    billingZip: row.billing_zip,
    billingSame: row.billing_same === 1,
    preferredContactMethod: row.preferred_contact_method,
    businessType: row.business_type,
    taxIdEin: row.tax_id_ein,
    apContact: row.ap_contact,
    poRequired: row.po_required === 1,
    unitsLocations: row.units_locations,
    propertyManagerName: row.property_manager_name,
    propertyManagerContact: row.property_manager_contact,
    hoaName: row.hoa_name,
    hoaContact: row.hoa_contact,
    accessInstructions: row.access_instructions,
    coiRequired: row.coi_required === 1,
    serviceContract: row.service_contract,
    dbaName: row.dba_name,
    einSsn: row.ein_ssn,
    homeownerRenter: row.homeowner_renter,
    hoaRestrictions: row.hoa_restrictions,
    parkingAccess: row.parking_access,
    petOnPremises: row.pet_on_premises === 1,
    preferredServiceLocation: row.preferred_service_location,
    // Owner request 2026-08-14 — lost + DNC pipeline-status flags.
    lost: row.lost === 1,
    lostReason: row.lost_reason,
    dnc: row.dnc === 1,
    dncReason: row.dnc_reason,
    dncDate: row.dnc_date,
    // Owner request 2026-08-14 — the record's monthly amount in the org's own
    // subscription book (used when the org's revenue_model = "subscription").
    monthlyAmount: row.monthly_amount ?? 0,
    // Owner cockpit B (owner direction 2026-08-15) — OWNER-only DocuSign
    // agreement status. Absent from tenant responses entirely.
    ...(ownerOrg
      ? {
          agreementStatus: isAgreementStatus(row.agreement_status) ? row.agreement_status : "not_sent",
          // Owner direction 2026-08-18 — payment-link status (none|sent|paid),
          // the emailed link URL and when the payment was received. OWNER-only,
          // the SAME rule as agreementStatus (comment above): tenant orgs never
          // get the keys, ever.
          paymentStatus: isPaymentStatus(row.payment_status) ? row.payment_status : "none",
          paymentLinkUrl: row.payment_link_url,
          paidAt: row.paid_at,
        }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Phase 3e: every client is Commercial or Residential — required on create
 *  and on edit. Existing records were backfilled to 'residential'. */
export const CLIENT_TYPES = ["commercial", "residential"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export function isClientType(v: unknown): v is ClientType {
  return typeof v === "string" && (CLIENT_TYPES as readonly string[]).includes(v);
}

/** Owner request 2026-08-14 — the org's revenue model: "sales" (invoices) or
 *  "subscription" (per-client monthly book). Drives which money figure the
 *  client dashboard shows. */
export const REVENUE_MODELS = ["sales", "subscription"] as const;
export type RevenueModel = (typeof REVENUE_MODELS)[number];

export function isRevenueModel(v: unknown): v is RevenueModel {
  return typeof v === "string" && (REVENUE_MODELS as readonly string[]).includes(v);
}

/** Owner cockpit B (owner direction 2026-08-15; PR #53 widens to the full
 *  DocuSign lifecycle) — per-client DocuSign agreement status:
 *  "not_sent" → "sent" → "delivered" → "signed", with "declined" as a
 *  terminal failure state (the signer refused). The owner tracks where each
 *  onboarding client is in completing forms MANUALLY today; real DocuSign
 *  envelope sending is wired LATER once the owner connects a DocuSign
 *  account. OWNER-workspace-only: the value is exposed to and writable by
 *  the owner org (role=admin) only — tenant orgs never receive it in API
 *  responses and never write it (their payloads are ignored). */
export const AGREEMENT_STATUSES = ["not_sent", "sent", "delivered", "signed", "declined"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export function isAgreementStatus(v: unknown): v is AgreementStatus {
  return typeof v === "string" && (AGREEMENT_STATUSES as readonly string[]).includes(v);
}

interface ClientInput {
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
  /** Adaptive intake Phase 1: optional billing/intake fields. Every key is
   *  OPTIONAL — on create, absent keys default ('' / 0); on update, absent
   *  keys leave the stored value untouched (only keys present in the body
   *  are persisted). */
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
  /** Owner request 2026-08-14 — lost + DNC flags. Every key is OPTIONAL:
   *  on create, absent keys default (false / ''); on update, absent keys
   *  leave the stored value untouched (only keys present in the body are
   *  persisted). */
  lost?: boolean;
  lostReason?: string;
  dnc?: boolean;
  dncReason?: string;
  dncDate?: string;
  /** Owner request 2026-08-14 — this record's monthly amount (USD) in the
   *  org's OWN subscription book (used when the org's revenue_model =
   *  "subscription"). Optional: on create absent keys default 0; on update
   *  absent keys leave the stored value untouched. */
  monthlyAmount?: number;
  /** Owner cockpit B (owner direction 2026-08-15) — DocuSign agreement
   *  status. OPTIONAL and OWNER-only: the server accepts it only from the
   *  owner org (role=admin); tenant payloads are ignored. On create, absent
   *  keys default to "not_sent"; on update, absent keys leave the stored
   *  value untouched (the same partial-update rule lost/DNC follow). */
  agreementStatus?: AgreementStatus;
}

/** Adaptive intake Phase 1: optional TEXT columns — client JSON key → DB
 *  column, with the same length caps the Phase 3e fields use. Absent from
 *  the body ⇒ not persisted (create defaults to '', update leaves intact). */
const INTAKE_TEXT_COLS: { key: string; col: string; max: number; label: string }[] = [
  { key: "billingAddress", col: "billing_address", max: 200, label: "Billing address" },
  { key: "billingCity", col: "billing_city", max: 100, label: "Billing city" },
  { key: "billingState", col: "billing_state", max: 50, label: "Billing state" },
  { key: "billingZip", col: "billing_zip", max: 20, label: "Billing ZIP / postal code" },
  { key: "preferredContactMethod", col: "preferred_contact_method", max: 100, label: "Preferred contact method" },
  { key: "businessType", col: "business_type", max: 120, label: "Business type" },
  { key: "taxIdEin", col: "tax_id_ein", max: 50, label: "Tax ID / EIN" },
  { key: "apContact", col: "ap_contact", max: 200, label: "Accounts payable contact" },
  { key: "unitsLocations", col: "units_locations", max: 200, label: "Units / locations" },
  { key: "propertyManagerName", col: "property_manager_name", max: 200, label: "Property manager name" },
  { key: "propertyManagerContact", col: "property_manager_contact", max: 200, label: "Property manager contact" },
  { key: "hoaName", col: "hoa_name", max: 200, label: "HOA name" },
  { key: "hoaContact", col: "hoa_contact", max: 200, label: "HOA contact" },
  { key: "accessInstructions", col: "access_instructions", max: 2000, label: "Access instructions" },
  { key: "serviceContract", col: "service_contract", max: 2000, label: "Service contract" },
  { key: "dbaName", col: "dba_name", max: 200, label: "Business / DBA name" },
  { key: "einSsn", col: "ein_ssn", max: 50, label: "EIN or SSN" },
  { key: "homeownerRenter", col: "homeowner_renter", max: 50, label: "Homeowner / renter" },
  { key: "hoaRestrictions", col: "hoa_restrictions", max: 2000, label: "HOA restrictions" },
  { key: "parkingAccess", col: "parking_access", max: 2000, label: "Parking / access" },
  { key: "preferredServiceLocation", col: "preferred_service_location", max: 200, label: "Preferred service location" },
];

/** Owner request 2026-08-14 — lost + DNC flags. Column list for client
 *  create (absent keys default to false / ''), mirroring INTAKE_COLS. */
const STATUS_COLS: string[] = ["lost", "lost_reason", "dnc", "dnc_reason", "dnc_date"];

/** The lost/DNC values from a parsed ClientInput, in STATUS_COLS order. */
function statusValues(c: ClientInput): (string | number)[] {
  const rec = c as unknown as Record<string, unknown>;
  return [
    rec.lost === true ? 1 : 0,
    typeof rec.lostReason === "string" ? rec.lostReason : "",
    rec.dnc === true ? 1 : 0,
    typeof rec.dncReason === "string" ? rec.dncReason : "",
    typeof rec.dncDate === "string" ? rec.dncDate : "",
  ];
}

/** Adaptive intake Phase 1: optional yes/no columns (stored as 0/1). */
const INTAKE_BOOL_COLS: { key: string; col: string; label: string }[] = [
  { key: "billingSame", col: "billing_same", label: "Billing same as service" },
  { key: "poRequired", col: "po_required", label: "PO required" },
  { key: "coiRequired", col: "coi_required", label: "Certificate of insurance required" },
  { key: "petOnPremises", col: "pet_on_premises", label: "Pet on premises" },
];

/** All adaptive-intake columns + their values from a parsed ClientInput.
 *  Used by client create: absent keys default to '' / 0. (Client update
 *  filters to keys actually present in the body so nothing gets clobbered.) */
function intakeColumns(c: ClientInput): { cols: string[]; values: (string | number)[] } {
  const cols: string[] = [];
  const values: (string | number)[] = [];
  const rec = c as unknown as Record<string, unknown>;
  for (const f of INTAKE_TEXT_COLS) {
    const v = rec[f.key];
    cols.push(f.col);
    values.push(typeof v === "string" ? v : "");
  }
  for (const f of INTAKE_BOOL_COLS) {
    const v = rec[f.key];
    cols.push(f.col);
    values.push(v === true ? 1 : 0);
  }
  return { cols, values };
}

/** The same column list, in the same order — shared by create and update so
 *  the column/value lists can never drift apart. */
const INTAKE_COLS: string[] = [
  ...INTAKE_TEXT_COLS.map((f) => f.col),
  ...INTAKE_BOOL_COLS.map((f) => f.col),
];

/**
 * Validates the client payload. `stages` is the caller's OWN org stage list
 * (looked up from the session org) — a client's stage must be one of the
 * tenant's current pipeline stages. `defs` is the tenant's OWN custom-field
 * definition list (Phase 3b) — a client's customFields values must reference
 * exactly those field names, and each value must match its field's type.
 * `intakeGroups` is the tenant's OWN custom intake groups (Phase 3) — their
 * field KEYS extend the customFields allowlist (only groups that are enabled
 * AND apply to the client type being written), and yes/no fields normalize
 * their value to "1"/"0".
 */
function validateClient(
  body: Record<string, unknown>,
  stages: string[],
  defs: CustomFieldDef[],
  intakeGroups: CustomIntakeGroup[] = [],
  /** Owner cockpit B — true when the caller is the OWNER org (role=admin):
   *  only then is body.agreementStatus accepted (validated + persisted).
   *  Tenant payloads ignore the key entirely. */
  ownerOrg = false,
): { ok: true; value: ClientInput } | { ok: false; error: string } {
  const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const companyName = str(body.companyName, 200);
  if (!companyName) return { ok: false, error: "Company name is required." };

  // Phase 3e: client type is REQUIRED on create AND edit — exactly one of
  // "commercial" / "residential" (the migration backfilled old rows).
  if (!isClientType(body.clientType)) {
    return { ok: false, error: "Client type is required — choose commercial or residential." };
  }
  const clientType = body.clientType;

  // Phase 3e: bounded text fields. All optional, but provided values must
  // respect their length caps (rejected, not silently truncated).
  const bounded = (
    v: unknown,
    max: number,
    label: string,
  ): { ok: true; value: string } | { ok: false; error: string } => {
    if (v === undefined || v === null) return { ok: true, value: "" };
    if (typeof v !== "string") return { ok: false, error: `${label} must be text.` };
    const t = v.trim();
    if (t.length > max) return { ok: false, error: `${label} must be under ${max + 1} characters.` };
    return { ok: true, value: t };
  };
  const address = bounded(body.address, 200, "Address");
  if (!address.ok) return address;
  const city = bounded(body.city, 100, "City");
  if (!city.ok) return city;
  const state = bounded(body.state, 50, "State");
  if (!state.ok) return state;
  const zip = bounded(body.zip, 20, "ZIP / postal code");
  if (!zip.ok) return zip;
  const leadSource = bounded(body.leadSource, 100, "Lead source");
  if (!leadSource.ok) return leadSource;
  const website = bounded(body.website, 200, "Website");
  if (!website.ok) return website;
  // Loose URL check: a bare domain ("acme.com") or a full URL is fine, with
  // optional scheme and optional path — just not random text.
  const LOOSE_URL_RE = /^(https?:\/\/)?([\w-]+\.)+[a-zA-Z]{2,}([/?#][^\s]*)?$/;
  if (website.value && !LOOSE_URL_RE.test(website.value)) {
    return { ok: false, error: "Website must be a valid URL like https://acme.com." };
  }

  let services: string[] = [];
  if (body.services !== undefined) {
    if (!Array.isArray(body.services)) return { ok: false, error: "Services must be a list." };
    if (body.services.length > 50) return { ok: false, error: "Too many services (max 50)." };
    const seen = new Set<string>();
    for (const s of body.services) {
      if (typeof s !== "string") return { ok: false, error: "Each service must be text." };
      const t = s.trim().slice(0, 100);
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        services.push(t);
      }
    }
  }

  // Phase 3b custom fields: [{name, value}], every name must be one of the
  // tenant's defined fields (case-insensitive), values validated per type.
  // All fields are optional — omitted fields simply store no value.
  // Phase 3 (custom intake groups): the field keys of the tenant's ENABLED
  // custom intake groups (that apply to this client type) extend the allowlist
  // — values for those keys live in the SAME custom_fields array.
  const defByName = new Map<string, CustomFieldDef>();
  for (const d of defs) defByName.set(d.name.toLowerCase(), d);

  // key (lowercased) → {kind, appliesTo, enabled} for every intake-group field.
  const intakeKeyInfo = new Map<string, { kind: IntakeGroupFieldKind; appliesTo: string; enabled: boolean }>();
  for (const g of intakeGroups) {
    for (const f of g.fields) {
      intakeKeyInfo.set(f.key.toLowerCase(), { kind: f.kind, appliesTo: g.appliesTo, enabled: g.enabled });
    }
  }

  const intakeGroupValue = (
    key: string,
    kind: IntakeGroupFieldKind,
    raw: unknown,
  ): { ok: true; value: string } | { ok: false; error: string } => {
    if (kind === "yesno") {
      if (raw === true || raw === 1 || raw === "1") return { ok: true, value: "1" };
      if (raw === false || raw === 0 || raw === "0") return { ok: true, value: "0" };
      return { ok: false, error: `"${key}" must be yes or no.` };
    }
    if (raw === undefined || raw === null || raw === "") return { ok: true, value: "" };
    if (typeof raw !== "string" && typeof raw !== "number") {
      return { ok: false, error: `"${key}" must be text.` };
    }
    const t = String(raw).trim();
    if (t.length > 500) return { ok: false, error: `"${key}" must be under 500 characters.` };
    return { ok: true, value: t };
  };

  let customFields: CustomField[] = [];
  if (body.customFields !== undefined) {
    if (!Array.isArray(body.customFields)) return { ok: false, error: "Custom fields must be a list." };
    if (body.customFields.length > 250) {
      return { ok: false, error: "Too many custom field values (max 250)." };
    }
    const seen = new Set<string>();
    for (const f of body.customFields) {
      if (f === null || typeof f !== "object" || Array.isArray(f)) {
        return { ok: false, error: "Each custom field must be an object with a name and a value." };
      }
      const obj = f as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      if (!name) return { ok: false, error: "Custom field name is required." };
      if (seen.has(name.toLowerCase())) return { ok: false, error: `Duplicate custom field: ${name}.` };
      seen.add(name.toLowerCase());

      const raw = obj.value;
      const def = defByName.get(name.toLowerCase());
      if (def) {
        let value = "";
        if (def.type === "checkbox") {
          if (raw === true) value = "1";
          else if (raw === false) value = "0";
          else if (raw === 1 || raw === "1") value = "1";
          else if (raw === 0 || raw === "0") value = "0";
          else return { ok: false, error: `${def.name} must be a checkbox value (yes/no).` };
        } else {
          if (raw !== undefined && raw !== null && raw !== "") {
            if (typeof raw !== "string" && typeof raw !== "number") {
              return { ok: false, error: `${def.name} must be text.` };
            }
            value = String(raw).trim();
            if (def.type === "number") {
              if (value === "" || !Number.isFinite(Number(value))) {
                return { ok: false, error: `${def.name} must be a number.` };
              }
            } else if (def.type === "date") {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) {
                return { ok: false, error: `${def.name} must be a date like 2026-08-01.` };
              }
            } else if (value.length > 500) {
              return { ok: false, error: `${def.name} must be under 500 characters.` };
            }
          }
        }
        customFields.push({ name: def.name, value });
        continue;
      }

      // Not a tenant custom field — maybe a custom intake group key?
      const info = intakeKeyInfo.get(name.toLowerCase());
      if (info) {
        if (!info.enabled) {
          return {
            ok: false,
            error: `"${name}" belongs to a disabled intake group — enable it in Settings first.`,
          };
        }
        // Group appliesTo uses the UI-level type ("individual" == stored
        // "residential"); map before comparing so the gate matches the modal.
        const intakeType = clientType === "commercial" ? "commercial" : "individual";
        if (info.appliesTo !== "both" && info.appliesTo !== intakeType) {
          return {
            ok: false,
            error: `"${name}" is not available for ${
              intakeType === "commercial" ? "Commercial" : "Individual"
            } clients (its group applies to ${info.appliesTo === "commercial" ? "Commercial" : "Individual"}).`,
          };
        }
        const v = intakeGroupValue(name, info.kind, raw);
        if (!v.ok) return v;
        customFields.push({ name, value: v.value });
        continue;
      }

      return { ok: false, error: `Unknown custom field: ${name}.` };
    }
  }

  let dealValue = 0;
  if (body.dealValue !== undefined && body.dealValue !== null && body.dealValue !== "") {
    dealValue = Number(body.dealValue);
    if (!Number.isFinite(dealValue) || dealValue < 0) return { ok: false, error: "Deal value must be a non-negative number." };
  }
  // Owner request 2026-08-14 — the record's monthly amount in the org's own
  // subscription book. OPTIONAL: on create, absent keys default 0; on update,
  // only keys present in the body are persisted (same partial-update rule as
  // the intake fields). Validated numeric and non-negative like dealValue.
  let monthlyAmount: number | undefined;
  if (body.monthlyAmount !== undefined && body.monthlyAmount !== null && body.monthlyAmount !== "") {
    const m = Number(body.monthlyAmount);
    if (!Number.isFinite(m) || m < 0) return { ok: false, error: "Monthly amount must be a non-negative number." };
    monthlyAmount = m;
  }

  let stage: Stage = stages[0] ?? "Prospect";
  if (body.stage !== undefined && body.stage !== null && body.stage !== "") {
    const s = typeof body.stage === "string" ? body.stage.trim() : "";
    if (!s || !stages.includes(s)) {
      return { ok: false, error: `Stage must be one of: ${stages.join(", ")}.` };
    }
    stage = s;
  }

  // Adaptive intake Phase 1: optional intake/billing fields. Absent keys stay
  // undefined — create defaults them, update leaves them untouched. Text
  // fields are trimmed + length-capped; yes/no fields accept true/false or
  // 0/1 ("0"/"1" tolerated, like the custom-field checkbox handling).
  const intakeText: Record<string, string> = {};
  for (const f of INTAKE_TEXT_COLS) {
    const raw = body[f.key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") return { ok: false, error: `${f.label} must be text.` };
    const t = raw.trim();
    if (t.length > f.max) {
      return { ok: false, error: `${f.label} must be under ${f.max + 1} characters.` };
    }
    intakeText[f.key] = t;
  }
  const intakeBool: Record<string, boolean> = {};
  for (const f of INTAKE_BOOL_COLS) {
    const raw = body[f.key];
    if (raw === undefined || raw === null) continue;
    if (raw === true || raw === 1 || raw === "1") intakeBool[f.key] = true;
    else if (raw === false || raw === 0 || raw === "0") intakeBool[f.key] = false;
    else return { ok: false, error: `${f.label} must be yes or no.` };
  }

  // Owner request 2026-08-14 — lost + DNC flags. All OPTIONAL: on create,
  // absent keys default to false / ''; on update, only keys present in the
  // body are persisted (absent keys leave the stored value untouched, the
  // same partial-update rule the intake fields follow). Clearing a flag also
  // clears its reason/date so the record never keeps stale metadata.
  const statusText = (v: unknown, label: string, max = 300): { ok: true; value: string } | { ok: false; error: string } => {
    if (v === undefined || v === null) return { ok: true, value: "" };
    if (typeof v !== "string") return { ok: false, error: `${label} must be text.` };
    const t = v.trim();
    if (t.length > max) return { ok: false, error: `${label} must be under ${max + 1} characters.` };
    return { ok: true, value: t };
  };
  let statusLost: boolean | undefined;
  if (body.lost !== undefined && body.lost !== null) {
    if (typeof body.lost !== "boolean") return { ok: false, error: "lost must be a boolean." };
    statusLost = body.lost;
  }
  let statusLostReason: string | undefined;
  if (body.lostReason !== undefined && body.lostReason !== null) {
    const r = statusText(body.lostReason, "Lost reason");
    if (!r.ok) return r;
    statusLostReason = r.value;
  }
  let statusDnc: boolean | undefined;
  if (body.dnc !== undefined && body.dnc !== null) {
    if (typeof body.dnc !== "boolean") return { ok: false, error: "dnc must be a boolean." };
    statusDnc = body.dnc;
  }
  let statusDncReason: string | undefined;
  if (body.dncReason !== undefined && body.dncReason !== null) {
    const r = statusText(body.dncReason, "DNC reason");
    if (!r.ok) return r;
    statusDncReason = r.value;
  }
  let statusDncDate: string | undefined;
  if (body.dncDate !== undefined && body.dncDate !== null) {
    const r = statusText(body.dncDate, "DNC date", 20);
    if (!r.ok) return r;
    if (r.value && !/^\d{4}-\d{2}-\d{2}$/.test(r.value)) {
      return { ok: false, error: "DNC date must be a date like 2026-08-01." };
    }
    statusDncDate = r.value;
  }

  // Owner cockpit B — agreement status. Accepted (and validated against the
  // three allowed values) ONLY from the owner org; tenant payloads are
  // ignored so a tenant can never write it. Absent → not persisted (create
  // defaults to "not_sent", update leaves the stored value untouched).
  let agreementStatus: AgreementStatus | undefined;
  if (ownerOrg && body.agreementStatus !== undefined && body.agreementStatus !== null) {
    if (typeof body.agreementStatus !== "string" || !isAgreementStatus(body.agreementStatus.trim())) {
      return { ok: false, error: "Agreement status must be not_sent, sent, delivered, signed, or declined." };
    }
    agreementStatus = body.agreementStatus.trim() as AgreementStatus;
  }

  const value: ClientInput = {
    companyName,
    contactName: str(body.contactName, 200),
    email: str(body.email, 254),
    phone: str(body.phone, 60),
    industry: str(body.industry, 120),
    services,
    customFields,
    dealValue,
    stage,
    nextAction: str(body.nextAction, 500),
    notes: str(body.notes, 10000),
    archived: body.archived === true,
    clientType,
    ...(monthlyAmount !== undefined ? { monthlyAmount } : {}),
    address: address.value,
    city: city.value,
    state: state.value,
    zip: zip.value,
    website: website.value,
    leadSource: leadSource.value,
  };
  for (const f of INTAKE_TEXT_COLS) {
    const v = intakeText[f.key];
    if (v !== undefined) (value as unknown as Record<string, unknown>)[f.key] = v;
  }
  for (const f of INTAKE_BOOL_COLS) {
    const v = intakeBool[f.key];
    if (v !== undefined) (value as unknown as Record<string, unknown>)[f.key] = v;
  }
  // Lost/DNC: only keys present in the body are persisted (create defaults
  // them, update leaves absent ones untouched). Clearing the flag clears the
  // accompanying reason/date — a restored lead is clean again.
  if (statusLost !== undefined) {
    (value as unknown as Record<string, unknown>).lost = statusLost;
    (value as unknown as Record<string, unknown>).lostReason = statusLost ? (statusLostReason ?? "") : "";
  } else if (statusLostReason !== undefined) {
    (value as unknown as Record<string, unknown>).lostReason = statusLostReason;
  }
  if (statusDnc !== undefined) {
    (value as unknown as Record<string, unknown>).dnc = statusDnc;
    if (statusDnc) {
      (value as unknown as Record<string, unknown>).dncReason = statusDncReason ?? "";
      (value as unknown as Record<string, unknown>).dncDate = statusDncDate ?? "";
    } else {
      (value as unknown as Record<string, unknown>).dncReason = "";
      (value as unknown as Record<string, unknown>).dncDate = "";
    }
  } else {
    if (statusDncReason !== undefined) {
      (value as unknown as Record<string, unknown>).dncReason = statusDncReason;
    }
    if (statusDncDate !== undefined) {
      (value as unknown as Record<string, unknown>).dncDate = statusDncDate;
    }
  }
  // Owner cockpit B — only present when the owner sent it (partial-update
  // rule: create defaults it, update leaves an absent value untouched).
  if (agreementStatus !== undefined) {
    (value as unknown as Record<string, unknown>).agreementStatus = agreementStatus;
  }
  return { ok: true, value };
}

/* ── Task row → API shape ──────────────────────────────── */

/** Row shape for task queries: tasks row joined with the client name. */
type TaskRowJoined = TaskRow & { client_name: string | null };

function toTask(row: TaskRowJoined) {
  return {
    id: row.id,
    title: row.title,
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? "",
    dueDate: row.due_date,
    done: row.done === 1,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT = `
  SELECT t.*, c.company_name AS client_name
  FROM tasks t
  LEFT JOIN clients c ON c.id = t.client_id
`;

function fetchTask(id: number, orgId: number) {
  const row = db
    .query(`${TASK_SELECT} WHERE t.id = ? AND t.org_id = ?`)
    .get(id, orgId) as TaskRowJoined | null;
  return row ? toTask(row) : null;
}

interface TaskInput {
  title: string;
  clientId: number | null;
  dueDate: string;
  done: boolean;
  notes: string;
}

/**
 * Validates the writable task fields. Every field is optional (partial
 * updates); create routes additionally require `title`.
 */
function parseTaskFields(
  body: Record<string, unknown>,
): { ok: true; value: Partial<TaskInput> } | { ok: false; error: string } {
  const out: Partial<TaskInput> = {};

  if (body.title !== undefined) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) return { ok: false, error: "Title is required." };
    if (t.length > 200) return { ok: false, error: "Title must be under 200 characters." };
    out.title = t;
  }

  if (body.clientId !== undefined && body.clientId !== null && body.clientId !== "") {
    const id = Number(body.clientId);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Client id must be a positive integer." };
    out.clientId = id;
  } else if (body.clientId !== undefined) {
    out.clientId = null; // explicitly unlinked
  }

  if (body.dueDate !== undefined) {
    const d = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    if (d.length > 20) return { ok: false, error: "Due date must be under 20 characters." };
    out.dueDate = d;
  }

  if (body.done !== undefined) {
    if (typeof body.done !== "boolean") return { ok: false, error: "done must be a boolean." };
    out.done = body.done;
  }

  if (body.notes !== undefined) {
    const n = typeof body.notes === "string" ? body.notes : "";
    if (n.length > 2000) return { ok: false, error: "Notes must be under 2000 characters." };
    out.notes = n;
  }

  return { ok: true, value: out };
}

/** 400 unless a (non-null) client id refers to a real client IN THE SAME ORG. */
function ensureClientExists(clientId: number, orgId: number): Response | null {
  const exists = db.query("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(clientId, orgId);
  if (!exists) return err("Client not found.", 400);
  return null;
}

/* ── Invoice row → API shape ─────────────────────────── */

/** Row shape for invoice queries: invoices row joined with the client name. */
type InvoiceRowJoined = InvoiceRow & { client_name: string | null };

function toInvoice(row: InvoiceRowJoined) {
  return {
    id: row.id,
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? "",
    amount: row.amount,
    status: row.status,
    dueDate: row.due_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const INVOICE_SELECT = `
  SELECT i.*, c.company_name AS client_name
  FROM invoices i
  LEFT JOIN clients c ON c.id = i.client_id
`;

function fetchInvoice(id: number, orgId: number) {
  const row = db
    .query(`${INVOICE_SELECT} WHERE i.id = ? AND i.org_id = ?`)
    .get(id, orgId) as InvoiceRowJoined | null;
  return row ? toInvoice(row) : null;
}

interface InvoiceInput {
  clientId: number | null;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
  notes: string;
}

/**
 * Validates the writable invoice fields. Every field is optional (partial
 * updates); create routes additionally require `amount` (a real invoice is
 * always worth more than zero).
 */
function parseInvoiceFields(
  body: Record<string, unknown>,
): { ok: true; value: Partial<InvoiceInput> } | { ok: false; error: string } {
  const out: Partial<InvoiceInput> = {};

  if (body.clientId !== undefined && body.clientId !== null && body.clientId !== "") {
    const id = Number(body.clientId);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Client id must be a positive integer." };
    out.clientId = id;
  } else if (body.clientId !== undefined) {
    out.clientId = null; // explicitly unlinked
  }

  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const a = Number(body.amount);
    if (!Number.isFinite(a) || a <= 0) return { ok: false, error: "Amount must be a positive number." };
    out.amount = a;
  } else if (body.amount !== undefined) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!isInvoiceStatus(body.status)) {
      return { ok: false, error: `Status must be one of: ${INVOICE_STATUSES.join(", ")}.` };
    }
    out.status = body.status;
  }

  if (body.dueDate !== undefined) {
    const d = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    if (d.length > 20) return { ok: false, error: "Due date must be under 20 characters." };
    out.dueDate = d;
  }

  if (body.notes !== undefined) {
    const n = typeof body.notes === "string" ? body.notes : "";
    if (n.length > 2000) return { ok: false, error: "Notes must be under 2000 characters." };
    out.notes = n;
  }

  return { ok: true, value: out };
}

/* ── Ticket row → API shape (owner direction 2026-08-15) ────── */

/** Row shape for ticket queries: tickets row joined with the submitting
 *  org's name (OWNER-only field — tenants get their own rows without it,
 *  exactly like agreementStatus on clients). */
type TicketRowJoined = TicketRow & { org_name: string | null };

function toTicket(row: TicketRowJoined, ownerOrg = false) {
  return {
    id: row.id,
    orgId: row.org_id,
    ...(ownerOrg ? { orgName: row.org_name ?? "" } : {}),
    subject: row.subject,
    message: row.message,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TICKET_SELECT = `
  SELECT t.*, o.name AS org_name
  FROM tickets t
  LEFT JOIN orgs o ON o.id = t.org_id
`;

function fetchTicket(id: number, orgId: number) {
  const row = db
    .query(`${TICKET_SELECT} WHERE t.id = ? AND t.org_id = ?`)
    .get(id, orgId) as TicketRowJoined | null;
  return row ? toTicket(row) : null;
}

interface TicketInput {
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
}

/**
 * Validates the writable ticket fields. Every field is optional (partial
 * updates); the create routes additionally require subject + message.
 * Status and priority are validated against their closed unions — the same
 * defensive pattern the invoice status uses.
 */
function parseTicketFields(
  body: Record<string, unknown>,
): { ok: true; value: Partial<TicketInput> } | { ok: false; error: string } {
  const out: Partial<TicketInput> = {};

  if (body.subject !== undefined) {
    const t = typeof body.subject === "string" ? body.subject.trim() : "";
    if (!t) return { ok: false, error: "Subject is required." };
    if (t.length > 200) return { ok: false, error: "Subject must be under 200 characters." };
    out.subject = t;
  }

  if (body.message !== undefined) {
    const m = typeof body.message === "string" ? body.message.trim() : "";
    if (!m) return { ok: false, error: "Message is required." };
    if (m.length > 10000) return { ok: false, error: "Message must be under 10000 characters." };
    out.message = m;
  }

  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!isTicketStatus(body.status)) {
      return { ok: false, error: `Status must be one of: ${TICKET_STATUSES.join(", ")}.` };
    }
    out.status = body.status;
  }

  if (body.priority !== undefined && body.priority !== null && body.priority !== "") {
    if (!isTicketPriority(body.priority)) {
      return { ok: false, error: `Priority must be one of: ${TICKET_PRIORITIES.join(", ")}.` };
    }
    out.priority = body.priority;
  }

  return { ok: true, value: out };
}

/* ── Team users per client account (owner request 2026-08-14) ────────────
 * A client account (tenant org) has an org admin — the account's original
 * owner login (every existing single-user account automatically treats its
 * user as admin) plus any role='admin' team member — and can add/remove TEAM
 * MEMBERS. Restricted members get PER-TAB access stored on users.permissions
 * (JSON keyed by tenant tab → {edit: bool}); absent tab = no access. The
 * routes live under /api/org/members and are ALWAYS scoped to the session
 * org — there is no cross-org addressing (a body orgId is ignored), so an
 * admin can never list or alter another account's members. */

/** Row shape for the member list/management responses. NEVER includes any
 *  password material — only the org-scoped identity + role + permissions. */
interface OrgMemberRow {
  id: number;
  email: string;
  role: Role;
  permissions: string;
  created_at: string;
}

/** Member row → API shape: stored role + parsed per-tab permissions + created
 *  date. Password hashes never leave the server. */
function toOrgMember(row: OrgMemberRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    permissions: parsePermissions(row.permissions),
    createdAt: row.created_at,
  };
}

const MEMBER_SELECT = "id, email, role, permissions, created_at FROM users";

/** Validates a proposed permissions object: keys must be exactly the known
 *  tenant tabs (clients | tasks | finance | settings | support), each value an
 *  object with a boolean edit flag. A tab ABSENT from the object means the
 *  member has no access to that tab (the PATCH replaces the whole grant). */
function validatePermissions(
  v: unknown,
): { ok: true; value: TabPermissions } | { ok: false; error: string } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, error: "Permissions must be an object keyed by tab." };
  }
  const obj = v as Record<string, unknown>;
  const out: TabPermissions = {};
  for (const key of Object.keys(obj)) {
    if (!isTenantTab(key)) {
      return { ok: false, error: `Unknown tab: ${key} — allowed: ${TENANT_TABS.join(", ")}.` };
    }
    const p = obj[key];
    if (p === null || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, error: `"${key}" permissions must be an object with an edit flag.` };
    }
    const edit = (p as Record<string, unknown>).edit;
    if (typeof edit !== "boolean") {
      return { ok: false, error: `"${key}" must include edit: true or false.` };
    }
    out[key as TenantTab] = { edit };
  }
  return { ok: true, value: out };
}

/* ── Admin (owner-only) org provisioning ───────────────────── */

interface OrgRow {
  id: number;
  name: string;
  created_at: string;
  user_count: number;
  client_count: number;
  /** 3g-3: first member's login email ('' when the org has no users). */
  login_email: string;
  /** 3g-3: owner-org client id this org was auto-provisioned from (0 = manual). */
  provisioned_from_client: number;
  /** 3g-3: plaintext temp password while undelivered ('' once the member
   *  logs in) — owner-only, never exposed via tenant-scoped endpoints. */
  provisioned_temp_password: string;
  /** 3k: plaintext temp password from the Admin tab's per-tenant "Reset
   *  password" action ('' once the member logs in) — owner-only, same
   *  delivery semantics as provisioned_temp_password. */
  admin_reset_password: string;
  /** 3g-3: source lead's company/contact name ('' when not auto-provisioned). */
  provisioned_client_name: string;
  /** Phase 5 prep — account lifecycle ('active' | 'canceled', '' when the
   *  admin-list query predates the migration). */
  status: string;
  canceled_at: string;
  retention_until: string;
  /** Owner request 2026-08-14 — what this client pays per month (owner-set
   *  in Admin) + how their own business makes money ("sales" | "subscription"). */
  monthly_subscription_amount: number;
  revenue_model: string;
}

function toOrg(row: OrgRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    userCount: row.user_count,
    clientCount: row.client_count,
    loginEmail: row.login_email || "",
    /** 3g-3: only auto-provisioned orgs carry a temp password, and only until
     *  the member's first successful login clears it. */
    tempPassword: row.provisioned_temp_password || undefined,
    /** 3k: admin-initiated reset temp password while undelivered ('' once the
     *  member logs in) — owner-only, shown in the Admin list like the 3g-3
     *  auto-provisioned credential. */
    resetPassword: row.admin_reset_password || undefined,
    provisionedFromClient: row.provisioned_from_client || undefined,
    provisionedFromClientName: row.provisioned_client_name || undefined,
    // Owner request 2026-08-14 — what this client pays per month (owner-set
    // in Admin; visible to the tenant in Settings) + how their own business
    // makes money ("sales" | "subscription").
    monthlySubscriptionAmount: row.monthly_subscription_amount ?? 0,
    revenueModel: row.revenue_model ?? "sales",
    // Phase 5 prep — account lifecycle ('' = never canceled / active).
    status: row.status ?? "active",
    canceledAt: row.canceled_at ?? "",
    retentionUntil: row.retention_until ?? "",
  };
}

interface NewOrgInput {
  name: string;
  email: string;
  password: string;
  /** Business type (vertical template key, 3f-1; owner direction
   *  2026-08-16 the catalog is B2B & B2C only). "" = no preset — the org
   *  starts from the default pipeline with no seeded fields. */
  verticalKey: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the "create client account" payload: org name, the client's
 *  login email (must look like an email, unique across ALL users), and a
 *  temp password ≥ 8 chars. */
function validateNewOrg(
  body: Record<string, unknown>,
): { ok: true; value: NewOrgInput } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Company name is required." };
  if (name.length > 200) return { ok: false, error: "Company name must be under 200 characters." };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "Client email is required." };
  if (email.length > 254) return { ok: false, error: "Email must be under 254 characters." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return { ok: false, error: "Password is required." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  // 3f-1: optional business type. Any known catalog key (b2b / b2c since
  // 2026-08-16), or absent / "" for the no-preset org. Unknown keys —
  // including the retired catalog's ('general','cleaning','landscaping',…)
  // — are rejected.
  let verticalKey = "";
  if (body.vertical !== undefined && body.vertical !== null && body.vertical !== "") {
    if (typeof body.vertical !== "string") {
      return { ok: false, error: "Business type must be one of the provided options." };
    }
    verticalKey = body.vertical.trim().toLowerCase();
    if (!getVertical(verticalKey)) {
      return { ok: false, error: `Unknown business type: ${body.vertical}.` };
    }
  }

  return { ok: true, value: { name, email, password, verticalKey } };
}

/**
 * Insert a brand-new org + its first member user inside one transaction —
 * the single shared provisioning path used by BOTH the Admin "create client
 * account" form and the 3g-3 sold-lead auto-provisioning hook, so the two
 * never diverge. `verticalKey` seeds stages / vertical custom fields / the
 * account-level vertical config from the matching template; "" keeps
 * today's defaults (bare org).
 *
 * Email uniqueness is re-checked INSIDE the transaction (synchronous — no
 * interleaving can occur between the check and the insert), so a colliding
 * address aborts the whole provision cleanly with a throw.
 */
function insertOrgWithMember(input: {
  name: string;
  email: string;
  passwordHash: string;
  verticalKey: string;
}): { orgId: number; userId: number } {
  const tpl = input.verticalKey ? VERTICAL_MAP[input.verticalKey] : null;
  return db.transaction(() => {
    const taken = db.query("SELECT id FROM users WHERE email = ?").get(input.email);
    if (taken) throw new Error(`An account with this email already exists: ${input.email}`);
    let orgIdNew: number;
    if (tpl) {
      orgIdNew = Number(
        db
          .query(
            `INSERT INTO orgs (name, stages, custom_fields, service_model, delivery_type, industry, vertical_key, revenue_model)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.name,
            JSON.stringify(tpl.defaultStages),
            JSON.stringify(templateFieldDefs(tpl.defaultFields)),
            tpl.serviceModel,
            tpl.deliveryType,
            tpl.industry,
            tpl.key,
            // Owner request 2026-08-14 — revenue model seeded by business
            // type (both B2B and B2C → subscription; bare orgs keep the
            // 'sales' column default).
            tpl.revenueModel,
          ).lastInsertRowid,
      );
    } else {
      orgIdNew = Number(db.query("INSERT INTO orgs (name) VALUES (?)").run(input.name).lastInsertRowid);
    }
    const userId = Number(
      db
        .query("INSERT INTO users (email, password_hash, org_id, role) VALUES (?, ?, ?, 'member')")
        .run(input.email, input.passwordHash, orgIdNew).lastInsertRowid,
    );
    return { orgId: orgIdNew, userId };
  })();
}

/* ── 3g-3: sold-lead auto-provisioning ─────────────────────── */

/** The owner orgs = exactly the platform owner's workspace (Revzenta,
 *  identified by the default org's name). NOT role-based: since the team-users
 *  feature (owner request 2026-08-14) gives client-account org admins
 *  role='admin' too, a role-based lookup would wrongly treat tenant orgs as
 *  owner orgs and auto-provision from them. */
function ownerOrgIds(): number[] {
  return [getOwnerOrgId()];
}

/** True when the client's stage is the FINAL stage of this org's pipeline
 *  (case-insensitive exact match on the last stage name). For the owner org
 *  that final stage is "Sold". */
function isFinalStage(orgId: number, stage: string): boolean {
  const org = getOrg(orgId);
  if (!org) return false;
  const stages = parseStages(org.stages);
  if (stages.length === 0) return false;
  return stage.trim().toLowerCase() === stages[stages.length - 1].toLowerCase();
}

/** Match a client's free-text industry against the vertical catalog:
 *  case-insensitive match on the template KEY (the requirement), with a
 *  label fallback so "Pest Control" / "Med Spa" / "Real Estate" — the way
 *  the owner actually types industries — also resolve. No match → null
 *  (General / bare org). */
function verticalForIndustry(industry: string): VerticalTemplate | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "_");
  const target = norm(industry);
  if (!target) return null;
  for (const v of VERTICALS) {
    if (norm(v.key) === target) return v;
  }
  for (const v of VERTICALS) {
    if (norm(v.label) === target) return v;
  }
  return null;
}

/** Crypto-grade temp password: ≥1 from each class (upper/lower/digit/symbol)
 *  in a 16-char shuffled string. Server-side only — the Admin form's
 *  generator stays client-side for manual creation. */
function generateTempPassword(): string {
  const sets = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%^&*-_=+",
  ];
  const all = sets.join("");
  const randInt = (n: number): number => {
    const b = new Uint8Array(1);
    crypto.getRandomValues(b);
    return b[0] % n;
  };
  const chars: string[] = sets.map((s) => s[randInt(s.length)]);
  for (let i = 4; i < 16; i++) chars.push(all[randInt(all.length)]);
  // Fisher–Yates shuffle so the guaranteed classes aren't clustered.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Login email for the new workspace: the client's email when it looks like
 *  one, else a slug derived from the company name at @revzenta.com. (Pre-rename
 *  workspaces derived at @elevate.studio — those addresses are unchanged and
 *  remain valid login credentials; only NEW derivations use the new domain.) */
function loginEmailForClient(client: ClientRow): string {
  const email = client.email.trim().toLowerCase();
  if (EMAIL_RE.test(email)) return email;
  const slug = (client.company_name.trim() || client.contact_name.trim() || "client")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "client"}@revzenta.com`;
}

/** Append a numeric suffix until the address is unused (sync SELECT loop —
 *  call inside the provisioning transaction so nothing can interleave). */
function pickUniqueUserEmail(base: string): string {
  let email = base;
  for (let i = 1; db.query("SELECT id FROM users WHERE email = ?").get(email); i++) {
    const at = base.lastIndexOf("@");
    email = base.slice(0, at) + i + base.slice(at);
  }
  return email;
}

/**
 * Provision a brand-new CLEAN tenant workspace for a sold client (3g-3):
 * org seeded from the vertical matching the client's industry, a member
 * login (client email or derived slug@revzenta.com, numeric suffix when
 * taken), a crypto temp password, and the org's owner-visible provision
 * record + notification event. The client record itself stays in the OWNER's
 * pipeline — nothing carries over. Everything is one transaction: on any
 * failure nothing is created and the client stays unprovisioned (retried on
 * the next update of that record).
 */
async function provisionSoldClient(client: ClientRow): Promise<{
  orgId: number;
  userId: number;
  email: string;
  password: string;
  verticalKey: string;
}> {
  const tpl = verticalForIndustry(client.industry);
  const verticalKey = tpl?.key ?? "";
  const orgName = client.company_name.trim() || client.contact_name.trim() || "New client";
  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);
  const baseEmail = loginEmailForClient(client);

  const out = db.transaction((): { orgId: number; userId: number; email: string } | null => {
    // Re-check idempotency inside the transaction: the bcrypt await above
    // means another request could have provisioned this client meanwhile.
    const cur = db.query("SELECT provisioned_org_id FROM clients WHERE id = ?").get(client.id) as
      | { provisioned_org_id: number }
      | null;
    if (!cur || cur.provisioned_org_id !== 0) return null;
    const email = pickUniqueUserEmail(baseEmail);
    const { orgId, userId } = insertOrgWithMember({ name: orgName, email, passwordHash, verticalKey });
    db.query("UPDATE clients SET provisioned_org_id = ? WHERE id = ?").run(orgId, client.id);
    db.query("UPDATE orgs SET provisioned_from_client = ?, provisioned_temp_password = ? WHERE id = ?").run(
      client.id,
      password,
      orgId,
    );
    db.query(
      `INSERT INTO provision_events (client_id, source_org_id, new_org_id, client_name, org_name)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(client.id, client.org_id, orgId, client.company_name || client.contact_name, orgName);
    return { orgId, userId, email };
  })();
  if (!out) {
    return { orgId: 0, userId: 0, email: baseEmail, password, verticalKey };
  }
  return { orgId: out.orgId, userId: out.userId, email: out.email, password, verticalKey };
}

/**
 * The single trigger hook for 3g-3: after ANY client update (PUT) in the
 * owner org, if the record now sits in the final "Sold" stage and has no
 * provisioned org yet, provision one. The idempotency check IS the retry:
 * a sold client that failed to provision stays at provisioned_org_id = 0 and
 * is retried on the next update of that record. Never throws — a provision
 * failure must not fail the stage change that triggered it (the stage change
 * is already committed by the caller).
 */
async function maybeAutoProvisionSoldClient(orgId: number, client: ClientRow, req?: Request): Promise<void> {
  if (!ownerOrgIds().includes(orgId)) return; // tenant orgs never auto-provision
  if (client.provisioned_org_id !== 0) return; // one provision per client, forever
  if (!isFinalStage(orgId, client.stage)) return; // only INTO the final Sold stage
  try {
    const out = await provisionSoldClient(client);
    if (out.orgId !== 0) {
      console.log(
        `[3g-3] sold lead "${client.company_name}" (client ${client.id}) → provisioned workspace "${out.orgId}" (${out.email}, vertical ${out.verticalKey || "general"})`,
      );
      // 3g-4: intake email — AFTER the provision committed, fire-and-forget.
      // sendEmail never throws, so an email failure can never fail or delay
      // the provisioning that already happened.
      void sendIntakeEmail({
        to: out.email,
        orgName: getOrg(out.orgId)?.name ?? out.email,
        loginEmail: out.email,
        tempPassword: out.password,
        appUrl: appUrlFrom(req),
      });
    }
  } catch (e) {
    // The client's stage change has already committed — log and leave the
    // record unprovisioned so a later update retries it.
    console.error(`[3g-3] auto-provision failed for sold client ${client.id}:`, e);
  }
}

/* ── Org settings (Phase 3a/3b): branding + per-tenant pipeline stages
     + per-tenant custom fields ─────────────────────────────── */

const MAX_STAGES = 12;
const MAX_CUSTOM_FIELDS = 20;
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

/** Validates a proposed stage list: 1..12 names, trimmed, unique
 *  case-insensitively, each under 61 chars. Returns the cleaned list. */
function validateStages(
  v: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "Stages must be a list of names." };
  if (v.length === 0) return { ok: false, error: "At least one stage is required." };
  if (v.length > MAX_STAGES) return { ok: false, error: `Too many stages (max ${MAX_STAGES}).` };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of v) {
    if (typeof s !== "string") return { ok: false, error: "Each stage must be text." };
    const t = s.trim();
    if (!t) return { ok: false, error: "Stage names cannot be empty." };
    if (t.length > 60) return { ok: false, error: "Stage names must be under 61 characters." };
    const key = t.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Duplicate stage name: ${t}.` };
    seen.add(key);
    out.push(t);
  }
  return { ok: true, value: out };
}

/** Client counts per stage for an org (ALL clients, archived included — the
 *  removal guard counts everything so no client can be orphaned). */
function orgStageCounts(orgId: number): Record<string, number> {
  const counts: Record<string, number> = {};
  const rows = db
    .query("SELECT stage, COUNT(*) AS c FROM clients WHERE org_id = ? GROUP BY stage")
    .all(orgId) as { stage: string; c: number }[];
  for (const r of rows) counts[r.stage] = r.c;
  return counts;
}

/**
 * Validates a proposed custom-field definition list (Phase 3b): 0..20 fields,
 * each {name, type} with a trimmed name of 1–50 chars, unique
 * case-insensitively, and a type in the whitelist. Returns the cleaned list.
 */
function validateCustomFields(
  v: unknown,
): { ok: true; value: CustomFieldDef[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "Custom fields must be a list of {name, type}." };
  if (v.length > MAX_CUSTOM_FIELDS) {
    return { ok: false, error: `Too many custom fields (max ${MAX_CUSTOM_FIELDS}).` };
  }
  const out: CustomFieldDef[] = [];
  const seen = new Set<string>();
  for (const f of v) {
    if (f === null || typeof f !== "object" || Array.isArray(f)) {
      return { ok: false, error: "Each custom field must be an object with a name and a type." };
    }
    const obj = f as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) return { ok: false, error: "Custom field name is required." };
    if (name.length > 50) return { ok: false, error: "Custom field names must be under 51 characters." };
    const type = obj.type;
    if (!isCustomFieldType(type)) {
      return {
        ok: false,
        error: `Custom field type must be one of: text, number, date, checkbox, select.`,
      };
    }
    // 3f-1: select fields carry their options — required, 1..50 non-empty
    // options, each under 101 characters (mirrors the intake-group select
    // rules). Options are stored with the definition, org-scoped.
    let options: string[] | undefined;
    if (type === "select") {
      if (!Array.isArray(obj.options) || obj.options.length === 0) {
        return {
          ok: false,
          error: `Custom field "${name}" needs at least one option for type select.`,
        };
      }
      if (obj.options.length > 50) {
        return { ok: false, error: `Custom field "${name}" has too many options (max 50).` };
      }
      options = [];
      for (const o of obj.options) {
        if (typeof o !== "string") {
          return { ok: false, error: `Custom field "${name}" options must be text.` };
        }
        const t = o.trim();
        if (!t) return { ok: false, error: `Custom field "${name}" options cannot be empty.` };
        if (t.length > 100) {
          return { ok: false, error: `Custom field "${name}" options must be under 101 characters.` };
        }
        options.push(t);
      }
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Duplicate custom field: ${name}.` };
    seen.add(key);
    out.push({ name, type, ...(options ? { options } : {}) });
  }
  return { ok: true, value: out };
}

/* ── Adaptive intake Phase 3: custom conditional field groups ──────── */

const MAX_INTAKE_GROUPS = 10;
const MAX_GROUP_FIELDS = 20;
/** Field keys are stable identifiers values are stored under — lowercase
 *  letters/digits/underscores, starting with a letter (e.g. fleet_size). */
const INTAKE_GROUP_KEY_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Validates a proposed custom-intake-group list (Phase 3): 0..10 groups,
 * each {id, name, appliesTo, enabled, fields[]}. Group names are trimmed
 * 1–80 chars; field keys must be /^[a-z][a-z0-9_]*$/ (≤ 40 chars), labels
 * trimmed 1–80 chars, kinds text|yesno|select (select requires non-empty
 * options, each ≤ 100 chars). Field keys must be unique across ALL groups —
 * `otherDefs` lets the caller also forbid collisions with the tenant's
 * custom-field names, which share the same client value array. Returns the
 * cleaned list.
 */
function validateCustomIntakeGroups(
  v: unknown,
  otherDefs: CustomFieldDef[] = [],
): { ok: true; value: CustomIntakeGroup[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) {
    return { ok: false, error: "Custom intake groups must be a list of groups." };
  }
  if (v.length > MAX_INTAKE_GROUPS) {
    return { ok: false, error: `Too many custom intake groups (max ${MAX_INTAKE_GROUPS}).` };
  }
  const out: CustomIntakeGroup[] = [];
  const usedKeys = new Set<string>();
  for (const d of otherDefs) usedKeys.add(d.name.toLowerCase());
  for (const g of v) {
    if (g === null || typeof g !== "object" || Array.isArray(g)) {
      return { ok: false, error: "Each custom intake group must be an object." };
    }
    const obj = g as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!id) return { ok: false, error: "Each custom intake group needs an id." };
    if (id.length > 60) return { ok: false, error: "Custom intake group ids must be under 61 characters." };
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) return { ok: false, error: "Custom intake group name is required." };
    if (name.length > 80) return { ok: false, error: "Custom intake group names must be under 81 characters." };
    if (!isIntakeGroupAppliesTo(obj.appliesTo)) {
      return { ok: false, error: "Custom intake group appliesTo must be one of: commercial, individual, both." };
    }
    const enabled = obj.enabled === true;
    const fieldsRaw = obj.fields;
    if (!Array.isArray(fieldsRaw)) return { ok: false, error: `Custom intake group "${name}" needs a fields list.` };
    if (fieldsRaw.length === 0) return { ok: false, error: `Custom intake group "${name}" needs at least one field.` };
    if (fieldsRaw.length > MAX_GROUP_FIELDS) {
      return { ok: false, error: `Custom intake group "${name}" has too many fields (max ${MAX_GROUP_FIELDS}).` };
    }
    const fields: CustomIntakeField[] = [];
    for (const f of fieldsRaw) {
      if (f === null || typeof f !== "object" || Array.isArray(f)) {
        return { ok: false, error: `Custom intake group "${name}": each field must be an object.` };
      }
      const fo = f as Record<string, unknown>;
      const key = typeof fo.key === "string" ? fo.key.trim() : "";
      if (!INTAKE_GROUP_KEY_RE.test(key)) {
        return {
          ok: false,
          error: `Custom intake group "${name}": key "${key || "(empty)"}" must start with a lowercase letter and use only lowercase letters, digits and underscores (e.g. fleet_size).`,
        };
      }
      if (key.length > 40) {
        return { ok: false, error: `Custom intake group "${name}": key "${key}" must be under 41 characters.` };
      }
      if (usedKeys.has(key.toLowerCase())) {
        return {
          ok: false,
          error: `Custom intake group "${name}": key "${key}" is already used by another field — keys must be unique across all groups.`,
        };
      }
      usedKeys.add(key.toLowerCase());
      const label = typeof fo.label === "string" ? fo.label.trim() : "";
      if (!label) return { ok: false, error: `Custom intake group "${name}": field "${key}" needs a label.` };
      if (label.length > 80) {
        return { ok: false, error: `Custom intake group "${name}": field "${key}" label must be under 81 characters.` };
      }
      const kind = fo.kind;
      if (!isIntakeGroupFieldKind(kind)) {
        return {
          ok: false,
          error: `Custom intake group "${name}": field "${key}" kind must be one of: text, yesno, select.`,
        };
      }
      let options: string[] | undefined;
      if (kind === "select") {
        if (!Array.isArray(fo.options) || fo.options.length === 0) {
          return {
            ok: false,
            error: `Custom intake group "${name}": select field "${key}" needs at least one option.`,
          };
        }
        if (fo.options.length > 50) {
          return {
            ok: false,
            error: `Custom intake group "${name}": select field "${key}" has too many options (max 50).`,
          };
        }
        options = [];
        for (const o of fo.options) {
          if (typeof o !== "string") {
            return { ok: false, error: `Custom intake group "${name}": select field "${key}" options must be text.` };
          }
          const t = o.trim();
          if (!t) return { ok: false, error: `Custom intake group "${name}": select field "${key}" options cannot be empty.` };
          if (t.length > 100) {
            return {
              ok: false,
              error: `Custom intake group "${name}": select field "${key}" options must be under 101 characters.`,
            };
          }
          options.push(t);
        }
      }
      fields.push({ key, label, kind, ...(options ? { options } : {}) });
    }
    out.push({ id, name, appliesTo: obj.appliesTo, enabled, fields });
  }
  return { ok: true, value: out };
}

/* ── Routes ─────────────────────────────────────────────────────────── */

async function handleApi(req: Request, url: URL, server?: { requestIP(req: Request): { address: string } | null } | null): Promise<Response> {
  const { pathname } = url;
  const method = req.method;

  /* Auth */
  if (pathname === "/api/auth/login" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) return err("Email and password are required.", 400);

    if (userCount() === 0) {
      return json(
        {
          error: "setup_required",
          message:
            "No admin account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment, then run `bun run seed` (or restart the server).",
        },
        503,
      );
    }
    const user = getUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return err("Invalid email or password.", 401);
    }
    // Phase 5 prep - self-serve cancel: a canceled org's credentials are
    // rejected with a CLEAR message (never a generic failure). The owner org
    // can never be canceled (the cancel route guards it), so this can never
    // lock out the platform admin.
    const loginOrg = getOrg(user.org_id);
    if (loginOrg && loginOrg.status === "canceled") {
      return json(
        {
          error: "account_canceled",
          message: `This account has been canceled. Your data is retained until ${retentionDateLabel(loginOrg.retention_until)}. Contact support if this was a mistake.`,
        },
        403,
      );
    }
    // 3g-3: the first successful login with the temp password clears it from
    // the owner's Admin list — the credential has been "delivered" (3g-4
    // emails it to the client). Never cleared by impersonation, which swaps
    // sessions without verifying a password.
    if (user.org_id !== 0) {
      db.query("UPDATE orgs SET provisioned_temp_password = '' WHERE id = ? AND provisioned_temp_password != ''").run(
        user.org_id,
      );
      // 3k: same delivery semantics for the Admin-tab reset temp password —
      // once the member logs in (with ANY password), the credential has been
      // delivered and disappears from the owner's Admin list.
      db.query("UPDATE orgs SET admin_reset_password = '' WHERE id = ? AND admin_reset_password != ''").run(
        user.org_id,
      );
      // 3g-4: durable "has this member logged in before" marker — set
      // together with the temp-password clear, only on a real password login
      // (impersonation never reaches this handler). The welcome email fires
      // exactly once: on the null → set transition. Fire-and-forget with a
      // never-throwing sender — an email hiccup must never block login.
      if (user.role === "member") {
        const first = db
          .query(
            "UPDATE users SET first_login_at = COALESCE(first_login_at, datetime('now')) WHERE id = ? AND first_login_at IS NULL",
          )
          .run(user.id);
        if (Number(first.changes) > 0) {
          void sendWelcomeEmail({
            to: user.email,
            orgName: getOrg(user.org_id)?.name ?? "your workspace",
            appUrl: appUrlFrom(req),
          });
        }
      }
    }
    const token = createSession(user.id);
    return json(
      { user: toUser(user), impersonating: false, ok: true },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  /* 3k — forgot password (PUBLIC): mint a single-use reset token for the
     email's account (if one exists) and email the reset link. The response is
     identical whether or not the email is registered, so this endpoint never
     leaks which emails have accounts. The raw token goes out ONLY in the
     email; the DB stores its SHA-256 hash. Never throws — sendEmail degrades
     to a logged skip when RESEND_API_KEY is unset, exactly like 3g-4. */
  if (pathname === "/api/auth/forgot" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && EMAIL_RE.test(email)) {
      const user = getUserByEmail(email);
      if (user) {
        const token = generateResetToken();
        db.query("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(
          user.id,
          hashResetToken(token),
          Date.now() + RESET_TOKEN_TTL_MS,
        );
        console.log(`[pwreset] reset link issued for user ${user.id} (org ${user.org_id}) — token stored hashed only`);
        void sendPasswordResetEmail({ to: user.email, appUrl: appUrlFrom(req), token });
      }
    }
    return json(FORGOT_OK);
  }

  /* 3k — redeem a reset token (PUBLIC): validates the token (exists, unexpired,
     unused), sets the user's new password (same rules as signup), and marks
     the token used — all in one transaction. The token is bound to a specific
     user_id, so redemption can only ever change THAT user's password. Extra
     multi-tenant guard: an authenticated session whose org differs from the
     token's org gets 403 (the normal flow is unauthenticated — the link is
     the credential). */
  if (pathname === "/api/auth/reset" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!token || !password) return err("Token and new password are required.", 400);
    if (password.length < 8) return err("Password must be at least 8 characters.", 400);
    const row = db
      .query(
        `SELECT pr.id AS rid, pr.user_id, u.org_id
         FROM password_resets pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = ? AND pr.used_at IS NULL AND pr.expires_at > ?`,
      )
      .get(hashResetToken(token), Date.now()) as { rid: number; user_id: number; org_id: number } | null;
    if (!row) return err("This reset link is invalid or has expired.", 400);
    // Cross-org guard: a signed-in user may only redeem a token that belongs
    // to their OWN org. Unauthenticated redemption (the emailed link) is fine.
    const auth = requireAuth(req);
    if (!(auth instanceof Response) && auth.orgId !== row.org_id) {
      return err("Forbidden.", 403);
    }
    const hash = await hashPassword(password);
    db.transaction(() => {
      db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, row.user_id);
      db.query("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(row.rid);
    })();
    return json({ ok: true, message: "Your password has been reset. Sign in with your new password." });
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    });
  }

  if (pathname === "/api/auth/me") {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const user = getUserById(auth.userId);
    if (!user) return err("Not signed in.", 401);
    const imp = impersonationFrom(req);
    if (imp !== null) {
      return json({ user, impersonating: true, impersonatedFrom: imp });
    }
    return json({ user, impersonating: false });
  }

  /* Phase 3d — end an owner impersonation: swap back to the admin's own
     session (the origin is recorded in the current session's signed `imp`
     field). Only reachable while impersonating; the tenant user's own normal
     session has no `imp` and gets a 400. */
  if (pathname === "/api/auth/impersonate-return" && method === "POST") {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const adminId = impersonationFrom(req);
    if (adminId === null) return err("Not impersonating.", 400);
    const admin = getUserById(adminId);
    if (!admin || admin.role !== "admin" || !isOwnerOrg(admin.orgId)) {
      return err("Original admin session is no longer valid.", 403);
    }
    const token = createSession(admin.id);
    return json(
      { user: admin, impersonating: false, ok: true },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  /* Native e-signature (owner direction 2026-08-15) — PUBLIC sign/decline
     action. The emailed /sign/<token> link is the credential: no session is
     required, deliberately (the signer is a client, not a CRM user). One-time
     use — a signed/declined envelope rejects further actions — and the token
     is validated against expiry server-side. Accepts both JSON (the sign
     page's fetch) and form-encoded (no-JS fallback). */
  if (pathname.startsWith("/api/sign/") && method === "POST") {
    const token = decodeURIComponent(pathname.slice("/api/sign/".length)).trim();
    let action = "";
    let name = "";
    let consent = false;
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    const body = await readBody(req);
    if (body) {
      action = typeof body.action === "string" ? body.action : "";
      name = typeof body.name === "string" ? body.name : "";
      consent = body.consent === true || body.consent === "true" || body.consent === "on";
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(await req.text().catch(() => ""));
      action = params.get("action") ?? "";
      name = params.get("name") ?? "";
      consent = params.get("consent") === "on" || params.get("consent") === "true";
    }
    if (action !== "sign" && action !== "decline") {
      return err("Action must be sign or decline.", 400);
    }
    if (action === "sign" && (name.trim() === "" || !consent)) {
      return err("Signing requires your typed name and explicit consent.", 400);
    }
    const result = resolveAgreement(token, action, name, consent, clientIp(req, server));
    if (!result.ok) return err(result.error, 400);
    return json({ ok: true, status: result.status });
  }

  /* Everything below requires auth */
  const auth = requireAuth(req);
  if (auth instanceof Response) return auth;
  const orgId = auth.orgId;

  /* Native e-signature (owner direction 2026-08-15) — OWNER-WORKSPACE ONLY.
     Send: renders the owner's agreement template with the client's details,
     generates + stores the PDF, mints the sign token (hash stored), emails the
     client the unique /sign/<token> link, and advances the tracker to Sent.
     Tenants get 403 on every agreement route (requireAdmin below). */
  if (pathname === "/api/agreements/send" && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const clientId = typeof body.clientId === "number" ? body.clientId : NaN;
    if (!Number.isInteger(clientId) || clientId <= 0) return err("clientId is required.", 400);
    const client = db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(clientId, orgId) as ClientRow | null;
    if (!client) return err("Client not found.", 404);
    if (client.email.trim() === "") {
      return err(`${client.company_name} has no email address — add one before sending the agreement.`, 400);
    }
    const ownerOrg = getOrg(orgId);
    const template = ownerOrg?.agreement_template ?? "";
    const { token, envelope } = await sendAgreement(client, template);
    // Live-test finding #1 (2026-08-15): the tracker still advances to Sent,
    // but the email outcome is surfaced so the owner sees a failed send
    // (Resend test mode rejects non-owner recipients with HTTP 422) instead
    // of believing the link went out. The raw token + signUrl ride along so
    // the owner can copy/open the signing link manually when email failed.
    const email = await sendAgreementEmail({
      to: client.email,
      clientName: client.contact_name || client.company_name,
      appUrl: appUrlFrom(req),
      token,
    });
    return json({
      ok: true,
      clientId: client.id,
      status: envelope.status,
      expiresAt: envelope.expires_at,
      emailTo: client.email,
      emailStatus: emailStatusOf(email),
      ...(email.ok ? {} : { emailError: email.error }),
      signUrl: `${appUrlFrom(req)}/sign/${token}`,
      token,
    });
  }
  /* Owner-only audit list: every envelope for the owner org's OWN clients
     (joined for client name/email), newest first. Tenants 403. */
  if (pathname === "/api/agreements" && method === "GET") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const rows = db
      .query(
        `SELECT e.id, e.client_id, e.status, e.expires_at, e.pdf_id, e.signer_name, e.signed_at,
                e.ip_address, e.consent, e.created_at,
                c.company_name AS client_name, c.email AS client_email
         FROM agreement_envelopes e
         JOIN clients c ON c.id = e.client_id
         WHERE e.org_id = ?
         ORDER BY e.id DESC`,
      )
      .all(orgId) as Record<string, unknown>[];
    return json({
      agreements: rows.map((r) => ({
        id: Number(r.id),
        clientId: Number(r.client_id),
        status: isAgreementStatus(r.status) ? r.status : "sent",
        expiresAt: Number(r.expires_at),
        pdfId: String(r.pdf_id),
        signerName: String(r.signer_name ?? ""),
        signedAt: r.signed_at == null ? null : String(r.signed_at),
        ipAddress: String(r.ip_address ?? ""),
        consent: Number(r.consent ?? 0) === 1,
        createdAt: String(r.created_at),
        clientName: String(r.client_name ?? ""),
        clientEmail: String(r.client_email ?? ""),
      })),
    });
  }

  /* Admin (owner-only): tenant provisioning */
  if (pathname === "/api/admin/orgs" && method === "GET") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const rows = db
      .query(
        `SELECT o.id, o.name, o.created_at,
                o.monthly_subscription_amount,
                o.revenue_model,
                o.status,
                o.canceled_at,
                o.retention_until,
                o.provisioned_from_client,
                o.provisioned_temp_password,
                o.admin_reset_password,
                (SELECT c.company_name FROM clients c WHERE c.id = o.provisioned_from_client) AS provisioned_client_name,
                (SELECT u.email FROM users u WHERE u.org_id = o.id ORDER BY u.id ASC LIMIT 1) AS login_email,
                COUNT(DISTINCT u.id) AS user_count,
                COUNT(DISTINCT c.id) AS client_count
         FROM orgs o
         LEFT JOIN users u   ON u.org_id = o.id
         LEFT JOIN clients c ON c.org_id = o.id
         GROUP BY o.id
         ORDER BY o.id ASC`,
      )
      .all() as OrgRow[];
    return json({ orgs: rows.map(toOrg) });
  }

  /* 3g-3 — owner notifications: undismissed "auto-provisioned from sold lead"
     events, newest first. Owner-only (requireAdmin), like every /api/admin
     route. */
  if (pathname === "/api/admin/provisions" && method === "GET") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const rows = db
      .query(
        `SELECT id, client_name, org_name, new_org_id, created_at
         FROM provision_events
         WHERE dismissed = 0
         ORDER BY id DESC`,
      )
      .all() as { id: number; client_name: string; org_name: string; new_org_id: number; created_at: string }[];
    return json({
      provisions: rows.map((r) => ({
        id: r.id,
        clientName: r.client_name,
        orgName: r.org_name,
        orgId: r.new_org_id,
        createdAt: r.created_at,
      })),
    });
  }

  const provisionMatch = pathname.match(/^\/api\/admin\/provisions\/(\d+)\/dismiss$/);
  if (provisionMatch && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const id = Number(provisionMatch[1]);
    const res = db.query("UPDATE provision_events SET dismissed = 1 WHERE id = ?").run(id);
    if (res.changes === 0) return err("Provision notification not found.", 404);
    return json({ ok: true });
  }

  if (pathname === "/api/admin/orgs" && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = validateNewOrg(body);
    if (!v.ok) return err(v.error, 400);

    const hash = await hashPassword(v.value.password);
    // 3f-1: a business type seeds the new org's pipeline stages, vertical
    // custom fields and account-level vertical config from the template
    // (insertOrgWithMember — the SAME path the 3g-3 sold-lead hook uses).
    // General (verticalKey "") keeps today's defaults.
    let provisioned: { orgId: number; userId: number };
    try {
      provisioned = insertOrgWithMember({
        name: v.value.name,
        email: v.value.email,
        passwordHash: hash,
        verticalKey: v.value.verticalKey,
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes("already exists")) {
        return err("An account with this email already exists.", 400);
      }
      throw e;
    }
    const { orgId: newOrgId, userId } = provisioned;
    const org = db.query("SELECT id, name, created_at FROM orgs WHERE id = ?").get(newOrgId) as {
      id: number;
      name: string;
      created_at: string;
    };
    // Live-test finding #1 (2026-08-15): the workspace is created regardless,
    // but the welcome email with credentials is now sent here (same 3g-4
    // intake email the sold-lead hook sends) and its outcome is surfaced —
    // when Resend rejects it (test-mode 422, unconfigured key, ...) the UI
    // tells the owner the email did NOT go out so they share the credentials
    // manually instead of assuming delivery.
    const intakeEmail = await sendIntakeEmail({
      to: v.value.email,
      orgName: v.value.name,
      loginEmail: v.value.email,
      tempPassword: v.value.password,
      appUrl: appUrlFrom(req),
    });
    return json(
      {
        org: { id: org.id, name: org.name, createdAt: org.created_at },
        user: { id: userId, email: v.value.email, orgId: newOrgId, role: "member" as Role },
        emailStatus: emailStatusOf(intakeEmail),
        ...(intakeEmail.ok ? {} : { emailError: intakeEmail.error }),
      },
      201,
    );
  }

  const adminOrgMatch = pathname.match(/^\/api\/admin\/orgs\/(\d+)$/);
  if (adminOrgMatch && method === "DELETE") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const id = Number(adminOrgMatch[1]);
    const org = db.query("SELECT id, name FROM orgs WHERE id = ?").get(id) as
      | { id: number; name: string }
      | null;
    if (!org) return err("Org not found.", 404);
    // The default org is the owner's own org ("Revzenta") — never deletable.
    if (org.id === ensureDefaultOrg()) return err("Cannot delete the owner org.", 400);
    db.transaction(() => {
      db.query("DELETE FROM invoices WHERE org_id = ?").run(id);
      db.query("DELETE FROM tasks WHERE org_id = ?").run(id);
      // Support tickets (PR #54) and agreement envelopes (PR #59) both FK to
      // orgs — a tenant that opened a ticket (or signed an agreement) used to
      // 500 the org delete on the FK; drop every child table's rows first.
      db.query("DELETE FROM tickets WHERE org_id = ?").run(id);
      db.query("DELETE FROM agreement_envelopes WHERE org_id = ?").run(id);
      db.query("DELETE FROM clients WHERE org_id = ?").run(id);
      // 3g-3: provisioning events pointing at this org (plain columns, no FK —
      // cleaned so no orphaned event rows reference a deleted org).
      db.query("DELETE FROM provision_events WHERE new_org_id = ? OR source_org_id = ?").run(id, id);
      // 3k: password_resets references users — drop this org's tokens first.
      db.query("DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE org_id = ?)").run(id);
      db.query("DELETE FROM users WHERE org_id = ?").run(id);
      db.query("DELETE FROM orgs WHERE id = ?").run(id);
    })();
    return json({ ok: true });
  }

  /* Owner request 2026-08-14 — MRR + revenue model: PATCH a client account's
     billing settings (owner-only, like every /api/admin route). Accepts
     monthlySubscriptionAmount (USD, numeric >= 0 — the default 0 until Phase
     5 pricing) and/or revenueModel ("sales" | "subscription" — the owner
     override; the tenant can also change their own model in Settings).
     Unknown keys are ignored; an empty body updates nothing (400). */
  const adminOrgPatchMatch = pathname.match(/^\/api\/admin\/orgs\/(\d+)$/);
  if (adminOrgPatchMatch && method === "PATCH") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const id = Number(adminOrgPatchMatch[1]);
    const org = db.query("SELECT id, name FROM orgs WHERE id = ?").get(id) as
      | { id: number; name: string }
      | null;
    if (!org) return err("Org not found.", 404);
    if (org.id === ensureDefaultOrg()) {
      return err("The owner workspace's billing is not configurable.", 400);
    }
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (body.monthlySubscriptionAmount !== undefined && body.monthlySubscriptionAmount !== null && body.monthlySubscriptionAmount !== "") {
      const m = Number(body.monthlySubscriptionAmount);
      if (!Number.isFinite(m) || m < 0) {
        return err("Monthly subscription amount must be a non-negative number.", 400);
      }
      sets.push("monthly_subscription_amount = ?");
      params.push(m);
    }
    if (body.revenueModel !== undefined && body.revenueModel !== null && body.revenueModel !== "") {
      if (!isRevenueModel(body.revenueModel)) {
        return err("Revenue model must be one of: sales, subscription.", 400);
      }
      sets.push("revenue_model = ?");
      params.push(body.revenueModel);
    }
    if (sets.length === 0) return err("Nothing to update.", 400);
    params.push(id);
    db.query(`UPDATE orgs SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    const updated = db.query("SELECT id, name FROM orgs WHERE id = ?").get(id) as { id: number; name: string };
    return json({ ok: true, org: { id: updated.id, name: updated.name } });
  }

  /* 3k — owner-only per-tenant "Reset password" (the Admin tab action for a
     client who forgot their password and has no email access). Generates a
     crypto temp password (the same generator the 3g-3 sold-lead provisioning
     uses), hashes it into the tenant member's account, and stores the
     plaintext in orgs.admin_reset_password so the owner can hand it over —
     the same display/clearing pattern as the 3g-3 temp password. The owner
     org itself is never reset; a member calling this gets 403 via
     requireAdmin. */
  const adminResetMatch = pathname.match(/^\/api\/admin\/orgs\/(\d+)\/reset-password$/);
  if (adminResetMatch && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const id = Number(adminResetMatch[1]);
    const org = db.query("SELECT id, name FROM orgs WHERE id = ?").get(id) as
      | { id: number; name: string }
      | null;
    if (!org) return err("Org not found.", 404);
    if (org.id === admin.orgId) return err("Cannot reset the owner workspace's password.", 400);
    // Prefer the org's member login; fall back to any of its users (same rule
    // as the impersonate route).
    const member = db
      .query("SELECT id, email FROM users WHERE org_id = ? AND role = 'member' ORDER BY id ASC LIMIT 1")
      .get(org.id) as { id: number; email: string } | null;
    const target =
      member ??
      (db.query("SELECT id, email FROM users WHERE org_id = ? ORDER BY id ASC LIMIT 1").get(org.id) as
        | { id: number; email: string }
        | null);
    if (!target) return err("Org has no user accounts.", 400);
    const password = generateTempPassword();
    const hash = await hashPassword(password);
    db.transaction(() => {
      db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, target.id);
      // The fresh password supersedes any undelivered auto-provision credential.
      db.query("UPDATE orgs SET admin_reset_password = ?, provisioned_temp_password = '' WHERE id = ?").run(
        password,
        org.id,
      );
    })();
    console.log(`[pwreset] admin reset password for org ${org.id} (user ${target.id}) — stored hashed, plaintext only in admin_reset_password`);
    return json({ ok: true, orgId: org.id, email: target.email, password });
  }

  /* Phase 3d — owner impersonation: swap the admin's session for the target
     tenant's member user. This is a pure session swap — no new users/orgs,
     no password changes — and because the new session IS the tenant's user,
     every existing row-level isolation rule applies unchanged (the owner sees
     exactly what that tenant sees, nothing more). The originating admin id is
     stored inside the new signed session payload (`imp`) so the banner can
     show and `/api/auth/impersonate-return` can restore the admin session. */
  if (pathname === "/api/admin/impersonate" && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const orgIdNum = Number(body.orgId);
    if (!Number.isInteger(orgIdNum) || orgIdNum <= 0) {
      return err("orgId must be a positive integer.", 400);
    }
    const org = db.query("SELECT id, name FROM orgs WHERE id = ?").get(orgIdNum) as
      | { id: number; name: string }
      | null;
    if (!org) return err("Org not found.", 404);
    if (org.id === admin.orgId) return err("Cannot impersonate your own org.", 400);
    // Team-users UI (owner request 2026-08-14) — the owner always lands on
    // the account's ADMINISTRATOR: prefer the first user with a stored
    // role='admin'; otherwise fall back to the org's first user by id (every
    // single-user account's original owner login is its effective org admin,
    // even with a stored role of 'member' — the "no migration" rule).
    const adminUser = db
      .query("SELECT id FROM users WHERE org_id = ? AND role = 'admin' ORDER BY id ASC LIMIT 1")
      .get(org.id) as { id: number } | null;
    const target =
      adminUser ??
      (db.query("SELECT id FROM users WHERE org_id = ? ORDER BY id ASC LIMIT 1").get(org.id) as
        | { id: number }
        | null);
    if (!target) return err("Org has no user accounts.", 400);
    const targetUser = getUserById(target.id);
    if (!targetUser) return err("Org user not found.", 404);
    const token = createSession(targetUser.id, { impersonatedFrom: admin.userId });
    return json(
      { user: targetUser, impersonating: true, impersonatedFrom: admin.userId, ok: true },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  /* 3k — change password from Settings (authenticated): verifies the current
     password server-side, then updates to the new one (same rules as signup).
     The existing session stays valid — sessions are HMAC-signed and carry no
     password material, so there is no re-login after a change. Scoped to the
     session user AND org, so a member can only ever change their own. */
  if (pathname === "/api/auth/change-password" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!current) return err("Current password is required.", 400);
    if (!next) return err("New password is required.", 400);
    if (next.length < 8) return err("Password must be at least 8 characters.", 400);
    const row = db
      .query("SELECT password_hash FROM users WHERE id = ? AND org_id = ?")
      .get(auth.userId, auth.orgId) as { password_hash: string } | null;
    if (!row) return err("Not signed in.", 401);
    if (!(await verifyPassword(current, row.password_hash))) {
      return err("Current password is incorrect.", 400);
    }
    const hash = await hashPassword(next);
    db.query("UPDATE users SET password_hash = ? WHERE id = ? AND org_id = ?").run(hash, auth.userId, auth.orgId);
    return json({ ok: true, message: "Your password has been updated." });
  }

  /* Dashboard task overview (2026-08-14 owner request) — the aggregate
     buckets are computed against the server's local date, which is the same
     YYYY-MM-DD convention the task date inputs store (Tasks.tsx localToday). */
  const todayKey = (d: Date = new Date()): string => {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };
  const addDaysKey = (key: string, days: number): string => {
    const [y, m, d] = key.split("-").map(Number);
    return todayKey(new Date(y, m - 1, d + days));
  };

  /* Dashboard */
  if (pathname === "/api/dashboard" && method === "GET") {
    const org = getOrg(orgId);
    const orgStages = org ? parseStages(org.stages) : [...DEFAULT_STAGES];
    const stageCounts = {} as Record<Stage, number>;
    for (const s of orgStages) stageCounts[s] = 0;
    // Owner request 2026-08-14 — LOST leads are excluded from the stage
    // breakdown and the projected pipeline (dead leads are not pipeline
    // prospects). totalClients stays a plain record count (archived + lost
    // included — it labels the "in the book" header, not a pipeline KPI).
    const rows = db
      .query("SELECT stage, COUNT(*) AS c FROM clients WHERE org_id = ? AND archived = 0 AND lost = 0 GROUP BY stage")
      .all(orgId) as { stage: Stage; c: number }[];
    for (const r of rows) if (r.stage in stageCounts) stageCounts[r.stage] = r.c;

    const total = db
      .query("SELECT COUNT(*) AS c FROM clients WHERE org_id = ?")
      .get(orgId) as { c: number };
    const archived = db
      .query("SELECT COUNT(*) AS c FROM clients WHERE org_id = ? AND archived = 1")
      .get(orgId) as { c: number };
    const value = db
      .query("SELECT COALESCE(SUM(deal_value), 0) AS v FROM clients WHERE org_id = ? AND archived = 0 AND lost = 0")
      .get(orgId) as { v: number };
    /* Owner direction 2026-08-15 (clarified twice) — the OWNER's Dashboard
       "Projected pipeline" KPI must show ONLY the FIRST pipeline stage: the
       owner's prospects bucket (their Leads stage). The old all-stage sum
       counted Onboarding + Sold client deals on top of the Leads
       deals, double-reporting money that "Sold MRR" already shows. This is
       positional + rename-safe: first stage = orgStages[0], never a
       hardcoded "Leads" string (the owner can rename stages). The existing
       lost + archived exclusions are kept exactly. Client accounts
       (role=member) keep their own all-stage sum — for them projectedPipeline
       is their whole book's money, unchanged. */
    let projected = value.v;
    if (isOwnerSession(auth)) {
      const firstStage = orgStages.length > 0 ? orgStages[0] : "";
      projected = firstStage
        ? (db
            .query(
              `SELECT COALESCE(SUM(deal_value), 0) AS v FROM clients
               WHERE org_id = ? AND lost = 0 AND archived = 0
                 AND LOWER(TRIM(stage)) = LOWER(TRIM(?))`,
            )
            .get(orgId, firstStage) as { v: number }).v
        : 0;
    }
    const recent = (
      db
        .query("SELECT * FROM clients WHERE org_id = ? AND archived = 0 ORDER BY updated_at DESC, id DESC LIMIT 5")
        .all(orgId) as ClientRow[]
    ).map((r) => toClient(r, isOwnerSession(auth)));

    /* Task overview (2026-08-14 owner request): open / overdue / due soon /
       done counts plus the next few open tasks with a due date. Every query
       is scoped to the session org like the stats above — no cross-org reads.
       "Due soon" = due within the next 7 days (inclusive), excluding
       overdue (past due). Upcoming = open tasks with a due date, earliest
       first, capped at 4 to keep the payload small. */
    const today = todayKey();
    const soon = addDaysKey(today, 7);
    const openAgg = db.query("SELECT COUNT(*) AS c FROM tasks WHERE org_id = ? AND done = 0").get(orgId) as { c: number };
    const doneAgg = db.query("SELECT COUNT(*) AS c FROM tasks WHERE org_id = ? AND done = 1").get(orgId) as { c: number };
    const overdueAgg = db
      .query("SELECT COUNT(*) AS c FROM tasks WHERE org_id = ? AND done = 0 AND due_date != '' AND due_date < ?")
      .get(orgId, today) as { c: number };
    const dueSoonAgg = db
      .query(
        "SELECT COUNT(*) AS c FROM tasks WHERE org_id = ? AND done = 0 AND due_date != '' AND due_date >= ? AND due_date <= ?",
      )
      .get(orgId, today, soon) as { c: number };
    const upcoming = (
      db
        .query(
          `SELECT t.id, t.title, t.due_date, t.done, c.company_name AS client_name
           FROM tasks t
           LEFT JOIN clients c ON c.id = t.client_id
           WHERE t.org_id = ? AND t.done = 0 AND t.due_date != ''
           ORDER BY t.due_date ASC, t.id ASC
           LIMIT 4`,
        )
        .all(orgId) as { id: number; title: string; due_date: string; done: number; client_name: string | null }[]
    ).map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: r.due_date,
      done: r.done === 1,
      clientName: r.client_name ?? "",
    }));

    /* Owner request 2026-08-14/15 — MRR + vertical revenue dashboards.
       Two distinct workspaces, one endpoint:
         OWNER (role=admin): clientMrr = SUM of the OWNER's own client
           records' deal values (clients.deal_value) in the terminal/last
           pipeline stage ("Sold" for the owner — positionally detected,
           renamed-safe), excluding lost and archived records — the total
           for paying clients sold. orgCount = client-account count for the
           "+ New client" total. The per-account billing amount
           (orgs.monthly_subscription_amount) is Phase 5 billing prep only
           and does NOT feed MRR (owner direction 2026-08-15).
         ANY ORG: its OWN business money — salesThisMonth = SUM of this
           org's invoices dated in the current calendar month (due_date,
           the settable date; invoices without a date never count),
           subscriptionsTotal = SUM of this org's clients' monthly_amount
           (their own recurring book), and the org's revenueModel so the
           UI picks which KPI to show.
       The tenant response NEVER includes clientMrr/orgCount — a member
       cannot see the owner's MRR (or any other org's) in either direction. */
    const orgForMoney = org ?? null;
    const revenueModel = orgForMoney && isRevenueModel(orgForMoney.revenue_model)
      ? orgForMoney.revenue_model
      : "sales";
    const monthStart = `${todayKey().slice(0, 7)}-01`;
    const salesThisMonth = (
      db
        .query(
          `SELECT COALESCE(SUM(amount), 0) AS v
           FROM invoices
           WHERE org_id = ? AND due_date != '' AND due_date >= ? AND due_date <= ?`,
        )
        .get(orgId, monthStart, todayKey()) as { v: number }
    ).v;
    const subscriptionsTotal = (
      db.query("SELECT COALESCE(SUM(monthly_amount), 0) AS v FROM clients WHERE org_id = ?").get(orgId) as {
        v: number;
      }
    ).v;

    const resp: Record<string, unknown> = {
      stageCounts,
      projectedPipeline: projected,
      totalClients: total.c,
      archivedClients: archived.c,
      recentClients: recent,
      tasks: {
        open: openAgg.c,
        overdue: overdueAgg.c,
        dueSoon: dueSoonAgg.c,
        done: doneAgg.c,
        upcoming,
      },
      salesThisMonth,
      subscriptionsTotal,
      revenueModel,
    };
    // Owner-only Client MRR + account count (members never receive these keys).
    // Owner direction 2026-08-15: Client MRR = SUM of deal values on the
    // owner's OWN client records in the terminal (last/"Sold") pipeline stage,
    // excluding lost and archived records — "total for paying clients sold".
    // The per-account billing amount (orgs.monthly_subscription_amount) no
    // longer feeds MRR (Phase 5 billing prep only).
    if (isOwnerSession(auth)) {
      const mrrOrg = getOrg(orgId);
      const mrrStages = mrrOrg ? parseStages(mrrOrg.stages) : [...DEFAULT_STAGES];
      const terminalStage = mrrStages.length > 0 ? mrrStages[mrrStages.length - 1] : "";
      const mrr = terminalStage
        ? (db
            .query(
              `SELECT COALESCE(SUM(deal_value), 0) AS v FROM clients
               WHERE org_id = ? AND lost = 0 AND archived = 0
                 AND LOWER(TRIM(stage)) = LOWER(TRIM(?))`,
            )
            .get(orgId, terminalStage) as { v: number })
        : { v: 0 };
      const orgsAgg = db.query("SELECT COUNT(*) AS c FROM orgs").get() as { c: number };
      resp.clientMrr = mrr.v;
      resp.orgCount = orgsAgg.c;
    }
    return json(resp);
  }

  /* Org settings (Phase 3a): branding + per-tenant pipeline stages.
     Any signed-in member of the org may read/update their OWN org's settings
     (it is their CRM). The org always comes from the session — a body org_id
     is ignored, so there is no cross-org write path. */
  if (pathname === "/api/settings" && method === "GET") {
    const deniedRead = denyTabRead(auth, "settings");
    if (deniedRead) return deniedRead;
    const org = getOrg(orgId);
    if (!org) return err("Org not found.", 404);
    return json({
      settings: {
        orgName: org.name,
        accentColor: org.accent_color,
        stages: parseStages(org.stages),
        stageCounts: orgStageCounts(orgId),
        customFields: parseCustomFields(org.custom_fields),
        // Adaptive intake Phase 1: account-level vertical config.
        serviceModel: org.service_model,
        deliveryType: org.delivery_type,
        industry: org.industry,
        intakeOpts: parseIntakeOpts(org.intake_opts),
        // Adaptive intake Phase 3: tenant-defined custom conditional groups.
        customIntakeGroups: parseCustomIntakeGroups(org.custom_intake_groups),
        // 3f-1: the org's business type (vertical template key; '' = General).
        verticalKey: org.vertical_key ?? "",
        // Owner request 2026-08-14 — revenue model + what this org pays the
        // owner per month. The model is tenant-editable; the amount is
        // owner-set (Admin) — the tenant sees it here but cannot change it.
        revenueModel: isRevenueModel(org.revenue_model) ? org.revenue_model : "sales",
        monthlySubscriptionAmount: org.monthly_subscription_amount ?? 0,
        // Native e-signature — the OWNER org's editable agreement template.
        // Deliberately absent from tenant responses (owner-workspace only).
        ...(isOwnerSession(auth) ? { agreementTemplate: org.agreement_template ?? "" } : {}),
      },
    });
  }

  if (pathname === "/api/settings" && method === "PUT") {
    const deniedWrite = denyTabWrite(auth, "settings");
    if (deniedWrite) return deniedWrite;
    const org = getOrg(orgId);
    if (!org) return err("Org not found.", 404);
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);

    const sets: string[] = [];
    const params: (string | number)[] = [];

    if (body.orgName !== undefined) {
      const name = typeof body.orgName === "string" ? body.orgName.trim() : "";
      if (!name) return err("Workspace name is required.", 400);
      if (name.length > 200) return err("Workspace name must be under 200 characters.", 400);
      sets.push("name = ?");
      params.push(name);
    }

    if (body.accentColor !== undefined) {
      const hex = typeof body.accentColor === "string" ? body.accentColor.trim() : "";
      if (!ACCENT_RE.test(hex)) return err("Accent color must be a hex color like #d6ff3f.", 400);
      sets.push("accent_color = ?");
      params.push(hex.toLowerCase());
    }

    if (body.customFields !== undefined) {
      const v = validateCustomFields(body.customFields);
      if (!v.ok) return err(v.error, 400);
      // Removing a definition does NOT touch stored client values — they stay
      // intact on the client row, they just stop showing in settings/UI.
      sets.push("custom_fields = ?");
      params.push(JSON.stringify(v.value));
    }

    if (body.stages !== undefined) {
      const v = validateStages(body.stages);
      if (!v.ok) return err(v.error, 400);
      const next = v.value;
      const prev = parseStages(org.stages);

      const removed = prev.filter((p) => !next.some((n) => n.toLowerCase() === p.toLowerCase()));
      const added = next.filter((n) => !prev.some((p) => p.toLowerCase() === n.toLowerCase()));

      if (removed.length > 0 && removed.length !== added.length) {
        // A delete (possibly mixed with renames): never orphan clients.
        for (const r of removed) {
          const { c } = db
            .query("SELECT COUNT(*) AS c FROM clients WHERE org_id = ? AND stage = ?")
            .get(orgId, r) as { c: number };
          if (c > 0) {
            // Phase 3e: the guard counts from the org's own data and tells the
            // user the actionable next step (the old message was a bare error).
            return err(
              `Stage "${r}" has ${c} client${c === 1 ? "" : "s"} — move or archive ${c === 1 ? "it" : "them"} first.`,
              400,
            );
          }
        }
      } else if (removed.length > 0) {
        // Equal removed/added counts with fresh names = pure renames: migrate
        // clients positionally (old[i] → new[i]) so the pipeline stays intact.
        const n = Math.min(prev.length, next.length);
        for (let i = 0; i < n; i++) {
          if (prev[i] !== next[i] && removed.includes(prev[i]) && added.includes(next[i])) {
            db.query("UPDATE clients SET stage = ? WHERE org_id = ? AND stage = ?").run(next[i], orgId, prev[i]);
          }
        }
      } else {
        // No names left/entered: only case-folding renames can occur in place.
        const n = Math.min(prev.length, next.length);
        for (let i = 0; i < n; i++) {
          if (prev[i] !== next[i] && prev[i].toLowerCase() === next[i].toLowerCase()) {
            db.query("UPDATE clients SET stage = ? WHERE org_id = ? AND stage = ?").run(next[i], orgId, prev[i]);
          }
        }
      }

      sets.push("stages = ?");
      params.push(JSON.stringify(next));
    }

    /* Adaptive intake Phase 1: account-level vertical config. Unknown enum
       values are rejected; intakeOpts must be a JSON array of known optional
       group ids (unknown ids rejected, duplicates collapsed). */
    if (body.serviceModel !== undefined) {
      if (!isServiceModel(body.serviceModel)) {
        return err("Service model must be one of: residential_only, commercial_only, both.", 400);
      }
      sets.push("service_model = ?");
      params.push(body.serviceModel);
    }

    if (body.deliveryType !== undefined) {
      if (!isDeliveryType(body.deliveryType)) {
        return err("Delivery type must be one of: client_comes, we_go, both.", 400);
      }
      sets.push("delivery_type = ?");
      params.push(body.deliveryType);
    }

    if (body.industry !== undefined) {
      if (!isIndustry(body.industry)) {
        return err(
          "Industry must be one of: home_services, mobile_personal, professional, other, or empty.",
          400,
        );
      }
      sets.push("industry = ?");
      params.push(body.industry);
    }

    /* Owner request 2026-08-14 — the tenant edits their OWN revenue model
       here (how their business makes money: sales vs subscription). The
       monthly subscription AMOUNT they pay the owner is owner-set in Admin
       and deliberately NOT writable here. */
    if (body.revenueModel !== undefined) {
      if (!isRevenueModel(body.revenueModel)) {
        return err("Revenue model must be one of: sales, subscription.", 400);
      }
      sets.push("revenue_model = ?");
      params.push(body.revenueModel);
    }

    if (body.intakeOpts !== undefined) {
      if (!Array.isArray(body.intakeOpts)) {
        return err("intakeOpts must be a list of optional intake groups.", 400);
      }
      const out: string[] = [];
      const seen = new Set<string>();
      for (const g of body.intakeOpts) {
        if (!isIntakeOptGroup(g)) {
          return err(
            `Unknown optional intake group: ${String(g)} — allowed: ${INTAKE_OPT_GROUPS.join(", ")}.`,
            400,
          );
        }
        if (seen.has(g)) continue;
        seen.add(g);
        out.push(g);
      }
      sets.push("intake_opts = ?");
      params.push(JSON.stringify(out));
    }

    /* Adaptive intake 3f-1: apply a vertical template (change business type).
       STRICTLY ADDITIVE AND NON-DESTRUCTIVE: appends the template's missing
       stages (at the end, case-insensitive) and missing custom fields; updates
       industry / service model / delivery type + vertical_key; NEVER renames,
       removes or reorders existing stages or fields (they may hold data).
       "general" resets the vertical config to defaults and touches no stages
       or fields. The org always comes from the session — no cross-org path. */
    if (body.verticalKey !== undefined) {
      if (typeof body.verticalKey !== "string") {
        return err("Business type must be one of the provided options.", 400);
      }
      const key = body.verticalKey.trim().toLowerCase();
      if (key === "" || key === "general") {  // legacy "no preset" reset
        sets.push("vertical_key = ?", "industry = ?", "service_model = ?", "delivery_type = ?");
        params.push("", "", "both", "both");
      } else {
        const tpl = VERTICAL_MAP[key];
        if (!tpl) return err(`Unknown business type: ${body.verticalKey}.`, 400);
        // Stages: append only the template stages the org doesn't already
        // have (case-insensitive), keeping the org's order and renames.
        const prevStages = parseStages(org.stages);
        const nextStages = [...prevStages];
        for (const s of tpl.defaultStages) {
          if (!nextStages.some((x) => x.toLowerCase() === s.toLowerCase())) nextStages.push(s);
        }
        const vs = validateStages(nextStages);
        if (!vs.ok) {
          return err(`Cannot apply ${tpl.label}: ${vs.error}.`, 400);
        }
        sets.push("stages = ?");
        params.push(JSON.stringify(vs.value));
        // Custom fields: append only the template's fields the org doesn't
        // already have (case-insensitive by name), keeping the org's list.
        const prevFields = parseCustomFields(org.custom_fields);
        const tplDefs = templateFieldDefs(tpl.defaultFields) as StoredFieldDef[];
        const nextFields: CustomFieldDef[] = [...prevFields];
        for (const f of tplDefs) {
          if (!nextFields.some((x) => x.name.toLowerCase() === f.name.toLowerCase())) {
            nextFields.push({ name: f.name, type: f.type, ...(f.options ? { options: f.options } : {}) });
          }
        }
        const vf = validateCustomFields(nextFields);
        if (!vf.ok) {
          return err(`Cannot apply ${tpl.label}: ${vf.error}.`, 400);
        }
        sets.push("custom_fields = ?");
        params.push(JSON.stringify(vf.value));
        sets.push("vertical_key = ?", "industry = ?", "service_model = ?", "delivery_type = ?");
        params.push(tpl.key, tpl.industry, tpl.serviceModel, tpl.deliveryType);
      }
    }

    /* Adaptive intake Phase 3: custom conditional field groups. The shape is
       validated strictly (see validateCustomIntakeGroups); keys must be unique
       across all groups AND not collide with the tenant's custom-field names
       (both share the client's custom_fields value array). When customFields
       is updated in the same request, the collision check uses the NEW list. */
    if (body.customIntakeGroups !== undefined) {
      let defs = parseCustomFields(org.custom_fields);
      if (body.customFields !== undefined) {
        const vc = validateCustomFields(body.customFields);
        if (!vc.ok) return err(vc.error, 400);
        defs = vc.value;
      }
      const v = validateCustomIntakeGroups(body.customIntakeGroups, defs);
      if (!v.ok) return err(v.error, 400);
      sets.push("custom_intake_groups = ?");
      params.push(JSON.stringify(v.value));
    }

    /* Native e-signature — the OWNER org edits its agreement template here
       (Settings → "Agreement template"). Owner-session only: a tenant body
       key is ignored entirely, so there is no cross-org write path. */
    if (isOwnerSession(auth) && body.agreementTemplate !== undefined) {
      if (typeof body.agreementTemplate !== "string") {
        return err("Agreement template must be text.", 400);
      }
      if (body.agreementTemplate.length > 20000) {
        return err("Agreement template is too long (20,000 character limit).", 400);
      }
      sets.push("agreement_template = ?");
      params.push(body.agreementTemplate);
    }
    if (sets.length === 0) return err("Nothing to update.", 400);
    params.push(orgId);
    db.query(`UPDATE orgs SET ${sets.join(", ")} WHERE id = ?`).run(...params);

    const updated = getOrg(orgId);
    if (!updated) return err("Org not found.", 404);
    return json({
      settings: {
        orgName: updated.name,
        accentColor: updated.accent_color,
        stages: parseStages(updated.stages),
        customFields: parseCustomFields(updated.custom_fields),
        serviceModel: updated.service_model,
        deliveryType: updated.delivery_type,
        industry: updated.industry,
        intakeOpts: parseIntakeOpts(updated.intake_opts),
        customIntakeGroups: parseCustomIntakeGroups(updated.custom_intake_groups),
        verticalKey: updated.vertical_key ?? "",
        revenueModel: isRevenueModel(updated.revenue_model) ? updated.revenue_model : "sales",
        monthlySubscriptionAmount: updated.monthly_subscription_amount ?? 0,
      },
    });
  }

  /* Phase 5 prep — self-serve data export (tenant self-service). The org
     admin (or a member with settings READ access — the same gate as the
     settings GET) downloads a JSON file of THEIR OWN org's rows: clients,
     tasks, invoices, tickets, agreement envelopes, org settings + custom
     field definitions, and the org's users. SANITIZED: no password hashes,
     no reset/sign tokens, no temp passwords (credentials never leave the
     server). Every query is scoped by the session org — there is no
     cross-org addressing. Delivered as an attachment download
     (Content-Disposition), so the browser saves a file. */
  if (pathname === "/api/settings/export" && method === "GET") {
    const deniedRead = denyTabRead(auth, "settings");
    if (deniedRead) return deniedRead;
    const org = getOrg(orgId);
    if (!org) return err("Org not found.", 404);

    const clients = db
      .query("SELECT * FROM clients WHERE org_id = ? ORDER BY id ASC")
      .all(orgId) as Record<string, unknown>[];
    const tasks = db
      .query("SELECT * FROM tasks WHERE org_id = ? ORDER BY id ASC")
      .all(orgId) as Record<string, unknown>[];
    const invoices = db
      .query("SELECT * FROM invoices WHERE org_id = ? ORDER BY id ASC")
      .all(orgId) as Record<string, unknown>[];
    const tickets = db
      .query("SELECT * FROM tickets WHERE org_id = ? ORDER BY id ASC")
      .all(orgId) as Record<string, unknown>[];
    // Agreement envelopes belong to the org that sent them (owner-workspace
    // today, scoped by org_id either way). The sign TOKEN HASH is a
    // credential — never exported.
    const agreements = db
      .query(
        `SELECT id, client_id, status, expires_at, pdf_id, agreement_text, signer_name, signed_at, ip_address, consent, created_at, updated_at
         FROM agreement_envelopes WHERE org_id = ? ORDER BY id ASC`,
      )
      .all(orgId) as Record<string, unknown>[];
    // Users: explicit columns — NEVER password_hash. The org's temp passwords
    // (provisioned_temp_password / admin_reset_password) are credentials too
    // and live on the org row — excluded from the export entirely.
    const users = db
      .query(
        `SELECT id, email, role, permissions, created_at, first_login_at FROM users WHERE org_id = ? ORDER BY id ASC`,
      )
      .all(orgId) as Record<string, unknown>[];

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      org: {
        id: org.id,
        name: org.name,
        createdAt: org.created_at,
        stages: parseStages(org.stages),
        customFields: parseCustomFields(org.custom_fields),
        serviceModel: org.service_model,
        deliveryType: org.delivery_type,
        industry: org.industry,
        intakeOpts: parseIntakeOpts(org.intake_opts),
        customIntakeGroups: parseCustomIntakeGroups(org.custom_intake_groups),
        verticalKey: org.vertical_key ?? "",
        revenueModel: isRevenueModel(org.revenue_model) ? org.revenue_model : "sales",
        monthlySubscriptionAmount: org.monthly_subscription_amount ?? 0,
      },
      users,
      clients,
      tasks,
      invoices,
      tickets,
      agreements,
    };

    const slug =
      org.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "org";
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="crm-export-${slug}-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  /* Phase 5 prep — self-serve cancel/offboarding (per-account subscription).
     The org admin cancels their OWN account from Settings: org.status →
     'canceled', users can no longer log in (login + every authed route are
     blocked server-side) and NO data is hard-deleted — it is retained for
     the 30-day retention window (retention_until = cancel time + 30 days).
     The owner org (Revzenta) can never cancel itself: the platform
     admin workspace is the product's operator console. The response clears
     the session cookie so the UI signs the canceling admin out. */
  if (pathname === "/api/settings/cancel" && method === "POST") {
    const deniedOrgAdmin = requireOrgAdmin(auth);
    if (deniedOrgAdmin) return deniedOrgAdmin;
    if (isOwnerOrg(orgId)) {
      return err("The owner workspace cannot be canceled.", 403);
    }
    const org = getOrg(orgId);
    if (!org) return err("Org not found.", 404);
    if (org.status === "canceled") {
      return err("This account is already canceled.", 400);
    }
    db.query(
      "UPDATE orgs SET status = 'canceled', canceled_at = datetime('now'), retention_until = datetime('now', '+30 days') WHERE id = ?",
    ).run(orgId);
    const updated = getOrg(orgId);
    return json(
      {
        ok: true,
        message:
          "Your account has been canceled. Your data is retained for 30 days and no further charges will be made.",
        canceledAt: updated?.canceled_at ?? "",
        retentionUntil: updated?.retention_until ?? "",
      },
      200,
      { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` },
    );
  }

  /* Clients collection */
  if (pathname === "/api/clients" && method === "GET") {
    const deniedRead = denyTabRead(auth, "clients");
    if (deniedRead) return deniedRead;
    const includeArchived = url.searchParams.get("archived") === "1";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    let rows: ClientRow[];
    if (q) {
      rows = db
        .query(
          `SELECT * FROM clients
           WHERE org_id = ?
             AND (archived = 0 OR ? = 1)
             AND (LOWER(company_name) LIKE ? OR LOWER(contact_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(industry) LIKE ?
                  OR LOWER(address) LIKE ? OR LOWER(city) LIKE ? OR LOWER(phone) LIKE ?)
           ORDER BY updated_at DESC, id DESC`,
        )
        .all(
          orgId,
          includeArchived ? 1 : 0,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
        ) as ClientRow[];
    } else {
      rows = db
        .query(
          `SELECT * FROM clients WHERE org_id = ? AND (archived = 0 OR ? = 1) ORDER BY updated_at DESC, id DESC`,
        )
        .all(orgId, includeArchived ? 1 : 0) as ClientRow[];
    }
    // Owner cockpit B — the OWNER org (role=admin) receives agreementStatus
    // on every client; tenant orgs get the exact pre-change shape.
    return json({ clients: rows.map((r) => toClient(r, isOwnerSession(auth))) });
  }

  if (pathname === "/api/clients" && method === "POST") {
    const deniedWrite = denyTabWrite(auth, "clients");
    if (deniedWrite) return deniedWrite;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const org = getOrg(orgId);
    const v = validateClient(
      body,
      org ? parseStages(org.stages) : [...DEFAULT_STAGES],
      org ? parseCustomFields(org.custom_fields) : [],
      org ? parseCustomIntakeGroups(org.custom_intake_groups) : [],
      isOwnerSession(auth), // owner cockpit B — agreement status is owner-only
    );
    if (!v.ok) return err(v.error, 400);
    const c = v.value;
    const intake = intakeColumns(c);
    const info = db
      .query(
        `INSERT INTO clients (org_id, company_name, contact_name, email, phone, industry, services, custom_fields, deal_value, stage, next_action, notes, archived, client_type, address, city, state, zip, website, lead_source, monthly_amount, ${INTAKE_COLS.join(", ")}, ${STATUS_COLS.join(", ")}, agreement_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${INTAKE_COLS.map(() => "?").join(", ")}, ${STATUS_COLS.map(() => "?").join(", ")}, ?)`,
      )
      .run(
        orgId,
        c.companyName, c.contactName, c.email, c.phone, c.industry,
        JSON.stringify(c.services), JSON.stringify(c.customFields), c.dealValue, c.stage, c.nextAction, c.notes,
        c.archived ? 1 : 0,
        c.clientType, c.address, c.city, c.state, c.zip, c.website, c.leadSource,
        c.monthlyAmount ?? 0,
        ...intake.values,
        ...statusValues(c),
        c.agreementStatus ?? "not_sent",
      );
    const row = db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(info.lastInsertRowid, orgId) as ClientRow;
    return json({ client: toClient(row, isOwnerSession(auth)) }, 201);
  }

  /* Phase 5 prep — Stripe payment link (live-test finding 2026-08-17):
     OWNER-ONLY (requireAdmin, like the agreement routes — the owner bills
     the client's $200/month subscription; tenant orgs never send payment
     links). Creates a Stripe Payment Link for $200.00/month and emails it to
     the client. Placeholder behavior: with no STRIPE_SECRET_KEY the endpoint
     returns 503 { error: "Stripe not configured" } and the UI explains the
     keys are not connected. Once the owner adds STRIPE_SECRET_KEY the same
     code path creates a real Payment Link (stripeClient is a lazy singleton —
     no Stripe code runs, or even imports eagerly, without the key) and emails
     it via the existing Resend infra. */
  const payMatch = pathname.match(/^\/api\/clients\/(\d+)\/payment-link$/);
  if (payMatch && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const id = Number(payMatch[1]);
    const client = db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(id, orgId) as ClientRow | null;
    if (!client) return err("Client not found.", 404);
    // Owner direction 2026-08-18 — THE rule: the payment link must NOT be
    // operational unless the client's agreement is fully signed. Unsigned →
    // 409 ALWAYS (before any Stripe state is consulted); signed + no
    // STRIPE_SECRET_KEY → the 503 below (unchanged).
    if (client.agreement_status !== "signed") {
      return err(
        client.company_name + " hasn't signed the agreement yet — send the payment link only after the agreement is signed.",
        409,
      );
    }
    const stripe = stripeClient();
    if (!stripe) {
      return json({ error: "Stripe not configured" }, 503);
    }
    if (client.email.trim() === "") {
      return err(client.company_name + " has no email address — add one before sending a payment link.", 400);
    }
    try {
      // $200.00/month — the CRM subscription price (owner direction
      // 2026-08-15). A recurring price on a Payment Link starts a monthly
      // subscription at checkout.
      const price = await stripe.prices.create({
        currency: "usd",
        unit_amount: 20000,
        recurring: { interval: "month" },
        product_data: { name: "Revzenta CRM — monthly subscription" },
      });
      const link = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
      });
      // Email the link to the client ONLY after Stripe succeeded.
      const email = await sendPaymentLinkEmail({
        to: client.email,
        clientName: client.contact_name || client.company_name,
        linkUrl: link.url,
      });
      // Owner direction 2026-08-18 — the status flip happens ONLY after Stripe
      // AND the email both succeeded: payment_status none → sent (the Payment
      // column turns yellow), and the emailed link is stored for the tooltip.
      db.query(
        "UPDATE clients SET payment_status = 'sent', payment_link_url = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?",
      ).run(link.url, client.id, orgId);
      return json({
        ok: true,
        clientId: client.id,
        url: link.url,
        emailTo: client.email,
        emailStatus: emailStatusOf(email),
        emailError: email.ok ? undefined : email.error,
        paymentStatus: "sent",
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error("[stripe] payment link failed for client " + id + ": " + m);
      return json({ error: "Stripe request failed: " + m }, 502);
    }
  }

  /* Owner direction 2026-08-18 — interim "mark payment received" endpoint.
     Stripe webhooks do not exist yet, so this is the manual way the owner
     flips the Payment column yellow (sent) → green (paid) during live
     testing. In Phase 5 a Stripe webhook (checkout.session.completed /
     invoice.paid) will call the same UPDATE automatically; this endpoint
     remains the manual fallback. OWNER-ONLY (requireAdmin), like the
     payment-link route. */
  const paidMatch = pathname.match(/^\/api\/clients\/(\d+)\/payment-paid$/);
  if (paidMatch && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const id = Number(paidMatch[1]);
    const client = db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(id, orgId) as ClientRow | null;
    if (!client) return err("Client not found.", 404);
    db.query(
      "UPDATE clients SET payment_status = 'paid', paid_at = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?",
    ).run(new Date().toISOString(), id, orgId);
    return json({ ok: true, paymentStatus: "paid" });
  }
  /* Client item */
  const itemMatch = pathname.match(/^\/api\/clients\/(\d+)$/);
  if (itemMatch) {
    const id = Number(itemMatch[1]);
    const find = () => db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(id, orgId) as ClientRow | null;

    if (method === "GET") {
      const deniedRead = denyTabRead(auth, "clients");
      if (deniedRead) return deniedRead;
      const row = find();
      if (!row) return err("Client not found.", 404);
      return json({ client: toClient(row, isOwnerSession(auth)) });
    }

    if (method === "PUT") {
      const deniedWrite = denyTabWrite(auth, "clients");
      if (deniedWrite) return deniedWrite;
      const row = find();
      if (!row) return err("Client not found.", 404);
      const body = await readBody(req);
      if (!body) return err("Invalid JSON body.", 400);
      const org = getOrg(orgId);
      const v = validateClient(
        body,
        org ? parseStages(org.stages) : [...DEFAULT_STAGES],
        org ? parseCustomFields(org.custom_fields) : [],
        org ? parseCustomIntakeGroups(org.custom_intake_groups) : [],
        isOwnerSession(auth), // owner cockpit B — agreement status is owner-only
      );
      if (!v.ok) return err(v.error, 400);
      const c = v.value;
      // AZ defect D4 (2026-08-17): TRUE partial updates — a column is
      // persisted ONLY when the client sent the field. An omitted key NEVER
      // clobbers the stored value (the documented partial-update rule that
      // monthlyAmount / intake / lost-DNC / agreementStatus already follow).
      // Previously this base SET list was unconditional, so a partial PUT
      // reset the stage to the FIRST stage, zeroed dealValue and cleared
      // notes/services/customFields/address etc.
      const sets: string[] = [];
      const params: (string | number)[] = [];
      const set = (col: string, value: string | number) => {
        sets.push(`${col} = ?`);
        params.push(value);
      };
      // Body-presence gate: undefined/null = absent (keep stored value).
      // dealValue/stage additionally treat "" like absent — the exact same
      // gate validateClient uses before validating them.
      const has = (k: string) => body[k] !== undefined && body[k] !== null;
      const hasValue = (k: string) => {
        const v = body[k];
        return v !== undefined && v !== null && v !== "";
      };
      if (has("companyName")) set("company_name", c.companyName);
      if (has("contactName")) set("contact_name", c.contactName);
      if (has("email")) set("email", c.email);
      if (has("phone")) set("phone", c.phone);
      if (has("industry")) set("industry", c.industry);
      if (has("services")) set("services", JSON.stringify(c.services));
      if (has("customFields")) set("custom_fields", JSON.stringify(c.customFields));
      if (hasValue("dealValue")) set("deal_value", c.dealValue);
      if (hasValue("stage")) set("stage", c.stage);
      if (has("nextAction")) set("next_action", c.nextAction);
      if (has("notes")) set("notes", c.notes);
      if (has("archived")) set("archived", c.archived ? 1 : 0);
      if (has("clientType")) set("client_type", c.clientType);
      if (has("address")) set("address", c.address);
      if (has("city")) set("city", c.city);
      if (has("state")) set("state", c.state);
      if (has("zip")) set("zip", c.zip);
      if (has("website")) set("website", c.website);
      if (has("leadSource")) set("lead_source", c.leadSource);
      // Owner request 2026-08-14 — the record's monthly amount: persisted only
      // when present in the body (validateClient only sets it when the client
      // sent it), so partial updates never clobber an absent value.
      if (c.monthlyAmount !== undefined) {
        sets.push("monthly_amount = ?");
        params.push(c.monthlyAmount);
      }
      // Adaptive intake Phase 1: only persist the new optional fields that are
      // actually present in the body — missing keys leave the stored value
      // untouched (nothing clobbered on partial updates).
      const rec = c as unknown as Record<string, unknown>;
      for (const f of INTAKE_TEXT_COLS) {
        const v = rec[f.key];
        if (v !== undefined) {
          sets.push(`${f.col} = ?`);
          params.push(v as string);
        }
      }
      for (const f of INTAKE_BOOL_COLS) {
        const v = rec[f.key];
        if (v !== undefined) {
          sets.push(`${f.col} = ?`);
          params.push(v === true ? 1 : 0);
        }
      }
      // Owner request 2026-08-14 — lost/DNC: persisted ONLY when present in
      // the body (partial updates never clobber absent flags). Clearing a flag
      // also clears its reason/date (validateClient already normalizes that).
      if (body.lost !== undefined && body.lost !== null) {
        sets.push("lost = ?");
        params.push(rec.lost === true ? 1 : 0);
        sets.push("lost_reason = ?");
        params.push(typeof rec.lostReason === "string" ? rec.lostReason : "");
      }
      if (body.dnc !== undefined && body.dnc !== null) {
        sets.push("dnc = ?");
        params.push(rec.dnc === true ? 1 : 0);
        sets.push("dnc_reason = ?");
        params.push(typeof rec.dncReason === "string" ? rec.dncReason : "");
        sets.push("dnc_date = ?");
        params.push(typeof rec.dncDate === "string" ? rec.dncDate : "");
      }
      // Owner cockpit B (owner direction 2026-08-15) — DocuSign agreement
      // status: persisted ONLY for the owner org (role=admin) and only when
      // present in the body. Tenant payloads never write it; partial updates
      // never clobber an absent value (the lost/DNC rule).
      if (isOwnerSession(auth) && rec.agreementStatus !== undefined) {
        sets.push("agreement_status = ?");
        params.push(rec.agreementStatus as string);
      }
      sets.push("updated_at = datetime('now')");
      params.push(id, orgId);
      db.query(`UPDATE clients SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`).run(...params);
      const updated = db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(id, orgId) as ClientRow;
      // 3g-3: the single trigger hook — after ANY owner-org client update, if
      // the record is now in the final "Sold" stage (and not provisioned yet)
      // a brand-new tenant workspace is provisioned for it. The stage change
      // above is already committed; a provision failure never fails the PUT.
      // The idempotency check inside also makes this the retry path for a
      // sold client whose earlier provision failed.
      await maybeAutoProvisionSoldClient(orgId, updated, req);
      return json({ client: toClient(updated, isOwnerSession(auth)) });
    }

    if (method === "DELETE") {
      const deniedWrite = denyTabWrite(auth, "clients");
      if (deniedWrite) return deniedWrite;
      const row = find();
      if (!row) return err("Client not found.", 404);
      db.query("DELETE FROM clients WHERE id = ? AND org_id = ?").run(id, orgId);
      return json({ ok: true });
    }

    return err("Method not allowed.", 405);
  }

  /* Tasks collection */
  if (pathname === "/api/tasks" && method === "GET") {
    const deniedRead = denyTabRead(auth, "tasks");
    if (deniedRead) return deniedRead;
    const doneParam = url.searchParams.get("done");
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const clauses: string[] = ["t.org_id = ?"];
    const params: (string | number)[] = [orgId];
    if (doneParam === "0") clauses.push("t.done = 0");
    else if (doneParam === "1") clauses.push("t.done = 1");
    if (q) {
      clauses.push("LOWER(t.title) LIKE ?");
      params.push(`%${q}%`);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = db
      .query(
        `${TASK_SELECT}
         ${where}
         ORDER BY t.done ASC, (t.due_date = '') ASC, t.due_date ASC, t.created_at DESC, t.id DESC`,
      )
      .all(...params) as TaskRowJoined[];
    return json({ tasks: rows.map(toTask) });
  }

  if (pathname === "/api/tasks" && method === "POST") {
    const deniedWrite = denyTabWrite(auth, "tasks");
    if (deniedWrite) return deniedWrite;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = parseTaskFields(body);
    if (!v.ok) return err(v.error, 400);
    if (!v.value.title) return err("Title is required.", 400);
    const clientId = v.value.clientId ?? null;
    if (clientId !== null) {
      const bad = ensureClientExists(clientId, orgId);
      if (bad) return bad;
    }
    const info = db
      .query(
        `INSERT INTO tasks (org_id, title, client_id, due_date, done, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        v.value.title,
        clientId,
        v.value.dueDate ?? "",
        v.value.done ? 1 : 0,
        v.value.notes ?? "",
      );
    const task = fetchTask(Number(info.lastInsertRowid), orgId);
    return json({ task }, 201);
  }

  /* Task item + toggle */
  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  const taskToggleMatch = pathname.match(/^\/api\/tasks\/(\d+)\/toggle$/);

  if (taskToggleMatch && method === "POST") {
    const deniedWrite = denyTabWrite(auth, "tasks");
    if (deniedWrite) return deniedWrite;
    const id = Number(taskToggleMatch[1]);
    const row = db.query("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(id, orgId) as TaskRow | null;
    if (!row) return err("Task not found.", 404);
    db.query("UPDATE tasks SET done = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?").run(
      row.done ? 0 : 1,
      id,
      orgId,
    );
    return json({ task: fetchTask(id, orgId) });
  }

  if (taskMatch) {
    const id = Number(taskMatch[1]);
    const find = () => db.query("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(id, orgId) as TaskRow | null;

    if (method === "PUT") {
      const deniedWrite = denyTabWrite(auth, "tasks");
      if (deniedWrite) return deniedWrite;
      const row = find();
      if (!row) return err("Task not found.", 404);
      const body = await readBody(req);
      if (!body) return err("Invalid JSON body.", 400);
      const v = parseTaskFields(body);
      if (!v.ok) return err(v.error, 400);
      const f = v.value;
      if (f.clientId !== undefined && f.clientId !== null) {
        const bad = ensureClientExists(f.clientId, orgId);
        if (bad) return bad;
      }
      db.query(
        `UPDATE tasks SET
           title = ?, client_id = ?, due_date = ?, done = ?, notes = ?,
           updated_at = datetime('now')
         WHERE id = ? AND org_id = ?`,
      ).run(
        f.title ?? row.title,
        f.clientId !== undefined ? f.clientId : row.client_id,
        f.dueDate ?? row.due_date,
        f.done !== undefined ? (f.done ? 1 : 0) : row.done,
        f.notes ?? row.notes,
        id,
        orgId,
      );
      return json({ task: fetchTask(id, orgId) });
    }

    if (method === "DELETE") {
      const deniedWrite = denyTabWrite(auth, "tasks");
      if (deniedWrite) return deniedWrite;
      const row = find();
      if (!row) return err("Task not found.", 404);
      db.query("DELETE FROM tasks WHERE id = ? AND org_id = ?").run(id, orgId);
      return json({ ok: true });
    }

    return err("Method not allowed.", 405);
  }

  /* Invoices collection */
  if (pathname === "/api/invoices" && method === "GET") {
    const deniedRead = denyTabRead(auth, "finance");
    if (deniedRead) return deniedRead;
    const statusParam = url.searchParams.get("status");
    const clientParam = url.searchParams.get("clientId");
    const clauses: string[] = ["i.org_id = ?"];
    const params: (string | number)[] = [orgId];
    if (statusParam !== null) {
      if (!isInvoiceStatus(statusParam)) {
        return err(`Status must be one of: ${INVOICE_STATUSES.join(", ")}.`, 400);
      }
      clauses.push("i.status = ?");
      params.push(statusParam);
    }
    if (clientParam !== null) {
      const cid = Number(clientParam);
      if (!Number.isInteger(cid) || cid <= 0) return err("clientId must be a positive integer.", 400);
      clauses.push("i.client_id = ?");
      params.push(cid);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = db
      .query(
        `${INVOICE_SELECT}
         ${where}
         ORDER BY CASE WHEN i.status = 'paid' THEN 1 ELSE 0 END ASC,
                  (i.due_date = '') ASC,
                  i.due_date ASC,
                  i.created_at DESC,
                  i.id DESC`,
      )
      .all(...params) as InvoiceRowJoined[];
    return json({ invoices: rows.map(toInvoice) });
  }

  if (pathname === "/api/invoices" && method === "POST") {
    const deniedWrite = denyTabWrite(auth, "finance");
    if (deniedWrite) return deniedWrite;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = parseInvoiceFields(body);
    if (!v.ok) return err(v.error, 400);
    if (v.value.amount === undefined) return err("Amount is required.", 400);
    const clientId = v.value.clientId ?? null;
    if (clientId !== null) {
      const bad = ensureClientExists(clientId, orgId);
      if (bad) return bad;
    }
    const info = db
      .query(
        `INSERT INTO invoices (org_id, client_id, amount, status, due_date, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        clientId,
        v.value.amount,
        v.value.status ?? "draft",
        v.value.dueDate ?? "",
        v.value.notes ?? "",
      );
    const invoice = fetchInvoice(Number(info.lastInsertRowid), orgId);
    return json({ invoice }, 201);
  }

  /* Invoice item */
  const invoiceMatch = pathname.match(/^\/api\/invoices\/(\d+)$/);

  if (invoiceMatch) {
    const id = Number(invoiceMatch[1]);
    const find = () => db.query("SELECT * FROM invoices WHERE id = ? AND org_id = ?").get(id, orgId) as InvoiceRow | null;

    if (method === "PUT") {
      const deniedWrite = denyTabWrite(auth, "finance");
      if (deniedWrite) return deniedWrite;
      const row = find();
      if (!row) return err("Invoice not found.", 404);
      const body = await readBody(req);
      if (!body) return err("Invalid JSON body.", 400);
      const v = parseInvoiceFields(body);
      if (!v.ok) return err(v.error, 400);
      const f = v.value;
      if (f.clientId !== undefined && f.clientId !== null) {
        const bad = ensureClientExists(f.clientId, orgId);
        if (bad) return bad;
      }
      db.query(
        `UPDATE invoices SET
           client_id = ?, amount = ?, status = ?, due_date = ?, notes = ?,
           updated_at = datetime('now')
         WHERE id = ? AND org_id = ?`,
      ).run(
        f.clientId !== undefined ? f.clientId : row.client_id,
        f.amount ?? row.amount,
        f.status ?? row.status,
        f.dueDate ?? row.due_date,
        f.notes ?? row.notes,
        id,
        orgId,
      );
      return json({ invoice: fetchInvoice(id, orgId) });
    }

    if (method === "DELETE") {
      const deniedWrite = denyTabWrite(auth, "finance");
      if (deniedWrite) return deniedWrite;
      const row = find();
      if (!row) return err("Invoice not found.", 404);
      db.query("DELETE FROM invoices WHERE id = ? AND org_id = ?").run(id, orgId);
      return json({ ok: true });
    }

    return err("Method not allowed.", 405);
  }

  /* Support tickets (owner direction 2026-08-15) — POST + GET are open to
     owner AND tenant (each creates/reads their OWN org's tickets; the owner
     additionally sees every org's with the submitting org name joined in).
     PATCH is OWNER-only: tenants are rejected server-side (403), so a client
     can never change their own ticket's status/priority or anyone else's. */
  if (pathname === "/api/tickets" && method === "GET") {
    const deniedRead = denyTabRead(auth, "support");
    if (deniedRead) return deniedRead;
    if (isOwnerSession(auth)) {
      /* Owner: every org's tickets, newest first, with the org name joined. */
      const rows = db
        .query(
          `${TICKET_SELECT}
           ORDER BY CASE t.status
                      WHEN 'OPEN' THEN 0
                      WHEN 'IN_PROGRESS' THEN 1
                      WHEN 'RESOLVED' THEN 2
                      ELSE 3 END ASC,
                    t.created_at DESC, t.id DESC`,
        )
        .all() as TicketRowJoined[];
      return json({ tickets: rows.map((r) => toTicket(r, true)) });
    }
    const rows = db
      .query(
        `${TICKET_SELECT}
         WHERE t.org_id = ?
         ORDER BY CASE t.status
                    WHEN 'OPEN' THEN 0
                    WHEN 'IN_PROGRESS' THEN 1
                    WHEN 'RESOLVED' THEN 2
                    ELSE 3 END ASC,
                  t.created_at DESC, t.id DESC`,
      )
      .all(orgId) as TicketRowJoined[];
    return json({ tickets: rows.map((r) => toTicket(r, false)) });
  }

  if (pathname === "/api/tickets" && method === "POST") {
    const deniedWrite = denyTabWrite(auth, "support");
    if (deniedWrite) return deniedWrite;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = parseTicketFields(body);
    if (!v.ok) return err(v.error, 400);
    if (!v.value.subject) return err("Subject is required.", 400);
    if (!v.value.message) return err("Message is required.", 400);
    const info = db
      .query(
        `INSERT INTO tickets (org_id, subject, message, status, priority)
         VALUES (?, ?, ?, 'OPEN', ?)`,
      )
      .run(
        orgId, // always the caller's session org — a tenant cannot spoof another org
        v.value.subject,
        v.value.message,
        v.value.priority ?? "NORMAL",
      );
    const row = db
      .query(`${TICKET_SELECT} WHERE t.id = ? AND t.org_id = ?`)
      .get(Number(info.lastInsertRowid), orgId) as TicketRowJoined;
    return json({ ticket: toTicket(row, isOwnerSession(auth)) }, 201);
  }

  const ticketMatch = pathname.match(/^\/api\/tickets\/(\d+)$/);
  if (ticketMatch && method === "PATCH") {
    const admin = requireAdmin(req); // OWNER only — tenants get 403
    if (admin instanceof Response) return admin;
    const id = Number(ticketMatch[1]);
    const row = db.query("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow | null;
    if (!row) return err("Ticket not found.", 404);
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = parseTicketFields(body);
    if (!v.ok) return err(v.error, 400);
    const f = v.value;
    if (f.status === undefined && f.priority === undefined) {
      return err("Nothing to update — send status and/or priority.", 400);
    }
    db.query(
      `UPDATE tickets SET
         status = ?, priority = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      f.status ?? row.status,
      f.priority ?? row.priority,
      id,
    );
    const updated = db.query(`${TICKET_SELECT} WHERE t.id = ?`).get(id) as TicketRowJoined | null;
    return json({ ticket: toTicket(updated as TicketRowJoined, true) });
  }

  /* Team users per client account (owner request 2026-08-14) — org-scoped
     member management. ALL FOUR routes are admin-only (requireOrgAdmin: the
     account's original owner login or a role='admin' team member); a
     restricted member gets 403. The org ALWAYS comes from the session — a
     body orgId is ignored, so there is no cross-org addressing. Password
     material is write-only: it is accepted on create/PATCH and hashed, never
     returned. */
  if (pathname === "/api/org/members" && method === "GET") {
    const deniedOrgAdmin = requireOrgAdmin(auth);
    if (deniedOrgAdmin) return deniedOrgAdmin;
    const rows = db
      .query(`SELECT ${MEMBER_SELECT} WHERE org_id = ? ORDER BY id ASC`)
      .all(auth.orgId) as OrgMemberRow[];
    return json({ members: rows.map(toOrgMember) });
  }

  if (pathname === "/api/org/members" && method === "POST") {
    const deniedOrgAdmin = requireOrgAdmin(auth);
    if (deniedOrgAdmin) return deniedOrgAdmin;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role;
    if (!email) return err("Member email is required.", 400);
    if (email.length > 254) return err("Email must be under 254 characters.", 400);
    if (!EMAIL_RE.test(email)) return err("Enter a valid email address.", 400);
    if (!password) return err("Password is required.", 400);
    if (password.length < 8) return err("Password must be at least 8 characters.", 400);
    if (role !== "admin" && role !== "member") return err("Role must be admin or member.", 400);
    const taken = db.query("SELECT id FROM users WHERE email = ?").get(email);
    if (taken) return err("An account with this email already exists.", 400);
    const hash = await hashPassword(password);
    // New admins bypass permissions (stored {}). New restricted members:
    // HONOR the admin's per-tab choices from the request — the Settings UI
    // sends the full permission map on create (absent tab = no access, so a
    // member created without settings access can never read settings, export
    // org data, etc.). Only when the body sends NO permissions at all do we
    // fall back to the historical default (every tab present, all view-only).
    let permissionsJson: string;
    if (role === "member") {
      if (body.permissions !== undefined) {
        const v = validatePermissions(body.permissions);
        if (!v.ok) return err(v.error, 400);
        permissionsJson = JSON.stringify(v.value);
      } else {
        permissionsJson = JSON.stringify({
          clients: { edit: false },
          tasks: { edit: false },
          finance: { edit: false },
          settings: { edit: false },
          support: { edit: false },
        });
      }
    } else {
      permissionsJson = "{}";
    }
    const info = db
      .query(`INSERT INTO users (email, password_hash, org_id, role, permissions) VALUES (?, ?, ?, ?, ?)`)
      .run(email, hash, auth.orgId, role as Role, permissionsJson);
    const row = db
      .query(`SELECT ${MEMBER_SELECT} WHERE id = ?`)
      .get(Number(info.lastInsertRowid)) as OrgMemberRow;
    return json({ member: toOrgMember(row) }, 201);
  }

  const memberMatch = pathname.match(/^\/api\/org\/members\/(\d+)$/);
  if (memberMatch) {
    const id = Number(memberMatch[1]);
    const find = () =>
      db
        .query(`SELECT ${MEMBER_SELECT} WHERE id = ? AND org_id = ?`)
        .get(id, auth.orgId) as OrgMemberRow | null;

    if (method === "PATCH") {
      const deniedOrgAdmin = requireOrgAdmin(auth);
      if (deniedOrgAdmin) return deniedOrgAdmin;
      const row = find();
      if (!row) return err("Member not found.", 404);
      const body = await readBody(req);
      if (!body) return err("Invalid JSON body.", 400);
      const sets: string[] = [];
      const params: (string | number)[] = [];

      if (body.password !== undefined) {
        const p = typeof body.password === "string" ? body.password : "";
        if (!p) return err("Password is required.", 400);
        if (p.length < 8) return err("Password must be at least 8 characters.", 400);
        const hash = await hashPassword(p);
        sets.push("password_hash = ?");
        params.push(hash);
      }

      if (body.role !== undefined) {
        if (body.role !== "admin" && body.role !== "member") {
          return err("Role must be admin or member.", 400);
        }
        // Last-admin protection: the org's only admin cannot be demoted.
        if (body.role === "member" && row.role === "admin" && orgAdminCount(auth.orgId) <= 1) {
          return err("Cannot demote the org's last admin.", 400);
        }
        sets.push("role = ?");
        params.push(body.role);
      }

      if (body.permissions !== undefined) {
        const v = validatePermissions(body.permissions);
        if (!v.ok) return err(v.error, 400);
        sets.push("permissions = ?");
        params.push(JSON.stringify(v.value));
      }

      if (sets.length === 0) return err("Nothing to update.", 400);
      params.push(id, auth.orgId);
      db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`).run(...params);
      const updated = find();
      return json({ member: toOrgMember(updated as OrgMemberRow) });
    }

    if (method === "DELETE") {
      const deniedOrgAdmin = requireOrgAdmin(auth);
      if (deniedOrgAdmin) return deniedOrgAdmin;
      const row = find();
      if (!row) return err("Member not found.", 404);
      // Last-admin protection: the org's only admin cannot be removed.
      const targetIsAdmin =
        row.role === "admin" || (isOrgAdmin({ userId: row.id, orgId: auth.orgId, role: row.role }));
      if (targetIsAdmin && orgAdminCount(auth.orgId) <= 1) {
        return err("Cannot remove the org's last admin.", 400);
      }
      db.transaction(() => {
        db.query("DELETE FROM password_resets WHERE user_id = ?").run(id);
        db.query("DELETE FROM users WHERE id = ? AND org_id = ?").run(id, auth.orgId);
      })();
      return json({ ok: true });
    }

    return err("Method not allowed.", 405);
  }

  return err("Not found.", 404);
}

function sessionCookie(token: string): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}${secure}`;
}

export { handleApi };
