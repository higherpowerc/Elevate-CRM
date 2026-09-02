import { useEffect, useState } from "react";
import { api } from "./api";
import { fmtDate, type ProvisionEvent } from "./types";
import { usePii } from "./pii";

interface Props {
  /** Optional callback when the owner wants to open the provisioned account
   *  from the notice (jumps to the Admin tab and/or impersonates). */
  onViewAccount?: (orgId: number) => void;
}

/**
 * 3g-3 — the owner's in-app signal that a sold lead was auto-provisioned:
 * a dismissible list naming the sold client and the new workspace. Fetched
 * from the owner-only /api/admin/provisions endpoint; rendered on the owner's
 * Dashboard and Admin page (the two places the owner lands to act on it).
 * "Dismissed on view" — each notice has a dismiss button and stays until the
 * owner dismisses it, so it survives a refresh until acted on.
 */
export default function ProvisionNotices({ onViewAccount }: Props) {
  /* Global privacy eye (2026-08-14 owner request) — blur PII (client/company names, phone, email, address) here too. */
  const pii = usePii();
  const [provisions, setProvisions] = useState<ProvisionEvent[] | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);

  const load = () => {
    api
      .adminProvisions()
      .then((res) => setProvisions(res.provisions))
      .catch(() => setProvisions([])); // owner-only; non-admin callers just see nothing
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!provisions || provisions.length === 0) return null;

  return (
    <div className="prov-notices" aria-label="New auto-provisioned workspaces">
      {provisions.map((p) => (
        <div className="prov-notice" key={p.id}>
          <div className="prov-notice-body">
            <span className="chip chip-owner">New — auto-provisioned from sold lead</span>
            <p className="prov-notice-text">
              <strong className={pii ? "pii-blur" : undefined}>{p.clientName}</strong> → new workspace <strong className={pii ? "pii-blur" : undefined}>{p.orgName}</strong>
              {onViewAccount && (
                <button className="link-btn prov-open" onClick={() => onViewAccount(p.orgId)}>
                  Open account →
                </button>
              )}
            </p>
            <p className="prov-notice-meta">{fmtDate(p.createdAt)}</p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={dismissing === p.id}
            onClick={async () => {
              setDismissing(p.id);
              try {
                await api.adminDismissProvision(p.id);
                setProvisions((cur) => (cur ? cur.filter((x) => x.id !== p.id) : cur));
              } catch {
                /* keep the notice; the dismiss can be retried */
              } finally {
                setDismissing(null);
              }
            }}
          >
            {dismissing === p.id ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      ))}
    </div>
  );
}
