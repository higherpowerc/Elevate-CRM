import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { fmtDate, type Org, type RevenueModel } from "./types";
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
  /** 3f-1: the business type picker — "general" = no preset (current
   *  behavior); any vertical seeds stages + custom fields for the new org. */
  const [vertical, setVertical] = useState("general");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    orgName: string;
    email: string;
    password: string;
    verticalLabel: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  /* Delete-tenant confirm */
  const [deleting, setDeleting] = useState<Org | null>(null);

  /* Owner request 2026-08-14 — per-account MRR + revenue model: an inline
     draft editor per org row, saved to the server via PATCH. */
  const [billingDraft, setBillingDraft] = useState<
    Record<number, { amount: string; model: RevenueModel }>
  >({});
  const [savingBillingId, setSavingBillingId] = useState<number | null>(null);

  function billingDraftFor(o: Org) {
    const d = billingDraft[o.id];
    if (d) return d;
    return {
      amount: String(o.monthlySubscriptionAmount ?? 0),
      model: (o.revenueModel ?? "sales") as RevenueModel,
    };
  }

  async function handleSaveBilling(o: Org) {
    const d = billingDraftFor(o);
    const amount = Number(d.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Monthly subscription amount must be a non-negative number.");
      return;
    }
    setSavingBillingId(o.id);
    setError(null);
    try {
      await api.adminUpdateOrg(o.id, { monthlySubscriptionAmount: amount, revenueModel: d.model });
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

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    setBusy(true);
    try {
      const { org, user } = await api.adminCreateOrg({
        name: name.trim(),
        email: email.trim(),
        password,
        vertical,
      });
      setCreated({ orgName: org.name, email: user.email, password, verticalLabel: verticalLabel(vertical) });
      setName("");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      setVertical("general");
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
            Client <em className="serif">accounts</em>
          </h1>
          <p className="page-sub">
            Provision private workspaces — each client logs in and sees only their own data.
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

          {created && (
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
                Share the temp password with the client securely (not by email). It is shown
                only here, right after creation.
              </p>
            </div>
          )}

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
                The new workspace is pre-configured for this business — its pipeline stages and
                custom fields are seeded automatically. The client can rename, reorder or remove
                anything later in Settings.
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
              {orgs ? `${orgs.length} workspace${orgs.length === 1 ? "" : "s"}` : "Loading…"}
            </p>
          </div>
          {!orgs ? (
            <div className="skeleton-block" aria-label="Loading clients" />
          ) : orgs.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No clients yet</p>
              <p className="empty-sub">Create the first client account to provision a workspace.</p>
            </div>
          ) : (
            <table className="table">
              <colgroup>
                <col style={{ width: "33%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "23%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Clients</th>
                  <th className="num">Members</th>
                  <th className="num">Client records</th>
                  <th>Created</th>
                  <th>Monthly $ / model</th>
                  <th className="actions-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => {
                  const isOwner = o.id === ownerOrgId;
                  return (
                    <tr key={o.id}>
                      <td className="cell-strong" data-label="Clients">
                        <div className="cell-company">
                          <span className={`cell-name${blurPii(pii)}`} title={o.name}>
                            {o.name}
                          </span>
                          {isOwner && <span className="chip chip-owner">owner</span>}
                          {o.provisionedFromClient && (
                            <span
                              className="chip chip-provisioned"
                              title="This workspace was auto-created when a sold lead moved into the Sold stage"
                            >
                              auto-provisioned
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
                      <td data-label="Monthly $ / model">
                        {isOwner ? (
                          <span className="cell-muted">—</span>
                        ) : (
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
                                    [o.id]: { ...billingDraftFor(o), amount: e.target.value },
                                  }))
                                }
                                aria-label={`${o.name} monthly subscription amount`}
                              />
                              <select
                                className="billing-model"
                                value={billingDraftFor(o).model}
                                onChange={(e) =>
                                  setBillingDraft((prev) => ({
                                    ...prev,
                                    [o.id]: {
                                      ...billingDraftFor(o),
                                      model: e.target.value as RevenueModel,
                                    },
                                  }))
                                }
                                aria-label={`${o.name} revenue model`}
                              >
                                <option value="sales">Sales</option>
                                <option value="subscription">Subscriptions</option>
                              </select>
                            </div>
                            <button
                              className="btn btn-ghost btn-sm"
                              disabled={savingBillingId !== null || viewingOrgId !== null || resettingOrgId !== null}
                              onClick={() => handleSaveBilling(o)}
                            >
                              {savingBillingId === o.id ? "Saving…" : "Save"}
                            </button>
                          </div>
                        )}
                      </td>
                      <td data-label="Actions">
                        <div className="row-actions">
                          {isOwner ? (
                            <span
                              className="cell-muted"
                              title="The owner workspace cannot be deleted"
                            >
                              —
                            </span>
                          ) : (
                            <>
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
                            </>
                          )}
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
