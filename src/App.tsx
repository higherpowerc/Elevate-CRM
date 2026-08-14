import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Login from "./Login";
import ResetPassword from "./ResetPassword";
import Dashboard from "./Dashboard";
import Clients from "./Clients";
import ClientsDirectory from "./ClientsDirectory";
import Tasks from "./Tasks";
import Finance from "./Finance";
import Admin from "./Admin";
import Settings from "./Settings";
import { api } from "./api";
import { DEFAULT_STAGES, type User } from "./types";
import { initials } from "./bits";

/* Owner request 2026-08-14 — the single "Clients" tab splits into TWO:
 *   "leads"  → the pipeline view (stage chips, Active/Archived/All, stage
 *              actions, Manage stages) — today's Clients tab, reframed.
 *   "clients" → the independent directory of ALL clients (any stage, incl.
 *              archived), flat and alphabetically sorted.
 * The owner workspace (role=admin) labels them "Leads" + "Clients"; tenant
 * orgs (role=member) keep "clients" wording everywhere — "Clients" (the
 * pipeline) + "All clients" (the directory). */
type View = "dashboard" | "leads" | "clients" | "tasks" | "finance" | "admin" | "settings";

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
  /** 3k — a reset token from the URL hash (`#/reset?token=…`), shown while
   *  the user is signed out. */
  const [resetToken, setResetToken] = useState<string | null>(null);
  /* Phase 3d — owner impersonation. True while the owner's session is swapped
     into a client tenant's workspace; drives the banner in the shell. */
  const [impersonating, setImpersonating] = useState(false);
  const [returning, setReturning] = useState(false);

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
    document.title = orgName ? `${orgName} — CRM` : "Elevate Studio — CRM";
  }, [orgName]);

  const accentStyle = useMemo<CSSProperties | undefined>(
    () => (user?.accentColor ? ({ "--accent": user.accentColor } as CSSProperties) : undefined),
    [user?.accentColor],
  );

  const stages = useMemo(() => user?.stages ?? DEFAULT_STAGES, [user?.stages]);

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
  }, []);

  /* Phase 3d — "View account" from the owner's Admin tab: the server swaps
     this session into the tenant's member user. Land on that tenant's
     dashboard — their nav, data, branding and role rules now apply as if the
     owner had logged in as them. */
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

  if (!booted) {
    return (
      <div className="splash" role="status" aria-label="Loading Elevate Studio">
        <div className="splash-inner">
          <div className="splash-ring">
            <span className="splash-mark">E</span>
          </div>
          <div className="splash-name">
            Elevate <em>Studio</em>
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

  const isOwner = orgName === "Elevate Studio";
  const brandMark = isOwner ? "E" : initials(orgName) || "E";
  /* Owner-org detection for terminology (owner direction 2026-08-14): the
     owner workspace is the org whose members hold the admin role — exactly
     the org where the Admin tab appears. It calls its pipeline records
     "leads"; tenant orgs (role=member) keep "clients" for their customers.
     Role-based, never org-name-based, so a renamed owner org still labels
     correctly. */
  const isOwnerOrg = user.role === "admin";

  return (
    <div className="app" style={accentStyle}>
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
                  Elevate <em>Studio</em>
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
              className={view === "dashboard" ? "tab active" : "tab"}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </button>
            {/* Owner request 2026-08-14: "Leads" and "Clients" sit side by
                side. The Leads tab is the pipeline; the Clients tab is the
                independent directory of every client in the org. Tenant orgs
                (role=member) never see "Leads" — their pipeline tab keeps
                the "Clients" label and the directory reads "All clients". */}
            <button
              className={view === "leads" ? "tab active" : "tab"}
              onClick={() => setView("leads")}
            >
              {isOwnerOrg ? "Leads" : "Clients"}
            </button>
            <button
              className={view === "clients" ? "tab active" : "tab"}
              onClick={() => setView("clients")}
            >
              {isOwnerOrg ? "Clients" : "All clients"}
            </button>
            <button
              className={view === "tasks" ? "tab active" : "tab"}
              onClick={() => setView("tasks")}
            >
              Tasks
            </button>
            <button
              className={view === "finance" ? "tab active" : "tab"}
              onClick={() => setView("finance")}
            >
              Finance
            </button>
            {user.role === "admin" && (
              <button
                className={view === "admin" ? "tab active" : "tab"}
                onClick={() => setView("admin")}
              >
                Admin
              </button>
            )}
            <button
              className={view === "settings" ? "tab active" : "tab"}
              onClick={() => setView("settings")}
            >
              Settings
            </button>
          </nav>
          <div className="nav-right">
            <span className="nav-user" title={user.email}>
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
        {view === "dashboard" ? (
          <Dashboard onGoToLeads={() => setView("leads")} stages={stages} ownerOrg={isOwnerOrg} />
        ) : view === "leads" ? (
          <Clients stages={stages} ownerOrg={isOwnerOrg} />
        ) : view === "clients" ? (
          <ClientsDirectory stages={stages} ownerOrg={isOwnerOrg} />
        ) : view === "tasks" ? (
          <Tasks />
        ) : view === "finance" ? (
          <Finance />
        ) : view === "admin" ? (
          <Admin ownerOrgId={user.orgId} onViewAccount={handleImpersonate} />
        ) : (
          <Settings />
        )}
      </main>
      <footer className="foot">
        {(orgName || "Elevate Studio") + " CRM"} · product build · v0.1
      </footer>
    </div>
  );
}
