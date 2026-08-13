export const STAGES = [
  "Prospect",
  "Intake",
  "Kickoff",
  "Build",
  "Launch",
  "Retainer",
] as const;
export type Stage = (typeof STAGES)[number];

export interface CustomField {
  label: string;
  value: string;
}

export interface Client {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  industry: string;
  services: string[];
  customFields: CustomField[];
  dealValue: number;
  stage: Stage;
  nextAction: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: number;
  title: string;
  clientId: number | null;
  clientName: string;
  dueDate: string;
  done: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const INVOICE_STATUSES = ["draft", "sent", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface Invoice {
  id: number;
  clientId: number | null;
  clientName: string;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  stageCounts: Record<Stage, number>;
  projectedPipeline: number;
  totalClients: number;
  archivedClients: number;
  recentClients: Client[];
}

export interface User {
  id: number;
  email: string;
  created_at?: string;
}

export const STAGE_TONE: Record<Stage, string> = {
  Prospect: "gray",
  Intake: "blue",
  Kickoff: "amber",
  Build: "violet",
  Launch: "lime",
  Retainer: "teal",
};

/** Stored invoice status → badge tone. "Overdue" is not stored — it is
 *  computed client-side when status === "sent" and dueDate < today. */
export const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "gray",
  sent: "blue",
  paid: "green",
};

export const invoiceStatusLabel = (s: InvoiceStatus): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

export const money = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n ?? 0);

export const fmtDate = (iso: string): string => {
  try {
    return new Date(iso + (iso.includes("T") ? "" : "Z")).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};
