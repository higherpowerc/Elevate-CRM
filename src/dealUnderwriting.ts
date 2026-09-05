/**
 * Revzenta Deal Underwriter™ Core Calculation & Structuring Engine
 *
 * Proprietary acquisitions underwriting models for:
 * 1. Cash Wholesale & Maximum Allowable Offer (MAO) Analysis
 * 2. Creative Seller Financing (Owner Carry, Amortization, DSCR, Balloon Payoff)
 * 3. Subject-To (SubTo) Mortgage Assumption & Existing Debt Takeover
 * 4. Revzenta Deal Viability Index (DVI) Scorecard
 * 5. Professional Multi-Option Letter of Intent (LOI) & Proposal Generator
 */

// ============================================================================
// 1. CASH WHOLESALE & MAO MODELS
// ============================================================================

export interface CashDealInput {
  arv: number;                   // After-Repair Value ($)
  estimatedRepairs: number;      // Scope of work / rehab estimate ($)
  targetInvestorRulePct: number; // e.g., 70% rule (or 75%, 80%)
  wholesaleAssignmentFee: number;// Wholesaler net assignment spread ($)
  buyerClosingCostPct?: number;  // Buyer title/escrow costs % (default: 1.5%)
}

export interface CashDealMetrics {
  arv: number;
  estimatedRepairs: number;
  investorBuyCeiling: number;     // ARV * rule% - repairs
  buyerClosingCostAmount: number; // ARV * closingCostPct%
  maxAllowableOffer: number;      // Investor buy ceiling - closing costs
  netWholesaleOffer: number;      // MAO - Assignment Fee
  investorProjectedEquity: number;// ARV - investorBuyCeiling
  investorGrossProfit: number;    // ARV - (netWholesaleOffer + repairs + closingCosts + assignmentFee)
  investorROI: number;            // Projected flip ROI %
}

export function calculateCashWholesale(input: CashDealInput): CashDealMetrics {
  const arv = Math.max(0, input.arv);
  const repairs = Math.max(0, input.estimatedRepairs);
  const rulePct = Math.max(0, input.targetInvestorRulePct || 70);
  const fee = Math.max(0, input.wholesaleAssignmentFee || 10000);
  const closingCostPct = input.buyerClosingCostPct ?? 1.5;

  // 1. Investor maximum buy price before assignment fee
  const investorBuyCeiling = Math.max(0, Math.round((arv * (rulePct / 100)) - repairs));
  
  // 2. Title & escrow closing friction
  const buyerClosingCostAmount = Math.round(arv * (closingCostPct / 100));
  
  // 3. Maximum Allowable Offer (MAO)
  const maxAllowableOffer = Math.max(0, investorBuyCeiling - buyerClosingCostAmount);
  
  // 4. Net wholesale contract purchase offer to seller
  const netWholesaleOffer = Math.max(0, maxAllowableOffer - fee);

  // 5. End buyer flip economics
  const totalInvestorBasis = netWholesaleOffer + fee + repairs + buyerClosingCostAmount;
  const investorGrossProfit = Math.max(0, arv - totalInvestorBasis);
  const investorROI = totalInvestorBasis > 0 ? (investorGrossProfit / totalInvestorBasis) * 100 : 0;
  const investorProjectedEquity = Math.max(0, arv - investorBuyCeiling);

  return {
    arv,
    estimatedRepairs: repairs,
    investorBuyCeiling,
    buyerClosingCostAmount,
    maxAllowableOffer,
    netWholesaleOffer,
    investorProjectedEquity,
    investorGrossProfit,
    investorROI,
  };
}

// ============================================================================
// 2. SELLER FINANCING (CREATIVE OWNER CARRY) MODELS
// ============================================================================

