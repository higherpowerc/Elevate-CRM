/**
 * Phase A2 — Wholesale Offer Package Generator (owner direction 2026-09-05;
 * builds on the Phase A1 wholesale Properties view + MAO custom field).
 *
 * POST /api/clients/:id/offer-package generates ONE PDF per wholesale
 * property ("Offer Package — <Property address>", US Letter, Helvetica, the
 * same pdf-lib conventions as server/agreements.ts) containing:
 *   (a) an MAO worksheet — the standard "70% rule": computed MAO (Max
 *       Allowable Offer) = ARV × 0.70 - Repair estimate, shown WITH the math
 *       (the ARV line, the × 0.70 line and the repair-estimate deduction are
 *       each their own labelled row); when the record's "Max allowable offer
 *       (MAO)" custom field has a value, THAT value is the offered amount
 *       (MAO field overrides the computed figure — the worksheet still shows
 *       the computed reference, labelled "Computed 70% reference", and the
 *       used amount is labelled clearly as the offer amount), plus purchase
 *       price, assignment fee, end buyer and closing date;
 *   (b) an offer letter — property address, offered amount in words + figures
 *       (as able), a "valid for" line (14 days) and signature blocks
 *       (buyer/offeror + seller/acceptance).
 *
 * The PDF is stored under <data dir>/offers/<pdfId>.pdf (mirroring
 * <data dir>/agreements/<pdfId>.pdf — same unguessable newPdfId() naming) and
 * is served publicly at /offer-pdf/<pdfId> (the id is the unguessable
 * credential, exactly like /agreement-pdf/<pdfId>).
 *
 * This module does NO auth — the caller (server/api.ts route) is responsible
 * for org-scoping the client record BEFORE calling.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, type ClientRow } from "./db";
import { newPdfId, wrapText } from "./agreements";

/** The wholesale property fields the offer package reads from the record's
 *  custom_fields values (case-insensitive match, same names the Phase A1
 *  Properties view renders). MAO is the override; everything else feeds the
 *  worksheet / letter. */
const OFFER_FIELDS = [
  "Property address",
  "ARV",
  "Repair estimate",
  "Purchase price",
  "Max allowable offer (MAO)",
  "Assignment fee",
  "End buyer",
  "Closing date",
] as const;

/** The "70% rule" multiplier every wholesaler worksheets with — ARV × 0.70
 *  minus repairs is the standard max allowable offer. */
export const OFFER_MAO_MULTIPLIER = 0.7;

/** How long the offer letter stays valid (owner-facing default line). */
export const OFFER_VALID_DAYS = 14;

/** Pull a record's value for one custom field by name (case-insensitive). */
export function cfValue(client: Pick<ClientRow, "custom_fields">, name: string): string {
  try {
    const parsed: unknown = JSON.parse(client.custom_fields);
    if (!Array.isArray(parsed)) return "";
    for (const f of parsed) {
      if (f === null || typeof f !== "object") continue;
      const obj = f as Record<string, unknown>;
      const n = typeof obj.name === "string" ? obj.name : typeof obj.label === "string" ? obj.label : "";
      if (n.trim().toLowerCase() === name.trim().toLowerCase()) {
        return typeof obj.value === "string" ? obj.value : "";
      }
    }
  } catch {
    /* keep empty */
  }
  return "";
}

/** Parse a money custom-field value: strips any $, commas and surrounding
 *  whitespace, then Number(). Returns null when it does not parse to a
 *  finite non-negative number (missing/blank/unusable). */
