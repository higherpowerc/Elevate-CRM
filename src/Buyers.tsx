import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "./api";
import type { Buyer } from "./types";
import BuyerModal from "./BuyerModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { usePii, blurPii } from "./pii";

type Filter = "all" | "with-criteria";

/** Wholesale Real Estate vertical (owner direction 2026-09-04) — the
 *  wholesale account's end-buyer list. Org-scoped CRUD over /api/buyers
 *  (the server scopes every row to the session org; the owner cockpit has
 *  no buyers surface). Follows Tasks.tsx's pattern: quick-add row, filter
 *  segs, search, edit modal, delete confirm. `canEdit` follows the tasks
 *  grant (view-only team members can browse but not change). */
export default function Buyers({ canEdit = true }: { canEdit?: boolean }) {
  /* Global privacy eye — blur buyer names/phones here too. */
  const pii = usePii();
  const [buyers, setBuyers] = useState<Buyer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // Quick-add row
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [criteria, setCriteria] = useState("");
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [deleting, setDeleting] = useState<Buyer | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      const { buyers } = await api.buyers();
      setBuyers(buyers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load buyers.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const visible = useMemo(() => {
    if (!buyers) return [];
    const q = query.trim().toLowerCase();
    return buyers.filter((b) => {
      if (filter === "with-criteria" && !b.criteria.trim()) return false;
      if (!q) return true;
      return `${b.name} ${b.phone} ${b.criteria} ${b.bought}`.toLowerCase().includes(q);
    });
  }, [buyers, filter, query]);
  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setError("Buyer name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createBuyer({ name: n, phone: phone.trim(), criteria: criteria.trim() });
      setName("");
      setPhone("");
      setCriteria("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed.");
    } finally {
      setBusy(false);
    }
  }
  async function handleSave(data: { name: string; phone: string; criteria: string; bought: string }, editing: Buyer) {
    setBusy(true);
    setError(null);
    try {
      await api.updateBuyer(editing.id, data);
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
    setNotice(null);
    try {
      await api.deleteBuyer(deleting.id);
      setDeleting(null);
      setNotice("Buyer removed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }
  if (error && !buyers) {
    return (
      <div className="page">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }
  if (!buyers) {
    return (
      <div className="page">
        <div className="skeleton-block" aria-label="Loading buyers" />
      </div>
    );
  }
  return (
    <div className="page page-stack">
      <div className="page-head">
        <div>
          <h1>
            Buyer <em className="serif">list</em>
          </h1>
          <p className="page-sub">
            Your end buyers — who to call when a property goes under contract. {buyers.length} total
          </p>
        </div>
      </div>
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {canEdit && (
        <form className="card task-add" onSubmit={handleQuickAdd}>
          <input
            className="task-add-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Quick-add a buyer by name…"
            aria-label="Buyer name"
            disabled={busy}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            aria-label="Phone"
            disabled={busy}
            className={pii ? "pii-blur" : undefined}
          />
          <input
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder="Buying criteria"
            aria-label="Buying criteria"
            disabled={busy}
          />
          <button className="btn btn-primary" disabled={busy}>
            Add buyer
          </button>
        </form>
      )}
      <div className="toolbar">
        <div className="seg">
          <button className={filter === "all" ? "seg-btn active" : "seg-btn"} onClick={() => setFilter("all")}>
            All <span className="seg-count">{buyers.length}</span>
          </button>
          <button
            className={filter === "with-criteria" ? "seg-btn active" : "seg-btn"}
            onClick={() => setFilter("with-criteria")}
          >
            With criteria <span className="seg-count">{buyers.filter((b) => b.criteria.trim()).length}</span>
          </button>
        </div>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search buyers…"
          aria-label="Search buyers"
        />
      </div>
      {visible.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">No buyers yet</p>
          <p className="empty-sub">
            Add cash buyers here as you meet them — then match them to properties in your pipeline.
          </p>
        </div>
      ) : (
        <div className="buyer-grid">
          {visible.map((b) => (
            <div key={b.id} className="card buyer-card">
              <div className="buyer-card-head">
                <span className={`buyer-name${blurPii(pii)}`}>{b.name}</span>
                {b.phone && (
                  <a className={`buyer-phone${blurPii(pii)}`} href={`tel:${b.phone}`}>
                    {b.phone}
                  </a>
                )}
              </div>
              {b.criteria && (
                <p className="buyer-criteria">
                  <span className="buyer-label">Buying</span> {b.criteria}
                </p>
              )}
              {b.bought && (
                <p className="buyer-bought">
                  <span className="buyer-label">Bought</span> {b.bought}
                </p>
              )}
              {canEdit && (
                <div className="buyer-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(b)} disabled={busy}>
                    Edit
                  </button>
                  <button className="btn btn-ghost btn-sm danger" onClick={() => setDeleting(b)} disabled={busy}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <BuyerModal buyer={editing} busy={busy} onClose={() => setEditing(null)} onSave={handleSave} />}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete buyer?"
          entity={deleting.name}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
