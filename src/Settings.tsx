import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import {
  CUSTOM_FIELD_TYPES,
  TENANT_TABS,
  type CustomFieldDef,
  type CustomFieldType,
  type CustomIntakeGroup,
  type CustomIntakeField,
  type IntakeGroupAppliesTo,
  type IntakeGroupFieldKind,
  type OrgMember,
  type OrgSettings,
  type TabPermissions,
  type TenantTab,
  money,
} from "./types";
import StageEditor from "./StageEditor";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { ALL_VERTICALS, verticalLabel } from "./verticals";

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
export default function Settings({
  canEdit = true,
  isOrgAdmin = false,
  currentUserId,
  isOwnerOrg = false,
}: {
  /** Team-users UI (owner request 2026-08-14) — false for a restricted member
   *  with view-only "settings" access: every save/apply affordance is hidden
   *  (the server still 403s the write). Owner and org admins always true. */
  canEdit?: boolean;
  /** Effective org admin (stored role='admin' OR the account's original owner
   *  login — the server reports this on /api/auth/me). Only org admins see
   *  and manage the Team members section; the server 403s the routes for
   *  everyone else. */
  isOrgAdmin?: boolean;
  /** The session user's id — marks "you" on the member list. */
  currentUserId?: number;
  /** True only for the OWNER workspace org (used by the team-members section
   *  gate below; the agreement template editor moved to Administration →
   *  Agreements in 2026-08-17 — Settings no longer hosts it). */
  isOwnerOrg?: boolean;
}) {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* Workspace (branding) */
  const [orgName, setOrgName] = useState("");
  const [accentColor, setAccentColor] = useState("#d6ff3f");

  /* Custom fields (Phase 3b; 3f-1 adds select fields with options) */
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>("text");
  const [newFieldOptions, setNewFieldOptions] = useState<string[]>([]);
  const [confirmRemoveField, setConfirmRemoveField] = useState<number | null>(null);

  /* 3f-1: the business type picker for the additive "Apply template" path */
  const [applyVertical, setApplyVertical] = useState("b2b");

  /* Adaptive intake (Phase 1): account-level vertical config */
  const [serviceModel, setServiceModel] = useState<OrgSettings["serviceModel"]>("both");
  const [deliveryType, setDeliveryType] = useState<OrgSettings["deliveryType"]>("both");
  const [industry, setIndustry] = useState<OrgSettings["industry"]>("");
  const [intakeOpts, setIntakeOpts] = useState<string[]>([]);

  /* Adaptive intake Phase 3: custom conditional field groups */
  const [intakeGroups, setIntakeGroups] = useState<CustomIntakeGroup[]>([]);
  const [confirmRemoveGroup, setConfirmRemoveGroup] = useState<number | null>(null);

  /* Owner request 2026-08-14 — revenue model (tenant-editable) + the monthly
     subscription amount this org pays the owner (owner-set in Admin; the
     tenant can see it here but not change it). */
  const [revenueModel, setRevenueModel] = useState<OrgSettings["revenueModel"]>("sales");
  const [monthlySubscriptionAmount, setMonthlySubscriptionAmount] = useState(0);

  /* Appointments production (backlog 5a104eae): per-account toggle — 1 lets
     this account's clients schedule appointments for themselves. Each org
     (owner or client) controls its OWN setting; the server persists + enforces
     it per org. */
  const [allowSelfSchedule, setAllowSelfSchedule] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  /* 3k — change password (authenticated; the existing session stays valid) */
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState<string | null>(null);

  /* Phase 5 prep — self-serve data export state (owner decision 2026-08-29,
     option b: tenant workspaces keep the "Your data" card HERE in Settings;
     the owner's copy lives under Administration). */
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  /* Phase 5 prep — tenant self-service: self-serve cancel. */
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [canceledInfo, setCanceledInfo] = useState<{ message: string; retentionUntil: string } | null>(null);

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(null);
    if (!curPw) {
      setPwError("Enter your current password.");
      return;
    }
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwBusy(true);
    try {
      const res = await api.changePassword(curPw, newPw);
      setPwSaved(res.message);
      setCurPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Change failed.");
    } finally {
      setPwBusy(false);
    }
  }

  /* Phase 5 prep — self-serve data export: downloads this workspace's own
     data as a JSON file (server-scoped by org_id; credentials never leave
     the server). Read-only — available to any settings reader. */
  async function handleExport() {
    setExportBusy(true);
    setExportMsg(null);
    setExportError(null);
    try {
      const res = await api.exportData();
      setExportMsg(
        `Downloaded ${res.filename} — it contains every record in this workspace.`,
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }
  /* Phase 5 prep — self-serve cancel (org admin only; the server guards the
     owner workspace). Cancellation is effective immediately for sign-in; the
     data is RETAINED 30 days (never hard-deleted). The server clears the
     session cookie, so after success this page shows the canceled notice and
     the next API call signs the shell out (the login page then shows the
     server's clear "account canceled" message with the retention date). */
  async function handleCancelAccount() {
    setCancelBusy(true);
    setCancelError(null);
    try {
      const res = await api.cancelAccount();
      setCanceledInfo({ message: res.message, retentionUntil: res.retentionUntil });
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Could not cancel the account.");
    } finally {
      setCancelBusy(false);
    }
  }

  /* ── Team members (owner request 2026-08-14) ──────────────────────
     Org-admin only (isOrgAdmin — the account's original owner login or a
     stored role='admin' member; the server 403s the routes otherwise).
     Passwords are write-only: the admin types a temp password at create/
     reset; the API hashes it and never returns it, so the admin passes it
     to the member themselves. */
  const MEMBER_TAB_LABELS: { tab: TenantTab; label: string }[] = [
    { tab: "clients", label: "Clients" },
    { tab: "tasks", label: "Tasks" },
    { tab: "finance", label: "Finance" },
    { tab: "settings", label: "Settings" },
    { tab: "support", label: "Support" },
  ];
  type PermChoice = "view" | "edit" | "none";
  const PERM_OPTIONS: { value: PermChoice; label: string }[] = [
    { value: "view", label: "View only" },
    { value: "edit", label: "Can edit" },
    { value: "none", label: "No access" },
  ];
  function allViewChoices(): Record<TenantTab, PermChoice> {
    return Object.fromEntries(TENANT_TABS.map((t) => [t, "view" as PermChoice])) as Record<
      TenantTab,
      PermChoice
    >;
  }
  function permToChoice(p: TabPermissions, tab: TenantTab): PermChoice {
    if (p[tab] === undefined) return "none";
    return p[tab]!.edit ? "edit" : "view";
  }
  function choicesToPerm(c: Record<TenantTab, PermChoice>): TabPermissions {
    const out: TabPermissions = {};
    for (const t of TENANT_TABS) {
      if (c[t] === "none") continue;
      out[t] = { edit: c[t] === "edit" };
    }
    return out;
  }
  function permSummary(p: TabPermissions): { tab: TenantTab; label: string; choice: PermChoice }[] {
    return MEMBER_TAB_LABELS.map(({ tab, label }) => ({ tab, label, choice: permToChoice(p, tab) }));
  }

  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersSaved, setMembersSaved] = useState<string | null>(null);
  const [membersBusy, setMembersBusy] = useState(false);

  /* Add-member form */
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"member" | "admin">("member");
  const [newChoices, setNewChoices] = useState<Record<TenantTab, PermChoice>>(() => allViewChoices());

  /* Edit-member inline panel (role + per-tab access) */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<"member" | "admin">("member");
  const [editChoices, setEditChoices] = useState<Record<TenantTab, PermChoice>>(() => allViewChoices());

  /* Reset-password inline form (a small form, never a visible password in the list) */
  const [resetForId, setResetForId] = useState<number | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");

  /* Typed-confirm removal */
  const [deletingMember, setDeletingMember] = useState<OrgMember | null>(null);

  const loadMembers = useCallback(async () => {
    setMembersError(null);
    try {
      const { members: list } = await api.orgMembers();
      setMembers(list);
    } catch (e) {
      setMembersError(e instanceof Error ? e.message : "Failed to load team members.");
    }
  }, []);

  useEffect(() => {
    if (isOrgAdmin) loadMembers();
  }, [isOrgAdmin, loadMembers]);

  function beginEdit(m: OrgMember) {
    setMembersError(null);
    setMembersSaved(null);
    setResetForId(null);
    setResetPasswordValue("");
    setEditingId(m.id);
    setEditRole(m.role);
    setEditChoices({
      clients: permToChoice(m.permissions, "clients"),
      tasks: permToChoice(m.permissions, "tasks"),
      finance: permToChoice(m.permissions, "finance"),
      settings: permToChoice(m.permissions, "settings"),
      support: permToChoice(m.permissions, "support"),
    });
  }

  function beginReset(m: OrgMember) {
    setMembersError(null);
    setMembersSaved(null);
    setEditingId(null);
    setResetPasswordValue("");
    setResetForId(m.id);
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setMembersError(null);
    setMembersSaved(null);
    const email = newEmail.trim();
    if (!email) {
      setMembersError("Member email is required.");
      return;
    }
    if (newPassword.length < 8) {
      setMembersError("Temporary password must be at least 8 characters.");
      return;
    }
    setMembersBusy(true);
    try {
      await api.createOrgMember({
        email,
        password: newPassword,
        role: newRole,
        ...(newRole === "member" ? { permissions: choicesToPerm(newChoices) } : {}),
      });
      setMembersSaved("Member added — share the temporary password with them (it is only shown to you, once).");
      setNewEmail("");
      setNewPassword("");
      setNewRole("member");
      setNewChoices(allViewChoices());
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Add failed.");
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleSaveMember() {
    if (editingId === null) return;
    setMembersError(null);
    setMembersSaved(null);
    setMembersBusy(true);
    try {
      await api.updateOrgMember(editingId, {
        role: editRole,
        ...(editRole === "member" ? { permissions: choicesToPerm(editChoices) } : {}),
      });
      setMembersSaved("Member updated.");
      setEditingId(null);
      await loadMembers();
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleResetPassword() {
    if (resetForId === null) return;
    setMembersError(null);
    setMembersSaved(null);
    if (resetPasswordValue.length < 8) {
      setMembersError("New password must be at least 8 characters.");
      return;
    }
    setMembersBusy(true);
    try {
      await api.updateOrgMember(resetForId, { password: resetPasswordValue });
      setMembersSaved("Password reset — share the new temporary password with the member.");
      setResetForId(null);
      setResetPasswordValue("");
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setMembersBusy(false);
    }
  }

  async function handleRemoveMember() {
    if (!deletingMember) return;
    setMembersError(null);
    setMembersSaved(null);
    setMembersBusy(true);
    try {
      await api.deleteOrgMember(deletingMember.id);
      setMembersSaved("Member removed.");
      setDeletingMember(null);
      await loadMembers();
    } catch (err) {
      /* The server's last-admin protection (400) surfaces here verbatim. */
      setMembersError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setMembersBusy(false);
    }
  }

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
      // 3f-1 (owner direction 2026-08-16): the apply-select offers only
      // B2B/B2C — default it to the org's stored type when it maps, else B2B
      // (the default type; legacy keys from the retired catalog display as
      // B2B and re-applying the B2B template is the migration path).
      setApplyVertical(
        ALL_VERTICALS.some((v) => v.key === settings.verticalKey) ? settings.verticalKey : "b2b",
      );
      setRevenueModel(settings.revenueModel);
      setMonthlySubscriptionAmount(settings.monthlySubscriptionAmount);
      setAllowSelfSchedule(!!settings.allowSelfSchedule);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load settings.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Native e-signature — the agreement template editor MOVED to the owner's
     Administration → Agreements section (owner direction 2026-08-17); the
     save lives in src/Admin.tsx now. Settings no longer hosts it. */
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

  // UI-only list of optional intake groups shown as checkboxes. NOTE: this is
  // deliberately NOT derived from server/db.ts INTAKE_OPT_GROUPS — we filter
  // out "hoa_restrictions" here on purpose. Per the adaptive-intake spec Step 4,
  // the Individual HOA flag is a per-client checkbox in the intake form, so an
  // account-level HOA toggle gates nothing and would be a dead control. The
  // server still accepts "hoa_restrictions" as a valid intake_opts id so orgs
  // that already stored it keep round-tripping it without breaking.
  const INTAKE_OPT_LABELS: { id: string; label: string }[] = [
    { id: "business_llc_tab", label: "Business Name / LLC tab" },
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

  /* ── 3f-1: apply a vertical template (change business type) ────── */
  async function applyVerticalTemplate() {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      await api.updateSettings({ verticalKey: applyVertical });
      setSaved(
        `Business type updated to ${verticalLabel(applyVertical)} — only missing stages and custom fields were added, nothing was renamed, removed or reordered.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setBusy(false);
    }
  }

  /* ── Owner request 2026-08-14: revenue model ─────────────────────
     The tenant chooses how THEIR business makes money: sales (invoices) or
     subscriptions (a recurring monthly book). The dashboard's money figure
     follows this choice. The amount they pay the owner is NOT editable here
     (owner-set in Admin). */
  async function saveRevenueModel() {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      await api.updateSettings({ revenueModel });
      setSaved("Revenue model saved — your dashboard money figure updates to match.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  /* ── Appointments production (backlog 5a104eae): self-schedule ──
     Per-account toggle — 1 lets this account's clients schedule appointments
     for themselves. Persists through the same Settings PUT; the server
     enforces it on /api/org/appointments POST. */
  async function saveAppointmentPrefs() {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      await api.updateSettings({ allowSelfSchedule });
      setSaved(
        allowSelfSchedule
          ? "Clients can now schedule appointments for themselves."
          : "Self-scheduling turned off.",
      );
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
      if (f.type === "select") {
        const opts = (f.options ?? []).filter((o) => o.trim());
        if (opts.length === 0) return `Field "${f.name}" needs at least one option for type select.`;
        if (opts.length > 50) return `Field "${f.name}" has too many options (max 50).`;
        for (const o of opts) {
          if (o.trim().length > 100) return `Field "${f.name}" options must be under 101 characters.`;
        }
      }
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
    const def: CustomFieldDef =
      newFieldType === "select"
        ? { name, type: "select", options: newFieldOptions.map((o) => o.trim()).filter(Boolean) }
        : { name, type: newFieldType };
    const problem = validateCustomFieldList([...customFields, def]);
    if (problem) {
      setError(problem);
      return;
    }
    setCustomFields((list) => [...list, def]);
    setNewFieldName("");
    setNewFieldOptions([]);
  }

  function removeField(i: number) {
    setError(null);
    setSaved(null);
    setConfirmRemoveField(null);
    setCustomFields((list) => list.filter((_, j) => j !== i));
  }

  /* 3f-1: select custom fields carry editable options (same UI as intake
     group selects). */
  function updateFieldOption(i: number, oi: number, value: string) {
    setError(null);
    setSaved(null);
    setCustomFields((list) =>
      list.map((f, j) =>
        j === i
          ? { ...f, options: (f.options ?? []).map((o, m) => (m === oi ? value : o)) }
          : f,
      ),
    );
  }

  function addFieldOption(i: number) {
    setError(null);
    setSaved(null);
    setCustomFields((list) =>
      list.map((f, j) => (j === i ? { ...f, options: [...(f.options ?? []), ""] } : f)),
    );
  }

  function removeFieldOption(i: number, oi: number) {
    setError(null);
    setSaved(null);
    setCustomFields((list) =>
      list.map((f, j) =>
        j === i ? { ...f, options: (f.options ?? []).filter((_, m) => m !== oi) } : f,
      ),
    );
  }

  function updateNewFieldOption(oi: number, value: string) {
    setError(null);
    setSaved(null);
    setNewFieldOptions((list) => list.map((o, m) => (m === oi ? value : o)));
  }

  function addNewFieldOption() {
    setError(null);
    setSaved(null);
    setNewFieldOptions((list) => [...list, ""]);
  }

  function removeNewFieldOption(oi: number) {
    setError(null);
    setSaved(null);
    setNewFieldOptions((list) => list.filter((_, m) => m !== oi));
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
        customFields: customFields.map((f) => ({
          name: f.name.trim(),
          type: f.type,
          ...(f.type === "select"
            ? { options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) }
            : {}),
        })),
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
    <div className="page page-stack">
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
      {!canEdit && (
        <div className="alert" role="status">
          You have view-only access to settings — changes are disabled.
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
                disabled={!canEdit}
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
                  disabled={!canEdit}
                />
                <input
                  className="accent-hex"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  maxLength={7}
                  placeholder="#d6ff3f"
                  aria-label="Accent color hex"
                  disabled={!canEdit}
                />
              </div>
            </div>
            {canEdit && (
              <button className="btn btn-primary" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save branding"}
              </button>
            )}
          </form>
        </div>

        {!isOwnerOrg && (
        <>
        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Business type</h2>
            <p className="admin-card-sub">
              The type this workspace was set up for — it seeded your pipeline stages when the
              account was created. You can switch anytime.
            </p>
          </div>
          <div className="form">
            <div className="field">
              <span className="field-label">Current business type</span>
              <div>
                <span className="badge tone-lime">{verticalLabel(settings.verticalKey)}</span>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="apply-vertical">
                Apply a different type
              </label>
              <select
                id="apply-vertical"
                value={applyVertical}
                onChange={(e) => {
                  setError(null);
                  setSaved(null);
                  setApplyVertical(e.target.value);
                }}
              >
                {ALL_VERTICALS.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Applying is <strong>additive and non-destructive</strong>: stages and custom
                fields the type presets that you don't already have are added at the end —
                nothing is renamed, removed or reordered. Your industry / service model /
                delivery settings update to the type's defaults.
              </span>
            </div>
            <div className="stage-save">
              {canEdit && (
                <button className="btn btn-primary" disabled={busy} onClick={applyVerticalTemplate}>
                  {busy ? "Applying…" : "Apply template"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Revenue model</h2>
            <p className="admin-card-sub">
              How your business gets paid — your dashboard's money figure follows this.
            </p>
          </div>
          <div className="form">
            <div className="field">
              <span className="field-label">Revenue model</span>
              <div className="seg intake-seg" role="radiogroup" aria-label="Revenue model">
                {(
                  [
                    ["sales", "Sales"],
                    ["subscription", "Subscriptions"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    role="radio"
                    aria-checked={revenueModel === val}
                    className={revenueModel === val ? "seg-btn active" : "seg-btn"}
                    onClick={() => {
                      setError(null);
                      setSaved(null);
                      setRevenueModel(val);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="field-hint">
                <strong>Sales</strong> shows "Sales this month" — your invoices dated this month.
                <strong> Subscriptions</strong> shows your clients' recurring monthly amounts.
              </span>
            </div>
            <div className="field">
              <span className="field-label">Your monthly subscription to Revzenta</span>
              <div className="revenue-amount-line">
                <strong className="revenue-amount">{money(monthlySubscriptionAmount)}</strong>
                <span className="field-hint">per month — set by your account manager.</span>
              </div>
            </div>
            <div className="stage-save">
              {canEdit && (
                <button className="btn btn-primary" disabled={busy} onClick={saveRevenueModel}>
                  {busy ? "Saving…" : "Save revenue model"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Appointments</h2>
            <p className="admin-card-sub">
              Whether clients on this account can book their own appointment times.
            </p>
          </div>
          <div className="form">
            <div className="field">
              <label className="checkbox-line" htmlFor="allow-self-schedule">
                <input
                  id="allow-self-schedule"
                  type="checkbox"
                  checked={allowSelfSchedule}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setError(null);
                    setSaved(null);
                    setAllowSelfSchedule(e.target.checked);
                  }}
                />
                <span className="field-label">
                  Allow clients to schedule appointments for themselves
                </span>
              </label>
              <span className="field-hint">
                When on, a client on this account can book a slot from their Appointments
                tab. When off, they can view and reschedule their existing appointments
                but not create new ones.
              </span>
            </div>
            <div className="stage-save">
              {canEdit && (
                <button className="btn btn-primary" disabled={busy} onClick={saveAppointmentPrefs}>
                  {busy ? "Saving…" : "Save appointment settings"}
                </button>
              )}
            </div>
          </div>
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
                Optional groups are only available when they fit your industry — e.g.
                parking/pet fields for mobile personal services.
              </span>
            </div>
            <div className="stage-save">
              {canEdit && (
                <button className="btn btn-primary" disabled={busy} onClick={saveIntakeSetup}>
                  {busy ? "Saving…" : "Save account setup"}
                </button>
              )}
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
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => setConfirmRemoveGroup(gi)}
                      disabled={busy}
                      aria-label={`Remove group ${g.name}`}
                    >
                      Remove group
                    </button>
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
            {canEdit && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={addIntakeGroup} disabled={busy}>
                + Add group
              </button>
            )}
            {canEdit && (
              <button className="btn btn-primary" disabled={busy} onClick={saveIntakeGroups}>
                {busy ? "Saving…" : "Save custom intake groups"}
              </button>
            )}
          </div>
        </div>
        </>
        )}

        <div className="card admin-table">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Pipeline stages</h2>
            <p className="admin-card-sub">
              Rename, reorder and shape the pipeline to your business. Renaming a stage keeps
              its clients; removing one is blocked while clients are still in it.
            </p>
          </div>
          <StageEditor initialStages={settings.stages} stageCounts={settings.stageCounts} canEdit={canEdit} />
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
                <div className="cfdef-item" key={i}>
                  <div className="cfdef-row">
                    <span className="cfdef-name">{f.name}</span>
                    <span className="badge tone-gray cfdef-type">{f.type}</span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => setConfirmRemoveField(i)}
                      disabled={busy}
                      aria-label={`Remove custom field ${f.name}`}
                    >
                      Remove
                    </button>
                  </div>
                  {f.type === "select" && (
                    <div className="cg-opts cfdef-opts">
                      {(f.options ?? []).map((o, oi) => (
                        <div className="cg-opt" key={oi}>
                          <input
                            value={o}
                            onChange={(e) => updateFieldOption(i, oi, e.target.value)}
                            placeholder={`Option ${oi + 1}`}
                            maxLength={100}
                            aria-label={`Option ${oi + 1} for ${f.name}`}
                          />
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => removeFieldOption(i, oi)}
                            disabled={busy}
                            aria-label={`Remove option ${oi + 1} for ${f.name}`}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => addFieldOption(i)}>
                        + Add option
                      </button>
                    </div>
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
          {newFieldType === "select" && (
            <div className="cg-opts cfdef-opts">
              {newFieldOptions.map((o, oi) => (
                <div className="cg-opt" key={oi}>
                  <input
                    value={o}
                    onChange={(e) => updateNewFieldOption(oi, e.target.value)}
                    placeholder={`Option ${oi + 1}`}
                    maxLength={100}
                    aria-label={`New field option ${oi + 1}`}
                  />
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => removeNewFieldOption(oi)}
                    disabled={busy}
                    aria-label={`Remove new field option ${oi + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={addNewFieldOption}>
                + Add option
              </button>
            </div>
          )}
          <div className="stage-save">
            {canEdit && (
              <button className="btn btn-primary" disabled={busy} onClick={saveCustomFields}>
                {busy ? "Saving…" : "Save custom fields"}
              </button>
            )}
          </div>
        </div>

        {/* 3k — change password: current + new + confirm, verified server-side.
            The existing session stays valid after the change. */}
        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Change password</h2>
            <p className="admin-card-sub">
              Update the password you sign in with. You'll stay signed in here.
            </p>
          </div>
          {pwError && (
            <div className="alert alert-error" role="alert">
              {pwError}
            </div>
          )}
          {pwSaved && (
            <div className="alert alert-success" role="status">
              {pwSaved}
            </div>
          )}
          <form onSubmit={savePassword} className="form">
            <label className="field">
              <span className="field-label">Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
            <label className="field">
              <span className="field-label">New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Repeat the new password"
                minLength={8}
                required
              />
            </label>
            <button className="btn btn-primary" disabled={pwBusy} type="submit">
              {pwBusy ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>

        {/* Phase 5 prep — self-serve data export (owner decision
            2026-08-29, option b): tenant workspaces keep the card HERE —
            self-serve export of this org's own data. Read-only: any
            settings reader (org admin or a member with settings access)
            can download it as a JSON file. The server scopes every query
            by org_id, so the file can never contain another tenant's rows.
            NOT rendered for the owner workspace — the owner's copy lives
            under Administration (Admin.tsx), so no user ever sees the
            card in two places. */}
        {!isOwnerOrg && (
          <div className="card admin-form">
            <div className="admin-card-head">
              <h2 className="admin-card-title">Your data</h2>
              <p className="admin-card-sub">
                Download everything in this workspace — clients, tasks, invoices, custom field
                values, support tickets and agreements — as a JSON file. Only this workspace's
                data is included, and no passwords or sign-in credentials.
              </p>
            </div>
            {exportError && (
              <div className="alert alert-error" role="alert">
                {exportError}
              </div>
            )}
            {exportMsg && (
              <div className="alert alert-success" role="status">
                {exportMsg}
              </div>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleExport}
              disabled={exportBusy}
            >
              {exportBusy ? "Preparing…" : "Export my data"}
            </button>
          </div>
        )}

      </div>

      {/* Team users per client account (owner request 2026-08-14) — the
          member-management UI. ORG ADMIN ONLY (isOrgAdmin: the account's
          original owner login or a stored role='admin' member; the server
          403s the routes for everyone else, so a non-admin never sees this
          section and cannot read the member list). Passwords are write-only:
          the admin types a temp password at create/reset; the API hashes it
          and never returns it — the admin passes it to the member directly. */}
      {isOrgAdmin && (
        <>
          <div className="card admin-form members-add-card">
            <div className="admin-card-head">
              <h2 className="admin-card-title">Add a team member</h2>
              <p className="admin-card-sub">
                A teammate signs in with their own email and a temporary password you set — it is
                hashed and never shown again, so share it with them yourself.
              </p>
            </div>
            {membersError && (
              <div className="alert alert-error" role="alert">
                {membersError}
              </div>
            )}
            {membersSaved && (
              <div className="alert alert-success" role="status">
                {membersSaved}
              </div>
            )}
            <form onSubmit={handleAddMember} className="form">
              <div className="member-form-grid">
                <label className="field">
                  <span className="field-label">Email</span>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="teammate@yourcompany.com"
                    maxLength={254}
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">Temporary password</span>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    minLength={8}
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <span className="field-hint">
                    Shown to you only at this moment — the member signs in with it and you can
                    reset it any time.
                  </span>
                </label>
                <div className="field">
                  <span className="field-label">Role</span>
                  <div className="seg intake-seg" role="radiogroup" aria-label="Member role">
                    {(
                      [
                        ["member", "Member"],
                        ["admin", "Admin"],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        role="radio"
                        aria-checked={newRole === val}
                        className={newRole === val ? "seg-btn active" : "seg-btn"}
                        onClick={() => {
                          setMembersError(null);
                          setMembersSaved(null);
                          setNewRole(val);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="field-hint">
                    {newRole === "admin"
                      ? "Admins have full access to every tab and manage team members."
                      : "Members get per-tab access — pick it below."}
                  </span>
                </div>
              </div>
              {newRole === "member" && (
                <div className="field">
                  <span className="field-label">Tab access</span>
                  <div className="perm-grid">
                    {MEMBER_TAB_LABELS.map(({ tab, label }) => (
                      <label className="perm-picker" key={tab}>
                        <span className="perm-picker-label">{label}</span>
                        <select
                          value={newChoices[tab]}
                          onChange={(e) =>
                            setNewChoices((c) => ({ ...c, [tab]: e.target.value as PermChoice }))
                          }
                          aria-label={`${label} access`}
                        >
                          {PERM_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <span className="field-hint">
                    "View only" lets them open the tab; "Can edit" lets them change data; "No
                    access" hides the tab. Default: all tabs view-only.
                  </span>
                </div>
              )}
              <div className="stage-save">
                <button className="btn btn-primary" disabled={membersBusy} type="submit">
                  {membersBusy ? "Adding…" : "Add member"}
                </button>
              </div>
            </form>
          </div>

          <div className="card admin-table members-card">
            <div className="admin-card-head">
              <h2 className="admin-card-title">Team members</h2>
              <p className="admin-card-sub">
                Everyone who can sign in to this workspace. Role and per-tab access are
                enforced server-side on every route.
              </p>
            </div>
            {members === null ? (
              <div className="skeleton-block" aria-label="Loading team members" />
            ) : members.length === 0 ? (
              <p className="field-hint cfdef-empty">No team members yet — add one above.</p>
            ) : (
              <div className="members-list">
                {members.map((m) => {
                  const summary = permSummary(m.permissions);
                  const isMe = m.id === currentUserId;
                  return (
                    <div className="member-row" key={m.id}>
                      <div className="member-main">
                        <div className="member-email">
                          <span className="cell-name">{m.email}</span>
                          {isMe && <span className="chip chip-archived">you</span>}
                        </div>
                        <div className="member-meta">
                          <span
                            className={`badge ${m.role === "admin" ? "tone-lime" : "tone-gray"}`}
                          >
                            {m.role === "admin" ? "Admin" : "Member"}
                          </span>
                          <span className="member-added">
                            Added {m.createdAt ? m.createdAt.slice(0, 10) : "—"}
                          </span>
                        </div>
                        <div className="member-access" aria-label="Tab access">
                          {summary.map(({ tab, label, choice }) => (
                            <span
                              key={tab}
                              className={`badge ${
                                choice === "edit"
                                  ? "tone-lime"
                                  : choice === "view"
                                    ? "tone-blue"
                                    : "tone-gray"
                              }`}
                              title={`${label}: ${
                                choice === "edit"
                                  ? "Can edit"
                                  : choice === "view"
                                    ? "View only"
                                    : "No access"
                              }`}
                            >
                              {label}:{" "}
                              {choice === "edit" ? "Edit" : choice === "view" ? "View" : "—"}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="member-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => beginEdit(m)}
                          disabled={membersBusy}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => beginReset(m)}
                          disabled={membersBusy}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm danger"
                          onClick={() => setDeletingMember(m)}
                          disabled={membersBusy}
                        >
                          Remove
                        </button>
                      </div>

                      {editingId === m.id && (
                        <div className="member-inline-edit">
                          <div className="member-inline-head">
                            <strong>Edit {m.email}</strong>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => setEditingId(null)}
                              aria-label="Close member editor"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="field">
                            <span className="field-label">Role</span>
                            <div className="seg intake-seg" role="radiogroup" aria-label="Edit role">
                              {(
                                [
                                  ["member", "Member"],
                                  ["admin", "Admin"],
                                ] as const
                              ).map(([val, label]) => (
                                <button
                                  key={val}
                                  type="button"
                                  role="radio"
                                  aria-checked={editRole === val}
                                  className={editRole === val ? "seg-btn active" : "seg-btn"}
                                  onClick={() => {
                                    setMembersError(null);
                                    setMembersSaved(null);
                                    setEditRole(val);
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <span className="field-hint">
                              {editRole === "admin"
                                ? "Admins have full access to every tab and manage team members."
                                : "Members get per-tab access — pick it below."}
                            </span>
                          </div>
                          {editRole === "member" && (
                            <div className="field">
                              <span className="field-label">Tab access</span>
                              <div className="perm-grid">
                                {MEMBER_TAB_LABELS.map(({ tab, label }) => (
                                  <label className="perm-picker" key={tab}>
                                    <span className="perm-picker-label">{label}</span>
                                    <select
                                      value={editChoices[tab]}
                                      onChange={(e) =>
                                        setEditChoices((c) => ({
                                          ...c,
                                          [tab]: e.target.value as PermChoice,
                                        }))
                                      }
                                      aria-label={`Edit ${label} access`}
                                    >
                                      {PERM_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="member-inline-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={handleSaveMember}
                              disabled={membersBusy}
                            >
                              {membersBusy ? "Saving…" : "Save changes"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditingId(null)}
                              disabled={membersBusy}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {resetForId === m.id && (
                        <div className="member-inline-reset">
                          <span className="field-label">New temporary password</span>
                          <div className="member-reset-row">
                            <input
                              type="text"
                              value={resetPasswordValue}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              placeholder="At least 8 characters"
                              minLength={8}
                              autoComplete="off"
                              spellCheck={false}
                              aria-label="New temporary password"
                            />
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={handleResetPassword}
                              disabled={membersBusy || resetPasswordValue.length < 8}
                            >
                              {membersBusy ? "Setting…" : "Set password"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setResetForId(null)}
                              disabled={membersBusy}
                            >
                              Cancel
                            </button>
                          </div>
                          <span className="field-hint">
                            The member signs in with this next time — share it with them directly.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Phase 5 prep — self-serve cancel/offboarding. Rendered LAST as the
          final section of Settings. ORG ADMIN ONLY and never the owner
          workspace (the server 403s both). Cancellation is effective
          immediately for sign-in; the data is RETAINED 30 days (contract:
          30-day data retention, no partial-month refunds). */}
      {isOrgAdmin && !isOwnerOrg && (
        <div className="card admin-form">
          <div className="admin-card-head">
            <h2 className="admin-card-title">Cancel account</h2>
            <p className="admin-card-sub">
              Canceling ends sign-in access to this workspace immediately. Your data is
              retained for 30 days and no further charges are made; no partial-month
              refunds are given.
            </p>
          </div>
          {cancelError && (
            <div className="alert alert-error" role="alert">
              {cancelError}
            </div>
          )}
          {canceledInfo && (
            <div className="alert" role="status">
              <strong>{canceledInfo.message}</strong>{" "}
              {canceledInfo.retentionUntil
                ? `Your data is retained until ${canceledInfo.retentionUntil.slice(0, 10)}.`
                : ""}
            </div>
          )}
          {!canceledInfo && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmCancel(true)}
            >
              Cancel account…
            </button>
          )}
        </div>
      )}
      {deletingMember && (
        <ConfirmDeleteModal
          title="Remove team member?"
          entity={deletingMember.email}
          note={
            <p className="confirm-delete-note">
              They immediately lose access to this workspace. The account's last admin cannot be
              removed.
            </p>
          }
          busy={membersBusy}
          onCancel={() => setDeletingMember(null)}
          onConfirm={handleRemoveMember}
        />
      )}
      {confirmRemoveField !== null && (
        <ConfirmDeleteModal
          title="Remove custom field?"
          entity={customFields[confirmRemoveField]?.name || "this custom field"}
          note={
            <p className="confirm-delete-note">
              Clients keep their saved values for this field.
            </p>
          }
          busy={busy}
          onCancel={() => setConfirmRemoveField(null)}
          onConfirm={() => removeField(confirmRemoveField)}
        />
      )}
      {confirmRemoveGroup !== null && (
        <ConfirmDeleteModal
          title="Remove custom intake group?"
          entity={intakeGroups[confirmRemoveGroup]?.name || "this group"}
          note={
            <p className="confirm-delete-note">
              Existing client values are kept.
            </p>
          }
          busy={busy}
          onCancel={() => setConfirmRemoveGroup(null)}
          onConfirm={() => removeGroup(confirmRemoveGroup)}
        />
      )}
      {confirmCancel && (
        <ConfirmDeleteModal
          title="Cancel this account?"
          entity={settings ? settings.orgName : "this workspace"}
          note={
            <p className="confirm-delete-note">
              Everyone loses sign-in access immediately. Your data is retained for 30 days and
              no further charges will be made. This cannot be undone from this account.
            </p>
          }
          busy={cancelBusy}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={handleCancelAccount}
        />
      )}
    </div>
  );
}
