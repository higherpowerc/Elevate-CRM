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
import { ensureAdmin } from "./auth";
import { db } from "./db";

const result = await ensureAdmin();
console.log(result.message);

const DEMO_CLIENTS = [
  {
    companyName: "Northline Coffee",
    contactName: "Sam Rivera",
    email: "sam@northline.example",
    phone: "+1 415 555 0127",
    industry: "Hospitality",
    services: ["Premium Website", "SEO"],
    customFields: [
      { label: "Locations", value: "3" },
      { label: "Roastery", value: "In-house" },
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
    services: ["SEO"],
    customFields: [
      { label: "Locations", value: "2" },
      { label: "New-patient flow", value: "Referrals + Google" },
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
    services: ["Premium Website", "Paid Campaigns", "Analytics"],
    customFields: [
      { label: "Fleet size", value: "22" },
      { label: "Service area", value: "PNW" },
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
    services: ["SEO", "Paid Campaigns"],
    customFields: [
      { label: "Agents", value: "8" },
      { label: "Markets", value: "Seattle / Tacoma" },
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
    services: ["Installation", "Repair", "Maintenance"],
    customFields: [
      { label: "License #", value: "CA-88213" },
      { label: "Service area", value: "Greater Bay Area" },
      { label: "Fleet size", value: "12" },
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
    services: ["Mowing", "Design", "Irrigation"],
    customFields: [
      { label: "Crew size", value: "6" },
      { label: "Seasonal contract", value: "Yes — Apr to Oct" },
      { label: "Service radius", value: "40 mi" },
    ],
    dealValue: 4200,
    stage: "Build",
    nextAction: "Site visit",
    notes: "Demo account — local QA data",
  },
];

const wantDemo = process.argv.includes("--demo") || process.env.SEED_DEMO === "1";
if (wantDemo) {
  const { c } = db.query("SELECT COUNT(*) AS c FROM clients").get() as { c: number };
  if (c > 0) {
    console.log(`[seed] clients table already has ${c} rows — skipping demo seed (run \`bun run db:reset\` for a clean slate).`);
  } else {
    const insert = db.prepare(
      `INSERT INTO clients
         (company_name, contact_name, email, phone, industry, services, custom_fields, deal_value, stage, next_action, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const cl of DEMO_CLIENTS) {
        insert.run(
          cl.companyName, cl.contactName, cl.email, cl.phone, cl.industry,
          JSON.stringify(cl.services), JSON.stringify(cl.customFields), cl.dealValue,
          cl.stage, cl.nextAction, cl.notes,
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
    const clientRows = db.query("SELECT id, company_name FROM clients").all() as {
      id: number;
      company_name: string;
    }[];
    for (const r of clientRows) clientIdByName.set(r.company_name, r.id);

    const insertTask = db.prepare(
      `INSERT INTO tasks (title, client_id, due_date, done, notes) VALUES (?, ?, ?, ?, ?)`,
    );
    const taskTx = db.transaction(() => {
      for (const tk of DEMO_TASKS) {
        insertTask.run(
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
      `INSERT INTO invoices (client_id, amount, status, due_date, notes) VALUES (?, ?, ?, ?, ?)`,
    );
    const invoiceTx = db.transaction(() => {
      for (const inv of DEMO_INVOICES) {
        insertInvoice.run(
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

process.exit(result.created ? 0 : 1);
