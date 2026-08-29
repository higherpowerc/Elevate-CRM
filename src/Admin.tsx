import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";

/* Owner 2026-08-28 — Administration consolidation. The owner's admin controls
   live in ONE place, under the Administration tab:
   • Agreements template editor (PIN-protected dropdown) — moved here from the
     Documents tab, where it had briefly lived (2026-08-25). Documents is the
     agreement-envelope list again (App.tsx still routes both tabs).
   • Agreements PIN control — moved here from Settings (owner-only; hashed
     storage + the server routes /api/agreements/pin-check and settings
     agreementsPin are untouched).
   • "Your data" export card — the OWNER's copy (owner decision 2026-08-29,
     option b): tenant workspaces keep their own card in Settings; the owner's
     export lives here. Same org-scoped /api/settings/export download;
     functionality unchanged.
   Account management stays on the Clients tab (2026-08-18 reorg). This
   component renders in the owner workspace only (App.tsx gates view "admin"
   on isOwnerOrg), so every card below is owner-only. */

export default function Admin() {
  /* "Your data" export (the owner's copy; tenant workspaces keep theirs in
     Settings — owner decision 2026-08-29, option b) — downloads this
     workspace's own data as a JSON file. The server scopes every query by
     org_id, so the file can never contain another tenant's rows. */
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    setExportBusy(true);
    setExportMsg(null);
    setExportError(null);
    try {
      const res = await api.exportData();
      setExportMsg(
        `Downloaded ${res.filename} — it contains every record in this workspace.`,
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>
            Owner <em className="serif">administration</em>
          </h1>
          <p className="page-sub">
            The agreement template sent to every client, its PIN, and your data export.
            Account management (create / view / reset password / delete) lives on the
            Clients tab.
          </p>
        </div>
      </div>

      <AgreementsEditor />

      <AgreementsPinControl />

      <div className="card admin-form">
        <div className="admin-card-head">
          <h2 className="admin-card-title">Your data</h2>
          <p className="admin-card-sub">
            Download everything in this workspace — clients, tasks, invoices, custom field
            values, support tickets and agreements — as a JSON file. Only this workspace's
            data is included, and no passwords or sign-in credentials.
          </p>
        </div>
        {exportError && (
          <div className="alert alert-error" role="alert">
            {exportError}
          </div>
        )}
        {exportMsg && (
          <div className="alert alert-success" role="status">
            {exportMsg}
          </div>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleExport}
          disabled={exportBusy}
        >
          {exportBusy ? "Preparing…" : "Export my data"}
        </button>
      </div>
    </div>
  );
}

/* ── Agreements editor (PIN-protected dropdown) ─────────────────────────
 * Owner-only. The agreement-template editor lives HERE under Administration
 * (owner 2026-08-28 — moved back from the Documents tab, which hosts only the
 * agreement-envelope list again). Gated behind a PIN set/changed in the
 * Agreements PIN card below (hashed server-side). The dropdown shows on
 * click: if not yet unlocked for the session, a PIN prompt appears first; the
 * correct PIN reveals the editor (wrong PIN → inline error, editor stays
 * hidden). Loaded from the owner-only /api/settings route the editor always
 * used; saved via updateSettings({ agreementTemplate }). */
function AgreementsEditor() {
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const [agreementTemplate, setAgreementTemplate] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplSaved, setTplSaved] = useState<string | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const { settings } = await api.settings();
      setAgreementTemplate(settings.agreementTemplate ?? "");
      setSettingsLoaded(true);
    } catch {
      /* settings errors surface elsewhere */
    }
  }, []);

  useEffect(() => {
    if (open && unlocked && !settingsLoaded) void loadSettings();
  }, [open, unlocked, settingsLoaded, loadSettings]);

  async function tryUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) {
      setPinError("Enter the agreements PIN.");
      return;
    }
    setPinBusy(true);
    setPinError(null);
    try {
      const r = await api.checkAgreementsPin(pin.trim());
      if (r.ok) {
        setUnlocked(true);
        setPin("");
        void loadSettings();
      } else {
        setPinError(r.error || "Incorrect PIN.");
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Could not verify PIN.");
    } finally {
      setPinBusy(false);
    }
  }

  async function saveAgreementTemplate() {
    setTplBusy(true);
    setTplSaved(null);
    setTplError(null);
    try {
      await api.updateSettings({ agreementTemplate });
      setTplSaved("Agreement template saved — new sends use this wording.");
    } catch (e) {
      setTplError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setTplBusy(false);
    }
  }

  return (
    <div className="card agreements-editor">
      <button
        type="button"
        className="agreements-dropdown-bar"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agreements-dropdown-title">
          <em className="serif">Agreements</em> — template editor
        </span>
        <span className="agreements-dropdown-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && !unlocked && (
        <form className="agreements-pin-box" onSubmit={tryUnlock}>
          <p className="admin-card-sub">Enter the agreements PIN to edit the template (set/change it below).</p>
          {pinError && (
            <div className="alert alert-error" role="alert">
              {pinError}
            </div>
          )}
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Agreements PIN"
              aria-label="Agreements PIN"
              style={{ minWidth: "180px", flex: "1" }}
            />
            <button className="btn btn-primary" disabled={pinBusy} type="submit">
              {pinBusy ? "Checking…" : "Unlock"}
            </button>
          </div>
        </form>
      )}
      {open && unlocked && (
        <div className="form agreements-editor-body">
          <label className="field">
            <span className="field-label">Agreement template</span>
            <textarea
              className="agree-template-input"
              value={agreementTemplate}
              onChange={(e) => setAgreementTemplate(e.target.value)}
              rows={12}
              maxLength={20000}
              placeholder={
                "CLIENT SERVICES AGREEMENT\n\nThis agreement is between {{company}} and {{client_name}}.\nDate: {{date}}\nMonthly price: {{price}} / {{deal_value}}"
              }
            />
            <span className="field-hint">
              {settingsLoaded
                ? "Owner workspace only — client accounts never see this. Saved wording applies to new sends."
                : "Loading the saved template…"}
            </span>
          </label>
          {tplError && (
            <div className="alert alert-error" role="alert">
              {tplError}
            </div>
          )}
          {tplSaved && (
            <div className="alert alert-success" role="status">
              {tplSaved}
            </div>
          )}
          <button className="btn btn-primary" disabled={tplBusy} type="button" onClick={saveAgreementTemplate}>
            {tplBusy ? "Saving…" : "Save agreement template"}
          </button>
        </div>
      )}
    </div>
  );
}

