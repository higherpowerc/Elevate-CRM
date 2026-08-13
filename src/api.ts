import type { Client, CreatedOrg, CreatedOrgUser, CustomFieldDef, CustomIntakeGroup, DashboardData, Invoice, InvoiceStatus, MeResponse, Org, OrgSettings, Task, User } from "./types";

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

  /* Owner-only admin endpoints (Phase 2 — tenant provisioning). A member
     calling these gets a 403 from the server. */
  adminOrgs: () => request<{ orgs: Org[] }>("/api/admin/orgs"),
  adminCreateOrg: (data: { name: string; email: string; password: string }) =>
    request<{ org: CreatedOrg; user: CreatedOrgUser }>("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  adminDeleteOrg: (id: number) =>
    request<{ ok: true }>(`/api/admin/orgs/${id}`, { method: "DELETE" }),
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
  }) =>
    request<{ settings: OrgSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
