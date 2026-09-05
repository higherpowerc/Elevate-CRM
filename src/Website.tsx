import { useState } from "react";
import ThemeToggle from "./ThemeToggle";

interface WebsiteProps {
  onSignIn: () => void;
  onLaunchApp: () => void;
}

export default function Website({ onSignIn, onLaunchApp }: WebsiteProps) {
  // ROI Calculator State
  const [leadsPerMonth, setLeadsPerMonth] = useState(60);
  const [avgAssignmentFee, setAvgAssignmentFee] = useState(12500);
  const [conversionRate, setConversionRate] = useState(7); // %

  // Showcase Active Tab
  const [activeTab, setActiveTab] = useState<"pipeline" | "buybox" | "transactions">("pipeline");

  // FAQ Open Set
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Billing Cycle
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");

  // Calculations
  const estimatedDeals = Math.max(1, Math.round((leadsPerMonth * (conversionRate / 100)) * 10) / 10);
  const monthlyRevenue = Math.round(estimatedDeals * avgAssignmentFee);
  const annualRevenue = monthlyRevenue * 12;
  const hoursSaved = Math.round(leadsPerMonth * 0.75);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="rw-page">
      {/* ── Navigation Bar ── */}
      <header className="rw-nav">
        <div className="rw-container rw-nav-inner">
          <div className="rw-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <div className="rw-brand-icon">R</div>
            <span>Revzenta</span>
          </div>

          <ul className="rw-nav-links">
            <li><a href="#features" className="rw-nav-link">Features</a></li>
            <li><a href="#lead-engine" className="rw-nav-link">Lead Engine</a></li>
            <li><a href="#buy-box" className="rw-nav-link">Buy Box Matcher</a></li>
            <li><a href="#transactions" className="rw-nav-link">Transaction Hub</a></li>
            <li><a href="#calculator" className="rw-nav-link">ROI Calculator</a></li>
            <li><a href="#pricing" className="rw-nav-link">Pricing</a></li>
            <li><a href="#faq" className="rw-nav-link">FAQ</a></li>
          </ul>

          <div className="rw-nav-actions">
            <ThemeToggle />
            <button type="button" className="btn btn-ghost" onClick={onSignIn}>
              Sign In
            </button>
            <button type="button" className="btn btn-primary" onClick={onLaunchApp}>
              Launch CRM
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className="rw-hero">
        <div className="rw-container">
          <div className="rw-badge">
            <span className="rw-badge-dot"></span>
            <span>Revzenta CRM 2.0 • The Real Estate Wholesaling Operating System</span>
          </div>

          <h1 className="rw-hero-title">
            Close More Real Estate Deals in <span>Half the Time</span>.
          </h1>

          <p className="rw-hero-sub">
            The modern all-in-one CRM built specifically for real estate wholesalers and acquisitions teams. Ingest leads with webhook automation, enrich property specs & comps instantly, match cash buyers with precision buy boxes, and execute state contracts with built-in e-signatures.
          </p>

          <div className="rw-hero-ctas">
            <button type="button" className="rw-btn-lg rw-btn-primary" onClick={onLaunchApp}>
              ⚡ Get Started Free
            </button>
            <button type="button" className="rw-btn-lg rw-btn-outline" onClick={onSignIn}>
              Sign In to Your Workspace →
            </button>
          </div>

          <div className="rw-trust-bar">
            <div className="rw-trust-item">
              <span>🛡️</span> 100% MLS & Public Records Compliant
            </div>
            <div className="rw-trust-item">
              <span>⚡</span> PropStream, BatchLeads & Zapier Ingestion
            </div>
            <div className="rw-trust-item">
              <span>✍️</span> State PSA & Assignment Contracts
            </div>
            <div className="rw-trust-item">
              <span>⏱️</span> Inspection & Title Escrow Clocks
            </div>
          </div>

          {/* ── Interactive App Showcase Mockup ── */}
          <div className="rw-mockup">
            <div className="rw-mockup-header">
              <span className="rw-mockup-dot"></span>
              <span className="rw-mockup-dot"></span>
              <span className="rw-mockup-dot"></span>
              <span className="rw-mockup-tab-title">Revzenta CRM — Real Estate Wholesaling Cockpit</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className={activeTab === "pipeline" ? "seg-btn active" : "seg-btn"}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                  onClick={() => setActiveTab("pipeline")}
                >
                  Deals Pipeline
                </button>
                <button
                  type="button"
                  className={activeTab === "buybox" ? "seg-btn active" : "seg-btn"}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                  onClick={() => setActiveTab("buybox")}
                >
                  Buy Box Matcher
                </button>
                <button
                  type="button"
                  className={activeTab === "transactions" ? "seg-btn active" : "seg-btn"}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                  onClick={() => setActiveTab("transactions")}
                >
                  Transaction Hub
                </button>
              </div>
            </div>

            <div className="rw-mockup-body">
              {activeTab === "pipeline" && (
                <>
                  <div className="rw-mockup-card">
                    <div className="rw-mockup-card-title">
                      <span>Incoming Leads (Inbound Webhooks)</span>
                      <span style={{ color: "var(--primary)" }}>3 New</span>
                    </div>
                    <div className="rw-mockup-deal">
                      <div>
                        <strong>742 Evergreen Terrace</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          4b/2.5ba • 2,150 sqft • AVM: $385,000
                        </div>
                      </div>
                      <span className="badge" style={{ background: "rgba(214,255,63,0.15)", color: "var(--primary)" }}>
                        $265k Asking
                      </span>
                    </div>
                    <div className="rw-mockup-deal">
                      <div>
                        <strong>1044 N 24th St</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          3b/2ba • 1,650 sqft • AVM: $345,000
                        </div>
                      </div>
                      <span className="badge" style={{ background: "rgba(214,255,63,0.15)", color: "var(--primary)" }}>
                        $230k Asking
                      </span>
                    </div>
                    <div className="rw-mockup-deal">
                      <div>
                        <strong>3822 Oakridge Lane</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          3b/2ba • 1,820 sqft • AVM: $410,000
                        </div>
                      </div>
                      <span className="badge" style={{ background: "rgba(214,255,63,0.15)", color: "var(--primary)" }}>
                        $290k Asking
                      </span>
                    </div>
                  </div>

                  <div className="rw-mockup-card">
                    <div className="rw-mockup-card-title">
                      <span>Under Contract (Title & Escrow)</span>
                      <span style={{ color: "#10b981" }}>$32,000 Projected</span>
                    </div>
                    <div className="rw-mockup-deal" style={{ borderLeft: "3px solid #10b981" }}>
                      <div>
                        <strong>4910 E Desert View Dr</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          Assignee: Apex Holdings LLC • Title: First American
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ color: "#10b981", fontWeight: 700 }}>+$15,000 Fee</span>
                        <div style={{ fontSize: "10px", color: "#f59e0b" }}>Closes in 6 days</div>
                      </div>
                    </div>
                    <div className="rw-mockup-deal" style={{ borderLeft: "3px solid #10b981" }}>
                      <div>
                        <strong>1804 W Campbell Ave</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          Assignee: Sunbelt Flips • Title: Stewart Title
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ color: "#10b981", fontWeight: 700 }}>+$17,000 Fee</span>
                        <div style={{ fontSize: "10px", color: "#10b981" }}>Clear to Close</div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "buybox" && (
                <>
                  <div className="rw-mockup-card">
                    <div className="rw-mockup-card-title">
                      <span>Property Match: 742 Evergreen Terrace</span>
                      <span style={{ color: "var(--primary)" }}>Single Family • $265k</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "12px" }}>
                      Revzenta scanned 48 registered cash buyers and scored them against market ZIP, price ceiling & buy box criteria.
                    </div>
                    <div className="rw-mockup-deal" style={{ borderLeft: "3px solid var(--primary)" }}>
                      <div>
                        <strong>Apex Real Estate Capital</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          Criteria: Fix & Flip, Phoenix Metro up to $350k
                        </div>
                      </div>
                      <span className="badge" style={{ background: "rgba(214,255,63,0.2)", color: "var(--primary)", fontWeight: 700 }}>
                        98% Match
                      </span>
                    </div>
                    <div className="rw-mockup-deal" style={{ borderLeft: "3px solid #38bdf8" }}>
                      <div>
                        <strong>Desert Horizon Buy & Hold Fund</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          Criteria: Cash Flow Multi-Family / Single Family &gt; 8% Cap
                        </div>
                      </div>
                      <span className="badge" style={{ background: "rgba(56,189,248,0.2)", color: "#38bdf8", fontWeight: 700 }}>
                        91% Match
                      </span>
                    </div>
                  </div>

                  <div className="rw-mockup-card">
                    <div className="rw-mockup-card-title">
                      <span>Instant Dispo Dispatch</span>
                      <span>One-Click</span>
                    </div>
                    <p style={{ fontSize: "13px", color: "var(--text-dim)", margin: "0 0 16px" }}>
                      Send an individualized deal packet with comps, photos, and assignment terms directly to the matched buyers via email or SMS.
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                        📤 Send Deal Packet
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm">
                        Preview Terms
                      </button>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "transactions" && (
                <>
                  <div className="rw-mockup-card">
                    <div className="rw-mockup-card-title">
                      <span>Inspection & EMD Countdown Clocks</span>
                      <span style={{ color: "#ef4444" }}>⏱️ Active Clocks</span>
                    </div>
                    <div className="rw-mockup-deal" style={{ borderLeft: "3px solid #f59e0b" }}>
                      <div>
                        <strong>742 Evergreen Terrace (PSA)</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          EMD Deposit: $2,500 due in 24 hours
                        </div>
                      </div>
                      <span style={{ color: "#f59e0b", fontWeight: 700, fontSize: "13px" }}>
                        1d 04h Left
                      </span>
                    </div>
                    <div className="rw-mockup-deal" style={{ borderLeft: "3px solid #10b981" }}>
                      <div>
                        <strong>1044 N 24th St (Assignment)</strong>
                        <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                          Inspection period: 7 of 10 days remaining
                        </div>
                      </div>
                      <span style={{ color: "#10b981", fontWeight: 700, fontSize: "13px" }}>
                        3d 12h Left
                      </span>
                    </div>
                  </div>

                  <div className="rw-mockup-card">
                    <div className="rw-mockup-card-title">
                      <span>Title Company Portal</span>
                      <span style={{ color: "#10b981" }}>Live Sync</span>
                    </div>
                    <p style={{ fontSize: "13px", color: "var(--text-dim)", margin: "0 0 14px" }}>
                      Escrow officers access contracts, earnest money receipts, and payoff demands in one secure shared link without endless email threads.
                    </p>
                    <div style={{ padding: "8px 12px", background: "var(--surface)", borderRadius: "6px", fontSize: "12px" }}>
                      <span style={{ color: "var(--text-dim)" }}>Title Milestone: </span>
                      <strong style={{ color: "#10b981" }}>Clear to Close (CTC) ✓</strong>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Section ── */}
      <section id="features" className="rw-section">
        <div className="rw-container">
          <div className="rw-section-head">
            <span className="rw-section-tag">Engineered for Wholesale Acquisitions</span>
            <h2 className="rw-section-title">Everything You Need to Scale Deal Volume</h2>
            <p className="rw-section-sub">
              Stop stitching together generic CRMs with fragile Zapier zaps. Revzenta provides a unified operating system purpose-built for real estate dealmakers.
            </p>
          </div>

          <div className="rw-grid-3">
            <div id="lead-engine" className="rw-feature-card">
              <div className="rw-feature-icon">⚡</div>
              <h3>Automated Inbound Lead Ingestion</h3>
              <p>
                Connect PropStream, BatchLeads, Zapier, Make, and webforms via your private webhook URL. Incoming properties are automatically normalized and queued into your pipeline.
              </p>
            </div>

            <div className="rw-feature-card">
              <div className="rw-feature-icon">🏡</div>
              <h3>1-Click Property Specs & AVM Comps</h3>
              <p>
                Auto-enrich beds, baths, square footage, year built, market valuation (AVM), and nearby comparable sales directly from RentCast and county appraisal databases.
              </p>
            </div>

            <div id="buy-box" className="rw-feature-card">
              <div className="rw-feature-icon">🎯</div>
              <h3>Precision Cash Buyer Buy Box Matcher</h3>
              <p>
                Tag your end-buyers with target ZIP codes, investment strategies (Fix & Flip, Buy & Hold, Novation), and max price ceilings. Revzenta scores and matches every deal instantly.
              </p>
            </div>

            <div id="transactions" className="rw-feature-card">
              <div className="rw-feature-icon">📝</div>
              <h3>Document & Transaction Hub</h3>
              <p>
                Auto-generate state-specific Purchase & Sale (PSA) agreements and Assignment contracts. Clients and cash buyers sign digitally with native legally-binding e-signatures.
              </p>
            </div>

            <div className="rw-feature-card">
              <div className="rw-feature-icon">⏱️</div>
              <h3>Contingency & Inspection Clocks</h3>
              <p>
                Visual countdown timers track days and hours remaining before earnest money goes hard or inspection contingency expires, eliminating costly missed deadlines.
              </p>
            </div>

            <div className="rw-feature-card">
              <div className="rw-feature-icon">🏢</div>
              <h3>Title Company Collaboration Portal</h3>
              <p>
                Share auto-generated escrow links with title and escrow officers containing signed contracts, earnest receipts, and payoff demands in one organized repository.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Interactive ROI & Revenue Calculator ── */}
      <section id="calculator" className="rw-section" style={{ background: "var(--surface-sunken, rgba(255,255,255,0.01))" }}>
        <div className="rw-container">
          <div className="rw-section-head">
            <span className="rw-section-tag">Interactive Calculator</span>
            <h2 className="rw-section-title">Calculate Your Wholesaling Revenue Potential</h2>
            <p className="rw-section-sub">
              See how automating lead ingestion, property comps, and buyer matching accelerates your pipeline revenue.
            </p>
          </div>

          <div className="rw-calc-box">
            <div>
              <div className="rw-calc-slider-group">
                <div className="rw-calc-label">
                  <span>Monthly Off-Market Leads Ingested:</span>
                  <strong style={{ color: "var(--primary)" }}>{leadsPerMonth} leads</strong>
                </div>
                <input
                  type="range"
                  min={10}
                  max={300}
                  step={5}
                  value={leadsPerMonth}
                  onChange={(e) => setLeadsPerMonth(Number(e.target.value))}
                  className="rw-calc-slider"
                />
              </div>

              <div className="rw-calc-slider-group">
                <div className="rw-calc-label">
                  <span>Average Assignment Fee:</span>
                  <strong style={{ color: "var(--primary)" }}>${avgAssignmentFee.toLocaleString()}</strong>
                </div>
                <input
                  type="range"
                  min={5000}
                  max={35000}
                  step={1000}
                  value={avgAssignmentFee}
                  onChange={(e) => setAvgAssignmentFee(Number(e.target.value))}
                  className="rw-calc-slider"
                />
              </div>

              <div className="rw-calc-slider-group">
                <div className="rw-calc-label">
                  <span>Lead-to-Contract Conversion Rate:</span>
                  <strong style={{ color: "var(--primary)" }}>{conversionRate}%</strong>
                </div>
                <input
                  type="range"
                  min={2}
                  max={15}
                  step={1}
                  value={conversionRate}
                  onChange={(e) => setConversionRate(Number(e.target.value))}
                  className="rw-calc-slider"
                />
              </div>
            </div>

            <div className="rw-calc-results">
              <div className="rw-calc-metric">
                <span style={{ fontSize: "14px", color: "var(--text-dim)" }}>Est. Deals Closed:</span>
                <strong style={{ fontSize: "20px" }}>{estimatedDeals} / month</strong>
              </div>

              <div className="rw-calc-metric">
                <span style={{ fontSize: "14px", color: "var(--text-dim)" }}>Monthly Gross Revenue:</span>
                <div className="rw-calc-metric-val">${monthlyRevenue.toLocaleString()}</div>
              </div>

              <div className="rw-calc-metric">
                <span style={{ fontSize: "14px", color: "var(--text-dim)" }}>Annual Projected Volume:</span>
                <strong style={{ fontSize: "22px", color: "var(--text)" }}>${annualRevenue.toLocaleString()}</strong>
              </div>

              <div className="rw-calc-metric" style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>Hours Saved with Revzenta:</span>
                <strong style={{ color: "#10b981", fontSize: "16px" }}>~{hoursSaved} hrs/mo</strong>
              </div>

              <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: "8px" }} onClick={onLaunchApp}>
                Scale This Pipeline Now →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing Section ── */}
      <section id="pricing" className="rw-section">
        <div className="rw-container">
          <div className="rw-section-head">
            <span className="rw-section-tag">Transparent Pricing</span>
            <h2 className="rw-section-title">Plans Built to Grow with Your Deal Flow</h2>
            <p className="rw-section-sub">
              No long-term contracts. Cancel anytime. Start free and upgrade when your deal pipeline expands.
            </p>

            <div style={{ display: "inline-flex", background: "var(--surface-sunken)", padding: "4px", borderRadius: "8px", border: "1px solid var(--border)", marginTop: "20px" }}>
              <button
                type="button"
                className={billingCycle === "monthly" ? "seg-btn active" : "seg-btn"}
                style={{ fontSize: "13px", padding: "6px 16px" }}
                onClick={() => setBillingCycle("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                className={billingCycle === "annual" ? "seg-btn active" : "seg-btn"}
                style={{ fontSize: "13px", padding: "6px 16px" }}
                onClick={() => setBillingCycle("annual")}
              >
                Annual (Save 20%)
              </button>
            </div>
          </div>

          <div className="rw-pricing-grid">
            {/* Tier 1: Starter */}
            <div className="rw-price-card">
              <h3 className="rw-price-title">Starter Wholesaler</h3>
              <p className="rw-price-desc">Ideal for solo dealmakers launching their wholesale business.</p>
              <div className="rw-price-amount">
                ${billingCycle === "annual" ? "63" : "79"}
                <span>/ month</span>
              </div>
              <ul className="rw-price-features">
                <li><span>✓</span> Unlimited pipeline leads & contacts</li>
                <li><span>✓</span> Inbound Webhook lead ingestion</li>
                <li><span>✓</span> PropStream & BatchLeads webhook URL</li>
                <li><span>✓</span> Cash buyers directory & criteria tagging</li>
                <li><span>✓</span> Daily task management & reminders</li>
                <li><span>✓</span> Dark / Light mode UI</li>
              </ul>
              <button type="button" className="btn btn-outline" style={{ width: "100%" }} onClick={onLaunchApp}>
                Get Started
              </button>
            </div>

            {/* Tier 2: Pro (Popular) */}
            <div className="rw-price-card rw-price-popular">
              <div className="rw-popular-badge">Most Popular</div>
              <h3 className="rw-price-title">Pro Dealmaker</h3>
              <p className="rw-price-desc">For active wholesalers closing multiple contracts every month.</p>
              <div className="rw-price-amount">
                ${billingCycle === "annual" ? "159" : "199"}
                <span>/ month</span>
              </div>
              <ul className="rw-price-features">
                <li><span>✓</span> <strong>Everything in Starter</strong></li>
                <li><span>✓</span> 1-Click RentCast property specs & AVM</li>
                <li><span>✓</span> Automated Buy Box Matcher scoring</li>
                <li><span>✓</span> Document & Transaction Hub</li>
                <li><span>✓</span> Digital e-signatures for PSA & Assignment</li>
                <li><span>✓</span> Inspection & EMD countdown clocks</li>
                <li><span>✓</span> Shared Title Company Escrow Portal</li>
              </ul>
              <button type="button" className="btn btn-primary" style={{ width: "100%" }} onClick={onLaunchApp}>
                Start Pro Trial
              </button>
            </div>

            {/* Tier 3: Scale */}
            <div className="rw-price-card">
              <h3 className="rw-price-title">Scale & Brokerage</h3>
              <p className="rw-price-desc">For acquisitions teams, dispo reps, and high-volume brokerages.</p>
              <div className="rw-price-amount">
                ${billingCycle === "annual" ? "319" : "399"}
                <span>/ month</span>
              </div>
              <ul className="rw-price-features">
                <li><span>✓</span> <strong>Everything in Pro</strong></li>
                <li><span>✓</span> Multi-seat team accounts & permissions</li>
                <li><span>✓</span> Role-based tab controls (Acquisitions vs Dispo)</li>
                <li><span>✓</span> Custom state contract templates & riders</li>
                <li><span>✓</span> Priority API rate limits</li>
                <li><span>✓</span> Dedicated onboarding specialist</li>
                <li><span>✓</span> 24/7 Priority support</li>
              </ul>
              <button type="button" className="btn btn-outline" style={{ width: "100%" }} onClick={onLaunchApp}>
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Frequently Asked Questions ── */}
      <section id="faq" className="rw-section" style={{ background: "var(--surface-sunken, rgba(255,255,255,0.01))" }}>
        <div className="rw-container">
          <div className="rw-section-head">
            <span className="rw-section-tag">Got Questions?</span>
            <h2 className="rw-section-title">Frequently Asked Questions</h2>
            <p className="rw-section-sub">
              Everything you need to know about Revzenta CRM and our wholesaling feature suite.
            </p>
          </div>

          <div className="rw-faq-list">
            {[
              {
                q: "How does Revzenta pull property data and MLS specs legally?",
                a: "Revzenta integrates with official property data providers (RentCast API and public county tax assessor records) using licensed real estate APIs. Unlike scrapers that violate MLS terms of service, Revzenta uses compliant developer feeds to provide beds, baths, sqft, year built, estimated market valuations (AVM), and recent comparable sales.",
              },
              {
                q: "Can I connect PropStream, BatchLeads, and Zapier to Revzenta?",
                a: "Yes! Revzenta gives you a dedicated Inbound Webhook URL in your Settings. Any service that supports webhooks (PropStream, BatchLeads, Zapier, Make, Lead Sherpa, or your own website intake forms) can post leads straight into Revzenta with instant auto-enrichment.",
              },
              {
                q: "How does the Document & Transaction Hub handle contracts and e-signatures?",
                a: "Revzenta generates clean, state-compliant Purchase & Sale Agreements (PSA) and Assignment contracts populated directly from your deal records. Sellers and buyers receive a unique, unguessable sign link to review and sign digitally with audit timestamps and IP verification.",
              },
              {
                q: "What are the Inspection Clocks and Title Portal?",
                a: "Wholesale contracts live or die by inspection contingency deadlines and earnest money deposit (EMD) timeframes. Revzenta provides real-time visual countdown timers showing exactly how many days and hours remain. When in escrow, you can share a private Title Portal link with your escrow officer containing all executed contracts, earnest receipts, and payoff demands in one place.",
              },
              {
                q: "Can I customize the pipeline stages for my business?",
                a: "Absolutely. Revzenta comes pre-configured for Real Estate Wholesaling (Leads → Under Contract → Title Escrow → Closed), but you can add, rename, reorder, and color-code pipeline stages in your Settings anytime.",
              },
            ].map((item, index) => (
              <div key={index} className="rw-faq-item" onClick={() => toggleFaq(index)}>
                <div className="rw-faq-q">
                  <span>{item.q}</span>
                  <span style={{ fontSize: "18px", color: "var(--primary)" }}>
                    {openFaq === index ? "−" : "+"}
                  </span>
                </div>
                {openFaq === index && (
                  <div className="rw-faq-a">
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final Call to Action ── */}
      <section className="rw-section" style={{ textAlign: "center", position: "relative" }}>
        <div className="rw-container">
          <div style={{
            background: "linear-gradient(135deg, rgba(214,255,63,0.12) 0%, rgba(163,230,53,0.05) 100%)",
            border: "1px solid var(--border)",
            borderRadius: "20px",
            padding: "60px 30px",
          }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, margin: "0 0 16px" }}>
              Ready to Accelerate Your Wholesale Acquisitions?
            </h2>
            <p style={{ fontSize: "17px", color: "var(--text-dim)", maxWidth: "600px", margin: "0 auto 32px" }}>
              Join forward-thinking real estate wholesalers closing deals with speed, precision, and modern software.
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" className="rw-btn-lg rw-btn-primary" onClick={onLaunchApp}>
                ⚡ Launch Revzenta CRM Now
              </button>
              <button type="button" className="rw-btn-lg rw-btn-outline" onClick={onSignIn}>
                Sign In to Workspace
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="rw-footer">
        <div className="rw-container">
          <div className="rw-footer-grid">
            <div className="rw-footer-col">
              <div className="rw-brand" style={{ marginBottom: "14px" }}>
                <div className="rw-brand-icon">R</div>
                <span>Revzenta</span>
              </div>
              <p style={{ fontSize: "13px", color: "var(--text-dim)", maxWidth: "300px" }}>
                The modern CRM and operating system for real estate wholesalers, acquisitions teams, and growing businesses.
              </p>
            </div>

            <div className="rw-footer-col">
              <h4>Product</h4>
              <ul className="rw-footer-links">
                <li><a href="#features">Features</a></li>
                <li><a href="#lead-engine">Lead Engine</a></li>
                <li><a href="#buy-box">Buy Box Matcher</a></li>
                <li><a href="#transactions">Transaction Hub</a></li>
                <li><a href="#calculator">ROI Calculator</a></li>
              </ul>
            </div>

            <div className="rw-footer-col">
              <h4>Solutions</h4>
              <ul className="rw-footer-links">
                <li><a href="#pricing">Pricing Plans</a></li>
                <li><a href="#faq">Legal MLS FAQ</a></li>
                <li><a href="#lead-engine">PropStream Setup</a></li>
                <li><a href="#lead-engine">BatchLeads Webhook</a></li>
              </ul>
            </div>

            <div className="rw-footer-col">
              <h4>Workspace</h4>
              <ul className="rw-footer-links">
                <li><a href="#" onClick={(e) => { e.preventDefault(); onSignIn(); }}>Sign In</a></li>
                <li><a href="#" onClick={(e) => { e.preventDefault(); onLaunchApp(); }}>Launch CRM</a></li>
                <li><a href="mailto:support@revzenta.com">Contact Support</a></li>
              </ul>
            </div>
          </div>

          <div className="rw-footer-bottom">
            <div>© {new Date().getFullYear()} Revzenta CRM. All rights reserved.</div>
            <div style={{ display: "flex", gap: "20px" }}>
              <span>Privacy Policy</span>
              <span>Terms of Service</span>
              <span>Security</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
