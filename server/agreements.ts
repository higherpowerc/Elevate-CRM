/**
 * Native in-app e-signature (owner direction 2026-08-15; backlog dd37c973).
 *
 * Replaces the manual agreement-status tracker (PR #53) with a REAL internal
 * signer — no third-party service, no API keys, $0 per envelope. Flow:
 *
 *   1. Owner clicks "Send Agreements" on an Onboarding row → the server renders
 *      the owner's agreement template with the client's details, generates a
 *      PDF (pdf-lib, pure JS) stored in <data dir>/agreements/, mints an
 *      unguessable sign token (only its SHA-256 hash is stored), and emails
 *      the client a unique /sign/<token> link (existing Resend infra).
 *      Client agreement_status: not_sent → sent.
 *   2. Client opens the link → the public page records delivery (sent →
 *      delivered, first open only) and shows the agreement with Sign/Decline.
 *   3. Signing captures the typed name + explicit consent checkbox and records
 *      name, timestamp, IP address and consent (delivered → signed | declined).
 *      The link is one-time use: signed/declined pages render a final state.
 *
 * Owner-only everywhere: the send/list/audit APIs 403 for tenants, and tenant
 * settings responses never carry the template. The sign PAGE and POST are
 * deliberately public (the emailed link is the credential).
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { dataDir, db, getOrg, parseStages } from "./db";
import type { ClientRow } from "./db";

/** Sign links live 30 days from send. */
export const AGREEMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The owner's agreement statuses (the same vocabulary PR #53 exposed). */
export const AGREEMENT_STATUSES = ["not_sent", "sent", "delivered", "signed", "declined"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];
export function isAgreementStatus(v: unknown): v is AgreementStatus {
  return typeof v === "string" && (AGREEMENT_STATUSES as readonly string[]).includes(v);
}

/**
 * Built-in default template — used until the owner edits their own wording in
 * Settings (Settings → "Agreement template"). The placeholders are the
 * contract: {{company}}, {{client_name}}, {{date}}, {{price}}.
 */
export const DEFAULT_AGREEMENT_TEMPLATE = [
  "CLIENT SERVICES AGREEMENT",
  "",
  "This agreement is between {{company}} (\"the Company\") and {{client_name}} (\"the Client\").",
  "",
  "Date: {{date}}",
  "Monthly price: {{price}}",
  "",
  "1. SERVICES. The Company agrees to provide the Client with the services described",
  "   in the Client's workspace, including onboarding, setup, training and ongoing",
  "   support for as long as this agreement is in effect.",
  "",
  "2. TERM. This agreement begins on the date above and continues month to month until",
  "   either party provides written notice of cancellation.",
  "",
  "3. FEES. The Client agrees to pay the Company the monthly price above. Fees are due",
  "   at the start of each billing period.",
  "",
  "4. DATA. The Company will keep the Client's data confidential and isolated from",
  "   every other client's data.",
  "",
  "5. AGREEMENT. Signing below confirms that the Client has read, understood, and",
  "   agreed to the terms of this agreement.",
  "",
  "Signed: ______________________________",
  "Name: ______________________________",
  "Date: ______________________________",
  "",
  "{{company}}",
].join("\n");

export interface AgreementClientDetails {
  companyName: string;
  clientName: string;
  email: string;
  dealValue: number;
}

/** Substitute the template's placeholders with the client's details. */
export function renderAgreementTemplate(template: string, c: AgreementClientDetails): string {
  const date = new Date().toISOString().slice(0, 10);
  const price = c.dealValue > 0 ? `$${c.dealValue.toFixed(2)}` : "—";
  return (template && template.trim() !== "" ? template : DEFAULT_AGREEMENT_TEMPLATE)
    .replaceAll("{{company}}", c.companyName)
    .replaceAll("{{client_name}}", c.clientName || c.companyName)
    .replaceAll("{{date}}", date)
    .replaceAll("{{price}}", price);
}

/** Directory holding generated agreement PDFs (alongside the SQLite DB in the
 *  same persistent volume). Created on demand. */
