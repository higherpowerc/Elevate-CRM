/**
 * 3g-4 — shared email module (client intake + welcome emails).
 *
 * Sends via Resend's built-in test sender (`onboarding@resend.dev`) — no
 * domain purchase needed; a real domain comes at Phase 5. The app must NEVER
 * crash or fail a request because email is not configured: when
 * RESEND_API_KEY is unset, `sendEmail` logs a skip line and returns.
 * `sendEmail` never throws, so callers can fire-and-forget it from the
 * provisioning/login paths without touching the request that triggered it.
 *
 * Reference for the exact Resend call shape (Bearer auth, `from` shape,
 * graceful key-missing handling): /home/team/shared/site/src/lib/contact.ts
 */

const RESEND_API = process.env.RESEND_URL ?? "https://api.resend.com/emails";
/** The sender shown on every 3g-4 email (Resend's test sender). */
export const EMAIL_FROM = "Elevate Studio <onboarding@resend.dev>";
/** App URL used when the triggering request has no usable origin. */
export const DEFAULT_APP_URL = "https://elevate-crm-mwp7.onrender.com";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** When TEST_EMAIL_TO is set, redirect the delivery there and prefix the
   *  body with "[TEST] Intended for <to>". Defaults to true — this module
   *  only sends client-facing mail (owner mail, when it exists, can opt out
   *  by passing false). */
  testRedirect?: boolean;
}

/** The best public URL for the app: the triggering request's origin when one
 *  is present (a browser request usually carries it), else the production
 *  fallback. */
export function appUrlFrom(req?: Request): string {
  const origin = req?.headers.get("origin") ?? "";
  if (/^https?:\/\/[^\s/]+/.test(origin)) return origin.replace(/\/+$/, "");
  return DEFAULT_APP_URL;
}

/**
 * POST a plain-text (optionally HTML) email through Resend. NEVER throws and
 * NEVER rejects: every failure path logs and returns, so callers can fire and
 * forget without try/catch of their own.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (!apiKey) {
    console.log(
      `[email] RESEND_API_KEY not configured — skipping ${input.subject} to ${input.to}`,
    );
    return;
  }
  try {
    const testTo = (process.env.TEST_EMAIL_TO ?? "").trim();
    const redirect = input.testRedirect !== false && testTo !== "";
    const to = redirect ? testTo : input.to;
    const text = redirect ? `[TEST] Intended for ${input.to}\n\n${input.text}` : input.text;
    const body: Record<string, unknown> = {
      from: EMAIL_FROM,
      to: [to],
      subject: input.subject,
      text,
    };
    if (input.html) body.html = input.html;
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[email] Resend returned ${res.status} for "${input.subject}" to ${to}: ${detail}`);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    console.log(`[email] Sent "${input.subject}" to ${to} (resend id: ${data.id ?? "unknown"})`);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[email] Resend request failed for "${input.subject}": ${m}`);
  }
}

/** 3g-4 intake email — sent right after a sold lead's workspace is
 *  auto-provisioned: login credentials + a pointer to onboarding. */
export function sendIntakeEmail(opts: {
  to: string;
  orgName: string;
  loginEmail: string;
  tempPassword: string;
  appUrl: string;
}): Promise<void> {
  const text = [
    "Hi there,",
    "",
    `Great news — your ${opts.orgName} workspace in Elevate Studio is ready.`,
    "",
    `Sign in here: ${opts.appUrl}`,
    "",
    `Email:    ${opts.loginEmail}`,
    `Password: ${opts.tempPassword}`,
    "",
    "Once you're in, you can finish setting up your workspace: add your clients,",
    "set up your pipeline, and start tracking tasks and invoices.",
    "",
    "Your Elevate Studio team is here if you need anything.",
    "",
    "— Elevate Studio",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: "Welcome to Elevate Studio — your workspace is ready",
    text,
  });
}

/** 3g-4 welcome email — sent once, on the member's first successful login.
 *  Orientation only — deliberately no credentials in this one. */
export function sendWelcomeEmail(opts: {
  to: string;
  orgName: string;
  appUrl: string;
}): Promise<void> {
  const text = [
    "Hi there,",
    "",
    `Welcome to ${opts.orgName}. Your workspace is set up and ready to go — here's a quick orientation:`,
    "",
    "1. Set up your workspace — rename your pipeline stages and pick your accent color in Settings.",
    "2. Add your clients and move them through your pipeline as work comes in.",
    "3. Track your tasks and invoices to stay on top of everything.",
    "",
    `Sign in anytime at: ${opts.appUrl}`,
    "",
    "— Elevate Studio",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: `Welcome to ${opts.orgName} — let's get started`,
    text,
  });
}

/** 3k — password reset email, sent from the forgot-password flow. The raw
 *  token appears ONLY in this email (the server stores a SHA-256 hash); the
 *  link is a single-use, time-boxed reset page in the SPA. `appUrl` comes
 *  from appUrlFrom(req) exactly like the 3g-4 emails, so the link points at
 *  the origin the user actually came from (production fallback otherwise). */
export function sendPasswordResetEmail(opts: {
  to: string;
  appUrl: string;
  token: string;
}): Promise<void> {
  const resetUrl = `${opts.appUrl}/#/reset?token=${opts.token}`;
  const text = [
    "Hi there,",
    "",
    "We got a request to reset your Elevate Studio password. Open the link below to choose a new one:",
    "",
    resetUrl,
    "",
    "This link works for 45 minutes and can only be used once.",
    "",
    "If you didn't ask to reset your password, you can safely ignore this email — your password won't change.",
    "",
    "— Elevate Studio",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: "Reset your password",
    text,
  });
}

/** Native e-signature (owner direction 2026-08-15) — the client's unique
 *  agreement signing link. The token appears ONLY in this email (the server
 *  stores its SHA-256 hash); the link is one-time use and expires after 30
 *  days. `appUrl` comes from appUrlFrom(req) exactly like the 3g-4 emails. */
export function sendAgreementEmail(opts: {
  to: string;
  clientName: string;
  appUrl: string;
  token: string;
}): Promise<void> {
  const signUrl = `${opts.appUrl}/sign/${opts.token}`;
  const text = [
    `Hi ${opts.clientName},`,
    "",
    "Good news — your agreement with Elevate Studio is ready to review and sign.",
    "",
    "Open the link below to read the agreement and sign it electronically:",
    "",
    signUrl,
    "",
    "The link is unique to you, works once, and expires in 30 days.",
    "",
    "If you have any questions, just reply to this email.",
    "",
    "— Elevate Studio",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: "Your agreement is ready to sign",
    text,
  });
}
