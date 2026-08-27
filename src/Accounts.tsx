import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { fmtDate, money, type Client, type Org } from "./types";
import { PACKAGE_TIERS, TIER_LABELS, TIER_SHORT_LABELS, type PackageTier } from "./types";
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

/** Client-account management (owner 2026-08-18 live-test reorg): the OWNER's
 *  Clients tab is the single hub for account management, so the account panel
 *  that used to live in src/Admin.tsx (Administration) relocated here. It is
 *  rendered by the owner's Clients tab only. The per-account billing column
 *  is gone (amounts are Phase 5 prep only — they are no longer surfaced in
 *  the UI; the PATCH endpoint stays for Phase 5). The accounts table is
 *  exactly 5 columns — Clients | Members | Client records | Created | Actions
 *  — with an explicit fixed-layout colgroup so no column cuts off (Clients
 *  fits the business name, Actions fits the three buttons). */
export default function Accounts({ ownerOrgId, onViewAccount }: Props) {
  /* Global privacy eye (2026-08-14 owner request) — blur PII (client/company names, phone, email, address) here too. */
  const pii = usePii();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  /** Owner request 2026-08-26 — deal value per client account, keyed by
   *  org id. Built by joining each account (org) to its linked client record
   *  (client.provisionedOrgId === org.id) and reading the client's dealValue.
   *  Owner-only by construction: /api/clients is org-scoped and Accounts is
   *  rendered in the owner's workspace. */
  const [dealValueByOrg, setDealValueByOrg] = useState<Record<number, number>>({});
  /** Owner 2026-08-27 — the linked owner-org client record per org id (the
   *  Edit-account modal's prefill + PUT target). Owner-only by construction:
   *  /api/clients is org-scoped and this section renders in the owner's
   *  workspace only. */
  const [clientByOrg, setClientByOrg] = useState<Record<number, Client>>({});
  const [error, setError] = useState<string | null>(null);
  /* Owner 2026-08-27 — Edit account: the modal edits the LINKED owner-org
     client record (company name / phone / deal value) + renames the org so
     the Clients cell follows, and can generate a fresh agreement (upgrade
     path) without ever opening the tenant's CRM. */
  const [editing, setEditing] = useState<Org | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDeal, setEditDeal] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementNotice, setAgreementNotice] = useState<{
    kind: "success" | "warn";
    text: string;
    signUrl?: string;
  } | null>(null);
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
  /** Owner 2026-08-27 — the client package tier picked on the Create-account
   *  form ('' unset | tier1..4). Stored on the new account (org). */
  const [tier, setTier] = useState<PackageTier>("");
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
  /* Owner request 2026-08-25 — billing cycle date per client account: an
     inline-editable "Billing cycle" column on the Client accounts table. */
  const [editingBillingOrgId, setEditingBillingOrgId] = useState<number | null>(null);
  const [savingBillingOrgId, setSavingBillingOrgId] = useState<number | null>(null);
  const [billingDraft, setBillingDraft] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ orgs }, { clients }] = await Promise.all([api.adminOrgs(), api.clients(true)]);
      setOrgs(orgs);
      // Join each account (org) to its linked client via provisionedOrgId so
      // the Deal value column can read the client's dealValue. Missing/never
      // auto-provisioned links simply stay unset and render "—".
      const map: Record<number, number> = {};
      // Owner 2026-08-27 — the Edit-account modal needs the whole linked
      // record (id to PUT, companyName/phone/dealValue to prefill, email for
      // the agreement). Same join, same owner-org scope as the deal values.
      const byOrg: Record<number, Client> = {};
      for (const c of clients) {
        if (c.provisionedOrgId) {
          map[c.provisionedOrgId] = c.dealValue;
          byOrg[c.provisionedOrgId] = c;
        }
      }
      setDealValueByOrg(map);
      setClientByOrg(byOrg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load client accounts.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  /* Owner request 2026-08-25 — save the inline "Billing cycle" date for a
     client account via the owner-only admin PATCH (extended to accept
     billingCycleDate) and reload so the table shows the persisted value. An
     empty value clears the date back to unset. */
  async function handleSaveBillingCycle(o: Org, value: string) {
    setSavingBillingOrgId(o.id);
    try {
      await api.adminUpdateOrg(o.id, { billingCycleDate: value });
      setEditingBillingOrgId(null);
      setBillingDraft("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save billing cycle date.");
    } finally {
      setSavingBillingOrgId(null);
    }
  }

  /* Owner direction 2026-08-15 — the client-account list is for CLIENT
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
        tier,
      });
      setCreated({ orgName: org.name, email: user.email, password, verticalLabel: verticalLabel(vertical), emailStatus, emailError });
      setName("");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      setVertical("b2b");
      setTier("");
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
     comes back once, in the modal; it also stays on the accounts list until
     the client's first successful login clears it. */
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

  /* ── Edit account (owner 2026-08-27) ──────────────────────────────────── */
  /** The owner-org client record linked to the account being edited (null
   *  when the account has none — its row shows no deal value either). */
  const editingLinked = editing ? clientByOrg[editing.id] ?? null : null;

  function openEdit(o: Org) {
    const linked = clientByOrg[o.id];
    setEditing(o);
    setEditError(null);
    setAgreementNotice(null);
    // Prefill from the linked owner-org client record; fall back to the org
    // name for accounts without a link (fields stay disabled there).
    setEditName(linked ? linked.companyName : o.name);
    setEditPhone(linked ? linked.phone : "");
    setEditDeal(linked ? String(linked.dealValue ?? 0) : "");
  }

  /** Save: PUT the linked owner-org client record (name / phone / deal value)
   *  and rename the org in step so the Clients cell reflects the edit. The
   *  PUT target is safe by construction — clientByOrg is joined from the
   *  OWNER org's own /api/clients (org-scoped server-side too) and only
   *  records whose provisionedOrgId === the selected org's id land in it.
   *  The tenant's CRM data is never touched. */
  async function handleSaveEdit() {
    if (!editing || !editingLinked) return;
    const companyName = editName.trim();
    if (!companyName) {
      setEditError("Account name is required.");
      return;
    }
    const trimmedDeal = editDeal.trim();
    const dealValue = trimmedDeal === "" ? 0 : Number(trimmedDeal);
    if (!Number.isFinite(dealValue) || dealValue < 0) {
      setEditError("Deal value must be a non-negative number.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await api.updateClient(editingLinked.id, {
        companyName,
        clientType: editingLinked.clientType,
        phone: editPhone.trim(),
        dealValue,
      });
      // The org name IS the visible account name (the Clients cell renders
      // o.name) — rename it through the owner-only PATCH so the table follows.
      await api.adminUpdateOrg(editing.id, { name: companyName });
      setEditing(null);
      await load(); // re-join: Deal value column + Clients cell + prefill data
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setEditBusy(false);
    }
  }

  /** Generate a fresh agreement for the LINKED owner-org client (the upgrade
   *  path): mints a new sign token + emails the /sign link. The server
   *  rejects clients without an email — that error is surfaced as-is. */
  async function handleGenerateAgreement() {
    if (!editing || !editingLinked) return;
    setAgreementBusy(true);
    setAgreementNotice(null);
    setEditError(null);
    try {
      const r = await api.sendAgreement(editingLinked.id);
      if (r.emailStatus === "sent") {
        setAgreementNotice({
          kind: "success",
          text: `Agreement sent to ${r.emailTo} — the sign link is valid for 30 days.`,
        });
      } else {
        // The envelope exists and the link was minted — only the email failed.
        // Never show a green "sent"; hand the owner the URL to forward.
        setAgreementNotice({
          kind: "warn",
          text: `Agreement link generated, but the email failed to send: ${r.emailError ?? "unknown error"}`,
          signUrl: r.signUrl,
        });
      }
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Agreement send failed.");
    } finally {
      setAgreementBusy(false);
    }
  }

  /* Esc closes the Edit-account modal (same as every other modal). */
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  return (
    <div className="accounts-section">
      <div className="page-head accounts-head">
        <div>
          <h2>Accounts</h2>
          <p className="page-sub">
            Client workspaces — provision a new one, view a client's CRM, reset a password, or delete an account.
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
            <h3 className="admin-card-title">Create client account</h3>
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
              <span className="field-label">Package tier</span>
              <select value={tier} onChange={(e) => setTier(e.target.value as PackageTier)}>
                <option value="">— No tier —</option>
                {PACKAGE_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABELS[t]}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                The client's package tier (Website / +CRM / +Lead gen / Custom). It flows to the
                account and drives Services tags + the onboarding checklist. Pricing is set at
                charge time.
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
            <h3 className="admin-card-title">Client accounts</h3>
            <p className="admin-card-sub">
              {visibleOrgs ? `${visibleOrgs.length} workspace${visibleOrgs.length === 1 ? "" : "s"}` : "Loading…"}
            </p>
          </div>
          {!visibleOrgs ? (
            <div className="skeleton-block" aria-label="Loading client accounts" />
          ) : visibleOrgs.length === 0 ? (
            <div className="empty">
              <p className="empty-title">No client accounts yet</p>
              <p className="empty-sub">Create the first client account to provision a workspace.</p>
            </div>
          ) : (
            <table className="table">
              {/* Owner live-test reorg 2026-08-18 + billing cycle (owner request
    2026-08-25) + deal value (owner request 2026-08-26) — the accounts table
    has SEVEN columns (Clients | Members | Client records | Created | Billing
    cycle | Deal value | Actions). Explicit fixed-layout widths so nothing
    truncates: Clients (23%) fits the business name + meta lines, numeric/badge
    columns compact (7/9/10), Created (11%), Billing cycle (13%) fits the value
    line + inline editable date input, and Actions (27%) is wide enough for View
    account / Reset password / Delete without clipping (flex-wrap guards). */}
<colgroup>
  <col style={{ width: "23%" }} />
  <col style={{ width: "7%" }} />
  <col style={{ width: "9%" }} />
  <col style={{ width: "11%" }} />
  <col style={{ width: "13%" }} />
  <col style={{ width: "10%" }} />
  <col style={{ width: "27%" }} />
</colgroup>
              <thead>
                <tr>
                  <th>Clients</th>
                  <th className="num">Members</th>
                  <th className="num">Client records</th>
                  <th>Created</th>
                  <th>Billing cycle</th>
                  <th className="num">Deal value</th>
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
                          {o.tier ? (
                            <span
                              className="chip chip-tier"
                              title={TIER_LABELS[o.tier] ?? o.tier}
                            >
                              {TIER_SHORT_LABELS[o.tier] ?? o.tier}
                            </span>
                          ) : null}
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
                        {/* 3k — a reset temp password while undelivered: shown
                            for ANY org (not just auto-provisioned), cleared on
                            first login. */}
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
                      <td data-label="Billing cycle">
                        {editingBillingOrgId === o.id ? (
                          <input
                            type="date"
                            className="billing-date-input"
                            value={billingDraft}
                            onChange={(e) => setBillingDraft(e.target.value)}
                            onBlur={() => handleSaveBillingCycle(o, billingDraft)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveBillingCycle(o, billingDraft);
                              if (e.key === "Escape") setEditingBillingOrgId(null);
                            }}
                            disabled={savingBillingOrgId === o.id}
                            aria-label={`Billing cycle date for ${o.name}`}
                          />
                        ) : (
                          <span className="billing-cycle-cell">
                            <span className="billing-cycle-value" title="Monthly subscription value">
                              {(o.monthlySubscriptionAmount ?? 0) > 0
                                ? `${money(o.monthlySubscriptionAmount)}/mo`
                                : <span className="cell-muted">&mdash;</span>}
                            </span>
                            <span className="billing-cycle-date-line">
                              {o.billingCycleDate ? (
                                fmtDate(o.billingCycleDate)
                              ) : (
                                <span className="cell-muted">&mdash;</span>
                              )}{" "}
                              <button
                                type="button"
                                className="icon-btn btn-sm"
                                title="Set billing cycle date"
                                aria-label={`Set billing cycle date for ${o.name}`}
                                onClick={() => {
                                  setEditingBillingOrgId(o.id);
                                  setBillingDraft(o.billingCycleDate || "");
                                }}
                                disabled={savingBillingOrgId !== null}
                              >
                                &#9998;
                              </button>
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="num" data-label="Deal value">
                        {dealValueByOrg[o.id] ? (
                          money(dealValueByOrg[o.id])
                        ) : (
                          <span className="cell-muted">&mdash;</span>
                        )}
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
                            className="btn btn-ghost btn-sm"
                            title="Edit this account's name, phone and deal value — or generate a new agreement"
                            aria-label={`Edit ${o.name} account`}
                            disabled={viewingOrgId !== null || resettingOrgId !== null}
                            onClick={() => openEdit(o)}
                          >
                            Edit
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

      {/* 3k — the fresh temp password from the "Reset password" action,
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
                Share it with the client securely (not by email). It is also shown on the Clients →
                Accounts list until they sign in.
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

      {/* Owner 2026-08-27 — Edit account: edits the LINKED owner-org client
          record (company name / phone / deal value) + renames the account
          (org) in step, and generates a fresh agreement for upgrades. The
          tenant's CRM is never opened or modified. Accounts WITHOUT a linked
          client record show disabled fields + a note (there is no owner-org
          client to edit and no agreement recipient). */}
      {editing && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Edit account">
          <div className="modal modal-sm">
            <div className="modal-head">
              <h2>Edit account</h2>
              <button className="icon-btn" onClick={() => setEditing(null)} aria-label="Close" disabled={editBusy}>
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEdit();
              }}
              className="form modal-form"
            >
              {editError && (
                <div className="alert alert-error" role="alert">
                  {editError}
                </div>
              )}
              {editingLinked ? (
                <>
                  <label className="field">
                    <span className="field-label">Company / account name</span>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={200}
                      required
                      aria-label="Company / account name"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Phone number</span>
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      maxLength={40}
                      className={pii ? "pii-blur" : undefined}
                      aria-label="Phone number"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Deal value ($)</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={editDeal}
                      onChange={(e) => setEditDeal(e.target.value)}
                      aria-label="Deal value in dollars"
                    />
                  </label>
                  <p className="field-hint">
                    Edits the client's own record in your workspace — the account's CRM data is not touched.
                  </p>
                  <div className="field intake-block">
                    <span className="field-label">Agreement</span>
                    <div className="password-row">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={handleGenerateAgreement}
                        disabled={agreementBusy || editBusy}
                      >
                        {agreementBusy ? "Generating…" : "Generate new agreement"}
                      </button>
                    </div>
                    <span className="field-hint">
                      Mints a fresh sign link and emails it to the client — use it after an upgrade or re-scope.
                    </span>
                    {agreementNotice && (
                      <div className={agreementNotice.kind === "success" ? "alert alert-success" : "alert alert-warn"} role="status">
                        <p className="created-line">{agreementNotice.text}</p>
                        {agreementNotice.signUrl && (
                          <p className="created-line">
                            Sign link: <code>{agreementNotice.signUrl}</code>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)} disabled={editBusy}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={editBusy || agreementBusy}>
                      {editBusy ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="alert alert-warn" role="status">
                    <p className="created-line">No linked client record.</p>
                    <p className="created-hint">
                      This account is not linked to a client record in your workspace, so its name, phone and
                      deal value are managed on the client record once the account is linked — and there is no
                      one to generate an agreement for yet.
                    </p>
                  </div>
                  <label className="field">
                    <span className="field-label">Company / account name</span>
                    <input value={editName} disabled aria-label="Company / account name (no linked client record)" />
                  </label>
                  <label className="field">
                    <span className="field-label">Phone number</span>
                    <input value="" disabled aria-label="Phone number (no linked client record)" />
                  </label>
                  <label className="field">
                    <span className="field-label">Deal value ($)</span>
                    <input type="number" min={0} value="" disabled aria-label="Deal value (no linked client record)" />
                  </label>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                      Close
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}