export function agreementsDir(): string {
  const dir = join(dataDir, "agreements");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** An unguessable pdf id: 16 random bytes → 32 hex chars. */
export function newPdfId(): string {
  return randomBytes(16).toString("hex");
}

/** Wrap text to a max width measured in the embedded font (pdf-lib standard
 *  fonts don't wrap on their own). Word-boundary wrapping, tolerant of very
 *  long words (they get hard-broken). */
function wrapText(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") {
      out.push("");
      continue;
    }
    const words = raw.split(/\s+/);
    let line = "";
    for (const w of words) {
      const probe = line === "" ? w : `${line} ${w}`;
      if (font.widthOfTextAtSize(probe, size) <= maxWidth || line === "") {
        line = probe;
      } else {
        out.push(line);
        line = w;
      }
    }
    if (line !== "") out.push(line);
  }
  return out;
}

/**
 * Generate the agreement PDF (US Letter) from the rendered template text:
 * title, wrapped body, and a signature block. Returns the PDF bytes; the
 * caller persists them under a unique pdf id.
 */
export async function generateAgreementPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  const size = 10.5;
  const lineHeight = 15;
  let page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const maxWidth = width - margin * 2;

  page.drawText("CLIENT AGREEMENT", { x: margin, y: height - margin, size: 18, font: bold, color: rgb(0.08, 0.08, 0.1) });
  let y = height - margin - 34;

  for (const line of wrapText(text, font, size, maxWidth)) {
    if (y < margin + lineHeight) {
      page = doc.addPage([612, 792]);
      y = height - margin;
    }
    if (line !== "") {
      page.drawText(line, { x: margin, y, size, font, color: rgb(0.12, 0.12, 0.14) });
    }
    y -= lineHeight;
  }

  // Signature block at the foot of the last page (the typed name + timestamp
  // are captured on the public sign page and recorded in the envelope audit).
  y = Math.max(margin + 20, y - 24);
  if (y > height - margin - 120) {
    page = doc.addPage([612, 792]);
    y = height - margin - 24;
  }
  page.drawText("The Client's typed signature and the date/time of signing are recorded", {
    x: margin, y, size: 9, font, color: rgb(0.35, 0.35, 0.38),
  });
  y -= 14;
  page.drawText("electronically with this agreement and are legally binding.", {
    x: margin, y, size: 9, font, color: rgb(0.35, 0.35, 0.38),
  });

  return doc.save();
}

/** Write the PDF bytes to disk under a fresh unique id; returns the id. */
export function storeAgreementPdf(bytes: Uint8Array): string {
  const pdfId = newPdfId();
  writeFileSync(join(agreementsDir(), `${pdfId}.pdf`), bytes);
  return pdfId;
}

/** Read a stored PDF by id, or null when missing. */
export function readAgreementPdf(pdfId: string): Uint8Array | null {
  const file = join(agreementsDir(), `${pdfId}.pdf`);
  if (!existsSync(file)) return null;
  return readFileSync(file);
}

/** Unsignable sign token: 32 random bytes → 64 hex chars. */
export function generateAgreementToken(): string {
  return randomBytes(32).toString("hex");
}
export function hashAgreementToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

export interface AgreementEnvelopeRow {
  id: number;
  client_id: number;
  org_id: number;
  token_hash: string;
  expires_at: number;
  status: AgreementStatus;
  pdf_id: string;
  agreement_text: string;
  signer_name: string;
  signed_at: string | null;
  ip_address: string;
  consent: number;
  created_at: string;
  updated_at: string;
}

function envelopeRow(row: unknown): AgreementEnvelopeRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    id: Number(r.id),
    client_id: Number(r.client_id),
    org_id: Number(r.org_id),
    token_hash: String(r.token_hash),
    expires_at: Number(r.expires_at),
    status: isAgreementStatus(r.status) ? r.status : "sent",
    pdf_id: String(r.pdf_id),
    agreement_text: String(r.agreement_text ?? ""),
    signer_name: String(r.signer_name ?? ""),
    signed_at: r.signed_at == null ? null : String(r.signed_at),
    ip_address: String(r.ip_address ?? ""),
    consent: Number(r.consent ?? 0),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function getEnvelopeForClient(clientId: number): AgreementEnvelopeRow | null {
  return envelopeRow(
    db.query("SELECT * FROM agreement_envelopes WHERE client_id = ? ORDER BY id DESC LIMIT 1").get(clientId),
  );
}

