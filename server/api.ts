import {
  db,
  STAGES,
  isStage,
  INVOICE_STATUSES,
  isInvoiceStatus,
  DEFAULT_ORG_NAME,
  ensureDefaultOrg,
  type ClientRow,
  type CustomField,
  type Role,
  type Stage,
  type TaskRow,
  type InvoiceRow,
  type InvoiceStatus,
} from "./db";
import {
  createSession,
  verifySession,
  verifyPassword,
  getUserByEmail,
  getUserById,
  userCount,
  hashPassword,
  toUser,
} from "./auth";

export const SESSION_COOKIE = "elevate_session";

type JsonValue = unknown;

function json(data: JsonValue, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return part.slice(idx + 1).trim();
  }
  return null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Authenticated session context: who the user is AND which org they belong
 *  to. Every data route scopes its queries by orgId — the org always comes
 *  from the session, never from the request body. */
interface AuthContext {
  userId: number;
  orgId: number;
  role: Role;
}

/** Returns { userId, orgId, role } or a 401 Response. */
function requireAuth(req: Request): AuthContext | Response {
  const token = getCookie(req, SESSION_COOKIE);
  const userId = verifySession(token);
  if (!userId) return err("Not signed in.", 401);
  const user = getUserById(userId);
  if (!user) return err("Not signed in.", 401);
  return { userId: user.id, orgId: user.orgId, role: user.role };
}

/** requireAuth + the user must be an `admin` (owner). Members get 403. */
function requireAdmin(req: Request): AuthContext | Response {
  const auth = requireAuth(req);
  if (auth instanceof Response) return auth;
  if (auth.role !== "admin") return err("Forbidden.", 403);
  return auth;
}

/* ── Client row → API shape ─────────────────────────────────────────── */

function toClient(row: ClientRow) {
  let services: string[] = [];
  try {
    const parsed = JSON.parse(row.services);
    if (Array.isArray(parsed)) services = parsed.filter((s) => typeof s === "string");
  } catch {
    /* keep empty */
  }
  let customFields: CustomField[] = [];
  try {
    const parsed = JSON.parse(row.custom_fields);
    if (Array.isArray(parsed)) {
      customFields = parsed
        .filter((f) => f !== null && typeof f === "object" && typeof (f as CustomField).label === "string")
        .map((f) => ({
          label: (f as CustomField).label,
          value: typeof (f as CustomField).value === "string" ? (f as CustomField).value : "",
        }));
    }
  } catch {
    /* keep empty */
  }
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    industry: row.industry,
    services,
    customFields,
    dealValue: row.deal_value,
    stage: row.stage,
    nextAction: row.next_action,
    notes: row.notes,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ClientInput {
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
}

function validateClient(body: Record<string, unknown>): { ok: true; value: ClientInput } | { ok: false; error: string } {
  const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const companyName = str(body.companyName, 200);
  if (!companyName) return { ok: false, error: "Company name is required." };

  let services: string[] = [];
  if (body.services !== undefined) {
    if (!Array.isArray(body.services)) return { ok: false, error: "Services must be a list." };
    if (body.services.length > 50) return { ok: false, error: "Too many services (max 50)." };
    const seen = new Set<string>();
    for (const s of body.services) {
      if (typeof s !== "string") return { ok: false, error: "Each service must be text." };
      const t = s.trim().slice(0, 100);
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        services.push(t);
      }
    }
  }

  let customFields: CustomField[] = [];
  if (body.customFields !== undefined) {
    if (!Array.isArray(body.customFields)) return { ok: false, error: "Custom fields must be a list." };
    if (body.customFields.length > 30) return { ok: false, error: "Too many custom fields (max 30)." };
    for (const f of body.customFields) {
      if (f === null || typeof f !== "object" || Array.isArray(f)) {
        return { ok: false, error: "Each custom field must be an object with a label and a value." };
      }
      const obj = f as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      if (!label) return { ok: false, error: "Custom field label is required." };
      const value = typeof obj.value === "string" ? obj.value.trim() : "";
      customFields.push({ label: label.slice(0, 120), value: value.slice(0, 500) });
    }
  }

  let dealValue = 0;
  if (body.dealValue !== undefined && body.dealValue !== null && body.dealValue !== "") {
    dealValue = Number(body.dealValue);
    if (!Number.isFinite(dealValue) || dealValue < 0) return { ok: false, error: "Deal value must be a non-negative number." };
  }

  let stage: Stage = "Prospect";
  if (body.stage !== undefined && body.stage !== null && body.stage !== "") {
    if (!isStage(body.stage)) return { ok: false, error: `Stage must be one of: ${STAGES.join(", ")}.` };
    stage = body.stage;
  }

  return {
    ok: true,
    value: {
      companyName,
      contactName: str(body.contactName, 200),
      email: str(body.email, 254),
      phone: str(body.phone, 60),
      industry: str(body.industry, 120),
      services,
      customFields,
      dealValue,
      stage,
      nextAction: str(body.nextAction, 500),
      notes: str(body.notes, 10000),
      archived: body.archived === true,
    },
  };
}

