import { useEffect, useState, type FormEvent } from "react";
import type { Client } from "./types";

interface Props {
  buyer?: Client;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    clientType: "buyer";
    stage: string;
    dealValue: number;
    address: string;
    services: string[];
    customFields: Array<{ name: string; value: string }>;
    notes: string;
  }, editing?: Client) => void;
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
    buyer?.customFields?.find((f) => f.name.toLowerCase() === name.toLowerCase())?.value || "";

  const [companyName, setCompanyName] = useState(buyer?.companyName || "");
  const [contactName, setContactName] = useState(buyer?.contactName || "");
  const [email, setEmail] = useState(buyer?.email || "");
  const [phone, setPhone] = useState(buyer?.phone || "");

  const initialStrategies: string[] = (() => {
    if (!buyer) return [];
    const raw = getField("Buyer Type") || "";
    const list: string[] = [];
    if (raw) {
      list.push(...raw.split(/[,/]+/).map((s) => normalizeStrategy(s.trim())).filter(Boolean));
    }
    if (buyer.services && Array.isArray(buyer.services)) {
      list.push(...buyer.services.map((s) => normalizeStrategy(s.trim())).filter(Boolean));
    }
    return Array.from(new Set(list)).filter((s) => STRATEGIES.includes(s));
  })();

  const [strategies, setStrategies] = useState<string[]>(initialStrategies);
  const [targetMarkets, setTargetMarkets] = useState(getField("Target Markets") || buyer?.address || "");
  const [maxBudget, setMaxBudget] = useState<number>(buyer?.dealValue || 450000);
  const [pofStatus, setPofStatus] = useState(getField("Proof of Funds") || "Verified Cash");
  const [buyBox, setBuyBox] = useState(getField("Buy Box") || buyer?.notes || "");
  const [error, setError] = useState<string | null>(null);

  const toggleStrategy = (s: string) => {
    setStrategies((prev) =>
      prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]
    );
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("Buyer or entity name is required.");
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setError("Please provide an email or phone number for the buyer.");
      return;
    }
    if (strategies.length === 0) {
      setError("Please select at least one investment strategy for this buyer.");
      return;
    }
    setError(null);

    onSave(
      {
        companyName: companyName.trim(),
        contactName: contactName.trim() || companyName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        clientType: "buyer",
        stage: "Buyer",
        dealValue: Number(maxBudget) || 0,
        address: targetMarkets.trim(),
        services: strategies,
        customFields: [
          { name: "Buyer Type", value: strategies.join(", ") },
          { name: "Target Markets", value: targetMarkets.trim() },
          { name: "Max Budget", value: `$${Number(maxBudget || 0).toLocaleString()}` },
          { name: "Proof of Funds", value: pofStatus },
          { name: "Buy Box", value: buyBox.trim() },
        ],
        notes: buyBox.trim(),
      },
      buyer,
    );
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={buyer ? "Edit Investor" : "New Investor"}>
      <div className="modal" style={{ maxWidth: "600px" }}>
        <div className="modal-head">
          <div>
            <h2>{buyer ? "Edit Investor" : "New Investor"}</h2>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>
              Add a qualified investor to your wholesale disposition list.
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close modal">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {error && <div className="alert alert-error">{error}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span className="field-label">Investor / Entity Name *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apex Holdings LLC or Michael Vance"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
              </label>

              <label className="field">
                <span className="field-label">Contact Person</span>
                <input
                  type="text"
                  placeholder="e.g. Michael Vance"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  disabled={busy}
                />
              </label>

              <label className="field">
                <span className="field-label">Proof of Funds (POF)</span>
                <select value={pofStatus} onChange={(e) => setPofStatus(e.target.value)} disabled={busy}>
                  {POF_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">Email</span>
                <input
                  type="email"
                  placeholder="e.g. investor@apex.com"
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
                {STRATEGIES.map((s) => {
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
                      {active ? "✓ " : "+ "}
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
