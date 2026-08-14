import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Default pipeline stages — every org starts here (Elevate Studio keeps them;
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

export const DEFAULT_ORG_NAME = "Elevate Studio";

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

/** Data dir: $DATA_DIR env, else ./data next to the server directory. */
const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "..", "data");
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
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    org_id        INTEGER NOT NULL REFERENCES orgs(id),
    role          TEXT NOT NULL DEFAULT 'member',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
`);

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
 *   1. creates the default org ("Elevate Studio") if none exists;
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
 * Owner pipeline migration (3g-2, owner direction 2026-08-14). Idempotent —
 * safe on every boot.
 *
 * The owner's workspace tracks leads through exactly three stages:
 *   Leads → Intakes → Sold
 * The owner org (the org of the `admin` user — the same flag that gates the
 * Admin tab) is migrated from the legacy 6-stage default pipeline
 * (Prospect → Intake → Kickoff → Build → Launch|Sold → Retainer): its stored
 * stage list is REPLACED with the three-stage list and every one of its
 * client records is migrated positionally. The mapping is computed from the
 * counts, never from stage names: divide the old list into N contiguous bands
 * (N = new stage count) and map each old stage to the new stage at the same
 * relative position — with 6 → 3, old bands [1-2] → Leads, [3-4] → Intakes,
 * [5-6] → Sold. Tenant orgs are untouched: the migration only ever considers
 * admin-role orgs whose stored stages match the legacy default list exactly,
 * so a customized owner pipeline would also be left alone. Nothing else
 * happens on "Sold" — auto-provisioning a paying client is a later step
 * (3g-3), not part of this data migration.
 */
export const OWNER_PIPELINE = ["Leads", "Intakes", "Sold"] as const;

// 3g-2: migrate the owner org's pipeline (Leads → Intakes → Sold) at boot.
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
 * Migrate the owner org's pipeline to Leads → Intakes → Sold and remap its
 * clients positionally. No-op for every other org (tenants, and any owner org
 * whose stages were already customized away from the legacy list). Called at
 * boot (db.ts import) AND right after the admin is ensured (auth.ts), so both
 * an existing database (admin already present) and a fresh one (admin created
 * after the import-time pass) converge on the 3-stage owner pipeline.
 */
export function migrateOwnerPipeline(): void {
  const adminOrgs = db
    .query("SELECT DISTINCT org_id FROM users WHERE role = 'admin'")
    .all() as { org_id: number }[];
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
}

/**
 * The default org ("Elevate Studio") — created if missing, always returns a
 * real id. Used by the auth admin-seeder and the demo seed.
 */
export function ensureDefaultOrg(): number {
  const orgRow = db
    .query("SELECT id FROM orgs WHERE name = ? ORDER BY id LIMIT 1")
    .get(DEFAULT_ORG_NAME) as { id: number } | null;
  if (orgRow) return orgRow.id;
  return Number(db.query("INSERT INTO orgs (name) VALUES (?)").run(DEFAULT_ORG_NAME).lastInsertRowid);
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
  created_at: string;
}

export function getOrg(orgId: number): OrgRow | null {
  return db
    .query(
      "SELECT id, name, stages, accent_color, custom_fields, service_model, delivery_type, industry, intake_opts, custom_intake_groups, vertical_key, created_at FROM orgs WHERE id = ?",
    )
    .get(orgId) as OrgRow | null;
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
  created_at: string;
  updated_at: string;
  /** 3g-3: the new tenant org auto-provisioned when the owner sold this
   *  client (0 = not provisioned yet). Idempotency link — one provision per
   *  client record, forever. */
  provisioned_org_id: number;
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
