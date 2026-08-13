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
  }
}

process.exit(result.created ? 0 : 1);
