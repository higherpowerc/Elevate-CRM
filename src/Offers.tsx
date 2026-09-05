import { useState, useEffect, useMemo } from "react";
import { api } from "./api";
import type { WholesaleOffer, Client } from "./types";
import DealCalculatorModal from "./DealCalculatorModal";

interface Props {
  crmBusinessName?: string;
  onNavigateToProperty?: (clientId: number) => void;
}

export default function Offers({ crmBusinessName, onNavigateToProperty }: Props) {
  const [offers, setOffers] = useState<WholesaleOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [structureFilter, setStructureFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");

  // Expanded properties in grouped view (all expanded by default)
  const [expandedProperties, setExpandedProperties] = useState<Record<string, boolean>>({});

  // Calculator modal for creating a new offer
  const [calcProperty, setCalcProperty] = useState<Client | null | "new">(null);

  // Preview offer modal
  const [viewingOffer, setViewingOffer] = useState<WholesaleOffer | null>(null);

  // Load offers from server
  const loadOffers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.offers();
      if (res.ok) {
        setOffers(res.offers);
        // Start collapsed by default — user selects which property window to expand
        setExpandedProperties({});
      }
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      setError(m);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOffers();
  }, []);

  const togglePropertyExpanded = (key: string) => {
    setExpandedProperties((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Update offer status
  const handleUpdateStatus = async (offerId: number, newStatus: string) => {
    try {
      const res = await api.updateOffer(offerId, { status: newStatus });
      if (res.ok) {
        setOffers((prev) =>
          prev.map((o) => (o.id === offerId ? { ...o, status: newStatus } : o))
        );
      }
    } catch (err) {
      console.error("Failed to update offer status:", err);
    }
  };

  // Delete offer
  const handleDeleteOffer = async (offerId: number) => {
    if (!window.confirm("Are you sure you want to remove this offer record from storage?")) return;
    try {
      const res = await api.deleteOffer(offerId);
      if (res.ok) {
        setOffers((prev) => prev.filter((o) => o.id !== offerId));
      }
    } catch (err) {
      console.error("Failed to delete offer:", err);
    }
  };

  // Filtered offers
  const filteredOffers = useMemo(() => {
    return offers.filter((o) => {
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesAddress = o.propertyAddress?.toLowerCase().includes(q);
        const matchesSeller = o.sellerName?.toLowerCase().includes(q);
        const matchesEmail = o.sellerEmail?.toLowerCase().includes(q);
        const matchesRef = o.pdfId?.toLowerCase().includes(q);
        if (!matchesAddress && !matchesSeller && !matchesEmail && !matchesRef) return false;
      }

      // Status Filter
      if (statusFilter !== "all") {
        if (o.status?.toLowerCase() !== statusFilter.toLowerCase()) return false;
      }

      // Structure Filter
      if (structureFilter !== "all") {
        if (structureFilter === "cash" && !o.selectedOffers?.includes("cash") && o.offerType !== "cash" && o.cashOfferAmount <= 0) return false;
        if (structureFilter === "subto" && !o.selectedOffers?.includes("subto") && o.offerType !== "subto" && o.subtoPurchasePrice <= 0) return false;
        if (structureFilter === "creative" && !o.selectedOffers?.includes("creative") && o.offerType !== "creative" && o.creativePurchasePrice <= 0) return false;
      }

      return true;
    });
  }, [offers, search, statusFilter, structureFilter]);

  // Group offers by Property
  const propertyGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      clientId: number;
      propertyAddress: string;
      sellerName: string;
      sellerEmail: string;
      sellerPhone: string;
      stage: string;
      dealValue: number;
      offers: WholesaleOffer[];
      latestOffer: WholesaleOffer;
      maxOfferAmount: number;
    }> = [];

    const map = new Map<string, WholesaleOffer[]>();

    for (const o of filteredOffers) {
      const key = `${o.clientId || 0}:::${(o.propertyAddress || "Unknown Property").trim().toLowerCase()}`;
      const existing = map.get(key) || [];
      existing.push(o);
      map.set(key, existing);
    }

    map.forEach((propOffers, key) => {
      const first = propOffers[0];
      const maxAmt = Math.max(
        ...propOffers.map((o) =>
          Math.max(o.cashOfferAmount || 0, o.subtoPurchasePrice || 0, o.creativePurchasePrice || 0)
        )
      );

      groups.push({
        key,
        clientId: first.clientId,
        propertyAddress: first.propertyAddress || first.client?.companyName || "Subject Property",
        sellerName: first.sellerName || first.client?.companyName || "",
        sellerEmail: first.sellerEmail || first.client?.email || "",
        sellerPhone: first.client?.phone || "",
        stage: first.client?.stage || "Contacted",
        dealValue: first.client?.dealValue || maxAmt,
        offers: propOffers,
        latestOffer: propOffers[0],
        maxOfferAmount: maxAmt,
      });
    });

    return groups;
  }, [filteredOffers]);

  // Overall Metrics
  const stats = useMemo(() => {
    const totalOffers = offers.length;
    const uniqueProps = new Set(offers.map((o) => `${o.clientId}:::${o.propertyAddress}`)).size;
    const acceptedCount = offers.filter((o) => o.status?.toLowerCase() === "accepted").length;
    const totalVolume = offers.reduce((sum, o) => {
      const val = Math.max(o.cashOfferAmount || 0, o.subtoPurchasePrice || 0, o.creativePurchasePrice || 0);
      return sum + val;
    }, 0);

    return { totalOffers, uniqueProps, acceptedCount, totalVolume };
  }, [offers]);

  const getStatusBadgeStyle = (status: string) => {
    const s = (status || "sent").toLowerCase();
    if (s === "accepted") {
      return { backgroundColor: "#14532d", color: "#86efac", border: "1px solid #22c55e" };
    }
    if (s === "under review") {
      return { backgroundColor: "#1e3a8a", color: "#93c5fd", border: "1px solid #3b82f6" };
    }
    if (s === "countered") {
      return { backgroundColor: "#713f12", color: "#fde047", border: "1px solid #eab308" };
    }
    if (s === "declined") {
      return { backgroundColor: "#450a0a", color: "#fca5a5", border: "1px solid #ef4444" };
    }
    return { backgroundColor: "#0f172a", color: "#38bdf8", border: "1px solid #0284c7" };
  };

  return (
    <div className="offers-view" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Top Banner & Action */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "24px" }}>📋</span>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: "var(--ink)" }}>
              Wholesale Offers Repository
            </h1>
          </div>
          <p style={{ margin: "6px 0 0 0", fontSize: "13px", color: "var(--muted-2)" }}>
            Central storage & reference for all property purchase proposals, LOI letters, and creative structures.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadOffers}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              padding: "8px 14px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCalcProperty("new")}
            style={{
              backgroundColor: "#2563eb",
              color: "#ffffff",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
            }}
          >
            ➕ Create New Offer
          </button>
        </div>
      </div>

      {/* KPI Metrics Dashboard */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "14px",
        }}
      >
        <div
          style={{
            backgroundColor: "var(--card-bg, var(--panel))",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>Total Offers Sent</div>
          <div style={{ fontSize: "26px", fontWeight: 800, color: "var(--ink)", marginTop: "4px" }}>
            {stats.totalOffers}
          </div>
          <div style={{ fontSize: "11px", color: "#38bdf8", marginTop: "2px" }}>
            Generated LOI documents
          </div>
        </div>

        <div
          style={{
            backgroundColor: "var(--card-bg, var(--panel))",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>Properties Under Offer</div>
          <div style={{ fontSize: "26px", fontWeight: 800, color: "#58a6ff", marginTop: "4px" }}>
            {stats.uniqueProps}
          </div>
          <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
            Active homes pitched
          </div>
        </div>

        <div
          style={{
            backgroundColor: "var(--card-bg, var(--panel))",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>Accepted Offers</div>
          <div style={{ fontSize: "26px", fontWeight: 800, color: "#3fb950", marginTop: "4px" }}>
            {stats.acceptedCount}
          </div>
          <div style={{ fontSize: "11px", color: "#7ee787", marginTop: "2px" }}>
            {stats.totalOffers > 0 ? `${Math.round((stats.acceptedCount / stats.totalOffers) * 100)}% conversion` : "0% conversion"}
          </div>
        </div>

        <div
          style={{
            backgroundColor: "var(--card-bg, var(--panel))",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>Total Offer Volume</div>
          <div style={{ fontSize: "24px", fontWeight: 800, color: "#d2a8ff", marginTop: "4px" }}>
            ${stats.totalVolume.toLocaleString()}
          </div>
          <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
            Cumulative capital offered
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          backgroundColor: "var(--panel, var(--bg-soft))",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "14px 16px",
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: "12px", flex: "1 1 300px", flexWrap: "wrap" }}>
          <input
            type="text"
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Search by property address, seller, or email..."
            style={{
              background: "var(--card-bg, var(--panel))",
              color: "var(--ink)",
              border: "1px solid var(--border)",
              padding: "7px 12px",
              borderRadius: "6px",
              fontSize: "13px",
              flex: "1 1 240px",
              minWidth: "220px",
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              background: "var(--card-bg, var(--panel))",
              color: "var(--ink)",
              border: "1px solid var(--border)",
              padding: "7px 12px",
              borderRadius: "6px",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <option value="all">All Statuses</option>
            <option value="sent">Sent</option>
            <option value="under review">Under Review</option>
            <option value="accepted">Accepted</option>
            <option value="countered">Countered</option>
            <option value="declined">Declined</option>
          </select>

          <select
            value={structureFilter}
            onChange={(e) => setStructureFilter(e.target.value)}
            style={{
              background: "var(--card-bg, var(--panel))",
              color: "var(--ink)",
              border: "1px solid var(--border)",
              padding: "7px 12px",
              borderRadius: "6px",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            <option value="all">All Structures</option>
            <option value="cash">Cash MAO</option>
            <option value="subto">Subject-To</option>
            <option value="creative">Seller Financing</option>
          </select>
        </div>

        {/* View Mode Toggle */}
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => setViewMode("grouped")}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: viewMode === "grouped" ? "1.5px solid var(--accent, var(--lime))" : "1px solid var(--border)",
              backgroundColor: viewMode === "grouped" ? "var(--panel-2)" : "var(--card-bg, var(--panel))",
              color: viewMode === "grouped" ? "var(--ink)" : "var(--muted)",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🏠 Group by Property ({propertyGroups.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("flat")}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: viewMode === "flat" ? "1.5px solid var(--accent, var(--lime))" : "1px solid var(--border)",
              backgroundColor: viewMode === "flat" ? "var(--panel-2)" : "var(--card-bg, var(--panel))",
              color: viewMode === "flat" ? "var(--ink)" : "var(--muted)",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            📑 All Offers List ({filteredOffers.length})
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: "14px", borderRadius: "8px", backgroundColor: "rgba(239, 68, 68, 0.15)", color: "#f87171", fontSize: "13px" }}>
          Failed to load offers: {error}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)", fontSize: "14px" }}>
          Loading wholesale offers repository...
        </div>
      ) : propertyGroups.length === 0 ? (
        /* Empty State */
        <div
          style={{
            textAlign: "center",
            padding: "50px 20px",
            backgroundColor: "var(--card-bg, var(--panel))",
            borderRadius: "10px",
            border: "1px dashed var(--border)",
          }}
        >
          <div style={{ fontSize: "42px", marginBottom: "12px" }}>📬</div>
          <h3 style={{ margin: 0, fontSize: "17px", color: "var(--ink)" }}>No Offers Found</h3>
          <p style={{ margin: "6px auto 18px auto", maxWidth: "420px", fontSize: "13px", color: "var(--muted)" }}>
            {search || statusFilter !== "all" || structureFilter !== "all"
              ? "No offers matched your active search or filters."
              : "No formal purchase offers have been generated yet. Open any property in your pipeline or click below to calculate and issue your first offer."}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setCalcProperty("new")}
            style={{
              backgroundColor: "#2563eb",
              color: "#ffffff",
              fontWeight: 700,
              padding: "9px 18px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
            }}
          >
            ➕ Create Your First Offer
          </button>
        </div>
      ) : viewMode === "grouped" ? (
        /* ========================================================================= */
        /* GROUPED BY PROPERTY (User's Exact Specification)                          */
        /* ========================================================================= */
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {propertyGroups.length > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "10px", padding: "0 4px" }}>
              <button
                type="button"
                onClick={() => {
                  const allOpen: Record<string, boolean> = {};
                  for (const g of propertyGroups) allOpen[g.key] = true;
                  setExpandedProperties(allOpen);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#38bdf8",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Expand all
              </button>
              <span style={{ color: "var(--muted-2)" }}>·</span>
              <button
                type="button"
                onClick={() => setExpandedProperties({})}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Collapse all
              </button>
            </div>
          )}
          {propertyGroups.map((group) => {
            const isExpanded = Boolean(expandedProperties[group.key]);
            return (
              <div
                key={group.key}
                style={{
                  backgroundColor: "var(--card-bg, var(--panel))",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  overflow: "hidden",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                }}
              >
                {/* Property Header Banner */}
                <div
                  style={{
                    backgroundColor: "var(--panel, var(--bg-soft))",
                    padding: "16px 20px",
                    borderBottom: isExpanded ? "1px solid #30363d" : "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "14px",
                    cursor: "pointer",
                  }}
                  onClick={() => togglePropertyExpanded(group.key)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "260px" }}>
                    <span style={{ fontSize: "20px" }}>🏡</span>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--ink)" }}>
                          {group.propertyAddress}
                        </h3>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            backgroundColor: "var(--panel-2)",
                            color: "var(--muted-2)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          Stage: {group.stage}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px" }}>
                        Seller: <strong style={{ color: "var(--ink-dim)" }}>{group.sellerName || "Unknown Owner"}</strong>
                        {group.sellerEmail ? ` · ${group.sellerEmail}` : ""}
                        {group.sellerPhone ? ` · ${group.sellerPhone}` : ""}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                        {group.offers.length} {group.offers.length === 1 ? "Offer Sent" : "Offers Sent"}
                      </div>
                      <div style={{ fontSize: "14px", fontWeight: 800, color: "#38bdf8", marginTop: "2px" }}>
                        Latest: ${Math.max(group.latestOffer.cashOfferAmount || 0, group.latestOffer.subtoPurchasePrice || 0, group.latestOffer.creativePurchasePrice || 0).toLocaleString()}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          const mockClient: Client = {
                            id: group.clientId,
                            companyName: group.propertyAddress,
                            contactName: group.sellerName,
                            email: group.sellerEmail,
                            phone: group.sellerPhone,
                            address: group.propertyAddress,
                            stage: group.stage,
                            dealValue: group.dealValue,
                            customFields: [],
                            services: [],
                            industry: "Real Estate",
                            notes: "",
                            archived: false,
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                          } as unknown as Client;
                          setCalcProperty(mockClient);
                        }}
                        style={{
                          backgroundColor: "var(--panel-2)",
                          border: "1px solid #38bdf8",
                          color: "#38bdf8",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        ➕ New Offer
                      </button>

                      <button
                        type="button"
                        onClick={() => togglePropertyExpanded(group.key)}
                        style={{
                          background: "none",
                          border: "1px solid var(--border)",
                          color: "var(--muted)",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        {isExpanded ? "▲ Hide Offers" : "▼ View Offers"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Associated Offers List for this Property */}
                {isExpanded && (
                  <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Offers Associated with {group.propertyAddress} ({group.offers.length}):
                    </div>

                    {group.offers.map((offer, idx) => {
                      const badge = getStatusBadgeStyle(offer.status);
                      const isSelectedCash = offer.selectedOffers?.includes("cash") || offer.offerType === "cash" || offer.cashOfferAmount > 0;
                      const isSelectedSubto = offer.selectedOffers?.includes("subto") || offer.offerType === "subto" || offer.subtoPurchasePrice > 0;
                      const isSelectedCreative = offer.selectedOffers?.includes("creative") || offer.offerType === "creative" || offer.creativePurchasePrice > 0;

                      return (
                        <div
                          key={offer.id}
                          style={{
                            backgroundColor: "var(--panel, var(--bg-soft))",
                            border: "1px solid var(--border)",
                            borderRadius: "8px",
                            padding: "16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                          }}
                        >
                          {/* Offer Header Bar */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "10px",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                              <span
                                style={{
                                  backgroundColor: "var(--line)",
                                  color: "var(--ink)",
                                  padding: "3px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                }}
                              >
                                Offer #{group.offers.length - idx}
                              </span>
                              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                                📅 Sent: <strong style={{ color: "var(--ink-dim)" }}>{new Date(offer.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
                              </span>
                              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                                🏢 Buyer: <strong style={{ color: "#38bdf8" }}>{offer.businessName || "Revzenta Capital"} and/or assigns</strong>
                              </span>
                            </div>

                            {/* Status Selector */}
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontSize: "11px", color: "var(--muted)" }}>Status:</span>
                              <select
                                value={offer.status || "Sent"}
                                onChange={(e) => handleUpdateStatus(offer.id, e.target.value)}
                                style={{
                                  padding: "4px 10px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  ...badge,
                                }}
                              >
                                <option value="Sent">Sent</option>
                                <option value="Under Review">Under Review</option>
                                <option value="Accepted">Accepted</option>
                                <option value="Countered">Countered</option>
                                <option value="Declined">Declined</option>
                              </select>
                            </div>
                          </div>

                          {/* Terms Structure Matrix Grid */}
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                              gap: "10px",
                              backgroundColor: "var(--card-bg, var(--panel))",
                              padding: "12px",
                              borderRadius: "6px",
                              border: "1px solid var(--border)",
                            }}
                          >
                            {/* Option 1: Cash Offer */}
                            {isSelectedCash && (
                              <div style={{ borderLeft: "3px solid #22c55e", paddingLeft: "10px" }}>
                                <div style={{ fontSize: "11px", color: "#4ade80", fontWeight: 700 }}>
                                  💵 CASH OFFER (MAO)
                                </div>
                                <div style={{ fontSize: "17px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                                  ${(offer.cashOfferAmount || 0).toLocaleString()}
                                </div>
                                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                  {offer.closingDays || 14}-Day Close · 100% As-Is
                                </div>
                              </div>
                            )}

                            {/* Option 2: Subject-To */}
                            {isSelectedSubto && (
                              <div style={{ borderLeft: "3px solid #0284c7", paddingLeft: "10px" }}>
                                <div style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700 }}>
                                  🔄 SUBJECT-TO RELIEF
                                </div>
                                <div style={{ fontSize: "17px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                                  Take over ${(offer.subtoDebt || 0).toLocaleString()} Debt
                                </div>
                                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                  +${(offer.subtoCashToSeller || 0).toLocaleString()} Cash · ${(offer.subtoMonthlyPayment || 0).toLocaleString()}/mo
                                </div>
                              </div>
                            )}

                            {/* Option 3: Seller Financing */}
                            {isSelectedCreative && (
                              <div style={{ borderLeft: "3px solid #9333ea", paddingLeft: "10px" }}>
                                <div style={{ fontSize: "11px", color: "#c084fc", fontWeight: 700 }}>
                                  🔥 SELLER FINANCING
                                </div>
                                <div style={{ fontSize: "17px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                                  ${(offer.creativePurchasePrice || 0).toLocaleString()} Price
                                </div>
                                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                  ${(offer.creativeDownPayment || 0).toLocaleString()} Down · ${(offer.creativeMonthlyPayment || 0).toLocaleString()}/mo ({offer.creativeBalloonYears || 5}-Yr Balloon)
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Offer Action Buttons Bar */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "10px",
                              borderTop: "1px solid var(--border)",
                              paddingTop: "10px",
                            }}
                          >
                            <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                              Ref: <code style={{ color: "#38bdf8" }}>{offer.pdfId ? `LOI-${offer.pdfId.slice(0, 8)}` : "LOI"}</code> · Delivered to: {offer.sellerEmail || group.sellerEmail || "Seller"}
                            </div>

                            <div style={{ display: "flex", gap: "8px" }}>
                              {/* Open PDF LOI */}
                              <a
                                href={offer.pdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  backgroundColor: "#0284c7",
                                  color: "#ffffff",
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  textDecoration: "none",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "5px",
                                }}
                              >
                                📄 View / Download PDF LOI
                              </a>

                              {/* View Details modal */}
                              <button
                                type="button"
                                onClick={() => setViewingOffer(offer)}
                                style={{
                                  backgroundColor: "var(--panel-2)",
                                  border: "1px solid var(--border)",
                                  color: "var(--ink)",
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                ✉️ View Email Content
                              </button>

                              {/* Delete Offer */}
                              <button
                                type="button"
                                onClick={() => handleDeleteOffer(offer.id)}
                                style={{
                                  background: "none",
                                  border: "1px solid var(--border)",
                                  color: "#f87171",
                                  padding: "6px 10px",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  cursor: "pointer",
                                }}
                                title="Delete Offer Record"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ========================================================================= */
        /* FLAT LIST VIEW (Alternative view mode)                                    */
        /* ========================================================================= */
        <div
          style={{
            backgroundColor: "var(--card-bg, var(--panel))",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ backgroundColor: "var(--panel, var(--bg-soft))", borderBottom: "1px solid var(--border)", color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: "12px 16px" }}>Property Address</th>
                <th style={{ padding: "12px 16px" }}>Seller</th>
                <th style={{ padding: "12px 16px" }}>Date Sent</th>
                <th style={{ padding: "12px 16px" }}>Buyer Entity</th>
                <th style={{ padding: "12px 16px" }}>Highest Term</th>
                <th style={{ padding: "12px 16px" }}>Status</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOffers.map((offer) => {
                const maxAmt = Math.max(offer.cashOfferAmount || 0, offer.subtoPurchasePrice || 0, offer.creativePurchasePrice || 0);
                const badge = getStatusBadgeStyle(offer.status);
                return (
                  <tr
                    key={offer.id}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      color: "var(--ink)",
                    }}
                  >
                    <td style={{ padding: "12px 16px", fontWeight: 700 }}>
                      <div style={{ color: "var(--ink)" }}>{offer.propertyAddress}</div>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Ref: {offer.pdfId?.slice(0, 8)}</div>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--ink-dim)" }}>
                      <div>{offer.sellerName || "—"}</div>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>{offer.sellerEmail}</div>
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--muted)" }}>
                      {new Date(offer.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#38bdf8", fontWeight: 600 }}>
                      {offer.businessName || "Revzenta Capital"} and/or assigns
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: 800, color: "#34d399" }}>
                      ${maxAmt.toLocaleString()}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ padding: "3px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 700, ...badge }}>
                        {offer.status || "Sent"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                        <a
                          href={offer.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            backgroundColor: "#0284c7",
                            color: "#ffffff",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            fontWeight: 700,
                            textDecoration: "none",
                          }}
                        >
                          📄 PDF
                        </a>
                        <button
                          type="button"
                          onClick={() => setViewingOffer(offer)}
                          style={{
                            backgroundColor: "var(--panel-2)",
                            border: "1px solid var(--border)",
                            color: "var(--ink)",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "11px",
                            cursor: "pointer",
                          }}
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Offer Email Preview Modal */}
      {viewingOffer && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setViewingOffer(null)}
        >
          <div
            style={{
              backgroundColor: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              width: "100%",
              maxWidth: "700px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid var(--border)",
                backgroundColor: "var(--card-bg, var(--panel))",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "16px", color: "var(--ink)" }}>
                Purchase Offer: {viewingOffer.propertyAddress}
              </h3>
              <button
                type="button"
                onClick={() => setViewingOffer(null)}
                style={{ background: "none", border: "none", color: "var(--muted-2)", fontSize: "18px", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "20px", overflowY: "auto", flex: 1 }}>
              <div style={{ marginBottom: "14px", fontSize: "12px", color: "var(--muted)" }}>
                <div><strong>Recipient:</strong> {viewingOffer.sellerEmail}</div>
                <div><strong>Date:</strong> {new Date(viewingOffer.createdAt).toLocaleString()}</div>
                <div><strong>Buyer Entity:</strong> {viewingOffer.businessName || "Revzenta Capital"} and/or assigns</div>
              </div>

              <div
                style={{
                  backgroundColor: "var(--card-bg, var(--panel))",
                  padding: "14px",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  whiteSpace: "pre-wrap",
                  color: "var(--ink-dim)",
                  lineHeight: "1.6",
                }}
              >
                {viewingOffer.notes || "No message transcript captured."}
              </div>
            </div>

            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border)",
                backgroundColor: "var(--card-bg, var(--panel))",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <a
                href={viewingOffer.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  backgroundColor: "#0284c7",
                  color: "#ffffff",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                📄 Open Official PDF LOI
              </a>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setViewingOffer(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deal Calculator Modal for creating a new offer */}
      {calcProperty !== null && (
        <DealCalculatorModal
          property={calcProperty === "new" ? null : calcProperty}
          crmBusinessName={crmBusinessName}
          onClose={() => setCalcProperty(null)}
          onUpdated={() => {
            setCalcProperty(null);
            loadOffers();
          }}
        />
      )}
    </div>
  );
}
