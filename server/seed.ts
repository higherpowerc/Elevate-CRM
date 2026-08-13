/**
 * `bun run seed` — idempotently seed the admin account from env vars.
 * Useful after setting ADMIN_EMAIL / ADMIN_PASSWORD without restarting the server.
 *
 * `bun run seed -- --demo` (or SEED_DEMO=1) additionally seeds 8 demo clients
 * directly into the database — including an HVAC-style and a Landscaping-style
 * client with custom fields and industry-specific services — so a fresh
 * deployment has something to look at. Safe: it only inserts when the clients
 * table is empty (use `bun run db:reset` for a clean slate first).
 */
import { ensureAdmin, hashPassword } from "./auth";
import { db, ensureDefaultOrg } from "./db";

const result = await ensureAdmin();
console.log(result.message);

// All demo data lands in the default org ("Elevate Studio") — the org the
// seeded admin belongs to, so a fresh deployment shows the demo under the
// admin's own account.
const demoOrgId = ensureDefaultOrg();

// Custom-field definitions for the default org (Phase 3b). Every value stored
// on a demo client must reference one of these names — they are what the UI
// renders on the client form and rows.
const DEMO_ORG_FIELDS = [
  { name: "Locations", type: "number" },
  { name: "Roastery", type: "text" },
  { name: "New-patient flow", type: "text" },
  { name: "Fleet size", type: "number" },
  { name: "Service area", type: "text" },
  { name: "Agents", type: "number" },
  { name: "Markets", type: "text" },
  { name: "License #", type: "text" },
  { name: "Crew size", type: "number" },
  { name: "Seasonal contract", type: "text" },
  { name: "Service radius", type: "text" },
];

const DEMO_CLIENTS = [
  {
    companyName: "Northline Coffee",
    contactName: "Sam Rivera",
    email: "sam@northline.example",
    phone: "+1 415 555 0127",
    industry: "Hospitality",
    clientType: "commercial",
    address: "4120 Mission St",
    city: "San Francisco",
    state: "CA",
    zip: "94112",
    website: "northlinecoffee.example",
    leadSource: "Referral",
    services: ["Premium Website", "SEO"],
    customFields: [
      { name: "Locations", value: "3" },
      { name: "Roastery", value: "In-house" },
    ],
    dealValue: 9500,
    stage: "Kickoff",
    nextAction: "Deliver first design concepts",
    notes: "Demo account — local QA data",
  },
  {
    companyName: "Harbor & Vine",
    contactName: "Maya Chen",
    email: "maya@harborvine.example",
    phone: "",
    industry: "Retail",
    clientType: "commercial",
    address: "88 Pier Ave",
    city: "Seattle",
    state: "WA",
    zip: "98101",
    leadSource: "Website",
    services: ["Paid Campaigns", "Analytics"],
    customFields: [],
    dealValue: 6400,
    stage: "Prospect",
    nextAction: "Book discovery call",
    notes: "Demo account — local QA data",
  },
  {
    companyName: "Brightline Dental",
    contactName: "Dr. Owen Park",
    email: "owen@brightline.example",
    phone: "+1 312 555 0190",
    industry: "Healthcare",
    clientType: "commercial",
    address: "2210 N Clark St",
    city: "Chicago",
    state: "IL",
    zip: "60614",
    website: "brightlinedental.example",
    leadSource: "Walk-in",
    services: ["SEO"],
    customFields: [
      { name: "Locations", value: "2" },
      { name: "New-patient flow", value: "Referrals + Google" },
    ],
    dealValue: 3600,
    stage: "Intake",
    nextAction: "Collect analytics access",
    notes: "Demo account — local QA data",
  },
  {
    companyName: "Kestrel Logistics",
    contactName: "Priya Nair",
    email: "priya@kestrel.example",
    phone: "",
    industry: "Transport",
    clientType: "commercial",
    address: "900 Dravus St",
    city: "Seattle",
    state: "WA",
    zip: "98109",
    website: "kestrellogistics.example",
    leadSource: "Referral",
    services: ["Premium Website", "Paid Campaigns", "Analytics"],
    customFields: [
      { name: "Fleet size", value: "22" },
      { name: "Service area", value: "PNW" },
    ],
    dealValue: 18500,
    stage: "Build",
    nextAction: "Design review #2",
    notes: "Demo account — local QA data",
  },
  {
    companyName: "Fable & Folk",
    contactName: "Theo Brandt",
    email: "theo@fablefolk.example",
    phone: "",
    industry: "E-commerce",
    clientType: "commercial",
    address: "",
    city: "Portland",
    state: "OR",
    zip: "97205",
    website: "fablefolk.example",
    leadSource: "Website",
    services: ["Premium Website", "SEO", "Analytics"],
    customFields: [],
    dealValue: 12000,
    stage: "Launch",
    nextAction: "Monitor launch analytics",
    notes: "Demo account — local QA data",
  },
  {
    companyName: "Cedar & Sage Realty",
    contactName: "Leah Monroe",
    email: "leah@cedarsage.example",
    phone: "",
    industry: "Real Estate",
    clientType: "commercial",
    address: "1501 4th Ave",
    city: "Seattle",
    state: "WA",
    zip: "98101",
    leadSource: "Referral",
    services: ["SEO", "Paid Campaigns"],
    customFields: [
      { name: "Agents", value: "8" },
      { name: "Markets", value: "Seattle / Tacoma" },
    ],
    dealValue: 7200,
    stage: "Retainer",
    nextAction: "Monthly report due",
    notes: "Demo account — local QA data",
  },
  {
    companyName: "Summit Heating & Air",
    contactName: "Ray Ortiz",
    email: "ray@summit.example",
    phone: "+1 415 555 0131",
    industry: "HVAC",
    clientType: "residential",
    address: "4820 Geary Blvd",
    city: "San Francisco",
    state: "CA",
    zip: "94118",
    leadSource: "Referral",
    services: ["Installation", "Repair", "Maintenance"],
    customFields: [
      { name: "License #", value: "CA-88213" },
      { name: "Service area", value: "Greater Bay Area" },
      { name: "Fleet size", value: "12" },
    ],
    dealValue: 9500.5,
    stage: "Prospect",
    nextAction: "Send quote",
    notes: "Demo account — local QA data",
  },
  {
    companyName: "Willow & Stone Landscapes",
    contactName: "Dana Kim",
    email: "dana@willowstone.example",
    phone: "+1 206 555 0144",
    industry: "Landscaping",
    clientType: "commercial",
    address: "3327 22nd Ave S",
    city: "Seattle",
    state: "WA",
    zip: "98144",
    website: "willowstone.example",
    leadSource: "Website",
    services: ["Mowing", "Design", "Irrigation"],
    customFields: [
      { name: "Crew size", value: "6" },
      { name: "Seasonal contract", value: "Yes — Apr to Oct" },
      { name: "Service radius", value: "40 mi" },
    ],
    dealValue: 4200,
    stage: "Build",
    nextAction: "Site visit",
    notes: "Demo account — local QA data",
  },
];

