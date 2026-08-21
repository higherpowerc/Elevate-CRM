import { db } from "./db";
import type { AppointmentRow } from "./db";

/**
 * Appointments production (backlog 5a104eae) — PUBLIC Confirm / Reschedule
 * landing pages. The day-before reminder email carries
 * `<appUrl>/appointment/<token>/confirm` and
 * `<appUrl>/appointment/<token>/reschedule` links; the token is the
 * credential (no session), exactly like the /sign/<token> agreement page.
 * These pages render a minimal, clean, branded form that POSTs the JSON
 * action to the existing public API routes in server/api.ts. Scoped by token
 * to a SINGLE appointment — a caller with only the token can never see
 * another appointment's data. Zero client framework; inline CSS so the task
 * works even when the SPA bundle is missing.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MOS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format "YYYY-MM-DDTHH:MM" (local, no tz offset) as "Mon, Jan 5 · 09:00 AM". */
function fmtSlot(slot: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(slot ?? "");
  if (!m) return esc(slot || "");
  const [y, mo, d, hh, mm] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10)];
  const dt = new Date(y, mo - 1, d, hh, mm);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const ap = hh < 12 ? "AM" : "PM";
  return `${WDAYS[dt.getDay()]}, ${MOS[mo - 1]} ${d} · ${h12.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")} ${ap}`;
}

function statusLabel(status: AppointmentRow["status"]): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "confirmed":
      return "Confirmed";
    case "held":
      return "Held";
    case "cancelled":
      return "Cancelled";
    default:
      return "Scheduled";
  }
}

interface PublicAppt extends AppointmentRow {
  clientName: string;
  orgName: string;
}

