import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type InvoiceInput } from "./api";
import { usePii, blurPii } from "./pii";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_TONE,
  fmtDate,
  invoiceStatusLabel,
  money,
  type Client,
  type Invoice,
  type InvoiceStatus,
} from "./types";
import InvoiceModal from "./InvoiceModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import SearchableSelect from "./SearchableSelect";

type Filter = "all" | InvoiceStatus;

/** Local YYYY-MM-DD so `<input type="date">` values compare correctly. */
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Overdue is computed, not stored: a sent invoice past its due date. */
function isOverdue(inv: Invoice): boolean {
  return inv.status === "sent" && !!inv.dueDate && inv.dueDate < localToday();
}

export default function Finance({ canEdit = true, ownerOrg = false }: { canEdit?: boolean; ownerOrg?: boolean }) {
  /* Team-users UI (owner request 2026-08-14) — false for a restricted member
     with view-only "finance" access: the add/status/edit/delete affordances
     are hidden (the server still 403s any write). Owner and org admins
     always pass true. */
  /* Global privacy eye (2026-08-14 owner request) — blur PII (client/company names, phone, email, address) here too. */
  const pii = usePii();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // Quick-add row
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("draft");
  const amountRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ invoices }, { clients }] = await Promise.all([api.invoices(), api.clients(true)]);
      setInvoices(invoices);
      setClients(clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoices.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (!invoices) return [];
    const q = query.trim().toLowerCase();
    return invoices.filter((i) => {
      const matchFilter = filter === "all" || i.status === filter;
      if (!matchFilter) return false;
      if (!q) return true;
      // Match by client name (case-insensitive); invoices with no client
      // surface only under the "unassigned" keyword.
      if (i.clientName) return i.clientName.toLowerCase().includes(q);
      return q === "unassigned";
    });
  }, [invoices, filter, query]);

  /** Clients whose name matches the search query — used to hint the empty
   *  state when a search finds no invoices but does match a client. */
  const clientMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return clients.filter((c) => c.companyName.toLowerCase().includes(q));
  }, [clients, query]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: invoices?.length ?? 0, draft: 0, sent: 0, paid: 0 };
    if (invoices) {
      for (const i of invoices) c[i.status] += 1;
    }
    return c;
  }, [invoices]);

  const totals = useMemo(() => {
    let invoiced = 0;
    let paid = 0;
    let outstanding = 0;
    let overdue = 0;
    if (invoices) {
      for (const i of invoices) {
        invoiced += i.amount;
        if (i.status === "paid") paid += i.amount;
        if (i.status === "sent") {
          outstanding += i.amount;
          if (isOverdue(i)) overdue += i.amount;
        }
      }
    }
    return { invoiced, paid, outstanding, overdue };
  }, [invoices]);

  /* ── Finance cockpit / reporting (backlog a8241fea) ─────────────────────
   * Owner-only analytics over the SAME data already on this tab (invoices +
   * the owner's client records). Every figure is computed from real recorded
   * product records — never projections. HONESTY: the business is still in
   * Stripe TEST mode (no live charges — charging is gated on wiring keys/
   * webhook + attorney review), so revenue is labeled "based on invoices
   * recorded" and never presented as live charge revenue. Owned by the owner
   * workspace (ownerOrg); tenants never see any of it. */

  /** Subscription MRR — the org's OWN subscription book: the sum of
   *  `monthlyAmount` over the owner's ACTIVE (non-lost, non-archived) client
   *  records. Complements (does not replace) the dashboard's "Sold MRR" KPI,
   *  which is deal-value based. */
  const subscriptionMrr = useMemo(() => {
    if (!ownerOrg) return { mrr: 0, activeCount: 0 };
    // Active = not lost, not archived, and NOT orphaned: a sold client whose
    // account (org) was deleted must never count toward Subscription MRR
    // (owner 2026-08-26 incident guard — orphaned records must not inflate MRR).
    const active = clients.filter((c) => !c.lost && !c.archived && !c.orphanedAccount);
    const mrr = active.reduce((s, c) => s + (Number(c.monthlyAmount) || 0), 0);
    return { mrr, activeCount: active.length };
  }, [ownerOrg, clients]);

  /** Revenue by client — sums the ledger's invoices per client (invoiced ·
   *  paid · outstanding), with that client's monthlyAmount as context.
   *  Unassigned invoices roll up under a single "Unassigned" row. */
  const revenueByClient = useMemo(() => {
    if (!invoices) return [];
    const map = new Map<
      string,
      { name: string; clientId: number | null; monthlyAmount: number; invoiced: number; paid: number; outstanding: number }
    >();
    for (const i of invoices) {
      const key = i.clientId != null ? `c:${i.clientId}` : `u:${i.clientName || ""}`;
      let row = map.get(key);
      if (!row) {
        const c = i.clientId != null ? clients.find((x) => x.id === i.clientId) : undefined;
        row = {
          name: i.clientName || "Unassigned",
          clientId: i.clientId ?? null,
          monthlyAmount: c ? Number(c.monthlyAmount) || 0 : 0,
          invoiced: 0,
          paid: 0,
          outstanding: 0,
        };
        map.set(key, row);
      }
      row.invoiced += i.amount;
      if (i.status === "paid") row.paid += i.amount;
      if (i.status === "sent") row.outstanding += i.amount;
    }
    return Array.from(map.values()).sort((a, b) => b.invoiced - a.invoiced);
  }, [invoices, clients]);

  /** Lost / churned — every owner client that is explicitly lost (lost=true,
   *  with lostReason), a demo that ended "not_sold", and the harsher subset:
   *  clients who were signed/paid (real accounts) and have since been lost —
   *  i.e. churned. Each row carries a reason + kind tag. */
  const lostChurned = useMemo(() => {
    if (!ownerOrg) return [];
    return clients.filter((c) => c.lost || c.demoOutcome === "not_sold").map((c) => {
      if (c.lost && (c.agreementStatus === "signed" || c.paymentStatus === "paid")) {
        return {
          client: c,
          kind: "churned" as const,
          reason: c.lostReason ? `${c.lostReason} · was a signed/paid client` : "Was a signed/paid client — churned",
        };
      }
      if (c.lost) {
        return { client: c, kind: "lost" as const, reason: c.lostReason || "Marked lost" };
      }
      return { client: c, kind: "not_sold" as const, reason: "Demo call — not sold" };
    });
  }, [ownerOrg, clients]);

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    const a = Number(amount);
    if (!amount.trim() || !Number.isFinite(a) || a <= 0) {
      setError("Amount must be a positive number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createInvoice({
        clientId: clientId === "" ? null : Number(clientId),
        amount: a,
        status,
        dueDate: dueDate.trim(),
      });
      setClientId("");
      setAmount("");
      setDueDate("");
      setStatus("draft");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(inv: Invoice, next: InvoiceStatus) {
    setBusy(true);
    setError(null);
    try {
      await api.updateInvoice(inv.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(data: Partial<InvoiceInput>, editing: Invoice) {
    setBusy(true);
    setError(null);
    try {
      await api.updateInvoice(editing.id, data);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteInvoice(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  /* Phase 5 — Stripe billing for client accounts (owner direction
     2026-08-18). Owner workspace only (ownerOrg prop). "Bill this account"
     creates a Stripe Payment Link at the owner-entered amount (no hard-coded
     rates) and emails it; a Stripe webhook auto-flips the Payment column to
     paid + emails the invoice PDF; "Mark paid" stays as the manual fallback. */
  const [billClientId, setBillClientId] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billInterval, setBillInterval] = useState<"month" | "one_time">("month");
  const [billResult, setBillResult] = useState<{
    url: string;
    amountCents: number;
    emailTo: string;
    emailStatus: string;
    emailError?: string;
  } | null>(null);
  const [billNotice, setBillNotice] = useState<{ kind: "success" | "warn"; text: string } | null>(null);

  async function handleBill(e: FormEvent) {
    e.preventDefault();
    const a = Number(billAmount);
    if (!billClientId || !billAmount.trim() || !Number.isFinite(a) || a <= 0) {
      setError("Choose a client and enter a payment amount in dollars.");
      return;
    }
    setBusy(true);
    setError(null);
    setBillNotice(null);
    setBillResult(null);
    try {
      const r = await api.clientPaymentLink(Number(billClientId), { amount: a, interval: billInterval });
      setBillResult({
        url: r.url,
        amountCents: r.amountCents,
        emailTo: r.emailTo,
        emailStatus: r.emailStatus,
        emailError: r.emailError,
      });
      setBillNotice({
        kind: "success",
        text: `Payment link sent to ${r.emailTo} — when the client pays, the bill flips to Paid automatically.`,
      });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("This client's agreement must be signed before billing them.");
      } else if (err instanceof ApiError && err.status === 503) {
        setBillNotice({
          kind: "warn",
          text: "Stripe is not connected yet. Once Stripe keys are added this form will create + email the payment link.",
        });
      } else {
        setError(err instanceof Error ? err.message : "Could not create the payment link.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkPaid(c: Client) {
    setBusy(true);
    setError(null);
    try {
      await api.clientPaymentPaid(c.id);
      /* Notice lands in the Stripe status window (where the action lives). */
      setPendingNotice({ kind: "success", text: `Payment recorded for ${c.companyName} — column shows Paid.` });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark the payment as received.");
    } finally {
      setBusy(false);
    }
  }

  /** Owner-only list of billed clients (paymentStatus !== none) — the live
   *  Stripe status readout on the Finance tab. */
  const bills = useMemo(
    () => (ownerOrg ? clients.filter((c) => c.paymentStatus && c.paymentStatus !== "none") : []),
    [ownerOrg, clients],
  );

  /* Owner workflow views (2026-08-25) — "Pending payment": clients who signed
     the agreement but have NOT paid yet (paymentStatus !== 'paid'), regardless
     of whether a workspace has been built. This replaces the old "Signed ·
     account pending" card (that one wrongly required an account to exist).
     Per the owner's sales flow a signed agreement lands here immediately; the
     Clients-tab "Paid but unbuilt" window handles account building. Lost
     clients are excluded. Each row sends the client a Stripe payment link via
     POST /api/clients/:id/payment-link (which returns 503 "Stripe not
     configured" until the owner wires the Stripe keys). */
  const pendingPayment = useMemo(
    () =>
      ownerOrg
        ? clients.filter((c) => c.agreementStatus === "signed" && c.paymentStatus !== "paid" && !c.lost)
        : [],
    [ownerOrg, clients],
  );
  /* Per-row amount inputs for the "Pending payment" window. Default each to the
     client's monthlyAmount when set; the row input is its own live value. */
  const [pendingAmounts, setPendingAmounts] = useState<Record<number, string>>({});
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [pendingNotice, setPendingNotice] = useState<{ kind: "success" | "warn"; text: string } | null>(null);
  async function handleSendPaymentLink(c: Client) {
    const raw = (pendingAmounts[c.id] ?? "").trim();
    const a = Number(raw);
    if (!raw || !Number.isFinite(a) || a <= 0) {
      setPendingNotice({
        kind: "warn",
        text: `Enter an amount for ${c.companyName} before sending the payment link.`,
      });
      return;
    }
    setSendingId(c.id);
    setPendingNotice(null);
    try {
      await api.clientPaymentLink(c.id, { amount: a, interval: "month" });
      setPendingNotice({
        kind: "success",
        text: `Payment link sent to ${c.companyName} — Stripe portal emailed.`,
      });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setPendingNotice({
          kind: "warn",
          text: "This client's agreement must be signed before sending a payment link.",
        });
      } else if (err instanceof ApiError && err.status === 503) {
        setPendingNotice({
          kind: "warn",
          text: "Stripe is not connected yet. Once Stripe keys are added, this will email the client the payment link.",
        });
      } else {
        setError(err instanceof Error ? err.message : "Could not send the payment link.");
      }
    } finally {
      setSendingId(null);
    }
  }
  const billFormRef = useRef<HTMLDivElement>(null);
  const billAmountRef = useRef<HTMLInputElement>(null);

  if (!invoices) {
    return error ? (
      <div className="alert alert-error">{error}</div>
    ) : (
      <div className="skeleton-block" aria-label="Loading invoices" />
    );
  }

  const totalCount = invoices.length;

  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>
            <em className="serif">Finance</em> ledger
          </h1>
          <p className="page-sub">
            {totalCount} invoice{totalCount === 1 ? "" : "s"} · {money(totals.outstanding)} outstanding
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="kpi-row kpi-row-4">
        <div className="card kpi">
          <span className="kpi-label">Total invoiced</span>
          <span className="kpi-value lime">{money(totals.invoiced)}</span>
          <span className="kpi-note">Draft + sent + paid amounts</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Paid</span>
          <span className="kpi-value green">{money(totals.paid)}</span>
          <span className="kpi-note">Marked paid — money in</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Outstanding</span>
          <span className="kpi-value">{money(totals.outstanding)}</span>
          <span className="kpi-note">Sent, not yet paid</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Overdue</span>
          <span className="kpi-value red">{money(totals.overdue)}</span>
          <span className="kpi-note">Sent, past due date</span>
        </div>
      </div>

      {/* Finance cockpit / reporting (backlog a8241fea) — OWNER-only analytics
          over real product records. The revenue figures are "based on invoices
          recorded" — the business is still in Stripe TEST mode, so nothing here
          represents live charge revenue (no Stripe charge is ever created from
          these figures). Tenants never render this section. */}
      {ownerOrg && (
        <section className="card cockpit" aria-label="Finance cockpit / reporting">
          <div className="page-head" style={{ marginBottom: "var(--stack-gap)" }}>
            <div>
              <h2 className="h3">
                Finance <em className="serif">cockpit</em>
              </h2>
              <p className="page-sub">
                Reporting over what you've recorded — revenue below is{" "}
                <strong>based on invoices recorded</strong>, not live charge revenue (Stripe is still in
                test mode).
              </p>
            </div>
          </div>

          <h3 className="cockpit-sub">
            Subscription MRR <span className="cockpit-sub-note">client monthlyAmount · active clients</span>
          </h3>
          <div className="kpi-row kpi-row-2">
            <div className="card kpi" aria-label="Subscription MRR">
              <span className="kpi-label">Subscription MRR</span>
              <span className="kpi-value lime">{money(subscriptionMrr.mrr)}</span>
              <span className="kpi-note">
                Sum of {subscriptionMrr.activeCount} active client{subscriptionMrr.activeCount === 1 ? "" : "s"}'
                monthlyAmount
              </span>
            </div>
            <div className="card kpi" aria-label="Active subscription clients">
              <span className="kpi-label">Active clients on a plan</span>
              <span className="kpi-value">{subscriptionMrr.activeCount}</span>
              <span className="kpi-note">Non-lost, non-archived records with a monthly plan</span>
            </div>
          </div>

          <h3 className="cockpit-sub">
            Revenue by client <span className="cockpit-sub-note">per invoice · monthlyAmount context</span>
          </h3>
          {revenueByClient.length === 0 ? (
            <p className="cockpit-empty">No invoiced clients yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="num">Monthly</th>
                    <th className="num">Invoiced</th>
                    <th className="num">Paid</th>
                    <th className="num">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueByClient.map((r) => (
                    <tr key={r.clientId ?? r.name}>
                      <td className="cell-strong">
                        <span className={`cell-name${blurPii(pii)}`}>{r.name}</span>
                      </td>
                      <td className="num cell-muted">{r.monthlyAmount > 0 ? money(r.monthlyAmount) + "/mo" : "—"}</td>
                      <td className="num cell-strong">{money(r.invoiced)}</td>
                      <td className="num cell-strong cockpit-paid">{money(r.paid)}</td>
                      <td className="num">{money(r.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="cockpit-sub">
            Lost / churned <span className="cockpit-sub-note">why accounts were lost</span>
          </h3>
          {lostChurned.length === 0 ? (
            <p className="cockpit-empty">No lost or churned clients recorded.</p>
          ) : (
            <ul className="inv-list" style={{ margin: 0 }}>
              {lostChurned.map(({ client: c, kind, reason }) => (
                <li key={c.id} className="inv">
                  <div className="inv-body">
                    <div className="inv-client">
                      <span className={`chip${blurPii(pii)}`}>{c.companyName}</span>
                      <span className={`badge ${kind === "churned" ? "tone-red" : kind === "lost" ? "tone-amber" : "tone-gray"}`}>
                        {kind === "churned" ? "Churned" : kind === "lost" ? "Lost" : "Not sold"}
                      </span>
                      <span className="inv-notes">{reason}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="inv-notes cockpit-foot">
            Owner-only view over your own invoices and client records — figures are never fabricated and no
            payment is charged from this screen.
          </p>
        </section>
      )}

      {ownerOrg && (
        <div className="card pending-bills">
          <div className="page-head" style={{ marginBottom: "var(--stack-gap)" }}>
            <div>
              <h2 className="h3">
                Stripe <em className="serif">status</em>
              </h2>
              <p className="page-sub">
                Payment tracker across your client accounts — who's signed but unpaid, and the live payment
                status of every billed account. Set an amount and click "Send payment link" to email the
                client the Stripe portal.
              </p>
            </div>
          </div>
          {pendingNotice && (
            <div
              className={pendingNotice.kind === "success" ? "alert alert-success" : "alert alert-warn"}
              role={pendingNotice.kind === "success" ? "status" : "alert"}
              style={{ marginBottom: "var(--stack-gap)" }}
            >
              {pendingNotice.text}
            </div>
          )}
          <h3 className="cockpit-sub">
            Pending payment <span className="cockpit-sub-note">agreement signed, not yet paid</span>
          </h3>
          {pendingPayment.length === 0 ? (
            <p className="cockpit-empty">No pending payments — every signed client has paid.</p>
          ) : (
            <ul className="inv-list" style={{ margin: 0 }}>
              {pendingPayment.map((c) => (
                <li key={c.id} className="inv">
                  <div className="inv-body">
                    <div className="inv-client">
                      <span className={`chip${blurPii(pii)}`}>{c.companyName}</span>
                      <span className="inv-notes">Signed · awaiting payment</span>
                    </div>
                  </div>
                  <div className="row-actions pending-pay-actions">
                    <div className="inv-add-amount">
                      <span className="inv-dollar" aria-hidden="true">
                        $
                      </span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        inputMode="decimal"
                        aria-label={`Payment amount for ${c.companyName}`}
                        placeholder="0.00"
                        value={pendingAmounts[c.id] ?? (c.monthlyAmount ? String(c.monthlyAmount) : "")}
                        onChange={(e) => setPendingAmounts((m) => ({ ...m, [c.id]: e.target.value }))}
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleSendPaymentLink(c)}
                      disabled={sendingId === c.id}
                    >
                      {sendingId === c.id ? "Sending…" : "Send payment link"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {bills.length > 0 && (
            <>
              <h3 className="cockpit-sub" style={{ marginTop: "var(--stack-gap)" }}>
                Billed accounts <span className="cockpit-sub-note">payment status</span>
              </h3>
              <ul className="inv-list" style={{ margin: 0 }}>
                {bills.map((c) => (
                  <li key={c.id} className="inv">
                    <div className="inv-body">
                      <div className="inv-client">
                        <span className={`chip${blurPii(pii)}`}>{c.companyName}</span>
                        <span className="inv-notes">
                          {c.paymentAmountCents ? money(c.paymentAmountCents / 100) : "—"}
                          {c.paymentStatus === "paid" && c.paidAt
                            ? ` · paid ${new Date(c.paidAt).toLocaleString()}`
                            : ""}
                        </span>
                      </div>
                      <div className="inv-meta">
                        <span
                          className={
                            c.paymentStatus === "paid" ? "badge tone-green" : "badge tone-amber"
                          }
                        >
                          {c.paymentStatus === "paid"
                            ? "Paid"
                            : c.paymentStatus === "sent"
                              ? "Sent"
                              : c.paymentStatus}
                        </span>
                        {c.paymentLinkUrl && (
                          <a
                            className="inv-due"
                            href={c.paymentLinkUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Stripe checkout link"
                          >
                            checkout ↗
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="row-actions">
                      {c.paymentStatus === "sent" && (
                        <button className="icon-btn" onClick={() => handleMarkPaid(c)} disabled={busy}>
                          Mark paid
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {canEdit && (
      <form className="card inv-add" onSubmit={handleQuickAdd}>
        <SearchableSelect
          piiBlur={pii}
          className="inv-add-client"
          value={clientId}
          onChange={setClientId}
          options={clients.map((c) => ({
            value: String(c.id),
            label: c.companyName + (c.archived ? " (archived)" : ""),
          }))}
          placeholder="Search clients…"
          ariaLabel="Invoice client"
          emptyLabel="No client"
        />
        <div className="inv-add-amount">
          <span className="inv-dollar" aria-hidden="true">
            $
          </span>
          <input
            type="number"
            ref={amountRef}
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-label="Invoice amount"
          />
        </div>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Invoice due date"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
          aria-label="Invoice status"
        >
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {invoiceStatusLabel(s)}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={busy}>
          Add
        </button>
      </form>
      )}

      {ownerOrg && canEdit && (
        <div className="card inv-add stripe-bill" ref={billFormRef}>
          <div className="page-head" style={{ marginBottom: "var(--stack-gap)" }}>
            <div>
              <h2 className="h3">
                <em className="serif">Bill</em> a client account
              </h2>
              <p className="page-sub">
                Create a Stripe payment link at the amount you set — the client pays on Stripe's
                checkout, the bill flips to Paid automatically, and the invoice is emailed.
              </p>
            </div>
          </div>
          <form className="inv-add-row" onSubmit={handleBill}>
            <SearchableSelect
              piiBlur={pii}
              className="inv-add-client"
              value={billClientId}
              onChange={setBillClientId}
              options={clients.map((c) => ({
                value: String(c.id),
                label: c.companyName + (c.archived ? " (archived)" : ""),
              }))}
              placeholder="Search clients…"
              ariaLabel="Billing client"
              emptyLabel="No client"
            />
            <div className="inv-add-amount">
              <span className="inv-dollar" aria-hidden="true">
                $
              </span>
              <input
                ref={billAmountRef}
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={billAmount}
                onChange={(e) => setBillAmount(e.target.value)}
                placeholder="0.00"
                aria-label="Billing amount"
              />
            </div>
            <select
              value={billInterval}
              onChange={(e) => setBillInterval(e.target.value as "month" | "one_time")}
              aria-label="Billing interval"
            >
              <option value="month">Monthly subscription</option>
              <option value="one_time">One-time invoice</option>
            </select>
            <button className="btn btn-primary" disabled={busy}>
              Bill this account
            </button>
          </form>
          {billResult && (
            <p className="inv-notes" style={{ marginTop: ".5rem" }}>
              Payment link sent to {billResult.emailTo} ({money(billResult.amountCents / 100)}
              {billInterval === "month" ? "/mo" : " one-time"}) ·{" "}
              <a href={billResult.url} target="_blank" rel="noreferrer">
                open checkout ↗
              </a>
              {billResult.emailError && <span className="tone-red"> · email failed: {billResult.emailError}</span>}
            </p>
          )}
          {billNotice && (
            <div
              className={billNotice.kind === "success" ? "alert alert-success" : "alert alert-warn"}
              role={billNotice.kind === "success" ? "status" : "alert"}
              style={{ marginTop: ".5rem" }}
            >
              {billNotice.text}
            </div>
          )}
        </div>
      )}

      <div className="toolbar">
        <div className="seg">
          {(["all", ...INVOICE_STATUSES] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? "seg-btn active" : "seg-btn"}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : invoiceStatusLabel(f)}
              <span className="seg-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search clients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
        />
      </div>

      {visible.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">
            {totalCount === 0
              ? "No invoices yet"
              : query.trim()
                ? "Nothing matches"
                : filter === "all"
                  ? "Nothing here"
                  : `No ${filter} invoices`}
          </p>
          <p className="empty-sub">
            {totalCount === 0
              ? "Add your first invoice above — link it to a client or keep it standalone."
              : query.trim()
                ? clientMatches.length > 0
                  ? `${clientMatches.length} client${clientMatches.length === 1 ? "" : "s"} match${
                      clientMatches.length === 1 ? "es" : ""
                    } “${query.trim()}” — invoices appear here once linked to a client.`
                  : "Try a different search or status."
                : "Try a different status tab."}
          </p>
          {canEdit && totalCount === 0 && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setFilter("all");
                setQuery("");
                amountRef.current?.focus();
              }}
            >
              Add an invoice
            </button>
          )}
        </div>
      ) : (
        <ul className="card inv-list">
          {visible.map((inv) => {
            const overdue = isOverdue(inv);
            return (
              <li key={inv.id} className="inv">
                <div className="inv-body">
                  <div className="inv-client">
                    {inv.clientName ? (
                      <span className={`chip${blurPii(pii)}`}>{inv.clientName}</span>
                    ) : (
                      <span className="inv-noclient">No client</span>
                    )}
                    {inv.notes && <span className="inv-notes">{inv.notes}</span>}
                  </div>
                  <div className="inv-meta">
                    <span className="inv-amount">{money(inv.amount)}</span>
                    {overdue ? (
                      <span className="badge tone-red">Overdue</span>
                    ) : (
                      <span className={`badge tone-${INVOICE_STATUS_TONE[inv.status]}`}>
                        {invoiceStatusLabel(inv.status)}
                      </span>
                    )}
                    {inv.dueDate && (
                      <span className={`inv-due${overdue ? " overdue" : ""}`}>
                        {overdue ? "Overdue · " : "Due "}
                        {fmtDate(inv.dueDate)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="row-actions">
                  {canEdit && inv.status === "draft" && (
                    <button className="icon-btn" onClick={() => handleStatus(inv, "sent")} disabled={busy}>
                      Mark sent
                    </button>
                  )}
                  {canEdit && inv.status === "sent" && (
                    <button className="icon-btn" onClick={() => handleStatus(inv, "paid")} disabled={busy}>
                      Mark paid
                    </button>
                  )}
                  {canEdit && (
                  <button className="icon-btn" onClick={() => setEditing(inv)} aria-label={`Edit invoice ${inv.id}`}>
                    Edit
                  </button>
                  )}
                  {canEdit && (
                  <button
                    className="icon-btn danger"
                    onClick={() => setDeleting(inv)}
                    aria-label={`Delete invoice ${inv.id}`}
                  >
                    Delete
                  </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <InvoiceModal
          invoice={editing}
          clients={clients}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete invoice?"
          entity={
            <>
              {money(deleting.amount)} invoice
              {deleting.clientName ? <> for <span className={pii ? "pii-blur" : undefined}>{deleting.clientName}</span></> : ""}
            </>
          }
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
