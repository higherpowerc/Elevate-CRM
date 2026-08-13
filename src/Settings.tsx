import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDef,
  type CustomFieldType,
  type CustomIntakeGroup,
  type CustomIntakeField,
  type IntakeGroupAppliesTo,
  type IntakeGroupFieldKind,
  type OrgSettings,
} from "./types";
import StageEditor from "./StageEditor";

const MAX_CUSTOM_FIELDS = 20;
const MAX_INTAKE_GROUPS = 10;
const MAX_GROUP_FIELDS = 20;
const GROUP_KEY_RE = /^[a-z][a-z0-9_]*$/;

/** Stable id for a brand-new group (Settings only — the server accepts any
 *  string id ≤ 60 chars). */
function newGroupId(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `g_${rand}`;
}

/** "Fleet size" → "fleet_size" — a sensible default field key the owner can
 *  then edit freely. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

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

  /* Adaptive intake (Phase 1): account-level vertical config */
  const [serviceModel, setServiceModel] = useState<OrgSettings["serviceModel"]>("both");
  const [deliveryType, setDeliveryType] = useState<OrgSettings["deliveryType"]>("both");
  const [industry, setIndustry] = useState<OrgSettings["industry"]>("");
  const [intakeOpts, setIntakeOpts] = useState<string[]>([]);

  /* Adaptive intake Phase 3: custom conditional field groups */
  const [intakeGroups, setIntakeGroups] = useState<CustomIntakeGroup[]>([]);
  const [confirmRemoveGroup, setConfirmRemoveGroup] = useState<number | null>(null);

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
      setServiceModel(settings.serviceModel);
      setDeliveryType(settings.deliveryType);
      setIndustry(settings.industry);
      setIntakeOpts(settings.intakeOpts);
      setIntakeGroups(settings.customIntakeGroups);
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

  /* ── Adaptive intake (Phase 1): account-level vertical config ───── */

  const INTAKE_OPT_LABELS: { id: string; label: string }[] = [
    { id: "business_llc_tab", label: "Business Name / LLC tab" },
    { id: "hoa_restrictions", label: "HOA restrictions" },
    { id: "pet_on_premises", label: "Pet on premises" },
    { id: "parking_access", label: "Parking / access" },
  ];

  function toggleIntakeOpt(id: string) {
    setError(null);
    setSaved(null);
    setIntakeOpts((list) =>
      list.includes(id) ? list.filter((g) => g !== id) : [...list, id],
    );
  }

  async function saveIntakeSetup() {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      // '' is "unspecified" — persist the explicit enum 'other' instead so the
      // select and the stored value always agree after a save.
      await api.updateSettings({
        serviceModel,
        deliveryType,
        industry: industry === "" ? "other" : industry,
        intakeOpts,
      });
      setSaved("Account setup saved.");
      await load();
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

  /* ── Custom intake groups (Phase 3) ────────────────────────────── */

  const INTAKE_GROUP_KIND_LABELS: Record<IntakeGroupFieldKind, string> = {
    text: "Text",
    yesno: "Yes / No",
    select: "Select (options)",
  };

  function validateIntakeGroupList(list: CustomIntakeGroup[]): string | null {
    if (list.length > MAX_INTAKE_GROUPS) {
      return `Keep custom intake groups to ${MAX_INTAKE_GROUPS} or fewer.`;
    }
    const usedKeys = new Set<string>(customFields.map((f) => f.name.toLowerCase()));
    for (const g of list) {
      if (!g.name.trim()) return "Each custom intake group needs a name.";
      if (g.name.trim().length > 80) return "Custom intake group names must be under 81 characters.";
      if (g.fields.length === 0) return `Group "${g.name}" needs at least one field.`;
      if (g.fields.length > MAX_GROUP_FIELDS) {
        return `Group "${g.name}" has too many fields (max ${MAX_GROUP_FIELDS}).`;
      }
      for (const f of g.fields) {
        if (!GROUP_KEY_RE.test(f.key)) {
          return `Group "${g.name}": key "${f.key || "(empty)"}" must start with a lowercase letter and use only lowercase letters, digits and underscores (e.g. fleet_size).`;
        }
        if (f.key.length > 40) return `Group "${g.name}": key "${f.key}" must be under 41 characters.`;
        if (usedKeys.has(f.key.toLowerCase())) {
          return `Group "${g.name}": key "${f.key}" is already used by another field — keys must be unique across all groups and custom fields.`;
        }
        usedKeys.add(f.key.toLowerCase());
        if (!f.label.trim()) return `Group "${g.name}": field "${f.key}" needs a label.`;
        if (f.kind === "select" && (!f.options || f.options.filter((o) => o.trim()).length === 0)) {
          return `Group "${g.name}": select field "${f.key}" needs at least one option.`;
        }
      }
    }
    return null;
  }

  function addIntakeGroup() {
    setError(null);
    setSaved(null);
    if (intakeGroups.length >= MAX_INTAKE_GROUPS) {
      setError(`You can define up to ${MAX_INTAKE_GROUPS} custom intake groups.`);
      return;
    }
    setIntakeGroups((list) => [
      ...list,
      {
        id: newGroupId(),
        name: "",
        appliesTo: "both",
        enabled: true,
        fields: [
          { key: "", label: "", kind: "text" },
        ],
      },
    ]);
    setConfirmRemoveGroup(null);
  }

  function updateGroup(i: number, patch: Partial<CustomIntakeGroup>) {
    setError(null);
    setSaved(null);
    setIntakeGroups((list) => list.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  }

  function removeGroup(i: number) {
    setError(null);
    setSaved(null);
    setConfirmRemoveGroup(null);
    setIntakeGroups((list) => list.filter((_, j) => j !== i));
  }

  function addGroupField(gi: number) {
    setError(null);
    setSaved(null);
    setIntakeGroups((list) =>
      list.map((g, j) =>
        j === gi
          ? {
              ...g,
              fields:
                g.fields.length >= MAX_GROUP_FIELDS
                  ? g.fields
                  : [...g.fields, { key: "", label: "", kind: "text" as IntakeGroupFieldKind }],
            }
          : g,
      ),
    );
  }

  function updateGroupField(
    gi: number,
    fi: number,
    patch: Partial<CustomIntakeField>,
    opts?: { autoKey?: boolean },
  ) {
    setError(null);
    setSaved(null);
    setIntakeGroups((list) =>
      list.map((g, j) => {
        if (j !== gi) return g;
        const fields = g.fields.map((f, k) => {
          if (k !== fi) return f;
          const next = { ...f, ...patch };
          // Auto-derive a key from the label while the key is still empty —
          // the owner can then edit it freely.
          if (opts?.autoKey && !f.key.trim() && typeof patch.label === "string") {
            next.key = slugify(patch.label);
          }
          return next;
        });
        return { ...g, fields };
      }),
    );
  }

  function removeGroupField(gi: number, fi: number) {
    setError(null);
    setSaved(null);
    setIntakeGroups((list) =>
      list.map((g, j) => (j === gi ? { ...g, fields: g.fields.filter((_, k) => k !== fi) } : g)),
    );
  }

  function updateOption(gi: number, fi: number, oi: number, value: string) {
    setError(null);
    setSaved(null);
    setIntakeGroups((list) =>
      list.map((g, j) =>
        j === gi
          ? {
              ...g,
              fields: g.fields.map((f, k) =>
                k === fi ? { ...f, options: (f.options ?? []).map((o, m) => (m === oi ? value : o)) } : f,
              ),
            }
          : g,
      ),
    );
  }

  function addOption(gi: number, fi: number) {
    setError(null);
    setSaved(null);
    setIntakeGroups((list) =>
      list.map((g, j) =>
        j === gi
          ? {
              ...g,
              fields: g.fields.map((f, k) => (k === fi ? { ...f, options: [...(f.options ?? []), ""] } : f)),
            }
          : g,
      ),
    );
  }

  function removeOption(gi: number, fi: number, oi: number) {
    setError(null);
    setSaved(null);
    setIntakeGroups((list) =>
      list.map((g, j) =>
        j === gi
          ? {
              ...g,
              fields: g.fields.map((f, k) =>
                k === fi ? { ...f, options: (f.options ?? []).filter((_, m) => m !== oi) } : f,
              ),
            }
          : g,
      ),
    );
  }

  async function saveIntakeGroups() {
    setError(null);
    setSaved(null);
    const problem = validateIntakeGroupList(intakeGroups);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await api.updateSettings({
        customIntakeGroups: intakeGroups.map((g) => ({
          id: g.id,
          name: g.name.trim(),
          appliesTo: g.appliesTo,
          enabled: g.enabled,
          fields: g.fields.map((f) => ({
            key: f.key,
            label: f.label.trim(),
            kind: f.kind,
            ...(f.kind === "select" ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
          })),
        })),
      });
      setSaved("Custom intake groups saved.");
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

        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Account setup</h2>
            <p className="admin-card-sub">
              How your business works — the intake form adapts to this so your team only ever
              sees the fields that matter. Set once when you set up your workspace.
            </p>
          </div>
          <div className="form">
            <div className="field">
              <span className="field-label">Service model</span>
              <div className="seg intake-seg" role="radiogroup" aria-label="Service model">
                {(
                  [
                    ["residential_only", "Residential only"],
                    ["commercial_only", "Commercial only"],
                    ["both", "Both"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    role="radio"
                    aria-checked={serviceModel === val}
                    className={serviceModel === val ? "seg-btn active" : "seg-btn"}
                    onClick={() => {
                      setError(null);
                      setSaved(null);
                      setServiceModel(val);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Delivery type</span>
              <div className="seg intake-seg" role="radiogroup" aria-label="Delivery type">
                {(
                  [
                    ["client_comes", "Client comes to us"],
                    ["we_go", "We go to client"],
                    ["both", "Both"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    role="radio"
                    aria-checked={deliveryType === val}
                    className={deliveryType === val ? "seg-btn active" : "seg-btn"}
                    onClick={() => {
                      setError(null);
                      setSaved(null);
                      setDeliveryType(val);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="intake-industry">
                Industry
              </label>
              <select
                id="intake-industry"
                value={industry === "" ? "other" : industry}
                onChange={(e) => {
                  setError(null);
                  setSaved(null);
                  setIndustry(e.target.value as OrgSettings["industry"]);
                }}
              >
                <option value="home_services">Home services</option>
                <option value="mobile_personal">Mobile personal services</option>
                <option value="professional">Professional services</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <span className="field-label">Optional intake fields</span>
              <div className="intake-opts">
                {INTAKE_OPT_LABELS.map((g) => (
                  <label className="intake-opt" key={g.id}>
                    <input
                      type="checkbox"
                      checked={intakeOpts.includes(g.id)}
                      onChange={() => toggleIntakeOpt(g.id)}
                    />
                    <span>{g.label}</span>
                  </label>
                ))}
              </div>
              <span className="field-hint">
                Optional groups are only available when they fit your industry — e.g. an HOA
                field for home services, parking/pet fields for mobile personal services.
              </span>
            </div>
            <div className="stage-save">
              <button className="btn btn-primary" disabled={busy} onClick={saveIntakeSetup}>
                {busy ? "Saving…" : "Save account setup"}
              </button>
            </div>
          </div>
        </div>

        <div className="card admin-table cg-card">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Custom intake groups</h2>
            <p className="admin-card-sub">
              Your own conditional intake sections, on top of the presets — for any industry,
              not just "Other". Each group appears in the client form only for the client type
              it applies to, and only while it's enabled. Values save per client and prefill on edit.
            </p>
          </div>
          {intakeGroups.length === 0 ? (
            <p className="field-hint cfdef-empty">
              No custom intake groups yet — add one (e.g. "Fleet details" with a "Fleet size"
              text field and a "Region" select, applies to Commercial clients).
            </p>
          ) : (
            <div className="cg-list">
              {intakeGroups.map((g, gi) => (
                <div className="cg-group" key={g.id}>
                  <div className="cg-head">
                    <div className="cg-head-main">
                      <label className="check cg-enabled">
                        <input
                          type="checkbox"
                          checked={g.enabled}
                          onChange={(e) => updateGroup(gi, { enabled: e.target.checked })}
                        />
                        <span>Enabled</span>
                      </label>
                      <input
                        className="cg-name"
                        value={g.name}
                        onChange={(e) => updateGroup(gi, { name: e.target.value })}
                        placeholder="Group name (e.g. Fleet details)"
                        maxLength={80}
                        aria-label={`Group ${gi + 1} name`}
                      />
                      <select
                        className="cg-applies"
                        value={g.appliesTo}
                        onChange={(e) => updateGroup(gi, { appliesTo: e.target.value as IntakeGroupAppliesTo })}
                        aria-label={`Group ${gi + 1} applies to`}
                      >
                        <option value="both">Commercial &amp; Individual</option>
                        <option value="commercial">Commercial only</option>
                        <option value="individual">Individual only</option>
                      </select>
                    </div>
                    {confirmRemoveGroup === gi ? (
                      <span className="cfdef-confirm">
                        <span className="cfdef-confirm-q">Remove this group? Existing client values are kept.</span>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => removeGroup(gi)}
                          disabled={busy}
                        >
                          Yes, remove
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setConfirmRemoveGroup(null)}
                          disabled={busy}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={() => setConfirmRemoveGroup(gi)}
                        disabled={busy}
                        aria-label={`Remove group ${g.name}`}
                      >
                        Remove group
                      </button>
                    )}
                  </div>
                  <div className="cg-fields">
                    {g.fields.map((f, fi) => (
                      <div className="cg-field" key={`${g.id}-${fi}`}>
                        <div className="cg-field-row">
                          <input
                            className="cg-flabel"
                            value={f.label}
                            onChange={(e) => updateGroupField(gi, fi, { label: e.target.value }, { autoKey: true })}
                            placeholder="Field label (e.g. Fleet size)"
                            maxLength={80}
                            aria-label={`Field ${fi + 1} label`}
                          />
                          <input
                            className="cg-fkey"
                            value={f.key}
                            onChange={(e) => updateGroupField(gi, fi, { key: e.target.value })}
                            placeholder="key (e.g. fleet_size)"
                            maxLength={40}
                            aria-label={`Field ${fi + 1} key`}
                          />
                          <select
                            className="cg-fkind"
                            value={f.kind}
                            onChange={(e) =>
                              updateGroupField(gi, fi, { kind: e.target.value as IntakeGroupFieldKind })
                            }
                            aria-label={`Field ${fi + 1} kind`}
                          >
                            {(Object.keys(INTAKE_GROUP_KIND_LABELS) as IntakeGroupFieldKind[]).map((k) => (
                              <option key={k} value={k}>
                                {INTAKE_GROUP_KIND_LABELS[k]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => removeGroupField(gi, fi)}
                            disabled={busy}
                            aria-label={`Remove field ${f.label || f.key}`}
                          >
                            ✕
                          </button>
                        </div>
                        {f.kind === "select" && (
                          <div className="cg-opts">
                            {(f.options ?? []).map((o, oi) => (
                              <div className="cg-opt" key={oi}>
                                <input
                                  value={o}
                                  onChange={(e) => updateOption(gi, fi, oi, e.target.value)}
                                  placeholder={`Option ${oi + 1}`}
                                  maxLength={100}
                                  aria-label={`Option ${oi + 1} for ${f.label || f.key}`}
                                />
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  onClick={() => removeOption(gi, fi, oi)}
                                  disabled={busy}
                                  aria-label={`Remove option ${oi + 1}`}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOption(gi, fi)}>
                              + Add option
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => addGroupField(gi)}>
                    + Add field
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="cg-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={addIntakeGroup} disabled={busy}>
              + Add group
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={saveIntakeGroups}>
              {busy ? "Saving…" : "Save custom intake groups"}
            </button>
          </div>
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
