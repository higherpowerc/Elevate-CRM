import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir } from "./db";

export interface OfferPdfInput {
  propertyAddress: string;
  sellerName: string;
  sellerEmail: string;
  businessName?: string;
  fontFamily?: string;
  offerType?: "cash" | "subto" | "creative" | "all";
  selectedOffers?: string[];
  cashOfferAmount?: number;
  subtoPurchasePrice?: number;
  subtoDebt?: number;
  subtoCashToSeller?: number;
  subtoMonthlyPayment?: number;
  creativePurchasePrice?: number;
  creativeDownPayment?: number;
  creativeMonthlyPayment?: number;
  creativeInterestRate?: number;
  creativeBalloonYears?: number;
  creativeTotalPaidToSeller?: number;
  closingDays?: number;
  includeAssignability?: boolean;
  rawOfferText?: string;
}

export function offersDir(): string {
  const dir = join(dataDir, "offers");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function newOfferPdfId(): string {
  return randomBytes(16).toString("hex");
}

export function storeOfferPdf(bytes: Uint8Array, pdfId: string): void {
  writeFileSync(join(offersDir(), `${pdfId}.pdf`), bytes);
}

export function readOfferPdf(pdfId: string): Uint8Array | null {
  const file = join(offersDir(), `${pdfId}.pdf`);
  if (!existsSync(file)) return null;
  return readFileSync(file);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    if (raw === "") {
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

export async function generateOfferPdf(input: OfferPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  
  // Font selection: TimesRoman for serif fonts (Georgia, Garamond), Courier for monospace, Helvetica for sans-serif
  const fam = (input.fontFamily || "").toLowerCase();
  let regularFontName = StandardFonts.Helvetica;
  let boldFontName = StandardFonts.HelveticaBold;
  if (fam.includes("georgia") || fam.includes("garamond") || fam.includes("times") || fam.includes("serif")) {
    regularFontName = StandardFonts.TimesRoman;
    boldFontName = StandardFonts.TimesRomanBold;
  } else if (fam.includes("courier") || fam.includes("mono")) {
    regularFontName = StandardFonts.Courier;
    boldFontName = StandardFonts.CourierBold;
  }

  const font = await doc.embedFont(regularFontName);
  const bold = await doc.embedFont(boldFontName);

  let page = doc.addPage([612, 792]); // US Letter 8.5 x 11
  const { width, height } = page.getSize();
  const margin = 50;
  const contentWidth = width - margin * 2;

  const companyName = (input.businessName && input.businessName.trim()) ? input.businessName.trim() : "Elevate Capital";
  const buyerEntity = `${companyName} and/or assigns`;

  // Navy Masthead Header Banner
  page.drawRectangle({
    x: 0,
    y: height - 88,
    width,
    height: 88,
    color: rgb(0.06, 0.09, 0.16), // #0f172a
  });

  // Masthead Cyan Accent Stripe
  page.drawRectangle({
    x: 0,
    y: height - 91,
    width,
    height: 3,
    color: rgb(0.22, 0.74, 0.97), // #38bdf8
  });

  page.drawText(`${companyName.toUpperCase()} · ACQUISITIONS & DISPOSITIONS`, {
    x: margin,
    y: height - 34,
    size: 9,
    font: bold,
    color: rgb(0.58, 0.64, 0.72),
  });

  page.drawText("FORMAL LETTER OF INTENT (LOI)", {
    x: margin,
    y: height - 58,
    size: 18,
    font: bold,
    color: rgb(0.97, 0.98, 0.99),
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const refCode = `LOI-${Math.floor(100000 + Math.random() * 900000)}`;
  page.drawText(`Date: ${todayStr}`, {
    x: width - margin - 150,
    y: height - 42,
    size: 10,
    font: bold,
    color: rgb(0.8, 0.84, 0.88),
  });
  page.drawText(`Ref: ${refCode}`, {
    x: width - margin - 150,
    y: height - 58,
    size: 10,
    font: bold,
    color: rgb(0.22, 0.74, 0.97),
  });

  let y = height - 120;

  // Property & Recipient Info Box (includes Proposed Buyer)
  page.drawRectangle({
    x: margin,
    y: y - 72,
    width: contentWidth,
    height: 75,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.89, 0.91, 0.94),
    borderWidth: 1,
  });

  page.drawText("SUBJECT PROPERTY:", {
    x: margin + 14,
    y: y - 18,
    size: 9.5,
    font: bold,
    color: rgb(0.39, 0.45, 0.55),
  });
  page.drawText(input.propertyAddress || "Subject Property", {
    x: margin + 140,
    y: y - 18,
    size: 10.5,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });

  page.drawText("PROPERTY OWNER:", {
    x: margin + 14,
    y: y - 36,
    size: 9.5,
    font: bold,
    color: rgb(0.39, 0.45, 0.55),
  });
  page.drawText(input.sellerName || input.sellerEmail || "Property Owner", {
    x: margin + 140,
    y: y - 36,
    size: 10.5,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });

  page.drawText("PROPOSED BUYER:", {
    x: margin + 14,
    y: y - 54,
    size: 9.5,
    font: bold,
    color: rgb(0.39, 0.45, 0.55),
  });
  page.drawText(buyerEntity, {
    x: margin + 140,
    y: y - 54,
    size: 10,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });

  y -= 95;

  // Greeting & Salutation
  page.drawText(`Dear ${input.sellerName || "Property Owner"},`, {
    x: margin,
    y,
    size: 11,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });
  y -= 18;

  let selectedList: string[] = [];
  if (Array.isArray(input.selectedOffers) && input.selectedOffers.length > 0) {
    selectedList = input.selectedOffers;
  } else if (input.offerType) {
    if (input.offerType === "all") selectedList = ["cash", "subto", "creative"];
    else selectedList = [input.offerType];
  } else {
    selectedList = ["cash", "subto", "creative"];
  }

  const totalSelected = selectedList.length;

  const introText = totalSelected === 1
    ? `We are pleased to present this formal purchase offer for the real property situated at ${input.propertyAddress || "the address noted above"}. Following a careful analysis of comparable sales, property specifications, and market dynamics, we offer the purchase terms summarized below for your review and consideration:`
    : `We are pleased to present this formal purchase offer for the real property situated at ${input.propertyAddress || "the address noted above"}. Following a careful analysis of comparable sales, property specifications, and market dynamics, we offer the transaction options summarized below for your review and consideration:`;
  for (const line of wrapText(introText, font, 10, contentWidth)) {
    page.drawText(line, { x: margin, y, size: 10, font, color: rgb(0.12, 0.16, 0.23) });
    y -= 14;
  }
  y -= 10;

  // Executive Terms Header
  page.drawRectangle({
    x: margin,
    y: y - 18,
    width: contentWidth,
    height: 22,
    color: rgb(0.95, 0.96, 0.98),
    borderColor: rgb(0.8, 0.83, 0.88),
    borderWidth: 1,
  });
  page.drawText(totalSelected === 1 ? "EXECUTIVE PURCHASE TERMS" : "EXECUTIVE PURCHASE TERMS MATRIX", {
    x: margin + 12,
    y: y - 13,
    size: 9.5,
    font: bold,
    color: rgb(0.2, 0.26, 0.33),
  });
  y -= 26;

  // Draw Offer Tables
  const drawRow = (label: string, value: string, isHeader = false, bgRgb?: [number, number, number]) => {
    if (y < margin + 60) {
      page = doc.addPage([612, 792]);
      y = height - margin;
    }
    const rowHeight = isHeader ? 22 : 18;
    if (bgRgb) {
      page.drawRectangle({
        x: margin,
        y: y - rowHeight + 4,
        width: contentWidth,
        height: rowHeight,
        color: rgb(bgRgb[0], bgRgb[1], bgRgb[2]),
        borderColor: rgb(0.89, 0.91, 0.94),
        borderWidth: 0.5,
      });
    }
    page.drawText(label, {
      x: margin + 10,
      y: y - (isHeader ? 12 : 10),
      size: isHeader ? 9.5 : 9,
      font: isHeader ? bold : font,
      color: isHeader ? rgb(0.06, 0.09, 0.16) : rgb(0.39, 0.45, 0.55),
    });
    page.drawText(value, {
      x: margin + 210,
      y: y - (isHeader ? 12 : 10),
      size: isHeader ? 10 : 9,
      font: bold,
      color: isHeader ? rgb(0.02, 0.44, 0.26) : rgb(0.06, 0.09, 0.16),
    });
    y -= rowHeight;
  };

  let optNumber = 1;

  // Option: Cash
  if (selectedList.includes("cash")) {
    const cashAmt = input.cashOfferAmount ?? 0;
    const days = input.closingDays ?? 14;
    const title = totalSelected > 1 ? `Option ${optNumber++}: ALL-CASH SETTLEMENT` : "PRIMARY ALL-CASH PURCHASE OFFER";
    drawRow(title, `$${cashAmt.toLocaleString()} Net Cash Walkaway`, true, [0.94, 0.99, 0.95]);
    drawRow("Closing Timeline", `Fast ${days}-business-day closing or seller choice`);
    drawRow("Earnest Money Deposit", "$1,000.00 deposited into neutral escrow upon agreement");
    drawRow("Property Condition", "100% As-Is, Where-Is — Zero repairs or cleaning required");
    drawRow("Closing Costs & Fees", "Buyer pays 100% of standard closing costs. Zero commissions.");
    if (input.includeAssignability !== false) {
      drawRow("Contract Vesting", "Buyer and/or assigns (fully assignable without altering seller net)");
    }
    y -= 8;
  }

  // Option: SubTo
  if (selectedList.includes("subto")) {
    const debt = input.subtoDebt ?? 0;
    const cash = input.subtoCashToSeller ?? 0;
    const mo = input.subtoMonthlyPayment ?? 0;
    const title = totalSelected > 1 ? `Option ${optNumber++}: SUBJECT-TO MORTGAGE RELIEF` : "SUBJECT-TO MORTGAGE ASSUMPTION OFFER";
    drawRow(title, `Take Over $${debt.toLocaleString()} Debt + $${cash.toLocaleString()} Cash`, true, [0.94, 0.98, 1.0]);
    drawRow("Monthly Payments Handled", `$${Math.round(mo).toLocaleString()}/mo via third-party loan servicing`);
    drawRow("Credit Protection", "Serviced promptly to safeguard and elevate seller credit score");
    drawRow("Seller Fees", "$0 Realtor commission and $0 seller closing costs");
    if (input.includeAssignability !== false) {
      drawRow("Contract Vesting", "Buyer and/or assigns (fully assignable to holding trust/entity)");
    }
    y -= 8;
  }

  // Option: Seller Financing
  if (selectedList.includes("creative")) {
    const price = input.creativePurchasePrice ?? 0;
    const down = input.creativeDownPayment ?? 0;
    const mo = input.creativeMonthlyPayment ?? 0;
    const rate = input.creativeInterestRate ?? 2.0;
    const balloon = input.creativeBalloonYears ?? 5;
    const total = input.creativeTotalPaidToSeller ?? (price + mo * 12 * balloon);
    const title = totalSelected > 1 ? `Option ${optNumber++}: SELLER FINANCING (MAX RETURN)` : "SELLER FINANCING PURCHASE OFFER";
    drawRow(title, `$${price.toLocaleString()} Total Purchase Price`, true, [0.99, 0.96, 1.0]);
    drawRow("Down Payment at Closing", `$${down.toLocaleString()} cash at settlement`);
    drawRow("Monthly P&I Income", `$${Math.round(mo).toLocaleString()}/month (${rate.toFixed(2)}% rate, ${balloon}-yr balloon)`);
    drawRow("Projected Seller Net Return", `$${Math.round(total).toLocaleString()} total received`);
    if (input.includeAssignability !== false) {
      drawRow("Contract Vesting", "Buyer and/or assigns (fully assignable without altering seller proceeds)");
    }
    y -= 8;
  }

  y -= 6;

  // Dedicated Assignability Clause & Seller Assignment Acknowledgement Box
  if (input.includeAssignability !== false) {
    if (y < margin + 115) {
      page = doc.addPage([612, 792]);
      y = height - margin;
    }

    const boxHeight = 66;
    page.drawRectangle({
      x: margin,
      y: y - boxHeight,
      width: contentWidth,
      height: boxHeight,
      color: rgb(0.96, 0.98, 1.0),
      borderColor: rgb(0.73, 0.82, 0.94),
      borderWidth: 1,
    });

    page.drawText("ASSIGNABILITY CLAUSE & SELLER ASSIGNMENT ACKNOWLEDGEMENT", {
      x: margin + 10,
      y: y - 14,
      size: 9,
      font: bold,
      color: rgb(0.06, 0.28, 0.63),
    });

    const assignText = `Buyer ("${buyerEntity}") expressly reserves the unilateral right to assign this Letter of Intent, purchase contract, and escrow instructions in whole or in part to an affiliated entity, investment partner, or qualified assignee prior to close of escrow. Seller expressly acknowledges and agrees that Buyer is an investment entity and may receive an assignment fee or spread for transferring equitable interest. Seller confirms that Seller's sole financial entitlement is the full agreed-upon net contract purchase price and terms specified herein, and Seller consents to such assignment without objection.`;
    let assignY = y - 26;
    for (const line of wrapText(assignText, font, 7.8, contentWidth - 20)) {
      page.drawText(line, { x: margin + 10, y: assignY, size: 7.8, font, color: rgb(0.18, 0.24, 0.32) });
      assignY -= 9.5;
    }
    y -= (boxHeight + 10);
  }

  // Next Steps Block
  if (y < margin + 115) {
    page = doc.addPage([612, 792]);
    y = height - margin;
  }

  page.drawText("NEXT STEPS & TRANSACTION PROTOCOL:", {
    x: margin,
    y,
    size: 9.5,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });
  y -= 14;

  const protocol = [
    totalSelected === 1
      ? "1. Acceptance: Sign and return this Letter of Intent or reply confirming acceptance."
      : "1. Acceptance: Reply or sign indicating your preferred purchase option.",
    "2. Purchase Agreement: Bilateral contract executed electronically via DocuSign.",
    "3. Title & Escrow: Escrow opened immediately with neutral title company and earnest money deposited.",
    "4. Assignability: Bilateral agreement shall be fully assignable by Buyer to qualified end assignee or entity.",
  ];
  for (const step of protocol) {
    page.drawText(step, { x: margin + 10, y, size: 8.5, font, color: rgb(0.2, 0.26, 0.33) });
    y -= 12;
  }

  y -= 14;

  // Signature Block with Dual Signatures (Buyer + Seller Acknowledgement)
  if (y < margin + 95) {
    page = doc.addPage([612, 792]);
    y = height - margin;
  }

  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.89, 0.91, 0.94),
  });
  y -= 16;

  page.drawText("SUBMITTED BY (BUYER):", {
    x: margin,
    y,
    size: 8.5,
    font: bold,
    color: rgb(0.39, 0.45, 0.55),
  });
  page.drawText("SELLER ACCEPTANCE & ACKNOWLEDGEMENT:", {
    x: margin + 270,
    y,
    size: 8.5,
    font: bold,
    color: rgb(0.39, 0.45, 0.55),
  });
  y -= 14;

  page.drawText("Acquisitions & Transaction Management Team", {
    x: margin,
    y,
    size: 9.5,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });
  page.drawText("Sign below or reply to confirm acceptance:", {
    x: margin + 270,
    y,
    size: 8,
    font,
    color: rgb(0.39, 0.45, 0.55),
  });
  y -= 13;

  page.drawText(buyerEntity, {
    x: margin,
    y,
    size: 8.5,
    font,
    color: rgb(0.39, 0.45, 0.55),
  });
  page.drawText("Signature: ______________________ Date: ________", {
    x: margin + 270,
    y,
    size: 8.5,
    font: bold,
    color: rgb(0.06, 0.09, 0.16),
  });
  y -= 12;

  page.drawText(`${companyName} Acquisitions Division`, {
    x: margin,
    y,
    size: 8,
    font,
    color: rgb(0.58, 0.64, 0.72),
  });
  page.drawText(input.sellerName || "Property Owner of Record", {
    x: margin + 270,
    y,
    size: 8,
    font,
    color: rgb(0.58, 0.64, 0.72),
  });
  y -= 14;

  page.drawText("CONFIDENTIAL & ASSIGNABLE: This Letter of Intent outlines preliminary transaction terms (Buyer and/or assigns) subject to standard bilateral contract and title review.", {
    x: margin,
    y,
    size: 7.2,
    font,
    color: rgb(0.58, 0.64, 0.72),
  });

  return doc.save();
}