/* ── Task row → API shape ──────────────────────────────── */

/** Row shape for task queries: tasks row joined with the client name. */
type TaskRowJoined = TaskRow & { client_name: string | null };

function toTask(row: TaskRowJoined) {
  return {
    id: row.id,
    title: row.title,
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? "",
    dueDate: row.due_date,
    done: row.done === 1,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_SELECT = `
  SELECT t.*, c.company_name AS client_name
  FROM tasks t
  LEFT JOIN clients c ON c.id = t.client_id
`;

function fetchTask(id: number, orgId: number) {
  const row = db
    .query(`${TASK_SELECT} WHERE t.id = ? AND t.org_id = ?`)
    .get(id, orgId) as TaskRowJoined | null;
  return row ? toTask(row) : null;
}

interface TaskInput {
  title: string;
  clientId: number | null;
  dueDate: string;
  done: boolean;
  notes: string;
}

/**
 * Validates the writable task fields. Every field is optional (partial
 * updates); create routes additionally require `title`.
 */
function parseTaskFields(
  body: Record<string, unknown>,
): { ok: true; value: Partial<TaskInput> } | { ok: false; error: string } {
  const out: Partial<TaskInput> = {};

  if (body.title !== undefined) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) return { ok: false, error: "Title is required." };
    if (t.length > 200) return { ok: false, error: "Title must be under 200 characters." };
    out.title = t;
  }

  if (body.clientId !== undefined && body.clientId !== null && body.clientId !== "") {
    const id = Number(body.clientId);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Client id must be a positive integer." };
    out.clientId = id;
  } else if (body.clientId !== undefined) {
    out.clientId = null; // explicitly unlinked
  }

  if (body.dueDate !== undefined) {
    const d = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    if (d.length > 20) return { ok: false, error: "Due date must be under 20 characters." };
    out.dueDate = d;
  }

  if (body.done !== undefined) {
    if (typeof body.done !== "boolean") return { ok: false, error: "done must be a boolean." };
    out.done = body.done;
  }

  if (body.notes !== undefined) {
    const n = typeof body.notes === "string" ? body.notes : "";
    if (n.length > 2000) return { ok: false, error: "Notes must be under 2000 characters." };
    out.notes = n;
  }

  return { ok: true, value: out };
}

/** 400 unless a (non-null) client id refers to a real client IN THE SAME ORG. */
function ensureClientExists(clientId: number, orgId: number): Response | null {
  const exists = db.query("SELECT id FROM clients WHERE id = ? AND org_id = ?").get(clientId, orgId);
  if (!exists) return err("Client not found.", 400);
  return null;
}

/* ── Invoice row → API shape ─────────────────────────── */

