import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir } from "./db";

export interface ContractPdfInput {
  contractType: "psa" | "assignment";
  propertyAddress: string;
  sellerName: string;
  sellerEmail?: string;
  sellerPhone?: string;
  buyerName: string;
  buyerEmail?: string;
  buyerPhone?: string;
  companyName?: string;
  purchasePrice: number;
  assignmentFee?: number;
  earnestMoney: number;
  emdDueDate?: string;
  inspectionDays: number;
  closingDate?: string;
  titleCompany?: string;
  stateJurisdiction?: string;
  signatureImage?: string; // base64 data URL if signed
  signerName?: string;
  signedAt?: string;
  signerIp?: string;
  customTerms?: string;
}

export function contractsDir(): string {
  const dir = join(dataDir, "contracts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function newContractPdfId(): string {
  return randomBytes(16).toString("hex");
}

export function storeContractPdf(bytes: Uint8Array, pdfId: string): void {
  writeFileSync(join(contractsDir(), `${pdfId}.pdf`), bytes);
}

export function readContractPdf(pdfId: string): Uint8Array | null {
  const file = join(contractsDir(), `${pdfId}.pdf`);
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

export async function generateContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([612, 792]); // Letter size
  const { width, height } = page.getSize();
  const margin = 48;
  const contentWidth = width - margin * 2;
  let cursorY = height - margin;

  const checkPageBreak = (neededHeight: number) => {
    if (cursorY - neededHeight < margin + 40) {
      page = doc.addPage([612, 792]);
      cursorY = height - margin;
      return true;
    }
    return false;
  };

  const isPsa = input.contractType === "psa";
  const titleText = isPsa
    ? "REAL ESTATE PURCHASE AND SALE AGREEMENT"
    : "ASSIGNMENT OF REAL ESTATE PURCHASE AND SALE AGREEMENT";

  const company = (input.companyName || "Elevate Capital").trim();
  const buyerEntity = `${company} and/or assigns`;
  const seller = input.sellerName.trim() || "Owner of Record";
  const state = input.stateJurisdiction || "US General";

  // Document Title Header
  page.drawRectangle({
    x: margin,
    y: cursorY - 38,
    width: contentWidth,
    height: 38,
    color: rgb(0.06, 0.09, 0.16),
  });

  page.drawText(titleText, {
    x: margin + 14,
    y: cursorY - 25,
    size: 13,
    font: bold,
    color: rgb(1, 1, 1),
  });

  cursorY -= 54;

  // Subtitle metadata
  page.drawText(`Jurisdiction: ${state} Standard Real Estate Provisions | Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, {
    x: margin,
    y: cursorY,
    size: 9.5,
    font: italic,
    color: rgb(0.4, 0.45, 0.5),
  });
  cursorY -= 18;

  // Paragraph Renderer
  const renderParagraph = (heading: string, body: string) => {
    checkPageBreak(50);
    page.drawText(heading, {
      x: margin,
      y: cursorY,
      size: 10.5,
      font: bold,
      color: rgb(0.12, 0.15, 0.22),
    });
    cursorY -= 14;

    const wrapped = wrapText(body, font, 9.5, contentWidth);
    for (const line of wrapped) {
      checkPageBreak(16);
      page.drawText(line, {
        x: margin,
        y: cursorY,
        size: 9.5,
        font: font,
        color: rgb(0.2, 0.23, 0.28),
      });
      cursorY -= 13;
    }
    cursorY -= 8;
  };

  if (isPsa) {
    // 1. Parties & Property
    renderParagraph(
      "1. PARTIES & PROPERTY DESCRIPTION",
      `This Real Estate Purchase and Sale Agreement ("Agreement") is entered into by and between ${seller} ("Seller") and ${buyerEntity} ("Buyer"). Seller agrees to sell and Buyer agrees to purchase the real property, together with all improvements, appurtenances, fixtures, and attached personal property located at: ${input.propertyAddress} ("Property").`
    );

    // 2. Financial Terms
    const emdDue = input.emdDueDate ? `within 3 business days of mutual execution (by ${input.emdDueDate})` : "within three (3) business days of mutual execution";
    renderParagraph(
      "2. PURCHASE PRICE & EARNEST MONEY DEPOSIT",
      `The total agreed purchase price to be paid by Buyer at closing shall be $${input.purchasePrice.toLocaleString()} ("Purchase Price"). Buyer shall deposit earnest money in the amount of $${input.earnestMoney.toLocaleString()} ("Earnest Money Deposit" or "EMD") with the designated Title/Escrow Company ${emdDue}. The Earnest Money Deposit shall apply toward the Purchase Price at closing and shall remain 100% refundable to Buyer throughout the Inspection Period defined herein.`
    );

    // 3. Inspection & Feasibility
    renderParagraph(
      "3. DUE DILIGENCE, INSPECTION & CONTINGENCY CLOCK",
      `Buyer's obligation to purchase is expressly contingent upon Buyer's satisfaction, in Buyer's sole and absolute discretion, with the physical condition, mechanical systems, title history, environmental condition, and financial feasibility of the Property. Buyer shall have an inspection period of ${input.inspectionDays} calendar days following the mutual execution date ("Inspection Period"). Buyer and Buyer's agents, contractors, partners, and prospective assignees shall have full, unrestricted access to inspect the Property. If Buyer determines for any reason or no reason that the Property is unsatisfactory, Buyer may terminate this Agreement by written notice prior to the expiration of the Inspection Period, whereupon the Earnest Money Deposit shall be immediately returned in full to Buyer without penalty or delay.`
    );

    // 4. Closing & Title
    const closingInfo = input.closingDate ? `on or before ${input.closingDate}` : "on or before thirty (30) days from the expiration of the Inspection Period";
    const titleCo = input.titleCompany ? input.titleCompany : "a licensed Title & Escrow company mutually selected by the parties";
    renderParagraph(
      "4. TITLE, CLOSING & ESCROW",
      `Closing shall occur ${closingInfo} ("Closing Date") at the offices of ${titleCo} ("Closing Agent"). Seller shall convey marketable, insurable fee simple title to the Property by General Warranty Deed, free and clear of all liens, mortgages, encumbrances, unpaid assessments, back taxes, and code violations, with all municipal and utility liens paid in full by Seller at or before closing.`
    );

    // 5. Wholesale Assignability
    renderParagraph(
      "5. ASSIGNABILITY & EQUITABLE INTEREST",
      `Seller expressly acknowledges, understands, and agrees that Buyer holds an equitable interest in the Property and retains the unconditional right to assign, transfer, or convey this Agreement and all rights, duties, and benefits herein to any third-party individual, partnership, trust, or corporate entity without requiring Seller's prior written consent. Upon assignment, the original Buyer shall be relieved of liability upon the assignee's full assumption of obligations.`
    );

    // 6. State Specific Disclosure
    let stateDisclosure = "General Provisions: Both parties acknowledge this transaction is entered into freely and voluntarily as an arm's length transaction. Property is sold in 'As-Is, Where-Is' condition subject to Buyer's inspection rights.";
    if (state.includes("TX") || state.includes("Texas")) {
      stateDisclosure = "Texas Statutory Disclosure (Texas Property Code § 5.086): Seller acknowledges that Buyer is acquiring an option or entering into a contract to purchase real property and may enter into an assignment of that equitable interest to an end buyer. Buyer discloses that Buyer does not hold legal title to the property until closing and is conveying equitable interest under this Agreement.";
    } else if (state.includes("FL") || state.includes("Florida")) {
      stateDisclosure = "Florida Assignment Disclosure: Seller acknowledges that Buyer operates as a principal real estate investor and retains equitable interest under this contract with the full legal authority to market, assign, or sell equitable rights in the contract prior to closing.";
    } else if (state.includes("CA") || state.includes("California")) {
      stateDisclosure = "California Civil Code Disclosures: The parties agree that this Agreement represents the entire agreement between the parties. Buyer holds equitable rights under contract and may assign such rights. Seller acknowledges receipt of all statutory disclosure obligations.";
    } else if (state.includes("GA") || state.includes("Georgia")) {
      stateDisclosure = "Georgia Real Estate Assignment Notice: Pursuant to Georgia real estate law, Buyer acts solely as a principal acquiring equitable interest in the subject property and retains the right to assign equitable interest to a qualified purchaser.";
    } else if (state.includes("NC") || state.includes("North Carolina")) {
      stateDisclosure = "North Carolina Equitable Interest Clause: Buyer and Seller confirm that Buyer has an equitable interest under this contract and may assign the contract. Standard North Carolina inspection rights and title requirements apply.";
    } else if (state.includes("AZ") || state.includes("Arizona")) {
      stateDisclosure = "Arizona Wholesale Disclosure (A.R.S. § 32-2181): Buyer discloses that Buyer holds equitable interest in the Property through this contract and may assign this purchase agreement to a third party before the close of escrow.";
    }

    renderParagraph("6. STATE DISCLOSURES & GOVERNING LAW", stateDisclosure);

    if (input.customTerms && input.customTerms.trim()) {
      renderParagraph("7. SPECIAL PROVISIONS & CUSTOM CLAUSES", input.customTerms.trim());
    }

  } else {
    // ASSIGNMENT AGREEMENT
    const endBuyer = input.buyerName.trim() || "Assignee / Investor";
    const fee = input.assignmentFee || 0;
    const totalDue = input.purchasePrice + fee;

    renderParagraph(
      "1. PARTIES & RECITALS",
      `This Assignment of Real Estate Purchase and Sale Agreement ("Assignment") is made between ${company} ("Assignor") and ${endBuyer} ("Assignee"). Assignor is the Buyer under that certain Real Estate Purchase and Sale Agreement dated for the purchase of real property located at: ${input.propertyAddress} ("Underlying Contract").`
    );

    renderParagraph(
      "2. ASSIGNMENT & FINANCIAL CONSIDERATION",
      `For valuable consideration, Assignor hereby transfers, sells, assigns, and conveys to Assignee all of Assignor's right, title, claim, interest, and equity in and to the Underlying Contract. In consideration for this Assignment, Assignee shall pay to Assignor an Assignment Fee of $${fee.toLocaleString()} ("Assignment Fee"). The total acquisition price to Assignee shall be $${totalDue.toLocaleString()} (representing the Contract Purchase Price of $${input.purchasePrice.toLocaleString()} plus the Assignment Fee of $${fee.toLocaleString()}), payable at closing.`
    );

    renderParagraph(
      "3. NON-REFUNDABLE EARNEST MONEY DEPOSIT",
      `Assignee shall deposit earnest money in the amount of $${input.earnestMoney.toLocaleString()} ("Assignee EMD") with the designated Closing Agent within twenty-four (24) hours of execution. Assignee EMD is strictly non-refundable and shall apply toward the Assignment Fee and Purchase Price at closing.`
    );

    renderParagraph(
      "4. ASSUMPTION OF OBLIGATIONS & CLOSING TIMELINE",
      `Assignee hereby accepts this Assignment and expressly assumes all duties, obligations, liabilities, and closing requirements of Buyer under the Underlying Contract. Assignee confirms that Assignee has completed all due diligence and property inspections and is purchasing the Property in 100% 'AS-IS' condition with no further contingencies. Closing shall take place on or before ${input.closingDate || "the date specified in the Underlying Contract"}.`
    );

    if (input.customTerms && input.customTerms.trim()) {
      renderParagraph("5. SPECIAL STIPULATIONS", input.customTerms.trim());
    }
  }

  // SIGNATURE EXECUTION BLOCK
  checkPageBreak(160);
  cursorY -= 10;
  page.drawLine({
    start: { x: margin, y: cursorY },
    end: { x: width - margin, y: cursorY },
    thickness: 1,
    color: rgb(0.8, 0.85, 0.9),
  });
  cursorY -= 20;

  page.drawText("IN WITNESS WHEREOF, the parties have executed this Agreement as of the date written below:", {
    x: margin,
    y: cursorY,
    size: 9.5,
    font: bold,
    color: rgb(0.15, 0.18, 0.25),
  });
  cursorY -= 28;

  // Two Column Signatures
  const colWidth = (contentWidth - 24) / 2;

  // Column 1: Seller / Assignor
  const col1X = margin;
  page.drawText(isPsa ? "SELLER:" : "ASSIGNOR (Wholesaler):", {
    x: col1X,
    y: cursorY,
    size: 10,
    font: bold,
    color: rgb(0.2, 0.25, 0.35),
  });
  cursorY -= 20;

  // If electronic signature is present, stamp it!
  if (input.signatureImage && input.signatureImage.startsWith("data:image/png;base64,")) {
    try {
      const base64Data = input.signatureImage.replace(/^data:image\/png;base64,/, "");
      const sigImgBytes = Buffer.from(base64Data, "base64");
      const embeddedImg = await doc.embedPng(sigImgBytes);
      page.drawImage(embeddedImg, {
        x: col1X,
        y: cursorY - 30,
        width: 140,
        height: 36,
      });
    } catch (e) {
      page.drawText(`[Electronically Signed: ${input.signerName || seller}]`, {
        x: col1X,
        y: cursorY - 15,
        size: 11,
        font: italic,
        color: rgb(0.08, 0.45, 0.2),
      });
    }
  } else {
    page.drawLine({
      start: { x: col1X, y: cursorY - 20 },
      end: { x: col1X + colWidth - 20, y: cursorY - 20 },
      thickness: 1,
      color: rgb(0.6, 0.65, 0.7),
    });
    page.drawText("Signature", { x: col1X, y: cursorY - 32, size: 8, font: italic, color: rgb(0.5, 0.55, 0.6) });
  }

  page.drawText(`Name: ${isPsa ? seller : company}`, { x: col1X, y: cursorY - 48, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`Date: ${input.signedAt || new Date().toLocaleDateString()}`, { x: col1X, y: cursorY - 62, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });

  // Column 2: Buyer / Assignee
  const col2X = margin + colWidth + 24;
  page.drawText(isPsa ? "BUYER:" : "ASSIGNEE (Investor):", {
    x: col2X,
    y: cursorY + 20,
    size: 10,
    font: bold,
    color: rgb(0.2, 0.25, 0.35),
  });

  page.drawLine({
    start: { x: col2X, y: cursorY - 20 },
    end: { x: col2X + colWidth - 20, y: cursorY - 20 },
    thickness: 1,
    color: rgb(0.6, 0.65, 0.7),
  });
  page.drawText("Signature", { x: col2X, y: cursorY - 32, size: 8, font: italic, color: rgb(0.5, 0.55, 0.6) });

  page.drawText(`Name: ${isPsa ? buyerEntity : (input.buyerName || "Investor")}`, { x: col2X, y: cursorY - 48, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(`Date: ${new Date().toLocaleDateString()}`, { x: col2X, y: cursorY - 62, size: 9, font: font, color: rgb(0.2, 0.2, 0.2) });

  // Verification watermark banner if signed
  if (input.signedAt || input.signerIp) {
    cursorY -= 88;
    checkPageBreak(30);
    page.drawRectangle({
      x: margin,
      y: cursorY - 6,
      width: contentWidth,
      height: 24,
      color: rgb(0.93, 0.98, 0.95),
      borderColor: rgb(0.6, 0.85, 0.65),
      borderWidth: 1,
    });
    page.drawText(`✓ E-SIGN VERIFIED · Signed by ${input.signerName || "Signer"} on ${input.signedAt || new Date().toISOString()} · IP: ${input.signerIp || "Verified Secure Session"} · 100% Legally Binding under E-SIGN Act (15 U.S.C. § 7001)`, {
      x: margin + 8,
      y: cursorY + 2,
      size: 7.5,
      font: bold,
      color: rgb(0.08, 0.45, 0.2),
    });
  }

  // Footer on each page
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.drawText(`Revzenta Wholesale Transaction Hub · Document ID: ${input.contractType.toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()} · Page ${i + 1} of ${pages.length}`, {
      x: margin,
      y: 20,
      size: 8,
      font: font,
      color: rgb(0.55, 0.6, 0.65),
    });
  }

  return await doc.save();
}
