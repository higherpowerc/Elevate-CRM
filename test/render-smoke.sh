#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Render smoke test — proves the BUILT SPA actually renders in a browser
# before anything ships. This is the second gate that would have caught the
# 2026-09-04 blank-screen incident (src/App.tsx TDZ -> ReferenceError on
# every render): the API e2e suite never renders the React app, so a
# first-load render crash passed with 1689/0. This script opens the real
# bundle in agent-browser and asserts:
#   (a) #root exists and has non-empty innerHTML
#   (b) the login screen / owner dashboard / tenant dashboard visibly render
#   (c) the console has NO uncaught errors and NO "An error occurred in the
#       <...> component" message, and the FatalBoundary ("Something went
#       wrong") panel is ABSENT — i.e. the app booted clean.
#
# Session states covered:
#   1. Unauthenticated first load  — login screen
#   2. Owner login                 — owner cockpit dashboard
#   3. Normal tenant login         — tenant nav
#   4. Wholesale tenant login      — wholesale nav (Buyers tab)
#   (normal + wholesale tenants are created via the admin API at seed time)
#
# Usage:
#   bash test/render-smoke.sh
# Assumes: repo root CWD; `bun install` done; agent-browser installed;
# ports 3008 + 3190 free; no server already on those ports.
# Exit 0 = all states rendered clean. Non-zero = a gate failed (blocks ship).
#
# 2026-09-04/05 hardening (fix for the 12/4 run):
#   - The #root/fatal assertions now POLL for React to mount (#root non-empty)
#     instead of firing once right after `networkidle` + `sleep 2`. On first
#     load the old single eval ran before React had rendered #root, so
#     "exists=no, len=0" + "FATAL BOUNDARY PRESENT" fired while the actual DOM
#     was already showing the login card (the follow-up eval showed
#     {"fatal":false} + full login text). Test-only timing false-positive.
#   - root + fatal are read in ONE eval (single atomic snapshot) so a parse
#     failure can never report one half of the page and not the other.
#   - Logins use CSS selectors (`input[type="email"]`, `input[type="password"]`,
#     `button[type="submit"]`) for EVERY state instead of hard-coded @e1/@e2/@e3
#     refs. Accessibility refs are assigned fresh on every snapshot and go stale
#     the moment the page changes; after `close --all` + re-open the login
#     form's refs are NOT e1/e2/e3 (on a first load Email already shows as
#     @e4), so the old state-3/4 script typed into the wrong elements and
#     ended up on the password-RESET screen instead of the tenant dashboard.
#     The app was fine — member/tenant logins are covered in api-e2e.sh
#     (member login → 200) — this was a test-side stale-ref bug.
#   - After submitting a login the script POLLS the snapshot for the expected
#     dashboard/nav text (up to ~15s) instead of a blind `sleep 3`, so a slow
#     workstation can't false-fail a successful login.
#   - The exit status is explicit: the script prints RESULT + SMOKE_EXIT and
#     `exit 1` when any assertion failed (never masked by a pipe), and also
#     writes SMOKE_EXIT to /tmp/revzenta-render-smoke-exit.txt so a wrapper
#     can verify the script's own exit without trusting a pipe's.
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2
APP_DIR="$(pwd)"
PORT="${SMOKE_PORT:-3008}"
BASE="http://127.0.0.1:${PORT}"
# Throwaway credentials (fresh DATA_DIR per run — the repo's data/crm.db and
# the live DB are never touched).
ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-smoke-owner@test.example}"
ADMIN_PASSWORD="${SMOKE_ADMIN_PASSWORD:-smoke-owner-pass-123}"
TENANT_EMAIL="smoke-tenant@test.example"
TENANT_PASSWORD="smoke-tenant-pass-123"
WHOLESALE_EMAIL="smoke-wholesale@test.example"
WHOLESALE_PASSWORD="smoke-wholesale-pass-123"
SMOKE_DIR="/tmp/revzenta-render-smoke"
DATA_DIR="${SMOKE_DIR}/data"
JAR="${SMOKE_DIR}/cookies.txt"
EXIT_MARKER="/tmp/revzenta-render-smoke-exit.txt"
PASS=0
FAIL=0
step() { printf '\n=== %s ===\n' "$1"; }
ok()   { PASS=$((PASS+1)); printf '  PASS: %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL: %s\n' "$1"; }
cleanup() {
  agent-browser close --all >/dev/null 2>&1
  if [ -f "${SMOKE_DIR}/server.pid" ]; then kill "$(cat "${SMOKE_DIR}/server.pid")" 2>/dev/null; fi
  rm -rf "${SMOKE_DIR}"
}
trap cleanup EXIT

