import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Typed-delete confirmation (owner direction): ANY delete in the app must be
 * confirmed by typing the word "delete" (case-insensitive) into a field —
 * a plain Yes/No dialog is not enough. This is the single reusable component
 * for every destructive action (client record, task, invoice, tenant org,
 * custom field, intake group, pipeline stage).
 *
 * Reuses the app's modal styling (`.overlay` / `.modal.modal-sm` /
 * `.modal-actions`), so Esc cancels, the actions row stays pinned (3c fix),
 * and the confirm button is disabled until the typed text matches "delete".
 * Pressing Enter in the input confirms when the button is enabled.
 */
interface Props {
  title: string;
  /** The thing being deleted — shown bold in the message ("…delete <entity>?"). */
  entity: ReactNode;
  /** Optional extra context rendered under the standard message. */
  note?: ReactNode;
  /** Label for the confirm button (default "Delete"). */
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const REQUIRED = "delete";

export default function ConfirmDeleteModal({
  title,
  entity,
  note,
  confirmLabel = "Delete",
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Case-insensitive per owner decision: "delete", "Delete", "DELETE" all count.
  const matched = typed.trim().toLowerCase() === REQUIRED;

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  function submit() {
    if (!matched || busy) return;
    onConfirm();
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && matched && !busy) {
      e.preventDefault();
      onConfirm();
    }
  }

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="modal modal-sm">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Cancel" disabled={busy}>
            ✕
          </button>
        </div>
        <div className="confirm-body">
          <p className="confirm-delete-msg">
            Are you sure you want to delete <strong>{entity}</strong>? This cannot be undone.
          </p>
          {note}
          <label className="field confirm-delete-field">
            <span className="field-label">Type "Delete" to confirm</span>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Delete"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              aria-label="Type delete to confirm"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={submit} disabled={!matched || busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
