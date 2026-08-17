import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { fmtDate, type Org } from "./types";
import { ALL_VERTICALS, verticalLabel } from "./verticals";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import ProvisionNotices from "./ProvisionNotices";
import { usePii, blurPii } from "./pii";

interface Props {
  /** The admin's own org id — the owner workspace is never deletable. */
  ownerOrgId: number;
  /** Phase 3d — "View account": swap the owner's session into this tenant's
   *  workspace (server-side impersonation). Throws on failure so the caller
   *  can surface the error. */
  onViewAccount: (orgId: number) => Promise<void>;
}

/** Random password (crypto-grade): one from each class + extras, 19 chars. */
function generatePassword(): string {
  const sets = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%^&*-_=+",
  ];
  const all = sets.join("");
  const pick = (chars: string, n: number): string => {
    const a = new Uint32Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (x) => chars[x % chars.length]).join("");
  };
  return sets.map((s) => pick(s, 4)).join("") + pick(all, 3);
}

export default function Admin({ ownerOrgId, onViewAccount }: Props) {
  /* Global privacy eye (2026-08-14 owner request) — blur PII (client/company names, phone, email, address) here too. */
  const pii = usePii();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Org whose "View account" is in flight (shows a spinner on that row). */
  const [viewingOrgId, setViewingOrgId] = useState<number | null>(null);
  /** 3k — org whose "Reset password" is in flight. */
  const [resettingOrgId, setResettingOrgId] = useState<number | null>(null);
  /** 3k — the fresh temp password from the last reset, shown in a modal so
   *  the owner can hand it to the client. */
  const [resetResult, setResetResult] = useState<{
    orgName: string;
    email: string;
    password: string;
  } | null>(null);

  /* Create-account form */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  /** 3f-1: the business type picker (owner direction 2026-08-16 — the catalog
   *  is B2B & B2C only; B2B is the default: "Mainly we will be selling B2B"). */
  const [vertical, setVertical] = useState("b2b");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    orgName: string;
    email: string;
    password: string;
    verticalLabel: string;
    emailStatus: "sent" | "failed" | "skipped";
    emailError?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  /* Delete-tenant confirm */
  const [deleting, setDeleting] = useState<Org | null>(null);

  /* Owner request 2026-08-14/15 — per-account BILLING amount: Phase 5 billing
     prep (what the owner will charge each client account). It does NOT feed
     Client MRR (owner direction 2026-08-15 — MRR is the deal value of
     sold-stage client records). Owner direction 2026-08-15 — the per-account
     revenue-model select is REMOVED (one product, subscription-based); only
     the billing-amount input remains. Inline draft editor per org row, saved
     to the server via PATCH. */
  const [billingDraft, setBillingDraft] = useState<Record<number, { amount: string }>>({});
  const [savingBillingId, setSavingBillingId] = useState<number | null>(null);

  function billingDraftFor(o: Org) {
    const d = billingDraft[o.id];
    if (d) return d;
    return {
      amount: String(o.monthlySubscriptionAmount ?? 0),
    };
  }

  async function handleSaveBilling(o: Org) {
    const d = billingDraftFor(o);
    const amount = Number(d.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Monthly billing amount must be a non-negative number.");
      return;
    }
    setSavingBillingId(o.id);
    setError(null);
    try {
      await api.adminUpdateOrg(o.id, { monthlySubscriptionAmount: amount });
      setBillingDraft((prev) => {
        const next = { ...prev };
        delete next[o.id];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSavingBillingId(null);
    }
  }

  /* Owner direction 2026-08-17 — the agreement template editor MOVED here
     from Settings: the owner workspace's Administration area now hosts the
     Agreements section (one home for the template — Settings is clean).
     Loaded from the same owner-only /api/settings route the editor always
     used; saved via updateSettings({ agreementTemplate }). Tenant workspaces
     never see this (the server only returns/accepts the template for the
     owner session, and Admin.tsx renders in the owner workspace only). */
  const [agreementTemplate, setAgreementTemplate] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplSaved, setTplSaved] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const { settings } = await api.settings();
      setAgreementTemplate(settings.agreementTemplate ?? "");
      setSettingsLoaded(true);
    } catch {
      /* The orgs load already surfaces errors; the editor just stays empty. */
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

  const load = useCallback(async () => {
    setError(null);
    try {
      const { orgs } = await api.adminOrgs();
      setOrgs(orgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load client accounts.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Owner direction 2026-08-15 — the Admin client-account list is for CLIENT
     workspaces: the owner's OWN workspace is filtered out of the table rows,
     the "N workspaces" count, and (with the row gone) its View-account /
     delete / edit affordances. The server API /api/admin/orgs is UNCHANGED —
     it still returns the full list; this is a UI-side filter only. */
  const visibleOrgs = orgs ? orgs.filter((o) => o.id !== ownerOrgId) : null;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    setBusy(true);
    try {
      const { org, user, emailStatus, emailError } = await api.adminCreateOrg({
        name: name.trim(),
        email: email.trim(),
        password,
        vertical,
      });
      setCreated({ orgName: org.name, email: user.email, password, verticalLabel: verticalLabel(vertical), emailStatus, emailError });
      setName("");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      setVertical("b2b");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminDeleteOrg(deleting.id);
      setDeleting(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  /* Phase 3d — jump into the tenant's workspace. On success the App shell
     swaps to that tenant's user (banner appears); on failure keep the admin
     view and surface the error. */
  async function handleViewAccount(o: Org) {
    setViewingOrgId(o.id);
    setError(null);
    try {
      await onViewAccount(o.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this account.");
    } finally {
      setViewingOrgId(null);
    }
  }

  /* 3k — generate a fresh temp password for a tenant (the interim answer to
     "client forgot their password and has no email access"). The password
     comes back once, in the modal; it also stays on the Admin list until the
     client's first successful login clears it. */
  async function handleResetPassword(o: Org) {
    setResettingOrgId(o.id);
    setError(null);
    setResetResult(null);
    try {
      const res = await api.adminResetOrgPassword(o.id);
      setResetResult({ orgName: o.name, email: res.email, password: res.password });
      await load(); // refresh so the list shows the new resetPassword value
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setResettingOrgId(null);
    }
  }

  /* 3k — Esc closes the temp-password modal (same as every other modal). */
  useEffect(() => {
    if (!resetResult) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setResetResult(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetResult]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Owner <em className="serif">administration</em>
          </h1>
          <p className="page-sub">
            Client accounts, billing, and the agreement template sent to every client.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* 3g-3 — sold-lead auto-provisioning notices: name the sold client +
          the new workspace, dismissed on view. */}
      <ProvisionNotices onViewAccount={(orgId) => handleViewAccount({ id: orgId } as Org)} />

      <div className="admin-grid">
        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Create client account</h2>
            <p className="admin-card-sub">
              Creates the client's private workspace and a member login for it.
            </p>
          </div>

          {formError && (
            <div className="alert alert-error" role="alert">
              {formError}
            </div>
          )}

          {created &&
            (created.emailStatus === "sent" ? (
              <div className="alert alert-success" role="status">
                <strong>Account created</strong>
                <p className="created-line">
                  <b className={pii ? "pii-blur" : undefined}>{created.orgName}</b> · <span className={pii ? "pii-blur" : undefined}>{created.email}</span>
                </p>
                <p className="created-line">
                  Business type: <b>{created.verticalLabel}</b>
                </p>
                <p className="created-line">
                  Temp password: <code>{created.password}</code>
                </p>
                <p className="created-hint">
                  The welcome email with the login credentials was sent to {created.email}.
                  The temp password is also shown here, right after creation, in case it is needed.
                </p>
              </div>
            ) : (
              /* Live-test finding #1 (2026-08-15): the account WAS created, but
                 the welcome email did not go out (Resend test-mode 422, unset
                 key, ...) — never show a green "sent" in that case; tell the
                 owner to share the credentials manually. */
              <div className="alert alert-warn" role="alert">
                <strong>Account created — but the welcome email could not be sent</strong>
                <p className="created-line">
                  <b className={pii ? "pii-blur" : undefined}>{created.orgName}</b> · <span className={pii ? "pii-blur" : undefined}>{created.email}</span>
                </p>
                <p className="created-line">
                  Business type: <b>{created.verticalLabel}</b>
                </p>
                <p className="created-line">
                  Temp password: <code>{created.password}</code>
                </p>
                <p className="created-line">{created.emailError}</p>
                <p className="created-hint">
                  Share the credentials manually with the client — the welcome email was not
                  delivered. It is shown only here, right after creation.
                </p>
              </div>
            ))}

          <form onSubmit={handleCreate} className="form">
            <label className="field">
              <span className="field-label">Company name *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Landscaping"
                maxLength={200}
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label">Business type</span>
              <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
                {ALL_VERTICALS.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                The new workspace is pre-configured for this business type — its pipeline stages
                are seeded automatically. The client can rename, reorder or add stages and fields
                later in Settings.
              </span>
            </label>
            <label className="field">
              <span className="field-label">Client email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@acme.com"
                maxLength={254}
                autoComplete="off"
                required
              />
            </label>
            <div className="field">
              <span className="field-label">Temp password *</span>
              <div className="password-row">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                  aria-label="Generate a strong password"
                  title="Generate a strong password"
                >
                  Generate
                </button>
              </div>
              <span className="field-hint">At least 8 characters — generated passwords are strongest.</span>
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Creating…" : "Create account"}
            </button>
          </form>
        </div>

        <div className="card table-wrap admin-table">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Clients</h2>
            <p className="admin-card-sub">
              {visibleOrgs ? `${visibleOrgs.length} workspace${visibleOrgs.length === 1 ? "" : "s"}` : "Loading…"}
            </p>
          </div>
          {!visibleOrgs ? (
            <div className="skeleton-block" aria-label="Loading clients" />
          ) : visibleOrgs.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No clients yet</p>
              <p className="empty-sub">Create the first client account to provision a workspace.</p>
            </div>
          ) : (
            <table className="table">
              {/* Owner bug report 2026-08-15 — explicit column widths so the
                  fixed-layout table never squeezes the billing controls or
                  the action buttons: name/meta flexible, numeric/badge
                  columns compact, billing + actions wide enough for their
                  controls. (The form now sits above; the table is full
                  width.) */}
              <colgroup>
                <col style={{ width: "25%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "25%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Clients</th>
                  <th className="num">Members</th>
                  <th className="num">Client records</th>
                  <th>Created</th>
                  <th>Billing $</th>
                  <th className="actions-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrgs.map((o) => {
                  return (
                    <tr key={o.id}>
                      <td className="cell-strong" data-label="Clients">
                        <div className="cell-company">
                          <span className={`cell-name${blurPii(pii)}`} title={o.name}>
                            {o.name}
                          </span>
                          {o.provisionedFromClient && (
                            <span
                              className="chip chip-provisioned"
                              title="This workspace was auto-created when a sold lead moved into the Sold stage"
                            >
                              auto-provisioned
                            </span>
                          )}
                          {o.status === "canceled" && (
                            <span
                              className="chip chip-archived"
                              title={o.retentionUntil ? `Canceled — data retained until ${o.retentionUntil.slice(0, 10)}` : "Canceled — data retained 30 days"}
                            >
                              canceled
                            </span>
                          )}
                        </div>
                        {/* 3g-3 — for auto-provisioned orgs: the source lead
                            name + the login credentials the owner hands over.
                            The temp password disappears once the member's
                            first login clears it. */}
                        {o.provisionedFromClient && (
                          <div className="prov-row-meta">
                            <p className="prov-row-line">
                              New — auto-provisioned from sold lead ·{" "}
                              <b>{o.provisionedFromClientName || "—"}</b>
                            </p>
                            <p className="prov-row-line">
                              Login: <code>{o.loginEmail}</code>
                              {o.tempPassword ? (
                                <>
                                  {" "}· Temp password: <code>{o.tempPassword}</code>
                                </>
                              ) : (
                                <span className="cell-muted">
                                  {" "}· password delivered — member has logged in
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                        {/* 3k — an Admin-tab reset temp password while
                            undelivered: shown for ANY org (not just
                            auto-provisioned), cleared on first login. */}
                        {o.resetPassword && (
                          <p className="prov-row-line">
                            Reset password: <code>{o.resetPassword}</code>{" "}
                            <span className="cell-muted">· shown until the client signs in</span>
                          </p>
                        )}
                      </td>
                      <td className="num" data-label="Members">
                        {o.userCount}
                      </td>
                      <td className="num" data-label="Client records">
                        {o.clientCount}
                      </td>
                      <td data-label="Created">{fmtDate(o.createdAt)}</td>
                      <td data-label="Billing $">
                        <div className="admin-billing-edit">
                          <div className="admin-billing-inputs">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              className="billing-amount"
                              value={billingDraftFor(o).amount}
                              onChange={(e) =>
                                setBillingDraft((prev) => ({
                                  ...prev,
                                  [o.id]: { amount: e.target.value },
                                }))
                              }
                              aria-label={`${o.name} monthly billing amount (Phase 5)`}
                            />
                          </div>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={savingBillingId !== null || viewingOrgId !== null || resettingOrgId !== null}
                            onClick={() => handleSaveBilling(o)}
                          >
                            {savingBillingId === o.id ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </td>
                      <td data-label="Actions">
                        <div className="row-actions">
                          <button
                            className="btn btn-primary btn-sm"
                            title="Open this workspace as the client sees it"
                            aria-label={`View ${o.name} account`}
                            disabled={viewingOrgId !== null || resettingOrgId !== null}
                            onClick={() => handleViewAccount(o)}
                          >
                            {viewingOrgId === o.id ? "Opening…" : "View account"}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Generate a new temporary password for this client"
                            aria-label={`Reset ${o.name} password`}
                            disabled={viewingOrgId !== null || resettingOrgId !== null}
                            onClick={() => handleResetPassword(o)}
                          >
                            {resettingOrgId === o.id ? "Resetting…" : "Reset password"}
                          </button>
                          <button
                            className="icon-btn danger"
                            title="Delete this client account"
                            aria-label={`Delete ${o.name}`}
                            disabled={viewingOrgId !== null || resettingOrgId !== null}
                            onClick={() => setDeleting(o)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Owner direction 2026-08-17 — Agreements section under Administration.
          The agreement template editor MOVED here from Settings (one home, no
          duplicate). The textarea is a fixed-height scroll box (see
          .agree-template-input in styles.css) so the long legal template
          (~20 000 chars) scrolls instead of stretching the page. Owner
          workspace only. */}
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

      {deleting && (
        <ConfirmDeleteModal
          title="Delete this workspace?"
          entity={deleting.name}
          note={
            <p className="confirm-delete-note">
              The client's login, clients, tasks and invoices will all be removed with it.
            </p>
          }
          confirmLabel="Delete workspace"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}

      {/* 3k — the fresh temp password from the Admin "Reset password" action,
          shown once so the owner can hand it to the client securely. */}
      {resetResult && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Password reset">
          <div className="modal modal-sm">
            <div className="modal-head">
              <h2>Password reset</h2>
              <button className="icon-btn" onClick={() => setResetResult(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="confirm-body">
              <p className="confirm-delete-msg">
                <strong className={pii ? "pii-blur" : undefined}>{resetResult.orgName}</strong> has a new temporary password.
              </p>
              <p className="created-line">
                Login: <code className={pii ? "pii-blur" : undefined}>{resetResult.email}</code>
              </p>
              <p className="created-line">
                Temp password: <code>{resetResult.password}</code>
              </p>
              <p className="created-hint">
                Share it with the client securely (not by email). It is also shown on the Admin
                list until they sign in.
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setResetResult(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
