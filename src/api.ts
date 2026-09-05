import type { AgreementEnvelope, Appointment, Buyer, Client, CreatedOrg, CreatedOrgUser, CustomFieldDef, CustomIntakeGroup, DashboardData, Invoice, InvoiceStatus, MeResponse, OnboardingItem, Org, OrgMember, OrgSettings, PropertyEnrichmentResult, ProvisionEvent, RevenueModel, TabPermissions, Task, Ticket, TicketPriority, TicketReply, TicketStatus, Transaction, User, WebhookLog, WebhookSettings, WholesaleOffer } from "./types";


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

export type ClientInput = Partial<Omit<Client, "id" | "createdAt" | "updatedAt">> & { companyName: string };

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
  batchCreateClients: (clients: ClientInput[]) =>
    request<{ count: number }>("/api/clients/batch", {
      method: "POST",
      body: JSON.stringify({ clients }),
    }),
  /* Partial PUT (AZ defect D4, 2026-08-17): the server persists ONLY the
   * fields the body carries — an omitted key never clobbers the stored value.
   * The type says so, so owner-workspace callers (e.g. the Client accounts
   * Edit-account action) may send just the fields they change. */
  updateClient: (id: number, data: Partial<ClientInput>) =>
    request<{ client: Client }>(`/api/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteClient: (id: number) =>
    request<{ ok: true }>(`/api/clients/${id}`, { method: "DELETE" }),

  saveDealCalculation: (
    id: number,
    data: {
      arv?: number;
      repairs?: number;
      assignmentFee?: number;
      offerAmount?: number;
      rulePct?: number;
      offerType?: string;
      purchasePrice?: number;
      listedPrice?: number;
      downPayment?: number;
      interestRate?: number;
      amortizationYears?: number;
      monthlyPayment?: number;
      isInterestOnly?: boolean;
      balloonYears?: number;
      balloonBalance?: number;
      buyerEntryFee?: number;
      monthlyRent?: number;
      monthlyCashFlow?: number;
      cashOnCashReturn?: number;
      subtoTotalDebt?: number;
      subtoMonthlyPayment?: number;
    }
  ) =>
    request<{ ok: true; client: Client }>(`/api/clients/${id}/calculate`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  sendOfferEmail: (
    id: number,
    data: {
      to: string;
      subject: string;
      message: string;
      html?: string;
      businessName?: string;
      fontFamily?: string;
      offerType?: "cash" | "subto" | "creative" | "all";
      selectedOffers?: string[];
      propertyAddress?: string;
      sellerName?: string;
      offerAmount?: number;
      purchasePrice?: number;
      arv?: number;
      repairs?: number;
      assignmentFee?: number;
      rulePct?: number;
      subtoDebt?: number;
      subtoCashToSeller?: number;
      subtoMonthlyPayment?: number;
      downPayment?: number;
      monthlyPayment?: number;
      interestRate?: number;
      balloonYears?: number;
      totalPaidToSeller?: number;
      closingDays?: number;
      includeAssignability?: boolean;
    }
  ) =>
    request<{
      ok: true;
      client: Client;
      emailStatus: "sent" | "failed";
      emailError?: string;
      offerAmount: number;
      stage: string;
      pdfUrl?: string;
      businessName?: string;
    }>(`/api/clients/${id}/offer-email`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  offers: (clientId?: number) =>
    request<{ ok: true; offers: WholesaleOffer[] }>(
      `/api/offers${clientId ? `?client_id=${clientId}` : ""}`
    ),
  updateOffer: (id: number, data: { status?: string; notes?: string }) =>
    request<{ ok: true; offer: WholesaleOffer }>(`/api/offers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteOffer: (id: number) =>
    request<{ ok: true }>(`/api/offers/${id}`, {
      method: "DELETE",
    }),

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
  /* Ticket replies (owner direction, backlog 58435d2b) — OWNER-only ("agent
     draft-reply review queue"). A draft is showing status draft/awaiting the
     owner's approval; it is only emailed after the send step. Tenants never
     call these (the server 403s them). */
  ticketReplies: (ticketId: number) =>
    request<{ replies: TicketReply[] }>(`/api/tickets/${ticketId}/replies`),
  createTicketReply: (ticketId: number, data: { author?: string; body: string }) =>
    request<{ reply: TicketReply }>(`/api/tickets/${ticketId}/replies`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  sendTicketReply: (ticketId: number, replyId: number) =>
    request<{ reply: TicketReply }>(`/api/tickets/${ticketId}/replies/${replyId}/send`, {
      method: "POST",
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
  adminCreateOrg: (data: { name: string; email: string; password: string; vertical?: string; tier?: string }) =>
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
  /* Owner 2026-08-27 — INACTIVE CLIENTS window (backlog cb1c9700): the owner
     marks a client account inactive ("Mark inactive" on its active row) or
     restores it from the Inactive clients window. The server reuses the org
     lifecycle (status 'canceled' + canceled_at + retention_until — the same
     stamps as the self-serve cancel): data is RETAINED, tenant logins are
     blocked while inactive, and the account stops counting as active.
     Owner-only; members get 403. */
  adminCancelOrg: (id: number) =>
    request<{ ok: true; orgId: number; canceledAt: string; retentionUntil: string }>(
      `/api/admin/orgs/${id}/cancel`,
      { method: "POST" },
    ),
  adminRestoreOrg: (id: number) =>
    request<{ ok: true; orgId: number }>(`/api/admin/orgs/${id}/restore`, { method: "POST" }),
  /* Owner 2026-08-27 — the per-tier AUTO-SEEDED onboarding checklist for a
     client account (the package-selector feature). GET reads the account's
     tier + checklist; PATCH toggles one item's done flag. Owner-only: members
     and tenants get a 403 from every /api/admin route. */
  adminGetOnboarding: (orgId: number) =>
    request<{ tier: string; items: OnboardingItem[] }>(`/api/admin/orgs/${orgId}/onboarding`),
  adminToggleOnboardingItem: (orgId: number, itemId: number, done: boolean) =>
    request<{ ok: true; tier: string; items: OnboardingItem[] }>(
      `/api/admin/orgs/${orgId}/onboarding`,
      { method: "PATCH", body: JSON.stringify({ id: itemId, done }) },
    ),
  /* Owner request 2026-08-14 — owner edits a client account's billing: the
     monthly subscription amount they pay (USD >= 0). Owner direction
     2026-08-15 — the per-account revenue-model selector is REMOVED (one
     product, subscription-based): adminUpdateOrg sends only the billing
     amount. Owner 2026-08-27 — the hub's Edit-account action also renames the
     account (name): the org name IS the account name in the Clients cell.
     Owner-only; members get 403. */
  adminUpdateOrg: (id: number, data: { monthlySubscriptionAmount?: number; billingCycleDate?: string; tier?: string; name?: string }) =>
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
    dashboardColor?: string;
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
    /** Agreements-editor PIN (owner direction 2026-08-25) — set/change from
     *  Settings; stored hashed, owner-only (tenant writes are ignored). */
    agreementsPin?: string;
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
  /** Owner-only: hard-delete an agreement envelope (row + PDF on disk). */
  deleteAgreement: (id: number) =>
    request<{ ok: true }>(`/api/agreements/${id}`, { method: "DELETE" }),
  /** Owner-only: verify the PIN entered to unlock the Documents Agreements
   *  editor against the stored sha-256 hash. */
  checkAgreementsPin: (pin: string) =>
    request<{ ok: boolean; error?: string }>("/api/agreements/pin-check", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
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
  /* Wholesale Real Estate vertical (owner 2026-09-04) — Buyers entity.
     Org-scoped CRUD over /api/buyers (tenant-only; the owner cockpit has no
     buyers surface). */
  buyers: () => request<{ buyers: Buyer[] }>("/api/buyers"),
  createBuyer: (data: { name: string; phone?: string; criteria?: string; bought?: string }) =>
    request<{ buyer: Buyer }>("/api/buyers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateBuyer: (id: number, data: { name?: string; phone?: string; criteria?: string; bought?: string }) =>
    request<{ buyer: Buyer }>(`/api/buyers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteBuyer: (id: number) => request<{ ok: true }>(`/api/buyers/${id}`, { method: "DELETE" }),
  /* Wholesale Real Estate — Document & Transaction Hub */
  transactions: () => request<{ ok: true; transactions: Transaction[] }>("/api/transactions"),
  createTransaction: (data: Partial<Transaction> & { propertyAddress: string }) =>
    request<{ ok: true; transaction: Transaction }>("/api/transactions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTransaction: (id: number, data: Partial<Transaction> & { extendDays?: number }) =>
    request<{ ok: true; transaction: Transaction }>(`/api/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteTransaction: (id: number) =>
    request<{ ok: true }>(`/api/transactions/${id}`, { method: "DELETE" }),
  generateContract: (id: number, data?: { stateJurisdiction?: string; customTerms?: string }) =>
    request<{ ok: true; transaction: Transaction }>(`/api/transactions/${id}/generate-contract`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  sendTitlePacket: (id: number, data?: { email?: string }) =>
    request<{ ok: true; emailStatus: string; titlePortalUrl: string }>(`/api/transactions/${id}/send-title-packet`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  sendSignatureRequest: (id: number, data?: { email?: string }) =>
    request<{ ok: true; emailStatus: string; signUrl: string }>(`/api/transactions/${id}/send-signature-request`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  /* Wholesale Inbound Webhooks & Property Lead Engine */
  webhookSettings: () => request<WebhookSettings>("/api/webhooks/settings"),
  regenerateWebhookKey: () =>
    request<{ ok: true; webhookSecret: string; webhookUrl: string }>("/api/webhooks/regenerate-key", { method: "POST" }),
  testWebhookLead: () => request<{ ok: true; clientId: number; client: Client }>("/api/webhooks/test", { method: "POST" }),
  saveRentcastKey: (apiKey: string) =>
    request<{ ok: true; rentcastApiKey: string }>("/api/settings/rentcast-key", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  lookupProperty: (address: string) =>
    request<{ ok: true; property: PropertyEnrichmentResult }>(`/api/properties/lookup?address=${encodeURIComponent(address)}`),
};

