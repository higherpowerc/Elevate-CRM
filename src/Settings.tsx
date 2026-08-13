import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { DEFAULT_STAGES, type OrgSettings } from "./types";

/**
 * Settings (Phase 3a): per-tenant branding (workspace name + accent color)
 * and the tenant's own pipeline stages. Any signed-in member of the org can
 * edit these — it is their CRM. All writes are session-org scoped server-side.
 */
export default function Settings() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* Workspace (branding) */
  const [orgName, setOrgName] = useState("");
  const [accentColor, setAccentColor] = useState("#d6ff3f");

  /* Pipeline stages */
  const [stages, setStages] = useState<string[]>(DEFAULT_STAGES);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const { settings } = await api.settings();
      setSettings(settings);
      setOrgName(settings.orgName);
      setAccentColor(settings.accentColor);
      setStages(settings.stages);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load settings.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stageCount = (s: string): number => settings?.stageCounts?.[s] ?? 0;

  function setStageAt(i: number, value: string) {
    setStages((list) => list.map((s, j) => (j === i ? value : s)));
  }

  function removeStage(i: number) {
    setStages((list) => list.filter((_, j) => j !== i));
  }

  function addStage() {
    setStages((list) => [...list, ""]);
  }

  function validateStages(list: string[]): string | null {
    const trimmed = list.map((s) => s.trim());
    if (trimmed.length === 0) return "At least one stage is required.";
    if (trimmed.length > 12) return "Keep the pipeline to 12 stages or fewer.";
    if (trimmed.some((s) => !s)) return "Every stage needs a name (or remove the empty row).";
    const seen = new Set<string>();
    for (const s of trimmed) {
      const key = s.toLowerCase();
      if (seen.has(key)) return `Duplicate stage name: ${s}.`;
      seen.add(key);
    }
    return null;
  }

  async function saveWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      await api.updateSettings({ orgName: orgName.trim(), accentColor });
      setSaved("Workspace branding saved.");
      await load(); // refresh orgName/accent from the server
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStages(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const problem = validateStages(stages);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await api.updateSettings({ stages: stages.map((s) => s.trim()) });
      setSaved("Pipeline stages saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <div className="alert alert-error">{loadError}</div>;
  if (!settings) return <div className="skeleton-block" aria-label="Loading settings" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Workspace <em className="serif">settings</em>
          </h1>
          <p className="page-sub">
            Your branding and your pipeline — everything here is private to {settings.orgName}.
          </p>
        </div>
      </div>

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

      <div className="admin-grid">
        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Branding</h2>
            <p className="admin-card-sub">
              The workspace name shows in the header and browser tab; the accent colors the
              header mark and active tab.
            </p>
          </div>
          <form onSubmit={saveWorkspace} className="form">
            <label className="field">
              <span className="field-label">Workspace name</span>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                maxLength={200}
                placeholder="Acme Landscaping"
                required
              />
              <span className="field-hint">Shown in the app header and document title.</span>
            </label>
            <div className="field">
              <span className="field-label">Accent color</span>
              <div className="accent-row">
                <input
                  type="color"
                  className="color-input"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  aria-label="Accent color"
                />
                <input
                  className="accent-hex"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  maxLength={7}
                  placeholder="#d6ff3f"
                  aria-label="Accent color hex"
                />
              </div>
            </div>
            <button className="btn btn-primary" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save branding"}
            </button>
          </form>
        </div>

        <div className="card admin-table">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Pipeline stages</h2>
            <p className="admin-card-sub">
              Rename, reorder and shape the pipeline to your business. Renaming a stage keeps
              its clients; removing one is blocked while clients are still in it.
            </p>
          </div>
          <form onSubmit={saveStages}>
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
                    <span className={`stage-count-chip${count > 0 ? " has" : ""}`} title={`${count} client${count === 1 ? "" : "s"} in this stage`}>
                      {count} client{count === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      disabled={busy || count > 0}
                      title={count > 0 ? `Move the ${count} client${count === 1 ? "" : "s"} out of "${s.trim()}" before removing it` : "Remove stage"}
                      aria-label={`Remove stage ${s.trim() || i + 1}`}
                      onClick={() => removeStage(i)}
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
          </form>
        </div>
      </div>
    </div>
  );
}
