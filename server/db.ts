import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Default pipeline stages — every org starts here (Revzenta keeps them;
 * Phase 3a lets each tenant rename/reorder its own via Settings, stored as a
 * JSON array in orgs.stages). A client's `stage` is a plain string, so the
 * stored value follows whatever the tenant's current stage list says.
 */
export const DEFAULT_STAGES = [
  "Prospect",
  "Intake",
  "Kickoff",
  "Build",
  "Launch",
  "Retainer",
] as const;
export type Stage = string;

/** The brand accent every org defaults to (hex). Tenants can restyle via Settings. */
export const DEFAULT_ACCENT = "#d6ff3f";

/* ── Adaptive intake Phase 1: account-level vertical config ────────────
 * Set once per CRM account in Settings; drives which conditional field
 * groups the adaptive intake form (Phase 2) may show. */
export const SERVICE_MODELS = ["residential_only", "commercial_only", "both"] as const;
export type ServiceModel = (typeof SERVICE_MODELS)[number];

export const DELIVERY_TYPES = ["client_comes", "we_go", "both"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

/** '' = unspecified (rendered as "Other" in the UI). */
export const INDUSTRIES = ["home_services", "mobile_personal", "professional", "other", ""] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Adaptive intake Phase 3 — custom conditional field groups. A tenant (any
 *  industry, especially "other") defines its OWN intake groups in Settings:
 *  a group has a name, which client type(s) it applies to, an enabled flag,
 *  and an ordered list of fields (key / label / kind text|yesno|select, with
 *  options for select). Stored as a JSON array on orgs.custom_intake_groups;
 *  the adaptive modal renders the org's ENABLED groups whose appliesTo
 *  matches the client type being filled in. */
export const INTAKE_GROUP_APPLIES_TO = ["commercial", "individual", "both"] as const;
export type IntakeGroupAppliesTo = (typeof INTAKE_GROUP_APPLIES_TO)[number];

export const INTAKE_GROUP_FIELD_KINDS = ["text", "yesno", "select"] as const;
export type IntakeGroupFieldKind = (typeof INTAKE_GROUP_FIELD_KINDS)[number];

export function isIntakeGroupAppliesTo(v: unknown): v is IntakeGroupAppliesTo {
  return typeof v === "string" && (INTAKE_GROUP_APPLIES_TO as readonly string[]).includes(v);
}
export function isIntakeGroupFieldKind(v: unknown): v is IntakeGroupFieldKind {
  return typeof v === "string" && (INTAKE_GROUP_FIELD_KINDS as readonly string[]).includes(v);
}

/** A field inside a custom intake group (Phase 3). `key` is the stable,
 *  snake_case identifier values are stored under (in clients.custom_fields,
 *  as {name: key, value} — the same array the Settings custom fields use);
 *  `label` is the display text; select fields carry their `options`. */
export interface CustomIntakeField {
  key: string;
  label: string;
  kind: IntakeGroupFieldKind;
  options?: string[];
}

/** A tenant-defined custom intake group (Phase 3). */
export interface CustomIntakeGroup {
  id: string;
  name: string;
  appliesTo: IntakeGroupAppliesTo;
  enabled: boolean;
  fields: CustomIntakeField[];
}

/** Parse an org's stored custom-intake-group JSON → clean list of groups.
 *  Defensive: drops malformed groups/fields, falls back to [] on anything
 *  unusable ('' and '[]' both mean "no custom groups"). */
export function parseCustomIntakeGroups(raw: string | null | undefined): CustomIntakeGroup[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CustomIntakeGroup[] = [];
    for (const g of parsed) {
      if (g === null || typeof g !== "object" || Array.isArray(g)) continue;
      const obj = g as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id.trim() : "";
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const appliesTo = obj.appliesTo;
      const enabled = obj.enabled === true;
      const fieldsRaw = obj.fields;
      if (!id || !name || !isIntakeGroupAppliesTo(appliesTo) || !Array.isArray(fieldsRaw)) continue;
      const fields: CustomIntakeField[] = [];
      for (const f of fieldsRaw) {
        if (f === null || typeof f !== "object" || Array.isArray(f)) continue;
        const fo = f as Record<string, unknown>;
        const key = typeof fo.key === "string" ? fo.key.trim() : "";
        const label = typeof fo.label === "string" ? fo.label.trim() : "";
        const kind = fo.kind;
        if (!key || !label || !isIntakeGroupFieldKind(kind)) continue;
        let options: string[] | undefined;
        if (kind === "select" && Array.isArray(fo.options)) {
          options = fo.options.filter((o): o is string => typeof o === "string" && o.trim() !== "");
          if (options.length === 0) continue; // select needs options
        }
        fields.push({ key, label, kind, ...(options ? { options } : {}) });
      }
      if (fields.length === 0) continue;
      out.push({ id, name, appliesTo, enabled, fields });
    }
    return out;
  } catch {
    return [];
  }
}

/** Optional (➖ in the spec's Step 4 table) intake groups a tenant can
 *  enable/disable — stored as a JSON array on orgs.intake_opts. */
export const INTAKE_OPT_GROUPS = [
  "business_llc_tab",
  "hoa_restrictions",
  "pet_on_premises",
  "parking_access",
] as const;
export type IntakeOptGroup = (typeof INTAKE_OPT_GROUPS)[number];

export function isServiceModel(v: unknown): v is ServiceModel {
  return typeof v === "string" && (SERVICE_MODELS as readonly string[]).includes(v);
}
export function isDeliveryType(v: unknown): v is DeliveryType {
  return typeof v === "string" && (DELIVERY_TYPES as readonly string[]).includes(v);
}
export function isIndustry(v: unknown): v is Industry {
  return typeof v === "string" && (INDUSTRIES as readonly string[]).includes(v);
}
export function isIntakeOptGroup(v: unknown): v is IntakeOptGroup {
  return typeof v === "string" && (INTAKE_OPT_GROUPS as readonly string[]).includes(v);
}

/** Parse an org's stored intake_opts JSON → clean list of enabled optional
 *  groups. Defensive: drops unknown ids and duplicates, falls back to [] on
 *  anything unusable ('' and '[]' both mean "none enabled"). */
export function parseIntakeOpts(raw: string | null | undefined): IntakeOptGroup[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: IntakeOptGroup[] = [];
    const seen = new Set<string>();
    for (const g of parsed) {
      if (typeof g !== "string" || !isIntakeOptGroup(g)) continue;
      if (seen.has(g)) continue;
      seen.add(g);
      out.push(g);
    }
    return out;
  } catch {
    return [];
  }
}

/** Parse an org's stored stages JSON → ordered list of trimmed names.
 *  Falls back to the default list on anything malformed or empty. */
export function parseStages(raw: string | null | undefined): string[] {
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((s) => typeof s === "string" && s.trim().length > 0)
      ) {
        return parsed.map((s) => (s as string).trim());
      }
    } catch {
      /* fall through to default */
    }
  }
  return [...DEFAULT_STAGES];
}

