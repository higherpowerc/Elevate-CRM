import { useEffect, useState, type FormEvent } from "react";
import type { Client } from "./types";

interface Props {
  buyer?: any;
  busy: boolean;
  onClose: () => void;
  onSave: (input: any, editing?: any) => void;
}

const STRATEGIES = [
  "Cash Buyer",
  "Creative Financing (SubTo / Seller Finance)",
  "Fix & Flip",
  "Buy & Hold (Rental)",
  "Novation / Hybrid",
  "Commercial / Land",
];

const POF_OPTIONS = [
  "Verified Cash",
  "Hard Money Approved",
  "Pending Verification",
  "Pre-Approved Conventional",
];

function normalizeStrategy(s: string): string {
  const lower = s.toLowerCase().trim();
  if (lower.includes("cash")) return "Cash Buyer";
  if (lower.includes("creative") || lower.includes("subto") || lower.includes("seller finance")) return "Creative Financing (SubTo / Seller Finance)";
  if (lower.includes("flip")) return "Fix & Flip";
  if (lower.includes("hold") || lower.includes("rental")) return "Buy & Hold (Rental)";
  if (lower.includes("novation") || lower.includes("hybrid")) return "Novation / Hybrid";
  if (lower.includes("commercial") || lower.includes("land")) return "Commercial / Land";
  return s;
}

