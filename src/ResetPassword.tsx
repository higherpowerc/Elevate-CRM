import { useState, type FormEvent } from "react";
import { api } from "./api";

/**
 * 3k — the public reset-password page. Reached from the emailed link
 * (`<appUrl>/#/reset?token=...`); the SPA shell renders this in place of the
 * login card while the hash carries a token. On success it shows a "Sign in"
 * button (the user's new password is live; the token is single-use).
 */
export default function ResetPassword({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.resetPassword(token, password);
      setDone(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password.");
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
            <div className="login-sub">Reset password</div>
          </div>
        </div>
        {done ? (
          <>
            <div className="alert alert-success" role="status">
              {done}
            </div>
            <button className="btn btn-primary btn-block" onClick={onDone}>
              Sign in
            </button>
          </>
        ) : (
          <>
            <p className="login-tag">Choose a new password for your account.</p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={submit} className="form">
              <label className="field">
                <span className="field-label">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  autoFocus
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat the new password"
                  minLength={8}
                  required
                />
              </label>
              <button className="btn btn-primary btn-block" disabled={busy} type="submit">
                {busy ? "Resetting…" : "Set new password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
