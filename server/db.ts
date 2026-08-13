import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const STAGES = [
  "Prospect",
  "Intake",
  "Kickoff",
  "Build",
  "Launch",
  "Retainer",
] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export const INVOICE_STATUSES = ["draft", "sent", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function isInvoiceStatus(v: unknown): v is InvoiceStatus {
  return typeof v === "string" && (INVOICE_STATUSES as readonly string[]).includes(v);
}

export interface CustomField {
  label: string;
  value: string;
}

/** Data dir: $DATA_DIR env, else ./data next to the server directory. */
const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "crm.db"));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 3000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
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

export interface ClientRow {
  id: number;
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
  client_id: number | null;
  amount: number;
  status: InvoiceStatus;
  due_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}