export interface SellerFinanceInput {
  purchasePrice: number;         // Agreed purchase price ($)
  listedTargetPrice?: number;    // Seller's original listed or target price ($)
  downPayment: number;           // Down payment to seller at closing ($)
  annualInterestRate: number;    // Annual interest rate % (e.g., 3.5%)
  amortizationYears: number;     // Amortization schedule in years (e.g., 30)
  balloonMaturityYears: number;  // Balloon exit / refinance due in years (e.g., 5)
  isInterestOnly: boolean;       // Interest-only payments vs amortizing principal
  rehabMakeReady: number;        // Property make-ready / cosmetic rehab ($)
  assignmentFee: number;         // Wholesaler assignment fee ($)
  closingEscrowCosts: number;    // Title & legal costs ($)
  monthlyMarketRent: number;     // Expected rental income ($/mo)
  monthlyTaxes: number;          // Property taxes ($/mo)
  monthlyInsurance: number;      // Property hazard insurance ($/mo)
  monthlyHoa: number;            // HOA dues ($/mo)
  maintenanceReservePct?: number;// Maintenance/Capex reserve % (default: 5%)
  managementFeePct?: number;     // Property management % (default: 8%)
  vacancyReservePct?: number;    // Vacancy allowance % (default: 5%)
}

export interface SellerFinanceMetrics {
  principalLoanAmount: number;
  downPaymentPct: number;
  monthlyDebtService: number;
  annualDebtService: number;
  monthlyOperatingExpenses: number;
  totalMonthlyPITIExpense: number;
  netMonthlyCashFlow: number;
  netAnnualCashFlow: number;
  netOperatingIncome: number;
  dscr: number;                   // Debt Service Coverage Ratio
  totalBuyerEntryCapital: number; // Down + Rehab + Fee + Closing
  entryCapitalPct: number;        // Entry Capital / Purchase Price %
  cashOnCashReturn: number;       // CoC Return %
  balloonRemainingBalance: number;// Payoff balance at balloon year
  totalInterestPaidToSeller: number;
  totalPrincipalPaidToSeller: number;
  totalPayoutToSeller: number;    // Down payment + Total Interest + Balloon
  sellerGainOverList: number;     // Total payout minus original listed target
  sellerGainPct: number;
}

