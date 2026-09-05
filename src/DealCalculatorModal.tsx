import { useState, useMemo, useEffect } from "react";
import type { Client } from "./types";
import { api } from "./api";

interface Props {
  property?: Client | null;
  onClose: () => void;
  onUpdated?: (updated: Client) => void;
  crmBusinessName?: string;
}

/** Currency input with fixed $ prefix and automatic comma formatting */
function CurrencyInput({
  label,
  value,
  onChange,
  placeholder = "0",
  helper,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  placeholder?: string;
  helper?: string;
}) {
  const [text, setText] = useState<string>(value ? value.toLocaleString() : "");

  useEffect(() => {
    setText(value ? value.toLocaleString() : "");
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    const num = Number(raw) || 0;
    setText(raw ? Number(raw).toLocaleString() : "");
    onChange(num);
  };

  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="field-label" style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontWeight: 600, fontSize: "12px", color: "#f8fafc" }}>{label}</span>
        {helper && <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{helper}</span>}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span
          style={{
            position: "absolute",
            left: "11px",
            color: "#475569",
            fontSize: "15px",
            fontWeight: 800,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          $
        </span>
        <input
          type="text"
          inputMode="numeric"
          className="input calc-input"
          style={{
            paddingLeft: "26px",
            fontSize: "15px",
            fontWeight: 700,
            background: "#ffffff",
            color: "#000000",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            height: "40px",
            width: "100%",
            boxSizing: "border-box",
          }}
          placeholder={placeholder}
          value={text}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

/** Percentage / numeric input with bold black lettering */
function NumberInput({
  label,
  value,
  onChange,
  suffix = "",
  step = 1,
  helper,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  suffix?: string;
  step?: number;
  helper?: string;
}) {
  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="field-label" style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontWeight: 600, fontSize: "12px", color: "#f8fafc" }}>{label}</span>
        {helper && <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 500 }}>{helper}</span>}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          type="number"
          step={step}
          className="input calc-input"
          style={{
            paddingRight: suffix ? "30px" : "12px",
            paddingLeft: "12px",
            fontSize: "15px",
            fontWeight: 700,
            background: "#ffffff",
            color: "#000000",
            border: "1px solid #cbd5e1",
            borderRadius: "6px",
            height: "40px",
            width: "100%",
            boxSizing: "border-box",
          }}
          value={value === 0 ? "" : value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {suffix && (
          <span
            style={{
              position: "absolute",
              right: "11px",
              color: "#475569",
              fontSize: "14px",
              fontWeight: 700,
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export default function DealCalculatorModal({ property, onClose, onUpdated, crmBusinessName }: Props) {
  const [tab, setTab] = useState<"subto" | "creative" | "cash" | "offer">("offer");

  // Property info
  const [propertyAddress, setPropertyAddress] = useState(property?.companyName || "");
  const [sellerName, setSellerName] = useState(property?.contactName || "");
  const [recipientEmail, setRecipientEmail] = useState(property?.email || "");
  const [businessName, setBusinessName] = useState(crmBusinessName || "");
  const [showPropertyEdit, setShowPropertyEdit] = useState<boolean>(false);
  const [showJuniorLiens, setShowJuniorLiens] = useState<boolean>(false);
  const [showAdvancedExpenses, setShowAdvancedExpenses] = useState<boolean>(false);

  useEffect(() => {
    if (!businessName) {
      api.settings().then((s) => {
        if (s.settings?.orgName) {
          setBusinessName(s.settings.orgName);
        }
      }).catch(() => {});
    }
  }, []);

  // Initial values from existing custom fields or sheet defaults
  const initialData = useMemo(() => {
    let arv = 250000;
    let repairs = 35000;
    let fee = 10000;
    let rule = 70;
    let purchasePrice = 500000;
    let listedPrice = 400000;
    let downPayment = 12000;
    let rate = 2.0;

    if (property?.dealValue && property.dealValue > 50000) {
      arv = property.dealValue;
      purchasePrice = property.dealValue;
      listedPrice = Math.round(property.dealValue * 0.8);
    }

    if (property?.customFields) {
      for (const cf of property.customFields) {
        const n = cf.name.toLowerCase();
        const v = Number(cf.value.replace(/[^0-9.]/g, ""));
        if (!isNaN(v) && v > 0) {
          if (n === "arv") arv = v;
          if (n === "repairs") repairs = v;
          if (n === "assignment fee") fee = v;
          if (n === "investor rule") rule = v;
          if (n === "purchase price") purchasePrice = v;
          if (n === "listed price") listedPrice = v;
          if (n === "down payment") downPayment = v;
          if (n === "interest rate") rate = v;
        }
      }
    }
    return { arv, repairs, fee, rule, purchasePrice, listedPrice, downPayment, rate };
  }, [property]);

  // ==========================================
  // 1. SELLER FINANCING (CREATIVE OFFER OVEN)
  // ==========================================
  const [purchasePrice, setPurchasePrice] = useState<number>(initialData.purchasePrice);
  const [listedPrice, setListedPrice] = useState<number>(initialData.listedPrice);
  const [downPayment, setDownPayment] = useState<number>(initialData.downPayment);
  const [annualInterestRate, setAnnualInterestRate] = useState<number>(initialData.rate);
  const [amortizationYears, setAmortizationYears] = useState<number>(30);
  const [isInterestOnly, setIsInterestOnly] = useState<boolean>(false);

  const [creativeRehab, setCreativeRehab] = useState<number>(5000);
  const [creativeAssignmentFee, setCreativeAssignmentFee] = useState<number>(10000);
  const [creativeClosingCosts, setCreativeClosingCosts] = useState<number>(0);
  const [agentCommissionPct, setAgentCommissionPct] = useState<number>(1.0);

  const [monthlyRent, setMonthlyRent] = useState<number>(3500);
  const [insurance, setInsurance] = useState<number>(100);
  const [propertyTax, setPropertyTax] = useState<number>(100);
  const [hoa, setHoa] = useState<number>(50);
  const [otherExpenses, setOtherExpenses] = useState<number>(0);
  const [capexPct, setCapexPct] = useState<number>(10);
  const [managementPct, setManagementPct] = useState<number>(10);
  const [vacancyPct, setVacancyPct] = useState<number>(0);
  const [balloonYears, setBalloonYears] = useState<number>(5);

  const creativeCalculations = useMemo(() => {
    const loanAmount = Math.max(0, purchasePrice - downPayment);
    const downPct = purchasePrice > 0 ? (downPayment / purchasePrice) * 100 : 0;

    let monthlyPmt = 0;
    const r = (annualInterestRate / 100) / 12;
    const n = amortizationYears * 12;

    if (isInterestOnly) {
      monthlyPmt = loanAmount * r;
    } else if (r === 0) {
      monthlyPmt = n > 0 ? loanAmount / n : 0;
    } else {
      monthlyPmt = (loanAmount * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
    }
    const annualPayment = monthlyPmt * 12;

    const totalBuyerEntryFee = downPayment + creativeRehab + creativeAssignmentFee + creativeClosingCosts;
    const entryFeePct = purchasePrice > 0 ? (totalBuyerEntryFee / purchasePrice) * 100 : 0;

    const agentCommissionAmount = purchasePrice * (agentCommissionPct / 100);
    const cashToSellerAfterCommission = downPayment - agentCommissionAmount;

    const capexAmount = monthlyRent * (capexPct / 100);
    const managementAmount = monthlyRent * (managementPct / 100);
    const vacancyAmount = monthlyRent * (vacancyPct / 100);

    const monthlyOperatingExpenses =
      monthlyPmt + insurance + propertyTax + hoa + otherExpenses + capexAmount + managementAmount + vacancyAmount;
    const annualOperatingExpenses = monthlyOperatingExpenses * 12;

    const netMonthlyCashFlow = monthlyRent - monthlyOperatingExpenses;
    const netAnnualCashFlow = netMonthlyCashFlow * 12;

    const cashOnCashReturn = totalBuyerEntryFee > 0 ? (netAnnualCashFlow / totalBuyerEntryFee) * 100 : 0;

    const balloonMonths = balloonYears * 12;
    let remainingBalance = loanAmount;
    let totalInterestPaid = 0;
    let totalPrincipalPaid = 0;

    if (isInterestOnly) {
      totalInterestPaid = monthlyPmt * balloonMonths;
      totalPrincipalPaid = 0;
      remainingBalance = loanAmount;
    } else if (r === 0) {
      const monthlyPrinc = n > 0 ? loanAmount / n : 0;
      totalPrincipalPaid = monthlyPrinc * balloonMonths;
      remainingBalance = Math.max(0, loanAmount - totalPrincipalPaid);
    } else {
      for (let m = 1; m <= balloonMonths; m++) {
        const interestForMonth = remainingBalance * r;
        const principalForMonth = monthlyPmt - interestForMonth;
        totalInterestPaid += interestForMonth;
        totalPrincipalPaid += principalForMonth;
        remainingBalance -= principalForMonth;
      }
      remainingBalance = Math.max(0, remainingBalance);
    }

    const totalPaidToSeller = purchasePrice + totalInterestPaid;
    const sellerProfitOverList = totalPaidToSeller - listedPrice;
    const sellerProfitPct = listedPrice > 0 ? (sellerProfitOverList / listedPrice) * 100 : 0;

    const evalChecks = [
      { label: "Min $200+/mo Cash Flow", value: `$${Math.round(netMonthlyCashFlow).toLocaleString()}/mo`, passed: netMonthlyCashFlow >= 200 },
      { label: "Max Offer Price of $500k", value: `$${purchasePrice.toLocaleString()}`, passed: purchasePrice <= 500000 },
      { label: "Min Cash-on-Cash 13+%", value: `${cashOnCashReturn.toFixed(2)}%`, passed: cashOnCashReturn >= 13 },
      { label: "Max Down Payment 15%", value: `${downPct.toFixed(2)}%`, passed: downPct <= 15 },
      { label: "Max Entry / Offer 15%", value: `${entryFeePct.toFixed(2)}%`, passed: entryFeePct <= 15 },
      { label: "Max Interest Rate 4%", value: `${annualInterestRate.toFixed(2)}%`, passed: annualInterestRate <= 4 },
      { label: "Min Balloon 5 Years", value: `${balloonYears} yrs`, passed: balloonYears >= 5 },
    ];

    return {
      loanAmount,
      downPct,
      monthlyPmt,
      annualPayment,
      totalBuyerEntryFee,
      entryFeePct,
      agentCommissionAmount,
      cashToSellerAfterCommission,
      monthlyOperatingExpenses,
      annualOperatingExpenses,
      netMonthlyCashFlow,
      netAnnualCashFlow,
      cashOnCashReturn,
      totalInterestPaid,
      totalPrincipalPaid,
      remainingBalance,
      totalPaidToSeller,
      sellerProfitOverList,
      sellerProfitPct,
      evalChecks,
    };
  }, [
    purchasePrice,
    listedPrice,
    downPayment,
    annualInterestRate,
    amortizationYears,
    isInterestOnly,
    creativeRehab,
    creativeAssignmentFee,
    creativeClosingCosts,
    agentCommissionPct,
    monthlyRent,
    insurance,
    propertyTax,
    hoa,
    otherExpenses,
    capexPct,
    managementPct,
    vacancyPct,
    balloonYears,
  ]);

  // ==========================================
  // 2. SUBJECT-TO (SUBTO) STATE & MATH
  // ==========================================
  const [subtoPurchasePrice, setSubtoPurchasePrice] = useState<number>(380000);
  const [subtoListedPrice, setSubtoListedPrice] = useState<number>(400000);
  const [cashToSeller, setCashToSeller] = useState<number>(5000);
  const [arrears, setArrears] = useState<number>(0);
  const [subtoRehab, setSubtoRehab] = useState<number>(5000);
  const [subtoAssignmentFee, setSubtoAssignmentFee] = useState<number>(10000);
  const [subtoClosingCosts, setSubtoClosingCosts] = useState<number>(1500);

  const [loan1Balance, setLoan1Balance] = useState<number>(280000);
  const [loan1Rate, setLoan1Rate] = useState<number>(3.25);
  const [loan1MonthlyPmt, setLoan1MonthlyPmt] = useState<number>(1218);

  const [loan2Balance, setLoan2Balance] = useState<number>(40000);
  const [loan2Rate, setLoan2Rate] = useState<number>(5.0);
  const [loan2MonthlyPmt, setLoan2MonthlyPmt] = useState<number>(215);

  const [loan3Balance, setLoan3Balance] = useState<number>(0);
  const [loan3Rate, setLoan3Rate] = useState<number>(0);
  const [loan3MonthlyPmt, setLoan3MonthlyPmt] = useState<number>(0);

  const [subtoRent, setSubtoRent] = useState<number>(2400);
  const [subtoTaxesInsurance, setSubtoTaxesInsurance] = useState<number>(250);
  const [subtoHoa, setSubtoHoa] = useState<number>(50);
  const [subtoBalloonYears, setSubtoBalloonYears] = useState<number>(5);

  const subtoCalculations = useMemo(() => {
    const totalExistingDebt = loan1Balance + loan2Balance + loan3Balance;
    const totalMonthlyDebtService = loan1MonthlyPmt + loan2MonthlyPmt + loan3MonthlyPmt;
    const remainingEquity = Math.max(0, subtoPurchasePrice - totalExistingDebt);
    const equityPct = subtoPurchasePrice > 0 ? (remainingEquity / subtoPurchasePrice) * 100 : 0;

    const totalBuyerEntryFee = cashToSeller + arrears + subtoRehab + subtoAssignmentFee + subtoClosingCosts;
    const entryFeePct = subtoPurchasePrice > 0 ? (totalBuyerEntryFee / subtoPurchasePrice) * 100 : 0;
    const downPaymentPct = subtoPurchasePrice > 0 ? (cashToSeller / subtoPurchasePrice) * 100 : 0;

    const totalMonthlyExpenses = totalMonthlyDebtService + subtoTaxesInsurance + subtoHoa;
    const netMonthlyCashFlow = subtoRent - totalMonthlyExpenses;
    const netAnnualCashFlow = netMonthlyCashFlow * 12;

    const cashOnCashReturn = totalBuyerEntryFee > 0 ? (netAnnualCashFlow / totalBuyerEntryFee) * 100 : 0;

    const evalChecks = [
      {
        label: "Min $150+/mo Cash Flow",
        value: `$${Math.round(netMonthlyCashFlow).toLocaleString()}/mo`,
        passed: netMonthlyCashFlow >= 150,
      },
      {
        label: loan1Balance <= 150000 ? "Loan 1 <= $150k (Max 8%)" : "Loan 1 > $150k (Max 5%)",
        value: `${loan1Rate.toFixed(2)}% ($${loan1Balance.toLocaleString()})`,
        passed: loan1Balance <= 150000 ? loan1Rate <= 8 : loan1Rate <= 5,
      },
      {
        label: "Max Equity of 15%",
        value: `${equityPct.toFixed(1)}% ($${remainingEquity.toLocaleString()})`,
        passed: equityPct <= 15,
      },
      {
        label: "Min Cash-on-Cash -10%+",
        value: `${cashOnCashReturn.toFixed(1)}%`,
        passed: cashOnCashReturn >= -10,
      },
      {
        label: "Max Down to Seller 15%",
        value: `${downPaymentPct.toFixed(1)}% ($${cashToSeller.toLocaleString()})`,
        passed: downPaymentPct <= 15,
      },
      {
        label: "Max Entry / Offer 15%",
        value: `${entryFeePct.toFixed(1)}% ($${totalBuyerEntryFee.toLocaleString()})`,
        passed: entryFeePct <= 15,
      },
    ];

    return {
      totalExistingDebt,
      totalMonthlyDebtService,
      remainingEquity,
      equityPct,
      totalBuyerEntryFee,
      entryFeePct,
      totalMonthlyExpenses,
      netMonthlyCashFlow,
      netAnnualCashFlow,
      cashOnCashReturn,
      evalChecks,
    };
  }, [
    subtoPurchasePrice,
    cashToSeller,
    arrears,
    subtoRehab,
    subtoAssignmentFee,
    subtoClosingCosts,
    loan1Balance,
    loan1Rate,
    loan1MonthlyPmt,
    loan2Balance,
    loan2Rate,
    loan2MonthlyPmt,
    loan3Balance,
    loan3Rate,
    loan3MonthlyPmt,
    subtoRent,
    subtoTaxesInsurance,
    subtoHoa,
  ]);

  // ==========================================
  // 3. CASH WHOLESALE / FIX & FLIP
  // ==========================================
  const [arv, setArv] = useState<number>(initialData.arv);
  const [rulePct, setRulePct] = useState<number>(initialData.rule);
  const [repairs, setRepairs] = useState<number>(initialData.repairs);
  const [cashAssignmentFee, setCashAssignmentFee] = useState<number>(initialData.fee);
  const [buyerClosingCostPct, setBuyerClosingCostPct] = useState<number>(1.05);

  const cashCalculations = useMemo(() => {
    const baseInvestorPrice = Math.max(0, Math.round(arv * (rulePct / 100) - repairs));
    const closingCostAmount = Math.round(arv * (buyerClosingCostPct / 100));
    const maxAllowableOfferAfterClosing = Math.max(0, baseInvestorPrice - closingCostAmount);
    const yourCashOffer = Math.max(0, maxAllowableOfferAfterClosing - cashAssignmentFee);

    return {
      baseInvestorPrice,
      closingCostAmount,
      maxAllowableOfferAfterClosing,
      yourCashOffer,
    };
  }, [arv, rulePct, repairs, cashAssignmentFee, buyerClosingCostPct]);

  // ==========================================
  // 4. PROFESSIONAL EMAIL & FONT CONTROLS
  // ==========================================
  type OfferStructureType = "cash" | "subto" | "creative";
  const [selectedOffers, setSelectedOffers] = useState<OfferStructureType[]>(["cash", "subto", "creative"]);
  const [includeAssignability, setIncludeAssignability] = useState<boolean>(true);
  const [closingDays, setClosingDays] = useState<number>(14);
  const [fontFamily, setFontFamily] = useState<string>("Georgia, serif");
  const [fontSize, setFontSize] = useState<string>("15px");
  const [emailViewMode, setEmailViewMode] = useState<"preview" | "edit">("preview");
  const [subject, setSubject] = useState("");
  const [offerText, setOfferText] = useState("");
  const [formattedHtml, setFormattedHtml] = useState("");

  const toggleOffer = (type: OfferStructureType) => {
    setSelectedOffers((prev) => {
      if (prev.includes(type)) {
        if (prev.length === 1) return prev; // Keep at least one selected
        return prev.filter((t) => t !== type);
      } else {
        return [...prev, type];
      }
    });
  };

  // Sync professional letterhead email
  useEffect(() => {
    const addr = propertyAddress.trim() || property?.companyName || "Subject Property";
    const name = sellerName.trim() || property?.contactName || "Property Owner";
    const company = (businessName && businessName.trim()) ? businessName.trim() : "Revzenta Capital";
    const buyerEntity = `${company} and/or assigns`;
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const refCode = `LOI-${new Date().getFullYear()}-${(property?.id || 101).toString().padStart(4, "0")}`;

    setSubject(`LETTER OF INTENT: Purchase Proposal for ${addr} (Ref: ${refCode})`);

    // Plain text version
    let plain = `CONFIDENTIAL LETTER OF INTENT (LOI)\n` +
      `Date: ${today}\n` +
      `Reference: ${refCode}\n` +
      `Property: ${addr}\n` +
      `Owner of Record: ${name}\n` +
      `Buyer Entity: ${buyerEntity}\n\n` +
      `Dear ${name},\n\n` +
      `We are pleased to submit this formal Letter of Intent to purchase the real property situated at ${addr}. ` +
      `Our acquisitions team has conducted a preliminary underwriting review based on comparable neighborhood metrics, property condition, and current market dynamics.\n\n`;

    const count = selectedOffers.length;
    let optNum = 1;

    plain += count === 1 ? `EXECUTIVE PURCHASE OFFER TERMS:\n\n` : `EXECUTIVE SUMMARY OF PURCHASE OPTIONS:\n\n`;

    if (selectedOffers.includes("cash")) {
      const header = count > 1 ? `OPTION ${optNum++}: IMMEDIATE ALL-CASH SETTLEMENT` : `PRIMARY PURCHASE OFFER: ALL-CASH SETTLEMENT`;
      plain += `${header}\n` +
        `• Cash Purchase Price: $${cashCalculations.yourCashOffer.toLocaleString()} (Net Cash Walkaway)\n` +
        `• Earnest Money Deposit: $1,000.00 (Deposited into third-party title escrow upon signing)\n` +
        `• Closing Timeline: ${closingDays} business days (or on a mutually agreed date)\n` +
        `• Property Condition: Sold strictly 100% "As-Is, Where-Is" (No cleaning, painting, or repairs required)\n` +
        `• Closing Costs & Broker Fees: Buyer pays 100% of standard closing costs. Zero agent commissions.\n` +
        (includeAssignability ? `• Contract Vesting: Buyer and/or assigns (fully assignable without altering net terms)\n\n` : `\n`);
    }

    if (selectedOffers.includes("subto")) {
      const header = count > 1 ? `OPTION ${optNum++}: SUBJECT-TO MORTGAGE RELIEF` : `PRIMARY PURCHASE OFFER: SUBJECT-TO MORTGAGE RELIEF`;
      plain += `${header}\n` +
        `• Upfront Cash to Seller: $${cashToSeller.toLocaleString()} at closing\n` +
        `• Mortgage Debt Taken Over: $${subtoCalculations.totalExistingDebt.toLocaleString()}\n` +
        `• Monthly Payments Maintained by Buyer: $${Math.round(subtoCalculations.totalMonthlyDebtService).toLocaleString()}/month\n` +
        `• Payment Servicing: Professionally handled via licensed third-party escrow servicing agency\n` +
        `• Credit Protection: Serviced on-time to safeguard and elevate seller credit profile\n` +
        `• Property Condition: Sold strictly "As-Is" with $0 seller commissions or fees\n` +
        (includeAssignability ? `• Contract Vesting: Buyer and/or assigns (fully assignable to holding trust/entity)\n\n` : `\n`);
    }

    if (selectedOffers.includes("creative")) {
      const header = count > 1 ? `OPTION ${optNum++}: PREMIUM SELLER FINANCING (MAX RETURN)` : `PRIMARY PURCHASE OFFER: PREMIUM SELLER FINANCING`;
      plain += `${header}\n` +
        `• Total Purchase Price: $${purchasePrice.toLocaleString()} (Maximum market valuation)\n` +
        `• Down Payment at Closing: $${downPayment.toLocaleString()}\n` +
        `• Monthly Recurring Income: $${Math.round(creativeCalculations.monthlyPmt).toLocaleString()}/month\n` +
        `• Interest Rate & Balloon: ${annualInterestRate.toFixed(2)}% interest, ${balloonYears}-year balloon term\n` +
        `• Total Projected Payout to Seller: $${Math.round(creativeCalculations.totalPaidToSeller).toLocaleString()} (+$${Math.round(creativeCalculations.sellerProfitOverList).toLocaleString()} above listed target)\n` +
        (includeAssignability ? `• Contract Vesting: Buyer and/or assigns (fully assignable without altering seller proceeds)\n\n` : `\n`);
    }

    if (includeAssignability) {
      plain += `ASSIGNABILITY CLAUSE & SELLER ASSIGNMENT ACKNOWLEDGEMENT:\n` +
        `• Assignability: Buyer ("${buyerEntity}") expressly reserves the unilateral right to assign this Letter of Intent, resultant purchase contract, and escrow rights in whole or in part to an affiliated entity, investment partner, or qualified third-party assignee prior to close of escrow.\n` +
        `• Seller Acknowledgement: Seller expressly acknowledges, understands, and agrees that Buyer is a real estate investment principal and may assign its contractual position and receive an assignment fee or spread for transferring equitable interest. Seller confirms that Seller's sole financial entitlement is the full agreed-upon net contract purchase price and terms specified herein, with zero additional claims or commissions, and Seller freely consents to such assignment.\n\n`;
    }

    plain += `CLOSING & TRANSACTION PROTOCOL:\n` +
      (count === 1
        ? `1. Acceptance: If the outlined terms are acceptable, please sign and return this document or confirm your acceptance via email reply.\n`
        : `1. Acceptance: If the outlined terms are acceptable, please sign and return this document or confirm your preferred option via email reply.\n`) +
      `2. Formal Agreement: A formal state-approved Purchase and Sale Agreement will be prepared and transmitted via DocuSign.\n` +
      `3. Escrow Opening: Escrow and title search will open with our third-party title partner with immediate earnest money deposit.\n` +
      (includeAssignability ? `4. Assignability: Bilateral agreement shall be fully assignable by Buyer to qualified end assignee or entity.\n\n` : `\n`) +
      `SELLER ACCEPTANCE & ACKNOWLEDGEMENT:\n` +
      `Accepted & Agreed: _______________________ Date: ____________\n` +
      `${name} (Property Owner of Record)\n\n` +
      `Sincerely,\n` +
      `Acquisitions & Transaction Management Team\n` +
      `${buyerEntity}\n` +
      `${company} Acquisitions Division\n` +
      `Confidentiality Notice: This letter contains preliminary purchase terms and does not constitute a binding real estate conveyance until a definitive bilateral contract is executed by both Buyer and Seller.`;

    setOfferText(plain);

    // Rich Executive HTML Letter
    const htmlOptCount = selectedOffers.length;
    let htmlOptNum = 1;

    const rich = `
    <div style="font-family: ${fontFamily}; font-size: ${fontSize}; line-height: 1.65; color: #1e293b; max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); overflow: hidden;">
      <!-- Corporate Masthead -->
      <div style="background-color: #0f172a; color: #ffffff; padding: 24px 32px; border-bottom: 3px solid #38bdf8;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <div style="font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #94a3b8; font-weight: 700;">${company.toUpperCase()} · ACQUISITIONS & DISPOSITIONS DIVISION</div>
            <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 800; color: #f8fafc; letter-spacing: -0.5px;">FORMAL LETTER OF INTENT</h1>
          </div>
          <div style="text-align: right; font-size: 12px; color: #cbd5e1;">
            <div><strong>Date:</strong> ${today}</div>
            <div style="color: #38bdf8; font-weight: 700; margin-top: 2px;">Ref: ${refCode}</div>
          </div>
        </div>
      </div>

      <!-- Letter Body -->
      <div style="padding: 28px 32px;">
        <!-- Recipient Block -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 18px; margin-bottom: 22px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="width: 140px; color: #64748b; font-weight: 600; padding: 3px 0;">SUBJECT PROPERTY:</td>
              <td style="color: #0f172a; font-weight: 700; padding: 3px 0;">${addr}</td>
            </tr>
            <tr>
              <td style="color: #64748b; font-weight: 600; padding: 3px 0;">PROPERTY OWNER:</td>
              <td style="color: #0f172a; font-weight: 700; padding: 3px 0;">${name}</td>
            </tr>
            <tr>
              <td style="color: #64748b; font-weight: 600; padding: 3px 0;">PROPOSED BUYER:</td>
              <td style="color: #0f172a; font-weight: 700; padding: 3px 0;">${buyerEntity}</td>
            </tr>
          </table>
        </div>

        <p style="margin: 0 0 16px 0;">Dear ${name},</p>
        <p style="margin: 0 0 20px 0;">
          We are pleased to submit this formal Letter of Intent to purchase the property located at <strong>${addr}</strong>. 
          Following our comprehensive property evaluation and local market analysis, we have structured our proposal to provide clarity, transparency, and maximum flexibility for your closing timeline.
        </p>

        <!-- Terms Matrix -->
        <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; margin: 24px 0;">
          <div style="background: #f1f5f9; padding: 10px 16px; font-weight: 700; font-size: 13px; color: #334155; border-bottom: 1px solid #cbd5e1; text-transform: uppercase; letter-spacing: 0.5px;">
            ${htmlOptCount === 1 ? "Executive Purchase Terms" : "Executive Purchase Terms Matrix"}
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tbody>
              ${
                selectedOffers.includes("cash")
                  ? `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  <td style="padding: 12px 16px; font-weight: 700; color: #0f172a; width: 40%;">${htmlOptCount > 1 ? `Option ${htmlOptNum++}: Cash Offer` : "Primary Cash Purchase Offer"}</td>
                  <td style="padding: 12px 16px; color: #16a34a; font-weight: 800; font-size: 15px;">$${cashCalculations.yourCashOffer.toLocaleString()} Net Cash</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                  <td style="padding: 8px 16px; color: #64748b;">Closing Timeline</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">${closingDays} Business Days (or seller preferred date)</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  <td style="padding: 8px 16px; color: #64748b;">Earnest Money Deposit</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">$1,000.00 (Held in escrow at Title)</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                  <td style="padding: 8px 16px; color: #64748b;">Commissions & Fees</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">$0.00 (Buyer pays all standard closing fees)</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  <td style="padding: 8px 16px; color: #64748b;">Property Condition</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">100% As-Is, Where-Is (Zero repair obligations)</td>
                </tr>
                ${
                  includeAssignability
                    ? `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                  <td style="padding: 8px 16px; color: #64748b;">Contract Vesting</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">Buyer and/or assigns (Fully assignable without altering seller net)</td>
                </tr>
                `
                    : ""
                }
              `
                  : ""
              }

              ${
                selectedOffers.includes("subto")
                  ? `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #f0f9ff;">
                  <td style="padding: 12px 16px; font-weight: 700; color: #0369a1; width: 40%;">${htmlOptCount > 1 ? `Option ${htmlOptNum++}: Subject-To Relief` : "Subject-To Mortgage Assumption"}</td>
                  <td style="padding: 12px 16px; color: #0284c7; font-weight: 800; font-size: 15px;">Take Over $${subtoCalculations.totalExistingDebt.toLocaleString()} Debt + $${cashToSeller.toLocaleString()} Cash</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  <td style="padding: 8px 16px; color: #64748b;">Monthly Payments Handled</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">$${Math.round(subtoCalculations.totalMonthlyDebtService).toLocaleString()}/month through Escrow Servicing</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                  <td style="padding: 8px 16px; color: #64748b;">Credit Protection</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">Serviced on-time by licensed loan servicer to safeguard credit profile</td>
                </tr>
                ${
                  includeAssignability
                    ? `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  <td style="padding: 8px 16px; color: #64748b;">Contract Vesting</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">Buyer and/or assigns (Fully assignable to holding trust/entity)</td>
                </tr>
                `
                    : ""
                }
              `
                  : ""
              }

              ${
                selectedOffers.includes("creative")
                  ? `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #fdf4ff;">
                  <td style="padding: 12px 16px; font-weight: 700; color: #7e22ce; width: 40%;">${htmlOptCount > 1 ? `Option ${htmlOptNum++}: Seller Financing` : "Seller Financing Purchase Offer"}</td>
                  <td style="padding: 12px 16px; color: #9333ea; font-weight: 800; font-size: 15px;">$${purchasePrice.toLocaleString()} Total Purchase Price</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  <td style="padding: 8px 16px; color: #64748b;">Down Payment at Closing</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">$${downPayment.toLocaleString()}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                  <td style="padding: 8px 16px; color: #64748b;">Monthly P&I Income to You</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">$${Math.round(creativeCalculations.monthlyPmt).toLocaleString()}/mo (${annualInterestRate.toFixed(2)}% rate, ${balloonYears}-yr balloon)</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  <td style="padding: 8px 16px; color: #64748b;">Total Net Seller Return</td>
                  <td style="padding: 8px 16px; color: #16a34a; font-weight: 700;">$${Math.round(creativeCalculations.totalPaidToSeller).toLocaleString()} (+$${Math.round(creativeCalculations.sellerProfitOverList).toLocaleString()} over list)</td>
                </tr>
                ${
                  includeAssignability
                    ? `
                <tr style="background: #f8fafc;">
                  <td style="padding: 8px 16px; color: #64748b;">Contract Vesting</td>
                  <td style="padding: 8px 16px; color: #0f172a; font-weight: 600;">Buyer and/or assigns (Fully assignable without altering seller proceeds)</td>
                </tr>
                `
                    : ""
                }
              `
                  : ""
              }
            </tbody>
          </table>
        </div>

        ${
          includeAssignability
            ? `
        <!-- Assignability & Seller Acknowledgement Box -->
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #16a34a; border-radius: 6px; padding: 14px 18px; margin: 20px 0;">
          <div style="font-weight: 800; font-size: 13px; color: #166534; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <span>⚖️</span>
            <span>Assignability Clause & Seller Assignment Acknowledgement</span>
          </div>
          <p style="margin: 0 0 8px 0; font-size: 12px; color: #1e293b; line-height: 1.55;">
            Buyer (<strong>${buyerEntity}</strong>) expressly reserves the unilateral right to assign this Letter of Intent, resultant purchase contract, and escrow instructions in whole or in part to an affiliated entity, investment partner, or qualified third-party assignee prior to close of escrow.
          </p>
          <div style="background: #ffffff; border: 1px solid #dcfce7; border-radius: 4px; padding: 10px 12px; font-size: 11.5px; color: #374151; line-height: 1.5;">
            <strong>Seller Acknowledgement:</strong> Seller expressly acknowledges and agrees that Buyer is an independent real estate investment principal and may earn an assignment fee or spread upon assignment of equitable title. Seller confirms and agrees that Seller's sole financial entitlement is the full agreed-upon net contract purchase price and terms outlined in this agreement, and Seller freely consents to such assignment without objection.
          </div>
        </div>
        `
            : ""
        }

        <p style="margin: 0 0 16px 0; font-weight: 700; color: #0f172a;">Next Steps & Closing Protocol:</p>
        <ol style="margin: 0 0 24px 0; padding-left: 20px; font-size: 13px; color: #334155;">
          ${
            htmlOptCount === 1
              ? `<li style="margin-bottom: 8px;"><strong>Confirmation:</strong> Simply reply to this email or sign the attached Letter of Intent indicating your acceptance.</li>`
              : `<li style="margin-bottom: 8px;"><strong>Confirmation:</strong> Simply reply to this email confirming which option aligns best with your goals.</li>`
          }
          <li style="margin-bottom: 8px;"><strong>Purchase Contract:</strong> We will issue a formal, bilateral Purchase and Sale Agreement for convenient electronic signature via DocuSign.</li>
          <li style="margin-bottom: 8px;"><strong>Escrow & Settlement:</strong> Escrow will be opened immediately at a local, neutral title agency, and earnest money will be deposited.</li>
          ${
            includeAssignability
              ? `<li style="margin-bottom: 8px;"><strong>Assignability & Vesting:</strong> Bilateral purchase agreement shall be held by Buyer and/or assigns with full equitable assignment rights preserved prior to closing.</li>`
              : ""
          }
        </ol>

        <!-- Sign-off Block with Dual Signatures -->
        <div style="margin-top: 28px; padding-top: 18px; border-top: 1px solid #e2e8f0;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px;">
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px;">
              <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Submitted by (Buyer):</div>
              <div style="font-weight: 800; font-size: 13px; color: #0f172a; margin-top: 4px;">Acquisitions Management Team</div>
              <div style="font-size: 12px; color: #64748b;">${buyerEntity}</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${company} Acquisitions Division</div>
            </div>
            <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px 14px;">
              <div style="font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Seller Acceptance & Acknowledgement:</div>
              <div style="font-size: 11.5px; color: #64748b; margin-top: 4px;">Sign below or reply to confirm acceptance:</div>
              <div style="font-size: 12px; color: #0f172a; font-weight: 700; margin-top: 6px;">Signature: ______________________ Date: ________</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${name} (Property Owner)</div>
            </div>
          </div>
          <div style="font-size: 11px; color: #94a3b8; font-style: italic; line-height: 1.5;">
            CONFIDENTIALITY & ASSIGNABILITY NOTICE: This document is intended as a preliminary expression of interest and outlines key transaction terms (Buyer and/or assigns). It does not constitute a binding conveyance of real estate until fully executed definitive purchase contracts are exchanged.
          </div>
        </div>
      </div>
    </div>
    `;

    setFormattedHtml(rich);
  }, [
    selectedOffers,
    includeAssignability,
    propertyAddress,
    sellerName,
    businessName,
    property,
    cashCalculations,
    subtoCalculations,
    creativeCalculations,
    purchasePrice,
    downPayment,
    annualInterestRate,
    balloonYears,
    cashToSeller,
    closingDays,
    fontFamily,
    fontSize,
  ]);

  // Saving state
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSaveCalculation = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const dataToSave = {
        arv,
        repairs,
        assignmentFee: tab === "cash" ? cashAssignmentFee : tab === "subto" ? subtoAssignmentFee : creativeAssignmentFee,
        offerAmount: tab === "cash" ? cashCalculations.yourCashOffer : tab === "subto" ? subtoPurchasePrice : purchasePrice,
        rulePct,
        offerType: tab === "subto" ? "subto" : tab === "creative" ? "seller_finance" : "cash",
        purchasePrice: tab === "subto" ? subtoPurchasePrice : purchasePrice,
        listedPrice: tab === "subto" ? subtoListedPrice : listedPrice,
        downPayment: tab === "subto" ? cashToSeller : downPayment,
        interestRate: tab === "subto" ? loan1Rate : annualInterestRate,
        amortizationYears,
        monthlyPayment: Math.round(tab === "subto" ? subtoCalculations.totalMonthlyDebtService : creativeCalculations.monthlyPmt),
        isInterestOnly,
        balloonYears: tab === "subto" ? subtoBalloonYears : balloonYears,
        balloonBalance: Math.round(tab === "subto" ? subtoCalculations.totalExistingDebt : creativeCalculations.remainingBalance),
        buyerEntryFee: tab === "subto" ? subtoCalculations.totalBuyerEntryFee : creativeCalculations.totalBuyerEntryFee,
        monthlyRent: tab === "subto" ? subtoRent : monthlyRent,
        monthlyCashFlow: Math.round(tab === "subto" ? subtoCalculations.netMonthlyCashFlow : creativeCalculations.netMonthlyCashFlow),
        cashOnCashReturn: Math.round((tab === "subto" ? subtoCalculations.cashOnCashReturn : creativeCalculations.cashOnCashReturn) * 100) / 100,
        subtoTotalDebt: subtoCalculations.totalExistingDebt,
        subtoMonthlyPayment: subtoCalculations.totalMonthlyDebtService,
      };

      if (property) {
        const res = await api.saveDealCalculation(property.id, dataToSave);
        if (res.ok) {
          setStatusMsg({ type: "success", text: "Deal metrics successfully saved to property record!" });
          if (onUpdated) onUpdated(res.client);
        }
      } else {
        const addr = propertyAddress.trim() || "New Property";
        const created = await api.createClient({
          companyName: addr,
          contactName: sellerName.trim(),
          email: recipientEmail.trim(),
          phone: "",
          industry: "Real Estate",
          services: [],
          customFields: [
            { name: "ARV", value: `$${arv.toLocaleString()}` },
            { name: "Offer Structure", value: tab === "subto" ? "Subject-To (SubTo)" : tab === "creative" ? "Seller Finance" : "Cash (MAO)" },
            { name: "Purchase Price", value: `$${(tab === "subto" ? subtoPurchasePrice : purchasePrice).toLocaleString()}` },
            { name: "Down Payment", value: `$${(tab === "subto" ? cashToSeller : downPayment).toLocaleString()}` },
            { name: "Cash Offer", value: `$${cashCalculations.yourCashOffer.toLocaleString()}` },
          ],
          dealValue: arv,
          stage: "Lead",
          nextAction: "Follow up on offer",
          notes: `Underwritten: SubTo $${subtoPurchasePrice.toLocaleString()} | Creative $${purchasePrice.toLocaleString()} | Cash $${cashCalculations.yourCashOffer.toLocaleString()}`,
          archived: false,
          clientType: "residential",
          address: addr,
          city: "",
          state: "",
          zip: "",
        });
        const res = await api.saveDealCalculation(created.client.id, dataToSave);
        setStatusMsg({ type: "success", text: "Property created and deal calculation saved!" });
        if (onUpdated) onUpdated(res.client);
      }
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      setStatusMsg({ type: "error", text: `Failed to save: ${m}` });
    } finally {
      setSaving(false);
    }
  };

  const handleSendOfferEmail = async () => {
    if (!recipientEmail || !recipientEmail.includes("@")) {
      setStatusMsg({ type: "error", text: "Please enter a valid seller email address." });
      return;
    }
    setSending(true);
    setStatusMsg(null);
    try {
      let targetClientId = property?.id;
      if (!targetClientId) {
        const addr = propertyAddress.trim() || "New Property";
        const created = await api.createClient({
          companyName: addr,
          contactName: sellerName.trim(),
          email: recipientEmail.trim(),
          phone: "",
          industry: "Real Estate",
          services: [],
          customFields: [],
          dealValue: arv,
          stage: "Lead",
          nextAction: "Sent purchase offer",
          notes: "Created via Deal Calculator",
          archived: false,
          clientType: "residential",
          address: addr,
          city: "",
          state: "",
          zip: "",
        });
        targetClientId = created.client.id;
        if (onUpdated) onUpdated(created.client);
      }

      const addr = propertyAddress.trim() || property?.companyName || "Subject Property";
      const name = sellerName.trim() || property?.contactName || "Property Owner";

      const res = await api.sendOfferEmail(targetClientId, {
        to: recipientEmail.trim(),
        subject,
        message: offerText,
        html: formattedHtml,
        businessName: businessName.trim() || undefined,
        fontFamily,
        offerType: selectedOffers.length === 1 ? selectedOffers[0] : "all",
        selectedOffers,
        propertyAddress: addr,
        sellerName: name,
        offerAmount: selectedOffers.includes("cash") ? cashCalculations.yourCashOffer : 0,
        purchasePrice: selectedOffers.includes("subto") ? subtoPurchasePrice : purchasePrice,
        arv,
        repairs,
        assignmentFee: tab === "cash" ? cashAssignmentFee : tab === "subto" ? subtoAssignmentFee : creativeAssignmentFee,
        rulePct,
        subtoDebt: subtoCalculations.totalExistingDebt,
        subtoCashToSeller: cashToSeller,
        subtoMonthlyPayment: subtoCalculations.totalMonthlyDebtService,
        downPayment,
        monthlyPayment: creativeCalculations.monthlyPmt,
        interestRate: annualInterestRate,
        balloonYears,
        totalPaidToSeller: creativeCalculations.totalPaidToSeller,
        closingDays,
        includeAssignability,
      });

      if (res.ok) {
        setStatusMsg({
          type: "success",
          text: `Formal Offer letter sent to ${recipientEmail}! PDF copy generated and saved to client's files (Status: Contacted, 48h task scheduled).`,
        });
        if (onUpdated) onUpdated(res.client);
      }
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      setStatusMsg({ type: "error", text: `Failed to send offer email: ${m}` });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        className="modal-card deal-calc-modal"
        style={{
          width: "100%",
          maxWidth: "1240px",
          maxHeight: "94vh",
          backgroundColor: "#0d1117",
          border: "1px solid #334155",
          borderRadius: "12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
          color: "#f8fafc",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#090d14",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "26px" }}>🥧</span>
            <div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.01em" }}>
                Deal Underwriting & Creative Offer Oven
              </h2>
              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#94a3b8" }}>
                Multi-Strategy Underwriting • Cash Wholesale MAO • Subject-To • Seller Financing
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost"
            style={{ fontSize: "18px", padding: "4px 10px", color: "#94a3b8", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs (Deal Types) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: "#0a1120",
            padding: "14px 20px",
            gap: "12px",
            borderBottom: "1px solid #1e293b",
            overflowX: "auto",
          }}
        >
          {[
            { id: "offer" as const, icon: "✉️", label: "Generate Offer Email", badge: "LOI Letter" },
            { id: "subto" as const, icon: "🔄", label: "Subject-To", badge: "SubTo" },
            { id: "creative" as const, icon: "🔥", label: "Seller Financing", badge: "Creative Oven" },
            { id: "cash" as const, icon: "🏷️", label: "Cash MAO", badge: "Fix & Flip" },
          ].map((item) => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                style={{
                  padding: "12px 20px",
                  borderRadius: "10px",
                  border: isActive ? "1.5px solid #38bdf8" : "1px solid #334155",
                  background: isActive
                    ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                    : "#1e293b",
                  color: isActive ? "#ffffff" : "#cbd5e1",
                  fontWeight: 700,
                  fontSize: "15px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  whiteSpace: "nowrap",
                  boxShadow: isActive
                    ? "0 4px 14px rgba(2, 132, 199, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.2)"
                    : "0 2px 5px rgba(0, 0, 0, 0.25)",
                  transition: "all 0.15s ease-in-out",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: "19px", lineHeight: 1 }}>{item.icon}</span>
                <span>{item.label}</span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: "6px",
                    backgroundColor: isActive ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.07)",
                    color: isActive ? "#ffffff" : "#94a3b8",
                  }}
                >
                  {item.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Status banner */}
        {statusMsg && (
          <div
            style={{
              padding: "10px 16px",
              fontSize: "13px",
              backgroundColor: statusMsg.type === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: statusMsg.type === "success" ? "#34d399" : "#f87171",
              borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
            }}
          >
            {statusMsg.text}
          </div>
        )}

        {/* Content Body */}
        <div style={{ padding: "20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
          
          {/* Property Context Bar */}
          {/* Sleek Property Context Banner */}
          <div
            style={{
              backgroundColor: "#0d1322",
              border: "1px solid #1e293b",
              borderRadius: "10px",
              padding: "10px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "16px" }}>📍</span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>
                  {propertyAddress || "Subject Property"}
                </span>
              </div>
              {sellerName && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#94a3b8", fontSize: "13px" }}>
                  <span>👤 Seller:</span>
                  <strong style={{ color: "#e2e8f0" }}>{sellerName}</strong>
                </div>
              )}
              {businessName && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#94a3b8", fontSize: "13px" }}>
                  <span>🏢 Buyer:</span>
                  <strong style={{ color: "#38bdf8" }}>{businessName}</strong>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowPropertyEdit(!showPropertyEdit)}
              style={{
                background: showPropertyEdit ? "rgba(56, 189, 248, 0.15)" : "#1e293b",
                border: showPropertyEdit ? "1px solid #38bdf8" : "1px solid #334155",
                color: showPropertyEdit ? "#38bdf8" : "#cbd5e1",
                borderRadius: "6px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.15s ease",
              }}
            >
              <span>{showPropertyEdit ? "Hide Property Details ▲" : "✏️ Edit Property Info ▾"}</span>
            </button>
          </div>

          {/* Expandable Property Details Form */}
          {(showPropertyEdit || tab === "offer") && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
                backgroundColor: "#111827",
                padding: "14px 18px",
                borderRadius: "10px",
                border: "1px solid #1f2937",
              }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px", fontWeight: 600 }}>
                  Property Address
                </label>
                <input
                  type="text"
                  className="input"
                  style={{
                    background: "#ffffff",
                    color: "#000000",
                    fontWeight: 700,
                    fontSize: "13px",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    width: "100%",
                  }}
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  placeholder="742 Evergreen Terrace"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px", fontWeight: 600 }}>
                  Seller / Contact Name
                </label>
                <input
                  type="text"
                  className="input"
                  style={{
                    background: "#ffffff",
                    color: "#000000",
                    fontWeight: 700,
                    fontSize: "13px",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    width: "100%",
                  }}
                  value={sellerName}
                  onChange={(e) => setSellerName(e.target.value)}
                  placeholder="Homer Simpson"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: "11px", color: "#94a3b8", display: "block", marginBottom: "4px", fontWeight: 600 }}>
                  Seller Email (Offers routed via Resend)
                </label>
                <input
                  type="email"
                  className="input"
                  style={{
                    background: "#ffffff",
                    color: "#000000",
                    fontWeight: 700,
                    fontSize: "13px",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    width: "100%",
                  }}
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="seller@example.com"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: "11px", color: "#38bdf8", display: "block", marginBottom: "4px", fontWeight: 700 }}>
                  🏢 Buyer Entity / Company Name
                </label>
                <input
                  type="text"
                  className="input"
                  style={{
                    background: "#ffffff",
                    color: "#000000",
                    fontWeight: 700,
                    fontSize: "13px",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "6px",
                    border: "1.5px solid #38bdf8",
                    width: "100%",
                  }}
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Your CRM Organization Name"
                />
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: GENERATE OFFER EMAIL WITH FONT CONTROLS & EXECUTIVE PREVIEW          */}
          {/* ========================================================================= */}
          {tab === "offer" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              
              {/* Toolbar: Font, Size, Offer Structure, and View Mode */}
              <div
                style={{
                  backgroundColor: "#0d1117",
                  border: "1px solid #21262d",
                  borderRadius: "8px",
                  padding: "14px 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "14px",
                }}
              >
                {/* Offer Structure Selector (Multi-Select + Presets) */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8" }}>Include Offers:</span>
                    
                    <button
                      type="button"
                      onClick={() => toggleOffer("cash")}
                      style={{
                        padding: "5px 11px",
                        borderRadius: "6px",
                        border: selectedOffers.includes("cash") ? "1.5px solid #22c55e" : "1px solid #334155",
                        backgroundColor: selectedOffers.includes("cash") ? "rgba(34, 197, 94, 0.2)" : "#1e293b",
                        color: selectedOffers.includes("cash") ? "#4ade80" : "#94a3b8",
                        fontWeight: 700,
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                      title="Toggle All-Cash Offer"
                    >
                      <span>{selectedOffers.includes("cash") ? "✓" : "+"}</span>
                      <span>Cash Offer (${cashCalculations.yourCashOffer.toLocaleString()})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleOffer("subto")}
                      style={{
                        padding: "5px 11px",
                        borderRadius: "6px",
                        border: selectedOffers.includes("subto") ? "1.5px solid #38bdf8" : "1px solid #334155",
                        backgroundColor: selectedOffers.includes("subto") ? "rgba(56, 189, 248, 0.2)" : "#1e293b",
                        color: selectedOffers.includes("subto") ? "#38bdf8" : "#94a3b8",
                        fontWeight: 700,
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                      title="Toggle Subject-To Mortgage Assumption Offer"
                    >
                      <span>{selectedOffers.includes("subto") ? "✓" : "+"}</span>
                      <span>SubTo Relief (${subtoPurchasePrice.toLocaleString()})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleOffer("creative")}
                      style={{
                        padding: "5px 11px",
                        borderRadius: "6px",
                        border: selectedOffers.includes("creative") ? "1.5px solid #c084fc" : "1px solid #334155",
                        backgroundColor: selectedOffers.includes("creative") ? "rgba(192, 132, 252, 0.2)" : "#1e293b",
                        color: selectedOffers.includes("creative") ? "#c084fc" : "#94a3b8",
                        fontWeight: 700,
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                      title="Toggle Seller Financing Offer"
                    >
                      <span>{selectedOffers.includes("creative") ? "✓" : "+"}</span>
                      <span>Seller Financing (${purchasePrice.toLocaleString()})</span>
                    </button>
                  </div>

                  {/* Quick Presets */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Quick Presets:</span>
                    {[
                      { label: "All 3 Options", list: ["cash", "subto", "creative"] as OfferStructureType[] },
                      { label: "Cash Only", list: ["cash"] as OfferStructureType[] },
                      { label: "SubTo Only", list: ["subto"] as OfferStructureType[] },
                      { label: "Seller Fin Only", list: ["creative"] as OfferStructureType[] },
                      { label: "Creative Only (SubTo + Seller Fin)", list: ["subto", "creative"] as OfferStructureType[] },
                    ].map((preset, idx) => {
                      const isActive =
                        preset.list.length === selectedOffers.length &&
                        preset.list.every((t) => selectedOffers.includes(t));
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedOffers(preset.list)}
                          style={{
                            padding: "2px 8px",
                            borderRadius: "4px",
                            border: isActive ? "1px solid #38bdf8" : "1px solid #21262d",
                            backgroundColor: isActive ? "rgba(56, 189, 248, 0.15)" : "#0f172a",
                            color: isActive ? "#38bdf8" : "#8b949e",
                            fontWeight: 600,
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}

                    <span style={{ color: "#334155", margin: "0 4px" }}>|</span>

                    {/* Assignability & Seller Acknowledgement Toggle */}
                    <button
                      type="button"
                      onClick={() => setIncludeAssignability(!includeAssignability)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        border: includeAssignability ? "1px solid #22c55e" : "1px solid #334155",
                        backgroundColor: includeAssignability ? "rgba(34, 197, 94, 0.15)" : "#0f172a",
                        color: includeAssignability ? "#4ade80" : "#94a3b8",
                        fontWeight: 700,
                        fontSize: "11px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                      title="Toggle Assignability Clause & Seller Assignment Acknowledgement in LOI"
                    >
                      <span>{includeAssignability ? "✓" : "+"}</span>
                      <span>Assignability & Disclosure Clause</span>
                    </button>
                  </div>
                </div>

                {/* Font Family & Size Controls */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8" }}>Font:</span>
                    <select
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      style={{
                        backgroundColor: "#ffffff",
                        color: "#000000",
                        fontWeight: 700,
                        fontSize: "13px",
                        height: "34px",
                        padding: "0 10px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        cursor: "pointer",
                      }}
                    >
                      <option value="Georgia, serif">Georgia (Executive / Traditional)</option>
                      <option value="'Inter', -apple-system, sans-serif">Inter (Modern Clean Sans)</option>
                      <option value="'Garamond', 'Baskerville', serif">Garamond (Classic Formal LOI)</option>
                      <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica (Corporate Standard)</option>
                      <option value="'Trebuchet MS', sans-serif">Trebuchet MS (Contemporary)</option>
                      <option value="'Courier New', monospace">Courier (Underwriting Memo)</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8" }}>Size:</span>
                    <select
                      value={fontSize}
                      onChange={(e) => setFontSize(e.target.value)}
                      style={{
                        backgroundColor: "#ffffff",
                        color: "#000000",
                        fontWeight: 700,
                        fontSize: "13px",
                        height: "34px",
                        padding: "0 8px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        cursor: "pointer",
                      }}
                    >
                      <option value="13px">13px (Compact)</option>
                      <option value="15px">15px (Executive)</option>
                      <option value="17px">17px (Large)</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8" }}>Timeline:</span>
                    <input
                      type="number"
                      style={{
                        width: "54px",
                        height: "34px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        background: "#ffffff",
                        color: "#000000",
                        textAlign: "center",
                        fontWeight: 700,
                        fontSize: "13px",
                      }}
                      value={closingDays}
                      onChange={(e) => setClosingDays(Number(e.target.value) || 14)}
                    />
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>days</span>
                  </div>

                  {/* Toggle Preview / Edit */}
                  <div style={{ display: "flex", gap: "4px", backgroundColor: "#1e293b", padding: "3px", borderRadius: "6px" }}>
                    <button
                      type="button"
                      onClick={() => setEmailViewMode("preview")}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "4px",
                        border: "none",
                        backgroundColor: emailViewMode === "preview" ? "#38bdf8" : "transparent",
                        color: emailViewMode === "preview" ? "#0f172a" : "#94a3b8",
                        fontWeight: 700,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      👁️ Visual Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailViewMode("edit")}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "4px",
                        border: "none",
                        backgroundColor: emailViewMode === "edit" ? "#38bdf8" : "transparent",
                        color: emailViewMode === "edit" ? "#0f172a" : "#94a3b8",
                        fontWeight: 700,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      📝 Edit Text
                    </button>
                  </div>
                </div>
              </div>

              {/* Subject Line */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  Subject Line
                </label>
                <input
                  type="text"
                  className="input"
                  style={{
                    width: "100%",
                    background: "#ffffff",
                    color: "#000000",
                    fontWeight: 700,
                    fontSize: "14px",
                    height: "38px",
                    padding: "0 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                  }}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              {/* View Mode: Interactive Visual Preview or Raw Text Editor */}
              {emailViewMode === "preview" ? (
                <div
                  style={{
                    border: "1px solid #334155",
                    borderRadius: "8px",
                    padding: "20px",
                    backgroundColor: "#090d13",
                    overflowY: "auto",
                    maxHeight: "480px",
                  }}
                >
                  <div dangerouslySetInnerHTML={{ __html: formattedHtml }} />
                </div>
              ) : (
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                    Letter Content (Markdown / Plain Text)
                  </label>
                  <textarea
                    className="input"
                    rows={15}
                    style={{
                      width: "100%",
                      background: "#ffffff",
                      color: "#000000",
                      fontWeight: 600,
                      fontSize: fontSize,
                      fontFamily: fontFamily,
                      padding: "14px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      lineHeight: "1.6",
                    }}
                    value={offerText}
                    onChange={(e) => setOfferText(e.target.value)}
                  />
                </div>
              )}

            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: SUBTO (SUBJECT-TO CALCULATOR) - CLEAN 2-COLUMN LAYOUT                */}
          {/* ========================================================================= */}
          {tab === "subto" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                gap: "24px",
                alignItems: "start",
              }}
            >
              {/* Left Column: Underwriting Inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                
                {/* Note Banner */}
                <div
                  style={{
                    backgroundColor: "rgba(56, 189, 248, 0.08)",
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#bae6fd",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span style={{ fontSize: "16px" }}>💡</span>
                  <span>
                    <strong>Subject-To Underwriting:</strong> Equity is built through mortgage principal paydown by the end buyer/tenant!
                  </span>
                </div>

                {/* Card 1: Purchase & Seller Walkaway */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>1.</span> Contract Price & Seller Walkaway
                    </h3>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>Agreed terms</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="Contract Purchase Price" value={subtoPurchasePrice} onChange={setSubtoPurchasePrice} helper="Agreed total price" />
                    <CurrencyInput label="Listed / Asking Price" value={subtoListedPrice} onChange={setSubtoListedPrice} helper="Seller asking price" />
                    <CurrencyInput label="Cash to Seller (Down)" value={cashToSeller} onChange={setCashToSeller} helper="Seller walkaway cash" />
                    <CurrencyInput label="Catch-Up / Arrears" value={arrears} onChange={setArrears} helper="Reinstatements if behind" />
                  </div>
                </div>

                {/* Card 2: Existing Mortgages Taken Over */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>2.</span> Existing Mortgages Taken Over
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowJuniorLiens(!showJuniorLiens)}
                      style={{
                        background: "none",
                        border: "1px solid #334155",
                        color: showJuniorLiens ? "#38bdf8" : "#94a3b8",
                        borderRadius: "5px",
                        padding: "3px 9px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {showJuniorLiens ? "Hide Junior Liens ▲" : "+ Add 2nd / 3rd Liens ▾"}
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {/* Loan 1: 1st Mortgage */}
                    <div style={{ backgroundColor: "#161f33", padding: "12px", borderRadius: "8px", border: "1px solid #25334d" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#38bdf8", marginBottom: "8px" }}>
                        Senior Mortgage (1st Lien)
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
                        <CurrencyInput label="Loan Balance" value={loan1Balance} onChange={setLoan1Balance} placeholder="280000" />
                        <NumberInput label="Interest Rate" value={loan1Rate} onChange={setLoan1Rate} suffix="%" step={0.125} />
                        <CurrencyInput label="Monthly Payment" value={loan1MonthlyPmt} onChange={setLoan1MonthlyPmt} placeholder="1218" helper="/mo (P&I)" />
                      </div>
                    </div>

                    {/* Junior Liens */}
                    {(showJuniorLiens || loan2Balance > 0 || loan3Balance > 0) && (
                      <>
                        <div style={{ backgroundColor: "#161f33", padding: "12px", borderRadius: "8px", border: "1px solid #3b2d54" }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#c084fc", marginBottom: "8px" }}>
                            Junior Mortgage (2nd Lien)
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
                            <CurrencyInput label="Loan Balance" value={loan2Balance} onChange={setLoan2Balance} placeholder="40000" />
                            <NumberInput label="Interest Rate" value={loan2Rate} onChange={setLoan2Rate} suffix="%" step={0.125} />
                            <CurrencyInput label="Monthly Payment" value={loan2MonthlyPmt} onChange={setLoan2MonthlyPmt} placeholder="215" helper="/mo (P&I)" />
                          </div>
                        </div>

                        <div style={{ backgroundColor: "#161f33", padding: "12px", borderRadius: "8px", border: "1px solid #4a3425" }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#fb923c", marginBottom: "8px" }}>
                            Other Debt / 3rd Lien
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
                            <CurrencyInput label="Loan Balance" value={loan3Balance} onChange={setLoan3Balance} placeholder="0" />
                            <NumberInput label="Interest Rate" value={loan3Rate} onChange={setLoan3Rate} suffix="%" step={0.125} />
                            <CurrencyInput label="Monthly Payment" value={loan3MonthlyPmt} onChange={setLoan3MonthlyPmt} placeholder="0" helper="/mo (P&I)" />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Card 3: Acquisition & Entry Costs */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>3.</span> Acquisition Costs & Wholesale Fee
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="Wholesale Assignment Fee" value={subtoAssignmentFee} onChange={setSubtoAssignmentFee} placeholder="10000" helper="Your assignment profit" />
                    <CurrencyInput label="Rehab Budget" value={subtoRehab} onChange={setSubtoRehab} placeholder="5000" helper="Cosmetic updates" />
                    <CurrencyInput label="Closing Costs" value={subtoClosingCosts} onChange={setSubtoClosingCosts} placeholder="1500" helper="Title & escrow fees" />
                  </div>
                </div>

                {/* Card 4: Rental & Operating */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>4.</span> Rental Income & Wrap Terms
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="Monthly Market Rent" value={subtoRent} onChange={setSubtoRent} placeholder="2400" helper="Expected gross rent" />
                    <CurrencyInput label="Taxes & Insurance" value={subtoTaxesInsurance} onChange={setSubtoTaxesInsurance} placeholder="250" helper="/mo escrow" />
                    <CurrencyInput label="HOA Fees" value={subtoHoa} onChange={setSubtoHoa} placeholder="50" helper="/mo if applicable" />
                    <NumberInput label="Balloon / Wrap (Yrs)" value={subtoBalloonYears} onChange={setSubtoBalloonYears} suffix="Yrs" step={1} helper="Exit balloon timeline" />
                  </div>
                </div>

              </div>

              {/* Right Column: Sticky Live Deal Summary Card */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "0" }}>
                
                {/* Hero Result Card */}
                <div
                  style={{
                    backgroundColor: "#111a2e",
                    border: "1.5px solid #38bdf8",
                    borderRadius: "12px",
                    padding: "20px",
                    boxShadow: "0 8px 24px rgba(2, 132, 199, 0.2)",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#38bdf8" }}>
                    Subject-To Live Underwriting
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "32px", fontWeight: 900, color: "#ffffff", lineHeight: 1.1 }}>
                      ${Math.round(subtoCalculations.netMonthlyCashFlow).toLocaleString()}
                      <span style={{ fontSize: "15px", fontWeight: 600, color: "#94a3b8" }}>/mo</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "#34d399", fontWeight: 700, marginTop: "4px" }}>
                      Net Monthly Cash Flow • CoC: {subtoCalculations.cashOnCashReturn.toFixed(1)}%
                    </div>
                  </div>

                  <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Total Existing Debt:</span>
                      <strong style={{ color: "#f8fafc" }}>${subtoCalculations.totalExistingDebt.toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Monthly Debt Service:</span>
                      <strong style={{ color: "#f8fafc" }}>${Math.round(subtoCalculations.totalMonthlyDebtService).toLocaleString()}/mo</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Buyer Total Entry Fee:</span>
                      <strong style={{ color: "#38bdf8" }}>
                        ${subtoCalculations.totalBuyerEntryFee.toLocaleString()}{" "}
                        <span style={{ fontSize: "11px", fontWeight: 500 }}>({subtoCalculations.entryFeePct.toFixed(1)}%)</span>
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Remaining Equity Spread:</span>
                      <strong style={{ color: "#a78bfa" }}>
                        ${subtoCalculations.remainingEquity.toLocaleString()}{" "}
                        <span style={{ fontSize: "11px", fontWeight: 500 }}>({subtoCalculations.equityPct.toFixed(1)}%)</span>
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Your Assignment Fee:</span>
                      <strong style={{ color: "#34d399" }}>+${subtoAssignmentFee.toLocaleString()}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOffers(["subto"]);
                      setTab("offer");
                    }}
                    style={{
                      marginTop: "16px",
                      width: "100%",
                      backgroundColor: "#0284c7",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "11px 16px",
                      fontWeight: 700,
                      fontSize: "13px",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(2, 132, 199, 0.4)",
                    }}
                  >
                    Generate SubTo Offer Letter ➔
                  </button>
                </div>

                {/* Closer Qualification Scorecard */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
                    Closer Qualification Scorecard
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {subtoCalculations.evalChecks.map((chk, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: chk.passed ? "1px solid rgba(46, 160, 67, 0.35)" : "1px solid rgba(248, 81, 73, 0.35)",
                          backgroundColor: chk.passed ? "rgba(46, 160, 67, 0.08)" : "rgba(248, 81, 73, 0.08)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "#f8fafc" }}>{chk.label}</div>
                          <div style={{ fontSize: "11px", color: "#94a3b8" }}>{chk.value}</div>
                        </div>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 800,
                            padding: "2px 7px",
                            borderRadius: "4px",
                            backgroundColor: chk.passed ? "#16a34a" : "#dc2626",
                            color: "#ffffff",
                          }}
                        >
                          {chk.passed ? "PASS" : "CHECK"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: SELLER FINANCING (CREATIVE OVEN) - CLEAN 2-COLUMN LAYOUT             */}
          {/* ========================================================================= */}
          {tab === "creative" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                gap: "24px",
                alignItems: "start",
              }}
            >
              {/* Left Column: Underwriting Inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                
                {/* Card 1: Financing Terms */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>1.</span> Seller Financing Loan Terms
                    </h3>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>Contract structure</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="Purchase Price" value={purchasePrice} onChange={setPurchasePrice} helper="Contract offer amount" />
                    <CurrencyInput label="Listed / Asking Price" value={listedPrice} onChange={setListedPrice} helper="Seller asking price" />
                    <CurrencyInput label="Down Payment" value={downPayment} onChange={setDownPayment} helper={`${creativeCalculations.downPct.toFixed(2)}% of price`} />
                    
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="field-label" style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 600, fontSize: "12px", color: "#94a3b8" }}>Financed Loan Amount</span>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>Calculated</span>
                      </label>
                      <div style={{ padding: "8px 12px", fontSize: "15px", fontWeight: 800, background: "#1e293b", color: "#38bdf8", borderRadius: "6px", border: "1px solid #334155", height: "40px", display: "flex", alignItems: "center" }}>
                        ${creativeCalculations.loanAmount.toLocaleString()}
                      </div>
                    </div>

                    <NumberInput label="Annual Interest Rate" value={annualInterestRate} onChange={setAnnualInterestRate} suffix="%" step={0.1} helper="e.g. 2.0%" />
                    <NumberInput label="Amortization" value={amortizationYears} onChange={setAmortizationYears} suffix="Yrs" step={1} helper="e.g. 30 years" />
                    
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="field-label" style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "#94a3b8" }}>
                        Payment Structure
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsInterestOnly(!isInterestOnly)}
                        style={{
                          height: "40px",
                          width: "100%",
                          borderRadius: "6px",
                          border: isInterestOnly ? "1px solid #facc15" : "1px solid #cbd5e1",
                          background: isInterestOnly ? "#fef08a" : "#ffffff",
                          color: "#000000",
                          fontWeight: 700,
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        {isInterestOnly ? "⚠️ Interest-Only Payments" : "✓ Fully Amortized (P&I)"}
                      </button>
                    </div>

                    <NumberInput label="Balloon Due Term" value={balloonYears} onChange={setBalloonYears} suffix="Yrs" step={1} helper="Default 5 years" />
                  </div>
                </div>

                {/* Card 2: Entry Fees & Commissions */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>2.</span> Buyer Entry Fees & Commissions
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="Wholesale Assignment Fee" value={creativeAssignmentFee} onChange={setCreativeAssignmentFee} placeholder="10000" helper="Your assignment fee" />
                    <CurrencyInput label="Rehab Allowance" value={creativeRehab} onChange={setCreativeRehab} placeholder="5000" helper="Estimated repair cost" />
                    <CurrencyInput label="Closing Costs" value={creativeClosingCosts} onChange={setCreativeClosingCosts} placeholder="0" helper="Title and transfer fees" />
                    <NumberInput label="Agent Commission %" value={agentCommissionPct} onChange={setAgentCommissionPct} suffix="%" step={0.5} helper={`$${Math.round(creativeCalculations.agentCommissionAmount).toLocaleString()} total`} />
                  </div>
                </div>

                {/* Card 3: Rental & Operating Expenses */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>3.</span> Rental Income & Operating Expenses
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedExpenses(!showAdvancedExpenses)}
                      style={{
                        background: "none",
                        border: "1px solid #334155",
                        color: showAdvancedExpenses ? "#38bdf8" : "#94a3b8",
                        borderRadius: "5px",
                        padding: "3px 9px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {showAdvancedExpenses ? "Hide Advanced Reserves ▲" : "+ Advanced Reserves (CapEx/Mgt) ▾"}
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="Monthly Rent" value={monthlyRent} onChange={setMonthlyRent} helper={`$${(monthlyRent * 12).toLocaleString()}/yr`} />
                    <CurrencyInput label="Taxes" value={propertyTax} onChange={setPropertyTax} helper="/mo" />
                    <CurrencyInput label="Insurance" value={insurance} onChange={setInsurance} helper="/mo" />
                    <CurrencyInput label="HOA Fees" value={hoa} onChange={setHoa} helper="/mo" />
                    <CurrencyInput label="Other / Misc" value={otherExpenses} onChange={setOtherExpenses} helper="/mo" />
                  </div>

                  {showAdvancedExpenses && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #1e293b", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
                      <NumberInput label="CapEx %" value={capexPct} onChange={setCapexPct} suffix="%" helper={`$${Math.round(monthlyRent * (capexPct / 100)).toLocaleString()}/mo`} />
                      <NumberInput label="Management %" value={managementPct} onChange={setManagementPct} suffix="%" helper={`$${Math.round(monthlyRent * (managementPct / 100)).toLocaleString()}/mo`} />
                      <NumberInput label="Vacancy %" value={vacancyPct} onChange={setVacancyPct} suffix="%" helper={`$${Math.round(monthlyRent * (vacancyPct / 100)).toLocaleString()}/mo`} />
                    </div>
                  )}
                </div>

              </div>

              {/* Right Column: Sticky Live Deal Summary Card */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "0" }}>
                
                {/* Hero Result Card */}
                <div
                  style={{
                    backgroundColor: "#111a2e",
                    border: "1.5px solid #38bdf8",
                    borderRadius: "12px",
                    padding: "20px",
                    boxShadow: "0 8px 24px rgba(2, 132, 199, 0.2)",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#38bdf8" }}>
                    Creative Financing Live Underwriting
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "32px", fontWeight: 900, color: "#ffffff", lineHeight: 1.1 }}>
                      ${Math.round(creativeCalculations.monthlyPmt).toLocaleString()}
                      <span style={{ fontSize: "15px", fontWeight: 600, color: "#94a3b8" }}>/mo</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "#34d399", fontWeight: 700, marginTop: "4px" }}>
                      Monthly Debt Service (P&I) • Net CF: ${Math.round(creativeCalculations.netMonthlyCashFlow).toLocaleString()}/mo
                    </div>
                  </div>

                  <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Financed Loan Amount:</span>
                      <strong style={{ color: "#f8fafc" }}>${creativeCalculations.loanAmount.toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Buyer Total Entry Fee:</span>
                      <strong style={{ color: "#38bdf8" }}>
                        ${creativeCalculations.totalBuyerEntryFee.toLocaleString()}{" "}
                        <span style={{ fontSize: "11px", fontWeight: 500 }}>({creativeCalculations.entryFeePct.toFixed(2)}%)</span>
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Net Cash to Seller Down:</span>
                      <strong style={{ color: "#34d399" }}>${Math.round(creativeCalculations.cashToSellerAfterCommission).toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Cash-on-Cash Return:</span>
                      <strong style={{ color: "#a78bfa" }}>{creativeCalculations.cashOnCashReturn.toFixed(2)}%</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Your Assignment Fee:</span>
                      <strong style={{ color: "#34d399" }}>+${creativeAssignmentFee.toLocaleString()}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOffers(["creative"]);
                      setTab("offer");
                    }}
                    style={{
                      marginTop: "16px",
                      width: "100%",
                      backgroundColor: "#0284c7",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "11px 16px",
                      fontWeight: 700,
                      fontSize: "13px",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(2, 132, 199, 0.4)",
                    }}
                  >
                    Generate Seller Fin Offer ➔
                  </button>
                </div>

                {/* Seller Profit Pitch Box (The Creative Oven Feature) */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#34d399", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
                    🔥 Seller Profit Pitch (Year {balloonYears})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Principal Paid ({balloonYears} Yrs):</span>
                      <strong style={{ color: "#58a6ff" }}>${Math.round(creativeCalculations.totalPrincipalPaid).toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Interest Paid ({balloonYears} Yrs):</span>
                      <strong style={{ color: "#f0883e" }}>${Math.round(creativeCalculations.totalInterestPaid).toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Balloon Due (Year {balloonYears}):</span>
                      <strong style={{ color: "#f87171" }}>${Math.round(creativeCalculations.remainingBalance).toLocaleString()}</strong>
                    </div>
                    <div
                      style={{
                        marginTop: "6px",
                        padding: "10px 12px",
                        backgroundColor: "rgba(34, 197, 94, 0.12)",
                        borderRadius: "6px",
                        border: "1px solid rgba(34, 197, 94, 0.3)",
                      }}
                    >
                      <div style={{ fontSize: "11px", color: "#86efac", fontWeight: 600 }}>TOTAL RECEIVED BY SELLER</div>
                      <div style={{ fontSize: "20px", fontWeight: 900, color: "#ffffff", marginTop: "2px" }}>
                        ${Math.round(creativeCalculations.totalPaidToSeller).toLocaleString()}
                      </div>
                      <div style={{ fontSize: "11px", color: "#4ade80", marginTop: "2px", fontWeight: 700 }}>
                        +${Math.round(creativeCalculations.sellerProfitOverList).toLocaleString()} (+{creativeCalculations.sellerProfitPct.toFixed(1)}%) over list!
                      </div>
                    </div>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: CASH WHOLESALE / FIX & FLIP - CLEAN 2-COLUMN LAYOUT                  */}
          {/* ========================================================================= */}
          {tab === "cash" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                gap: "24px",
                alignItems: "start",
              }}
            >
              {/* Left Column: Underwriting Inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                
                {/* Card 1: Valuation & Target Rules */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>1.</span> Property Valuation & Investor Buy Rule
                    </h3>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>MAO Guidelines</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="After Repair Value (ARV)" value={arv} onChange={setArv} placeholder="180000" helper="Market value fully repaired" />
                    
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="field-label" style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 600, fontSize: "12px", color: "#94a3b8" }}>Investor Buy Rule %</span>
                        <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700 }}>{rulePct}%</span>
                      </label>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {[65, 70, 75, 80].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setRulePct(pct)}
                            style={{
                              flex: 1,
                              height: "40px",
                              borderRadius: "6px",
                              border: rulePct === pct ? "2px solid #38bdf8" : "1px solid #334155",
                              backgroundColor: rulePct === pct ? "#38bdf8" : "#1e293b",
                              color: rulePct === pct ? "#0f172a" : "#f8fafc",
                              fontWeight: 700,
                              fontSize: "13px",
                              cursor: "pointer",
                            }}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: "12px", padding: "8px 12px", backgroundColor: "#161f33", borderRadius: "6px", border: "1px solid #25334d", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
                    <span style={{ color: "#94a3b8" }}>Base Target Investor Price (ARV × {rulePct}%):</span>
                    <strong style={{ color: "#38bdf8", fontSize: "14px" }}>${Math.round(arv * (rulePct / 100)).toLocaleString()}</strong>
                  </div>
                </div>

                {/* Card 2: Rehab & Wholesale Spread */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <h3 style={{ margin: "0 0 14px 0", fontSize: "14px", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>2.</span> Rehab Budget & Wholesale Spread
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
                    <CurrencyInput label="Estimated Rehab Costs" value={repairs} onChange={setRepairs} placeholder="80000" helper="Total repair budget" />
                    <CurrencyInput label="Wholesale Assignment Fee" value={cashAssignmentFee} onChange={setCashAssignmentFee} placeholder="10000" helper="Your net profit spread" />
                    <NumberInput label="Buyer Closing Costs %" value={buyerClosingCostPct} onChange={setBuyerClosingCostPct} suffix="%" step={0.05} helper={`$${cashCalculations.closingCostAmount.toLocaleString()} closing deduction`} />
                  </div>
                </div>

                {/* Card 3: Formula Stepper */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px", fontSize: "13px" }}>
                  <div style={{ fontWeight: 700, color: "#f8fafc", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>📐</span> MAO Formula Breakdown:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px", color: "#94a3b8" }}>
                    <div>1. ARV × {rulePct}% = <strong style={{ color: "#f8fafc" }}>${Math.round(arv * (rulePct / 100)).toLocaleString()}</strong></div>
                    <div>2. Minus Rehab (${repairs.toLocaleString()}) = <strong style={{ color: "#f8fafc" }}>${cashCalculations.baseInvestorPrice.toLocaleString()}</strong></div>
                    <div>3. Minus Closing Costs (${cashCalculations.closingCostAmount.toLocaleString()}) = <strong style={{ color: "#58a6ff" }}>${cashCalculations.maxAllowableOfferAfterClosing.toLocaleString()}</strong> (End Buyer Cap)</div>
                    <div>4. Minus Assignment Fee (${cashAssignmentFee.toLocaleString()}) = <strong style={{ color: "#34d399" }}>${cashCalculations.yourCashOffer.toLocaleString()} (Your Net Cash Offer)</strong></div>
                  </div>
                </div>

              </div>

              {/* Right Column: Sticky Live Deal Summary Card */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", position: "sticky", top: "0" }}>
                
                {/* Hero Result Card */}
                <div
                  style={{
                    backgroundColor: "#111a2e",
                    border: "1.5px solid #22c55e",
                    borderRadius: "12px",
                    padding: "20px",
                    boxShadow: "0 8px 24px rgba(34, 197, 94, 0.2)",
                  }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4ade80" }}>
                    Wholesale Cash MAO
                  </div>

                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "36px", fontWeight: 900, color: "#ffffff", lineHeight: 1.1 }}>
                      ${cashCalculations.yourCashOffer.toLocaleString()}
                    </div>
                    <div style={{ fontSize: "12px", color: "#4ade80", fontWeight: 700, marginTop: "4px" }}>
                      Max Allowable Offer (Net Walkaway Cash to Seller)
                    </div>
                  </div>

                  <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>End Cash Buyer Price:</span>
                      <strong style={{ color: "#58a6ff" }}>${cashCalculations.maxAllowableOfferAfterClosing.toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Wholesale Assignment Spread:</span>
                      <strong style={{ color: "#4ade80" }}>+${cashAssignmentFee.toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Rehab Allowance:</span>
                      <strong style={{ color: "#f87171" }}>-${repairs.toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#94a3b8" }}>Buyer Closing Costs:</span>
                      <strong style={{ color: "#94a3b8" }}>-${cashCalculations.closingCostAmount.toLocaleString()}</strong>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOffers(["cash"]);
                      setTab("offer");
                    }}
                    style={{
                      marginTop: "16px",
                      width: "100%",
                      backgroundColor: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "11px 16px",
                      fontWeight: 700,
                      fontSize: "13px",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(22, 163, 74, 0.4)",
                    }}
                  >
                    Generate Cash Offer Letter ➔
                  </button>
                </div>

                {/* Quick Rule Comparison */}
                <div style={{ backgroundColor: "#0f172a", borderRadius: "10px", border: "1px solid #1e293b", padding: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
                    MAO Sensitivity by Buy Rule
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
                    {[65, 70, 75, 80].map((pct) => {
                      const base = arv * (pct / 100) - repairs;
                      const closing = base * buyerClosingCostPct;
                      const offer = Math.max(0, base - closing - cashAssignmentFee);
                      const isCurrent = rulePct === pct;
                      return (
                        <div
                          key={pct}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "6px 8px",
                            borderRadius: "5px",
                            backgroundColor: isCurrent ? "rgba(56, 189, 248, 0.15)" : "transparent",
                            color: isCurrent ? "#38bdf8" : "#94a3b8",
                            fontWeight: isCurrent ? 700 : 500,
                          }}
                        >
                          <span>{pct}% Rule:</span>
                          <strong>${Math.round(offer).toLocaleString()}</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

            </div>
          )}

</div>

        {/* Modal Footer Actions */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid #1e293b",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#0d1117",
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            style={{ color: "#94a3b8", fontWeight: 600, cursor: "pointer" }}
          >
            Cancel
          </button>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSaveCalculation}
              disabled={saving}
              style={{
                backgroundColor: "#1e293b",
                color: "#f8fafc",
                border: "1px solid #334155",
                fontWeight: 700,
                cursor: "pointer",
                padding: "8px 16px",
                borderRadius: "6px",
              }}
            >
              {saving ? "Saving..." : "💾 Save Calculation to Property"}
            </button>

            {tab === "offer" ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSendOfferEmail}
                disabled={sending}
                style={{
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "8px 20px",
                  borderRadius: "6px",
                  border: "none",
                }}
              >
                {sending ? "Sending..." : "🚀 Send Formal Offer via Resend"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (tab === "cash") setSelectedOffers(["cash"]);
                  else if (tab === "subto") setSelectedOffers(["subto"]);
                  else if (tab === "creative") setSelectedOffers(["creative"]);
                  setTab("offer");
                }}
                style={{
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "8px 20px",
                  borderRadius: "6px",
                  border: "none",
                }}
              >
                Generate Offer Letter ➔
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
