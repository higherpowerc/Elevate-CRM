import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import type { User } from "./types";

/**
 * Sign-in card with a "Forgot password?" link (3k) that swaps to a small
 * "Reset password" form: enter your email, and if an account exists a
 * single-use reset link is emailed. The success message is deliberately the
 * same whether or not the email is registered (no account enumeration), so
 * the UI never needs to know which case happened.
 */
export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [setupMsg, setSetupMsg] = useState<string | null>(null);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSetupMsg(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const { user } = await api.login(email.trim(), password);
      onLogin(user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setSetupMsg(
          err.body?.message ??
            "No admin account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment, then run `bun run seed`.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setForgotMsg(null);
    if (!email.trim()) {
      setError("Enter the email for your account.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setForgotMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a reset link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-glow" aria-hidden="true" />
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark lg">R</span>
          <div>
            <div className="login-name">
              Revzenta
            </div>
            <div className="login-sub">Client pipeline CRM</div>
          </div>
        </div>
        <p className="login-tag">
          Prospect → Intake → Kickoff → Build → Launch → Retainer
        </p>
        {setupMsg && (
          <div className="alert alert-setup" role="alert">
            <strong>Setup required</strong>
            <p>{setupMsg}</p>
          </div>
        )}
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {forgotMsg && (
          <div className="alert alert-success" role="status">
            {forgotMsg}
          </div>
        )}
        {mode === "signin" ? (
          <form onSubmit={submit} className="form">
            <label className="field">
              <span className="field-label">Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="forgot-link"
              onClick={() => {
                setMode("forgot");
                setError(null);
                setForgotMsg(null);
              }}
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={submitForgot} className="form">
            <label className="field">
              <span className="field-label">Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
                required
              />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <button
              type="button"
              className="forgot-link"
              onClick={() => {
                setMode("signin");
                setError(null);
                setForgotMsg(null);
              }}
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
