import { useState, type FormEvent } from "react";
import type { Client, Task } from "./types";
import type { TaskInput } from "./api";

interface Props {
  task: Task;
  clients: Client[];
  busy: boolean;
  onClose: () => void;
  onSave: (data: TaskInput, editing: Task) => void;
}

export default function TaskModal({ task, clients, busy, onClose, onSave }: Props) {
  const [title, setTitle] = useState(task.title);
  const [clientId, setClientId] = useState(task.clientId === null ? "" : String(task.clientId));
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [notes, setNotes] = useState(task.notes);
  const [done, setDone] = useState(task.done);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Task title is required.");
      return;
    }
    setError(null);
    onSave(
      {
        title: title.trim(),
        clientId: clientId === "" ? null : Number(clientId),
        dueDate: dueDate.trim(),
        done,
        notes,
      },
      task,
    );
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Edit task">
      <div className="modal modal-sm">
        <div className="modal-head">
          <h2>Edit task</h2>
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
            <span className="field-label">Title *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Send revised quote"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Client</span>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">No client (standalone)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName}
                  {c.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Due date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Notes</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, links, what's next…"
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            <span>Done</span>
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