export const INVOICE_STATUSES = ["draft", "sent", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isInvoiceStatus(v: unknown): v is InvoiceStatus {
  return typeof v === "string" && (INVOICE_STATUSES as readonly string[]).includes(v);
}

/** Multi-tenancy role (Phase 1): admin = agency/owner (cross-org access is
 *  Phase 2 — for now admin behaves like member inside their own org). */
export type Role = "admin" | "member";

/* ── Team users per client account (owner request 2026-08-14) ────────────
 * A client account (tenant org) has an org admin — the account's original
 * owner login (every existing single-user account automatically treats its
 * user as admin; no stored-role migration) plus any role='admin' team
 * member — and can add/remove TEAM MEMBERS. A restricted member (role=
 * 'member') is granted PER-TAB access: which tenant tabs they can open, and
 * per tab a mode (view-only vs can-edit). The Dashboard is always visible to
 * every member (it is their own org's money overview); tenants never see
 * "Leads" (owner-only).
 *
 * users.permissions stores a JSON object keyed by tenant tab → {edit: bool}.
 * A member whose tab is ABSENT from the object has no access to that tab;
 * {edit:false} = view-only; {edit:true} = can edit. Org admins (role='admin'
 * and the org's original owner login) bypass permissions entirely. */
export const TENANT_TABS = ["clients", "tasks", "finance", "settings", "support"] as const;
export type TenantTab = (typeof TENANT_TABS)[number];

export interface TabPermission {
  edit: boolean;
}
export type TabPermissions = Partial<Record<TenantTab, TabPermission>>;

export function isTenantTab(v: unknown): v is TenantTab {
  return typeof v === "string" && (TENANT_TABS as readonly string[]).includes(v);
}

/** Parse a user's stored permissions JSON → clean object. Defensive: drops
 *  unknown tabs and malformed entries, falls back to {} on anything unusable
 *  ('' and '{}' both mean "no tab access" for a restricted member). */
export function parsePermissions(raw: string | null | undefined): TabPermissions {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TabPermissions = {};
    for (const tab of TENANT_TABS) {
      const p = (parsed as Record<string, unknown>)[tab];
      if (p === null || typeof p !== "object" || Array.isArray(p)) continue;
      const edit = (p as Record<string, unknown>).edit;
      if (typeof edit === "boolean") out[tab] = { edit };
    }
    return out;
  } catch {
    return {};
  }
}

export const DEFAULT_ORG_NAME = "Revzenta";

/** Branding rename (2026-08-18): the product renamed from "Elevate Studio" to
 *  "Revzenta" (owner-locked name + domain 2026-08-18). This constant is
 *  HISTORICAL ONLY — it lets the boot-time backfill (backfillBrandRename in
 *  agreements.ts) find and rename the legacy owner org, and lets
 *  ensureDefaultOrg() self-heal if the backfill is ever skipped. Nothing new
 *  is ever created with this name. */
export const LEGACY_ORG_NAME = "Elevate Studio";

/** The custom-field value types a tenant can define (Phase 3b; 3f-1 adds
 *  "select" for vertical templates — a dropdown with options). */
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "checkbox", "select"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export function isCustomFieldType(v: unknown): v is CustomFieldType {
  return typeof v === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(v);
}

/** A tenant's custom-field DEFINITION (orgs.custom_fields entry): the field's
 *  display name and its value type. Tenants define these in Settings; vertical
 *  templates (3f-1) seed them per business type. `options` is required for
 *  type "select" (the dropdown choices rendered in the client form). */
export interface CustomFieldDef {
  name: string;
  type: CustomFieldType;
  options?: string[];
}

/** A client's stored custom-field VALUE: the field name (must match one of the
 *  tenant's definitions — enforced server-side) and its value as a string. */
export interface CustomField {
  name: string;
  value: string;
}

/** Parse an org's stored custom-field definitions JSON → clean list of
 *  {name, type}. Defensive: drops malformed entries and case-insensitive
 *  duplicates (keeps the first), falls back to [] on anything unusable. */
export function parseCustomFields(raw: string | null | undefined): CustomFieldDef[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CustomFieldDef[] = [];
    const seen = new Set<string>();
    for (const f of parsed) {
      if (f === null || typeof f !== "object" || Array.isArray(f)) continue;
      const obj = f as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      if (!name || name.length > 50) continue;
      const type = obj.type;
      if (!isCustomFieldType(type)) continue;
      // 3f-1: select fields carry their options (stored alongside the def).
      let options: string[] | undefined;
      if (type === "select") {
        if (!Array.isArray(obj.options)) continue; // malformed select — drop
        const opts = obj.options
          .filter((o): o is string => typeof o === "string" && o.trim() !== "")
          .map((o) => o.trim().slice(0, 100));
        if (opts.length === 0) continue; // select with no options is unusable
        options = opts;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, type, ...(options ? { options } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

/** Data dir: $DATA_DIR env, else ./data next to the server directory.
 *  Exported so the native e-signature module (server/agreements.ts) can store
 *  generated agreement PDFs alongside the DB in the same persistent volume. */
export const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "crm.db"));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 3000");

db.exec(`
  CREATE TABLE IF NOT EXISTS orgs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    org_id         INTEGER NOT NULL REFERENCES orgs(id),
    role           TEXT NOT NULL DEFAULT 'member',
    permissions    TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    first_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS clients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES orgs(id),
    company_name TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    phone        TEXT NOT NULL DEFAULT '',
    industry     TEXT NOT NULL DEFAULT '',
    services     TEXT NOT NULL DEFAULT '[]',
    custom_fields TEXT NOT NULL DEFAULT '[]',
    deal_value   REAL NOT NULL DEFAULT 0,
    stage        TEXT NOT NULL DEFAULT 'Prospect',
    next_action  TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    archived     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL REFERENCES orgs(id),
    title      TEXT NOT NULL,
    client_id  INTEGER,
    due_date   TEXT NOT NULL DEFAULT '',
    done       INTEGER NOT NULL DEFAULT 0,
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL REFERENCES orgs(id),
    client_id  INTEGER,
    amount     REAL NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'draft',
    due_date   TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_clients_stage     ON clients(stage);
  CREATE INDEX IF NOT EXISTS idx_clients_updated   ON clients(updated_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_done        ON tasks(done);
  CREATE INDEX IF NOT EXISTS idx_tasks_client_id   ON tasks(client_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);

  -- Appointments / demo-call scheduling (owner 2026-08-20 sales rework).
  -- The owner's "Schedule demo call" button turns a lead into a demo-call
  -- appointment: a time is set on the owner's calendar (this table) and a
  -- confirmation email goes to the lead. org_id is the caller's org at
  -- create time (row-level isolation, like tickets); client_id OPTIONALLY
  -- links to a client/lead record in the SAME org (FK ON DELETE SET NULL —
  -- deleting the lead keeps the appointment, unlinked). scheduled_at stores a
  -- local "YYYY-MM-DDTHH:MM" datetime string ('' = not scheduled yet);
  -- duration is minutes. status flows scheduled → confirmed → held |
  -- cancelled (a scheduled demo the lead confirms advances to confirmed; the
  -- owner records held after it happens, cancelled for a no-show).
  CREATE TABLE IF NOT EXISTS appointments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id       INTEGER NOT NULL REFERENCES orgs(id),
    client_id    INTEGER,
    title        TEXT NOT NULL,
    scheduled_at TEXT NOT NULL DEFAULT '',
    duration     INTEGER NOT NULL DEFAULT 30,
    status       TEXT NOT NULL DEFAULT 'scheduled',
    notes        TEXT NOT NULL DEFAULT '',
    -- Appointments production (backlog 5a104eae): an unguessable public
    -- token mints when the appointment is created so the emailed reminder's
    -- Confirm / Reschedule links can act on this row WITHOUT a session
    -- (the link is the credential, same as the agreement /sign token).
    token        TEXT NOT NULL DEFAULT '',
    -- Day-before reminder (automation roadmap): 1 once the "appointment
    -- tomorrow" reminder email has been sent for this row, so the lazy
    -- reminder sweep (run on appointment list reads) never re-sends.
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_appointments_org_scheduled ON appointments(org_id, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_appointments_org_client    ON appointments(org_id, client_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_org_status    ON appointments(org_id, status);
  -- Appointments production (backlog 5a104eae): add the new columns to
  -- databases created BEFORE this migration (the CREATE TABLE above only
  -- covers fresh DBs). Idempotent -- safe on every boot.
  {
    const acols = db.query("PRAGMA table_info(appointments)").all() as { name: string }[];
    const addACol = (name: string, ddl: string) => {
      if (!acols.some((c) => c.name === name)) db.exec(`ALTER TABLE appointments ADD COLUMN ${ddl}`);
    };
    addACol("token", "token TEXT NOT NULL DEFAULT ''");
    addACol("reminder_sent", "reminder_sent INTEGER NOT NULL DEFAULT 0");
  }

  -- 3g-3: owner's dismissible "auto-provisioned from sold lead" notifications.
  CREATE TABLE IF NOT EXISTS provision_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     INTEGER NOT NULL,
    source_org_id INTEGER NOT NULL,
    new_org_id    INTEGER NOT NULL,
    client_name   TEXT NOT NULL,
    org_name      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    dismissed     INTEGER NOT NULL DEFAULT 0
  );

  -- 3k: password reset tokens (forgot-password flow). Only the SHA-256 hash
  -- of a token is ever stored — never the raw token. expires_at is an epoch
  -- millisecond INTEGER (compared against Date.now(), avoiding SQLite's
  -- text-datetime lexicographic quirks); used_at marks a redeemed (single-use)
  -- token. Tokens bind to a specific user (and through them a specific org),
  -- so redemption can never cross tenant boundaries.
  CREATE TABLE IF NOT EXISTS password_resets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);

  -- Support tickets (owner direction 2026-08-15). Clients experiencing issues
  -- submit tickets from their own workspace; the owner sees every account's
  -- tickets and works them to resolution. org_id is the SUBMITTING account
  -- (the caller's org at create time, never spoofable). status flows
  -- OPEN, IN_PROGRESS, RESOLVED, CLOSED (the owner moves it; default OPEN);
  -- priority is LOW | NORMAL | HIGH (optional, default NORMAL).
  CREATE TABLE IF NOT EXISTS tickets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL REFERENCES orgs(id),
    subject    TEXT NOT NULL,
    message    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'OPEN',
    priority   TEXT NOT NULL DEFAULT 'NORMAL',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_org_status ON tickets(org_id, status);
  -- Native in-app e-signature (owner direction 2026-08-15; backlog dd37c973) —
  -- replaces the manual agreement-status tracker with a real internal signer.
  -- One row per sent agreement (re-sending REPLACES the client's envelope).
  -- Only the RAW token hash is ever stored (SHA-256, like password_resets);
  -- the raw token exists only in the emailed sign link. status flows
  -- sent → delivered (sign page first opened) → signed | declined (one-time
  -- action on the public page). expires_at is epoch-ms (Date.now()).
  -- signer_name / signed_at / ip_address / consent are the audit trail the
  -- owner views from the Onboarding tab. pdf_id names the generated PDF file
  -- in <data dir>/agreements/ (unguessable random id); agreement_text is the
  -- fully-rendered template text the sign page + PDF were built from.
  CREATE TABLE IF NOT EXISTS agreement_envelopes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    org_id         INTEGER NOT NULL REFERENCES orgs(id),
    token_hash     TEXT NOT NULL UNIQUE,
    expires_at     INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'sent',
    pdf_id         TEXT NOT NULL,
    agreement_text TEXT NOT NULL DEFAULT '',
    signer_name    TEXT NOT NULL DEFAULT '',
    signed_at      TEXT,
    ip_address     TEXT NOT NULL DEFAULT '',
    consent        INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agreement_envelopes_client ON agreement_envelopes(client_id);
  CREATE INDEX IF NOT EXISTS idx_agreement_envelopes_token ON agreement_envelopes(token_hash);
`);

/**
 * Team-users migration (owner request 2026-08-14). Idempotent — safe on every
 * boot.
 *
 * users.permissions stores the per-tab access grants for a RESTRICTED member
 * (role='member') as a JSON object keyed by tenant tab → {edit: bool}
 * (clients | tasks | finance | settings | support). Absent tab = no access;
 * {edit:false} = view-only. Admins (role='admin' and the org's original owner
 * login) bypass permissions entirely, so the '{}' default is exactly right for
 * them. Plain TEXT with a DEFAULT, so existing rows backfill cleanly and no FK
 * games are needed (the same pattern the Phase 3e migration uses).
 */
{
  const cols = db.query("PRAGMA table_info(users)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "permissions")) {
    db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'");
  }
}

// Simple migration for databases created before custom_fields existed:
// add the column if it's missing (SQLite has no ADD COLUMN IF NOT EXISTS).
{
  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "custom_fields")) {
    db.exec("ALTER TABLE clients ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '[]'");
  }
}

