import { db, STAGES, isStage, type ClientRow, type CustomField, type Stage } from "./db";
import {
  createSession,
  verifySession,
  verifyPassword,
  getUserByEmail,
  getUserById,
  userCount,
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

/** Returns { userId } or a 401 Response. */
function requireAuth(req: Request): { userId: number } | Response {
  const token = getCookie(req, SESSION_COOKIE);
  const userId = verifySession(token);
  if (!userId) return err("Not signed in.", 401);
  return { userId };
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
      { user: { id: user.id, email: user.email }, ok: true },
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

  /* Dashboard */
  if (pathname === "/api/dashboard" && method === "GET") {
    const stageCounts = {} as Record<Stage, number>;
    for (const s of STAGES) stageCounts[s] = 0;
    const rows = db
      .query("SELECT stage, COUNT(*) AS c FROM clients WHERE archived = 0 GROUP BY stage")
      .all() as { stage: Stage; c: number }[];
    for (const r of rows) stageCounts[r.stage] = r.c;

    const total = db
      .query("SELECT COUNT(*) AS c FROM clients")
      .get() as { c: number };
    const archived = db
      .query("SELECT COUNT(*) AS c FROM clients WHERE archived = 1")
      .get() as { c: number };
    const value = db
      .query("SELECT COALESCE(SUM(deal_value), 0) AS v FROM clients WHERE archived = 0")
      .get() as { v: number };
    const recent = (
      db
        .query("SELECT * FROM clients WHERE archived = 0 ORDER BY updated_at DESC, id DESC LIMIT 5")
        .all() as ClientRow[]
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
           WHERE (archived = 0 OR ? = 1)
             AND (LOWER(company_name) LIKE ? OR LOWER(contact_name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(industry) LIKE ?)
           ORDER BY updated_at DESC, id DESC`,
        )
        .all(includeArchived ? 1 : 0, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`) as ClientRow[];
    } else {
      rows = db
        .query(
          `SELECT * FROM clients WHERE archived = 0 OR ? = 1 ORDER BY updated_at DESC, id DESC`,
        )
        .all(includeArchived ? 1 : 0) as ClientRow[];
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
        `INSERT INTO clients (company_name, contact_name, email, phone, industry, services, custom_fields, deal_value, stage, next_action, notes, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.companyName, c.contactName, c.email, c.phone, c.industry,
        JSON.stringify(c.services), JSON.stringify(c.customFields), c.dealValue, c.stage, c.nextAction, c.notes,
        c.archived ? 1 : 0,
      );
    const row = db.query("SELECT * FROM clients WHERE id = ?").get(info.lastInsertRowid) as ClientRow;
    return json({ client: toClient(row) }, 201);
  }

  /* Client item */
  const itemMatch = pathname.match(/^\/api\/clients\/(\d+)$/);
  if (itemMatch) {
    const id = Number(itemMatch[1]);
    const find = () => db.query("SELECT * FROM clients WHERE id = ?").get(id) as ClientRow | null;

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
         WHERE id = ?`,
      ).run(
        c.companyName, c.contactName, c.email, c.phone, c.industry,
        JSON.stringify(c.services), JSON.stringify(c.customFields), c.dealValue, c.stage, c.nextAction, c.notes,
        c.archived ? 1 : 0, id,
      );
      const updated = db.query("SELECT * FROM clients WHERE id = ?").get(id) as ClientRow;
      return json({ client: toClient(updated) });
    }

    if (method === "DELETE") {
      const row = find();
      if (!row) return err("Client not found.", 404);
      db.query("DELETE FROM clients WHERE id = ?").run(id);
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