export function calculateSellerFinancing(input: SellerFinanceInput): SellerFinanceMetrics {
  const price = Math.max(0, input.purchasePrice);
  const targetPrice = input.listedTargetPrice && input.listedTargetPrice > 0 ? input.listedTargetPrice : price;
  const down = Math.min(price, Math.max(0, input.downPayment));
  const principalLoanAmount = Math.max(0, price - down);
  const downPaymentPct = price > 0 ? (down / price) * 100 : 0;

  const rate = Math.max(0, input.annualInterestRate);
  const monthlyRate = (rate / 100) / 12;
  const totalAmortMonths = Math.max(1, (input.amortizationYears || 30) * 12);
  const balloonMonths = Math.max(1, (input.balloonMaturityYears || 5) * 12);

  // 1. Monthly Debt Service Payment Calculation
  let monthlyDebtService = 0;
  if (principalLoanAmount === 0) {
    monthlyDebtService = 0;
  } else if (input.isInterestOnly) {
    monthlyDebtService = principalLoanAmount * monthlyRate;
  } else if (monthlyRate === 0) {
    monthlyDebtService = principalLoanAmount / totalAmortMonths;
  } else {
    // Standard Amortization Formula: PMT = P * [ r(1+r)^n ] / [ (1+r)^n - 1 ]
    const compound = Math.pow(1 + monthlyRate, totalAmortMonths);
    monthlyDebtService = (principalLoanAmount * (monthlyRate * compound)) / (compound - 1);
  }
  const annualDebtService = monthlyDebtService * 12;

  // 2. Buyer Total Entry Capital to Close
  const totalBuyerEntryCapital =
    down +
    Math.max(0, input.rehabMakeReady || 0) +
    Math.max(0, input.assignmentFee || 0) +
    Math.max(0, input.closingEscrowCosts || 0);
  const entryCapitalPct = price > 0 ? (totalBuyerEntryCapital / price) * 100 : 0;

  // 3. Operating Reserves & Expenses
  const rent = Math.max(0, input.monthlyMarketRent || 0);
  const maintPct = input.maintenanceReservePct ?? 5;
  const mgmtPct = input.managementFeePct ?? 8;
  const vacPct = input.vacancyReservePct ?? 5;

  const monthlyReserves = rent * ((maintPct + mgmtPct + vacPct) / 100);
  const fixedPropertyCosts =
    Math.max(0, input.monthlyTaxes || 0) +
    Math.max(0, input.monthlyInsurance || 0) +
    Math.max(0, input.monthlyHoa || 0);

  const monthlyOperatingExpenses = fixedPropertyCosts + monthlyReserves;
  const totalMonthlyPITIExpense = monthlyDebtService + monthlyOperatingExpenses;

  // 4. Net Operating Income & Cash Flow
  const netMonthlyCashFlow = rent - totalMonthlyPITIExpense;
  const netAnnualCashFlow = netMonthlyCashFlow * 12;

  // Net Operating Income (NOI) = Gross Revenue - Operating Expenses (before debt)
  const netOperatingIncome = Math.max(0, (rent - monthlyOperatingExpenses) * 12);
  const dscr = annualDebtService > 0 ? (netOperatingIncome / annualDebtService) : rent > 0 ? 99 : 0;
  const cashOnCashReturn = totalBuyerEntryCapital > 0 ? (netAnnualCashFlow / totalBuyerEntryCapital) * 100 : 0;

  // 5. Balloon Maturity Balance & Seller Total Wealth Analysis
  let remainingBalance = principalLoanAmount;
  let totalInterestPaidToSeller = 0;
  let totalPrincipalPaidToSeller = 0;

  const simulationMonths = Math.min(balloonMonths, totalAmortMonths);

  if (input.isInterestOnly) {
    totalInterestPaidToSeller = monthlyDebtService * simulationMonths;
    totalPrincipalPaidToSeller = 0;
    remainingBalance = principalLoanAmount;
  } else if (monthlyRate === 0) {
    const monthlyPrincipalOnly = principalLoanAmount / totalAmortMonths;
    totalPrincipalPaidToSeller = monthlyPrincipalOnly * simulationMonths;
    remainingBalance = Math.max(0, principalLoanAmount - totalPrincipalPaidToSeller);
  } else {
    for (let m = 1; m <= simulationMonths; m++) {
      const interestForMonth = remainingBalance * monthlyRate;
      const principalForMonth = Math.min(remainingBalance, monthlyDebtService - interestForMonth);
      totalInterestPaidToSeller += interestForMonth;
      totalPrincipalPaidToSeller += principalForMonth;
      remainingBalance = Math.max(0, remainingBalance - principalForMonth);
    }
  }

  const totalPayoutToSeller = down + totalInterestPaidToSeller + (principalLoanAmount - totalPrincipalPaidToSeller) + totalPrincipalPaidToSeller;
  const sellerGainOverList = totalPayoutToSeller - targetPrice;
  const sellerGainPct = targetPrice > 0 ? (sellerGainOverList / targetPrice) * 100 : 0;

  return {
    principalLoanAmount,
    downPaymentPct,
    monthlyDebtService,
    annualDebtService,
    monthlyOperatingExpenses,
    totalMonthlyPITIExpense,
    netMonthlyCashFlow,
    netAnnualCashFlow,
    netOperatingIncome,
    dscr,
    totalBuyerEntryCapital,
    entryCapitalPct,
    cashOnCashReturn,
    balloonRemainingBalance: remainingBalance,
    totalInterestPaidToSeller,
    totalPrincipalPaidToSeller,
    totalPayoutToSeller,
    sellerGainOverList,
    sellerGainPct,
  };
}

// ============================================================================
// 3. SUBJECT-TO (SUBTO) MORTGAGE TAKEOVER MODELS
// ============================================================================

export interface MortgageLien {
  id: string;
  label: string;
  unpaidPrincipalBalance: number;
  interestRate: number;
  monthlyPaymentPITI: number;
}

export interface SubjectToInput {
  purchasePrice: number;            // Total contract price ($)
  cashToSeller: number;             // Equity walkaway cash to seller ($)
  arrearsReinstatement: number;     // Catch-up back payments / default arrears ($)
  rehabMakeReady: number;           // Cosmetic work ($)
  assignmentFee: number;            // Wholesaler net assignment spread ($)
  closingEscrowCosts: number;       // Title search, closing attorney, insurance ($)
  liens: MortgageLien[];            // Existing mortgages taken over subject-to
  monthlyMarketRent: number;        // Projected tenant/wrap rent ($/mo)
  monthlyTaxesAndInsurance: number; // Escrow / T&I if not included in loan payment
  monthlyHoa: number;               // HOA dues ($/mo)
}

