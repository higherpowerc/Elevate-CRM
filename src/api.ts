import type { AgreementEnvelope, Appointment, Client, CreatedOrg, CreatedOrgUser, CustomFieldDef, CustomIntakeGroup, DashboardData, Invoice, InvoiceStatus, MeResponse, Org, OrgMember, OrgSettings, ProvisionEvent, RevenueModel, TabPermissions, Task, Ticket, TicketPriority, TicketStatus, User } from "./types";

export class ApiError extends Error {
  status: number;
  body: { error?: string; message?: string } | null;
  constructor(status: number, message: string, body: { error?: string; message?: string } | null = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let body: { error?: string; message?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (res.status === 401) {
    // A live session expired or was rejected — the app shell signs back out.
    window.dispatchEvent(new Event("crm:unauthorized"));
    throw new ApiError(401, body?.error ?? "Not signed in.", body);
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status}).`, body);
  }
  return body as T;
}

export type ClientInput = Omit<Client, "id" | "createdAt" | "updatedAt">;

/** Writable task fields (server ignores unknown keys; client id optional). */
export type TaskInput = Omit<Task, "id" | "clientName" | "createdAt" | "updatedAt">;

/** Writable invoice fields (server ignores unknown keys; client id optional). */
export type InvoiceInput = Omit<Invoice, "id" | "clientName" | "createdAt" | "updatedAt">;

export const api = {
  me: () => request<MeResponse>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<MeResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  dashboard: () => request<DashboardData>("/api/dashboard"),
  clients: (includeArchived = false) =>
    request<{ clients: Client[] }>(`/api/clients${includeArchived ? "?archived=1" : ""}`),
  createClient: (data: ClientInput) =>
    request<{ client: Client }>("/api/clients", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateClient: (id: number, data: ClientInput) =>
    request<{ client: Client }>(`/api/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteClient: (id: number) =>
    request<{ ok: true }>(`/api/clients/${id}`, { method: "DELETE" }),

  tasks: (done?: "0" | "1") =>
    request<{ tasks: Task[] }>(`/api/tasks${done ? `?done=${done}` : ""}`),
  createTask: (data: Partial<TaskInput>) =>
    request<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTask: (id: number, data: Partial<TaskInput>) =>
    request<{ task: Task }>(`/api/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  toggleTask: (id: number) =>
    request<{ task: Task }>(`/api/tasks/${id}/toggle`, { method: "POST" }),
  deleteTask: (id: number) =>
    request<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }),

  invoices: (status?: InvoiceStatus) =>
    request<{ invoices: Invoice[] }>(`/api/invoices${status ? `?status=${status}` : ""}`),
  createInvoice: (data: Partial<InvoiceInput>) =>
    request<{ invoice: Invoice }>("/api/invoices", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateInvoice: (id: number, data: Partial<InvoiceInput>) =>
    request<{ invoice: Invoice }>(`/api/invoices/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteInvoice: (id: number) =>
    request<{ ok: true }>(`/api/invoices/${id}`, { method: "DELETE" }),

  /* Support tickets (owner direction 2026-08-15) — owner + tenant both create
     and list (each scoped to their own org; the owner's GET additionally
     carries every row's org name). PATCH is owner-only: the server rejects
     tenant writes with 403. */
  tickets: () => request<{ tickets: Ticket[] }>("/api/tickets"),
  createTicket: (data: { subject: string; message: string; priority?: TicketPriority }) =>
    request<{ ticket: Ticket }>("/api/tickets", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTicket: (id: number, data: { status?: TicketStatus; priority?: TicketPriority }) =>
    request<{ ticket: Ticket }>(`/api/tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  /* Team users per client account (owner request 2026-08-14) — org-scoped
     member management, admin-only (the account's original owner login or a
     role='admin' team member; restricted members get 403 server-side).
     Passwords are WRITE-ONLY: accepted on create/PATCH, hashed, never
     returned — the admin shares a new temp password with the member
     out-of-band. */
  orgMembers: () => request<{ members: OrgMember[] }>("/api/org/members"),
  createOrgMember: (data: {
    email: string;
    password: string;
    role: "admin" | "member";
    permissions?: TabPermissions;
  }) =>
    request<{ member: OrgMember }>("/api/org/members", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateOrgMember: (
    id: number,
    data: { role?: "admin" | "member"; permissions?: TabPermissions; password?: string },
  ) =>
    request<{ member: OrgMember }>(`/api/org/members/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteOrgMember: (id: number) =>
    request<{ ok: true }>(`/api/org/members/${id}`, { method: "DELETE" }),
  /* Phase 5 prep — tenant self-service. exportData downloads the org's own
     JSON export (session-cookie auth; the server 403s without settings read
     access). The response is a file attachment — fetch + blob download rather
     than request<> (which assumes a JSON body). cancelAccount flips the org to
     'canceled' (org admin only; the owner org is guarded server-side) and the
     server clears the session cookie. */
  exportData: async (): Promise<{ ok: true; filename: string }> => {
    const res = await fetch("/api/settings/export", { credentials: "include" });
    if (res.status === 401) {
      window.dispatchEvent(new Event("crm:unauthorized"));
      throw new ApiError(401, "Not signed in.");
    }
    if (!res.ok) {
      let msg = `Export failed (${res.status}).`;
      try {
        const body = await res.json();
        if (body && typeof body.error === "string") msg = body.error;
      } catch {
        /* no JSON body */
      }
      throw new ApiError(res.status, msg);
    }
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const m = disposition.match(/filename="([^"]+)"/);
    const filename = m
      ? m[1]
      : `crm-export-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, filename };
  },
  cancelAccount: () =>
    request<{ ok: true; message: string; canceledAt: string; retentionUntil: string }>(
      "/api/settings/cancel",
      { method: "POST" },
    ),

  /* Owner-only admin endpoints (Phase 2 — tenant provisioning). A member
     calling these gets a 403 from the server. */
  adminOrgs: () => request<{ orgs: Org[] }>("/api/admin/orgs"),
  adminCreateOrg: (data: { name: string; email: string; password: string; vertical?: string }) =>
    request<{
      org: CreatedOrg;
      user: CreatedOrgUser;
      emailStatus: "sent" | "failed" | "skipped";
      emailError?: string;
    }>("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminDeleteOrg: (id: number) =>
    request<{ ok: true }>(`/api/admin/orgs/${id}`, { method: "DELETE" }),
  /* Owner request 2026-08-14 — owner edits a client account's billing: the
     monthly subscription amount they pay (USD >= 0). Owner direction
     2026-08-15 — the per-account revenue-model selector is REMOVED (one
     product, subscription-based): adminUpdateOrg sends only the billing
     amount. Owner-only; members get 403. */
  adminUpdateOrg: (id: number, data: { monthlySubscriptionAmount?: number }) =>
    request<{ ok: true; org: { id: number; name: string } }>(`/api/admin/orgs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  /* 3g-3 — sold-lead auto-provisioning notifications (owner-only): the
     undismissed list + dismiss. */
  adminProvisions: () => request<{ provisions: ProvisionEvent[] }>("/api/admin/provisions"),
  adminDismissProvision: (id: number) =>
    request<{ ok: true }>(`/api/admin/provisions/${id}/dismiss`, { method: "POST" }),
  /* Phase 3d — owner impersonation: swap the owner's session into a tenant
     workspace (response is that tenant's user + impersonating: true), and
     swap back to the owner's own session. */
  adminImpersonate: (orgId: number) =>
    request<MeResponse>("/api/admin/impersonate", {
      method: "POST",
      body: JSON.stringify({ orgId }),
    }),
  impersonateReturn: () =>
    request<MeResponse>("/api/auth/impersonate-return", { method: "POST" }),

  /* 3k — password reset: forgot-password (public, mints + emails a token),
     token redemption (public), and change-password from Settings
     (authenticated; session stays valid). */
  forgotPassword: (email: string) =>
    request<{ ok: true; message: string }>("/api/auth/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true; message: string }>("/api/auth/reset", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true; message: string }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  /* Owner workflow views (2026-08-21) — "Build account": provision a client
     workspace on demand for a paid-but-unprovisioned sold client. Owner-only
     (server 403s members). Reuses the sold-lead auto-provision path. */
  adminProvisionClient: (id: number) =>
    request<{ ok: true; clientId: number; orgId: number; email: string }>(
      `/api/admin/clients/${id}/provision`,
      { method: "POST" },
    ),
  /* 3k — owner-only: generate a fresh temp password for a tenant (the interim
     "client forgot their password and has no email access" answer). The
     plaintext comes back ONCE in this response (and stays on the Admin list
     until the member's first login). */
  adminResetOrgPassword: (orgId: number) =>
    request<{ ok: true; orgId: number; email: string; password: string }>(
      `/api/admin/orgs/${orgId}/reset-password`,
      { method: "POST" },
    ),

  /* Org settings (Phase 3a/3b — branding, per-tenant stages, custom fields;
     Phase 1 adaptive intake — vertical config). Any signed-in member of the
     org can read/update their own org's settings. */
  settings: () => request<{ settings: OrgSettings }>("/api/settings"),
  updateSettings: (data: {
    orgName?: string;
    accentColor?: string;
    stages?: string[];
    customFields?: CustomFieldDef[];
    serviceModel?: OrgSettings["serviceModel"];
    deliveryType?: OrgSettings["deliveryType"];
    industry?: OrgSettings["industry"];
    intakeOpts?: string[];
    customIntakeGroups?: CustomIntakeGroup[];
    /** 3f-1: apply a vertical template additively (business type change). */
    verticalKey?: string;
    /** Owner request 2026-08-14 — the tenant edits their OWN revenue model
     *  (how their business makes money: sales vs subscription). The monthly
     *  subscription amount they pay is owner-set (Admin) — not writable here. */
    revenueModel?: RevenueModel;
    /** Native e-signature — the OWNER org's agreement template (owner-only;
     *  tenant writes are ignored server-side). */
    agreementTemplate?: string;
    /** Appointments production (backlog 5a104eae): per-account toggle — 1 lets
     *  this account's clients schedule appointments for themselves. */
    allowSelfSchedule?: boolean;
  }) =>
    request<{ settings: OrgSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  /* Native e-signature (owner direction 2026-08-15) — owner-only: send the
     agreement (renders the template + client details, generates the PDF,
     mints the unique sign token, emails the client the /sign/<token> link)
     and fetch the owner's agreement audit records. Tenants get 403. */
  sendAgreement: (clientId: number) =>
    request<{
      ok: true;
      clientId: number;
      status: string;
      expiresAt: number;
      emailTo: string;
      emailStatus: "sent" | "failed" | "skipped";
      emailError?: string;
      signUrl: string;
      token: string;
    }>("/api/agreements/send", { method: "POST", body: JSON.stringify({ clientId }) }),
  agreements: () => request<{ agreements: AgreementEnvelope[] }>("/api/agreements"),
  /* Phase 5 — Stripe billing (owner direction 2026-08-18). Owner-only. The
     owner enters the amount at bill time (no hard-coded rates) and picks the
     interval; the server creates the Stripe customer + price + payment link,
     emails the client, and returns the checkout URL. With no
     STRIPE_SECRET_KEY the server returns 503 (the UI explains the keys are
     not connected). */
  clientPaymentLink: (id: number, opts: { amount: number; interval?: "month" | "one_time" }) =>
    request<{
      ok: true;
      clientId: number;
      url: string;
      amountCents: number;
      interval: "month" | "one_time";
      emailTo: string;
      emailStatus: "sent" | "failed" | "skipped";
      emailError?: string;
      paymentStatus: "sent";
    }>(`/api/clients/${id}/payment-link`, {
      method: "POST",
      body: JSON.stringify({ amount: opts.amount, interval: opts.interval ?? "month" }),
    }),
  /* Owner direction 2026-08-18 — interim manual "mark payment received"
     (owner-only, like clientPaymentLink). Flips the Payment column yellow →
     green until a Stripe webhook auto-flips it in Phase 5. */
  clientPaymentPaid: (id: number) =>
    request<{ ok: true; paymentStatus: "paid" }>(`/api/clients/${id}/payment-paid`, { method: "POST" }),
  /* Owner 2026-08-20 sales rework — "Schedule Demo" on a lead (owner-only):
     creates an appointments row, mirrors the time onto the client's
     demo_scheduled_at, stores the optional pasted meeting link (Zoom/Google
     Meet — the "link version", sent plainly in the invite email), and emails
     the lead a confirmation with the link + date/time + a calendar line. */
  scheduleDemoCall: (clientId: number, scheduledAt: string, meetingLink?: string, duration?: number) =>
    request<{
      ok: true;
      appointment: Appointment;
      client: Client;
      emailStatus: "sent" | "failed";
      emailError?: string;
    }>(`/api/clients/${clientId}/demo-call`, {
      method: "POST",
      body: JSON.stringify({ scheduledAt, meetingLink, duration }),
    }),
  /* Owner 2026-08-20 — the calendar: every org's demo-call appointments with
     the linked client name. Owner-only. */
  appointments: () => request<{ appointments: Appointment[] }>("/api/appointments"),
  /* Owner 2026-08-22 — one-click "Cancel" on an owner Calendar row
     (owner-only). Marks the appointment 'cancelled' (history retained) and, if
     it was the client's active demo, clears the client's mirrored
     demo_scheduled_at. The row then disappears from the calendar list. */
  cancelAppointment: (id: number) =>
    request<{ ok: true; appointment: Appointment }>(`/api/appointments/${id}/cancel`, { method: "POST" }),
  /* Appointments production (backlog 5a104eae) — tenant workspace. GET lists
     THIS account's own appointments + whether self-scheduling is enabled;
     POST creates one for the caller's own account (403 unless the account
     toggle allowSelfSchedule is ON). */
  orgAppointments: () =>
    request<{ appointments: Appointment[]; allowSelfSchedule: boolean }>("/api/org/appointments"),
  createOrgAppointment: (title: string, scheduledAt: string, duration?: number) =>
    request<{ ok: true; appointment: Appointment }>("/api/org/appointments", {
      method: "POST",
      body: JSON.stringify({ title, scheduledAt, duration }),
    }),
  /* Owner — create an appointment (assign to a client account via orgId;
     optional clientId within that account). */
  createAppointment: (data: { title: string; scheduledAt: string; duration?: number; notes?: string; orgId?: number; clientId?: number }) =>
    request<{ ok: true; appointment: Appointment }>("/api/appointments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /* Owner — edit status / time on an appointment. */
  patchAppointment: (id: number, data: { status?: Appointment["status"]; scheduledAt?: string; title?: string; notes?: string }) =>
    request<{ ok: true; appointment: Appointment }>(`/api/appointments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  /* Owner — force the day-before reminder sweep. */
  runAppointmentReminders: () =>
    request<{ ok: true; sent: number }>("/api/appointments/reminders", { method: "POST" }),
};