# Single atomic read of the page: prints "yes <len> no" =
# (root exists+non-empty? <innerHTML len> <fatal boundary present?>).
# IMPORTANT: agent-browser prints an OBJECT literal (e.g. `({...})`) as
# parseable pretty JSON, but prints a STRING (JSON.stringify(...)) as a
# JSON-QUOTED escaped string (`"{\"...\"}"`) which json.load once canNOT
# parse (it needs a double load). So this eval returns a plain object and
# the JSON.parse happens once. A parse/eval failure prints "no -1 yes" —
# the gate treats "cannot see the page" as FAILED, never as PASSED.
page_state() {
  agent-browser eval '({exists: !!document.getElementById("root"), len: document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1, fatal: !!document.querySelector(".fatal-error")})' 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); e='yes' if d['exists'] and int(d['len'])>0 else 'no'; print(e, int(d['len']), 'yes' if d['fatal'] else 'no')" 2>/dev/null \
    || echo "no -1 yes"
}
# console error-signal count
console_count() {
  agent-browser console 2>/dev/null | grep -icE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" || true
}

# Wait up to ~20s for #root to exist with non-empty innerHTML (React mounted).
wait_root_mounted() {
  local i st out="no -1 yes"
  for i in $(seq 1 40); do
    st=$(page_state)
    case "${st}" in
      yes*) out="${st}"; break ;;
    esac
    sleep 0.5
  done
  echo "${out}"
}

# Wait up to ~15s for the page snapshot to contain one of the given regex
# alternatives (e.g. post-login nav text). Echoes the LAST snapshot on success
# (so callers can also run diagnostics on it) or "no-match" after timeout.
wait_for_snapshot_text() {
  local pattern="$1" i snap
  for i in $(seq 1 30); do
    snap=$(agent-browser snapshot 2>/dev/null || true)
    if printf '%s' "${snap}" | grep -qE "${pattern}"; then
      printf '%s' "${snap}"
      return 0
    fi
    sleep 0.5
  done
  echo "no-match"
}

# Post-login verdict for states 2/3/4: runs the snapshot-text poll, then the
# root/fatal/console assertions. $1 = label  $2 = snapshot-text pattern
post_login_asserts() {
  local label="$1" pattern="$2"
  local snap st len fatal console
  snap=$(wait_for_snapshot_text "${pattern}")
  if [ "${snap}" = "no-match" ]; then
    snap=$(agent-browser snapshot 2>/dev/null)
    bad "${label}: expected page text NOT visible (snapshot head follows — if this shows the password-RESET screen the login form was not filled correctly)"
    echo "${snap}" | head -20
  else
    ok "${label}: expected page text visible"
  fi
  st=$(wait_root_mounted)
  len=$(echo "${st}" | awk '{print $2}')
  fatal=$(echo "${st}" | awk '{print $3}')
  case "${st}" in
    yes*) ok "${label}: #root non-empty (innerHTML length ${len})" ;;
    *)     bad "${label}: #root missing or empty after mount wait (state=${st})" ;;
  esac
  [ "${fatal}" = "no" ] && ok "${label}: no fatal error boundary" || bad "${label}: FATAL BOUNDARY PRESENT (\"Something went wrong\") — render crashed"
  console=$(console_count)
  [ "${console}" = "0" ] \
    && ok "${label}: console clean (no uncaught / component-error / TypeError / ReferenceError)" \
    || { bad "${label}: console shows error signals (count ~ ${console}):"; agent-browser console 2>/dev/null | grep -iE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" | head -6; }
}

step "setup"
rm -rf "${SMOKE_DIR}"
mkdir -p "${SMOKE_DIR}"
# Build once — the whole point is to smoke the REAL bundle (tsc gate in build).
bun run build > "${SMOKE_DIR}/build.log" 2>&1 || { echo "build failed — see ${SMOKE_DIR}/build.log"; exit 2; }
echo "  bundle built OK"

# Boot the server on the throwaway DATA_DIR, Stripe keys STRIPPED (same recipe
# as the canonical e2e run — prevents any real Stripe/Resend call from the
# smoke flow) and the mock-Resend-less default (no emails needed).
export ADMIN_EMAIL ADMIN_PASSWORD
export DATA_DIR
unset STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY 2>/dev/null
env -u STRIPE_SECRET_KEY -u STRIPE_WEBHOOK_SECRET \
  PORT="${PORT}" DATA_DIR="${DATA_DIR}" \
  ADMIN_EMAIL="${ADMIN_EMAIL}" ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  RESEND_API_KEY=test-key-smoke \
  nohup bun ./server/index.ts > "${SMOKE_DIR}/server.log" 2>&1 &
echo $! > "${SMOKE_DIR}/server.pid"
# Wait for boot (DB migrations + admin seed — allow up to 45s).
booted=0
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "${BASE}/" 2>/dev/null || true)
  if [ "${code}" = "200" ]; then booted=1; break; fi
  sleep 1
done
if [ "${booted}" != "1" ]; then
  echo "  server failed to boot on :${PORT} (last log lines below)"
  tail -20 "${SMOKE_DIR}/server.log"
  exit 2
fi
echo "  server up on :${PORT} (throwaway DATA_DIR=${DATA_DIR})"

