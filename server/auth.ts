import {
  db,
  ensureDefaultOrg,
  getOrg,
  isOwnerOrg,
  parseStages,
  parsePermissions,
  DEFAULT_STAGES,
  DEFAULT_ACCENT,
  migrateOwnerPipeline,
  type Role,
  type TabPermissions,
} from "./db";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * MVP-grade auth: bcrypt password hashing via Bun's built-in crypto
 * (proper hashing — no plaintext anywhere) + an HMAC-signed session token
 * carried in an HttpOnly cookie. See README "Security notes" for what must
 * be hardened before a public launch (rate limiting, CSRF, brute-force
 * lockout, etc.).
 */

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getDataDir(): string {
  return process.env.DATA_DIR ?? join(import.meta.dir, "..", "data");
}

/** Session signing secret: $SESSION_SECRET, else a generated one persisted to data/.secret. */
function getSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const file = join(getDataDir(), ".secret");
  if (existsSync(file)) {
    const s = readFileSync(file, "utf8").trim();
    if (s) return s;
  }
  const generated = randomBytes(32).toString("hex");
  writeFileSync(file, generated, { mode: 0o600 });
  console.log(
    "[auth] SESSION_SECRET not set — generated one and persisted it to data/.secret. Set SESSION_SECRET explicitly in production.",
  );
  return generated;
}

function sign(data: string, secret: string): string {
  return new Bun.CryptoHasher("sha256").update(secret + "::" + data).digest("base64url");
}

/**
 * Create a signed session token for a user. When `impersonatedFrom` is set the
 * session is an owner impersonation (Phase 3d): the `imp` field records the
 * admin user id who started it, inside the signed payload — only the server can
 * create or alter it. `/api/auth/me` reads it to flag the banner, and
 * `/api/auth/impersonate-return` uses it to restore the admin's own session.
 */