function findPublicAppointment(token: string): PublicAppt | null {
  if (typeof token !== "string" || token === "" || token.length > 200) return null;
  const r = db
    .query(
      `SELECT a.*, c.company_name AS client_name, o.name AS org_name
         FROM appointments a
         LEFT JOIN clients c ON c.id = a.client_id
         LEFT JOIN orgs o ON o.id = a.org_id
        WHERE a.token = ?`,
    )
    .get(token) as
    | (AppointmentRow & { client_name: string | null; org_name: string | null })
    | undefined;
  if (!r) return null;
  return { ...r, clientName: r.client_name ?? "", orgName: r.org_name ?? "" };
}

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
  .wrap { max-width: 560px; margin: 0 auto; padding: 48px 20px 80px; }
  .brand { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #8b8a84; margin-bottom: 28px; }
  .brand b { color: #d6ff3f; font-weight: 700; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; }
  .sub { color: #a5a49c; margin: 0 0 28px; }
  .card { background: #131316; border: 1px solid #24242a; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; }
  .card .label { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #8b8a84; margin-bottom: 4px; }
  .card .value { font-size: 20px; font-weight: 600; }
  .card .row { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 10px 0; border-bottom: 1px solid #202026; }
  .card .row:last-child { border-bottom: 0; }
  .card .kick { color: #a5a49c; font-size: 14px; }
  .form { background: #131316; border: 1px solid #24242a; border-radius: 12px; padding: 24px 28px; }
  label { display: block; margin-bottom: 16px; font-size: 14px; }
  label span { display: block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #8b8a84; margin-bottom: 6px; }
  input[type=datetime-local] { width: 100%; background: #0a0a0c; color: #f2f1ec; border: 1px solid #33333b; border-radius: 8px; padding: 10px 12px; font-size: 15px; }
  .row { display: flex; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
  button { flex: 1; min-width: 200px; border: 0; border-radius: 10px; padding: 12px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .primary { background: #d6ff3f; color: #0a0a0c; }
  .ghost { background: transparent; color: #f2f1ec; border: 1px solid #3a3a44; }
  .msg { margin-top: 14px; font-size: 14px; }
  .msg.err { color: #ff7a6e; }
  .msg.ok { color: #9ee87a; }
  .final { background: #131316; border: 1px solid #24242a; border-radius: 12px; padding: 28px 30px; }
  .final h2 { margin: 0 0 10px; }
  .stamp { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 3px 12px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 16px; }
  .stamp.green { color: #9ee87a; } .stamp.red { color: #ff7a6e; } .stamp.gray { color: #a5a49c; }
  a { color: #d6ff3f; }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function summaryCard(a: PublicAppt): string {
  return `
    <div class="card">
      <div class="row"><span class="kick">What</span><div class="value">${esc(a.title)}</div></div>
      <div class="row"><span class="kick">When</span><div class="value">${fmtSlot(a.scheduled_at)}</div></div>
      <div class="row"><span class="kick">Duration</span><div class="value">${esc(String(a.duration))} min</div></div>
      ${a.clientName ? `<div class="row"><span class="kick">For</span><div class="value">${esc(a.clientName)}</div></div>` : ""}
      <div class="row"><span class="kick">Status</span><div class="value">${statusLabel(a.status)}</div></div>
    </div>`;
}

export function renderConfirmPage(token: string): Response {
  const a = findPublicAppointment(token);
  if (!a) {
    return page(
      "Link not found",
      `<div class="brand"><b>Revzenta</b> · appointment</div>
       <div class="final"><h2>This link is invalid</h2>
       <p>We couldn't find an appointment for this link. Double-check the link in your email, or contact the sender for a new one.</p></div>`,
    );
  }
  if (a.status === "cancelled") {
    return page(
      "Appointment cancelled",
      `<div class="brand"><b>Revzenta</b> · appointment</div>
       <div class="final"><span class="stamp red">Cancelled</span><h2>This appointment was cancelled</h2>
       <p>Nothing to confirm. If you need a new time, please contact the sender directly.</p></div>`,
    );
  }
  if (a.status !== "scheduled") {
    return page(
      "Appointment confirmed",
      `<div class="brand"><b>Revzenta</b> · appointment</div>
       <div class="final"><span class="stamp green">${statusLabel(a.status)}</span>
       <h2>${a.status === "held" ? "This appointment has been held" : "This appointment is confirmed"}</h2>
       <p>No further action is needed.</p></div>
       ${summaryCard(a)}`,
    );
  }
  const actionUrl = `/api/appointment/${esc(token)}/confirm`;
  return page(
    "Confirm your appointment",
    `<div class="brand"><b>Revzenta</b> · appointment</div>
     <h1>Confirm your appointment</h1>
     <p class="sub">Review the details below, then confirm your spot.</p>
     ${summaryCard(a)}
     <div class="form">
       <button class="primary" id="btn">Confirm appointment</button>
       <div class="msg" id="msg"></div>
     </div>
     <p class="sub" style="margin-top:16px"><a href="/appointment/${esc(token)}/reschedule">Choose a different time</a> · <a href="/">Revzenta</a></p>
     <script>
       const btn = document.getElementById("btn");
       const msgEl = document.getElementById("msg");
       btn.onclick = async () => {
         btn.disabled = true; msgEl.className = "msg"; msgEl.textContent = "";
         try {
           const r = await fetch(${JSON.stringify(actionUrl)}, { method: "POST", headers: { "Content-Type": "application/json" } });
           const d = await r.json();
           if (d.ok) { window.location.reload(); }
           else { msgEl.className = "msg err"; msgEl.textContent = d.error || "Something went wrong."; btn.disabled = false; }
         } catch { msgEl.className = "msg err"; msgEl.textContent = "Network error — please try again."; btn.disabled = false; }
       };
     </script>`,
  );
}

export function renderReschedulePage(token: string): Response {
  const a = findPublicAppointment(token);
  if (!a) {
    return page(
      "Link not found",
      `<div class="brand"><b>Revzenta</b> · appointment</div>
       <div class="final"><h2>This link is invalid</h2>
       <p>We couldn't find an appointment for this link. Double-check the link in your email, or contact the sender for a new one.</p></div>`,
    );
  }
  if (a.status === "cancelled") {
    return page(
      "Appointment cancelled",
      `<div class="brand"><b>Revzenta</b> · appointment</div>
       <div class="final"><span class="stamp red">Cancelled</span><h2>This appointment was cancelled</h2>
       <p>Nothing to reschedule. Please contact the sender directly for a new time.</p></div>`,
    );
  }
  const actionUrl = `/api/appointment/${esc(token)}/reschedule`;
  const current = a.scheduled_at || "";
  return page(
    "Reschedule your appointment",
    `<div class="brand"><b>Revzenta</b> · appointment</div>
     <h1>Reschedule your appointment</h1>
     <p class="sub">Pick a new time. Your old slot is released automatically.</p>
     <div class="card">
       <div class="row"><span class="kick">What</span><div class="value">${esc(a.title)}</div></div>
       <div class="row"><span class="kick">Current time</span><div class="value">${fmtSlot(current)}</div></div>
     </div>
     <div class="form">
       <label>Choose a new time
         <input type="datetime-local" id="slot" value="${esc(current)}" />
       </label>
       <button class="primary" id="btn">Reschedule appointment</button>
       <div class="msg" id="msg"></div>
     </div>
     <p class="sub" style="margin-top:16px"><a href="/appointment/${esc(token)}/confirm">Back to confirm</a> · <a href="/">Revzenta</a></p>
     <script>
       const btn = document.getElementById("btn");
       const slotEl = document.getElementById("slot");
       const msgEl = document.getElementById("msg");
       btn.onclick = async () => {
         const at = slotEl.value;
         if (!at) { msgEl.className = "msg err"; msgEl.textContent = "Please choose a new time."; return; }
         btn.disabled = true; msgEl.className = "msg"; msgEl.textContent = "";
         try {
           const r = await fetch(${JSON.stringify(actionUrl)}, { method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ scheduledAt: at }) });
           const d = await r.json();
           if (d.ok) { window.location.reload(); }
           else { msgEl.className = "msg err"; msgEl.textContent = d.error || "Something went wrong."; btn.disabled = false; }
         } catch { msgEl.className = "msg err"; msgEl.textContent = "Network error — please try again."; btn.disabled = false; }
       };
     </script>`,
  );
}
