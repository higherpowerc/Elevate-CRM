import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, type TaskInput } from "./api";
import { fmtDate, type Client, type Task } from "./types";
import TaskModal from "./TaskModal";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { usePii, blurPii } from "./pii";

type Filter = "open" | "done" | "all";

/** Local YYYY-MM-DD so `<input type="date">` values compare correctly. */
function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "" | "overdue" | "today" — only meaningful for open tasks with a due date. */
function dueTone(t: Task): "overdue" | "today" | "" {
  if (t.done || !t.dueDate) return "";
  const today = localToday();
  if (t.dueDate < today) return "overdue";
  if (t.dueDate === today) return "today";
  return "";
}

export default function Tasks({ canEdit = true }: { canEdit?: boolean }) {
  /* Team-users UI (owner request 2026-08-14) — false for a restricted member
     with view-only "tasks" access: the add/toggle/edit/delete affordances are
     hidden (the server still 403s any write). Owner and org admins always
     pass true. */
  /* Global privacy eye (2026-08-14 owner request) — blur PII (client/company names, phone, email, address) here too. */
  const pii = usePii();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");

  // Quick-add row
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ tasks }, { clients }] = await Promise.all([api.tasks(), api.clients(true)]);
      setTasks(tasks);
      setClients(clients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (!tasks) return [];
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      const matchFilter =
        filter === "all" ? true : filter === "done" ? t.done : !t.done;
      if (!matchFilter) return false;
      if (!q) return true;
      return `${t.title} ${t.clientName}`.toLowerCase().includes(q);
    });
  }, [tasks, filter, query]);

  const openCount = useMemo(() => (tasks ? tasks.filter((t) => !t.done).length : 0), [tasks]);
  const doneCount = useMemo(() => (tasks ? tasks.filter((t) => t.done).length : 0), [tasks]);

  async function handleQuickAdd(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setError("Task title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createTask({
        title: t,
        clientId: clientId === "" ? null : Number(clientId),
        dueDate: dueDate.trim(),
      });
      setTitle("");
      setClientId("");
      setDueDate("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(t: Task) {
    setBusy(true);
    setError(null);
    try {
      await api.toggleTask(t.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(data: TaskInput, editing: Task) {
    setBusy(true);
    setError(null);
    try {
      await api.updateTask(editing.id, data);
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
      await api.deleteTask(deleting.id);
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!tasks) {
    return error ? (
      <div className="alert alert-error">{error}</div>
    ) : (
      <div className="skeleton-block" aria-label="Loading tasks" />
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Task <em className="serif">board</em>
          </h1>
          <p className="page-sub">
            <strong>{openCount}</strong> open · {doneCount} completed · {tasks.length} total
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {canEdit && (
      <form className="card task-add" onSubmit={handleQuickAdd}>
        <input
          className="task-add-title"
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task — e.g. Send revised quote"
          aria-label="New task title"
          maxLength={200}
        />
        <select className={pii ? "pii-blur" : undefined} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Link to client">
          <option value="">No client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.companyName}
              {c.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Due date"
        />
        <button className="btn btn-primary" disabled={busy}>
          Add
        </button>
      </form>
      )}

      <div className="toolbar">
        <div className="seg">
          {(["open", "done", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? "seg-btn active" : "seg-btn"}
              onClick={() => setFilter(f)}
            >
              {f === "open" ? "Open" : f === "done" ? "Completed" : "All"}
              <span className="seg-count">
                {f === "open" ? openCount : f === "done" ? doneCount : tasks.length}
              </span>
            </button>
          ))}
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search tasks, clients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tasks"
        />
      </div>

      {visible.length === 0 ? (
        <div className="card empty">
          <p className="empty-title">
            {tasks.length === 0
              ? "No tasks yet"
              : filter === "open"
                ? "Nothing open"
                : "Nothing matches"}
          </p>
          <p className="empty-sub">
            {tasks.length === 0
              ? "Add your first task above — link it to a client or keep it standalone."
              : filter === "open"
                ? "All done — add something new, or check the Completed tab."
                : "Try a different filter or search."}
          </p>
          {canEdit && tasks.length === 0 && (
            <button
              className="btn btn-primary"
              onClick={() => {
                setFilter("open");
                titleRef.current?.focus();
              }}
            >
              Add a task
            </button>
          )}
        </div>
      ) : (
        <ul className="card task-list">
          {visible.map((t) => {
            const tone = dueTone(t);
            return (
              <li key={t.id} className={t.done ? "task task-done" : "task"}>
                {canEdit && (
                <button
                  className="task-check"
                  onClick={() => handleToggle(t)}
                  disabled={busy}
                  aria-label={t.done ? `Mark "${t.title}" open` : `Mark "${t.title}" done`}
                >
                  <span className={t.done ? "task-checkbox on" : "task-checkbox"}>{t.done ? "✓" : ""}</span>
                </button>
                )}
                <div className="task-body">
                  <div className="task-title">
                    <span className={`task-title-text${blurPii(pii)}`}>{t.title}</span>
                    {t.clientName && <span className={`chip${blurPii(pii)}`}>{t.clientName}</span>}
                  </div>
                  <div className="task-meta">
                    {t.dueDate && (
                      <span className={`task-due${tone ? ` ${tone}` : ""}`}>
                        {tone === "overdue" ? "Overdue · " : tone === "today" ? "Due today · " : "Due "}
                        {fmtDate(t.dueDate)}
                      </span>
                    )}
                    {t.notes && <span className="task-notes">{t.notes}</span>}
                  </div>
                </div>
                {canEdit && (
                <div className="row-actions">
                  <button className="icon-btn" onClick={() => setEditing(t)} aria-label={`Edit ${t.title}`}>
                    Edit
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => setDeleting(t)}
                    aria-label={`Delete ${t.title}`}
                  >
                    Delete
                  </button>
                </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <TaskModal
          task={editing}
          clients={clients}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      {deleting && (
        <ConfirmDeleteModal
          title="Delete task?"
          entity={deleting.title}
          confirmLabel="Delete permanently"
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