export interface SubjectToMetrics {
  totalExistingDebt: number;
  totalMonthlyDebtService: number;
  sellerEquityCaptured: number;
  equityPct: number;
  totalBuyerEntryCapital: number;
  entryCapitalPct: number;
  sellerDownPct: number;
  totalMonthlyOutflow: number;
  netMonthlyCashFlow: number;
  netAnnualCashFlow: number;
  cashOnCashReturn: number;
  weightedInterestRate: number;
}

export function calculateSubjectTo(input: SubjectToInput): SubjectToMetrics {
  const price = Math.max(0, input.purchasePrice);
  const sellerCash = Math.max(0, input.cashToSeller);
  const arrears = Math.max(0, input.arrearsReinstatement || 0);
  const rehab = Math.max(0, input.rehabMakeReady || 0);
  const fee = Math.max(0, input.assignmentFee || 0);
  const closing = Math.max(0, input.closingEscrowCosts || 0);

  // 1. Debt Aggregation across all active liens
  let totalExistingDebt = 0;
  let totalMonthlyDebtService = 0;
  let interestSum = 0;

  for (const lien of input.liens) {
    const bal = Math.max(0, lien.unpaidPrincipalBalance || 0);
    const pmt = Math.max(0, lien.monthlyPaymentPITI || 0);
    const rate = Math.max(0, lien.interestRate || 0);

    totalExistingDebt += bal;
    totalMonthlyDebtService += pmt;
    interestSum += bal * rate;
  }

  const weightedInterestRate = totalExistingDebt > 0 ? interestSum / totalExistingDebt : 0;

  // 2. Equity & Buyer Entry Capital
  const sellerEquityCaptured = Math.max(0, price - totalExistingDebt);
  const equityPct = price > 0 ? (sellerEquityCaptured / price) * 100 : 0;

  const totalBuyerEntryCapital = sellerCash + arrears + rehab + fee + closing;
  const entryCapitalPct = price > 0 ? (totalBuyerEntryCapital / price) * 100 : 0;
  const sellerDownPct = price > 0 ? (sellerCash / price) * 100 : 0;

  // 3. Operational Cash Flow
  const monthlyTaxesIns = Math.max(0, input.monthlyTaxesAndInsurance || 0);
  const monthlyHoa = Math.max(0, input.monthlyHoa || 0);
  const totalMonthlyOutflow = totalMonthlyDebtService + monthlyTaxesIns + monthlyHoa;

  const rent = Math.max(0, input.monthlyMarketRent || 0);
  const netMonthlyCashFlow = rent - totalMonthlyOutflow;
  const netAnnualCashFlow = netMonthlyCashFlow * 12;

  const cashOnCashReturn = totalBuyerEntryCapital > 0 ? (netAnnualCashFlow / totalBuyerEntryCapital) * 100 : 0;

  return {
    totalExistingDebt,
    totalMonthlyDebtService,
    sellerEquityCaptured,
    equityPct,
    totalBuyerEntryCapital,
    entryCapitalPct,
    sellerDownPct,
    totalMonthlyOutflow,
    netMonthlyCashFlow,
    netAnnualCashFlow,
    cashOnCashReturn,
    weightedInterestRate,
  };
}

// ============================================================================
// 4. REVZENTA DEAL VIABILITY INDEX (DVI) SCORECARD
// ============================================================================

export interface ViabilityCheck {
  title: string;
  metricValue: string;
  targetCriteria: string;
  status: 'passed' | 'warning' | 'failed';
  scoreImpact: number;
}

export interface DealViabilityScorecard {
  score: number;             // 0 - 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: 'Prime Deal' | 'Solid Opportunity' | 'Conditional / Tight Spread' | 'High Risk';
  checks: ViabilityCheck[];
}

