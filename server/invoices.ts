/**
 * Phase 5 — invoice PDF generation (owner direction 2026-08-18).
 *
 * When a Stripe webhook records a real payment, the server auto-flips the
 * client's payment_status to paid AND emails the invoice. This module renders
 * that invoice as a PDF (pdf-lib — the same library the agreement PDF uses)
 * so the emailed invoice is a proper one-page document, not just text.
 *
 * Returns the PDF bytes; the caller embeds them in the Resend email as a
 * base64 attachment (the mock Resend the e2e suite uses records them, so the
 * suite asserts the attachment lands).
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface InvoicePdfInput {
  /** Owner-facing invoice number, e.g. "INV-<clientId>-<yyyyMMdd>". */
  invoiceNumber: string;
  clientName: string;
  contactName: string;
  email: string;
  /** Amount in USD cents (owner-entered at bill time — no hard-coded rates). */
  amountCents: number;
  /** What was billed, e.g. "Revzenta CRM — monthly subscription". */
  description: string;
  /** ISO timestamp of when the payment was recorded. */
  paidAt: string;
}

function centsToUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const fmtWhen = (ts: string): string => {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

/** One-page US Letter invoice with a PAID stamp. Designed to be emailed as a
 *  PDF attachment the moment a Stripe payment is recorded. */
export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  const { width, height } = page.getSize();

  // Brand + title.
  page.drawText("Revzenta", { x: margin, y: height - 26, size: 13, font: bold, color: rgb(0.05, 0.05, 0.07) });
  page.drawText("INVOICE", { x: margin, y: height - 52, size: 22, font: bold, color: rgb(0.05, 0.05, 0.07) });
  page.drawText(`Invoice #${input.invoiceNumber}`, { x: width - margin - 220, y: height - 40, size: 10.5, font: bold, color: rgb(0.2, 0.2, 0.24) });
  page.drawText(`Issued ${new Date().toISOString().slice(0, 10)}`, { x: width - margin - 220, y: height - 58, size: 10, font, color: rgb(0.35, 0.35, 0.38) });

  // Billed-to block.
  page.drawText("Billed to", { x: margin, y: height - 92, size: 9, font: bold, color: rgb(0.3, 0.3, 0.34) });
  page.drawText(input.clientName, { x: margin, y: height - 108, size: 12, font: bold, color: rgb(0.1, 0.1, 0.12) });
  let by = height - 124;
  if (input.contactName) {
    page.drawText(input.contactName, { x: margin, y: by, size: 10.5, font, color: rgb(0.2, 0.2, 0.24) });
    by -= 15;
  }
  if (input.email) {
    page.drawText(input.email, { x: margin, y: by, size: 10.5, font, color: rgb(0.2, 0.2, 0.24) });
  }

  // Line item + total.
  const tableTop = height - 170;
  page.drawText("Description", { x: margin, y: tableTop, size: 9, font: bold, color: rgb(0.3, 0.3, 0.34) });
  page.drawText("Amount", { x: width - margin - 120, y: tableTop, size: 9, font: bold, color: rgb(0.3, 0.3, 0.34) });
  const itemY = tableTop - 22;
  page.drawText(input.description, { x: margin, y: itemY, size: 11, font, color: rgb(0.12, 0.12, 0.14) });
  page.drawText(centsToUsd(input.amountCents), { x: width - margin - 150, y: itemY, size: 11, font: bold, color: rgb(0.12, 0.12, 0.14) });
  page.drawText("Total", { x: margin, y: itemY - 30, size: 10, font: bold, color: rgb(0.2, 0.2, 0.24) });
  page.drawText(centsToUsd(input.amountCents), { x: width - margin - 150, y: itemY - 30, size: 11, font: bold, color: rgb(0.05, 0.05, 0.07) });

  // PAID stamp.
  const stampY = itemY - 74;
  page.drawText("PAID", { x: width - margin - 220, y: stampY + 14, size: 24, font: bold, color: rgb(0.09, 0.55, 0.2) });
  page.drawText(`Received ${fmtWhen(input.paidAt)}  ·  Stripe`, { x: width - margin - 260, y: stampY - 8, size: 9, font, color: rgb(0.35, 0.35, 0.38) });

  page.drawText("Thank you — Revzenta", { x: margin, y: margin + 40, size: 10, font, color: rgb(0.3, 0.3, 0.34) });
  page.drawText("revzenta.com", { x: margin, y: margin + 24, size: 9, font, color: rgb(0.45, 0.45, 0.48) });

  return doc.save();
}