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

      <div className="card admin-form">
        <div className="admin-card-head">
          <h2 className="admin-card-title">Agreements</h2>
          <p className="admin-card-sub">
            The agreement template editor moved to the Documents tab (2026-08-25) — open
            the "Agreements" dropdown there (PIN-protected) to edit the agreement sent to
            every client. Set or change the PIN in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}