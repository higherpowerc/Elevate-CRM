import { useState, useMemo, useEffect } from "react";
import type { Client } from "./types";
import { api } from "./api";
import {
  calculateCashWholesale,
  calculateSellerFinancing,
  calculateSubjectTo,
  evaluateDealViability,
  generateMultiOptionProposal,
  type MortgageLien,
} from "./dealUnderwriting";

interface Props {
  property?: Client | null;
  onClose: () => void;
  onUpdated?: (updated: Client) => void;
  crmBusinessName?: string;
}

/** Currency input with clean $ prefix and automatic numeric comma formatting */
function CurrencyField({
  label,
  value,
  onChange,
  placeholder = "0",
  hint,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  placeholder?: string;
  hint?: string;
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
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text, #f8fafc)" }}>{label}</span>
        {hint && <span style={{ fontSize: "11px", color: "var(--text-dim, #94a3b8)" }}>{hint}</span>}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span
          style={{
            position: "absolute",
            left: "12px",
            color: "#64748b",
            fontSize: "14px",
            fontWeight: 700,
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          $
        </span>
        <input
          type="text"
          inputMode="numeric"
          style={{
            width: "100%",
            height: "38px",
            paddingLeft: "26px",
            paddingRight: "10px",
            fontSize: "14px",
            fontWeight: 600,
            background: "var(--surface, #ffffff)",
            color: "var(--text, #0f172a)",
            border: "1px solid var(--border, #cbd5e1)",
            borderRadius: "6px",
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

/** Percentage or numeric step input */
function NumberField({
  label,
  value,
  onChange,
  suffix = "",
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  suffix?: string;
  step?: number;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text, #f8fafc)" }}>{label}</span>
        {hint && <span style={{ fontSize: "11px", color: "var(--text-dim, #94a3b8)" }}>{hint}</span>}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          type="number"
          step={step}
          style={{
            width: "100%",
            height: "38px",
            paddingLeft: "12px",
            paddingRight: suffix ? "32px" : "12px",
            fontSize: "14px",
            fontWeight: 600,
            background: "var(--surface, #ffffff)",
            color: "var(--text, #0f172a)",
            border: "1px solid var(--border, #cbd5e1)",
            borderRadius: "6px",
            boxSizing: "border-box",
          }}
          value={value === 0 ? "" : value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {suffix && (
          <span
            style={{
              position: "absolute",
              right: "12px",
              color: "#64748b",
              fontSize: "13px",
              fontWeight: 600,
              pointerEvents: "none",
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
  const [tab, setTab] = useState<"proposal" | "cash" | "creative" | "subto">("proposal");

  // Property & entity metadata
  const [propertyAddress, setPropertyAddress] = useState(property?.address || property?.companyName || "");
  const [sellerName, setSellerName] = useState(property?.contactName || property?.companyName || "");
  const [recipientEmail, setRecipientEmail] = useState(property?.email || "");
  const [acquisitionsCompany, setAcquisitionsCompany] = useState(crmBusinessName || "");

  useEffect(() => {
    if (!acquisitionsCompany) {
      api.settings().then((s) => {
        if (s.settings?.orgName) {
          setAcquisitionsCompany(s.settings.orgName);
        }
      }).catch(() => {});
    }
  }, []);

  // Initialize from property custom fields or sensible defaults
  const initialFields = useMemo(() => {
    let arv = 275000;
    let repairs = 35000;
    let fee = 10000;
    let rule = 70;
    let purchasePrice = 260000;
    let listedPrice = 275000;
    let downPayment = 15000;
    let rate = 3.5;
    let rent = 2200;

    if (property?.dealValue && property.dealValue > 20000) {
      arv = property.dealValue;
      purchasePrice = property.dealValue;
    }

    if (property?.customFields) {
      for (const cf of property.customFields) {
        const n = cf.name.toLowerCase();
        const num = Number(String(cf.value).replace(/[^0-9.]/g, ""));
        if (!isNaN(num) && num > 0) {
          if (n === "arv") arv = num;
          if (n === "repairs") repairs = num;
          if (n.includes("assignment fee")) fee = num;
          if (n.includes("investor rule")) rule = num;
          if (n.includes("purchase price")) purchasePrice = num;
          if (n.includes("down payment")) downPayment = num;
          if (n.includes("interest rate")) rate = num;
          if (n.includes("rent")) rent = num;
        }
      }
    }
    return { arv, repairs, fee, rule, purchasePrice, listedPrice, downPayment, rate, rent };
  }, [property]);

  // ==========================================================================
  // 1. CASH WHOLESALE / FIX & FLIP UNDERWRITING STATE
  // ==========================================================================
  const [cashArv, setCashArv] = useState<number>(initialFields.arv);
  const [cashRepairs, setCashRepairs] = useState<number>(initialFields.repairs);
  const [cashInvestorRule, setCashInvestorRule] = useState<number>(initialFields.rule);
  const [cashAssignmentFee, setCashAssignmentFee] = useState<number>(initialFields.fee);
  const [cashClosingCostPct, setCashClosingCostPct] = useState<number>(1.5);

  const cashMetrics = useMemo(() => {
    return calculateCashWholesale({
      arv: cashArv,
      estimatedRepairs: cashRepairs,
      targetInvestorRulePct: cashInvestorRule,
      wholesaleAssignmentFee: cashAssignmentFee,
      buyerClosingCostPct: cashClosingCostPct,
    });
  }, [cashArv, cashRepairs, cashInvestorRule, cashAssignmentFee, cashClosingCostPct]);

  // ==========================================================================
  // 2. CREATIVE SELLER FINANCING (OWNER CARRY) UNDERWRITING STATE
  // ==========================================================================
  const [creativePrice, setCreativePrice] = useState<number>(initialFields.purchasePrice);
  const [creativeTargetList, setCreativeTargetList] = useState<number>(initialFields.listedPrice);
  const [creativeDown, setCreativeDown] = useState<number>(initialFields.downPayment);
  const [creativeInterestRate, setCreativeInterestRate] = useState<number>(initialFields.rate);
  const [creativeAmortYears, setCreativeAmortYears] = useState<number>(30);
  const [creativeBalloonYears, setCreativeBalloonYears] = useState<number>(5);
  const [creativeIsIO, setCreativeIsIO] = useState<boolean>(false);
  const [creativeRehab, setCreativeRehab] = useState<number>(5000);
  const [creativeAssignmentFee, setCreativeAssignmentFee] = useState<number>(initialFields.fee);
  const [creativeClosingCosts, setCreativeClosingCosts] = useState<number>(2000);
  const [creativeRent, setCreativeRent] = useState<number>(initialFields.rent);
  const [creativeTaxes, setCreativeTaxes] = useState<number>(180);
  const [creativeInsurance, setCreativeInsurance] = useState<number>(120);
  const [creativeHoa, setCreativeHoa] = useState<number>(45);

  const creativeMetrics = useMemo(() => {
    return calculateSellerFinancing({
      purchasePrice: creativePrice,
      listedTargetPrice: creativeTargetList,
      downPayment: creativeDown,
      annualInterestRate: creativeInterestRate,
      amortizationYears: creativeAmortYears,
      balloonMaturityYears: creativeBalloonYears,
      isInterestOnly: creativeIsIO,
      rehabMakeReady: creativeRehab,
      assignmentFee: creativeAssignmentFee,
      closingEscrowCosts: creativeClosingCosts,
      monthlyMarketRent: creativeRent,
      monthlyTaxes: creativeTaxes,
      monthlyInsurance: creativeInsurance,
      monthlyHoa: creativeHoa,
    });
  }, [
    creativePrice,
    creativeTargetList,
    creativeDown,
    creativeInterestRate,
    creativeAmortYears,
    creativeBalloonYears,
    creativeIsIO,
    creativeRehab,
    creativeAssignmentFee,
    creativeClosingCosts,
    creativeRent,
    creativeTaxes,
    creativeInsurance,
    creativeHoa,
  ]);

  // ==========================================================================
  // 3. SUBJECT-TO (SUBTO) MORTGAGE ASSUMPTION STATE
  // ==========================================================================
  const [subtoPrice, setSubtoPrice] = useState<number>(initialFields.purchasePrice);
  const [subtoCashToSeller, setSubtoCashToSeller] = useState<number>(7500);
  const [subtoArrears, setSubtoArrears] = useState<number>(0);
  const [subtoRehab, setSubtoRehab] = useState<number>(5000);
  const [subtoAssignmentFee, setSubtoAssignmentFee] = useState<number>(initialFields.fee);
  const [subtoClosingCosts, setSubtoClosingCosts] = useState<number>(2000);
  const [subtoRent, setSubtoRent] = useState<number>(initialFields.rent);
  const [subtoTaxesIns, setSubtoTaxesIns] = useState<number>(250);
  const [subtoHoa, setSubtoHoa] = useState<number>(40);

  // Existing debt liens
  const [liens, setLiens] = useState<MortgageLien[]>([
    {
      id: "1",
      label: "Senior 1st Mortgage",
      unpaidPrincipalBalance: Math.round(initialFields.purchasePrice * 0.75),
      interestRate: 3.25,
      monthlyPaymentPITI: 1250,
    },
  ]);

  const subtoMetrics = useMemo(() => {
    return calculateSubjectTo({
      purchasePrice: subtoPrice,
      cashToSeller: subtoCashToSeller,
      arrearsReinstatement: subtoArrears,
      rehabMakeReady: subtoRehab,
      assignmentFee: subtoAssignmentFee,
      closingEscrowCosts: subtoClosingCosts,
      liens,
      monthlyMarketRent: subtoRent,
      monthlyTaxesAndInsurance: subtoTaxesIns,
      monthlyHoa: subtoHoa,
    });
  }, [
    subtoPrice,
    subtoCashToSeller,
    subtoArrears,
    subtoRehab,
    subtoAssignmentFee,
    subtoClosingCosts,
    liens,
    subtoRent,
    subtoTaxesIns,
    subtoHoa,
  ]);

  // ==========================================================================
  // 4. DEAL VIABILITY SCORECARD
  // ==========================================================================
  const currentViability = useMemo(() => {
    if (tab === "cash") {
      return evaluateDealViability("cash", {
        investorROI: cashMetrics.investorROI,
        netWholesaleOffer: cashMetrics.netWholesaleOffer,
        maxAllowableOffer: cashMetrics.maxAllowableOffer,
      });
    } else if (tab === "subto") {
      return evaluateDealViability("subto", {
        netMonthlyCashFlow: subtoMetrics.netMonthlyCashFlow,
        cashOnCashReturn: subtoMetrics.cashOnCashReturn,
        entryCapitalPct: subtoMetrics.entryCapitalPct,
      });
    } else {
      return evaluateDealViability("creative", {
        netMonthlyCashFlow: creativeMetrics.netMonthlyCashFlow,
        cashOnCashReturn: creativeMetrics.cashOnCashReturn,
        entryCapitalPct: creativeMetrics.entryCapitalPct,
        dscr: creativeMetrics.dscr,
      });
    }
  }, [tab, cashMetrics, subtoMetrics, creativeMetrics]);

  // ==========================================================================
  // 5. EXECUTIVE MULTI-OPTION PROPOSAL / LOI GENERATION
  // ==========================================================================
  const [selectedProposalOptions, setSelectedProposalOptions] = useState<Array<"cash" | "subto" | "creative">>([
    "cash",
    "subto",
    "creative",
  ]);
  const [closingDays, setClosingDays] = useState<number>(14);
  const [includeAssignability, setIncludeAssignability] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<"formatted" | "plain">("formatted");
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [savingToCrm, setSavingToCrm] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const proposalData = useMemo(() => {
    return generateMultiOptionProposal({
      propertyAddress,
      sellerName,
      acquisitionsCompany,
      selectedOptions: selectedProposalOptions,
      closingDays,
      cashMetrics,
      subtoMetrics,
      subtoInput: {
        purchasePrice: subtoPrice,
        cashToSeller: subtoCashToSeller,
        arrearsReinstatement: subtoArrears,
        rehabMakeReady: subtoRehab,
        assignmentFee: subtoAssignmentFee,
        closingEscrowCosts: subtoClosingCosts,
        liens,
        monthlyMarketRent: subtoRent,
        monthlyTaxesAndInsurance: subtoTaxesIns,
        monthlyHoa: subtoHoa,
      },
      creativeMetrics,
      creativeInput: {
        purchasePrice: creativePrice,
        listedTargetPrice: creativeTargetList,
        downPayment: creativeDown,
        annualInterestRate: creativeInterestRate,
        amortizationYears: creativeAmortYears,
        balloonMaturityYears: creativeBalloonYears,
        isInterestOnly: creativeIsIO,
        rehabMakeReady: creativeRehab,
        assignmentFee: creativeAssignmentFee,
        closingEscrowCosts: creativeClosingCosts,
        monthlyMarketRent: creativeRent,
        monthlyTaxes: creativeTaxes,
        monthlyInsurance: creativeInsurance,
        monthlyHoa: creativeHoa,
      },
      includeAssignabilityClause: includeAssignability,
    });
  }, [
    propertyAddress,
    sellerName,
    acquisitionsCompany,
    selectedProposalOptions,
    closingDays,
    cashMetrics,
    subtoMetrics,
    subtoPrice,
    subtoCashToSeller,
    subtoArrears,
    subtoRehab,
    subtoAssignmentFee,
    subtoClosingCosts,
    liens,
    subtoRent,
    subtoTaxesIns,
    subtoHoa,
    creativeMetrics,
    creativePrice,
    creativeTargetList,
    creativeDown,
    creativeInterestRate,
    creativeAmortYears,
    creativeBalloonYears,
    creativeIsIO,
    creativeRehab,
    creativeAssignmentFee,
    creativeClosingCosts,
    creativeRent,
    creativeTaxes,
    creativeInsurance,
    creativeHoa,
    includeAssignability,
  ]);

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(proposalData.plainText);
      setCopySuccess("Copied plain text LOI to clipboard!");
      setTimeout(() => setCopySuccess(null), 3000);
    } catch {
      setCopySuccess("Failed to copy");
    }
  };

  const handleSaveTermsToProperty = async () => {
    if (!property) return;
    setSavingToCrm(true);
    setSaveSuccessMsg(null);
    try {
      const nextCustom = [...(property.customFields || [])];
      const setCf = (name: string, value: string | number) => {
        const idx = nextCustom.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
        if (idx >= 0) nextCustom[idx] = { name, value: String(value) };
        else nextCustom.push({ name, value: String(value) });
      };

      setCf("Assignment Fee", `$${cashAssignmentFee.toLocaleString()}`);
      setCf("ARV", `$${cashArv.toLocaleString()}`);
      setCf("Estimated Repairs", `$${cashRepairs.toLocaleString()}`);
      setCf("Cash Offer (MAO)", `$${cashMetrics.netWholesaleOffer.toLocaleString()}`);
      setCf("Creative Price", `$${creativePrice.toLocaleString()}`);
      setCf("Creative Down", `$${creativeDown.toLocaleString()}`);
      setCf("SubTo Loan Debt", `$${subtoMetrics.totalExistingDebt.toLocaleString()}`);

      const res = await api.updateClient(property.id, {
        customFields: nextCustom,
        dealValue: cashAssignmentFee,
      });

      if (res && res.client) {
        setSaveSuccessMsg("✓ Underwritten terms & assignment fee saved to property!");
        if (onUpdated) onUpdated(res.client);
        setTimeout(() => setSaveSuccessMsg(null), 3500);
      }
    } catch (e) {
      setSaveSuccessMsg(e instanceof Error ? e.message : "Failed to save terms.");
    } finally {
      setSavingToCrm(false);
    }
  };

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
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
        className="modal-card"
        style={{
          width: "100%",
          maxWidth: "1200px",
          maxHeight: "94vh",
          backgroundColor: "var(--surface-sunken, #0f172a)",
          border: "1px solid var(--border, #334155)",
          borderRadius: "14px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
          color: "var(--text, #f8fafc)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--border, #1e293b)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "var(--surface, #090d14)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "24px" }}>📐</span>
            <div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--text, #f8fafc)", letterSpacing: "-0.01em" }}>
                Revzenta Deal Underwriter™
              </h2>
              <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "var(--text-dim, #94a3b8)" }}>
                Proprietary Acquisitions Modeling • Cash Wholesale MAO • Seller Financing • Subject-To
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="icon-btn"
            style={{ fontSize: "18px", cursor: "pointer", background: "none", border: "none", color: "var(--text-dim, #94a3b8)" }}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: "var(--surface-header, #0a1120)",
            padding: "12px 20px",
            gap: "10px",
            borderBottom: "1px solid var(--border, #1e293b)",
            overflowX: "auto",
          }}
        >
          {[
            { id: "proposal" as const, icon: "📋", label: "Multi-Option LOI & Proposal" },
            { id: "cash" as const, icon: "💵", label: "Cash Wholesale & MAO" },
            { id: "creative" as const, icon: "🤝", label: "Seller Financing (Owner Carry)" },
            { id: "subto" as const, icon: "🏦", label: "Subject-To (Mortgage Takeover)" },
          ].map((item) => {
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                style={{
                  padding: "10px 18px",
                  borderRadius: "8px",
                  border: isActive ? "1px solid #38bdf8" : "1px solid var(--border, #334155)",
                  background: isActive
                    ? "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)"
                    : "var(--surface, #1e293b)",
                  color: isActive ? "#ffffff" : "var(--text-dim, #cbd5e1)",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
          
          {/* ================================================================ */}
          {/* TAB 1: MULTI-OPTION LOI & PROPOSAL */}
          {/* ================================================================ */}
          {tab === "proposal" && (
            <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "20px" }}>
              {/* Controls Column */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "var(--surface, #1e293b)", padding: "16px", borderRadius: "10px", border: "1px solid var(--border, #334155)" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 700 }}>Proposal Settings</h3>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div>
                      <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Property Address</span>
                      <input
                        type="text"
                        value={propertyAddress}
                        onChange={(e) => setPropertyAddress(e.target.value)}
                        style={{ width: "100%", height: "36px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface-sunken)" }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Seller / Owner</span>
                      <input
                        type="text"
                        value={sellerName}
                        onChange={(e) => setSellerName(e.target.value)}
                        style={{ width: "100%", height: "36px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface-sunken)" }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Buyer Vesting Entity</span>
                      <input
                        type="text"
                        value={acquisitionsCompany}
                        onChange={(e) => setAcquisitionsCompany(e.target.value)}
                        placeholder="Revzenta Capital"
                        style={{ width: "100%", height: "36px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface-sunken)" }}
                      />
                    </div>

                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "8px" }}>Include Purchase Options:</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {[
                          { id: "cash" as const, label: "Immediate All-Cash ($" + cashMetrics.netWholesaleOffer.toLocaleString() + ")" },
                          { id: "subto" as const, label: "Subject-To Mortgage Takeover" },
                          { id: "creative" as const, label: "Seller Financing ($" + creativePrice.toLocaleString() + ")" },
                        ].map((opt) => (
                          <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={selectedProposalOptions.includes(opt.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedProposalOptions([...selectedProposalOptions, opt.id]);
                                } else {
                                  if (selectedProposalOptions.length > 1) {
                                    setSelectedProposalOptions(selectedProposalOptions.filter((x) => x !== opt.id));
                                  }
                                }
                              }}
                            />
                            <span>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        id="assignClause"
                        checked={includeAssignability}
                        onChange={(e) => setIncludeAssignability(e.target.checked)}
                      />
                      <label htmlFor="assignClause" style={{ fontSize: "12px", cursor: "pointer" }}>
                        Include Assignability Clause
                      </label>
                    </div>

                    <div>
                      <span style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>Closing Timeline (Days)</span>
                      <input
                        type="number"
                        min={3}
                        max={90}
                        value={closingDays}
                        onChange={(e) => setClosingDays(Number(e.target.value) || 14)}
                        style={{ width: "100%", height: "36px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface-sunken)" }}
                      />
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: "100%", padding: "10px", fontWeight: 700 }}
                    onClick={handleCopyText}
                  >
                    📋 Copy Text LOI
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: "100%", padding: "10px", fontWeight: 600 }}
                    onClick={handleSaveTermsToProperty}
                    disabled={savingToCrm || !property}
                  >
                    {savingToCrm ? "Saving..." : "💾 Save Terms & Fee to Property"}
                  </button>

                  {copySuccess && (
                    <div style={{ padding: "6px 10px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontSize: "12px", textAlign: "center" }}>
                      {copySuccess}
                    </div>
                  )}
                  {saveSuccessMsg && (
                    <div style={{ padding: "6px 10px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontSize: "12px", textAlign: "center" }}>
                      {saveSuccessMsg}
                    </div>
                  )}
                </div>
              </div>

              {/* Preview Column */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => setViewMode("formatted")}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: "1px solid var(--border)",
                        background: viewMode === "formatted" ? "var(--primary, #0284c7)" : "transparent",
                        color: viewMode === "formatted" ? "#ffffff" : "var(--text-dim)",
                        cursor: "pointer",
                      }}
                    >
                      Executive Formatted
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("plain")}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: "1px solid var(--border)",
                        background: viewMode === "plain" ? "var(--primary, #0284c7)" : "transparent",
                        color: viewMode === "plain" ? "#ffffff" : "var(--text-dim)",
                        cursor: "pointer",
                      }}
                    >
                      Plain Text / Email
                    </button>
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>
                    Live Synchronized Proposal
                  </span>
                </div>

                <div
                  style={{
                    background: "var(--surface, #1e293b)",
                    borderRadius: "10px",
                    border: "1px solid var(--border, #334155)",
                    padding: "20px",
                    minHeight: "500px",
                    maxHeight: "650px",
                    overflowY: "auto",
                  }}
                >
                  {viewMode === "formatted" ? (
                    <div dangerouslySetInnerHTML={{ __html: proposalData.htmlMarkup }} />
                  ) : (
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: "13px", lineHeight: "1.5", margin: 0 }}>
                      {proposalData.plainText}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* TAB 2: CASH WHOLESALE & MAO */}
          {/* ================================================================ */}
          {tab === "cash" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "24px" }}>
              {/* Inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 700 }}>Property Valuation & Rehab Scope</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    <CurrencyField label="After-Repair Value (ARV)" value={cashArv} onChange={setCashArv} hint="Appraised retail" />
                    <CurrencyField label="Estimated Repairs" value={cashRepairs} onChange={setCashRepairs} hint="Scope of rehab" />
                    <NumberField label="Target Investor Rule" value={cashInvestorRule} onChange={setCashInvestorRule} suffix="%" hint="Usually 70% or 75%" />
                    <CurrencyField label="Wholesale Assignment Fee" value={cashAssignmentFee} onChange={setCashAssignmentFee} hint="Your net fee" />
                  </div>
                </div>

                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 700 }}>Wholesale MAO Breakdown</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>1. ARV × Investor Target ({cashInvestorRule}%):</span>
                      <strong>${Math.round(cashArv * (cashInvestorRule / 100)).toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>2. Less Estimated Rehab:</span>
                      <span style={{ color: "#ef4444" }}>-${cashRepairs.toLocaleString()}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>3. Less Buyer Closing Friction (1.5%):</span>
                      <span style={{ color: "#ef4444" }}>-${cashMetrics.buyerClosingCostAmount.toLocaleString()}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontWeight: 700 }}>
                      <span>Gross Max Allowable Offer (MAO):</span>
                      <span style={{ color: "#38bdf8" }}>${cashMetrics.maxAllowableOffer.toLocaleString()}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>4. Less Wholesale Assignment Fee:</span>
                      <span style={{ color: "#10b981", fontWeight: 700 }}>-${cashAssignmentFee.toLocaleString()}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 4px 0", fontSize: "16px", fontWeight: 800 }}>
                      <span>Your Net Purchase Offer to Seller:</span>
                      <span style={{ color: "#10b981" }}>${cashMetrics.netWholesaleOffer.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Viability & End Buyer Output */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Viability Card */}
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>Revzenta Deal Viability Index</h3>
                      <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>{currentViability.verdict}</span>
                    </div>
                    <span style={{ fontSize: "22px", fontWeight: 800, color: currentViability.score >= 80 ? "#10b981" : currentViability.score >= 60 ? "#f59e0b" : "#ef4444" }}>
                      {currentViability.score}/100 ({currentViability.grade})
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {currentViability.checks.map((c, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "6px 8px", borderRadius: "6px", background: "var(--surface-sunken)" }}>
                        <span>{c.title}</span>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <span style={{ fontWeight: 600 }}>{c.metricValue}</span>
                          <span style={{ color: c.status === "passed" ? "#10b981" : c.status === "warning" ? "#f59e0b" : "#ef4444" }}>
                            {c.status === "passed" ? "✓" : c.status === "warning" ? "!" : "✕"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cash Buyer Pitch Box */}
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 700 }}>Cash Buyer Metrics (Pitch Deck)</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "13px" }}>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Buyer Purchase Price</span>
                      <strong style={{ fontSize: "16px" }}>${(cashMetrics.netWholesaleOffer + cashAssignmentFee).toLocaleString()}</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Projected Flip Profit</span>
                      <strong style={{ fontSize: "16px", color: "#10b981" }}>${cashMetrics.investorGrossProfit.toLocaleString()}</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Buyer ROI</span>
                      <strong style={{ fontSize: "16px", color: "#38bdf8" }}>{cashMetrics.investorROI.toFixed(1)}%</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Your Assignment Fee</span>
                      <strong style={{ fontSize: "16px", color: "#10b981" }}>${cashAssignmentFee.toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* TAB 3: SELLER FINANCING (CREATIVE TERMS) */}
          {/* ================================================================ */}
          {tab === "creative" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "24px" }}>
              {/* Inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 700 }}>Note Terms & Purchase Price</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    <CurrencyField label="Purchase Price" value={creativePrice} onChange={setCreativePrice} />
                    <CurrencyField label="Down Payment" value={creativeDown} onChange={setCreativeDown} hint={creativeMetrics.downPaymentPct.toFixed(1) + "% down"} />
                    <NumberField label="Annual Interest Rate" value={creativeInterestRate} onChange={setCreativeInterestRate} suffix="%" step={0.25} />
                    <NumberField label="Amortization Schedule" value={creativeAmortYears} onChange={setCreativeAmortYears} suffix=" yrs" />
                    <NumberField label="Balloon Term Due" value={creativeBalloonYears} onChange={setCreativeBalloonYears} suffix=" yrs" />
                    <CurrencyField label="Wholesale Assignment Fee" value={creativeAssignmentFee} onChange={setCreativeAssignmentFee} />
                  </div>

                  <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="checkbox"
                      id="isIOCheck"
                      checked={creativeIsIO}
                      onChange={(e) => setCreativeIsIO(e.target.checked)}
                    />
                    <label htmlFor="isIOCheck" style={{ fontSize: "12px", cursor: "pointer", fontWeight: 600 }}>
                      Interest-Only (I/O) Monthly Payments
                    </label>
                  </div>
                </div>

                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 700 }}>Property Rental & Expenses</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    <CurrencyField label="Market Rent" value={creativeRent} onChange={setCreativeRent} hint="Gross rental revenue" />
                    <CurrencyField label="Monthly Taxes" value={creativeTaxes} onChange={setCreativeTaxes} />
                    <CurrencyField label="Monthly Insurance" value={creativeInsurance} onChange={setCreativeInsurance} />
                    <CurrencyField label="Monthly HOA" value={creativeHoa} onChange={setCreativeHoa} />
                  </div>
                </div>
              </div>

              {/* Yield & Viability Output */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Scorecard */}
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>Deal Viability Index</h3>
                      <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>{currentViability.verdict}</span>
                    </div>
                    <span style={{ fontSize: "22px", fontWeight: 800, color: currentViability.score >= 80 ? "#10b981" : currentViability.score >= 60 ? "#f59e0b" : "#ef4444" }}>
                      {currentViability.score}/100 ({currentViability.grade})
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {currentViability.checks.map((c, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "6px 8px", borderRadius: "6px", background: "var(--surface-sunken)" }}>
                        <span>{c.title}</span>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <span style={{ fontWeight: 600 }}>{c.metricValue}</span>
                          <span style={{ color: c.status === "passed" ? "#10b981" : c.status === "warning" ? "#f59e0b" : "#ef4444" }}>
                            {c.status === "passed" ? "✓" : c.status === "warning" ? "!" : "✕"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Returns Summary */}
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 700 }}>Operational Cash Flow & Exit</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "13px" }}>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Monthly Note Payment (P&I)</span>
                      <strong style={{ fontSize: "16px", color: "#38bdf8" }}>${Math.round(creativeMetrics.monthlyDebtService).toLocaleString()}/mo</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Net Monthly Cash Flow</span>
                      <strong style={{ fontSize: "16px", color: creativeMetrics.netMonthlyCashFlow >= 0 ? "#10b981" : "#ef4444" }}>
                        ${Math.round(creativeMetrics.netMonthlyCashFlow).toLocaleString()}/mo
                      </strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Cash-on-Cash Return</span>
                      <strong style={{ fontSize: "16px", color: "#10b981" }}>{creativeMetrics.cashOnCashReturn.toFixed(1)}%</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Buyer Total Entry Capital</span>
                      <strong style={{ fontSize: "16px" }}>${creativeMetrics.totalBuyerEntryCapital.toLocaleString()} ({creativeMetrics.entryCapitalPct.toFixed(1)}%)</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Balloon Payoff Balance ({creativeBalloonYears} yr)</span>
                      <strong style={{ fontSize: "16px" }}>${Math.round(creativeMetrics.balloonRemainingBalance).toLocaleString()}</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Total Wealth Paid to Seller</span>
                      <strong style={{ fontSize: "16px", color: "#38bdf8" }}>${Math.round(creativeMetrics.totalPayoutToSeller).toLocaleString()}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* TAB 4: SUBJECT-TO (SUBTO) MORTGAGE TAKEOVER */}
          {/* ================================================================ */}
          {tab === "subto" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "24px" }}>
              {/* Inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 700 }}>Existing Debt Portfolios (Mortgage Liens)</h3>
                  {liens.map((lien, index) => (
                    <div key={lien.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: "10px", marginBottom: "12px", alignItems: "end" }}>
                      <div>
                        <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block", marginBottom: "4px" }}>Lien Label</span>
                        <input
                          type="text"
                          value={lien.label}
                          onChange={(e) => {
                            const next = [...liens];
                            next[index].label = e.target.value;
                            setLiens(next);
                          }}
                          style={{ width: "100%", height: "36px", padding: "0 8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface-sunken)" }}
                        />
                      </div>
                      <CurrencyField
                        label="Balance"
                        value={lien.unpaidPrincipalBalance}
                        onChange={(val) => {
                          const next = [...liens];
                          next[index].unpaidPrincipalBalance = val;
                          setLiens(next);
                        }}
                      />
                      <NumberField
                        label="Rate %"
                        value={lien.interestRate}
                        onChange={(val) => {
                          const next = [...liens];
                          next[index].interestRate = val;
                          setLiens(next);
                        }}
                        suffix="%"
                        step={0.125}
                      />
                      <CurrencyField
                        label="PITI Payment"
                        value={lien.monthlyPaymentPITI}
                        onChange={(val) => {
                          const next = [...liens];
                          next[index].monthlyPaymentPITI = val;
                          setLiens(next);
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 700 }}>Cash-to-Seller & Entry Costs</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    <CurrencyField label="Contract Purchase Price" value={subtoPrice} onChange={setSubtoPrice} />
                    <CurrencyField label="Cash to Seller at Closing" value={subtoCashToSeller} onChange={setSubtoCashToSeller} hint="Seller walkaway cash" />
                    <CurrencyField label="Arrears / Reinstatement" value={subtoArrears} onChange={setSubtoArrears} hint="Catch up missed payments" />
                    <CurrencyField label="Wholesale Assignment Fee" value={subtoAssignmentFee} onChange={setSubtoAssignmentFee} hint="Your net spread" />
                    <CurrencyField label="Monthly Market Rent" value={subtoRent} onChange={setSubtoRent} />
                    <CurrencyField label="Taxes & Insurance (if not in PITI)" value={subtoTaxesIns} onChange={setSubtoTaxesIns} />
                  </div>
                </div>
              </div>

              {/* Viability & Summary Output */}
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Scorecard */}
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>Deal Viability Index</h3>
                      <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>{currentViability.verdict}</span>
                    </div>
                    <span style={{ fontSize: "22px", fontWeight: 800, color: currentViability.score >= 80 ? "#10b981" : currentViability.score >= 60 ? "#f59e0b" : "#ef4444" }}>
                      {currentViability.score}/100 ({currentViability.grade})
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {currentViability.checks.map((c, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "6px 8px", borderRadius: "6px", background: "var(--surface-sunken)" }}>
                        <span>{c.title}</span>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <span style={{ fontWeight: 600 }}>{c.metricValue}</span>
                          <span style={{ color: c.status === "passed" ? "#10b981" : c.status === "warning" ? "#f59e0b" : "#ef4444" }}>
                            {c.status === "passed" ? "✓" : c.status === "warning" ? "!" : "✕"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SubTo Metrics Summary */}
                <div style={{ background: "var(--surface, #1e293b)", padding: "18px", borderRadius: "10px", border: "1px solid var(--border)" }}>
                  <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", fontWeight: 700 }}>Mortgage Assumption Economics</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "13px" }}>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Total Debt Taken Over</span>
                      <strong style={{ fontSize: "16px", color: "#38bdf8" }}>${subtoMetrics.totalExistingDebt.toLocaleString()}</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Monthly Debt Service</span>
                      <strong style={{ fontSize: "16px" }}>${Math.round(subtoMetrics.totalMonthlyDebtService).toLocaleString()}/mo</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Net Monthly Cash Flow</span>
                      <strong style={{ fontSize: "16px", color: subtoMetrics.netMonthlyCashFlow >= 0 ? "#10b981" : "#ef4444" }}>
                        ${Math.round(subtoMetrics.netMonthlyCashFlow).toLocaleString()}/mo
                      </strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Total Buyer Entry Capital</span>
                      <strong style={{ fontSize: "16px", color: "#10b981" }}>${subtoMetrics.totalBuyerEntryCapital.toLocaleString()} ({subtoMetrics.entryCapitalPct.toFixed(1)}%)</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Cash-on-Cash Return</span>
                      <strong style={{ fontSize: "16px", color: "#10b981" }}>{subtoMetrics.cashOnCashReturn.toFixed(1)}%</strong>
                    </div>
                    <div style={{ background: "var(--surface-sunken)", padding: "10px", borderRadius: "6px" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-dim)", display: "block" }}>Captured Equity Spread</span>
                      <strong style={{ fontSize: "16px", color: "#38bdf8" }}>${subtoMetrics.sellerEquityCaptured.toLocaleString()} ({subtoMetrics.equityPct.toFixed(1)}%)</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid var(--border, #1e293b)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "var(--surface, #090d14)",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--text-dim)" }}>
            Revzenta Acquisitions Engine • 100% Proprietary Underwriting
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Close
            </button>
            {property && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveTermsToProperty}
                disabled={savingToCrm}
              >
                {savingToCrm ? "Saving..." : "Save Terms to Property"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