export function getEnvelopeByTokenHash(tokenHash: string): AgreementEnvelopeRow | null {
  return envelopeRow(db.query("SELECT * FROM agreement_envelopes WHERE token_hash = ?").get(tokenHash));
}

/**
 * Send (or re-send) an agreement for an OWNER client: renders the template,
 * generates + stores the PDF, replaces any prior envelope (fresh token — the
 * old link dies), marks the client sent, and returns the raw token + envelope
 * for the caller to email. The caller is responsible for owner-scoping the
 * client BEFORE calling (this module does no auth).
 */
export async function sendAgreement(client: ClientRow, template: string): Promise<{ token: string; envelope: AgreementEnvelopeRow }> {
  const text = renderAgreementTemplate(template, {
    companyName: client.company_name,
    clientName: client.contact_name,
    email: client.email,
    dealValue: client.deal_value,
  });
  const pdfBytes = await generateAgreementPdf(text);
  const pdfId = storeAgreementPdf(pdfBytes);
  const token = generateAgreementToken();
  const expiresAt = Date.now() + AGREEMENT_TOKEN_TTL_MS;
  db.transaction(() => {
    // Replace any prior envelope for this client — one live agreement at a time.
    db.query("DELETE FROM agreement_envelopes WHERE client_id = ?").run(client.id);
    db.query(
      `INSERT INTO agreement_envelopes (client_id, org_id, token_hash, expires_at, status, pdf_id, agreement_text)
       VALUES (?, ?, ?, ?, 'sent', ?, ?)`,
    ).run(client.id, client.org_id, hashAgreementToken(token), expiresAt, pdfId, text);
    db.query("UPDATE clients SET agreement_status = 'sent', updated_at = datetime('now') WHERE id = ?").run(client.id);
  })();
  const envelope = getEnvelopeForClient(client.id);
  if (!envelope) throw new Error("Agreement envelope was not created.");
  return { token, envelope };
}

/**
 * Public sign-page first open: records delivery (sent → delivered) exactly
 * once and stamps the opener's IP. No-op for signed/declined (final states).
 */
