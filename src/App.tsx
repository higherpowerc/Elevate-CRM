import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Login from "./Login";
import ResetPassword from "./ResetPassword";
import Dashboard from "./Dashboard";
import Clients from "./Clients";
import ClientsDirectory from "./ClientsDirectory";
import Calendar from "./Calendar";
import Tasks from "./Tasks";
import Finance from "./Finance";
import Admin from "./Admin";
import Documents from "./Documents";
import Tickets from "./Tickets";
import Settings from "./Settings";
import { api } from "./api";
import { DEFAULT_STAGES, TENANT_TABS, type TenantTab, type User } from "./types";
import { initials } from "./bits";
import { PiiContext, PII_HIDDEN_KEY, blurPii, PiiEyeIcon, PiiEyeOffIcon } from "./pii";

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
type View = "dashboard" | "leads" | "onboarding" | "clients" | "calendar" | "tasks" | "finance" | "admin" | "documents" | "tickets" | "settings";

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
  /** 3k — a reset token from the URL hash (`#/reset?token=…`), shown while
   *  the user is signed out. */
  const [resetToken, setResetToken] = useState<string | null>(null);
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
    const onUnauthorized = () => {
      setUser((u) => {
        if (u) window.location.hash = "";
        return null;
      });
      setImpersonating(false);
      setResetToken(null);
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
  useEffect(() => {
    document.title = orgName ? `${orgName} — CRM` : "Revzenta — CRM";
  }, [orgName]);

  const accentStyle = useMemo<CSSProperties | undefined>(
    () => (user?.accentColor ? ({ "--accent": user.accentColor } as CSSProperties) : undefined),
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
  const isOwnerOrg = user?.isOwner === true;

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
      case "clients":
        return canSeeTab("clients");
      case "calendar":
        return isOwnerOrg;
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
      case "documents":
        return isOwnerOrg;
    }
  };
  const effectiveView: View = viewAllowed(view) ? view : "dashboard";

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
        setView("leads");
        return;
      }
      const idx = stages.indexOf(stage);
      if (idx < 0) {
        setLeadsStage(null);
        setView("leads");
        return;
      }
      if (idx === stages.length - 1) {
        setLeadsStage(null);
        setView("clients");
        return;
      }
      if (isOwnerOrg && idx > 0) {
        setOnboardingStage(stage);
        setView("onboarding");
        return;
      }
      setLeadsStage(stage);
      setView("leads");
    },
    [stages, isOwnerOrg],
  );

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

  if (!user) {
    // 3k — the reset page replaces the sign-in card while the URL hash carries
    // a token (`#/reset?token=…`). "Sign in" after a successful reset clears
    // the hash and returns to the normal login card.
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
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setResetToken(null);
          if (window.location.hash.startsWith("#/reset")) window.location.hash = "";
        }}
      />
    );
  }

  const isOwner = user?.isOwner === true;
  const brandMark = isOwner ? "R" : initials(orgName) || "R";

  return (
    <div className={isOwnerOrg ? "app owner-workspace" : "app"} style={accentStyle}>
      <PiiContext.Provider value={piiHidden}>
        <header className="nav">
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
            <button
              className={effectiveView === "dashboard" ? "tab active" : "tab"}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </button>
            {/* Owner request 2026-08-14: "Leads" and "Clients" sit side by
                side. The Leads tab is the pipeline; the Clients tab is the
                independent directory of every client in the org. Owner
                request 2026-08-15: both tabs read the same in every
                workspace — owner and client accounts alike. Owner request
                2026-08-15 (OWNER ONLY): the owner's pipeline splits into
                Leads = first stage + Onboarding = middle stages; client
                accounts never see Onboarding — their single Leads tab keeps
                every stage except their terminal one. Team-users (PR #56):
                a restricted member only sees the tabs their grants allow —
                Leads + Clients are both gated by the "clients" grant (both
                render /api/clients data); the owner and org admins always
                see every tab. */}
            {canSeeTab("clients") && (
              <button
                className={effectiveView === "leads" ? "tab active" : "tab"}
                onClick={() => {
                  setLeadsStage(null);
                  setOnboardingStage(null);
                  setView("leads");
                }}
              >
                Leads
              </button>
            )}
            {isOwnerOrg && (
              <button
                className={effectiveView === "onboarding" ? "tab active" : "tab"}
                onClick={() => {
                  setOnboardingStage(null);
                  setView("onboarding");
                }}
              >
                Onboarding
              </button>
            )}
            {/* Owner 2026-08-20 sales rework — the owner's Calendar view:
                demo-call appointments, owner-workspace only. */}
            {isOwnerOrg && (
              <button
                className={effectiveView === "calendar" ? "tab active" : "tab"}
                onClick={() => setView("calendar")}
              >
                Calendar
              </button>
            )}
            {canSeeTab("clients") && (
              <button
                className={effectiveView === "clients" ? "tab active" : "tab"}
                onClick={() => setView("clients")}
              >
                Clients
              </button>
            )}
            {canSeeTab("tasks") && (
              <button
                className={effectiveView === "tasks" ? "tab active" : "tab"}
                onClick={() => setView("tasks")}
              >
                Tasks
              </button>
            )}
            {canSeeTab("finance") && (
              <button
                className={effectiveView === "finance" ? "tab active" : "tab"}
                onClick={() => setView("finance")}
              >
                Finance
              </button>
            )}
            {isOwnerOrg && (
              <button
                className={effectiveView === "admin" ? "tab active" : "tab"}
                onClick={() => setView("admin")}
              >
                {/* Owner direction 2026-08-17 — the owner's admin tab reads
                    "Administration": it hosts the Agreements section (the
                    agreement template editor that used to live in Settings).
                    One home, no duplicate. Client-ACCOUNT management lives on
                    the Clients tab since 2026-08-18. */}
                Administration
              </button>
            )}
            {/* Owner live-test finding 2026-08-15 — "where are we storing
                these documents right now — they should be under admin": the
                OWNER workspace gains a central Documents tab listing EVERY
                agreement envelope across all client accounts (status, signer,
                signed date, IP + consent, PDF). Owner-workspace only — the
                server's GET /api/agreements is requireAdmin, so tenant orgs
                can never see the list. */}
            {isOwnerOrg && (
              <button
                className={effectiveView === "documents" ? "tab active" : "tab"}
                onClick={() => setView("documents")}
              >
                Documents
              </button>
            )}
            {/* Owner direction 2026-08-15 — support tickets: the OWNER's tab
                reads "Tickets" (every account's tickets, worked to
                resolution); client accounts read "Support" (their own org's
                tickets + submit form). Same view, role-based rendering
                inside Tickets.tsx. Team-users: restricted members only see
                the Support tab when they hold the "support" grant. */}
            {isOwnerOrg ? (
              <button
                className={effectiveView === "tickets" ? "tab active" : "tab"}
                onClick={() => setView("tickets")}
              >
                Tickets
              </button>
            ) : canSeeTab("support") ? (
              <button
                className={effectiveView === "tickets" ? "tab active" : "tab"}
                onClick={() => setView("tickets")}
              >
                Support
              </button>
            ) : null}
            {canSeeTab("settings") && (
              <button
                className={effectiveView === "settings" ? "tab active" : "tab"}
                onClick={() => setView("settings")}
              >
                Settings
              </button>
            )}
          </nav>
          <div className="nav-right">
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
              {user.email}
              {orgName ? ` · ${orgName}` : ""}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        {effectiveView === "dashboard" ? (
          <Dashboard
            onGoToStage={goToStage}
            stages={stages}
            ownerOrg={isOwnerOrg}
          />
        ) : effectiveView === "leads" ? (
          /* Owner request 2026-08-15 — the owner's Leads tab scopes to the
             FIRST stage only; client accounts (role=member) keep the full
             pipeline (every stage except their terminal one, PR #35).
             Team-users: a view-only "clients" member still opens the tab —
             only the create/edit affordances are hidden (canEdit). */
          <Clients
            stages={stages}
            ownerOrg={isOwnerOrg}
            scope={isOwnerOrg ? "first" : "all"}
            initialStage={leadsStage}
            canEdit={canEditTab("clients")}
          />
        ) : effectiveView === "onboarding" ? (
          /* Owner request 2026-08-15 — OWNER ONLY: the Onboarding tab scopes
             the pipeline to the MIDDLE stages (between first and terminal).
             Client accounts never reach this view — no nav item, and the
             dashboard routes middle stages to their single Leads tab. */
          <Clients stages={stages} ownerOrg={isOwnerOrg} scope="middle" initialStage={onboardingStage} canEdit />
        ) : effectiveView === "clients" ? (
          /* Owner live-test reorg 2026-08-18 — the owner's Clients tab hosts
             the ACCOUNT management panel (create / view / reset / delete) via
             ClientsDirectory's Accounts sub-component. Owner 2026-08-20 — the
             owner's Clients tab is now the CLIENT ACCOUNTS list (the single
             client list), not a sold directory. */
          <ClientsDirectory
            stages={stages}
            ownerOrg={isOwnerOrg}
            canEdit={canEditTab("clients")}
            ownerOrgId={isOwnerOrg ? user.orgId : undefined}
            onViewAccount={isOwnerOrg ? handleImpersonate : undefined}
          />
        ) : effectiveView === "calendar" ? (
          /* Owner 2026-08-20 sales rework — the owner's Calendar view of
             demo-call appointments. Owner-workspace only. */
          <Calendar />
        ) : effectiveView === "tasks" ? (
          <Tasks canEdit={canEditTab("tasks")} />
        ) : effectiveView === "finance" ? (
          <Finance canEdit={canEditTab("finance")} ownerOrg={isOwnerOrg} />
        ) : effectiveView === "admin" ? (
          /* Administration now hosts the Agreements (template editor) section
             only — client-account management moved to the Clients tab
             (2026-08-18). */
          <Admin />
        ) : effectiveView === "documents" ? (
          <Documents />
        ) : effectiveView === "tickets" ? (
          <Tickets ownerOrg={isOwnerOrg} canEdit={canEditTab("support")} />
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
      </PiiContext.Provider>
    </div>
  );
}
