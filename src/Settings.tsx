import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { CUSTOM_FIELD_TYPES, type CustomFieldDef, type CustomFieldType, type OrgSettings } from "./types";
import StageEditor from "./StageEditor";

const MAX_CUSTOM_FIELDS = 20;

/**
 * Settings (Phase 3a/3b): per-tenant branding (workspace name + accent color),
 * the tenant's own pipeline stages (via the shared StageEditor), and the
 * tenant's own custom fields (name + type per field — these show up on every
 * client). Any signed-in member of the org can edit these — it is their CRM.
 * All writes are session-org scoped server-side.
 */
export default function Settings() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* Workspace (branding) */
  const [orgName, setOrgName] = useState("");
  const [accentColor, setAccentColor] = useState("#d6ff3f");

  /* Custom fields (Phase 3b) */
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>("text");
  const [confirmRemoveField, setConfirmRemoveField] = useState<number | null>(null);

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
      setCustomFields(settings.customFields);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load settings.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  /* ── Custom fields (Phase 3b) ─────────────────────────────────── */

  function validateCustomFieldList(list: CustomFieldDef[]): string | null {
    if (list.length > MAX_CUSTOM_FIELDS) {
      return `Keep custom fields to ${MAX_CUSTOM_FIELDS} or fewer.`;
    }
    const seen = new Set<string>();
    for (const f of list) {
      const key = f.name.trim().toLowerCase();
      if (seen.has(key)) return `Duplicate custom field: ${f.name}.`;
      seen.add(key);
    }
    return null;
  }

  function addField() {
    setError(null);
    setSaved(null);
    const name = newFieldName.trim();
    if (!name) {
      setError("Field name is required.");
      return;
    }
    if (name.length > 50) {
      setError("Field names must be under 51 characters.");
      return;
    }
    if (customFields.length >= MAX_CUSTOM_FIELDS) {
      setError(`You can define up to ${MAX_CUSTOM_FIELDS} custom fields.`);
      return;
    }
    const problem = validateCustomFieldList([...customFields, { name, type: newFieldType }]);
    if (problem) {
      setError(problem);
      return;
    }
    setCustomFields((list) => [...list, { name, type: newFieldType }]);
    setNewFieldName("");
  }

  function removeField(i: number) {
    setError(null);
    setSaved(null);
    setConfirmRemoveField(null);
    setCustomFields((list) => list.filter((_, j) => j !== i));
  }

  async function saveCustomFields() {
    setError(null);
    setSaved(null);
    const problem = validateCustomFieldList(customFields);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await api.updateSettings({
        customFields: customFields.map((f) => ({ name: f.name.trim(), type: f.type })),
      });
      setSaved("Custom fields saved.");
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
          <StageEditor initialStages={settings.stages} stageCounts={settings.stageCounts} />
        </div>

        <div className="card admin-table cfdef-card">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Custom fields</h2>
            <p className="admin-card-sub">
              Fields every client record shows, tailored to your business — an HVAC company might
              track "Furnace age", a realtor "Listing price". Values live per client; removing a
              field here hides it, and existing client values are kept intact.
            </p>
          </div>
          {customFields.length === 0 ? (
            <p className="field-hint cfdef-empty">
              No custom fields yet — add one below (e.g. "License #" as text, "Deal score" as
              number, "Contract start" as date, "Insured" as a checkbox).
            </p>
          ) : (
            <div className="cfdef-list">
              {customFields.map((f, i) => (
                <div className="cfdef-row" key={i}>
                  <span className="cfdef-name">{f.name}</span>
                  <span className="badge tone-gray cfdef-type">{f.type}</span>
                  {confirmRemoveField === i ? (
                    <span className="cfdef-confirm">
                      <span className="cfdef-confirm-q">Remove — clients keep their values?</span>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => removeField(i)}
                        disabled={busy}
                      >
                        Yes, remove
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setConfirmRemoveField(null)}
                        disabled={busy}
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => setConfirmRemoveField(i)}
                      disabled={busy}
                      aria-label={`Remove custom field ${f.name}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="cfdef-add">
            <input
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addField();
                }
              }}
              maxLength={50}
              placeholder="Field name (e.g. License #)"
              aria-label="New custom field name"
            />
            <select
              value={newFieldType}
              onChange={(e) => setNewFieldType(e.target.value as CustomFieldType)}
              aria-label="New custom field type"
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addField}>
              + Add field
            </button>
          </div>
          <div className="stage-save">
            <button className="btn btn-primary" disabled={busy} onClick={saveCustomFields}>
              {busy ? "Saving…" : "Save custom fields"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