/* Owner-only Agreements PIN control (moved from Settings, owner direction
   2026-08-28): set/change the PIN that unlocks the Agreements editor above.
   Stored hashed (sha-256) server-side; never rendered for tenant accounts. */
function AgreementsPinControl() {
  const [pinSet, setPinSet] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then(({ settings }) => {
        setPinSet(settings.agreementsPinSet ?? false);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function savePin(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) {
      setError("Enter a PIN to set.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await api.updateSettings({ agreementsPin: pin.trim() });
      setPinSet(true);
      setPin("");
      setSaved("Agreements PIN saved — use it to unlock the Agreements editor on the Administration tab.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PIN.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  return (
    <div className="card admin-form">
      <div className="admin-card-head">
        <h2 className="admin-card-title">Agreements PIN</h2>
        <p className="admin-card-sub">
          {pinSet
            ? "A PIN is set — enter a new one to change it."
            : "No PIN set yet. Set one to protect the Agreements template editor on this tab."}
        </p>
      </div>
      <form className="form" onSubmit={savePin}>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {saved && (
          <div className="alert alert-success" role="status">
            {saved}
          </div>
        )}
        <div className="field">
          <label className="field-label" htmlFor="agreements-pin">
            {pinSet ? "New agreements PIN" : "Agreements PIN"}
          </label>
          <input
            id="agreements-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–10 digits"
            disabled={busy}
          />
          <span className="field-hint">Owner-only — stored as a hash, never shown to client accounts.</span>
        </div>
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Saving…" : pinSet ? "Change PIN" : "Set PIN"}
        </button>
      </form>
    </div>
  );
}
