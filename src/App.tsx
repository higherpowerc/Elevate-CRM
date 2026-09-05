import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Login from "./Login";
import ResetPassword from "./ResetPassword";
import Dashboard from "./Dashboard";
import Clients, { type Filter } from "./Clients";
import ClientsDirectory from "./ClientsDirectory";
import Calendar from "./Calendar";
import Appointments from "./Appointments";
import Tasks from "./Tasks";
import Buyers from "./Buyers";
import Finance from "./Finance";
import Admin from "./Admin";
import Documents from "./Documents";
import Tickets from "./Tickets";
import Settings from "./Settings";
import Offers from "./Offers";
import BuyBoxMatcher from "./BuyBoxMatcher";
import TransactionHub from "./TransactionHub";
import Website from "./Website";
import { api } from "./api";
import { DEFAULT_STAGES, TENANT_TABS, type TenantTab, type User } from "./types";
import { initials } from "./bits";
import { PiiContext, PII_HIDDEN_KEY, blurPii, PiiEyeIcon, PiiEyeOffIcon } from "./pii";
import ThemeToggle from "./ThemeToggle";

/* Owner request 2026-08-14 — the single "Clients" tab splits into TWO:
 *   "leads"  → the pipeline view (stage chips, Active/Archived/All, stage
 *              actions, Manage stages) — today's Clients tab, reframed.
 *   "clients" → the independent directory of ALL clients (any stage, incl.
 *              archived), flat and alphabetically sorted.
 * Owner request 2026-08-15 — tab labels are unified across EVERY workspace:
 * the pipeline tab always reads "Leads" and the directory tab always reads
 * "Clients", for the owner and each client account alike (the member-org
 * "Clients"/"All clients" variant labels are gone).
 * Owner request 2026-08-15 — the OWNER workspace gains an "Onboarding" tab:
 * the owner's pipeline is a three-bucket split — Leads = the FIRST stage
 * (prospects), Onboarding = the MIDDLE stages (intake leads), Clients = the
 * terminal stage (sold). Client accounts (role=member) are unchanged: their
 * Leads tab keeps showing every stage except their terminal one. */
type View = "dashboard" | "leads" | "offers" | "buybox" | "onboarding" | "clients" | "calendar" | "appointments" | "tasks" | "finance" | "admin" | "documents" | "tickets" | "settings" | "buyers";


/** 3k — the emailed reset link is `<appUrl>/#/reset?token=...`; pull the
 *  token out of the hash on boot so the login screen can render the
 *  reset-password form in place of the sign-in card. */
