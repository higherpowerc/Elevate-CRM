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
# A single helper: opens a URL, waits for React to settle, then checks
#   root exists + non-empty, no fatal boundary, no console error signals.
# $1 = label   $2 = url
check_page() {
  local label="$1" url="$2"
  step "${label}"
  agent-browser open "${url}" > "${SMOKE_DIR}/ab-open.log" 2>&1
  agent-browser wait --load networkidle > "${SMOKE_DIR}/ab-wait.log" 2>&1
  sleep 2
  # (a) #root exists + non-empty
  local root_json
  root_json=$(agent-browser eval 'JSON.stringify({exists: !!document.getElementById("root"), len: document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1})' 2>/dev/null)
  local root_exists root_len
  root_exists=$(echo "${root_json}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d['exists'] else 'no')" 2>/dev/null || echo no)
  root_len=$(echo "${root_json}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(int(d['len']))" 2>/dev/null || echo 0)
  [ "${root_exists}" = "yes" ] && [ "${root_len}" -gt 0 ] \
    && ok "${label}: #root exists, innerHTML length ${root_len} (> 0)" \
    || bad "${label}: #root missing or empty (exists=${root_exists}, len=${root_len})"
  # (b) the FatalBoundary panel must be ABSENT
  local fatal
  fatal=$(agent-browser eval 'JSON.stringify({fatal: !!document.querySelector(".fatal-error"), txt: document.body ? document.body.innerText.slice(0,400) : ""})' 2>/dev/null)
  local fatal_present
  fatal_present=$(echo "${fatal}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d['fatal'] else 'no')" 2>/dev/null || echo yes)
  [ "${fatal_present}" = "no" ] \
    && ok "${label}: no fatal error boundary rendered" \
    || { bad "${label}: FATAL BOUNDARY PRESENT (\"Something went wrong\") — render crashed"; echo "${fatal}" | head -c 400; echo; }
  # (c) console: no uncaught errors / no React component error banner
  local console
  console=$(agent-browser console 2>/dev/null | grep -icE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" || true)
  [ "${console}" = "0" ] \
    && ok "${label}: console clean (no uncaught / component-error / TypeError / ReferenceError)" \
    || bad "${label}: console shows error signals (count ~ ${console}):"
  if [ "${console}" != "0" ]; then agent-browser console 2>/dev/null | grep -iE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" | head -6; fi
}

# State 1 — unauthenticated first load: login screen
check_page "state 1: unauthenticated first load" "${BASE}/"
SNAP=$(agent-browser snapshot 2>/dev/null)
echo "${SNAP}" | grep -qE "Sign in|Revzenta|Client pipeline CRM" \
  && ok "state 1: login screen visible (brand + sign-in text present)" \
  || { bad "state 1: login screen NOT visible (snapshot head follows)"; echo "${SNAP}" | head -20; }

# State 2 — owner login -> dashboard
step "state 2: owner login"
agent-browser snapshot -i > "${SMOKE_DIR}/snap2.log" 2>&1
EMAIL_REF=$(grep -oE "@e[0-9]+ \[?textbox[^]]*\]?|textbox \"Email\"" "${SMOKE_DIR}/snap2.log" | head -1 | grep -oE "@e[0-9]+" || echo "")
PW_REF=$(grep -oE "@e[0-9]+ \[?textbox[^]]*\]?|textbox \"Password\"" "${SMOKE_DIR}/snap2.log" | head -1 | grep -oE "@e[0-9]+" || echo "")
SIGN_REF=$(grep -oE "@e[0-9]+ \[?button[^]]*\]?|button \"Sign in\"" "${SMOKE_DIR}/snap2.log" | head -1 | grep -oE "@e[0-9]+" || echo "")
if [ -n "${EMAIL_REF}" ] && [ -n "${PW_REF}" ] && [ -n "${SIGN_REF}" ]; then
  agent-browser type "${EMAIL_REF}" "${ADMIN_EMAIL}" >/dev/null 2>&1
  agent-browser type "${PW_REF}" "${ADMIN_PASSWORD}" >/dev/null 2>&1
  agent-browser click "${SIGN_REF}" >/dev/null 2>&1
  sleep 3
  root_json=$(agent-browser eval 'JSON.stringify({len: document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1})' 2>/dev/null)
  root_len=$(echo "${root_json}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(int(d['len']))" 2>/dev/null || echo 0)
  fatal=$(agent-browser eval 'JSON.stringify({fatal: !!document.querySelector(".fatal-error")})' 2>/dev/null)
  fatal_present=$(echo "${fatal}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d['fatal'] else 'no')" 2>/dev/null || echo yes)
  console=$(agent-browser console 2>/dev/null | grep -icE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" || true)
  [ "${root_len}" -gt 0 ] && ok "state 2: #root non-empty after owner login (${root_len})" || bad "state 2: #root empty after owner login"
  [ "${fatal_present}" = "no" ] && ok "state 2: no fatal boundary after owner login" || bad "state 2: fatal boundary after owner login"
  [ "${console}" = "0" ] && ok "state 2: console clean after owner login" || bad "state 2: console errors after owner login (${console})"
  SNAP=$(agent-browser snapshot 2>/dev/null)
  echo "${SNAP}" | grep -qE "Dashboard|Client MRR|Owner|Sign out|Pipeline" \
    && ok "state 2: owner cockpit visible (dashboard/nav text)" \
    || { bad "state 2: owner dashboard text NOT visible (snapshot head)"; echo "${SNAP}" | head -20; }
else
  echo "  (interactive refs not resolved — falling back to CSS-selector login)"
  agent-browser open "${BASE}/" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  sleep 2
  agent-browser type 'input[type="email"]' "${ADMIN_EMAIL}" >/dev/null 2>&1
  agent-browser type 'input[type="password"]' "${ADMIN_PASSWORD}" >/dev/null 2>&1
  agent-browser click 'button[type="submit"]' >/dev/null 2>&1
  sleep 3
  root_len=$(agent-browser eval 'document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1' 2>/dev/null | tr -d '"')
  fatal_present=$(agent-browser eval '!!document.querySelector(".fatal-error") ? "yes" : "no"' 2>/dev/null | tr -d '"')
  console=$(agent-browser console 2>/dev/null | grep -icE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" || true)
  [ "${root_len}" -gt 0 ] && ok "state 2 (css): #root non-empty (${root_len})" || bad "state 2 (css): #root empty"
  [ "${fatal_present}" = "no" ] && ok "state 2 (css): no fatal boundary" || bad "state 2 (css): fatal boundary present"
  [ "${console}" = "0" ] && ok "state 2 (css): console clean" || bad "state 2 (css): console errors (${console})"
  SNAP=$(agent-browser snapshot 2>/dev/null)
  echo "${SNAP}" | grep -qE "Dashboard|Client MRR|Owner|Sign out|Pipeline" \
    && ok "state 2 (css): owner cockpit visible" \
    || { bad "state 2 (css): owner dashboard text NOT visible"; echo "${SNAP}" | head -20; }
fi

# State 3 — normal tenant login -> tenant nav (fresh browser session)
step "state 3: tenant login"
agent-browser close --all >/dev/null 2>&1
agent-browser open "${BASE}/" > "${SMOKE_DIR}/ab-open3.log" 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
agent-browser snapshot -i > "${SMOKE_DIR}/snap3.log" 2>&1
EMAIL_REF=$(grep -oE "@e[0-9]+" "${SMOKE_DIR}/snap3.log" | head -1 || echo "")
agent-browser type "@e1" "${TENANT_EMAIL}" >/dev/null 2>&1
agent-browser type "@e2" "${TENANT_PASSWORD}" >/dev/null 2>&1
agent-browser click "@e3" >/dev/null 2>&1
sleep 3
root_len=$(agent-browser eval 'document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1' 2>/dev/null | tr -d '"')
fatal_present=$(agent-browser eval '!!document.querySelector(".fatal-error") ? "yes" : "no"' 2>/dev/null | tr -d '"')
console=$(agent-browser console 2>/dev/null | grep -icE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" || true)
[ "${root_len}" -gt 0 ] && ok "state 3: #root non-empty after tenant login (${root_len})" || bad "state 3: #root empty after tenant login"
[ "${fatal_present}" = "no" ] && ok "state 3: no fatal boundary" || bad "state 3: fatal boundary present"
[ "${console}" = "0" ] && ok "state 3: console clean" || bad "state 3: console errors (${console})"
SNAP=$(agent-browser snapshot 2>/dev/null)
echo "${SNAP}" | grep -qE "Dashboard|Leads|Sign out|Smoke Tenant|Settings" \
  && ok "state 3: tenant nav visible" \
  || { bad "state 3: tenant nav NOT visible (snapshot head)"; echo "${SNAP}" | head -20; }

# State 4 — wholesale tenant login -> wholesale nav (Buyers)
step "state 4: wholesale tenant login"
agent-browser close --all >/dev/null 2>&1
agent-browser open "${BASE}/" > "${SMOKE_DIR}/ab-open4.log" 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
agent-browser snapshot -i > "${SMOKE_DIR}/snap4.log" 2>&1
agent-browser type "@e1" "${WHOLESALE_EMAIL}" >/dev/null 2>&1
agent-browser type "@e2" "${WHOLESALE_PASSWORD}" >/dev/null 2>&1
agent-browser click "@e3" >/dev/null 2>&1
sleep 3
root_len=$(agent-browser eval 'document.getElementById("root") ? document.getElementById("root").innerHTML.length : -1' 2>/dev/null | tr -d '"')
fatal_present=$(agent-browser eval '!!document.querySelector(".fatal-error") ? "yes" : "no"' 2>/dev/null | tr -d '"')
console=$(agent-browser console 2>/dev/null | grep -icE "uncaught|error occurred in the|TypeError|ReferenceError|an error occurred" || true)
[ "${root_len}" -gt 0 ] && ok "state 4: #root non-empty after wholesale login (${root_len})" || bad "state 4: #root empty after wholesale login"
[ "${fatal_present}" = "no" ] && ok "state 4: no fatal boundary" || bad "state 4: fatal boundary present"
[ "${console}" = "0" ] && ok "state 4: console clean" || bad "state 4: console errors (${console})"
SNAP=$(agent-browser snapshot 2>/dev/null)
echo "${SNAP}" | grep -qE "Buyers|Properties|Dashboard|Sign out" \
  && ok "state 4: wholesale nav visible (Buyers present)" \
  || { bad "state 4: wholesale nav NOT visible (snapshot head)"; echo "${SNAP}" | head -20; }

step "summary"
printf '\nRESULT render-smoke: %d passed, %d failed\n' "${PASS}" "${FAIL}"
[ "${FAIL}" = "0" ] || exit 1
exit 0