/** Row shape for invoice queries: invoices row joined with the client name. */
type InvoiceRowJoined = InvoiceRow & { client_name: string | null };

function toInvoice(row: InvoiceRowJoined) {
  return {
    id: row.id,
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? "",
    amount: row.amount,
    status: row.status,
    dueDate: row.due_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const INVOICE_SELECT = `
  SELECT i.*, c.company_name AS client_name
  FROM invoices i
  LEFT JOIN clients c ON c.id = i.client_id
`;

function fetchInvoice(id: number, orgId: number) {
  const row = db
    .query(`${INVOICE_SELECT} WHERE i.id = ? AND i.org_id = ?`)
    .get(id, orgId) as InvoiceRowJoined | null;
  return row ? toInvoice(row) : null;
}

interface InvoiceInput {
  clientId: number | null;
  amount: number;
  status: InvoiceStatus;
  dueDate: string;
  notes: string;
}

/**
 * Validates the writable invoice fields. Every field is optional (partial
 * updates); create routes additionally require `amount` (a real invoice is
 * always worth more than zero).
 */
function parseInvoiceFields(
  body: Record<string, unknown>,
): { ok: true; value: Partial<InvoiceInput> } | { ok: false; error: string } {
  const out: Partial<InvoiceInput> = {};

  if (body.clientId !== undefined && body.clientId !== null && body.clientId !== "") {
    const id = Number(body.clientId);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Client id must be a positive integer." };
    out.clientId = id;
  } else if (body.clientId !== undefined) {
    out.clientId = null; // explicitly unlinked
  }

  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const a = Number(body.amount);
    if (!Number.isFinite(a) || a <= 0) return { ok: false, error: "Amount must be a positive number." };
    out.amount = a;
  } else if (body.amount !== undefined) {
    return { ok: false, error: "Amount must be a positive number." };
  }

  if (body.status !== undefined && body.status !== null && body.status !== "") {
    if (!isInvoiceStatus(body.status)) {
      return { ok: false, error: `Status must be one of: ${INVOICE_STATUSES.join(", ")}.` };
    }
    out.status = body.status;
  }

  if (body.dueDate !== undefined) {
    const d = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    if (d.length > 20) return { ok: false, error: "Due date must be under 20 characters." };
    out.dueDate = d;
  }

  if (body.notes !== undefined) {
    const n = typeof body.notes === "string" ? body.notes : "";
    if (n.length > 2000) return { ok: false, error: "Notes must be under 2000 characters." };
    out.notes = n;
  }

  return { ok: true, value: out };
}

/* ── Admin (owner-only) org provisioning ───────────────────── */

interface OrgRow {
  id: number;
  name: string;
  created_at: string;
  user_count: number;
  client_count: number;
}

function toOrg(row: OrgRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    userCount: row.user_count,
    clientCount: row.client_count,
  };
}