function resetTokenFromHash(): string | null {
  const h = window.location.hash;
  if (!h.startsWith("#/reset")) return null;
  const q = h.includes("?") ? h.slice(h.indexOf("?")) : "";
  const token = new URLSearchParams(q).get("token");
  return token && token.trim() ? token.trim() : null;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  /** Owner request 2026-08-14 — deep-linked stage filter for the Leads view.
   *  The Dashboard's stage-card "View →" stores the stage name here and
   *  switches to the leads view; the nav "Leads" tab clears it so a normal
   *  tab visit opens the pipeline on "All". */
  const [leadsStage, setLeadsStage] = useState<string | null>(null);
  /** Owner request 2026-08-15 — same deep-link for the OWNER's Onboarding
   *  view (the middle pipeline stages). Kept separate from leadsStage so the
   *  two pipeline tabs never inherit each other's filter. */
  const [onboardingStage, setOnboardingStage] = useState<string | null>(null);
  /** Owner direction 2026-08-26 — deep-linked FILTER for the Leads view. The
   *  Dashboard's "Lost" card "View →" sets this to "lost" and switches to the
   *  Leads view, which opens on the Lost listing. A plain Leads-nav visit (and
   *  any stage deep-link) resets it to "active" so a normal tab visit opens
   *  the pipeline on Active. */
  const [leadsFilter, setLeadsFilter] = useState<Filter>("active");
  /** 3k — a reset token from the URL hash (`#/reset?token=…`), shown while
   *  the user is signed out. */
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState<boolean>(() => window.location.hash.startsWith("#/login"));
  const [viewingWebsite, setViewingWebsite] = useState<boolean>(() => window.location.hash.startsWith("#/website"));

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#/login")) {
        setShowLogin(true);
        setViewingWebsite(false);
      } else if (window.location.hash.startsWith("#/website")) {
        setShowLogin(false);
        setViewingWebsite(true);
      } else {
        setViewingWebsite(false);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  /* Phase 3d — owner impersonation. True while the owner's session is swapped
     into a client tenant's workspace; drives the banner in the shell. */
  const [impersonating, setImpersonating] = useState(false);
  const [returning, setReturning] = useState(false);

  /* Global privacy eye (owner request 2026-08-14): one toggle in the top nav,
     visible on EVERY screen of EVERY workspace, that blurs all PII (client/
     company names, phone, email, address). Default off; the choice persists
     per browser via localStorage (same pattern as the Dashboard money eye —
     that one stays Dashboard-only and untouched). */
  const [piiHidden, setPiiHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PII_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PII_HIDDEN_KEY, piiHidden ? "1" : "0");
    } catch {
      /* storage unavailable (private mode) — the toggle just won't persist */
    }
  }, [piiHidden]);
  const piiTitle = piiHidden ? "Show client details" : "Hide client details";

  useEffect(() => {
    /* Owner bug 2026-08-27 (§67): a 401 from any API call (including the boot
     * /api/auth/me when signed out) signs the shell back out, but it must NOT
     * sabotage a password reset. The old handler wiped `resetToken`
     * unconditionally — a signed-out visitor opening the emailed
     * `#/reset?token=…` link lost the token to this handler the moment the
     * boot me() 401'd, and got the login card instead of the reset form. Now:
     * a token still live in the URL hash survives (the emailed link IS the
     * credential), and a dying session also leaves a #/reset hash alone. */
    const onUnauthorized = () => {
      setUser((u) => {
        if (u && !window.location.hash.startsWith("#/reset")) window.location.hash = "";
        return null;
      });
      setImpersonating(false);
      if (!resetTokenFromHash()) setResetToken(null);
    };
    window.addEventListener("crm:unauthorized", onUnauthorized);
    api
      .me()
      .then((res) => {
        setUser(res.user);
        setImpersonating(res.impersonating === true);
      })
      .catch(() => setUser(null))
      .finally(() => setBooted(true));
    setResetToken(resetTokenFromHash());
    return () => window.removeEventListener("crm:unauthorized", onUnauthorized);
  }, []);

  // Per-tenant branding (Phase 3a): once signed in, the shell (and the
  // document title) carries the tenant's own org name + accent color.
  const orgName = user?.orgName?.trim() || "";
  /** Owner live-test 2026-08-28 (128c3ad7): the nav shows a NAME, not the raw
   *  email — "Owner" for the owner session; a display name when the account
   *  carries one (additive User.name); the email only as the tenant-user
   *  fallback. The email stays on the nav-user span's title (hover) and PII
   *  blur is unchanged. */
  const navUserName = user?.name?.trim() || (user?.isOwner ? "Owner" : user?.email ?? "");
  useEffect(() => {
    document.title = orgName ? `${orgName} — CRM` : "Revzenta — CRM";
  }, [orgName]);

  /* Branding (accent color): drives --accent on the app root.
     Dashboard KPI colors are driven by the theme (Light/Dark mode) to ensure
     complete legibility and contrast across all pages without manual adjustment. */
  const brandStyle = useMemo<CSSProperties | undefined>(
    () =>
      user?.accentColor
        ? ({
            "--accent": user.accentColor,
          } as CSSProperties)
        : undefined,
    [user?.accentColor],
  );

  const stages = useMemo(() => user?.stages ?? DEFAULT_STAGES, [user?.stages]);

  /* Owner-org detection for terminology (owner direction 2026-08-14): the
     owner workspace is the org whose members hold the admin role — exactly
     the org where the Admin tab appears. It calls its pipeline records
     "leads"; tenant orgs (role=member) keep "clients" for their customers.
     Branding rename (2026-08-18): the server reports owner status as
     user.isOwner (its isOwnerSession — owner org AND role='admin'), so this
     no longer depends on the org NAME string. Tenant team members with
     stored role='admin' stay in their client account's workspace and never
     inherit the owner cockpit (server sends isOwner:false for them). Also
     gates the owner-only Onboarding tab (owner direction 2026-08-15). */
  const isOwnerOrg = !impersonating && user?.isOwner === true;

  /** Business Type Preview mode (owner only) — allows the owner to view and explore
   *  each business type CRM (B2B, B2C, Wholesale Real Estate) directly from the side menu. */
  const [previewVertical, setPreviewVertical] = useState<string | null>(null);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  /** Whether the owner is in their cockpit vs previewing a business type CRM */
  const isOwnerCockpit = isOwnerOrg && !previewVertical;

  /* Wholesale Biz custom menu (owner direction 2026-09-04) — the account's
     business type (orgs.vertical_key, delivered on the session user as
     verticalKey) switches the client workspace to the wholesale tab set.
     Synchronously derived so owner impersonation switches immediately. */
  const verticalKey = previewVertical || (user?.verticalKey ?? "");
  const isWholesale = Boolean(
    previewVertical === "wholesalebiz" || (
      !isOwnerOrg && (
        verticalKey === "wholesalebiz" ||
        verticalKey === "wholesale" ||
        verticalKey.toLowerCase().includes("wholesale") ||
        (user?.orgName && user.orgName.toLowerCase().includes("wholesale")) ||
        (orgName && orgName.toLowerCase().includes("wholesale"))
      )
    )
  );

  /* Team users per client account (owner request 2026-08-14) — tab gating.
     Restricted members carry per-tab grants on user.permissions; org admins
     (stored role='admin' OR the account's original owner login — the server
     reports this as user.isOrgAdmin) bypass everything, and the OWNER is
     never permission-restricted. The server enforces all of this on every
     route; these helpers only drive the nav and the edit affordances (UX). */
  const canSeeTab = (tab: TenantTab): boolean => {
    if (isOwnerOrg) return true;
    if (user?.isOrgAdmin === true) return true;
    return user?.permissions?.[tab] !== undefined;
  };
  const canEditTab = (tab: TenantTab): boolean => {
    if (isOwnerOrg) return true;
    if (user?.isOrgAdmin === true) return true;
    return user?.permissions?.[tab]?.edit === true;
  };
  /* If the current view is a tab the session user can no longer access
     (e.g. an admin revoked it mid-session), fall back to the Dashboard
     instead of rendering a view whose API calls would 403. */
  const viewAllowed = (v: View): boolean => {
    switch (v) {
      case "dashboard":
        return true;
      case "leads":
      case "offers":
      case "buybox":
      case "clients":
        return canSeeTab("clients");
      case "calendar":
        return isOwnerCockpit;
      case "appointments":
        /* Appointments production (backlog 5a104eae): visible to every
           session user — the owner sees all orgs' appointments, each client
           account sees only its own org's (server-enforced on /api/org/
           appointments). No per-tab permission exists for it. */
        return true;
      case "tasks":
        return canSeeTab("tasks");
      case "finance":
        return canSeeTab("finance");
      case "tickets":
        return canSeeTab("support");
      case "settings":
        return canSeeTab("settings");
      case "onboarding":
      case "admin":
        return isOwnerCockpit;
      case "documents":
        /* Wholesale Biz custom menu (owner 2026-09-04) — the wholesale org's
           "Agreements" tab reuses the Documents VIEW, tenant-side (a relabel
           only; the same envelope list). For every other workspace it stays
           owner-only. */
        return isOwnerCockpit || isWholesale;
      case "buyers":
        return isWholesale;
      case "offers":
      case "buybox":
        return isWholesale && canSeeTab("clients");
    }
  };
  const effectiveView: View = viewAllowed(view) ? view : "dashboard";
  /* Wholesale Biz custom menu (owner 2026-09-04): if the signed-in account's
     vertical changed while a wholesale-hidden view was open (or a stale
     wholesale-only view is somehow active), fall back to the Dashboard. */
  const viewWholesaleAllowed = (v: View): boolean => {
    if (!isWholesale) {
      return v !== "buyers" && (isOwnerCockpit ? true : v !== "documents") && v !== "offers" && v !== "buybox";
    }
    return !(v === "appointments" || v === "finance");
  };
  const effectiveViewFinal: View = viewWholesaleAllowed(effectiveView) ? effectiveView : "dashboard";

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* session already gone is fine */
    }
    setUser(null);
    setImpersonating(false);
    setView("dashboard");
    setResetToken(null);
    setLeadsStage(null);
    setOnboardingStage(null);
    setLeadsFilter("active");
  }, []);

  /* Phase 3d — "View account" from the owner's Clients tab (Accounts panel):
     the server swaps this session into the tenant's member user. Land on that
     tenant's dashboard — their nav, data, branding and role rules now apply as
     if the owner had logged in as them. */
  const handleImpersonate = useCallback(async (orgId: number) => {
    const res = await api.adminImpersonate(orgId);
    setUser(res.user);
    setImpersonating(true);
    setView("dashboard");
  }, []);

  /* Phase 3d — banner "Return to my dashboard": swap back to the owner's own
     session and land on the Admin view where they started. */
  const handleImpersonateReturn = useCallback(async () => {
    setReturning(true);
    try {
      const res = await api.impersonateReturn();
      setUser(res.user);
      setImpersonating(false);
      setView("admin");
    } catch {
      // Session round-trip failed — reload so /api/auth/me reports the truth.
      window.location.reload();
    } finally {
      setReturning(false);
    }
  }, []);

  /* Owner request 2026-08-14/15 — open the pipeline tab that owns a stage,
     optionally pre-filtered to it. Called by the Dashboard's stage-card
     "View →" (with the stage name) and its empty-state CTA (no stage →
     Leads "All"). Routing is POSITIONAL over the org's ordered stages
     (rename-safe, never hardcoded names):
       stages[0]            → Leads tab, pre-filtered to that stage
       a MIDDLE stage       → OWNER: Onboarding tab, pre-filtered; tenant:
                              their single Leads tab, pre-filtered
       the TERMINAL stage   → Clients tab (sold customers live in the
                              directory — the pipeline has no chip for them)
     The nav tabs call setView directly and clear both stage filters so a
     plain tab visit never inherits a stale deep-link. */
  const goToStage = useCallback(
    (stage?: string) => {
      setOnboardingStage(null);
      if (!stage) {
        setLeadsStage(null);
        setLeadsFilter("active");
        setView("leads");
        return;
      }
      const idx = stages.indexOf(stage);
      if (idx < 0) {
        setLeadsStage(null);
        setLeadsFilter("active");
        setView("leads");
        return;
      }
      if (idx === stages.length - 1) {
        setLeadsStage(null);
        setLeadsFilter("active");
        setView("clients");
        return;
      }
      if (isOwnerOrg && idx > 0) {
        setOnboardingStage(stage);
        setView("onboarding");
        return;
      }
      setLeadsStage(stage);
      setLeadsFilter("active");
      setView("leads");
    },
    [stages, isOwnerOrg],
  );

  /* Owner direction 2026-08-26 — the Dashboard "Lost" card's "View →".
     Switches to the owner's Leads view with the "Lost" filter active (the
     Lost listing). Owner-only (the card is owner-only), so this is only ever
     reached from the owner dashboard. */
  const goToLost = useCallback(() => {
    setLeadsStage(null);
    setOnboardingStage(null);
    setLeadsFilter("lost");
    setView("leads");
  }, []);

  if (!booted) {
    return (
      <div className="splash" role="status" aria-label="Loading Revzenta">
        <div className="splash-inner">
          <div className="splash-ring">
            <span className="splash-mark">R</span>
          </div>
          <div className="splash-name">
            Revzenta
          </div>
          <div className="splash-sub">CRM</div>
        </div>
      </div>
    );
  }

  /* Owner bug 2026-08-27 (§67): the reset page renders whenever a live
   * `#/reset?token=…` token is in the URL — SIGNED-IN OR NOT. The branch used
   * to sit inside `if (!user)`, so an authenticated user opening the emailed
   * link landed in the app shell and never saw the form. Onward routing:
   *  • signed out → "Sign in" after a successful reset clears the hash and
   *    returns to the normal login card;
   *  • signed in  → back into the app shell (the reset changed only a
   *    password; their session is untouched). */
  if (resetToken) {
    return (
      <ResetPassword
        token={resetToken}
        onDone={() => {
          window.location.hash = "";
          setResetToken(null);
        }}
      />
    );
  }

  if (!user) {
    if (showLogin) {
      return (
        <Login
          onLogin={(u) => {
            setUser(u);
            setResetToken(null);
            if (window.location.hash.startsWith("#/reset") || window.location.hash.startsWith("#/login")) {
              window.location.hash = "";
            }
          }}
          onBackToWebsite={() => {
            setShowLogin(false);
            if (window.location.hash.startsWith("#/login")) window.location.hash = "";
          }}
        />
      );
    }
    return (
      <Website
        onSignIn={() => {
          setShowLogin(true);
          window.location.hash = "#/login";
        }}
        onLaunchApp={() => {
          setShowLogin(true);
          window.location.hash = "#/login";
        }}
      />
    );
  }

  if (viewingWebsite) {
    return (
      <Website
        onSignIn={() => {
          setViewingWebsite(false);
          window.location.hash = "";
        }}
        onLaunchApp={() => {
          setViewingWebsite(false);
          window.location.hash = "";
        }}
      />
    );
  }

  const isOwner = user?.isOwner === true;
  const brandMark = isOwner ? "R" : initials(orgName) || "R";

  return (
    <div className={isOwnerOrg ? "app owner-workspace" : "app"} style={brandStyle}>
      <PiiContext.Provider value={piiHidden}>
        {/* Owner 2026-08-28 — nav moved to a LEFT SIDEBAR ("Put the
            navigation menu on the left side of the screen"). .shell is a
            row: the sticky .nav sidebar on the left, .content (impersonate
            banner + main + footer) flowing to its right. Same tabs, same
            controls — only their position changed. */}
        <div className="shell">
        <header className="nav">
        <div className="nav-inner">
          <button className="brand" onClick={() => setView("dashboard")} aria-label="Go to dashboard">
            <span className="brand-mark">{brandMark}</span>
            <span className="brand-text">
              {isOwner ? (
                <>
                  Revzenta
                  <span className="brand-sub">CRM</span>
                </>
              ) : (
                <>
                  {orgName}
                  <span className="brand-sub">CRM</span>
                </>
              )}
            </span>
          </button>
          <nav className="tabs" aria-label="Main">
            {isOwnerCockpit ? (
              <>
                <button
                  className={effectiveViewFinal === "dashboard" ? "tab active" : "tab"}
                  onClick={() => setView("dashboard")}
                >
                  Dashboard
                </button>
                {/* Pipeline tab: "Leads" for owner */}
                <button
                  className={effectiveViewFinal === "leads" ? "tab active" : "tab"}
                  onClick={() => {
                    setLeadsStage(null);
                    setOnboardingStage(null);
                    setLeadsFilter("active");
                    setView("leads");
                  }}
                >
                  Leads
                </button>
                <button
                  className={effectiveViewFinal === "onboarding" ? "tab active" : "tab"}
                  onClick={() => {
                    setOnboardingStage(null);
                    setView("onboarding");
                  }}
                >
                  Onboarding
                </button>
                <button
                  className={effectiveViewFinal === "appointments" ? "tab active" : "tab"}
                  onClick={() => setView("appointments")}
                >
                  Appointments
                </button>
                <button
                  className={effectiveViewFinal === "tasks" ? "tab active" : "tab"}
                  onClick={() => setView("tasks")}
                >
                  Tasks
                </button>
                <button
                  className={effectiveViewFinal === "tickets" ? "tab active" : "tab"}
                  onClick={() => setView("tickets")}
                >
                  Tickets
                </button>
                <button
                  className={effectiveViewFinal === "finance" ? "tab active" : "tab"}
                  onClick={() => setView("finance")}
                >
                  Finance
                </button>

                {/* Client Accounts Hub — Build & View Client CRMs */}
                <div className="nav-section-title">
                  <span>Client Workspaces</span>
                </div>
                <div className="nav-accounts-row">
                  <button
                    className={effectiveViewFinal === "clients" ? "tab active" : "tab"}
                    onClick={() => {
                      setCreateAccountOpen(false);
                      setView("clients");
                    }}
                    title="View client accounts & access each client's CRM"
                  >
                    <span className="tab-icon">👥</span>
                    <span>Client Accounts</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm nav-build-btn"
                    title="Build a new client account"
                    onClick={() => {
                      setCreateAccountOpen(true);
                      setView("clients");
                    }}
                  >
                    + Build
                  </button>
                </div>

                {/* Business Type CRMs — Owner/Admin Only */}
                <div className="nav-section-title">
                  <span>Business Type CRMs</span>
                </div>
                <button
                  className={previewVertical === "b2b" ? "tab active tab-btype" : "tab tab-btype"}
                  onClick={() => {
                    setPreviewVertical("b2b");
                    setView("dashboard");
                  }}
                  title="View B2B Business Type CRM"
                >
                  <span className="tab-icon">🏢</span>
                  <span>B2B CRM</span>
                </button>
                <button
                  className={previewVertical === "b2c" ? "tab active tab-btype" : "tab tab-btype"}
                  onClick={() => {
                    setPreviewVertical("b2c");
                    setView("dashboard");
                  }}
                  title="View B2C Business Type CRM"
                >
                  <span className="tab-icon">🛍️</span>
                  <span>B2C CRM</span>
                </button>
                <button
                  className={previewVertical === "wholesalebiz" ? "tab active tab-btype" : "tab tab-btype"}
                  onClick={() => {
                    setPreviewVertical("wholesalebiz");
                    setView("dashboard");
                  }}
                  title="View Wholesale Real Estate CRM"
                >
                  <span className="tab-icon">🏠</span>
                  <span>Wholesale Real Estate</span>
                </button>

                {/* Owner Administration */}
                <div className="nav-section-title">
                  <span>System</span>
                </div>
                <button
                  className={effectiveViewFinal === "admin" ? "tab active" : "tab"}
                  onClick={() => setView("admin")}
                >
                  Administration
                </button>
                <button
                  className={effectiveViewFinal === "documents" ? "tab active" : "tab"}
                  onClick={() => setView("documents")}
                >
                  Documents
                </button>
                <button
                  className={effectiveViewFinal === "settings" ? "tab active" : "tab"}
                  onClick={() => setView("settings")}
                >
                  Settings
                </button>
              </>
            ) : (
              /* Tenant or Preview Business Type CRM */
              <>
                <button
                  className={effectiveViewFinal === "dashboard" ? "tab active" : "tab"}
                  onClick={() => setView("dashboard")}
                >
                  Dashboard
                </button>
                {/* Pipeline tab: "Properties" for wholesale, "Leads" for general */}
                {canSeeTab("clients") && (
                  <button
                    className={effectiveViewFinal === "leads" ? "tab active" : "tab"}
                    onClick={() => {
                      setLeadsStage(null);
                      setOnboardingStage(null);
                      setLeadsFilter("active");
                      setView("leads");
                    }}
                  >
                    {isWholesale ? "Properties" : "Leads"}
                  </button>
                )}
                {/* Directory tab: "Investors" for wholesale, "Clients" for general */}
                {canSeeTab("clients") && (
                  <button
                    className={effectiveViewFinal === "clients" ? "tab active" : "tab"}
                    onClick={() => setView("clients")}
                  >
                    {isWholesale ? "Investors" : "Clients"}
                  </button>
                )}
                {/* Wholesale Buy Box Matches tab */}
                {isWholesale && canSeeTab("clients") && (
                  <button
                    className={effectiveViewFinal === "buybox" ? "tab active" : "tab"}
                    onClick={() => setView("buybox")}
                  >
                    Buy Box
                  </button>
                )}
                {isWholesale && (
                  <button
                    className={effectiveViewFinal === "documents" ? "tab active" : "tab"}
                    onClick={() => setView("documents")}
                  >
                    Transaction Hub
                  </button>
                )}
                {!isWholesale && (
                  <button
                    className={effectiveViewFinal === "appointments" ? "tab active" : "tab"}
                    onClick={() => setView("appointments")}
                  >
                    Appointments
                  </button>
                )}
                {canSeeTab("tasks") && (
                  <button
                    className={effectiveViewFinal === "tasks" ? "tab active" : "tab"}
                    onClick={() => setView("tasks")}
                  >
                    Tasks
                  </button>
                )}
                {/* Support tickets */}
                {canSeeTab("support") && (
                  <button
                    className={effectiveViewFinal === "tickets" ? "tab active" : "tab"}
                    onClick={() => setView("tickets")}
                  >
                    Support
                  </button>
                )}
                {!isWholesale && canSeeTab("finance") && (
                  <button
                    className={effectiveViewFinal === "finance" ? "tab active" : "tab"}
                    onClick={() => setView("finance")}
                  >
                    Finance
                  </button>
                )}
                {canSeeTab("settings") && (
                  <button
                    className={effectiveViewFinal === "settings" ? "tab active" : "tab"}
                    onClick={() => setView("settings")}
                  >
                    Settings
                  </button>
                )}

                {/* If owner is previewing this business type CRM, show quick exit in sidebar */}
                {previewVertical && (
                  <div className="nav-preview-exit-box">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost nav-preview-exit-btn"
                      onClick={() => setPreviewVertical(null)}
                      title="Return to Owner / Admin CRM"
                    >
                      <span>←</span>
                      <span>Exit to Owner CRM</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </nav>
          <div className="nav-right">
            {/* Global theme toggle (Light / Dark mode) */}
            <ThemeToggle />
            {/* View Marketing Website button */}
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setViewingWebsite(true);
                window.location.hash = "#/website";
              }}
              title="View Revzenta Marketing Website"
              aria-label="View Revzenta Marketing Website"
              style={{ fontSize: "14px", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}
            >
              🌐
            </button>
            {/* Global privacy eye (owner request 2026-08-14) — blurs names,
                phone, email, address everywhere while ON; "active" styling
                (accent border/fill) marks the blurring state. */}
            <button
              type="button"
              className={`eye-btn pii-eye-btn${piiHidden ? " active" : ""}`}
              onClick={() => setPiiHidden((v) => !v)}
              aria-label={piiTitle}
              aria-pressed={piiHidden}
              title={piiTitle}
            >
              {piiHidden ? <PiiEyeOffIcon /> : <PiiEyeIcon />}
            </button>
            <span className={`nav-user${blurPii(piiHidden)}`} title={user.email}>
              {navUserName}
              {orgName ? ` · ${orgName}` : ""}
            </span>
            <button className="btn btn-ghost btn-sm nav-signout" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="content">
        {impersonating && (
          <div className="impersonate-banner" role="status" aria-label="Impersonation notice">
            <span className="impersonate-icon" aria-hidden="true">
              ⚠
            </span>
            <span className="impersonate-text">
              Viewing as <strong>{orgName || "tenant"}</strong> — you are inside this client's
              workspace. Everything you see is exactly what they see.
            </span>
            <button
              className="btn btn-sm impersonate-return"
              onClick={handleImpersonateReturn}
              disabled={returning}
            >
              {returning ? "Returning…" : "Return to my dashboard"}
            </button>
          </div>
        )}
        {previewVertical && (
          <div className="btype-preview-banner" role="status">
            <div className="btype-preview-left">
              <span className="btype-preview-icon">
                {previewVertical === "wholesalebiz" ? "🏠" : previewVertical === "b2c" ? "🛍️" : "🏢"}
              </span>
              <div className="btype-preview-text">
                <div className="btype-preview-title">
                  Viewing <strong>{previewVertical === "wholesalebiz" ? "Wholesale Real Estate CRM" : previewVertical === "b2c" ? "B2C CRM" : "B2B CRM"}</strong> (Business Type Preview)
                </div>
                <div className="btype-preview-sub">
                  Exploring the client-facing CRM experience, pipeline stages, and modules for this business type.
                </div>
              </div>
            </div>
            <div className="btype-preview-actions">
              <span className="btype-preview-switch-label">Switch:</span>
              {previewVertical !== "b2b" && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btype-switch-btn"
                  onClick={() => { setPreviewVertical("b2b"); setView("dashboard"); }}
                >
                  🏢 B2B
                </button>
              )}
              {previewVertical !== "b2c" && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btype-switch-btn"
                  onClick={() => { setPreviewVertical("b2c"); setView("dashboard"); }}
                >
                  🛍️ B2C
                </button>
              )}
              {previewVertical !== "wholesalebiz" && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btype-switch-btn"
                  onClick={() => { setPreviewVertical("wholesalebiz"); setView("dashboard"); }}
                >
                  🏠 Wholesale
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-primary btype-build-btn"
                onClick={() => {
                  setPreviewVertical(null);
                  setCreateAccountOpen(true);
                  setView("clients");
                }}
              >
                + Build Client Account
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost btype-exit-btn"
                onClick={() => setPreviewVertical(null)}
              >
                ✕ Exit to Owner CRM
              </button>
            </div>
          </div>
        )}
      <main className="main">
        {effectiveViewFinal === "dashboard" ? (
          <Dashboard
            onGoToStage={goToStage}
            onGoToLost={goToLost}
            onGoToBuyBox={() => setView("buybox")}
            onGoToBuyers={() => setView("buyers")}
            onGoToTransactions={() => setView("documents")}
            stages={stages}
            ownerOrg={isOwnerCockpit}
            isWholesale={isWholesale}
          />
        ) : effectiveViewFinal === "leads" ? (
          /* Owner request 2026-08-15 — the owner's Leads tab scopes to the
             FIRST stage only; client accounts (role=member) keep the full
             pipeline (every stage except their terminal one, PR #35).
             Team-users: a view-only "clients" member still opens the tab —
             only the create/edit affordances are hidden (canEdit). */
          <Clients
            stages={stages}
            ownerOrg={isOwnerCockpit}
            scope={isOwnerCockpit ? "first" : "all"}
            initialStage={leadsStage}
            initialFilter={leadsFilter}
            canEdit={canEditTab("clients")}
            isWholesale={isWholesale}
            crmBusinessName={orgName}
            onGoToBuyBox={() => setView("buybox")}
            verticalKey={verticalKey}
          />
        ) : effectiveViewFinal === "offers" ? (
          <Offers
            crmBusinessName={orgName}
            onNavigateToProperty={() => {
              setLeadsStage(null);
              setOnboardingStage(null);
              setLeadsFilter("active");
              setView("leads");
            }}
          />
        ) : effectiveViewFinal === "buybox" ? (
          <BuyBoxMatcher canEdit={canEditTab("clients")} />
        ) : effectiveViewFinal === "onboarding" ? (
          /* Owner request 2026-08-15 — OWNER ONLY: the Onboarding tab scopes
             the pipeline to the MIDDLE stages (between first and terminal).
             Client accounts never reach this view — no nav item, and the
             dashboard routes middle stages to their single Leads tab. */
          <Clients stages={stages} ownerOrg={isOwnerCockpit} scope="middle" initialStage={onboardingStage} canEdit isWholesale={isWholesale} verticalKey={verticalKey} />
        ) : effectiveViewFinal === "clients" ? (
          /* Owner live-test reorg 2026-08-18 — the owner's Clients tab hosts
             the ACCOUNT management panel (create / view / reset / delete) via
             ClientsDirectory's Accounts sub-component. Owner 2026-08-20 — the
             owner's Clients tab is now the CLIENT ACCOUNTS list (the single
             client list), not a sold directory. */
          <ClientsDirectory
            stages={stages}
            ownerOrg={isOwnerCockpit}
            canEdit={canEditTab("clients")}
            ownerOrgId={isOwnerOrg ? user.orgId : undefined}
            onViewAccount={isOwnerOrg ? handleImpersonate : undefined}
            isWholesale={isWholesale}
            initialCreateOpen={createAccountOpen}
          />
        ) : effectiveViewFinal === "calendar" ? (
          /* Owner 2026-08-20 sales rework — the owner's Calendar view of
             demo-call appointments. Owner-workspace only. */
          <Calendar />
        ) : effectiveViewFinal === "appointments" ? (
          /* Appointments production (backlog 5a104eae): the general
             appointments tab, in both workspaces. ownerOrg lets the component
             pick the right API (owner /api/appointments vs tenant
             /api/org/appointments) and controls the status-mutation actions. */
          <Appointments ownerOrg={isOwnerCockpit} />
        ) : effectiveViewFinal === "tasks" ? (
          <Tasks canEdit={canEditTab("tasks")} />
        ) : effectiveViewFinal === "buyers" ? (
          /* Wholesale Real Estate vertical (owner 2026-09-04) — the
             account's end-buyer list, gated by the tasks grant. */
          <Buyers canEdit={canEditTab("tasks")} />
        ) : effectiveViewFinal === "finance" ? (
          <Finance canEdit={canEditTab("finance")} ownerOrg={isOwnerCockpit} />
        ) : effectiveViewFinal === "admin" ? (
          /* Owner 2026-08-28 consolidation — Administration hosts the
             Agreements template editor (PIN-protected, moved back from
             Documents), the Agreements PIN control and the owner's "Your
             data" export copy (both from Settings; owner decision
             2026-08-29 option b keeps the tenant export in tenant Settings).
             Client-account management moved to the Clients tab (2026-08-18). */
          <Admin />
        ) : effectiveViewFinal === "documents" ? (
          isWholesale ? (
            <TransactionHub crmBusinessName={orgName} />
          ) : (
            <Documents verticalLabel={undefined} />
          )
        ) : effectiveViewFinal === "tickets" ? (
          <Tickets ownerOrg={isOwnerCockpit} canEdit={canEditTab("support")} />
        ) : (
          <Settings
            canEdit={canEditTab("settings")}
            isOrgAdmin={user.isOrgAdmin === true}
            currentUserId={user.id}
            isOwnerOrg={isOwnerOrg}
          />
        )}
      </main>
      <footer className="foot">
        {(orgName || "Revzenta") + " CRM"} · product build · v0.1
      </footer>
      </div>
      </div>
      </PiiContext.Provider>
    </div>
  );
}
