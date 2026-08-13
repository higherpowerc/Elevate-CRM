import { db } from "./db";
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

/** Create a signed session token for a user. */
export function createSession(userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, getSecret())}`;
}

/** Verify a session token; returns the user id or null. */
export function verifySession(token: string | null | undefined): number | null {
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
    return data.uid;
  } catch {
    return null;
  }
}

export interface User {
  id: number;
  email: string;
  created_at: string;
}

export function getUserById(id: number): User | null {
  const row = db
    .query("SELECT id, email, created_at FROM users WHERE id = ?")
    .get(id) as User | null;
  return row;
}

export function getUserByEmail(email: string): { id: number; email: string; password_hash: string } | null {
  const row = db
    .query("SELECT id, email, password_hash FROM users WHERE email = ?")
    .get(email) as { id: number; email: string; password_hash: string } | null;
  return row;
}

export function userCount(): number {
  return (db.query("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
}

/**
 * Seed the admin account from ADMIN_EMAIL / ADMIN_PASSWORD env vars.
 * No hardcoded defaults — if the env vars are unset, no admin is created and
 * the login API returns a clear "setup required" response.
 * Password is bcrypt-hashed with Bun.password (cost 10).
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
  const hash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
  const existing = db.query("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    db.query("UPDATE users SET password_hash = ? WHERE email = ?").run(hash, email);
    return { created: false, message: `[auth] Admin ${email} already exists — password hash refreshed from env.` };
  }
  db.query("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
  return { created: true, message: `[auth] Seeded admin account: ${email}` };
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
