import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AgreementEnvelope, AgreementStatus } from "./types";
import { usePii, blurPii } from "./pii";

/** Owner document center (owner direction 2026-08-25): the Documents tab lists
 *  EVERY agreement envelope across all client accounts — status, signer, audit
 *  trail + PDF — with search and delete. (Owner 2026-08-28: the agreement
 *  template editor that briefly lived here moved back under Administration —
 *  see src/Admin.tsx.) Data comes from the owner-only audit API (GET
 *  /api/agreements — tenants 403); the PDFs reuse /agreement-pdf/<id> and
 *  deletion is DELETE /api/agreements/:id. Owner-workspace only (tab is
 *  owner-gated in App.tsx, every API is requireAdmin server-side). */
const STATUS_META: Record<AgreementStatus, { label: string; tone: string }> = {
  not_sent: { label: "Not sent", tone: "tone-gray" },
  sent: { label: "Sent", tone: "tone-amber" },
  delivered: { label: "Delivered", tone: "tone-blue" },
  signed: { label: "Signed", tone: "tone-green" },
  declined: { label: "Declined", tone: "tone-red" },
};

export default function Documents() {
  const [agreements, setAgreements] = useState<AgreementEnvelope[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<AgreementEnvelope | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pii = usePii();

  const load = useCallback(async () => {
    setError(null);
    try {
      const { agreements } = await api.agreements();
      setAgreements(agreements);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agreement documents.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.deleteAgreement(deleting.id);
      setDeleting(null);
      setNotice(`Deleted document for ${deleting.clientName}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleteBusy(false);
    }
  }

  /* Client-side search: client name, client email, signer name, status label —
     case-insensitive. */
  const filtered = useMemo(() => {
    if (!agreements) return [];
    const q = query.trim().toLowerCase();
    if (!q) return agreements;
    return agreements.filter((a) =>
      [a.clientName, a.clientEmail, a.signerName, STATUS_META[a.status].label]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [agreements, query]);

  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>
            Documents
          </h1>
          <p className="page-sub">
            Every agreement envelope across all client accounts — status, signer, audit trail and the PDF copy.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      {!agreements ? (
        <div className="skeleton-block" aria-label="Loading documents" />
      ) : (
        <>
          <div className="toolbar">
            <input
              className="search"
              type="search"
              placeholder="Search client, email, signer, status…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search documents"
            />
          </div>
          {agreements.length === 0 ? (
            <div className="card empty">
              <p className="empty-title">No agreement documents yet</p>
              <p className="empty-sub">
                Send an agreement from the Onboarding tab and its envelope will appear here with the full audit trail.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card empty">
              <p className="empty-title">No documents match</p>
              <p className="empty-sub">Try a different search — no documents match "{query.trim()}".</p>
            </div>
          ) : (
            <div className="card table-wrap">
              <table className="table documents-table">
                <colgroup>
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "8%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Signer</th>
                    <th>Signed at</th>
                    <th>IP address</th>
                    <th>Consent</th>
                    <th>PDF</th>
                    <th className="actions-th">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id}>
                      <td className="cell-strong" data-label="Client">
                        <div className="cell-company">
                          <span className={`cell-name${blurPii(pii)}`} title={a.clientName}>
                            {a.clientName}
                          </span>
                        </div>
                        {a.clientEmail && (
                          <div className={`cell-sub${blurPii(pii)}`} title={a.clientEmail}>
                            {a.clientEmail}
                          </div>
                        )}
                      </td>
                      <td data-label="Status">
                        <span className={`badge ${STATUS_META[a.status].tone}`}>
                          {STATUS_META[a.status].label}
                        </span>
                      </td>
                      <td data-label="Signer">{a.signerName || "—"}</td>
                      <td data-label="Signed at">{a.signedAt ? new Date(a.signedAt).toLocaleString() : "—"}</td>
                      <td data-label="IP address">{a.ipAddress || "—"}</td>
                      <td data-label="Consent">{a.consent ? "Yes" : "No"}</td>
                      <td data-label="PDF">
                        <a className="pdf-link" href={`/agreement-pdf/${a.pdfId}`} target="_blank" rel="noreferrer">
                          Open PDF
                        </a>
                      </td>
                      <td data-label="Delete">
                        <button
                          className="icon-btn danger"
                          title="Delete"
                          aria-label={`Delete ${a.clientName} document`}
                          onClick={() => setDeleting(a)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {deleting && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Delete document">
          <div className="modal modal-sm">
            <div className="modal-head">
              <h2>Delete document?</h2>
              <button className="icon-btn" onClick={() => setDeleting(null)} aria-label="Close" disabled={deleteBusy}>
                ✕
              </button>
            </div>
            <p className="confirm-delete-note">
              Permanently delete the agreement for <strong>{deleting.clientName}</strong>? The envelope record and its
              PDF will be removed. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary btn-danger" onClick={handleDelete} disabled={deleteBusy}>
                {deleteBusy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
