import type { Client, DashboardData, User } from "./types";

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

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
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
};
