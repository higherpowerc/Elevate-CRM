import type { Client, CreatedOrg, CreatedOrgUser, CustomFieldDef, CustomIntakeGroup, DashboardData, Invoice, InvoiceStatus, MeResponse, Org, OrgSettings, ProvisionEvent, RevenueModel, Task, Ticket, TicketPriority, TicketStatus, User } from "./types";

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

  /* Owner-only admin endpoints (Phase 2 — tenant provisioning). A member
     calling these gets a 403 from the server. */
  adminOrgs: () => request<{ orgs: Org[] }>("/api/admin/orgs"),
  adminCreateOrg: (data: { name: string; email: string; password: string; vertical?: string }) =>
    request<{ org: CreatedOrg; user: CreatedOrgUser }>("/api/admin/orgs", {
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
  }) =>
    request<{ settings: OrgSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