/**
 * Multi-tenancy migration (Phase 1). Idempotent — safe to run on every boot.
 *
 * For a database created before orgs/org_id existed:
 *   1. creates the default org ("Revzenta") if none exists;
 *   2. adds users.org_id + users.role and assigns every existing user to the
 *      default org as an `admin` (they were all single-tenant admins before);
 *   3. adds org_id to clients/tasks/invoices and backfills every existing row
 *      into the default org;
 *   4. creates org-scoped indexes.
 *
 * SQLite quirk: a column with a REFERENCES clause and a non-NULL default can
 * only be added while foreign-key enforcement is OFF, so the ALTERs toggle
 * `PRAGMA foreign_keys` around them. Rows are backfilled to a real org id
 * before enforcement is re-enabled, so the data never violates the FK.
 */
{
  const orgRow = db
    .query("SELECT id FROM orgs WHERE name = ? ORDER BY id LIMIT 1")
    .get(DEFAULT_ORG_NAME) as { id: number } | null;
  const defaultOrgId = orgRow
    ? orgRow.id
    : Number(db.query("INSERT INTO orgs (name) VALUES (?)").run(DEFAULT_ORG_NAME).lastInsertRowid);

  const userCols = db.query("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "org_id")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("ALTER TABLE users ADD COLUMN org_id INTEGER NOT NULL DEFAULT 0 REFERENCES orgs(id)");
    db.exec("PRAGMA foreign_keys = ON");
  }
  if (!userCols.some((c) => c.name === "role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  }
  // 3g-4: durable "has this member logged in before" marker — NULL until the
  // member's first successful password login sets it (never by impersonation,
  // which swaps sessions without one). Drives the one-time welcome email.
  // Additive + idempotent — safe on every boot.
  if (!userCols.some((c) => c.name === "first_login_at")) {
    db.exec("ALTER TABLE users ADD COLUMN first_login_at TEXT");
  }
  // Pre-existing users were single-tenant admins — they all belong to the
  // default org as admins. Runs once (only rows still at org_id 0).
  db.query("UPDATE users SET org_id = ?, role = 'admin' WHERE org_id = 0").run(defaultOrgId);

  for (const table of ["clients", "tasks", "invoices"] as const) {
    const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "org_id")) {
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(`ALTER TABLE ${table} ADD COLUMN org_id INTEGER NOT NULL DEFAULT 0 REFERENCES orgs(id)`);
      db.exec("PRAGMA foreign_keys = ON");
      // Backfill existing rows into the default org (only rows still at 0).
      db.exec(`UPDATE ${table} SET org_id = ${defaultOrgId} WHERE org_id = 0`);
    }
  }

  // Org-scoped indexes — created here (after the ALTERs) so they work on both
  // fresh and migrated databases.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_clients_org_stage    ON clients(org_id, stage);
    CREATE INDEX IF NOT EXISTS idx_clients_org_updated  ON clients(org_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_org_done       ON tasks(org_id, done);
    CREATE INDEX IF NOT EXISTS idx_tasks_org_client     ON tasks(org_id, client_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_org_status  ON invoices(org_id, status);
    CREATE INDEX IF NOT EXISTS idx_invoices_org_client  ON invoices(org_id, client_id);
  `);
}

/**
 * Per-tenant settings migration (Phase 3a). Idempotent — safe on every boot.
 * Adds orgs.stages (JSON array of pipeline stage names — backfilled to the
 * default list for existing orgs so every tenant starts from the same
 * pipeline) and orgs.accent_color (hex string for the tenant's brand accent).
 * Both are plain TEXT columns with DEFAULTs, so no FK games are needed.
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  if (!orgCols.some((c) => c.name === "stages")) {
    db.exec(
      `ALTER TABLE orgs ADD COLUMN stages TEXT NOT NULL DEFAULT '${JSON.stringify(DEFAULT_STAGES)}'`,
    );
  }
  if (!orgCols.some((c) => c.name === "accent_color")) {
    db.exec(`ALTER TABLE orgs ADD COLUMN accent_color TEXT NOT NULL DEFAULT '${DEFAULT_ACCENT}'`);
  }
}

/**
 * Per-tenant custom fields migration (Phase 3b). Idempotent — safe on every
 * boot. Adds orgs.custom_fields (JSON array of {name, type} — the fields the
 * tenant defines in Settings and that show up on every client). Default `[]`
 * for all orgs, so tenants that never touch it keep the exact client shape
 * they had before.
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  if (!orgCols.some((c) => c.name === "custom_fields")) {
    db.exec(`ALTER TABLE orgs ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '[]'`);
  }
}

/**
 * Rich client records migration (Phase 3e). Idempotent — safe on every boot.
 * Adds the Commercial/Residential type (client_type) plus the full address
 * block, website and lead source to clients. All are plain TEXT columns with
 * DEFAULTs, so no FK games are needed. Existing clients backfill to
 * 'residential' via the ALTER's DEFAULT, and the new text fields default to ''
 * for every row.
 */
{
  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  const addCol = (name: string, ddl: string) => {
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${ddl}`);
    }
  };
  addCol("client_type", "client_type TEXT NOT NULL DEFAULT 'residential'");
  addCol("address", "address TEXT NOT NULL DEFAULT ''");
  addCol("city", "city TEXT NOT NULL DEFAULT ''");
  addCol("state", "state TEXT NOT NULL DEFAULT ''");
  addCol("zip", "zip TEXT NOT NULL DEFAULT ''");
  addCol("website", "website TEXT NOT NULL DEFAULT ''");
  addCol("lead_source", "lead_source TEXT NOT NULL DEFAULT ''");
}

