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

/** The four custom-field value types a tenant can define (Phase 3b). */
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "checkbox"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export function isCustomFieldType(v: unknown): v is CustomFieldType {
  return typeof v === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(v);
}

/** A tenant's custom-field DEFINITION (orgs.custom_fields entry): the field's
 *  display name and its value type. Tenants define these in Settings. */
export interface CustomFieldDef {
  name: string;
  type: CustomFieldType;
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
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, type });
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
  created_at: string;
}

export function getOrg(orgId: number): OrgRow | null {
  return db
    .query("SELECT id, name, stages, accent_color, custom_fields, created_at FROM orgs WHERE id = ?")
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
  created_at: string;
  updated_at: string;
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
