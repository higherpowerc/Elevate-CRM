# Elevate Studio CRM

A standalone client-pipeline management application — **its own codebase, separate from the
agency website** (`/home/team/shared/site`). Built as a product track: universal data model
that works for any company type, real database, its own deployment path.

**Owner pipeline:** `Leads → Intakes → Sold` (owner direction 2026-08-14, shipped in 3g-2: the
owner org is migrated at boot — its stored stage list is replaced and every client is
remapped positionally, old bands [1-2] → Leads, [3-4] → Intakes, [5-6] → Sold). Tenants
get their own pipeline from the vertical template chosen at signup (or the legacy
default list for General), untouched by the owner migration.

---

## Stack

| Layer     | Choice                                                             |
| --------- | ------------------------------------------------------------------ |
| Runtime   | [Bun](https://bun.sh) (single process, `Bun.serve`)                |
| API       | Hand-rolled JSON REST API under `/api/*` (no framework dependency) |
| Database  | SQLite via `bun:sqlite` — a real DB file (`data/crm.db`)           |
| Frontend  | React 19 SPA, bundled with `bun build` (no Vite/Next needed)       |
| Styling   | Hand-written design-system CSS (dark premium, Elevate Studio look) |
| Auth      | bcrypt password hashing (`Bun.password`) + HMAC-signed session cookie |

Everything runs as **one Bun server**: it serves the built SPA from `dist/` and the API on the
same port. Nothing else to run.

---

## Features (MVP)

- **Auth** — email + password login. Admin account seeded from env (`ADMIN_EMAIL` /
  `ADMIN_PASSWORD`); **no hardcoded defaults** — if the env vars are unset the server logs a
  clear setup message and login returns `503 setup_required` with instructions.
- **Pipeline** — per-org stages, enforced server-side: the owner org runs `Leads →
  Intakes → Sold` (3g-2); tenant orgs run their vertical-seeded stages; every stage
  list is renamable/reorderable in Settings (a rename migrates its clients
  positionally).
- **Dashboard** — counts per stage, **projected pipeline** (sum of deal values of active,
  non-archived clients — explicitly labeled *projected*, not revenue), recent clients.
- **Clients CRUD** — create, list (search + active/archived/all filter), edit, move between
  stages, archive/restore, delete with confirmation dialog. Fields: company name, contact
  name, email, phone, industry, services (free-form chips — any industry: HVAC, legal, dog
  grooming…), deal value (any magnitude, decimals allowed), stage, next action, notes, and
  **per-client custom fields** (label/value rows — e.g. License #, Service area, Fleet size).
- **Vertical templates (business-type delegation)** — when the owner creates a client
  account they pick a business type (Cleaning, Plumbing, Landscaping, Pest Control, Pool
  Service, Painting, Flooring, Med Spa, Real Estate, or General/no preset). The new org's
  pipeline stages, vertical-specific custom fields (text / yes-no / select-with-options)
  and vertical settings (industry, service model, delivery) are seeded automatically from
  `src/verticals.ts` — no per-vertical code, one shared layout engine, and the tenant can
  rename/reorder/remove everything afterward in Settings. Settings also lets a tenant
  **apply a different template later**: strictly additive and non-destructive — only
  missing stages/fields are appended, nothing is renamed, removed or reordered.
- **UI** — premium dark interface (Inter + Instrument Serif, lime accent), branded loading
  splash (circular progress + Elevate Studio mark), responsive (desktop table → mobile
  stacked cards, bottom-sheet modals).

---

## Quick start (local)

Requirements: [Bun](https://bun.sh) ≥ 1.2 (tested on 1.3.x).

```bash
cd /home/team/shared/crm-app

# 1. Install deps (tiny: react, react-dom, types only)
bun install

# 2. Configure the admin account
cp .env.example .env
#   edit .env → ADMIN_EMAIL + ADMIN_PASSWORD (no defaults exist; pick a strong password)
#   Bun auto-loads .env; you can also export the vars yourself.

# 3. Build the frontend
bun run build

# 4. Start the server
bun run start:local        # binds 0.0.0.0:3001 (see "Port" note below)
# or plain:  bun run start  # respects $PORT (default 3001)

# 5. Open it
#    http://localhost:3001
```

> **Port note for THIS workspace:** the sandbox exports `PORT=80` globally and an ambient
> env var wins over `.env`, so use `bun run start:local` (sets `PORT=3001`) — the app must
> never use port 3000 (the live agency site). On external hosting the platform injects its
> own `PORT`, which `bun run start` respects automatically.

You can also seed/refresh the admin without restarting:

```bash
bun run seed              # idempotent — creates or re-hashes the admin from env
bun run seed -- --demo    # also seed 8 demo clients (incl. HVAC + Landscaping with
                          # custom fields) directly into the DB — only when the
                          # clients table is empty; db:reset for a clean slate
bun run db:reset          # wipes data/crm.db (local QA data only)
```

---

## Environment variables

| Variable          | Required | Purpose                                                                  |
| ----------------- | -------- | ------------------------------------------------------------------------ |
| `ADMIN_EMAIL`     | yes*     | Admin login email. Seeded at startup / `bun run seed`.                   |
| `ADMIN_PASSWORD`  | yes*     | Admin password (min 8 chars). bcrypt-hashed; never stored in plaintext.  |
| `PORT`            | no       | Listen port (default `3001`; ambient env wins — see note above).         |
| `SESSION_SECRET`  | no       | Session signing key (≥16 chars). If unset, a random one is generated and persisted to `data/.secret` so sessions survive restarts. **Set explicitly in production.** |
| `COOKIE_SECURE`   | no       | `"true"` adds the `Secure` cookie flag (required when serving over HTTPS). |
| `DATA_DIR`        | no       | Directory for the SQLite file (default `<project>/data`). Point at a persistent volume in production. |

\* Without them there is no admin account and the app reports "setup required" — by design.

---

## Architecture

```
browser ──► Bun server (server/index.ts) :PORT
              ├── /api/*  → server/api.ts   (REST handlers, auth gate)
              │             ├── server/db.ts    (bun:sqlite, schema)
              │             └── server/auth.ts  (bcrypt hash, signed sessions)
              └── /*      → static files from dist/  (built React SPA)
                                └── src/*  React 19 SPA (types.ts, api.ts,
                                             App/Login/Dashboard/Clients/
                                             ClientModal/ConfirmDialog, styles.css)
```

- **API design:** JSON in/out, `HttpOnly` cookie session (`elevate_session`, HMAC-SHA256
  signed, 7-day expiry). All `/api/*` routes except login require a valid session.
- **SPA routing:** lightweight internal state routing (Dashboard / Clients tabs + modals) —
  no router dependency; the server falls back unknown paths to `index.html`.
- **Build:** `bun build ./index.html --outdir ./dist --minify` → hashed JS/CSS assets.

### Data model & storage
SQLite file at `DATA_DIR/crm.db` (default `./data/crm.db`), WAL mode. Multi-tenant
(Phase 1): every data row belongs to an org, and every user belongs to exactly one org.

```sql
orgs    (id, name, created_at)
users   (id, email UNIQUE, password_hash, org_id → orgs.id, role TEXT admin|member,
         created_at)
clients (id, org_id → orgs.id, company_name, contact_name, email, phone, industry,
         services JSON text, custom_fields JSON text, deal_value REAL, stage TEXT,
         next_action, notes, archived INTEGER, created_at, updated_at)
tasks    (id, org_id → orgs.id, title, client_id → clients.id (ON DELETE SET NULL),
          due_date, done, notes, created_at, updated_at)
invoices (id, org_id → orgs.id, client_id → clients.id (ON DELETE SET NULL),
          amount REAL, status TEXT draft|sent|paid, due_date, notes, created_at, updated_at)
```

`services` and `custom_fields` are stored as JSON string columns; `stage` is validated
against the six stages server-side. `services` is a free-form array of strings (any
industry — no picklist), and `custom_fields` is an array of `{label, value}` objects.
The universal model means the app fits any company type — nothing is hardcoded to Elevate
Studio's own service categories.

**Multi-tenancy (Phase 1).** Each org's data is fully isolated: every API route scopes
its queries by the authenticated user's `org_id` (from the session — never from the
request body), so a user can only read/write rows inside their own org. Touching another
org's row returns `404` (existence is not leaked). Tasks and invoices may only link to
clients in the same org (cross-org links are rejected with `400`). The default org
"Elevate Studio" is created automatically on boot; a pre-existing single-tenant database
is migrated on boot by adding `org_id`/`role` columns and backfilling every row and user
into the default org (idempotent, safe on every boot). The admin account from
`ADMIN_EMAIL` lives in the default org with role `admin`. Role `admin` currently behaves
like `member` inside its own org — cross-org admin access is Phase 2. Account
provisioning (signup, per-tenant login) is Phase 2; the schema is ready for it.

**Backup:** copy `data/crm.db` (with the WAL checkpointed — stop the server or use
`sqlite3 data/crm.db ".backup out.db"`).

---

## API reference

| Method   | Path                 | Body / query                                   | Notes                              |
| -------- | -------------------- | ---------------------------------------------- | ---------------------------------- |
| POST     | `/api/auth/login`    | `{email, password}`                            | Sets session cookie; `503 setup_required` if no admin exists |
| POST     | `/api/auth/logout`   | —                                              | Clears cookie                      |
| GET      | `/api/auth/me`       | —                                              | Current user (`impersonating`/`impersonatedFrom` set during Phase 3d owner impersonation) |
| POST     | `/api/admin/impersonate` | `{orgId}`                                  | Owner-only (403 for members): swap the session into that tenant's user — no password, no new users; `impersonating:true` + `impersonatedFrom` in response |
| POST     | `/api/auth/impersonate-return` | —                                        | Swap back to the owner's own session (400 if not impersonating) |
| GET      | `/api/dashboard`     | —                                              | Stage counts, projectedPipeline (active only), recent clients |
| GET      | `/api/clients`       | `?archived=1` `?q=term`                        | List (archived hidden by default)  |
| POST     | `/api/clients`       | full client object (incl. `services` string[] and `customFields` {label,value}[]) | 201 on create; 400 on invalid      |
| GET      | `/api/clients/:id`   | —                                              |                                   |
| PUT      | `/api/clients/:id`   | full client object (partial updates via same shape) | Move stage, edit fields, archive |
| DELETE   | `/api/clients/:id`   | —                                              | Permanent (UI requires confirm)    |

Run the end-to-end suite (needs a running server with the QA admin from `.env`):

```bash
bash test/api-e2e.sh        # auth guards → login → CRUD → stage moves → archive → delete →
                            # customFields round-trip → free-form services → decimal deal values → logout
```

---

## Auth & security notes (MVP-grade — read before launch)

- Passwords are hashed with **bcrypt** (`Bun.password.hash`, cost 10) — never plaintext.
- Sessions are **HMAC-SHA256-signed tokens** in an `HttpOnly; SameSite=Lax` cookie. Not
  stored server-side; logout works by expiring the cookie.
- **Must harden before a public launch:**
  1. **Rate limiting** on login (e.g. per-IP + per-account throttling) and brute-force lockout.
  2. **CSRF protection** for state-changing requests (SameSite=Lax helps, but add a CSRF
     token or Origin check before multi-user deployment).
  3. Consider **argon2id** (`Bun.password` supports it) and per-user salt rotation policy.
  4. Move `SESSION_SECRET` + admin creds into the host's **secret manager** (never env files in git).
  5. Set `COOKIE_SECURE=true` under HTTPS; add `Strict-Transport-Security` at the proxy.
  6. Add DB file permissions, automated backups, and audit logging for destructive actions.

---

## Deploy to external hosting

The app is a single Bun process with a static frontend — deploy anywhere Bun runs.

**Recommended: Fly.io / Render / Railway (any Bun-capable host).**

1. **Push the code** (all of it — `server/`, `src/`, `index.html`, `package.json`,
   `bun.lock`; `data/`, `dist/`, `node_modules/` are gitignored).
2. **Build step:** `bun install && bun run build` (produces `dist/`).
3. **Start command:** `bun run start` — the platform injects `PORT` (e.g. `8080`), the
   server binds `0.0.0.0`, so the public proxy just works.
4. **Persistent storage:** set `DATA_DIR` to a **persistent volume path** (SQLite is
   single-writer — one instance only; if you scale horizontally you must move to Postgres,
   see below). On Fly.io, mount a volume at `/data` and set `DATA_DIR=/data`.
5. **Env vars:** `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (long random),
   `COOKIE_SECURE=true`.
6. **First boot:** the server seeds the admin from env automatically (or run
   `bun run seed` once via a one-off command).

**Example fly.toml essentials:**

```toml
[env]
  DATA_DIR = "/data"
  COOKIE_SECURE = "true"
  # ADMIN_EMAIL / ADMIN_PASSWORD / SESSION_SECRET come from fly secrets

[mounts]
  source = "crm_data"
  destination = "/data"

[services]
  internal_port = 3001   # or whatever $PORT is
```

### Migrating from SQLite to Postgres (when you scale past one instance)

1. Create the same tables in Postgres — the schema ports almost verbatim:

```sql
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id           BIGSERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  industry     TEXT NOT NULL DEFAULT '',
  services     JSONB NOT NULL DEFAULT '[]',
  custom_fields JSONB NOT NULL DEFAULT '[]',
  deal_value   NUMERIC(12,2) NOT NULL DEFAULT 0,
  stage        TEXT NOT NULL DEFAULT 'Leads',
  next_action  TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  archived     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_stage   ON clients(stage);
CREATE INDEX idx_clients_updated ON clients(updated_at);
```

2. Swap the storage layer: replace `bun:sqlite` calls in `server/db.ts` with a Postgres
   driver (e.g. `postgres` or `drizzle-orm`). The API layer (`server/api.ts`) already
   isolates queries behind `db.ts`, so the change is contained.
3. One-time data export: `sqlite3 data/crm.db ".dump"` → transform → import via `COPY`.
4. Sessions stay stateless (signed cookies), so no session table migration is needed.

---

## Repository layout

```
crm-app/
├── server/           # Bun server: index.ts (entry), api.ts (routes), db.ts (SQLite+schema), auth.ts (hashing/sessions), seed.ts
├── src/              # React SPA: main.tsx, App.tsx, Login, Dashboard, Clients, ClientModal, ConfirmDialog, api.ts, types.ts, styles.css
├── test/api-e2e.sh   # end-to-end API test (auth, CRUD, custom fields, services, deal values)
├── qc/               # QA screenshots (desktop + mobile) from the verification pass
├── index.html        # SPA shell (entry for `bun run build`)
├── .env.example      # documented env template
└── package.json      # build / start / seed scripts
```

QA screenshots from the verification pass live in [`qc/`](qc/): login, dashboard, clients,
and the new-client modal, each at desktop (1440×900) and mobile (390×844) sizes.
