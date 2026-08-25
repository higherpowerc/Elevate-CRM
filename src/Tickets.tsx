import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_TONE,
  fmtDate,
  ticketPriorityLabel,
  ticketStatusLabel,
  ticketReplyLabel,
  type Ticket,
  type TicketPriority,
  type TicketReply,
  type TicketStatus,
} from "./types";
import { usePii, blurPii } from "./pii";

interface Props {
  /** true = the OWNER workspace: "Tickets" tab showing every account's
   *  tickets (org name per row) with a status control; false = a CLIENT
   *  workspace: "Support" tab showing only its own tickets + submit form. */
  ownerOrg: boolean;
  /** Team-users UI (owner request 2026-08-14) — false for a restricted member
   *  with view-only "support" access: the submit-ticket affordances are hidden
   *  (the server still 403s the create). Owner and org admins always true. */
  canEdit?: boolean;
}

const TICKET_STATUS_ORDER = [...TICKET_STATUSES];

/** Tenant polling: re-fetch every 20s so status changes the owner makes are
 *  reflected on the client's Support tab without a manual refresh. */
const TENANT_POLL_MS = 20_000;

export default function Tickets({ ownerOrg, canEdit = true }: Props) {
  /* Team-users UI (owner request 2026-08-14) — false for a restricted member
     with view-only "support" access: the submit-ticket affordances are hidden
     (the server still 403s the create). The owner and org admins always pass
     true; the owner's status control is owner-only and untouched. */
  const pii = usePii();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Search box (owner direction 2026-08-25) — client-side filter over the
   *  rendered rows (ticket number, subject, status label, and owner-view
   *  account/org name). */
  const [query, setQuery] = useState("");
  /** Owner view: the ticket whose full message is expanded (subject click). */
  const [expandedId, setExpandedId] = useState<number | null>(null);
  /** Owner view: ticket id whose status change is in flight (row spinner). */
  const [savingStatusId, setSavingStatusId] = useState<number | null>(null);

  /* Submit-ticket modal (owner + tenant both use it; the owner's ticket lands
     in the owner's OWN org, exactly like a client's). */
  const [showModal, setShowModal] = useState(false);

  /* Owner-only "agent draft-reply review queue" (backlog 58435d2b): replies
     per expanded ticket, per-ticket draft textarea, and in-flight send id.
     Tenants never touch these — the reply routes are owner-only server-side. */
  const [repliesByTicket, setRepliesByTicket] = useState<Record<number, TicketReply[]>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [sendingReplyId, setSendingReplyId] = useState<number | null>(null);
  const [creatingReplyId, setCreatingReplyId] = useState<number | null>(null);
  const [replyBusyId, setReplyBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { tickets } = await api.tickets();
      setTickets(tickets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets.");
    }
  }, []);

  useEffect(() => {
    load();
    if (!ownerOrg) {
      const id = window.setInterval(load, TENANT_POLL_MS);
      return () => window.clearInterval(id);
    }
  }, [load, ownerOrg]);

  async function handleStatusChange(t: Ticket, status: TicketStatus) {
    setSavingStatusId(t.id);
    setError(null);
    try {
      await api.updateTicket(t.id, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSavingStatusId(null);
    }
  }

  /* Owner-only reply queue handlers (backlog 58435d2b). `loadReplies` is
     called when the owner expands a ticket; the draft textarea + per-draft
     "Approve & send" render below in the expanded row. Tenants never reach
     these (the buttons only render for ownerOrg). */
  const loadReplies = useCallback(
    async (ticketId: number) => {
      setReplyBusyId(ticketId);
      try {
        const { replies } = await api.ticketReplies(ticketId);
        setRepliesByTicket((prev) => ({ ...prev, [ticketId]: replies }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load replies.");
      } finally {
        setReplyBusyId(null);
      }
    },
    [],
  );

  async function toggleExpand(t: Ticket) {
    const expanded = expandedId === t.id;
    setExpandedId(expanded ? null : t.id);
    if (!expanded && ownerOrg && !repliesByTicket[t.id]) {
      void loadReplies(t.id);
    }
  }

  async function handleCreateReply(ticketId: number) {
    const body = (replyDrafts[ticketId] ?? "").trim();
    if (!body) return;
    setCreatingReplyId(ticketId);
    setError(null);
    try {
      const { reply } = await api.createTicketReply(ticketId, { body });
      setRepliesByTicket((prev) => ({
        ...prev,
        [ticketId]: [...(prev[ticketId] ?? []), reply],
      }));
      setReplyDrafts((prev) => ({ ...prev, [ticketId]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save draft.");
    } finally {
      setCreatingReplyId(null);
    }
  }

  async function handleSendReply(ticketId: number, replyId: number) {
    setSendingReplyId(replyId);
    setError(null);
    try {
      const { reply } = await api.sendTicketReply(ticketId, replyId);
      setRepliesByTicket((prev) => ({
        ...prev,
        [ticketId]: (prev[ticketId] ?? []).map((r) => (r.id === replyId ? reply : r)),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reply.");
    } finally {
      setSendingReplyId(null);
    }
  }

  const counts = useCallback(() => {
    if (!tickets) return { open: 0, inProgress: 0, total: 0 };
    return {
      open: tickets.filter((t) => t.status === "OPEN").length,
      inProgress: tickets.filter((t) => t.status === "IN_PROGRESS").length,
      total: tickets.length,
    };
  }, [tickets]);

  if (!tickets) {
    return error ? (
      <div className="alert alert-error">{error}</div>
    ) : (
      <div className="skeleton-block" aria-label="Loading tickets" />
    );
  }

  const c = counts();

  /* Client-side search (owner direction 2026-08-25): narrows the rendered
     rows by ticket number, subject, status label, and (owner) account name —
     case-insensitive. Grouping/order of the full set is preserved. */
  const q = query.trim().toLowerCase();
  const visibleTickets = q
    ? tickets.filter((t) =>
        [t.ticketNo, t.subject, ticketStatusLabel(t.status), ownerOrg ? (t.orgName ?? "") : ""]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : tickets;

  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>
            {ownerOrg ? (
              <>
                Support <em className="serif">tickets</em>
              </>
            ) : (
              <>
                <em className="serif">Support</em>
              </>
            )}
          </h1>
          <p className="page-sub">
            {ownerOrg ? (
              <>
                Every client account's tickets, worked to resolution —{" "}
                <strong>{c.open}</strong> open · <strong>{c.inProgress}</strong> in progress ·{" "}
                {c.total} total
              </>
            ) : (
              <>
                Reach Revzenta — submit a ticket any time; status updates
                from our team appear here.
              </>
            )}
          </p>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            {ownerOrg ? "New ticket" : "Submit a ticket"}
          </button>
        )}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {tickets.length > 0 && (
        <div className="toolbar">
          <input
            className="search"
            type="search"
            placeholder="Search ticket number, subject, status, account…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tickets"
          />
        </div>
      )}

      {tickets.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">
            {ownerOrg ? "No tickets yet" : "No support tickets"}
          </p>
          <p className="empty-sub">
            {ownerOrg
              ? "When a client account runs into an issue, its ticket shows up here with the account name."
              : "Something not working? Submit a ticket and our team will take a look."}
          </p>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              {ownerOrg ? "New ticket" : "Submit a ticket"}
            </button>
          )}
        </div>
      ) : visibleTickets.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">No tickets match</p>
          <p className="empty-sub">Try a different search — no tickets match "{query.trim()}".</p>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table tickets-table">
            <colgroup>
              {ownerOrg ? (
                <>
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "12%" }} />
                </>
              ) : (
                <>
                  <col style={{ width: "44%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "24%" }} />
                </>
              )}
            </colgroup>
            <thead>
              <tr>
                {ownerOrg ? (
                  <>
                    <th>Account</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Created</th>
                    <th className="actions-th">Status control</th>
                  </>
                ) : (
                  <>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Created</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleTickets.map((t) => {
                const expanded = expandedId === t.id;
                return (
                  <tr key={t.id} className={expanded ? "ticket-row open" : "ticket-row"}>
                    {ownerOrg && (
                      <td data-label="Account" className="cell-strong">
                        <span className={`cell-name${blurPii(pii)}`} title={t.orgName ?? ""}>
                          {t.orgName || "—"}
                        </span>
                      </td>
                    )}
                    <td data-label="Subject">
                      <div className="ticket-subject-cell">
                        {t.ticketNo && <span className="badge tone-gray ticket-no">{t.ticketNo}</span>}
                        <button
                          type="button"
                          className="ticket-subject"
                          onClick={() => toggleExpand(t)}
                          aria-expanded={expanded}
                          aria-label={expanded ? `Collapse ${t.subject}` : `Expand ${t.subject}`}
                        >
                          {t.subject}
                        </button>
                      </div>
                      {expanded && (
                        <>
                          <p className={`ticket-message${blurPii(pii)}`}>{t.message}</p>
                          {ownerOrg && (
                            <TicketRepliesPanel
                              ticketId={t.id}
                              replies={repliesByTicket[t.id]}
                              draft={replyDrafts[t.id] ?? ""}
                              onDraftChange={(v) =>
                                setReplyDrafts((prev) => ({ ...prev, [t.id]: v }))
                              }
                              busy={replyBusyId === t.id}
                              creating={creatingReplyId === t.id}
                              sendingId={sendingReplyId}
                              onSaveDraft={() => handleCreateReply(t.id)}
                              onApproveSend={(replyId) => handleSendReply(t.id, replyId)}
                            />
                          )}
                        </>
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={`badge tone-${TICKET_STATUS_TONE[t.status]}`}>
                        {ticketStatusLabel(t.status)}
                      </span>
                    </td>
                    <td data-label="Priority">
                      <span className={`badge tone-${TICKET_PRIORITY_TONE[t.priority]}`}>
                        {ticketPriorityLabel(t.priority)}
                      </span>
                    </td>
                    <td data-label="Created">{fmtDate(t.createdAt)}</td>
                    {ownerOrg && (
                      <td data-label="Status control">
                        <select
                          className="status-select"
                          value={t.status}
                          disabled={savingStatusId !== null}
                          aria-label={`Move "${t.subject}" to…`}
                          onChange={(e) => handleStatusChange(t, e.target.value as TicketStatus)}
                        >
                          {TICKET_STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {ticketStatusLabel(s)}
                            </option>
                          ))}
                        </select>
                        {savingStatusId === t.id && (
                          <span className="cell-muted ticket-saving">Saving…</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TicketFormModal
          ownerOrg={ownerOrg}
          onClose={() => setShowModal(false)}
          onSubmitted={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
}

/* ── Submit-ticket modal ─────────────────────────────────────────────── */

interface ModalProps {
  ownerOrg: boolean;
  onClose: () => void;
  /** Called after a successful submit (the parent reloads the list). */
  onSubmitted: () => Promise<void>;
}

function TicketFormModal({ ownerOrg, onClose, onSubmitted }: ModalProps) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Esc closes the modal (keyboard nicety — same as every other modal).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    if (!message.trim()) {
      setError("Message is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createTicket({ subject: subject.trim(), message: message.trim(), priority });
      await onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Submit a support ticket">
      <div className="modal modal-sm">
        <div className="modal-head">
          <h2>Submit a ticket</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={saving}>
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="form modal-form">
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            <span className="field-label">Subject *</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Can't add a new client"
              maxLength={200}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Message *</span>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                ownerOrg
                  ? "What's the issue? (This ticket is filed on Revzenta's own account.)"
                  : "What happened, and what did you expect instead? The more detail, the faster we can help."
              }
              maxLength={10000}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {ticketPriorityLabel(p)}
                </option>
              ))}
            </select>
            <span className="field-hint">Normal is the default — use High for blockers.</span>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Submitting…" : "Submit ticket"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Owner-only ticket-reply panel (backlog 58435d2b) ──────────────────
 * Shown when the owner expands a ticket. Lists existing replies (draft vs
 * sent badge), a "Draft reply" textarea the reviewer saves as a draft, and a
 * per-draft "Approve & send" button — the ONLY way a reply is emailed to the
 * client (never auto-sent). Never rendered for tenant orgs. */
interface RepliesPanelProps {
  ticketId: number;
  replies?: TicketReply[];
  draft: string;
  onDraftChange: (v: string) => void;
  busy: boolean;
  creating: boolean;
  sendingId: number | null;
  onSaveDraft: () => void;
  onApproveSend: (replyId: number) => void;
}

function TicketRepliesPanel({
  replies,
  draft,
  onDraftChange,
  busy,
  creating,
  sendingId,
  onSaveDraft,
  onApproveSend,
}: RepliesPanelProps) {
  const pii = usePii();
  const list = replies ?? [];
  return (
    <div className="ticket-replies">
      <div className="ticket-replies-head">
        <span className="field-label">Replies</span>
        <span className="cell-muted">
          {busy ? "Loading…" : list.length === 0 ? "No replies yet" : `${list.length} reply${list.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {list.length > 0 && (
        <ul className="ticket-replies-list">
          {list.map((r) => (
            <li key={r.id} className={`ticket-reply ${r.status === "draft" ? "reply-draft" : "reply-sent"}`}>
              <div className="ticket-reply-meta">
                <span className="cell-strong">{r.author}</span>
                <span className={`badge ${r.status === "draft" ? "tone-amber" : "tone-green"}`}>
                  {ticketReplyLabel(r.status)}
                </span>
                {r.status === "draft" ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => onApproveSend(r.id)}
                    disabled={sendingId !== null}
                  >
                    {sendingId === r.id ? "Sending…" : "Approve & send"}
                  </button>
                ) : (
                  <span className="cell-muted">Sent {fmtDate(r.sentAt || r.createdAt)}</span>
                )}
              </div>
              <p className={`ticket-reply-body${blurPii(pii)}`}>{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="ticket-reply-draft">
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Draft a reply to the client… (stays a draft until you approve &amp; send it)"
          maxLength={10000}
          aria-label="Draft reply"
        />
        <div className="ticket-reply-draft-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onSaveDraft}
            disabled={creating || !draft.trim()}
          >
            {creating ? "Saving…" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