const wantDemo = process.argv.includes("--demo") || process.env.SEED_DEMO === "1";
if (wantDemo) {
  // Phase 3b: define the default org's custom fields (idempotent — only set
  // when the org has none yet, so an owner who customized settings isn't
  // overwritten on redeploy).
  const orgRow = db.query("SELECT custom_fields FROM orgs WHERE id = ?").get(demoOrgId) as
    | { custom_fields: string }
    | null;
  if (orgRow && (!orgRow.custom_fields || orgRow.custom_fields === "[]")) {
    db.query("UPDATE orgs SET custom_fields = ? WHERE id = ?").run(
      JSON.stringify(DEMO_ORG_FIELDS),
      demoOrgId,
    );
    console.log(`[seed] demo data: default org custom fields defined (${DEMO_ORG_FIELDS.length} fields).`);
  }
  const { c } = db.query("SELECT COUNT(*) AS c FROM clients WHERE org_id = ?").get(demoOrgId) as { c: number };
  if (c > 0) {
    console.log(`[seed] default org already has ${c} clients — skipping demo seed (run \`bun run db:reset\` for a clean slate).`);
  } else {
    const insert = db.prepare(
      `INSERT INTO clients
         (org_id, company_name, contact_name, email, phone, industry, services, custom_fields, deal_value, stage, next_action, notes, client_type, address, city, state, zip, website, lead_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const cl of DEMO_CLIENTS) {
        insert.run(
          demoOrgId, cl.companyName, cl.contactName, cl.email, cl.phone, cl.industry,
          JSON.stringify(cl.services), JSON.stringify(cl.customFields), cl.dealValue,
          cl.stage, cl.nextAction, cl.notes,
          cl.clientType ?? "residential", cl.address ?? "", cl.city ?? "", cl.state ?? "", cl.zip ?? "",
          cl.website ?? "", cl.leadSource ?? "",
        );
      }
    });
    tx();
    console.log(`[seed] demo data: seeded ${DEMO_CLIENTS.length} clients (incl. HVAC + Landscaping with custom fields).`);

    // Demo tasks — linked to the seeded clients by company name (dates are
    // relative to today so the Task board shows overdue/today states).
    const demoDate = (offsetDays: number): string => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${m}-${day}`;
    };
    const DEMO_TASKS = [
      {
        title: "Send quote",
        clientName: "Summit Heating & Air",
        dueDate: demoDate(-3),
        done: 0,
        notes: "Itemized proposal for full install + maintenance plan.",
      },
      {
        title: "Deliver first design concepts",
        clientName: "Northline Coffee",
        dueDate: demoDate(0),
        done: 0,
        notes: "Two homepage directions + typography exploration.",
      },
      {
        title: "Collect analytics access",
        clientName: "Brightline Dental",
        dueDate: demoDate(-1),
        done: 1,
        notes: "GA4 + Search Console permissions.",
      },
      {
        title: "Monthly report due",
        clientName: "Cedar & Sage Realty",
        dueDate: demoDate(14),
        done: 0,
        notes: "SEO + paid performance summary.",
      },
      {
        title: "Review competitor landing pages",
        clientName: "",
        dueDate: "",
        done: 0,
        notes: "Standalone research before the next proposal.",
      },
    ];
    const clientIdByName = new Map<string, number>();
    const clientRows = db.query("SELECT id, company_name FROM clients WHERE org_id = ?").all(demoOrgId) as {
      id: number;
      company_name: string;
    }[];
    for (const r of clientRows) clientIdByName.set(r.company_name, r.id);

    const insertTask = db.prepare(
      `INSERT INTO tasks (org_id, title, client_id, due_date, done, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const taskTx = db.transaction(() => {
      for (const tk of DEMO_TASKS) {
        insertTask.run(
          demoOrgId,
          tk.title,
          tk.clientName ? (clientIdByName.get(tk.clientName) ?? null) : null,
          tk.dueDate,
          tk.done,
          tk.notes,
        );
      }
    });
    taskTx();
    console.log(`[seed] demo data: seeded ${DEMO_TASKS.length} tasks (linked to demo clients + one standalone).`);

    // Demo invoices — linked to the seeded demo clients by company name so the
    // Finance summary cards show every state: paid, outstanding, overdue, draft.
    const DEMO_INVOICES = [
      {
        clientName: "Kestrel Logistics",
        amount: 9000,
        status: "sent",
        dueDate: demoDate(4),
        notes: "Website build — deposit, invoice 1 of 2.",
      },
      {
        clientName: "Fable & Folk",
        amount: 12000,
        status: "paid",
        dueDate: demoDate(-20),
        notes: "Flagship site — paid in full.",
      },
      {
        clientName: "Cedar & Sage Realty",
        amount: 2400,
        status: "sent",
        dueDate: demoDate(-7),
        notes: "Monthly SEO retainer — payment past due.",
      },
      {
        clientName: "Northline Coffee",
        amount: 4750,
        status: "draft",
        dueDate: demoDate(10),
        notes: "Kickoff invoice — 50% upfront.",
      },
      {
        clientName: "Willow & Stone Landscapes",
        amount: 2100,
        status: "sent",
        dueDate: demoDate(21),
        notes: "First milestone invoice.",
      },
    ];
    const insertInvoice = db.prepare(
      `INSERT INTO invoices (org_id, client_id, amount, status, due_date, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const invoiceTx = db.transaction(() => {
      for (const inv of DEMO_INVOICES) {
        insertInvoice.run(
          demoOrgId,
          clientIdByName.get(inv.clientName) ?? null,
          inv.amount,
          inv.status,
          inv.dueDate,
          inv.notes,
        );
      }
    });
    invoiceTx();
    console.log(`[seed] demo data: seeded ${DEMO_INVOICES.length} invoices (sent/paid/draft states across demo clients).`);
  }
}

// Demo CLIENT ORG (Phase 2 — per-tenant login demo). A separate org with its
// own member login, so the owner can immediately test the product's multi-
// tenancy: log out → log in as acme@demo.example / AcmeDemo123! → see ONLY
// Acme Landscaping's data (nothing from Elevate Studio's own org).
// Phase 3a: the demo org also gets landscaping-appropriate pipeline stages so
// the owner can see per-vertical stage names right away.
// Idempotent: skipped if the org already exists.
const DEMO_CLIENT_ORG = {
  name: "Acme Landscaping",
  email: "acme@demo.example",
  password: "AcmeDemo123!",
  stages: ["Lead", "Site Visit", "Estimate", "Contract", "Active", "Completed"],
  // Phase 3b: the demo tenant's own custom fields — landscaping-specific.
  customFields: [
    { name: "Crew size", type: "number" },
    { name: "Contract", type: "text" },
    { name: "License #", type: "text" },
    { name: "Yearly contract", type: "checkbox" },
  ],
};

const DEMO_CLIENT_ORG_CLIENTS = [
  {
    companyName: "Greenlawn Estates HOA",
    contactName: "Pat Alvarez",
    email: "pat@greenlawn.example",
    phone: "+1 602 555 0173",
    industry: "Property Management",
    clientType: "commercial",
    address: "1845 W Greenway Rd",
    city: "Phoenix",
    state: "AZ",
    zip: "85023",
    leadSource: "Referral",
    services: ["Weekly mowing", "Fertilization", "Irrigation"],
    customFields: [
      { name: "Crew size", value: "4" },
      { name: "Contract", value: "Year-round" },
    ],
    dealValue: 3200,
    stage: "Contract",
    nextAction: "Walk the property with the HOA board",
    notes: "Demo account — client org QA data",
  },
  {
    companyName: "Cactus Ridge HOA",
    contactName: "Miguel Sandoval",
    email: "miguel@cactusridge.example",
    phone: "",
    industry: "Property Management",
    clientType: "commercial",
    address: "6120 E Cactus Rd",
    city: "Scottsdale",
    state: "AZ",
    zip: "85254",
    leadSource: "Website",
    services: ["Seasonal cleanup", "Tree trimming"],
    customFields: [{ name: "Crew size", value: "2" }],
    dealValue: 1800,
    stage: "Lead",
    nextAction: "Send seasonal quote",
    notes: "Demo account — client org QA data",
  },
  {
    companyName: "Sonoran Stoneworks",
    contactName: "Elena Vasquez",
    email: "elena@sonoranstone.example",
    phone: "+1 520 555 0188",
    industry: "Hardscaping",
    clientType: "commercial",
    address: "4410 E Grant Rd",
    city: "Tucson",
    state: "AZ",
    zip: "85712",
    website: "sonoranstone.example",
    leadSource: "Referral",
    services: ["Paver patios", "Retaining walls", "Design"],
    customFields: [
      { name: "Crew size", value: "6" },
      { name: "License #", value: "AZ-44209" },
    ],
    dealValue: 12400,
    stage: "Active",
    nextAction: "Deliver paver samples",
    notes: "Demo account — client org QA data",
  },
];

if (wantDemo) {
  const existing = db.query("SELECT id FROM orgs WHERE name = ?").get(DEMO_CLIENT_ORG.name) as
    | { id: number }
    | null;
  if (existing) {
    console.log(`[seed] demo client org "${DEMO_CLIENT_ORG.name}" already exists — skipping.`);
  } else {
    const hash = await hashPassword(DEMO_CLIENT_ORG.password);
    const tx = db.transaction(() => {
      const orgId = Number(
        db
          .query("INSERT INTO orgs (name, stages, custom_fields) VALUES (?, ?, ?)")
          .run(
            DEMO_CLIENT_ORG.name,
            JSON.stringify(DEMO_CLIENT_ORG.stages),
            JSON.stringify(DEMO_CLIENT_ORG.customFields),
          ).lastInsertRowid,
      );
      db.query("INSERT INTO users (email, password_hash, org_id, role) VALUES (?, ?, ?, 'member')").run(
        DEMO_CLIENT_ORG.email,
        hash,
        orgId,
      );
      const insertClient = db.prepare(
        `INSERT INTO clients
           (org_id, company_name, contact_name, email, phone, industry, services, custom_fields, deal_value, stage, next_action, notes, client_type, address, city, state, zip, website, lead_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const cl of DEMO_CLIENT_ORG_CLIENTS) {
        insertClient.run(
          orgId, cl.companyName, cl.contactName, cl.email, cl.phone, cl.industry,
          JSON.stringify(cl.services), JSON.stringify(cl.customFields), cl.dealValue,
          cl.stage, cl.nextAction, cl.notes,
          cl.clientType ?? "residential", cl.address ?? "", cl.city ?? "", cl.state ?? "", cl.zip ?? "",
          cl.website ?? "", cl.leadSource ?? "",
        );
      }
      return orgId;
    });
    const clientOrgId = tx();
    console.log(
      `[seed] demo data: client org "${DEMO_CLIENT_ORG.name}" (org id ${clientOrgId}, ${DEMO_CLIENT_ORG_CLIENTS.length} clients) — login ${DEMO_CLIENT_ORG.email}`,
    );
  }
}

process.exit(result.created ? 0 : 1);