# Seed: owner (admin) credentials are set via env at boot; now create the two
# tenant accounts (normal + wholesale) through the admin API so the login
# states below have real tenants. Owner cookie first.
S=$(curl -s -c "${JAR}" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  -o "${SMOKE_DIR}/login.json" -w "%{http_code}" "${BASE}/api/auth/login")
echo "  admin login: HTTP ${S}"
if [ "${S}" != "200" ]; then echo "  admin login failed — aborting (server log:)"; tail -20 "${SMOKE_DIR}/server.log"; exit 2; fi
# Normal tenant
S=$(curl -s -b "${JAR}" -c "${JAR}" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Tenant LLC\",\"email\":\"${TENANT_EMAIL}\",\"password\":\"${TENANT_PASSWORD}\",\"vertical\":\"b2b\"}" \
  -o "${SMOKE_DIR}/tenant.json" -w "%{http_code}" "${BASE}/api/admin/orgs")
[ "${S}" = "201" ] && echo "  tenant created: HTTP ${S}" || { echo "  tenant create failed: HTTP ${S}"; exit 2; }
# Wholesale tenant
S=$(curl -s -b "${JAR}" -c "${JAR}" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Wholesale LLC\",\"email\":\"${WHOLESALE_EMAIL}\",\"password\":\"${WHOLESALE_PASSWORD}\",\"vertical\":\"wholesalebiz\"}" \
  -o "${SMOKE_DIR}/wholesale.json" -w "%{http_code}" "${BASE}/api/admin/orgs")
[ "${S}" = "201" ] && echo "  wholesale tenant created: HTTP ${S}" || { echo "  wholesale create failed: HTTP ${S}"; exit 2; }
rm -f "${JAR}"

# ── browser assertions ──────────────────────────────────────────────────────
# State 1 — unauthenticated first load: login screen
step "state 1: unauthenticated first load"
agent-browser open "${BASE}/" > "${SMOKE_DIR}/ab-open.log" 2>&1
agent-browser wait --load networkidle > "${SMOKE_DIR}/ab-wait.log" 2>&1
st=$(wait_root_mounted)
len=$(echo "${st}" | awk '{print $2}')
fatal=$(echo "${st}" | awk '{print $3}')
case "${st}" in
  yes*) ok "state 1: #root non-empty (innerHTML length ${len})" ;;
  *)     bad "state 1: #root missing or empty after mount wait (state=${st})" ;;
esac
[ "${fatal}" = "no" ] && ok "state 1: no fatal error boundary rendered" || bad "state 1: FATAL BOUNDARY PRESENT (\"Something went wrong\") — render crashed"
console=$(console_count)
[ "${console}" = "0" ] \
  && ok "state 1: console clean (no uncaught / component-error / TypeError / ReferenceError)" \
  || { bad "state 1: console shows error signals (count ~ ${console}):"; agent-browser console 2>/dev/null | grep -iE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" | head -6; }
SNAP=$(agent-browser snapshot 2>/dev/null)
echo "${SNAP}" | grep -qE "Sign in|Revzenta|Client pipeline CRM" \
  && ok "state 1: login screen visible (brand + sign-in text present)" \
  || { bad "state 1: login screen NOT visible (snapshot head follows)"; echo "${SNAP}" | head -20; }

# ── CSS-selector login helper (used by states 2/3/4) ────────────────────────
# $1 = email   $2 = password — fresh session, stable CSS selectors, submit.
css_login() {
  agent-browser close --all >/dev/null 2>&1
  agent-browser open "${BASE}/" > "${SMOKE_DIR}/ab-open-login.log" 2>&1
  agent-browser wait --load networkidle > "${SMOKE_DIR}/ab-wait-login.log" 2>&1
  wait_root_mounted >/dev/null
  agent-browser fill 'input[type="email"]' "$1" >/dev/null 2>&1
  agent-browser fill 'input[type="password"]' "$2" >/dev/null 2>&1
  agent-browser click 'button[type="submit"]' >/dev/null 2>&1
}

# State 2 — owner login -> dashboard
step "state 2: owner login"
css_login "${ADMIN_EMAIL}" "${ADMIN_PASSWORD}"
post_login_asserts "state 2: owner login" "Dashboard|Client MRR|Owner|Sign out|Pipeline"

# State 3 — normal tenant login -> tenant nav (fresh browser session)
step "state 3: tenant login"
css_login "${TENANT_EMAIL}" "${TENANT_PASSWORD}"
post_login_asserts "state 3: tenant login" "Dashboard|Leads|Sign out|Smoke Tenant|Settings"

# State 4 — wholesale tenant login -> wholesale nav (Buyers)
step "state 4: wholesale tenant login"
css_login "${WHOLESALE_EMAIL}" "${WHOLESALE_PASSWORD}"
post_login_asserts "state 4: wholesale tenant login" "Buyers|Properties|Dashboard|Sign out"

step "summary"
if [ "${FAIL}" = "0" ]; then
  printf '\nRESULT render-smoke: %d passed, %d failed — GATE PASS\n' "${PASS}" "${FAIL}"
  RC=0
else
  printf '\nRESULT render-smoke: %d passed, %d failed — GATE FAIL\n' "${PASS}" "${FAIL}"
  RC=1
fi
printf 'SMOKE_EXIT=%d\n' "${RC}" | tee /tmp/revzenta-render-smoke-exit.txt
exit "${RC}"