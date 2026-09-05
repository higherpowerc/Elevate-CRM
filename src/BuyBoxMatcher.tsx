import { useEffect, useMemo, useState } from "react";
import { api, type ClientInput } from "./api";
import { money, type Client, type CustomFieldDef } from "./types";
import {
  evaluateMatch,
  getCustomField,
  getPropertyPrice,
  getBuyerMaxBudget,
  getMatchesByProperty,
  getMatchesByBuyer,
  type BuyBoxMatch,
  type PropertyMatchGroup,
} from "./buyBoxUtils";
import BuyerModal from "./BuyerModal";
import CsvImportModal from "./CsvImportModal";
import { blurPii, usePii } from "./pii";

interface Props {
  canEdit?: boolean;
}

export default function BuyBoxMatcher({ canEdit = true }: Props) {
  const pii = usePii();
  const [clients, setClients] = useState<Client[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"matcher" | "directory">("matcher");
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [buyerModal, setBuyerModal] = useState<{ mode: "create" } | { mode: "edit"; client: Client } | null>(null);
  const [csvModal, setCsvModal] = useState(false);
  const [copiedPitchId, setCopiedPitchId] = useState<number | null>(null);

  async function load() {
    try {
      setError(null);
      const res = await api.clients();
      setClients(res.clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load records.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Split into properties and buyers
  const { properties, buyers } = useMemo(() => {
    if (!clients) return { properties: [], buyers: [] };
    const props = clients.filter(
      (c) => !c.archived && !c.lost && c.clientType !== "buyer" && c.stage !== "Buyer",
    );
    const buyrs = clients.filter(
      (c) => !c.archived && !c.lost && (c.clientType === "buyer" || c.stage === "Buyer"),
    );
    return { properties: props, buyers: buyrs };
  }, [clients]);

  // Compute all matches
  const propertyMatchGroups: PropertyMatchGroup[] = useMemo(() => {
    return getMatchesByProperty(properties, buyers);
  }, [properties, buyers]);

  // Default selected property to first one that has matches (or first property)
  const effectiveSelectedProperty = useMemo(() => {
    if (selectedPropertyId !== null) {
      const found = properties.find((p) => p.id === selectedPropertyId);
      if (found) return found;
    }
    if (propertyMatchGroups.length > 0) {
      return propertyMatchGroups[0].property;
    }
    return properties[0] || null;
  }, [selectedPropertyId, properties, propertyMatchGroups]);

  // Matches for the selected property
  const selectedPropertyMatches: BuyBoxMatch[] = useMemo(() => {
    if (!effectiveSelectedProperty) return [];
    const group = propertyMatchGroups.find((g) => g.property.id === effectiveSelectedProperty.id);
    return group ? group.matches : [];
  }, [effectiveSelectedProperty, propertyMatchGroups]);

  // Handle saving a buyer
  async function handleSaveBuyer(input: ClientInput, editing?: Client) {
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.updateClient(editing.id, input);
      else await api.createClient(input);
      setBuyerModal(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save buyer.");
    } finally {
      setBusy(false);
    }
  }

  function copyDealPitch(property: Client, buyer: Client) {
    const price = getPropertyPrice(property);
    const fullAddress = [property.address, property.city, property.state, property.zip].filter(Boolean).join(", ");
    const pitch = `Hi ${buyer.contactName || buyer.companyName},\n\nI have an off-market deal that matches your buy box:\n\n📍 Address: ${fullAddress || property.companyName}\n💰 Contract/Asking: $${price.toLocaleString()}\n🏗️ Type: ${property.clientType || "Residential"}\n📋 Notes: ${property.notes || "High cash flow / flip potential"}\n\nLet me know if you'd like the full lockbox & inspection access info!`;
    navigator.clipboard.writeText(pitch);
    setCopiedPitchId(buyer.id);
    setTimeout(() => setCopiedPitchId(null), 2500);
  }

  if (!clients) {
    return <div className="skeleton-block" aria-label="Loading Buy Box Matcher" />;
  }

  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>🎯 Buy Box & Dispo Matcher</h1>
          <p className="page-sub">
            Automatically match your wholesale property inventory with verified investors
          </p>
        </div>
        <div className="page-actions" style={{ display: "flex", gap: "8px" }}>
          {canEdit && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCsvModal(true)}
              title="Upload CSV to import investors or properties"
            >
              📥 Upload CSV
            </button>
          )}
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setBuyerModal({ mode: "create" })}>
              + New Investor
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Navigation Sub-Tabs */}
      <div style={{ display: "flex", gap: "10px", borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>
        <button
          type="button"
          className={activeTab === "matcher" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => setActiveTab("matcher")}
        >
          ⚡ Live Deal Matcher ({propertyMatchGroups.reduce((acc, g) => acc + g.matches.length, 0)} Matches)
        </button>
        <button
          type="button"
          className={activeTab === "directory" ? "btn btn-primary" : "btn btn-ghost"}
          onClick={() => setActiveTab("directory")}
        >
          📋 Investor Buy Boxes ({buyers.length} Investors)
        </button>
      </div>

      {activeTab === "matcher" ? (
        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "20px", alignItems: "start" }}>
          {/* Left: Properties Selector */}
          <div className="card" style={{ padding: "16px" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "12px" }}>
              Wholesale Inventory ({properties.length})
            </h2>
            {properties.length === 0 ? (
              <p className="cell-muted">No active properties in pipeline.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {properties.map((p) => {
                  const isSelected = effectiveSelectedProperty?.id === p.id;
                  const group = propertyMatchGroups.find((g) => g.property.id === p.id);
                  const matchCount = group ? group.matches.length : 0;
                  const price = getPropertyPrice(p);
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPropertyId(p.id)}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        border: isSelected ? "2px solid #58a6ff" : "1px solid var(--border)",
                        backgroundColor: isSelected ? "rgba(56, 139, 253, 0.12)" : "var(--card-bg, var(--panel))",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                        <span className={`cell-strong ${blurPii(pii)}`} style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                          {p.address || p.companyName}
                        </span>
                        {matchCount > 0 ? (
                          <span
                            className="badge tone-blue"
                            style={{ fontWeight: 700, fontSize: "0.75rem", padding: "2px 6px" }}
                          >
                            🎯 {matchCount} Match{matchCount === 1 ? "" : "es"}
                          </span>
                        ) : (
                          <span className="badge tone-gray" style={{ fontSize: "0.72rem" }}>No matches</span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: "6px" }}>
                        {[p.city, p.state].filter(Boolean).join(", ") || "Location unlisted"}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, color: "var(--green)" }}>{money(price)}</span>
                        <span className="badge type-badge tone-teal" style={{ fontSize: "0.72rem" }}>
                          {p.clientType || "Wholesale"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Matching Buyers */}
          <div>
            {effectiveSelectedProperty ? (
              <div className="card" style={{ padding: "20px" }}>
                <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "14px", marginBottom: "18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span className="badge tone-blue" style={{ marginBottom: "6px" }}>Selected Deal</span>
                      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "4px 0" }}>
                        <span className={blurPii(pii)}>{effectiveSelectedProperty.address || effectiveSelectedProperty.companyName}</span>
                      </h2>
                      <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem" }}>
                        {[effectiveSelectedProperty.city, effectiveSelectedProperty.state, effectiveSelectedProperty.zip].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--green)" }}>
                        {money(getPropertyPrice(effectiveSelectedProperty))}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Contract / Asking Price</div>
                    </div>
                  </div>
                </div>

                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "14px" }}>
                  Matching Investors ({selectedPropertyMatches.length})
                </h3>

                {selectedPropertyMatches.length === 0 ? (
                  <div className="card empty" style={{ padding: "30px", textAlign: "center" }}>
                    <p className="empty-title">No investors currently match this deal</p>
                    <p className="empty-sub">
                      Try expanding your investor list or adjusting their target markets, budget, or strategy criteria.
                    </p>
                    {canEdit && (
                      <button className="btn btn-primary" onClick={() => setBuyerModal({ mode: "create" })}>
                        + Add Investor For This Deal
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {selectedPropertyMatches.map((m) => {
                      const buyer = m.buyer;
                      const maxBudget = getBuyerMaxBudget(buyer);
                      const buyerType = getCustomField(buyer, "Buyer Type") || buyer.services?.[0] || "Cash Buyer";
                      const pof = getCustomField(buyer, "Proof of Funds") || "Verified Cash";
                      const targetMarkets = getCustomField(buyer, "Target Markets") || buyer.address || "All Markets";
                      const isPitchCopied = copiedPitchId === buyer.id;

                      return (
                        <div
                          key={buyer.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: "8px",
                            padding: "16px",
                            backgroundColor: "var(--card-bg, var(--panel))",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span className={`cell-strong ${blurPii(pii)}`} style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                                  {buyer.companyName}
                                </span>
                                {(() => {
                                  const stratCount = (buyer.services && buyer.services.length > 0)
                                    ? buyer.services.length
                                    : (buyerType.split(/[,/]+/).filter(Boolean).length || 1);
                                  return (
                                    <span
                                      className="badge tone-blue"
                                      style={{ fontWeight: 700, fontSize: "0.8rem", minWidth: "26px", padding: "2px 8px", textAlign: "center" }}
                                      title={`Buy Strategies (${stratCount}): ${buyerType}`}
                                    >
                                      {stratCount}
                                    </span>
                                  );
                                })()}
                                <span className="badge tone-green" style={{ fontSize: "0.75rem" }}>✓ {pof}</span>
                              </div>
                              {buyer.contactName && (
                                <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "2px" }}>
                                  Contact: <span className={blurPii(pii)}>{buyer.contactName}</span>
                                </div>
                              )}
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span
                                className="badge tone-lime"
                                style={{
                                  fontSize: "0.85rem",
                                  fontWeight: 800,
                                  padding: "4px 10px",
                                }}
                              >
                                {m.matchScore}% Match
                              </span>
                              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "4px" }}>
                                Max Budget: {money(maxBudget)}
                              </div>
                            </div>
                          </div>

                          {/* Match reasons pills */}
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                            {m.reasons.map((r, idx) => (
                              <span
                                key={idx}
                                className="badge"
                                style={{
                                  fontSize: "0.78rem",
                                  backgroundColor: "rgba(56, 139, 253, 0.15)",
                                  color: "var(--blue)",
                                  border: "1px solid rgba(56, 139, 253, 0.3)",
                                }}
                                title={r.detail}
                              >
                                ✓ {r.label}: {r.detail}
                              </span>
                            ))}
                          </div>

                          {/* Contact and pitch actions */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px" }}>
                            <div style={{ display: "flex", gap: "14px", fontSize: "0.85rem" }}>
                              {buyer.phone && (
                                <a
                                  href={`tel:${buyer.phone}`}
                                  className={`link ${blurPii(pii)}`}
                                  style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--blue)" }}
                                >
                                  📞 {buyer.phone}
                                </a>
                              )}
                              {buyer.email && (
                                <a
                                  href={`mailto:${buyer.email}?subject=Off-Market Deal in ${effectiveSelectedProperty.city || "Target Market"}`}
                                  className={`link ${blurPii(pii)}`}
                                  style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--blue)" }}
                                >
                                  ✉️ {buyer.email}
                                </a>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: "0.82rem", padding: "4px 10px" }}
                                onClick={() => copyDealPitch(effectiveSelectedProperty, buyer)}
                              >
                                {isPitchCopied ? "✓ Pitch Copied!" : "📋 Copy Deal Pitch"}
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ fontSize: "0.82rem", padding: "4px 8px" }}
                                  onClick={() => setBuyerModal({ mode: "edit", client: buyer })}
                                >
                                  Edit Buy Box
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="card empty" style={{ padding: "40px", textAlign: "center" }}>
                <p className="empty-title">Select a wholesale property to view matching investors</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Mode 2: Buy Boxes Directory */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
          {buyers.map((b) => {
            const maxBudget = getBuyerMaxBudget(b);
            const buyerType = getCustomField(b, "Buyer Type") || b.services?.[0] || "Cash Buyer";
            const pof = getCustomField(b, "Proof of Funds") || "Verified Cash";
            const targetMarkets = getCustomField(b, "Target Markets") || b.address || "Nationwide";
            const buyBox = getCustomField(b, "Buy Box") || b.notes || "Any residential / commercial deals";

            // Count matching properties for this buyer
            const matchCount = properties.filter((p) => evaluateMatch(p, b) !== null).length;

            return (
              <div
                key={b.id}
                className="card"
                style={{
                  padding: "18px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <div>
                      <h3 className={`cell-strong ${blurPii(pii)}`} style={{ fontSize: "1.1rem", margin: 0 }}>
                        {b.companyName}
                      </h3>
                      {b.contactName && (
                        <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "2px" }}>
                          Contact: <span className={blurPii(pii)}>{b.contactName}</span>
                        </div>
                      )}
                    </div>
                    {(() => {
                      const stratCount = (b.services && b.services.length > 0)
                        ? b.services.length
                        : (buyerType.split(/[,/]+/).filter(Boolean).length || 1);
                      return (
                        <span
                          className="badge tone-blue"
                          style={{ fontWeight: 700, fontSize: "0.8rem", minWidth: "26px", padding: "2px 8px", textAlign: "center" }}
                          title={`Buy Strategies (${stratCount}): ${buyerType}`}
                        >
                          {stratCount}
                        </span>
                      );
                    })()}
                  </div>

                  <div style={{ display: "flex", gap: "8px", margin: "8px 0" }}>
                    <span className="badge tone-green" style={{ fontSize: "0.75rem" }}>✓ {pof}</span>
                    <span className="badge tone-lime" style={{ fontSize: "0.75rem" }}>
                      Max Budget: {money(maxBudget)}
                    </span>
                  </div>

                  <div style={{ fontSize: "0.85rem", marginTop: "10px", lineHeight: "1.4" }}>
                    <div style={{ color: "var(--muted)", fontWeight: 600, fontSize: "0.78rem" }}>TARGET MARKETS:</div>
                    <div style={{ marginBottom: "8px" }}>📍 {targetMarkets}</div>

                    <div style={{ color: "var(--muted)", fontWeight: 600, fontSize: "0.78rem" }}>BUY BOX CRITERIA:</div>
                    <div style={{ color: "var(--ink)", fontSize: "0.85rem" }}>{buyBox}</div>
                  </div>
                </div>

                <div style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span
                    className="badge tone-blue"
                    style={{ fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}
                    onClick={() => {
                      setActiveTab("matcher");
                    }}
                  >
                    🎯 {matchCount} Deal Match{matchCount === 1 ? "" : "es"}
                  </span>
                  {canEdit && (
                    <button
                      className="icon-btn"
                      onClick={() => setBuyerModal({ mode: "edit", client: b })}
                    >
                      Edit Buy Box
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Buyer Modal */}
      {buyerModal && (
        <BuyerModal
          buyer={buyerModal.mode === "edit" ? buyerModal.client : undefined}
          busy={busy}
          onClose={() => setBuyerModal(null)}
          onSave={handleSaveBuyer}
        />
      )}
      {csvModal && (
        <CsvImportModal
          initialTarget="investors"
          onClose={() => setCsvModal(false)}
          onSuccess={() => {
            setCsvModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}