export function evaluateDealViability(
  type: 'cash' | 'creative' | 'subto',
  metrics: {
    netMonthlyCashFlow?: number;
    cashOnCashReturn?: number;
    entryCapitalPct?: number;
    dscr?: number;
    investorROI?: number;
    netWholesaleOffer?: number;
    maxAllowableOffer?: number;
    weightedInterestRate?: number;
  }
): DealViabilityScorecard {
  const checks: ViabilityCheck[] = [];
  let score = 100;

  if (type === 'cash') {
    const roi = metrics.investorROI ?? 0;
    const offer = metrics.netWholesaleOffer ?? 0;
    const mao = metrics.maxAllowableOffer ?? 0;

    if (roi >= 15) {
      checks.push({
        title: 'End Buyer ROI Margin',
        metricValue: `${roi.toFixed(1)}%`,
        targetCriteria: '>= 15% Net Return',
        status: 'passed',
        scoreImpact: 0,
      });
    } else if (roi >= 10) {
      score -= 15;
      checks.push({
        title: 'End Buyer ROI Margin',
        metricValue: `${roi.toFixed(1)}%`,
        targetCriteria: '10% - 14% (Moderate)',
        status: 'warning',
        scoreImpact: -15,
      });
    } else {
      score -= 35;
      checks.push({
        title: 'End Buyer ROI Margin',
        metricValue: `${roi.toFixed(1)}%`,
        targetCriteria: '< 10% (Low Profit)',
        status: 'failed',
        scoreImpact: -35,
      });
    }

    if (offer > 0 && offer <= mao) {
      checks.push({
        title: 'MAO Discipline Check',
        metricValue: `$${offer.toLocaleString()}`,
        targetCriteria: `<= $${mao.toLocaleString()} MAO`,
        status: 'passed',
        scoreImpact: 0,
      });
    } else {
      score -= 40;
      checks.push({
        title: 'MAO Discipline Check',
        metricValue: `$${offer.toLocaleString()}`,
        targetCriteria: 'Exceeds Maximum Allowable Offer',
        status: 'failed',
        scoreImpact: -40,
      });
    }
  } else {
    const cashFlow = metrics.netMonthlyCashFlow ?? 0;
    const coc = metrics.cashOnCashReturn ?? 0;
    const entryPct = metrics.entryCapitalPct ?? 0;
    const dscr = metrics.dscr ?? 1.25;

    if (cashFlow >= 300) {
      checks.push({
        title: 'Net Monthly Cash Flow',
        metricValue: `+$${Math.round(cashFlow).toLocaleString()}/mo`,
        targetCriteria: '>= $300/mo (Strong Yield)',
        status: 'passed',
        scoreImpact: 0,
      });
    } else if (cashFlow >= 150) {
      score -= 10;
      checks.push({
        title: 'Net Monthly Cash Flow',
        metricValue: `+$${Math.round(cashFlow).toLocaleString()}/mo`,
        targetCriteria: '$150 - $299/mo (Acceptable)',
        status: 'warning',
        scoreImpact: -10,
      });
    } else {
      score -= 30;
      checks.push({
        title: 'Net Monthly Cash Flow',
        metricValue: `$${Math.round(cashFlow).toLocaleString()}/mo`,
        targetCriteria: '< $150/mo (Breakeven/Negative)',
        status: 'failed',
        scoreImpact: -30,
      });
    }

    if (coc >= 14) {
      checks.push({
        title: 'Cash-on-Cash Return (CoC)',
        metricValue: `${coc.toFixed(1)}%`,
        targetCriteria: '>= 14% Annualized',
        status: 'passed',
        scoreImpact: 0,
      });
    } else if (coc >= 8) {
      score -= 10;
      checks.push({
        title: 'Cash-on-Cash Return (CoC)',
        metricValue: `${coc.toFixed(1)}%`,
        targetCriteria: '8% - 13.9% (Fair)',
        status: 'warning',
        scoreImpact: -10,
      });
    } else {
      score -= 25;
      checks.push({
        title: 'Cash-on-Cash Return (CoC)',
        metricValue: `${coc.toFixed(1)}%`,
        targetCriteria: '< 8% (Sub-par Yield)',
        status: 'failed',
        scoreImpact: -25,
      });
    }

    if (entryPct <= 12) {
      checks.push({
        title: 'Buyer Capital Entry Ratio',
        metricValue: `${entryPct.toFixed(1)}%`,
        targetCriteria: '<= 12% of Property Value',
        status: 'passed',
        scoreImpact: 0,
      });
    } else if (entryPct <= 18) {
      score -= 10;
      checks.push({
        title: 'Buyer Capital Entry Ratio',
        metricValue: `${entryPct.toFixed(1)}%`,
        targetCriteria: '12.1% - 18% (Moderate)',
        status: 'warning',
        scoreImpact: -10,
      });
    } else {
      score -= 20;
      checks.push({
        title: 'Buyer Capital Entry Ratio',
        metricValue: `${entryPct.toFixed(1)}%`,
        targetCriteria: '> 18% (Heavy Entry)',
        status: 'failed',
        scoreImpact: -20,
      });
    }

    if (dscr >= 1.25) {
      checks.push({
        title: 'Debt Service Coverage (DSCR)',
        metricValue: `${dscr.toFixed(2)}x`,
        targetCriteria: '>= 1.25x Bank Standard',
        status: 'passed',
        scoreImpact: 0,
      });
    } else if (dscr >= 1.05) {
      score -= 10;
      checks.push({
        title: 'Debt Service Coverage (DSCR)',
        metricValue: `${dscr.toFixed(2)}x`,
        targetCriteria: '1.05x - 1.24x (Tight)',
        status: 'warning',
        scoreImpact: -10,
      });
    } else {
      score -= 25;
      checks.push({
        title: 'Debt Service Coverage (DSCR)',
        metricValue: `${dscr.toFixed(2)}x`,
        targetCriteria: '< 1.05x (Deficit Risk)',
        status: 'failed',
        scoreImpact: -25,
      });
    }
  }

  score = Math.max(0, Math.min(100, score));

  let grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' = 'B';
  let verdict: 'Prime Deal' | 'Solid Opportunity' | 'Conditional / Tight Spread' | 'High Risk' = 'Solid Opportunity';

  if (score >= 95) {
    grade = 'A+';
    verdict = 'Prime Deal';
  } else if (score >= 85) {
    grade = 'A';
    verdict = 'Prime Deal';
  } else if (score >= 70) {
    grade = 'B';
    verdict = 'Solid Opportunity';
  } else if (score >= 55) {
    grade = 'C';
    verdict = 'Conditional / Tight Spread';
  } else {
    grade = 'F';
    verdict = 'High Risk';
  }

  return { score, grade, verdict, checks };
}

