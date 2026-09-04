import { useEffect, useState, type FormEvent } from "react";
import type { Buyer } from "./types";
import { usePii } from "./pii";

interface Props {
  buyer: Buyer;
  busy: boolean;
  onClose: () => void;
  onSave: (data: { name: string; phone: string; criteria: string; bought: string }, editing: Buyer) => void;
}

/** Wholesale Real Estate vertical (owner direction 2026-09-04) — add/edit
 *  one end buyer. Follows TaskModal's pattern (overlay modal, Esc closes,
 *  error alert inline). Name is the only required field. */
export default function BuyerModal({ buyer, busy, onClose, onSave }: Props) {
  const pii = usePii();
  const [name, setName] = useState(buyer.name);
  const [phone, setPhone] = useState(buyer.phone);
  const [criteria, setCriteria] = useState(buyer.criteria);
  const [bought, setBought] = useState(buyer.bought);
  const [error, setError] = useState<string | null>(null);
  // Esc closes the modal (keyboard nicety).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () => window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, [busy, onClose]);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Buyer name is required.");
      return;
    }
    setError(null);
    onSave({ name: name.trim(), phone: phone.trim(), criteria: criteria.trim(), bought: bought.trim() }, buyer);
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Edit buyer">
      <div className="modal modal-sm">
        <div className="modal-head">
          <h2>Edit buyer</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
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
            <span className="field-label">Name *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riverside Capital LLC"
              required
              autoFocus
              className={pii ? "pii-blur" : undefined}
            />
          </label>
          <label className="field">
            <span className="field-label">Phone</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. (602) 555-0142"
              className={pii ? "pii-blur" : undefined}
            />
          </label>
          <label className="field">
            <span className="field-label">Buying criteria</span>
            <textarea
              rows={3}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              placeholder='e.g. "3BR/2BA under $150k, any city in Maricopa"'
            />
          </label>
          <label className="field">
            <span className="field-label">What they've bought</span>
            <textarea
              rows={2}
              value={bought}
              onChange={(e) => setBought(e.target.value)}
              placeholder="e.g. 4 wholesaled homes in 2025 / 11 flips"
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