/**
 * Adaptive intake Phase 1 migration (owner spec 2026-08-13). Idempotent —
 * safe on every boot.
 *
 * orgs gains the account-level vertical config that drives intake field
 * visibility (Phase 2 rules engine):
 *   service_model  residential_only | commercial_only | both
 *   delivery_type  client_comes | we_go | both
 *   industry       home_services | mobile_personal | professional | other | ''
 *   intake_opts    JSON array of enabled optional (➖) intake groups
 *                  (business_llc_tab, hoa_restrictions, pet_on_premises,
 *                  parking_access)
 *
 * clients gains the optional intake/billing columns from the spec. All are
 * plain TEXT/INTEGER with DEFAULTs, so existing rows backfill cleanly and no
 * FK games are needed.
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  const addOrgCol = (name: string, ddl: string) => {
    if (!orgCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE orgs ADD COLUMN ${ddl}`);
    }
  };
  addOrgCol("service_model", "service_model TEXT NOT NULL DEFAULT 'both'");
  addOrgCol("delivery_type", "delivery_type TEXT NOT NULL DEFAULT 'both'");
  addOrgCol("industry", "industry TEXT NOT NULL DEFAULT ''");
  addOrgCol("intake_opts", "intake_opts TEXT NOT NULL DEFAULT '[]'");

  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  const addCol = (name: string, ddl: string) => {
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${ddl}`);
    }
  };
  // Billing block
  addCol("billing_address", "billing_address TEXT NOT NULL DEFAULT ''");
  addCol("billing_city", "billing_city TEXT NOT NULL DEFAULT ''");
  addCol("billing_state", "billing_state TEXT NOT NULL DEFAULT ''");
  addCol("billing_zip", "billing_zip TEXT NOT NULL DEFAULT ''");
  addCol("billing_same", "billing_same INTEGER NOT NULL DEFAULT 0");
  // Intake block
  addCol("preferred_contact_method", "preferred_contact_method TEXT NOT NULL DEFAULT ''");
  addCol("business_type", "business_type TEXT NOT NULL DEFAULT ''");
  addCol("tax_id_ein", "tax_id_ein TEXT NOT NULL DEFAULT ''");
  addCol("ap_contact", "ap_contact TEXT NOT NULL DEFAULT ''");
  addCol("po_required", "po_required INTEGER NOT NULL DEFAULT 0");
  addCol("units_locations", "units_locations TEXT NOT NULL DEFAULT ''");
  addCol("property_manager_name", "property_manager_name TEXT NOT NULL DEFAULT ''");
  addCol("property_manager_contact", "property_manager_contact TEXT NOT NULL DEFAULT ''");
  addCol("hoa_name", "hoa_name TEXT NOT NULL DEFAULT ''");
  addCol("hoa_contact", "hoa_contact TEXT NOT NULL DEFAULT ''");
  addCol("access_instructions", "access_instructions TEXT NOT NULL DEFAULT ''");
  addCol("coi_required", "coi_required INTEGER NOT NULL DEFAULT 0");
  addCol("service_contract", "service_contract TEXT NOT NULL DEFAULT ''");
  addCol("dba_name", "dba_name TEXT NOT NULL DEFAULT ''");
  addCol("ein_ssn", "ein_ssn TEXT NOT NULL DEFAULT ''");
  addCol("homeowner_renter", "homeowner_renter TEXT NOT NULL DEFAULT ''");
  addCol("hoa_restrictions", "hoa_restrictions TEXT NOT NULL DEFAULT ''");
  addCol("parking_access", "parking_access TEXT NOT NULL DEFAULT ''");
  addCol("pet_on_premises", "pet_on_premises INTEGER NOT NULL DEFAULT 0");
  addCol("preferred_service_location", "preferred_service_location TEXT NOT NULL DEFAULT ''");
}

/**
 * Adaptive intake Phase 3 migration (custom conditional field groups).
 * Idempotent — safe on every boot. Adds orgs.custom_intake_groups (JSON
 * array of {id, name, appliesTo, enabled, fields[]} — the groups a tenant
 * defines in Settings and the adaptive modal renders per its rules).
 * Default `[]` for all orgs, so existing tenants keep the exact intake form
 * they had before.
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  if (!orgCols.some((c) => c.name === "custom_intake_groups")) {
    db.exec(`ALTER TABLE orgs ADD COLUMN custom_intake_groups TEXT NOT NULL DEFAULT '[]'`);
  }
}

/**
 * Vertical templates migration (Adaptive Intake 3f-1). Idempotent — safe on
 * every boot. Adds orgs.vertical_key (the business type the owner picked at
 * account creation, e.g. "pest_control"; '' = no preset / General). Purely
 * informational + drives the Settings "Business type" display and the
 * additive "Apply vertical template" path — existing orgs keep '' (General).
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  if (!orgCols.some((c) => c.name === "vertical_key")) {
    db.exec(`ALTER TABLE orgs ADD COLUMN vertical_key TEXT NOT NULL DEFAULT ''`);
  }
}

/**
 * Sold-lead auto-provisioning migration (3g-3). Idempotent — safe on every
 * boot.
 *
 * When the OWNER moves one of their pipeline client records into the final
 * "Sold" stage, the system provisions a brand-new tenant workspace for that
 * sold client (see server/api.ts maybeAutoProvisionSoldClient). This migration
 * adds the bookkeeping that makes that safe and idempotent:
 *
 *   clients.provisioned_org_id        the new org provisioned for this sold
 *                                     client (0 = none yet) — the idempotency
 *                                     link: "one provision per client, forever"
 *   orgs.provisioned_from_client      the owner-org client id this workspace
 *                                     was auto-provisioned from (0 = not
 *                                     auto-provisioned) — drives the Admin
 *                                     list "auto-provisioned from sold lead"
 *                                     marker + source-lead name
 *   orgs.provisioned_temp_password    the plaintext temp password, visible to
 *                                     the owner ONLY via the admin orgs
 *                                     response, cleared on the member's first
 *                                     successful login
 *   provision_events                  the owner's dismissible in-app
 *                                     notification (naming the sold client +
 *                                     new workspace)
 *
 * All columns are plain INTEGER/TEXT with DEFAULTs, so existing rows backfill
 * cleanly and no FK games are needed.
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  const addOrgCol = (name: string, ddl: string) => {
    if (!orgCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE orgs ADD COLUMN ${ddl}`);
    }
  };
  addOrgCol("provisioned_from_client", "provisioned_from_client INTEGER NOT NULL DEFAULT 0");
  addOrgCol("provisioned_temp_password", "provisioned_temp_password TEXT NOT NULL DEFAULT ''");

  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "provisioned_org_id")) {
    db.exec(`ALTER TABLE clients ADD COLUMN provisioned_org_id INTEGER NOT NULL DEFAULT 0`);
  }
}

/**
 * Password-reset migration (3k, owner request). Idempotent — safe on every
 * boot.
 *
 * orgs.admin_reset_password holds the plaintext temp password generated by the
 * Admin tab's per-tenant "Reset password" action — the interim answer to
 * "client forgot their password and has no email access" (same pattern as the
 * 3g-3 provisioned_temp_password: owner-only in the Admin response, cleared on
 * the member's first successful login). A separate column keeps it from
 * colliding with the auto-provisioning display logic.
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  if (!orgCols.some((c) => c.name === "admin_reset_password")) {
    db.exec(`ALTER TABLE orgs ADD COLUMN admin_reset_password TEXT NOT NULL DEFAULT ''`);
  }
}

/**
 * MRR + vertical revenue-model migration (owner request 2026-08-14, shipped
 * 2026-08-15). Idempotent — safe on every boot.
 *
 * orgs gains the money the OWNER charges each client account:
 *   monthly_subscription_amount  REAL  — what this client pays per month (USD,
 *                                        default 0 until Phase 5 pricing)
 *   revenue_model                TEXT  — how the CLIENT'S OWN business makes
 *                                        money: "sales" (one-off jobs/invoices)
 *                                        | "subscription" (recurring book)
 * clients gains:
 *   monthly_amount               REAL  — the client's OWN subscription book:
 *                                        this record's recurring monthly
 *                                        amount (used when the org's
 *                                        revenue_model = "subscription")
 *
 * Existing orgs backfill: revenue_model derives from the org's business type
 * (vertical_key) where known — med_spa → subscription, everything else (and
 * no preset) → sales. Both columns are plain REAL/TEXT with DEFAULTs, so no FK
 * games are needed (the same pattern the 3e/3f migrations use).
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  const addOrgCol = (name: string, ddl: string) => {
    if (!orgCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE orgs ADD COLUMN ${ddl}`);
    }
  };
  addOrgCol("monthly_subscription_amount", "monthly_subscription_amount REAL NOT NULL DEFAULT 0");
  addOrgCol("revenue_model", "revenue_model TEXT NOT NULL DEFAULT 'sales'");
  // Backfill the subscription model for existing Med Spa orgs (the only
  // vertical the catalog seeds as subscription). Idempotent — a re-run only
  // touches orgs still at the 'sales' default.
  db.query("UPDATE orgs SET revenue_model = 'subscription' WHERE vertical_key = 'med_spa' AND revenue_model = 'sales'").run();

  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "monthly_amount")) {
    db.exec("ALTER TABLE clients ADD COLUMN monthly_amount REAL NOT NULL DEFAULT 0");
  }
}

/**
 * Lost-leads + DNC migration (owner request 2026-08-14, shipped 2026-08-15).
 * Idempotent — safe on every boot.
 *
 * clients gains the per-record pipeline-status flags:
 *   lost        0/1 — lead is not interested / dead (excluded from pipeline
 *                    counts/KPIs and the pipeline rows everywhere)
 *   lost_reason free text — why the lead is lost
 *   dnc         0/1 — do-not-call / do-not-contact
 *   dnc_reason  free text — why DNC was set
 *   dnc_date    YYYY-MM-DD — when DNC was set (auto-filled to today on toggle)
 *
 * All plain INTEGER/TEXT with DEFAULTs, so existing rows backfill cleanly
 * and no FK games are needed (the same pattern the Phase 3e migration uses).
 */
{
  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  const addCol = (name: string, ddl: string) => {
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${ddl}`);
    }
  };
  addCol("lost", "lost INTEGER NOT NULL DEFAULT 0");
  addCol("lost_reason", "lost_reason TEXT NOT NULL DEFAULT ''");
  addCol("dnc", "dnc INTEGER NOT NULL DEFAULT 0");
  addCol("dnc_reason", "dnc_reason TEXT NOT NULL DEFAULT ''");
  addCol("dnc_date", "dnc_date TEXT NOT NULL DEFAULT ''");
}

/**
 * Owner cockpit B migration (owner direction 2026-08-15). Idempotent — safe
 * on every boot.
 *
 * clients gains the OWNER-only DocuSign agreement-status column:
 *   agreement_status TEXT NOT NULL DEFAULT 'not_sent'
 * The owner tracks where each onboarding client is in completing forms
 * (Not sent → Sent → Signed) manually TODAY; real DocuSign envelope sending
 * is wired LATER once the owner connects a DocuSign account. Plain TEXT with
 * a DEFAULT, so existing rows backfill cleanly and no FK games are needed
 * (the same pattern the lost/DNC migration uses). The value is exposed to
 * and writable by the OWNER org (role=admin) only — tenant orgs never see
 * it in API responses and never write it.
 */
{
  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "agreement_status")) {
    db.exec("ALTER TABLE clients ADD COLUMN agreement_status TEXT NOT NULL DEFAULT 'not_sent'");
  }
}

/**
 * Payment-status migration (owner direction 2026-08-18). Idempotent — safe on
 * every boot.
 *
 * clients gains the OWNER-only payment columns for the $200/month subscription
 * payment link:
 *   payment_status   TEXT NOT NULL DEFAULT 'none' — none (no link sent yet)
 *                    | sent (link emailed — yellow) | paid (payment received —
 *                    green). The owner's Payment column in the clients table
 *                    renders from this.
 *   payment_link_url TEXT NOT NULL DEFAULT '' — the Stripe Payment Link URL
 *                    emailed to the client ('' until the first successful
 *                    send). Shown in the Sent badge's tooltip.
 *   paid_at          TEXT NOT NULL DEFAULT '' — ISO timestamp of when the
 *                    payment was recorded as received ('' until paid). Shown
 *                    in the Paid badge's tooltip.
 *
 * Plain TEXT columns with DEFAULTs, so existing rows backfill cleanly (the
 * same pattern every Phase 3 migration uses). The values are exposed to and
 * written by the OWNER org only — tenant orgs never receive the keys (the
 * agreement_status isolation rule).
 */
{
  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  const addCol = (name: string, ddl: string) => {
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${ddl}`);
    }
  };
  addCol("payment_status", "payment_status TEXT NOT NULL DEFAULT 'none'");
  addCol("payment_link_url", "payment_link_url TEXT NOT NULL DEFAULT ''");
  addCol("paid_at", "paid_at TEXT NOT NULL DEFAULT ''");
}
/**
 * Phase 5 — Stripe billing columns (owner direction 2026-08-18). Idempotent —
 * safe on every boot. Extends the payment-status trio above with the Stripe
 * identifiers + the owner-entered amount so the Finance tab can bill at
 * charge time (NO hard-coded rates) and the webhook can auto-flip + email the
 * invoice:
 *   payment_amount_cents INTEGER NOT NULL DEFAULT 0 — the amount the OWNER
 *                    entered when the link was sent (USD cents). Not a rate —
 *                    the owner types it at bill time; 0 until the first send.
 *   stripe_customer_id TEXT NOT NULL DEFAULT '' — the Stripe Customer created
 *                    for this client org on first billing ('' until then).
 *   stripe_price_id  TEXT NOT NULL DEFAULT '' — the Stripe Price created for
 *                    the sent link ('' until then).
 *   stripe_link_id   TEXT NOT NULL DEFAULT '' — the Stripe Payment Link id
 *                    ('' until then; the URL lives in payment_link_url).
 * All plain columns with DEFAULTs (same pattern as every Phase 3/5
 * migration). Exposed to the OWNER org only (same isolation rule as
 * agreement_status/payment_status).
 */
{
  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  const addCol = (name: string, ddl: string) => {
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${ddl}`);
    }
  };
  addCol("payment_amount_cents", "payment_amount_cents INTEGER NOT NULL DEFAULT 0");
  addCol("stripe_customer_id", "stripe_customer_id TEXT NOT NULL DEFAULT ''");
  addCol("stripe_price_id", "stripe_price_id TEXT NOT NULL DEFAULT ''");
  addCol("stripe_link_id", "stripe_link_id TEXT NOT NULL DEFAULT ''");
}

/**
 * Native e-signature (owner direction 2026-08-15) — the owner's editable
 * agreement template lives on the OWNER org row (orgs.agreement_template).
 * Plain TEXT with a DEFAULT so existing rows backfill cleanly. The field is
 * owner-org only: tenants never receive it in settings responses and cannot
 * write it (the API only exposes the key for the owner org).
 */
{
  const cols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "agreement_template")) {
    db.exec("ALTER TABLE orgs ADD COLUMN agreement_template TEXT NOT NULL DEFAULT ''");
  }
}

/**
 * Demo-call sales rework (owner 2026-08-20 — "Leads → Demo call → Client
 * accounts" flow). Idempotent — safe on every boot.
 *
 * clients gains the demo outcome the owner records after a demo call and the
 * scheduled demo timestamp:
 *   demo_outcome      TEXT — '' (no demo yet) | 'sold' | 'not_sold' | 'maybe'.
 *                       The owner records the demo result on a lead. 'sold'
 *                       is a RECORDED state — it does NOT auto-create a client
 *                       account (a client is sold + signed agreements + paid,
 *                       then the owner MANUALLY creates the account). Kept
 *                       separate from the pipeline `stage`, additive.
 *   demo_scheduled_at TEXT — the "YYYY-MM-DDTHH:MM" a demo call was scheduled
 *                       for; mirrors the appointment row ('' = none).
 *   demo_meeting_link TEXT — the Zoom/Google Meet URL the owner pastes when
 *                       scheduling a demo; included plainly in the invite
 *                       email (we do NOT integrate Zoom/Google APIs — purely
 *                       "send the provided link in the invite email").
 *   follow_up_note   TEXT — the owner's note captured with a 'maybe' demo
 *                       outcome (follow-up for the lead); surfaced in the
 *                       edit modal on the owner Leads tab.
 * All are plain columns with DEFAULTs (the standard migration pattern).
 */
{
  const cols = db.query("PRAGMA table_info(clients)").all() as { name: string }[];
  const addCol = (name: string, ddl: string) => {
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${ddl}`);
    }
  };
  addCol("demo_outcome", "demo_outcome TEXT NOT NULL DEFAULT ''");
  addCol("demo_scheduled_at", "demo_scheduled_at TEXT NOT NULL DEFAULT ''");
  addCol("demo_meeting_link", "demo_meeting_link TEXT NOT NULL DEFAULT ''");
  addCol("follow_up_note", "follow_up_note TEXT NOT NULL DEFAULT ''");
}