// ============================================================================
// 5. EXECUTIVE MULTI-OPTION PROPOSAL & LOI GENERATOR
// ============================================================================

export interface ProposalGeneratorInput {
  propertyAddress: string;
  sellerName: string;
  acquisitionsCompany: string;
  selectedOptions: Array<'cash' | 'subto' | 'creative'>;
  closingDays: number;
  cashMetrics: CashDealMetrics;
  subtoMetrics: SubjectToMetrics;
  subtoInput: SubjectToInput;
  creativeMetrics: SellerFinanceMetrics;
  creativeInput: SellerFinanceInput;
  includeAssignabilityClause: boolean;
}

export function generateMultiOptionProposal(input: ProposalGeneratorInput): {
  subjectLine: string;
  plainText: string;
  htmlMarkup: string;
} {
  const addr = input.propertyAddress.trim() || 'Subject Property';
  const seller = input.sellerName.trim() || 'Property Owner of Record';
  const company = input.acquisitionsCompany.trim() || 'Revzenta Capital';
  const vestingEntity = `${company} and/or assigns`;
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const refId = `REV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const subjectLine = `OFFICIAL PURCHASE PROPOSAL: ${addr} (Ref: ${refId})`;

  let text = `CONFIDENTIAL PURCHASE PROPOSAL & LETTER OF INTENT (LOI)\n`;
  text += `Date: ${today}\n`;
  text += `Reference: ${refId}\n`;
  text += `Subject Property: ${addr}\n`;
  text += `Seller / Owner: ${seller}\n`;
  text += `Buyer Entity: ${vestingEntity}\n\n`;
  text += `Dear ${seller},\n\n`;
  text += `Our acquisitions team has concluded underwriting on ${addr}. `;
  text += `Below are our formal purchase options tailored to meet your financial priorities:\n\n`;

  let optIdx = 1;

  if (input.selectedOptions.includes('cash')) {
    text += `OPTION ${optIdx++}: IMMEDIATE ALL-CASH SETTLEMENT\n`;
    text += `• Net Cash Purchase Price: $${input.cashMetrics.netWholesaleOffer.toLocaleString()} (Net Walkaway to Seller)\n`;
    text += `• Earnest Money Deposit: $1,000.00 (Escrow deposited within 48 business hours)\n`;
    text += `• Closing Timeline: ${input.closingDays} Days (or flexible date of Seller's choice)\n`;
    text += `• Condition: Sold 100% strictly "As-Is, Where-Is" (Zero repairs, cleaning, or debris removal required)\n`;
    text += `• Closing Costs: Buyer pays 100% of customary escrow and closing costs. Zero agent fees or commissions.\n\n`;
  }

  if (input.selectedOptions.includes('subto')) {
    text += `OPTION ${optIdx++}: SUBJECT-TO DEBT RELIEF & CASH AT CLOSE\n`;
    text += `• Upfront Cash Walkaway to Seller: $${input.subtoInput.cashToSeller.toLocaleString()}\n`;
    text += `• Mortgage Debt Relieved & Assumed: $${input.subtoMetrics.totalExistingDebt.toLocaleString()}\n`;
    text += `• Monthly Debt Service Maintained by Buyer: $${Math.round(input.subtoMetrics.totalMonthlyDebtService).toLocaleString()}/month\n`;
    text += `• Servicing Standard: Professionally handled via third-party licensed loan servicing agency\n`;
    text += `• Seller Credit Benefit: Timely continuous payments to protect and enhance seller credit rating\n`;
    text += `• As-Is Conveyance: Buyer assumes all property taxes, insurance, and future maintenance\n\n`;
  }

  if (input.selectedOptions.includes('creative')) {
    text += `OPTION ${optIdx++}: PREMIUM SELLER FINANCING (MAXIMUM RETURN)\n`;
    text += `• Full Purchase Price: $${input.creativeInput.purchasePrice.toLocaleString()} (Top Dollar Valuation)\n`;
    text += `• Upfront Down Payment: $${input.creativeInput.downPayment.toLocaleString()} at closing\n`;
    text += `• Ongoing Monthly Income: $${Math.round(input.creativeMetrics.monthlyDebtService).toLocaleString()}/month\n`;
    text += `• Note Terms: ${input.creativeInput.annualInterestRate.toFixed(2)}% annual interest, ${input.creativeInput.balloonMaturityYears}-year balloon term\n`;
    text += `• Total Cumulative Proceeds to Seller: $${Math.round(input.creativeMetrics.totalPayoutToSeller).toLocaleString()} (+$${Math.round(input.creativeMetrics.sellerGainOverList).toLocaleString()} above target)\n\n`;
  }

  if (input.includeAssignabilityClause) {
    text += `ASSIGNABILITY & CONVEYANCE ACKNOWLEDGEMENT:\n`;
    text += `Buyer reserves the right to assign or vest equitable contract title to an affiliated investment trust or qualified principal. Seller acknowledges that Seller's sole financial compensation is the agreed-upon net purchase price and terms stated herein, with zero deductions or commissions.\n\n`;
  }

  text += `NEXT STEPS & ACCEPTANCE:\n`;
  text += `Please sign below or reply via email with your chosen option. Our title partner will promptly issue state-approved bilateral contracts.\n\n`;
  text += `Accepted & Agreed: _______________________ Date: ____________\n`;
  text += `${seller} (Owner of Record)\n\n`;
  text += `Sincerely,\nAcquisitions Division\n${company}\n`;

  const htmlMarkup = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #1e293b; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 24px 28px; color: #ffffff;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: #ffffff;">${company}</h1>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8;">Real Estate Acquisitions & Underwriting</p>
          </div>
          <span style="background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; color: #e2e8f0;">
            ${refId}
          </span>
        </div>
      </div>

      <div style="padding: 24px 28px;">
        <p style="margin-top: 0; font-size: 14px; color: #64748b;">Date: ${today}</p>
        <p style="font-size: 15px; color: #334155;">Dear <strong>${seller}</strong>,</p>
        <p style="font-size: 14px; color: #475569;">
          We are pleased to present our formal purchase proposal for <strong>${addr}</strong>. Following our proprietary acquisitions underwriting review, we have structured the following options:
        </p>

        <div style="display: flex; flex-direction: column; gap: 16px; margin: 24px 0;">
          ${input.selectedOptions.includes('cash') ? `
            <div style="border: 1.5px solid #10b981; border-radius: 8px; padding: 18px 20px; background: #f0fdf4;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
                <strong style="color: #065f46; font-size: 16px;">Option: Immediate All-Cash Settlement</strong>
                <span style="font-size: 18px; font-weight: 800; color: #047857;">$${input.cashMetrics.netWholesaleOffer.toLocaleString()}</span>
              </div>
              <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #047857;">
                <li>Net cash walkaway at closing</li>
                <li>Closing within ${input.closingDays} business days</li>
                <li>Sold 100% strictly "As-Is" — zero repairs or cleaning</li>
                <li>Buyer pays all standard closing costs</li>
              </ul>
            </div>
          ` : ''}

          ${input.selectedOptions.includes('subto') ? `
            <div style="border: 1.5px solid #3b82f6; border-radius: 8px; padding: 18px 20px; background: #eff6ff;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
                <strong style="color: #1e40af; font-size: 16px;">Option: Subject-To Debt Assumption</strong>
                <span style="font-size: 18px; font-weight: 800; color: #1d4ed8;">$${input.subtoInput.cashToSeller.toLocaleString()} Cash Upfront</span>
              </div>
              <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #1e40af;">
                <li>Buyer assumes payment of $${input.subtoMetrics.totalExistingDebt.toLocaleString()} mortgage debt</li>
                <li>Monthly payments ($${Math.round(input.subtoMetrics.totalMonthlyDebtService).toLocaleString()}/mo) maintained by Buyer</li>
                <li>Serviced through licensed third-party escrow servicing</li>
                <li>Protects and builds Seller credit profile</li>
              </ul>
            </div>
          ` : ''}

          ${input.selectedOptions.includes('creative') ? `
            <div style="border: 1.5px solid #8b5cf6; border-radius: 8px; padding: 18px 20px; background: #faf5ff;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
                <strong style="color: #5b21b6; font-size: 16px;">Option: Premium Seller Financing</strong>
                <span style="font-size: 18px; font-weight: 800; color: #6d28d9;">$${input.creativeInput.purchasePrice.toLocaleString()} Valuation</span>
              </div>
              <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #5b21b6;">
                <li>$${input.creativeInput.downPayment.toLocaleString()} down payment at closing</li>
                <li>$${Math.round(input.creativeMetrics.monthlyDebtService).toLocaleString()}/mo ongoing passive income</li>
                <li>Total projected seller yield: $${Math.round(input.creativeMetrics.totalPayoutToSeller).toLocaleString()}</li>
                <li>${input.creativeInput.annualInterestRate}% interest with ${input.creativeInput.balloonMaturityYears}-year balloon term</li>
              </ul>
            </div>
          ` : ''}
        </div>

        <div style="border-top: 1px solid #e2e8f0; padding-top: 18px; margin-top: 24px; font-size: 12px; color: #64748b;">
          <p style="margin: 0 0 6px 0;"><strong>Closing Agent:</strong> Third-Party Licensed Title & Escrow Company.</p>
          ${input.includeAssignabilityClause ? '<p style="margin: 0;"><strong>Vesting:</strong> ' + vestingEntity + '. Contract is assignable without changing seller net proceeds.</p>' : ''}
        </div>
      </div>
    </div>
  `;

  return { subjectLine, plainText: text, htmlMarkup };
}