interface NewOrgInput {
  name: string;
  email: string;
  password: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates the "create client account" payload: org name, the client's
 *  login email (must look like an email, unique across ALL users), and a
 *  temp password ≥ 8 chars. */
function validateNewOrg(
  body: Record<string, unknown>,
): { ok: true; value: NewOrgInput } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Company name is required." };
  if (name.length > 200) return { ok: false, error: "Company name must be under 200 characters." };

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "Client email is required." };
  if (email.length > 254) return { ok: false, error: "Email must be under 254 characters." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return { ok: false, error: "Password is required." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

  return { ok: true, value: { name, email, password } };
}

/* ── Routes ─────────────────────────────────────────────────────────── */

async function handleApi(req: Request, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = req.method;

  /* Auth */
  if (pathname === "/api/auth/login" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) return err("Email and password are required.", 400);

    if (userCount() === 0) {
      return json(
        {
          error: "setup_required",
          message:
            "No admin account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment, then run `bun run seed` (or restart the server).",
        },
        503,
      );
    }
    const user = getUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return err("Invalid email or password.", 401);
    }
    const token = createSession(user.id);
    return json(
      { user: toUser(user), ok: true },
      200,
      { "Set-Cookie": sessionCookie(token) },
    );
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    });
  }

  if (pathname === "/api/auth/me") {
    const auth = requireAuth(req);
    if (auth instanceof Response) return auth;
    const user = getUserById(auth.userId);
    if (!user) return err("Not signed in.", 401);
    return json({ user });
  }

  /* Everything below requires auth */
  const auth = requireAuth(req);
  if (auth instanceof Response) return auth;
  const orgId = auth.orgId;

  /* Admin (owner-only): tenant provisioning */
  if (pathname === "/api/admin/orgs" && method === "GET") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const rows = db
      .query(
        `SELECT o.id, o.name, o.created_at,
                COUNT(DISTINCT u.id) AS user_count,
                COUNT(DISTINCT c.id) AS client_count
         FROM orgs o
         LEFT JOIN users u   ON u.org_id = o.id
         LEFT JOIN clients c ON c.org_id = o.id
         GROUP BY o.id
         ORDER BY o.id ASC`,
      )
      .all() as OrgRow[];
    return json({ orgs: rows.map(toOrg) });
  }

  if (pathname === "/api/admin/orgs" && method === "POST") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = validateNewOrg(body);
    if (!v.ok) return err(v.error, 400);
    const taken = db.query("SELECT id FROM users WHERE email = ?").get(v.value.email);
    if (taken) return err("An account with this email already exists.", 400);

    const hash = await hashPassword(v.value.password);
    const tx = db.transaction(() => {
      const orgIdNew = Number(db.query("INSERT INTO orgs (name) VALUES (?)").run(v.value.name).lastInsertRowid);
      const userId = Number(
        db
          .query("INSERT INTO users (email, password_hash, org_id, role) VALUES (?, ?, ?, 'member')")
          .run(v.value.email, hash, orgIdNew).lastInsertRowid,
      );
      return { orgId: orgIdNew, userId };
    });
    const { orgId: newOrgId, userId } = tx();
    const org = db.query("SELECT id, name, created_at FROM orgs WHERE id = ?").get(newOrgId) as {
      id: number;
      name: string;
      created_at: string;
    };
    return json(
      {
        org: { id: org.id, name: org.name, createdAt: org.created_at },
        user: { id: userId, email: v.value.email, orgId: newOrgId, role: "member" as Role },
      },
      201,
    );
  }

  const adminOrgMatch = pathname.match(/^\/api\/admin\/orgs\/(\d+)$/);
  if (adminOrgMatch && method === "DELETE") {
    const admin = requireAdmin(req);
    if (admin instanceof Response) return admin;
    const id = Number(adminOrgMatch[1]);
    const org = db.query("SELECT id, name FROM orgs WHERE id = ?").get(id) as
      | { id: number; name: string }
      | null;
    if (!org) return err("Org not found.", 404);
    // The default org is the owner's own org ("Elevate Studio") — never deletable.
    if (org.id === ensureDefaultOrg()) return err("Cannot delete the owner org.", 400);
    db.transaction(() => {
      db.query("DELETE FROM invoices WHERE org_id = ?").run(id);
      db.query("DELETE FROM tasks WHERE org_id = ?").run(id);
      db.query("DELETE FROM clients WHERE org_id = ?").run(id);
      db.query("DELETE FROM users WHERE org_id = ?").run(id);
      db.query("DELETE FROM orgs WHERE id = ?").run(id);
    })();
    return json({ ok: true });
  }

  /* Dashboard */
  if (pathname === "/api/dashboard" && method === "GET") {
    const stageCounts = {} as Record<Stage, number>;
    for (const s of STAGES) stageCounts[s] = 0;
    const rows = db
      .query("SELECT stage, COUNT(*) AS c FROM clients WHERE org_id = ? AND archived = 0 GROUP BY stage")
      .all(orgId) as { stage: Stage; c: number }[];
    for (const r of rows) stageCounts[r.stage] = r.c;

    const total = db
      .query("SELECT COUNT(*) AS c FROM clients WHERE org_id = ?")
      .get(orgId) as { c: number };
    const archived = db
      .query("SELECT COUNT(*) AS c FROM clients WHERE org_id = ? AND archived = 1")
      .get(orgId) as { c: number };
    const value = db
      .query("SELECT COALESCE(SUM(deal_value), 0) AS v FROM clients WHERE org_id = ? AND archived = 0")
      .get(orgId) as { v: number };
    const recent = (
      db
        .query("SELECT * FROM clients WHERE org_id = ? AND archived = 0 ORDER BY updated_at DESC, id DESC LIMIT 5")
        .all(orgId) as ClientRow[]
    ).map(toClient);

    return json({
      stageCounts,
      projectedPipeline: value.v,
      totalClients: total.c,
      archivedClients: archived.c,
      recentClients: recent,
    });
  }

  /* Clients collection */
  if (pathname === "/api/clients" && method === "GET") {
    const includeArchived = url.searchParams.get("archived") === "1";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    let rows: ClientRow[];
    if (q) {
      rows = db
        .query(
          `SELECT * FROM clients
           WHERE org_id = ?
             AND (archived = 0 OR ? = 1)
             AND (LOWER(company_name) LIKE ? OR LOWER(contact_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(industry) LIKE ?)
           ORDER BY updated_at DESC, id DESC`,
        )
        .all(orgId, includeArchived ? 1 : 0, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`) as ClientRow[];
    } else {
      rows = db
        .query(
          `SELECT * FROM clients WHERE org_id = ? AND (archived = 0 OR ? = 1) ORDER BY updated_at DESC, id DESC`,
        )
        .all(orgId, includeArchived ? 1 : 0) as ClientRow[];
    }
    return json({ clients: rows.map(toClient) });
  }

  if (pathname === "/api/clients" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = validateClient(body);
    if (!v.ok) return err(v.error, 400);
    const c = v.value;
    const info = db
      .query(
        `INSERT INTO clients (org_id, company_name, contact_name, email, phone, industry, services, custom_fields, deal_value, stage, next_action, notes, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        c.companyName, c.contactName, c.email, c.phone, c.industry,
        JSON.stringify(c.services), JSON.stringify(c.customFields), c.dealValue, c.stage, c.nextAction, c.notes,
        c.archived ? 1 : 0,
      );
    const row = db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(info.lastInsertRowid, orgId) as ClientRow;
    return json({ client: toClient(row) }, 201);
  }

  /* Client item */
  const itemMatch = pathname.match(/^\/api\/clients\/(\d+)$/);
  if (itemMatch) {
    const id = Number(itemMatch[1]);
    const find = () => db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(id, orgId) as ClientRow | null;

    if (method === "GET") {
      const row = find();
      if (!row) return err("Client not found.", 404);
      return json({ client: toClient(row) });
    }

    if (method === "PUT") {
      const row = find();
      if (!row) return err("Client not found.", 404);
      const body = await readBody(req);
      if (!body) return err("Invalid JSON body.", 400);
      const v = validateClient(body);
      if (!v.ok) return err(v.error, 400);
      const c = v.value;
      db.query(
        `UPDATE clients SET
           company_name = ?, contact_name = ?, email = ?, phone = ?, industry = ?,
           services = ?, custom_fields = ?, deal_value = ?, stage = ?, next_action = ?, notes = ?, archived = ?,
           updated_at = datetime('now')
         WHERE id = ? AND org_id = ?`,
      ).run(
        c.companyName, c.contactName, c.email, c.phone, c.industry,
        JSON.stringify(c.services), JSON.stringify(c.customFields), c.dealValue, c.stage, c.nextAction, c.notes,
        c.archived ? 1 : 0, id, orgId,
      );
      const updated = db.query("SELECT * FROM clients WHERE id = ? AND org_id = ?").get(id, orgId) as ClientRow;
      return json({ client: toClient(updated) });
    }

    if (method === "DELETE") {
      const row = find();
      if (!row) return err("Client not found.", 404);
      db.query("DELETE FROM clients WHERE id = ? AND org_id = ?").run(id, orgId);
      return json({ ok: true });
    }

    return err("Method not allowed.", 405);
  }

  /* Tasks collection */
  if (pathname === "/api/tasks" && method === "GET") {
    const doneParam = url.searchParams.get("done");
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const clauses: string[] = ["t.org_id = ?"];
    const params: (string | number)[] = [orgId];
    if (doneParam === "0") clauses.push("t.done = 0");
    else if (doneParam === "1") clauses.push("t.done = 1");
    if (q) {
      clauses.push("LOWER(t.title) LIKE ?");
      params.push(`%${q}%`);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = db
      .query(
        `${TASK_SELECT}
         ${where}
         ORDER BY t.done ASC, (t.due_date = '') ASC, t.due_date ASC, t.created_at DESC, t.id DESC`,
      )
      .all(...params) as TaskRowJoined[];
    return json({ tasks: rows.map(toTask) });
  }

  if (pathname === "/api/tasks" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = parseTaskFields(body);
    if (!v.ok) return err(v.error, 400);
    if (!v.value.title) return err("Title is required.", 400);
    const clientId = v.value.clientId ?? null;
    if (clientId !== null) {
      const bad = ensureClientExists(clientId, orgId);
      if (bad) return bad;
    }
    const info = db
      .query(
        `INSERT INTO tasks (org_id, title, client_id, due_date, done, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        v.value.title,
        clientId,
        v.value.dueDate ?? "",
        v.value.done ? 1 : 0,
        v.value.notes ?? "",
      );
    const task = fetchTask(Number(info.lastInsertRowid), orgId);
    return json({ task }, 201);
  }

  /* Task item + toggle */
  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  const taskToggleMatch = pathname.match(/^\/api\/tasks\/(\d+)\/toggle$/);

  if (taskToggleMatch && method === "POST") {
    const id = Number(taskToggleMatch[1]);
    const row = db.query("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(id, orgId) as TaskRow | null;
    if (!row) return err("Task not found.", 404);
    db.query("UPDATE tasks SET done = ?, updated_at = datetime('now') WHERE id = ? AND org_id = ?").run(
      row.done ? 0 : 1,
      id,
      orgId,
    );
    return json({ task: fetchTask(id, orgId) });
  }

  if (taskMatch) {
    const id = Number(taskMatch[1]);
    const find = () => db.query("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(id, orgId) as TaskRow | null;

    if (method === "PUT") {
      const row = find();
      if (!row) return err("Task not found.", 404);
      const body = await readBody(req);
      if (!body) return err("Invalid JSON body.", 400);
      const v = parseTaskFields(body);
      if (!v.ok) return err(v.error, 400);
      const f = v.value;
      if (f.clientId !== undefined && f.clientId !== null) {
        const bad = ensureClientExists(f.clientId, orgId);
        if (bad) return bad;
      }
      db.query(
        `UPDATE tasks SET
           title = ?, client_id = ?, due_date = ?, done = ?, notes = ?,
           updated_at = datetime('now')
         WHERE id = ? AND org_id = ?`,
      ).run(
        f.title ?? row.title,
        f.clientId !== undefined ? f.clientId : row.client_id,
        f.dueDate ?? row.due_date,
        f.done !== undefined ? (f.done ? 1 : 0) : row.done,
        f.notes ?? row.notes,
        id,
        orgId,
      );
      return json({ task: fetchTask(id, orgId) });
    }

    if (method === "DELETE") {
      const row = find();
      if (!row) return err("Task not found.", 404);
      db.query("DELETE FROM tasks WHERE id = ? AND org_id = ?").run(id, orgId);
      return json({ ok: true });
    }

    return err("Method not allowed.", 405);
  }

  /* Invoices collection */
  if (pathname === "/api/invoices" && method === "GET") {
    const statusParam = url.searchParams.get("status");
    const clientParam = url.searchParams.get("clientId");
    const clauses: string[] = ["i.org_id = ?"];
    const params: (string | number)[] = [orgId];
    if (statusParam !== null) {
      if (!isInvoiceStatus(statusParam)) {
        return err(`Status must be one of: ${INVOICE_STATUSES.join(", ")}.`, 400);
      }
      clauses.push("i.status = ?");
      params.push(statusParam);
    }
    if (clientParam !== null) {
      const cid = Number(clientParam);
      if (!Number.isInteger(cid) || cid <= 0) return err("clientId must be a positive integer.", 400);
      clauses.push("i.client_id = ?");
      params.push(cid);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = db
      .query(
        `${INVOICE_SELECT}
         ${where}
         ORDER BY CASE WHEN i.status = 'paid' THEN 1 ELSE 0 END ASC,
                  (i.due_date = '') ASC,
                  i.due_date ASC,
                  i.created_at DESC,
                  i.id DESC`,
      )
      .all(...params) as InvoiceRowJoined[];
    return json({ invoices: rows.map(toInvoice) });
  }

  if (pathname === "/api/invoices" && method === "POST") {
    const body = await readBody(req);
    if (!body) return err("Invalid JSON body.", 400);
    const v = parseInvoiceFields(body);
    if (!v.ok) return err(v.error, 400);
    if (v.value.amount === undefined) return err("Amount is required.", 400);
    const clientId = v.value.clientId ?? null;
    if (clientId !== null) {
      const bad = ensureClientExists(clientId, orgId);
      if (bad) return bad;
    }
    const info = db
      .query(
        `INSERT INTO invoices (org_id, client_id, amount, status, due_date, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        clientId,
        v.value.amount,
        v.value.status ?? "draft",
        v.value.dueDate ?? "",
        v.value.notes ?? "",
      );
    const invoice = fetchInvoice(Number(info.lastInsertRowid), orgId);
    return json({ invoice }, 201);
  }

  /* Invoice item */
  const invoiceMatch = pathname.match(/^\/api\/invoices\/(\d+)$/);

  if (invoiceMatch) {
    const id = Number(invoiceMatch[1]);
    const find = () => db.query("SELECT * FROM invoices WHERE id = ? AND org_id = ?").get(id, orgId) as InvoiceRow | null;

    if (method === "PUT") {
      const row = find();
      if (!row) return err("Invoice not found.", 404);
      const body = await readBody(req);
      if (!body) return err("Invalid JSON body.", 400);
      const v = parseInvoiceFields(body);
      if (!v.ok) return err(v.error, 400);
      const f = v.value;
      if (f.clientId !== undefined && f.clientId !== null) {
        const bad = ensureClientExists(f.clientId, orgId);
        if (bad) return bad;
      }
      db.query(
        `UPDATE invoices SET
           client_id = ?, amount = ?, status = ?, due_date = ?, notes = ?,
           updated_at = datetime('now')
         WHERE id = ? AND org_id = ?`,
      ).run(
        f.clientId !== undefined ? f.clientId : row.client_id,
        f.amount ?? row.amount,
        f.status ?? row.status,
        f.dueDate ?? row.due_date,
        f.notes ?? row.notes,
        id,
        orgId,
      );
      return json({ invoice: fetchInvoice(id, orgId) });
    }

    if (method === "DELETE") {
      const row = find();
      if (!row) return err("Invoice not found.", 404);
      db.query("DELETE FROM invoices WHERE id = ? AND org_id = ?").run(id, orgId);
      return json({ ok: true });
    }

    return err("Method not allowed.", 405);
  }

  return err("Not found.", 404);
}

function sessionCookie(token: string): string {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}${secure}`;
}

export { handleApi };
