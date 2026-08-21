/**
 * 3g-4 — shared email module (client intake + welcome emails).
 *
 * Sends via Resend's built-in test sender (`onboarding@resend.dev`) — no
 * domain purchase needed; a real domain comes at Phase 5. The app must NEVER
 * crash or fail a request because email is not configured: when
 * RESEND_API_KEY is unset, `sendEmail` logs a skip line and returns a
 * non-ok result (never throws), so callers can fire-and-forget it from the
 * provisioning/login paths without touching the request that triggered it.
 *
 * Live-test finding #1 (2026-08-15): Resend's test mode returns HTTP 422 for
 * recipients that aren't the account owner's email, and the app still showed
 * "sent" because the old fire-and-forget `sendEmail` swallowed errors. The
 * return value now carries the outcome (`{ ok: true }` vs `{ ok: false,
 * error }`) so the two user-visible flows the owner hit (account
 * provisioning + agreement send) can surface a real "email failed" state.
 *
 * Reference for the exact Resend call shape (Bearer auth, `from` shape,
 * graceful key-missing handling): /home/team/shared/site/src/lib/contact.ts
 */

const RESEND_API = process.env.RESEND_URL ?? "https://api.resend.com/emails";
/** The sender shown on every 3g-4 email. The PM flips `EMAIL_FROM` via env
 *  once the domain verifies — no code change needed later. */
export const EMAIL_FROM = process.env.EMAIL_FROM ?? "Revzenta <onboarding@revzenta.com>";
/** The exact error returned when RESEND_API_KEY is unset — call sites map it
 *  to the "skipped" emailStatus (deliberate no-op, not a failure). */
export const RESEND_KEY_MISSING_ERROR = "RESEND_API_KEY not configured";
/** Outcome of one sendEmail call. Never throws — every failure path returns
 *  `{ ok: false, error }` so callers can report email failures without
 *  try/catch of their own. */
export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };
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
  /** Phase 5 — optional file attachments (Resend's `attachments` array).
   *  `content` is base64. The e2e mock records them as-is, so the billing
   *  suite asserts the PDF attachment lands. */
  attachments?: { filename: string; content: string; content_type: string }[];
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
 * NEVER rejects: every failure path returns `{ ok: false, error }` so callers
 * can fire and forget without try/catch of their own — and, since the
 * live-test finding, can SEE when a send actually failed (e.g. Resend's 422
 * test-mode rejection) instead of believing it went out.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (!apiKey) {
    console.log(
      `[email] RESEND_API_KEY not configured — skipping ${input.subject} to ${input.to}`,
    );
    return { ok: false, error: RESEND_KEY_MISSING_ERROR };
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
    if (input.attachments && input.attachments.length > 0) body.attachments = input.attachments;
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Resend rejects with a JSON body: { message: "..." } (e.g. the 422
      // test-mode rejection). Surface the message so the UI can show the
      // owner exactly why the email didn't go out.
      const detail = await res.text().catch(() => "");
      let message = detail;
      try {
        const parsed = JSON.parse(detail) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.trim() !== "") {
          message = parsed.message;
        }
      } catch {
        /* non-JSON body — keep the raw text */
      }
      console.error(`[email] Resend returned ${res.status} for "${input.subject}" to ${to}: ${message}`);
      return { ok: false, error: `Resend returned ${res.status}: ${message}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    console.log(`[email] Sent "${input.subject}" to ${to} (resend id: ${data.id ?? "unknown"})`);
    return { ok: true, id: data.id };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error(`[email] Resend request failed for "${input.subject}": ${m}`);
    return { ok: false, error: m };
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
}): Promise<SendEmailResult> {
  const text = [
    "Hi there,",
    "",
    `Great news — your ${opts.orgName} workspace in Revzenta is ready.`,
    "",
    `Sign in here: ${opts.appUrl}`,
    "",
    `Email:    ${opts.loginEmail}`,
    `Password: ${opts.tempPassword}`,
    "",
    "Once you're in, you can finish setting up your workspace: add your clients,",
    "set up your pipeline, and start tracking tasks and invoices.",
    "",
    "Your Revzenta team is here if you need anything.",
    "",
    "— Revzenta",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: "Welcome to Revzenta — your workspace is ready",
    text,
  });
}

/** 3g-4 welcome email — sent once, on the member's first successful login.
 *  Orientation only — deliberately no credentials in this one. */
export function sendWelcomeEmail(opts: {
  to: string;
  orgName: string;
  appUrl: string;
}): Promise<SendEmailResult> {
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
    "— Revzenta",
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
}): Promise<SendEmailResult> {
  const resetUrl = `${opts.appUrl}/#/reset?token=${opts.token}`;
  const text = [
    "Hi there,",
    "",
    "We got a request to reset your Revzenta password. Open the link below to choose a new one:",
    "",
    resetUrl,
    "",
    "This link works for 45 minutes and can only be used once.",
    "",
    "If you didn't ask to reset your password, you can safely ignore this email — your password won't change.",
    "",
    "— Revzenta",
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
}): Promise<SendEmailResult> {
  const signUrl = `${opts.appUrl}/sign/${opts.token}`;
  const text = [
    `Hi ${opts.clientName},`,
    "",
    "Good news — your agreement with Revzenta is ready to review and sign.",
    "",
    "Open the link below to read the agreement and sign it electronically:",
    "",
    signUrl,
    "",
    "The link is unique to you, works once, and expires in 30 days.",
    "",
    "If you have any questions, just reply to this email.",
    "",
    "— Revzenta",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: "Your agreement is ready to sign",
    text,
  });
}