export function markDelivered(token: string, ip: string): void {
  const env = getEnvelopeByTokenHash(hashAgreementToken(token));
  if (!env || env.status !== "sent") return;
  db.query(
    "UPDATE agreement_envelopes SET status = 'delivered', ip_address = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(ip || env.ip_address, env.id);
  db.query("UPDATE clients SET agreement_status = 'delivered', updated_at = datetime('now') WHERE id = ?").run(env.client_id);
}

/**
 * Sign or decline (one-time): validates the token (exists, unexpired, not
 * already signed/declined), records the audit trail (typed name, timestamp,
 * IP, consent) and advances both the envelope and the client. Returns a
 * { ok, error?, status? } result — never throws.
 *
 * Owner workflow (live-test finding, 2026-08-15) — on SIGN only (never on
 * decline), inside the same transaction:
 *   1. the client record auto-advances to its org's TERMINAL stage (the last
 *      element of orgs.stages — stages are renamable, so the terminal stage
 *      is always the array's last element; the owner's terminal stage is
 *      "Sold", the Clients tab);
 *   2. a "Create client account" task is raised for the owner (deduped —
 *      re-sign/re-send never duplicates an OPEN task; a completed task may be
 *      recreated by a fresh agreement);
 *   3. the record's Next Action is set to "Create client account" so the
 *      column shows it immediately.
 * This only ever applies to owner-org clients by construction: the sign flow
 * is owner-workspace-only (tenant orgs cannot send agreements), but the code
 * reads each client's own org stages, so it stays correct generically.
 */
export function resolveAgreement(
  token: string,
  action: "sign" | "decline",
  name: string,
  consent: boolean,
  ip: string,
): { ok: true; status: AgreementStatus } | { ok: false; error: string } {
  const env = getEnvelopeByTokenHash(hashAgreementToken(token));
  if (!env) return { ok: false, error: "This agreement link is invalid." };
  if (env.expires_at <= Date.now()) return { ok: false, error: "This agreement link has expired. Please contact the sender for a new link." };
  if (env.status === "signed" || env.status === "declined") {
    return { ok: false, error: "This agreement link has already been used." };
  }
  const status: AgreementStatus = action === "sign" ? "signed" : "declined";
  const signedAt = new Date().toISOString();
  db.transaction(() => {
    db.query(
      `UPDATE agreement_envelopes
       SET status = ?, signer_name = ?, signed_at = ?, ip_address = ?, consent = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(status, action === "sign" ? name.trim() : "", signedAt, ip || env.ip_address, consent ? 1 : 0, env.id);
    if (action === "sign") {
      const client = db
        .query("SELECT id, org_id, company_name, stage FROM clients WHERE id = ?")
        .get(env.client_id) as SignedClientRow | null;
      if (!client) {
        // The client row is gone — record the envelope state only (the audit
        // trail is still correct; there is no record left to advance).
        db.query("UPDATE clients SET agreement_status = ?, updated_at = datetime('now') WHERE id = ?").run(status, env.client_id);
        return;
      }
      advanceSignedClient(db, client);
    } else {
      db.query("UPDATE clients SET agreement_status = ?, updated_at = datetime('now') WHERE id = ?").run(status, env.client_id);
    }
  })();
  return { ok: true, status };
}

/** The client row slice the sign-advance logic needs (see
 *  advanceSignedClient). */
interface SignedClientRow {
  id: number;
  org_id: number;
  company_name: string;
  stage: string;
}

/**
 * The shared "agreement just got signed" side effects — extracted from the
 * resolveAgreement sign branch (PR #60) so the LIVE sign flow and the BOOT
 * backfill (below) use ONE code path (live-test finding 2026-08-15):
 *   1. the client record auto-advances to its org's TERMINAL stage (the last
 *      element of orgs.stages — stages are renamable, so the terminal stage
 *      is always the array's last element; the owner's terminal stage is
 *      "Sold", the Clients tab) — a no-op when already there;
 *   2. a "Create client account" task is raised for the owner (deduped —
 *      re-sign/re-send never duplicates an OPEN task; a completed task may be
 *      recreated by a fresh agreement);
 *   3. the record's Next Action is set to "Create client account" so the
 *      column shows it immediately.
 * Idempotent: re-running on an already-advanced record changes nothing
 * observable (stage stays terminal, the open task is not duplicated,
 * next_action is already set).
 */
export function advanceSignedClient(db: Database, client: SignedClientRow): void {
  // 1. Terminal-stage auto-advance (Clients tab). No-op when already there.
  const org = getOrg(client.org_id);
  const stages = org ? parseStages(org.stages) : [];
  const terminal = stages.length > 0 ? stages[stages.length - 1] : null;
  if (terminal && client.stage !== terminal) {
    db.query("UPDATE clients SET stage = ?, updated_at = datetime('now') WHERE id = ?").run(terminal, client.id);
  }
  // 2 + 3. Account-creation task (deduped on OPEN tasks) + Next Action.
  const dup = db
    .query("SELECT id FROM tasks WHERE client_id = ? AND title LIKE 'Create client account%' AND done = 0")
    .get(client.id);
  if (!dup) {
    db.query(
      `INSERT INTO tasks (org_id, title, client_id, due_date, done, notes)
       VALUES (?, ?, ?, '', 0, 'Auto-created when the agreement was signed.')`,
    ).run(client.org_id, `Create client account for ${client.company_name}`, client.id);
  }
  db.query(
    "UPDATE clients SET agreement_status = 'signed', next_action = 'Create client account', updated_at = datetime('now') WHERE id = ?",
  ).run(client.id);
}

/**
 * Boot-time backfill (live-test finding 2026-08-15): records that were marked
 * signed BEFORE the sign-time auto-advance (PR #60) existed still sit in a
 * non-terminal stage (live client id 59 "Joe" — agreement_status='signed',
 * stage='Onboarding', next_action=''). For every signed client NOT already in
 * its org's terminal stage, apply the exact same advance logic as the live
 * sign flow. Idempotent: a settled DB (all signed records already terminal)
 * matches nothing, so re-running changes nothing. Returns the number of
 * records advanced. This only ever touches owner-org records by construction
 * (tenant orgs cannot send agreements, so they have no signed status), but
 * it reads each client's own org stages, so it stays correct generically.
 */
export function backfillSignedClients(db: Database): number {
  const signed = db
    .query("SELECT id, org_id, company_name, stage FROM clients WHERE agreement_status = 'signed'")
    .all() as SignedClientRow[];
  let advanced = 0;
  for (const client of signed) {
    const org = getOrg(client.org_id);
    const stages = org ? parseStages(org.stages) : [];
    const terminal = stages.length > 0 ? stages[stages.length - 1] : null;
    if (!terminal || client.stage === terminal) continue;
    advanceSignedClient(db, client);
    advanced++;
  }
  return advanced;
}

/** Human label for the sign-page final states / badges. */
export const AGREEMENT_LABELS: Record<AgreementStatus, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  delivered: "Delivered",
  signed: "Signed",
  declined: "Declined",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Public HTML shell for /sign/<token>. Zero client framework — inline CSS so
 *  it works even when the SPA bundle is missing. */
function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0a0c; color: #f2f1ec; font: 16px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 48px 20px 80px; }
  .brand { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #8b8a84; margin-bottom: 28px; }
  .brand b { color: #d6ff3f; font-weight: 700; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; }
  .sub { color: #a5a49c; margin: 0 0 32px; }
  .doc { background: #131316; border: 1px solid #24242a; border-radius: 12px; padding: 28px 30px; white-space: pre-wrap; font-size: 14px; color: #e4e3dc; margin-bottom: 28px; }
  .form { background: #131316; border: 1px solid #24242a; border-radius: 12px; padding: 24px 30px; }
  label { display: block; margin-bottom: 16px; font-size: 14px; }
  label span { display: block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #8b8a84; margin-bottom: 6px; }
  input[type=text] { width: 100%; background: #0a0a0c; color: #f2f1ec; border: 1px solid #33333b; border-radius: 8px; padding: 10px 12px; font-size: 15px; }
  .consent { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; color: #c9c8c1; }
  .consent input { margin-top: 4px; }
  .row { display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
  button { flex: 1; min-width: 200px; border: 0; border-radius: 10px; padding: 12px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .sign { background: #d6ff3f; color: #0a0a0c; }
  .decline { background: transparent; color: #f2f1ec; border: 1px solid #3a3a44; }
  .msg { margin-top: 14px; font-size: 14px; }
  .msg.err { color: #ff7a6e; }
  .msg.ok { color: #9ee87a; }
  .final { background: #131316; border: 1px solid #24242a; border-radius: 12px; padding: 28px 30px; }
  .final h2 { margin: 0 0 10px; }
  .final .ok { color: #9ee87a; } .final .bad { color: #ff7a6e; }
  .meta { color: #a5a49c; font-size: 14px; margin-top: 6px; }
  a.pdf { color: #d6ff3f; }
  .stamp { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 3px 12px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 16px; }
  .stamp.green { color: #9ee87a; } .stamp.red { color: #ff7a6e; }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/** The public /sign/<token> page. Returns the sign form, a final state, or a
 *  clear invalid/expired message. First open of a live link records delivery. */
export function renderSignPage(token: string, ip: string): Response {
  const env = getEnvelopeByTokenHash(hashAgreementToken(token));
  if (!env) {
    return page("Link not found", `
      <div class="brand"><b>Elevate Studio</b> · agreement</div>
      <div class="final"><h2>This link is invalid</h2>
      <p>We couldn't find an agreement for this link. Double-check the link in your email, or contact the sender for a new one.</p></div>`);
  }
  if (env.expires_at <= Date.now()) {
    return page("Link expired", `
      <div class="brand"><b>Elevate Studio</b> · agreement</div>
      <div class="final"><h2>This link has expired</h2>
      <p>Agreement links are valid for 30 days. Contact the sender and ask them to re-send the agreement.</p></div>`);
  }
  if (env.status === "signed") {
    return page("Agreement signed", `
      <div class="brand"><b>Elevate Studio</b> · agreement</div>
      <div class="final"><span class="stamp green">Signed</span>
      <h2>This agreement has been signed</h2>
      <p>Signed by <b>${esc(env.signer_name)}</b> on ${esc(env.signed_at ?? "")}. No further action is needed — the sender has been notified of the status.</p>
      <p class="meta"><a class="pdf" href="/agreement-pdf/${esc(env.pdf_id)}">Download a copy of the agreement (PDF)</a></p></div>`);
  }
  if (env.status === "declined") {
    return page("Agreement declined", `
      <div class="brand"><b>Elevate Studio</b> · agreement</div>
      <div class="final"><span class="stamp red">Declined</span>
      <h2>This agreement was declined</h2>
      <p>This link has already been used and the agreement was declined. Contact the sender if you'd like to review a new version.</p></div>`);
  }
  // Live (sent or delivered — first open records delivery).
  if (env.status === "sent") {
    try {
      markDelivered(token, ip);
    } catch {
      /* delivery marking must never break the page */
    }
  }
  const actionUrl = `/api/sign/${esc(token)}`;
  return page("Sign your agreement", `
    <div class="brand"><b>Elevate Studio</b> · agreement</div>
    <h1>Sign your agreement</h1>
    <p class="sub">Review the agreement below, then sign or decline. Signing is legally binding.</p>
    <div class="doc">${esc(env.agreement_text)}</div>
    <div class="form">
      <label><span>Your full name (typed signature)</span>
        <input type="text" id="name" autocomplete="name" placeholder="Your full name" maxlength="120" /></label>
      <label class="consent"><input type="checkbox" id="consent" />
        <span>I have read and agree to this agreement, and I consent to signing it electronically.</span></label>
      <div class="row">
        <button class="sign" id="btn-sign">Sign agreement</button>
        <button class="decline" id="btn-decline">Decline</button>
      </div>
      <div class="msg" id="msg"></div>
      <p class="meta"><a class="pdf" href="/agreement-pdf/${esc(env.pdf_id)}">Download a copy of the agreement (PDF)</a></p>
    </div>
    <script>
      const nameEl = document.getElementById("name");
      const consentEl = document.getElementById("consent");
      const msgEl = document.getElementById("msg");
      async function act(action) {
        msgEl.className = "msg"; msgEl.textContent = "";
        if (action === "sign") {
          if (!nameEl.value.trim()) { msgEl.className = "msg err"; msgEl.textContent = "Please type your full name."; return; }
          if (!consentEl.checked) { msgEl.className = "msg err"; msgEl.textContent = "Please check the consent box to sign."; return; }
        }
        document.getElementById("btn-sign").disabled = true;
        document.getElementById("btn-decline").disabled = true;
        try {
          const r = await fetch(${JSON.stringify(actionUrl)}, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, name: nameEl.value.trim(), consent: consentEl.checked }),
          });
          const d = await r.json();
          if (d.ok) { window.location.href = ${JSON.stringify(`/sign/${token}`)}; }
          else { msgEl.className = "msg err"; msgEl.textContent = d.error || "Something went wrong."; document.getElementById("btn-sign").disabled = false; document.getElementById("btn-decline").disabled = false; }
        } catch {
          msgEl.className = "msg err"; msgEl.textContent = "Network error — please try again.";
          document.getElementById("btn-sign").disabled = false;
          document.getElementById("btn-decline").disabled = false;
        }
      }
      document.getElementById("btn-sign").onclick = () => act("sign");
      document.getElementById("btn-decline").onclick = () => act("decline");
    </script>`);
}
