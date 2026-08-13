import { useCallback, useEffect, useState } from "react";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Clients from "./Clients";
import { api } from "./api";
import type { User } from "./types";

type View = "dashboard" | "clients";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<View>("dashboard");

  useEffect(() => {
    const onUnauthorized = () => {
      setUser((u) => {
        if (u) window.location.hash = "";
        return null;
      });
    };
    window.addEventListener("crm:unauthorized", onUnauthorized);
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setBooted(true));
    return () => window.removeEventListener("crm:unauthorized", onUnauthorized);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* session already gone is fine */
    }
    setUser(null);
    setView("dashboard");
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

  if (!user) return <Login onLogin={(u) => setUser(u)} />;

  return (
    <div className="app">
      <header className="nav">
        <div className="nav-inner">
          <button className="brand" onClick={() => setView("dashboard")} aria-label="Go to dashboard">
            <span className="brand-mark">E</span>
            <span className="brand-text">
              Elevate <em>Studio</em>
              <span className="brand-sub">CRM</span>
            </span>
          </button>
          <nav className="tabs" aria-label="Main">
            <button
              className={view === "dashboard" ? "tab active" : "tab"}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </button>
            <button
              className={view === "clients" ? "tab active" : "tab"}
              onClick={() => setView("clients")}
            >
              Clients
            </button>
          </nav>
          <div className="nav-right">
            <span className="nav-user" title={user.email}>
              {user.email}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        {view === "dashboard" ? (
          <Dashboard onGoToClients={() => setView("clients")} />
        ) : (
          <Clients />
        )}
      </main>
      <footer className="foot">Elevate Studio CRM · product build · v0.1</footer>
    </div>
  );
}