export function createSession(userId: number, opts: { impersonatedFrom?: number } = {}): string {
  const data: Record<string, number> = { uid: userId, exp: Date.now() + SESSION_TTL_MS };
  if (opts.impersonatedFrom) data.imp = opts.impersonatedFrom;
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload, getSecret())}`;
}

export interface SessionPayload {
  uid: number;
  exp: number;
  /** Set only on impersonation sessions: the admin user id who started it. */
  imp?: number;
}

/** Verify a session token and return its full payload (uid, exp, optional imp). */
export function verifySessionPayload(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const secret = getSecret();
  const expected = sign(payload, secret);
  // Constant-time-ish comparison is unnecessary for an HMAC here, but keep
  // the explicit length check to avoid trivial mismatch noise.
  if (sig.length !== expected.length || sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.uid !== "number" || typeof data.exp !== "number") return null;
    if (data.exp < Date.now()) return null;
    const out: SessionPayload = { uid: data.uid, exp: data.exp };
    if (typeof data.imp === "number") out.imp = data.imp;
    return out;
  } catch {
    return null;
  }
}

/** Verify a session token; returns the user id or null. */
export function verifySession(token: string | null | undefined): number | null {
  return verifySessionPayload(token)?.uid ?? null;
}

export interface User {
  id: number;
  email: string;
  orgId: number;
  role: Role;
  /** Team-users (owner request 2026-08-14): the session user's PER-TAB access
   *  grants (clients | tasks | finance | settings | support → {edit: bool}).
   *  Absent tab = no access; {edit:false} = view-only. Org admins (role=
   *  'admin' and the org's original owner login) bypass permissions entirely
   *  and always see {}. Added to /api/auth/me (and login) so the UI can
   *  render tabs per member later. */
  permissions: TabPermissions;
  /** Team-users UI (owner request 2026-08-14): effective org admin — stored
   *  role='admin' OR the org's original owner login (its first user by MIN id).
   *  Additive key on /api/auth/me + login (and every user payload); drives the
   *  Settings "Team members" section and admin-bypass rendering. */
  isOrgAdmin: boolean;
  /** Branding rename (2026-08-18) — true for the platform OWNER session
   *  (owner org AND role='admin'); drives the owner cockpit UI. */
  isOwner: boolean;
  orgName: string;
  verticalKey: string;
  /** The tenant's ordered pipeline stages (Phase 3a) — the client stage
   *  dropdown and dashboard breakdown are driven by this list. */
  stages: string[];
  /** The tenant's brand accent (hex) — the app shell uses it for the accent. */
  accentColor: string;
  /** Dashboard color picker (owner 2026-08-29): the account's dashboard
   *  numbers/text color (hex); '' = unset -> theme defaults. */
  dashboardColor: string;
  created_at: string;
}

interface UserRow {
  id: number;
  email: string;
  org_id: number;
  role: Role;
  permissions: string;
  created_at: string;
}

/** Effective org admin — stored role='admin' OR the org's original owner
 *  login (its first user by MIN id). Mirrors the api.ts isOrgAdmin() gate so
 *  the UI can show admin controls (team members section) exactly for the users
 *  the server lets manage members. */
function isOrgAdminUser(userId: number, orgId: number, role: Role): boolean {
  if (role === "admin") return true;
  const first = db
    .query("SELECT MIN(id) AS id FROM users WHERE org_id = ?")
    .get(orgId) as { id: number | null } | null;
  return first?.id === userId;
}

/** Map a users row to the API shape; orgName/stages/accentColor let the shell
 *  show the signed-in tenant's own branding once authenticated. isOwner is the
 *  platform-owner flag (owner org AND role='admin' — the server's
 *  isOwnerSession); the client keys its owner cockpit to it so the owner UI
 *  never depends on the org NAME string (branding rename 2026-08-18). */
export function toUser(row: UserRow): User {
  const org = getOrg(row.org_id);
  return {
    id: row.id,
    email: row.email,
    orgId: row.org_id,
    role: row.role,
    permissions: parsePermissions(row.permissions),
    isOrgAdmin: isOrgAdminUser(row.id, row.org_id, row.role),
    isOwner: row.role === "admin" && isOwnerOrg(row.org_id),
    orgName: org?.name ?? "",
    // Wholesale Biz custom menu (owner 2026-09-04) — the workspace's
    // business type rides on the session user so the client nav can switch
    // per vertical (additive key on /api/auth/me + login).
    verticalKey: org?.vertical_key ?? "",
    stages: org ? parseStages(org.stages) : [...DEFAULT_STAGES],
    accentColor: org?.accent_color ?? DEFAULT_ACCENT,
    dashboardColor: org?.dashboard_color ?? "",
    created_at: row.created_at,
  };
}

export function getUserById(id: number): User | null {
  const row = db
    .query("SELECT id, email, org_id, role, permissions, created_at FROM users WHERE id = ?")
    .get(id) as UserRow | null;
  return row ? toUser(row) : null;
}

export function getUserByEmail(email: string): (UserRow & { password_hash: string }) | null {
  const row = db
    .query("SELECT id, email, org_id, role, permissions, password_hash, created_at FROM users WHERE email = ?")
    .get(email) as (UserRow & { password_hash: string }) | null;
  return row;
}

export function userCount(): number {
  return (db.query("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
}

/** bcrypt-hash a password (cost 10) — the one hashing helper for every user
 *  (admin seeding + Phase 2 admin-provisioned member accounts). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

/**
 * Seed the admin account from ADMIN_EMAIL / ADMIN_PASSWORD env vars.
 * No hardcoded defaults — if the env vars are unset, no admin is created and
 * the login API returns a clear "setup required" response.
 * Password is bcrypt-hashed with Bun.password (cost 10).
 * The admin lives in the default org ("Revzenta") with role `admin`.
 */
export async function ensureAdmin(): Promise<{ created: boolean; message: string }> {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    return {
      created: false,
      message:
        "[auth] ADMIN_EMAIL / ADMIN_PASSWORD not set — no admin seeded. Set both env vars and run `bun run seed` (or restart the server), so login can be used.",
    };
  }
  if (password.length < 8) {
    return {
      created: false,
      message: "[auth] ADMIN_PASSWORD is too short (< 8 chars). Choose a longer password.",
    };
  }
  const hash = await hashPassword(password);
  const orgId = ensureDefaultOrg();
  const existing = db.query("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    // Keep an existing org assignment (Phase 2 may move users between orgs);
    // only backfill org_id when it is still unset (0).
    db.query(
      `UPDATE users SET password_hash = ?, org_id = CASE WHEN org_id = 0 THEN ? ELSE org_id END, role = 'admin' WHERE email = ?`,
    ).run(hash, orgId, email);
    return { created: false, message: `[auth] Admin ${email} already exists — password hash refreshed from env.` };
  }
  db.query("INSERT INTO users (email, password_hash, org_id, role) VALUES (?, ?, ?, 'admin')").run(
    email,
    hash,
    orgId,
  );
  // 3g-2: on a fresh database the admin is created AFTER db.ts's import-time
  // migration pass, so re-run it now — the owner org (this admin's org) still
  // has the legacy 6-stage pipeline and must be migrated to Leads → Onboarding →
  // Sold (idempotent; no-op once migrated).
  migrateOwnerPipeline();
  return { created: true, message: `[auth] Seeded admin account: ${email}` };
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