export default function BuyerModal({ buyer, busy, onClose, onSave }: Props) {
  const getField = (name: string) =>
    buyer?.customFields?.find((f: any) => f.name.toLowerCase() === name.toLowerCase())?.value || "";

  const [companyName, setCompanyName] = useState(buyer?.companyName || buyer?.name || "");
  const [contactName, setContactName] = useState(buyer?.contactName || "");
  const [email, setEmail] = useState(buyer?.email || "");
  const [phone, setPhone] = useState(buyer?.phone || "");

  const initialStrategies: string[] = (() => {
    const rawServices: string[] = Array.isArray(buyer?.services) ? buyer.services : [];
    if (rawServices.length > 0) {
      return rawServices.map(normalizeStrategy).filter(Boolean);
    }
    const stored = getField("Target Strategies") || getField("Investment Strategies");
    if (stored) {
      return stored.split(",").map(normalizeStrategy).filter(Boolean);
    }
    return [];
  })();

  const [strategies, setStrategies] = useState<string[]>(initialStrategies);

  const [buyerType, setBuyerType] = useState(
    getField("Buyer Type") || "Cash Buyer"
  );
  const [proofOfFunds, setProofOfFunds] = useState(
    getField("Proof of Funds") || "Pending Verification"
  );
  const [maxBudget, setMaxBudget] = useState<number>(() => {
    const raw = getField("Max Budget");
    if (raw) return Number(raw) || 0;
    return buyer?.dealValue || 0;
  });
  const [targetMarkets, setTargetMarkets] = useState(
    getField("Target Markets") || buyer?.address || ""
  );
  const [buyBox, setBuyBox] = useState(
    getField("Buy Box") || buyer?.criteria || buyer?.notes || ""
  );

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggleStrategy = (s: string) => {
    setStrategies((prev) =>
      prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() && !contactName.trim()) {
      setError("Please provide an investor name or company / entity name.");
      return;
    }
    setError(null);

    const customFields = [
      { name: "Buyer Type", value: buyerType },
      { name: "Proof of Funds", value: proofOfFunds },
      { name: "Max Budget", value: maxBudget ? String(maxBudget) : "" },
      { name: "Target Markets", value: targetMarkets.trim() },
      { name: "Buy Box", value: buyBox.trim() },
      { name: "Investment Strategies", value: strategies.join(", ") },
    ];

    onSave({
      companyName: (companyName.trim() || contactName.trim()),
      contactName: contactName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      clientType: "buyer",
      stage: "Buyer",
      dealValue: maxBudget,
      address: targetMarkets.trim(),
      services: strategies,
      customFields,
      notes: buyBox.trim(),
      name: (companyName.trim() || contactName.trim()),
      criteria: buyBox.trim(),
      bought: "",
    }, buyer);
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Investor Form">
      <div className="modal" style={{ maxWidth: "680px", width: "95%" }}>
        <div className="modal-head">
          <h2>{buyer ? "Edit Investor / Cash Buyer" : "Add Investor / Cash Buyer"}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form modal-form">
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "16px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label className="field">
                <span className="field-label">Investor / Entity Name *</span>
                <input
                  type="text"
                  placeholder="e.g. Apex Acquisitions LLC"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="field-label">Primary Contact Person</span>
                <input
                  type="text"
                  placeholder="e.g. Marcus Vance"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  disabled={busy}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label className="field">
                <span className="field-label">Investor Category</span>
                <select
                  value={buyerType}
                  onChange={(e) => setBuyerType(e.target.value)}
                  disabled={busy}
                >
                  <option value="Cash Buyer">Cash Buyer (Direct / Proof of Funds)</option>
                  <option value="Creative Financing">Creative Financing (SubTo / Seller Finance)</option>
                  <option value="Fix & Flip">Fix & Flip Operator</option>
                  <option value="Buy & Hold">Buy & Hold (Rental Portfolio)</option>
                  <option value="Wholesaler / Dispo">Wholesaler / Co-Wholesaler</option>
                  <option value="Institutional / Hedge Fund">Institutional / Hedge Fund</option>
                </select>
              </label>

              <label className="field">
                <span className="field-label">Proof of Funds (POF)</span>
                <select
                  value={proofOfFunds}
                  onChange={(e) => setProofOfFunds(e.target.value)}
                  disabled={busy}
                >
                  {POF_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label className="field">
                <span className="field-label">Email</span>
                <input
                  type="email"
                  placeholder="e.g. acquisitions@apex.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>

              <label className="field">
                <span className="field-label">Phone</span>
                <input
                  type="tel"
                  placeholder="e.g. (555) 234-5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={busy}
                />
              </label>
            </div>

            <div className="field">
              <span className="field-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Investment Strategies (Select all that apply)</span>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 400 }}>
                  {strategies.length} selected
                </span>
              </span>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
                {STRATEGIES.map((s, idx) => {
                  const active = strategies.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStrategy(s)}
                      style={{
                        padding: "5px 10px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                        background: active ? "var(--accent-subtle, rgba(59, 130, 246, 0.12))" : "var(--card-bg, transparent)",
                        color: active ? "var(--accent)" : "var(--text-main)",
                        cursor: "pointer",
                        fontWeight: active ? 600 : 400,
                        transition: "all 0.15s ease",
                      }}
                    >
                      {active ? `✓ ${idx + 1}. ` : `+ ${idx + 1}. `}
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label className="field">
                <span className="field-label">Target Markets / Zip Codes</span>
                <input
                  type="text"
                  placeholder="e.g. Dallas, Fort Worth, 75001"
                  value={targetMarkets}
                  onChange={(e) => setTargetMarkets(e.target.value)}
                  disabled={busy}
                />
              </label>

              <label className="field">
                <span className="field-label">Max Budget / Buy Box Cap ($)</span>
                <input
                  type="number"
                  placeholder="e.g. 500000"
                  value={maxBudget || ""}
                  onChange={(e) => setMaxBudget(Number(e.target.value))}
                  disabled={busy}
                />
              </label>
            </div>

            <label className="field">
              <span className="field-label">Buy Box Criteria &amp; Acquisition Notes</span>
              <textarea
                rows={3}
                placeholder="e.g. Single Family 3/2+, minimum 1,400 sqft, 70% ARV minus repairs, cash close in 7-10 days."
                value={buyBox}
                onChange={(e) => setBuyBox(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>

          <div className="modal-foot" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "14px 20px" }}>
            <button type="button" className="btn btn-subtle" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : buyer ? "Save changes" : "Add investor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
