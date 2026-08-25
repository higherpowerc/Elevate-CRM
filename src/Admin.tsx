import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/* Owner live-test reorg 2026-08-18 — client-ACCOUNT management moved OUT of
   Administration: the owner's Clients tab is the single hub for account
   management now (create account, view CRM, reset password, delete account —
   see src/Accounts.tsx, rendered by the owner's ClientsDirectory). This
   Administration tab keeps the owner cockpit pieces that live here: the
   Agreements section (the native e-signature template editor — one home for
   the template; Settings no longer hosts it, per the earlier owner direction),
   and the ProvisionNotices auto-provisioning banner now rides with the
   accounts panel on the Clients tab too. */

export default function Admin() {
  /* Owner direction 2026-08-17 — the agreement template editor lives HERE
     under Administration: the owner workspace's Administration area hosts the
     Agreements section (one home for the template — Settings is clean).
     Loaded from the same owner-only /api/settings route the editor always
     used; saved via updateSettings({ agreementTemplate }). Tenant workspaces
     never see this (the server only returns/accepts the template for the
     owner session, and this component renders in the owner workspace only). */
  const [agreementTemplate, setAgreementTemplate] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplSaved, setTplSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const { settings } = await api.settings();
      setAgreementTemplate(settings.agreementTemplate ?? "");
      setSettingsLoaded(true);
    } catch {
      /* The settings load already surfaces errors; the editor just stays empty. */
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function saveAgreementTemplate() {
    setTplBusy(true);
    setTplSaved(null);
    setError(null);
    try {
      await api.updateSettings({ agreementTemplate });
      setTplSaved("Agreement template saved — new sends use this wording.");
      await loadSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setTplBusy(false);
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
            The agreement template sent to every client. Account management (create / view / reset
            password / delete) lives on the Clients tab.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Agreements section under Administration. The agreement template
          editor MOVED here from Settings (one home, no duplicate). The
          textarea is a fixed-height scroll box (see .agree-template-input in
          styles.css) so the long legal template (~20 000 chars) scrolls
          instead of stretching the page. Owner workspace only. */}
      <div className="card admin-form">
        <div className="admin-card-head">
          <h2 className="admin-card-title">Agreements</h2>
          <p className="admin-card-sub">
            The agreement sent to a client when you use the native e-signature (Onboarding tab
            → Send Agreements). Placeholders: {"{{company}}"} / {"[YOUR LLC NAME]"} (business
            name), {"{{client_name}}"} / {"[CLIENT LEGAL NAME]"} (business name for a business
            client, full name for an individual), {"{{date}}"} / {"[EFFECTIVE DATE]"},{" "}
            {"{{price}}"} / {"{{deal_value}}"} / {"[PRICE]"} / {"[DEAL_VALUE]"} (deal value).
            Both styles work in the same template. Leave blank to use the built-in default.
          </p>
        </div>
        <div className="form">
          <label className="field">
            <span className="field-label">Template</span>
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
          <button className="btn btn-primary" disabled={tplBusy} type="button" onClick={saveAgreementTemplate}>
            {tplBusy ? "Saving…" : "Save agreement template"}
          </button>
          {tplSaved && (
            <div className="alert alert-success" role="status" style={{ marginTop: 12 }}>
              {tplSaved}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}