/** Phase 5 prep — Stripe payment link (live-test finding 2026-08-17): the
 *  client's unique payment link for their Revzenta CRM subscription. Sent
 *  only when the payment-link endpoint successfully created the Stripe link
 *  (the caller checks Stripe success BEFORE calling this). The amount is the
 *  OWNER-entered figure at bill time (no hard-coded rates) — it shows in the
 *  email so the client knows what they're approving. */
export function sendPaymentLinkEmail(opts: {
  to: string;
  clientName: string;
  linkUrl: string;
  amountCents?: number;
  interval?: "month" | "one_time";
}): Promise<SendEmailResult> {
  const amountText =
    opts.amountCents && opts.amountCents > 0
      ? `Your ${opts.interval === "one_time" ? "invoice" : "monthly"} amount is ${fmtUsd(opts.amountCents)}.`
      : "";
  const lines = [
    `Hi ${opts.clientName},`,
    "",
    "Your Revzenta CRM subscription is ready to activate.",
    "",
  ];
  if (amountText) lines.push(amountText, "");
  lines.push(
    "Use the secure payment link below to complete your payment:",
    "",
    opts.linkUrl,
    "",
    "The link is unique to you and takes you straight to checkout.",
    "",
    "If you have any questions, just reply to this email.",
    "",
    "— Revzenta",
  );
  return sendEmail({
    to: opts.to,
    subject: "Your payment link for Revzenta CRM",
    text: lines.join("\n"),
  });
}

/** Arizona MST helpers — demo times are stored as naive "YYYY-MM-DDTHH:MM"
 *  Arizona wall-clock strings (UTC-7, no DST), so we format them with pure
 *  string math — never through a Date/timezone object, so the time can't
 *  shift into the reader's timezone. Mirrors src/demoTime.ts on the client. */
function fmtMstTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return hhmm;
  const hh = parseInt(m[1], 10);
  const mm = m[2];
  const ap = hh >= 12 ? "PM" : "AM";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${mm} ${ap} MST`;
}
const MST_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
/** "2026-08-26T16:00" -> "Wed, Aug 26 at 4:00 PM MST (Arizona, UTC-7, no DST)" */
function fmtMstDateTime(dt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})$/.exec((dt ?? "").trim());
  if (!m) return dt;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, mo - 1, d, 12).getDay()];
  return `${dow}, ${MST_MONTHS[mo - 1]} ${d}, ${y} at ${fmtMstTime(`${m[4]}:${m[5]}`)} (Arizona, UTC-7, no DST)`;
}

/** Owner 2026-08-20 sales rework — demo-call confirmation email. Sent when
 *  the owner clicks "Schedule Demo" on a lead: the prospect gets the date/time
 *  of their Revzenta demo call (Arizona MST), the pasted meeting link
 *  (Zoom/Google Meet) if provided, and a short calendar line. We do NOT
 *  integrate Zoom/Google APIs — purely "send the provided link in the invite
 *  email". Fire-and-forget (sendEmail never throws) — a delivery failure is
 *  surfaced to the owner as a notice, never a crash. */
export function sendDemoCallEmail(opts: {
  to: string;
  clientName: string;
  scheduledAt: string;
  meetingLink?: string;
}): Promise<SendEmailResult> {
  const when = fmtMstDateTime(opts.scheduledAt);
  const text: string[] = [
    `Hi ${opts.clientName},`,
    "",
    "Thanks for your interest in Revzenta CRM.",
    "",
    `Your demo call is scheduled for ${when}.`,
  ];
  if (opts.meetingLink) {
    text.push("", `Join the meeting here: ${opts.meetingLink}`, "");
  }
  text.push(
    "Calendar: add this to your calendar — " + when + " Revzenta demo call.",
    "",
    "We'll go over how Revzenta can help you capture and manage your leads.",
    "",
    "If you need to reschedule, just reply to this email.",
    "",
    "— Revzenta",
  );
  return sendEmail({
    to: opts.to,
    subject: "Your Revzenta demo call is scheduled",
    text: text.join("\n"),
  });
}

/** Appointments production (backlog 5a104eae) — the day-before "appointment
 *  tomorrow" reminder. The two action links are the credential: each carries
 *  the appointment's unguessable token so the recipient can Confirm (flips
 *  status → confirmed) or Reschedule (pick a new time) WITHOUT logging in.
 *  Fire-and-forget like every transactional email. */
export function sendAppointmentReminderEmail(opts: {
  to: string;
  clientName: string;
  scheduledAt: string;
  confirmUrl: string;
  rescheduleUrl: string;
}): Promise<SendEmailResult> {
  const when = fmtMstDateTime(opts.scheduledAt);
  const text = [
    `Hi ${opts.clientName},`,
    "",
    `A reminder that your appointment with Revzenta is coming up: ${when}.`,
    "",
    "Please confirm so we know you're still coming:",
    opts.confirmUrl,
    "",
    "Need a different time? Reschedule here:",
    opts.rescheduleUrl,
    "",
    "— Revzenta",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: "Your Revzenta appointment is tomorrow",
    text,
  });
}
function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Phase 5 — invoice-paid email. Sent the moment a Stripe webhook records a
 *  real payment: the client gets a short summary + the invoice PDF attached.
 *  `pdfBase64` is the base64 invoice PDF (server/invoices.ts); the mock
 *  Resend the e2e suite uses records the attachment so the suite asserts it. */
export function sendInvoiceEmail(opts: {
  to: string;
  clientName: string;
  amountCents: number;
  paidAt: string;
  invoiceNumber: string;
  pdfBase64: string;
}): Promise<SendEmailResult> {
  const text = [
    `Hi ${opts.clientName},`,
    "",
    `We received your payment of ${fmtUsd(opts.amountCents)} — thank you!`,
    "",
    `Invoice #${opts.invoiceNumber} is paid in full and attached to this email.`,
    "",
    "If you have any questions, just reply to this email.",
    "",
    "— Revzenta",
  ].join("\n");
  return sendEmail({
    to: opts.to,
    subject: `Invoice ${opts.invoiceNumber} is paid — ${fmtUsd(opts.amountCents)} received`,
    text,
    attachments: [
      {
        filename: `invoice-${opts.invoiceNumber}.pdf`,
        content: opts.pdfBase64,
        content_type: "application/pdf",
      },
    ],
  });
}