/**
 * Owner-org identity guard (owner 2026-08-20 — duplicate-owner landmine
 * fix). The owner platform workspace is identified by NAME ("Revzenta") via
 * getOwnerOrgId(), which returns the LOWEST-id org with that name. A stray
 * SECOND org named "Revzenta" (e.g. a tenant that was renamed, or a leaked
 * legacy org) is inert only by luck — if the true owner org were ever
 * deleted/recreated, the duplicate would become "the owner" and inherit the
 * owner cockpit (Admin tab, cross-org Documents list, etc.). This guard
 * makes the identity unambiguous at boot: if more than one org is named
 * exactly "Revzenta", every one after the first (lowest id) is renamed to
 * "Revzenta (duplicate)" so name-based owner detection can never pick a
 * duplicate and no duplicate can hide owner data. Idempotent — safe on every
 * boot.
 */
{
  const rows = db
    .query("SELECT id FROM orgs WHERE name = ? ORDER BY id")
    .all(DEFAULT_ORG_NAME) as { id: number }[];
  for (let i = 1; i < rows.length; i++) {
    db.query("UPDATE orgs SET name = ? WHERE id = ?").run(`${DEFAULT_ORG_NAME} (duplicate)`, rows[i].id);
  }
}

/**
 * Self-serve cancel/offboarding migration (Phase 5 prep, owner direction —
 * per-account subscription). Idempotent — safe on every boot.
 *
 * orgs gains the account lifecycle columns:
 *   status          'active' (default) | 'canceled' — a canceled account's
 *                   users can no longer log in (blocked server-side) and every
 *                   authed route 403s, but NOTHING is hard-deleted: the rows
 *                   stay in the DB for the 30-day data-retention window.
 *   canceled_at     SQLite datetime when the org admin canceled ('' until then)
 *   retention_until SQLite datetime = canceled_at + 30 days (contract: 30-day
 *                   data retention). Displayed to the users at login/block time
 *                   and returned to the canceling admin.
 *
 * All plain TEXT with DEFAULTs, so existing rows backfill cleanly and no FK
 * games are needed (the same pattern every Phase 3 migration uses).
 */
{
  const orgCols = db.query("PRAGMA table_info(orgs)").all() as { name: string }[];
  const addOrgCol = (name: string, ddl: string) => {
    if (!orgCols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE orgs ADD COLUMN ${ddl}`);
    }
  };
  addOrgCol("status", "status TEXT NOT NULL DEFAULT 'active'");
  addOrgCol("canceled_at", "canceled_at TEXT NOT NULL DEFAULT ''");
  addOrgCol("retention_until", "retention_until TEXT NOT NULL DEFAULT ''");
  // Appointments production (backlog 5a104eae): per-org toggle — when 1, the
  // tenant can create/schedule appointments for themselves; when 0 (default)
  // clients can only view/reschedule what the owner sets. Column is on `orgs`
  // (one flag for the whole account), not per-client.
  addOrgCol("allow_self_schedule", "allow_self_schedule INTEGER NOT NULL DEFAULT 0");
}

/**
 * Owner pipeline migration (3g-2, owner direction 2026-08-14). Idempotent —
 * safe on every boot.
 *
 * The owner's workspace tracks leads through exactly three stages:
 *   Leads → Onboarding → Sold
 * The owner org (the org of the `admin` user — the same flag that gates the
 * Admin tab) is migrated from the legacy 6-stage default pipeline
 * (Prospect → Intake → Kickoff → Build → Launch|Sold → Retainer): its stored
 * stage list is REPLACED with the three-stage list and every one of its
 * client records is migrated positionally. The mapping is computed from the
 * counts, never from stage names: divide the old list into N contiguous bands
 * (N = new stage count) and map each old stage to the new stage at the same
 * relative position — with 6 → 3, old bands [1-2] → Leads, [3-4] → Onboarding,
 * [5-6] → Sold. Tenant orgs are untouched: the migration only ever considers
 * admin-role orgs whose stored stages match the legacy default list exactly,
 * so a customized owner pipeline would also be left alone. Nothing else
 * happens on "Sold" — auto-provisioning a paying client is a later step
 * (3g-3), not part of this data migration.
 */
export const OWNER_PIPELINE = ["Leads", "Onboarding", "Sold"] as const;

// 3g-2: migrate the owner org's pipeline (Leads → Onboarding → Sold) at boot.
// Runs after every schema migration above so the stages column + users table
// exist. On an existing database the admin user is already present, so this
// import-time pass performs the migration immediately; on a fresh database the
// admin is created a moment later in ensureAdmin(), which re-invokes the same
// idempotent migration (see auth.ts).
//
// IMPORTANT: this call must stay BELOW the OWNER_PIPELINE declaration above.
// `const` lives in the temporal dead zone until its declaration executes, so
// invoking migrateOwnerPipeline() (which reads [...OWNER_PIPELINE]) before the
// declaration would throw ReferenceError at boot on any DB where an admin
// already exists with the legacy pipeline (the prod crash). Regression-tested
// by the fresh-process boot test in test/api-e2e.sh (section 25).
migrateOwnerPipeline();

/** True when the org's stages are the legacy 6-stage default pipeline
 *  (case-insensitive; position 5 may be "Launch" or "Sold" — prod renamed it
 *  via Settings). Anything customized does NOT match → left untouched. */
function isLegacyOwnerPipeline(stages: string[]): boolean {
  if (stages.length !== DEFAULT_STAGES.length) return false;
  const fifth = stages[4].toLowerCase();
  if (fifth !== "launch" && fifth !== "sold") return false;
  for (let i = 0; i < stages.length; i++) {
    if (i === 4) continue; // Launch|Sold — checked above
    if (stages[i].toLowerCase() !== DEFAULT_STAGES[i].toLowerCase()) return false;
  }
  return true;
}

/** True when the org's stages are exactly the legacy 3-stage OWNER pipeline
 *  with the pre-2026-08-15 middle-stage name "Intakes" (case-insensitive) —
 *  i.e. ["Leads","Intakes","Sold"]. This identifies the owner org mid-rename:
 *  the 6→3 pass landed on "Intakes" for any database created before the
 *  rename, and production is exactly there (8 owner clients in "Intakes").
 *  Anything else — tenant orgs (role=member, vertical stages) and owner
 *  stages already renamed/customized — is left untouched. */
function isLegacyOwnerRenamePipeline(stages: string[]): boolean {
  if (stages.length !== OWNER_PIPELINE.length) return false;
  const lower = stages.map((s) => s.trim().toLowerCase());
  return lower[0] === "leads" && lower[1] === "intakes" && lower[2] === "sold";
}
/** Positional band mapping: old stage at `oldIndex` → the new stage at the
 *  same relative position (proportional bands; generic over any counts). */
function positionalStage(oldIndex: number, oldCount: number, newStages: readonly string[]): string {
  const newIndex = Math.min(
    newStages.length - 1,
    Math.floor((oldIndex * newStages.length) / oldCount),
  );
  return newStages[newIndex];
}

/**
 * Migrate the owner org's pipeline to Leads → Onboarding → Sold and remap its
 * clients positionally. No-op for every other org (tenants, and any owner org
 * whose stages were already customized away from the legacy list). The owner
 * org is identified by NAME ("Revzenta", the default org — getOwnerOrgId),
 * NOT by users.role: since the team-users feature (owner request 2026-08-14)
 * gives client-account org admins role='admin' too, a role-based lookup would
 * wrongly treat tenant orgs as owner orgs. Called at boot (db.ts import) AND
 * right after the admin is ensured (auth.ts), so both an existing database
 * (admin already present) and a fresh one (admin created after the import-time
 * pass) converge on the 3-stage owner pipeline.
 */
export function migrateOwnerPipeline(): void {
  const adminOrgs = [{ org_id: getOwnerOrgId() }];
  for (const { org_id } of adminOrgs) {
    const org = getOrg(org_id);
    if (!org) continue;
    const prev = parseStages(org.stages);
    if (!isLegacyOwnerPipeline(prev)) continue;
    const next = [...OWNER_PIPELINE];
    const rows = db
      .query("SELECT id, stage FROM clients WHERE org_id = ?")
      .all(org_id) as { id: number; stage: string }[];
    const oldIndexByStage = new Map<string, number>();
    prev.forEach((s, i) => oldIndexByStage.set(s.toLowerCase(), i));
    const update = db.prepare("UPDATE clients SET stage = ? WHERE id = ?");
    const tx = db.transaction(() => {
      for (const r of rows) {
        const oldIndex = oldIndexByStage.get(r.stage.toLowerCase());
        if (oldIndex === undefined) continue; // defensive: unknown stage kept
        update.run(positionalStage(oldIndex, prev.length, next), r.id);
      }
      db.query("UPDATE orgs SET stages = ? WHERE id = ?").run(JSON.stringify(next), org_id);
    });
    tx();
    console.log(
      `[db] owner pipeline migrated (org ${org_id}): ${prev.join(" → ")} → ${next.join(" → ")} (${rows.length} client records remapped positionally)`,
    );
  }
  // Owner direction 2026-08-15 — rename the owner's middle stage:
  // "Intakes" → "Onboarding" (the Dashboard KPI already reads Onboarding,
  // cockpit A). Idempotent: only an org whose stored stages are exactly the
  // legacy 3-stage owner list ["Leads","Intakes","Sold"] is remapped, with the
  // new name at the SAME position; that org's clients still sitting in
  // "Intakes" follow (case-insensitive). Runs after the 6→3 pass above, so a
  // database created before the rename converges in one boot; a second boot
  // sees ["Leads","Onboarding","Sold"] and no-ops. Tenant orgs are never
  // considered (role=member), and the owner's own renamed stages are left
  // alone — pure owner-pipeline rename.
  for (const { org_id } of adminOrgs) {
    const org = getOrg(org_id);
    if (!org) continue;
    const prev = parseStages(org.stages);
    if (!isLegacyOwnerRenamePipeline(prev)) continue;
    const next = [...OWNER_PIPELINE];
    const renamed = db
      .query("UPDATE clients SET stage = ? WHERE org_id = ? AND lower(stage) = ?")
      .run(next[1], org_id, "intakes");
    db.query("UPDATE orgs SET stages = ? WHERE id = ?").run(JSON.stringify(next), org_id);
    console.log(
      `[db] owner middle stage renamed (org ${org_id}): ${prev.join(" → ")} → ${next.join(" → ")} (${renamed.changes} client records "Intakes" → "Onboarding")`,
    );
  }
}

/**
 * The default org ("Revzenta") — created if missing, always returns a
 * real id. Used by the auth admin-seeder and the demo seed.
 */
export function ensureDefaultOrg(): number {
  const orgRow = db
    .query("SELECT id FROM orgs WHERE name = ? ORDER BY id LIMIT 1")
    .get(DEFAULT_ORG_NAME) as { id: number } | null;
  if (orgRow) return orgRow.id;
  // Branding rename (2026-08-18): a pre-rename DB has the owner org under the
  // LEGACY name — adopt (rename) it instead of creating a second org, so the
  // owner's data and org id are preserved even if the boot backfill didn't run.
  const legacy = db
    .query("SELECT id FROM orgs WHERE name = ? ORDER BY id LIMIT 1")
    .get(LEGACY_ORG_NAME) as { id: number } | null;
  if (legacy) {
    db.query("UPDATE orgs SET name = ? WHERE id = ?").run(DEFAULT_ORG_NAME, legacy.id);
    return legacy.id;
  }
  return Number(db.query("INSERT INTO orgs (name) VALUES (?)").run(DEFAULT_ORG_NAME).lastInsertRowid);
}

/**
 * The platform owner's workspace org — the org named "Revzenta" (the
 * default org, created first — always id 1 in practice). Name-based lookup so
 * tenant renames of their own org can never matter, and so tenant org admins
 * (role='admin' users in client accounts, team-users feature) are never
 * mistaken for the owner. Never assumed to be id 1 — the name is the stable
 * identifier every existing migration/seed uses.
 */
export function getOwnerOrgId(): number {
  const orgRow = db
    .query("SELECT id FROM orgs WHERE name = ? ORDER BY id LIMIT 1")
    .get(DEFAULT_ORG_NAME) as { id: number } | null;
  return orgRow ? orgRow.id : ensureDefaultOrg();
}

export function isOwnerOrg(orgId: number): boolean {
  return orgId === getOwnerOrgId();
}

/** Full org row (branding + pipeline + custom-field settings). Every settings
 *  read/write is scoped to the session org — there is no cross-org addressing
 *  on these. */
export interface OrgRow {
  id: number;
  name: string;
  stages: string;
  accent_color: string;
  custom_fields: string;
  /** Adaptive intake Phase 1: account-level vertical config. */
  service_model: string;
  delivery_type: string;
  industry: string;
  intake_opts: string;
  /** Adaptive intake Phase 3: tenant-defined custom conditional field groups. */
  custom_intake_groups: string;
  /** Adaptive intake 3f-1: the org's business type (vertical template key;
   *  '' = no preset / General). */
  vertical_key: string;
  /** Owner request 2026-08-14 — what this client pays per month (USD, 0 until
   *  Phase 5 pricing). Owner-set (Admin tab); visible to the tenant in
   *  Settings. */
  monthly_subscription_amount: number;
  /** Owner request 2026-08-14 — how THIS org's own business makes money:
   *  "sales" (invoices) | "subscription" (per-client monthly book). Seeded by
   *  vertical at account creation; editable by the tenant in Settings (and by
   *  the owner in Admin). */
  revenue_model: string;
  /** Native e-signature (owner direction 2026-08-15) — the OWNER org's
   *  editable agreement template with placeholders ({{company}}, {{client_name}},
   *  {{date}}, {{price}}). '' = use the built-in default. Owner-only in the
   *  API; tenants never see or write it. */
  agreement_template: string;
  /** Phase 5 prep — account lifecycle: 'active' | 'canceled' (a canceled
   *  account's users are blocked from login + every authed route; data is
   *  retained, not deleted). '' = never canceled. */
  status: string;
  canceled_at: string;
  retention_until: string;
  /** Appointments production (backlog 5a104eae): 1 = this account's clients
   *  may schedule appointments for themselves; 0 = view/reschedule only. */
  allow_self_schedule: number;
  created_at: string;
}

export function getOrg(orgId: number): OrgRow | null {
  return db
    .query(
      "SELECT id, name, stages, accent_color, custom_fields, service_model, delivery_type, industry, intake_opts, custom_intake_groups, vertical_key, monthly_subscription_amount, revenue_model, agreement_template, status, canceled_at, retention_until, allow_self_schedule, created_at FROM orgs WHERE id = ?",
    )
    .get(orgId) as OrgRow | null;
}

/* ── Appointments / demo-call scheduling (owner 2026-08-20 sales rework) ──
 * The appointments row shape. `scheduled_at` is a local "YYYY-MM-DDTHH:MM"
 * string ('' = not scheduled yet); `duration` is minutes; `status` ∈
 * scheduled | confirmed | held | cancelled (default 'scheduled'). */
export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "held", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export function isAppointmentStatus(v: unknown): v is AppointmentStatus {
  return typeof v === "string" && (APPOINTMENT_STATUSES as readonly string[]).includes(v);
}

export interface AppointmentRow {
  id: number;
  org_id: number;
  client_id: number | null;
  title: string;
  scheduled_at: string;
  duration: number;
  status: AppointmentStatus;
  notes: string;
  token: string;
  reminder_sent: number;
  created_at: string;
  updated_at: string;
}

export interface ClientRow {
  id: number;
  org_id: number;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  industry: string;
  services: string;
  custom_fields: string;
  deal_value: number;
  stage: Stage;
  next_action: string;
  notes: string;
  archived: number;
  /** Phase 3e: "commercial" | "residential" (backfilled to residential). */
  client_type: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  lead_source: string;
  /** Adaptive intake Phase 1: optional billing + intake columns. */
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  billing_same: number;
  preferred_contact_method: string;
  business_type: string;
  tax_id_ein: string;
  ap_contact: string;
  po_required: number;
  units_locations: string;
  property_manager_name: string;
  property_manager_contact: string;
  hoa_name: string;
  hoa_contact: string;
  access_instructions: string;
  coi_required: number;
  service_contract: string;
  dba_name: string;
  ein_ssn: string;
  homeowner_renter: string;
  hoa_restrictions: string;
  parking_access: string;
  pet_on_premises: number;
  preferred_service_location: string;
  /** Owner request 2026-08-14 — lost + DNC pipeline-status flags. `lost`
   *  leads are excluded from pipeline counts/KPIs everywhere; `dnc` carries
   *  the do-not-call warning (reason + when it was set). */
  lost: number;
  lost_reason: string;
  dnc: number;
  dnc_reason: string;
  dnc_date: string;
  created_at: string;
  updated_at: string;
  /** 3g-3: the new tenant org auto-provisioned when the owner sold this
   *  client (0 = not provisioned yet). Idempotency link — one provision per
   *  client record, forever. */
  provisioned_org_id: number;
  /** Owner request 2026-08-14 — this record's recurring monthly amount (USD)
   *  in the org's OWN subscription book (used when the org's revenue_model =
   *  "subscription"). Default 0. */
  monthly_amount: number;
  /** Owner cockpit B (owner direction 2026-08-15) — DocuSign agreement
   *  status: "not_sent" | "sent" | "delivered" | "signed" | "declined"
   *  (default "not_sent"). Tracked
   *  manually by the OWNER org only; tenant orgs never receive/write it. */
  agreement_status: string;
  /** Owner direction 2026-08-18 — payment-link status for the $200/month
   *  subscription: "none" | "sent" | "paid" (default "none"). OWNER-only,
   *  like agreement_status; tenant orgs never receive/write it. */
  payment_status: string;
  /** The Stripe Payment Link URL emailed to the client ('' until sent).
   *  Owner-only, like payment_status. */
  payment_link_url: string;
  /** When the payment was recorded as received — ISO timestamp ('' until
   *  paid). Owner-only, like payment_status. */
  paid_at: string;
  /** Phase 5 — the owner-entered amount (USD cents) the last payment link was
   *  sent for. 0 until the first send (the owner types the amount at bill
   *  time — no hard-coded rates). */
  payment_amount_cents: number;
  /** Phase 5 — Stripe Customer id created for this client org on first
   *  billing ('' until then). */
  stripe_customer_id: string;
  /** Phase 5 — Stripe Price id created for the sent link ('' until then). */
  stripe_price_id: string;
  /** Phase 5 — Stripe Payment Link id ('' until then; its URL lives in
   *  payment_link_url). */
  stripe_link_id: string;
  /** Owner 2026-08-20 sales rework — the demo outcome recorded on a lead
   *  after a demo call: '' (no demo yet) | 'sold' | 'not_sold' | 'maybe'.
   *  'sold' is a RECORDED state — it does NOT auto-create a client account
   *  (the owner manually creates one after sold + signed agreements + paid).
   *  Kept separate from `stage`. Owner-workspace only in the API. */
  demo_outcome: string;
  /** The "YYYY-MM-DDTHH:MM" a demo call was scheduled for ('' = none);
   *  mirrors the appointments row. Owner-workspace only. */
  demo_scheduled_at: string;
  /** The Zoom/Google Meet URL the owner pasted when scheduling a demo ('' =
   *  none); included plainly in the invite email. Owner-workspace only. */
  demo_meeting_link: string;
  /** The owner's follow-up note captured with a 'maybe' demo outcome ('' =
   *  none); surfaced in the edit modal on the owner Leads tab. Owner-workspace
   *  only. */
  follow_up_note: string;
}

export interface TaskRow {
  id: number;
  org_id: number;
  title: string;
  client_id: number | null;
  due_date: string;
  done: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: number;
  org_id: number;
  client_id: number | null;
  amount: number;
  status: InvoiceStatus;
  due_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

/* ── Support tickets (owner direction 2026-08-15) ───────────────────────
 * `status` is owned by the OWNER workspace: clients create tickets (OPEN by
 * default) and the owner moves them OPEN → IN_PROGRESS → RESOLVED → CLOSED.
 * `priority` is set by the submitter (optional) and adjustable by the owner:
 * LOW | NORMAL | HIGH. org_id is the submitting account — always the caller's
 * session org at create time, so a tenant can never file a ticket on another
 * tenant's behalf. */
export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v);
}
export function isTicketPriority(v: unknown): v is TicketPriority {
  return typeof v === "string" && (TICKET_PRIORITIES as readonly string[]).includes(v);
}

export interface TicketRow {
  id: number;
  org_id: number;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
}