export function parseMoney(value: string): number | null {
  const cleaned = String(value ?? "").replace(/[$,]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** US-dollar formatting for the document (whole dollars + cents, matching the
 *  invoice PDF's convention — $200.00 style). */
export function moneyUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const SMALL_NUMS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** Whole-dollar amount → words (e.g. 187500 → "one hundred eighty-seven
 *  thousand five hundred"). Only used when the amount could not be written in
 *  words as a precise dollar figure; returns "" when it can't (so the letter
 *  falls back to figures only). Groups of three, standard US convention. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) return "";
  if (n === 0) return "zero";
  const g = (v: number): string => {
    if (v === 0) return "";
    const out: string[] = [];
    if (v >= 100) {
      out.push(SMALL_NUMS[Math.floor(v / 100)] + " hundred");
      v %= 100;
      if (v > 0) out.push(v < 20 ? SMALL_NUMS[v] : TENS[Math.floor(v / 10)] + (v % 10 ? "-" + SMALL_NUMS[v % 10] : ""));
    } else if (v >= 20) {
      out.push(TENS[Math.floor(v / 10)] + (v % 10 ? "-" + SMALL_NUMS[v % 10] : ""));
    } else {
      out.push(SMALL_NUMS[v]);
    }
    return out.join(" ");
  };
  const groups: [number, string][] = [[Math.floor(n / 1e9), "billion"], [Math.floor((n % 1e9) / 1e6), "million"], [Math.floor((n % 1e6) / 1000), "thousand"], [n % 1000, ""]];
  const parts: string[] = [];
  for (const [value, label] of groups) {
    const w = g(value);
    if (w) parts.push(w + (label ? " " + label : ""));
  }
  return parts.join(" ");
}

/** US Letter (612 × 792, like the agreement/invoice PDFs), Helvetica text
 *  with word-boundary wrapping, section headers in Helvetica-Bold. Returns
 *  the PDF bytes; the caller persists them in the offers dir. */
export async function generateOfferPdf(input: {
  propertyAddress: string;
  arv: number | null;
  repairEstimate: number | null;
  computedMao: number | null;
  maoField: number | null;
  offeredAmount: number;
  purchasePrice: number | null;
  assignmentFee: number | null;
  endBuyer: string;
  closingDate: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  const size = 10.5;
  const lineHeight = 15;
  const width = 612;
  const height = 792;
  const maxWidth = width - margin * 2;
  let page = doc.addPage([width, height]);

  const title = `Offer Package — ${input.propertyAddress || "Property"}`;

  page.drawText("OFFER PACKAGE", { x: margin, y: height - margin, size: 18, font: bold, color: rgb(0.08, 0.08, 0.1) });
  page.drawText(title, { x: margin, y: height - margin - 22, size: 12, font: bold, color: rgb(0.12, 0.12, 0.14) });
  page.drawText(`Prepared ${new Date().toISOString().slice(0, 10)}`, { x: margin, y: height - margin - 38, size: 9, font, color: rgb(0.45, 0.45, 0.48) });
  let y = height - margin - 60;

  const section = (label: string) => {
    if (y < margin + 34) {
      page = doc.addPage([width, height]);
      y = height - margin;
    }
    page.drawText(label, { x: margin, y, size: 11.5, font: bold, color: rgb(0.05, 0.05, 0.07) });
    y -= 20;
  };
  const draw = (line: string, opts: { bold?: boolean; gray?: boolean; size?: number } = {}) => {
    for (const wrapped of wrapText(line, font, opts.size ?? size, maxWidth)) {
      if (y < margin + lineHeight) {
        page = doc.addPage([width, height]);
        y = height - margin;
      }
      if (wrapped !== "") {
        page.drawText(wrapped, {
          x: margin,
          y,
          size: opts.size ?? size,
          font: opts.bold ? bold : font,
          color: opts.gray ? rgb(0.45, 0.45, 0.48) : rgb(0.12, 0.12, 0.14),
        });
      }
      y -= lineHeight;
    }
  };

  /* ── (a) MAO WORKSHEET ─────────────────────────────────────────────── */
  section("MAO WORKSHEET — 70% RULE");
  draw(`Property address: ${input.propertyAddress || "—"}`);
  draw(`After-repair value (ARV): ${input.arv === null ? "—" : moneyUsd(input.arv)}`);
  draw(`Repair estimate: ${input.repairEstimate === null ? "—" : moneyUsd(input.repairEstimate)}`);
  if (input.computedMao === null) {
    draw("Computed MAO (ARV × 0.70 - repairs): —", { gray: true });
    draw("(Add the ARV and repair estimate to the property record to compute the 70% figure.)", { gray: true });
  } else {
    draw(`Computed MAO (ARV × 0.70 - repairs): ${moneyUsd(input.computedMao)}`, { bold: true });
    draw(`   ARV ${moneyUsd(input.arv ?? 0)} × 0.70 = ${moneyUsd((input.arv ?? 0) * OFFER_MAO_MULTIPLIER)}  minus ${moneyUsd(input.repairEstimate ?? 0)} repairs`, { gray: true });
  }
  if (input.maoField !== null) {
    // MAO field overrides the computed figure — the used offer amount.
    draw(`Max allowable offer (MAO) on record: ${moneyUsd(input.maoField)}`, { bold: true });
    draw("   The recorded MAO overrides the computed figure — this is the offered amount.", { gray: true });
  }
  draw(`OFFER AMOUNT: ${moneyUsd(input.offeredAmount)}`, { bold: true });
  draw(`Purchase price: ${input.purchasePrice === null ? "—" : moneyUsd(input.purchasePrice)}`);
  draw(`Assignment fee: ${input.assignmentFee === null ? "—" : moneyUsd(input.assignmentFee)}`);
  draw(`End buyer: ${input.endBuyer || "—"}`);
  draw(`Closing date: ${input.closingDate || "—"}`);

  /* ── (b) OFFER LETTER ──────────────────────────────────────────────── */
  y -= 14;
  section("OFFER LETTER");
  draw(`Property: ${input.propertyAddress || "—"}`);
  const words = numberToWords(Math.floor(input.offeredAmount));
  if (words !== "") {
    draw(`Offered amount: ${moneyUsd(input.offeredAmount)}  (${words} dollars and 00/100)`, { bold: true });
  } else {
    draw(`Offered amount: ${moneyUsd(input.offeredAmount)}`, { bold: true });
  }
  draw(`This offer is valid for ${OFFER_VALID_DAYS} days from the date above.`);

  y -= 16;
  section("SIGNATURES");
  draw("BUYER / OFFEROR:", { bold: true });
  draw("");
  draw("______________________________", { gray: true });
  draw("Signature — Buyer / Offeror", { size: 9, gray: true });
  draw("______________________________", { gray: true });
  draw("Printed name — Buyer / Offeror", { size: 9, gray: true });
  y -= 16;
  draw("SELLER / ACCEPTANCE:", { bold: true });
  draw("");
  draw("______________________________", { gray: true });
  draw("Signature — Seller", { size: 9, gray: true });
  draw("______________________________", { gray: true });
  draw("Printed name — Seller", { size: 9, gray: true });
  draw("______________________________", { gray: true });
  draw("Date — Seller", { size: 9, gray: true });

  draw("", {});
  draw("By signing, the Seller accepts this offer and agrees to the terms above.", { size: 9, gray: true });

  return doc.save();
}

/** Directory holding generated offer PDFs (alongside the agreements dir in
 *  the same persistent volume). Created on demand. */
export function offersDir(): string {
  const dir = join(dataDir, "offers");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Store offer PDF bytes under a fresh unguessable id; returns the id. */
export function storeOfferPdf(bytes: Uint8Array): string {
  const pdfId = newPdfId();
  writeFileSync(join(offersDir(), `${pdfId}.pdf`), bytes);
  return pdfId;
}

/** Read a stored offer PDF by id, or null when missing (the /offer-pdf public
 *  route 404s on an unknown/missing id). */
export function readOfferPdf(pdfId: string): Uint8Array | null {
  const file = join(offersDir(), `${pdfId}.pdf`);
  if (!existsSync(file)) return null;
  return readFileSync(file);
}