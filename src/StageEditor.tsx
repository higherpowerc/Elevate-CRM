import { useState } from "react";
import { api } from "./api";
import ConfirmDeleteModal from "./ConfirmDeleteModal";

const MAX_STAGES = 12;

/**
 * Reusable per-tenant pipeline stage editor (Phase 3a). Renders the stage
 * list with add/remove/rename and a "Save stages" action; saving persists the
 * list through the session-org-scoped settings API. Used by both the Settings
 * page and the Clients tab's "Manage stages" shortcut (Phase 3e).
 *
 * The remove guard is enforced two ways: the UI disables the Remove button
 * while a stage still has clients (counts come from the org's own data), and
 * the server rejects the save if any occupied stage is dropped. When removal
 * is allowed it still needs a typed "delete" confirmation (owner direction).
 */
export default function StageEditor({
  initialStages,
  stageCounts,
  onSaved,
}: {
  initialStages: string[];
  stageCounts: Record<string, number>;
  onSaved?: (stages: string[]) => void;
}) {
  const [stages, setStages] = useState<string[]>(initialStages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** Index of the stage awaiting a typed confirmation before removal. */
  const [confirming, setConfirming] = useState<number | null>(null);

  const stageCount = (s: string): number => stageCounts[s] ?? 0;

  function setStageAt(i: number, value: string) {
    setStages((list) => list.map((s, j) => (j === i ? value : s)));
  }

  function removeStage(i: number) {
    setStages((list) => list.filter((_, j) => j !== i));
  }

  function addStage() {
    setStages((list) => [...list, ""]);
  }

  function validate(list: string[]): string | null {
    const trimmed = list.map((s) => s.trim());
    if (trimmed.length === 0) return "At least one stage is required.";
    if (trimmed.length > MAX_STAGES) return `Keep the pipeline to ${MAX_STAGES} stages or fewer.`;
    if (trimmed.some((s) => !s)) return "Every stage needs a name (or remove the empty row).";
    const seen = new Set<string>();
    for (const s of trimmed) {
      const key = s.toLowerCase();
      if (seen.has(key)) return `Duplicate stage name: ${s}.`;
      seen.add(key);
    }
    return null;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const problem = validate(stages);
    if (problem) {
      setError(problem);
      return;
    }
    const trimmed = stages.map((s) => s.trim());
    setBusy(true);
    try {
      await api.updateSettings({ stages: trimmed });
      setSaved("Pipeline stages saved.");
      onSaved?.(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="stage-editor">
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="alert alert-success" role="status">
          {saved}
        </div>
      )}
      <div className="stage-list">
        {stages.map((s, i) => {
          const count = stageCount(s.trim());
          return (
            <div className="stage-row" key={i}>
              <span className="stage-idx">{String(i + 1).padStart(2, "0")}</span>
              <input
                value={s}
                onChange={(e) => setStageAt(i, e.target.value)}
                maxLength={60}
                placeholder={`Stage ${i + 1} name`}
                aria-label={`Stage ${i + 1} name`}
              />
              <span
                className={`stage-count-chip${count > 0 ? " has" : ""}`}
                title={`${count} client${count === 1 ? "" : "s"} in this stage`}
              >
                {count} client{count === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="icon-btn danger"
                disabled={busy || count > 0}
                title={
                  count > 0
                    ? `Move or archive its ${count} client${count === 1 ? "" : "s"} first`
                    : "Remove stage"
                }
                aria-label={`Remove stage ${s.trim() || i + 1}`}
                onClick={() => setConfirming(i)}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn-ghost btn-sm stage-add" onClick={addStage}>
        + Add stage
      </button>
      <div className="stage-save">
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Saving…" : "Save stages"}
        </button>
      </div>
      {confirming !== null && (
        <ConfirmDeleteModal
          title="Remove stage?"
          entity={`"${stages[confirming]?.trim() || `Stage ${confirming + 1}`}"`}
          note={
            <p className="confirm-delete-note">
              Clients currently in this stage must be moved or archived before it can be
              removed.
            </p>
          }
          confirmLabel="Remove stage"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            removeStage(confirming);
            setConfirming(null);
          }}
        />
      )}
    </form>
  );
}
