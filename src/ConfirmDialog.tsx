import { useEffect, type KeyboardEvent, type ReactNode } from "react";

interface Props {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({ title, body, confirmLabel, danger, busy, onCancel, onConfirm }: Props) {
  // Esc cancels the dialog (keyboard nicety).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () => window.removeEventListener("keydown", onKey as unknown as EventListener);
  }, [busy, onCancel]);

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="modal modal-sm">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Cancel" disabled={busy}>
            ✕
          </button>
        </div>
        <div className="confirm-body">{body}</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
