import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { AgreementEnvelope, AgreementStatus } from "./types";
import { usePii, blurPii } from "./pii";

/** Owner live-test finding (2026-08-15): "where are we storing these
 *  documents right now — they should be under admin." — the OWNER workspace
 *  gains a central Documents tab: EVERY agreement envelope across all client
 *  accounts in one place — client/company name, agreement status, signer name,
 *  signed date, IP address + consent (the audit trail), and the PDF copy.
 *
 *  Data comes from the existing owner-only audit API (GET /api/agreements —
 *  tenants 403), and the PDF links reuse the existing /agreement-pdf/<id>
 *  route the per-client audit button already uses. Owner-workspace only: the
 *  tab is owner-gated in App.tsx and the API is requireAdmin server-side. */
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
  /* Global privacy eye (2026-08-14 owner request) — blur client/company names
     and emails in the rows while the top-nav eye is on. */
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

      {!agreements ? (
        <div className="skeleton-block" aria-label="Loading documents" />
      ) : agreements.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">No agreement documents yet</p>
          <p className="empty-sub">
            Send an agreement from the Onboarding tab and its envelope will appear here with the full audit trail.
          </p>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table documents-table">
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
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
              </tr>
            </thead>
            <tbody>
              {agreements.map((a) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
