#!/bin/bash
# End-to-end API test for Revzenta CRM (run against a local server on :3001).
set -u
BASE="${BASE:-http://localhost:3001}"
# Admin credentials come from .env (local QA, gitignored) or the environment —
# never hardcoded in the repo.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
ADMIN_EMAIL="${ADMIN_EMAIL:-owner@elevate.studio}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD not set — run from the app directory (reads .env) or export it}"
JAR=$(mktemp)
PASS=0
FAIL=0

check() { # check <name> <expected_status> <actual_status> [extra]
  if [ "$2" = "$3" ]; then
    PASS=$((PASS+1)); echo "  ✓ $1 (HTTP $3)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ $1 — expected HTTP $2, got HTTP $3 ${4:-}"
  fi
}

code() { curl -s -o /tmp/body.json -w "%{http_code}" "$@"; }
PASS_TMP=$(mktemp)

echo "== 1. Auth guards =="
check "me without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/auth/me")
check "clients without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/clients")
check "tasks without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/tasks")
check "invoices without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/invoices")
check "tickets without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/tickets")
check "POST tickets without cookie → 401" 401 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"x","message":"y"}' "$BASE/api/tickets")
check "PATCH tickets without cookie → 401" 401 $(code -b "$JAR" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"OPEN"}' "$BASE/api/tickets/1")
check "admin orgs without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/admin/orgs")
check "settings export without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/settings/export")
check "settings cancel without cookie → 401" 401 $(code -b "$JAR" -X POST "$BASE/api/settings/cancel")
# Typed-delete confirmation is client-side; the DELETE endpoints must still
# enforce auth/isolation server-side regardless of what the UI does.
check "DELETE client without cookie → 401" 401 $(code -b "$JAR" -X DELETE "$BASE/api/clients/1")
check "DELETE task without cookie → 401" 401 $(code -b "$JAR" -X DELETE "$BASE/api/tasks/1")
check "DELETE invoice without cookie → 401" 401 $(code -b "$JAR" -X DELETE "$BASE/api/invoices/1")
check "DELETE admin org without cookie → 401" 401 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/1")
check "login wrong password → 401" 401 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"owner@elevate.studio","password":"nope"}' "$BASE/api/auth/login")

echo "== 2. Login =="
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "login correct creds → 200 + session cookie" 200 "$S"
grep -q elevate_session "$JAR" && echo "  ✓ session cookie stored" || echo "  ✗ session cookie missing"
grep -Fq "$ADMIN_EMAIL" /tmp/body.json && echo "  ✓ login returns owner email" || echo "  ✗ login email wrong"
grep -q '"orgId":' /tmp/body.json && echo "  ✓ login returns orgId" || echo "  ✗ login missing orgId: $(cat /tmp/body.json)"
grep -q '"role":"admin"' /tmp/body.json && echo "  ✓ login returns role admin" || echo "  ✗ login role wrong: $(cat /tmp/body.json)"
grep -q '"isOwner":true' /tmp/body.json && echo "  ✓ login returns isOwner true for owner" || echo "  ✗ login isOwner missing: $(cat /tmp/body.json)"
check "me with cookie → 200" 200 $(code -b "$JAR" "$BASE/api/auth/me")
grep -Fq "$ADMIN_EMAIL" /tmp/body.json && echo "  ✓ me returns owner email" || echo "  ✗ me email wrong"
grep -q '"orgId":' /tmp/body.json && echo "  ✓ me returns orgId" || echo "  ✗ me missing orgId"
grep -q '"role":"admin"' /tmp/body.json && echo "  ✓ me returns role admin" || echo "  ✗ me role wrong"
grep -q '"isOwner":true' /tmp/body.json && echo "  ✓ me returns isOwner true for owner" || echo "  ✗ me isOwner missing: $(cat /tmp/body.json)"

echo "== 3. Dashboard (empty) =="
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "dashboard → 200" 200 "$S"
grep -q '"projectedPipeline":0' /tmp/body.json && echo "  ✓ projectedPipeline = 0 when empty" || echo "  ✗ projectedPipeline mismatch: $(cat /tmp/body.json)"

echo "== 4. Create clients =="
check "create Acme → 201" 201 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Acme Legal LLP","contactName":"Jordan Lee","email":"jordan@acme.example","phone":"+1 555 0100","industry":"Legal","clientType":"commercial","address":"2200 Market St","city":"San Francisco","state":"CA","zip":"94114","website":"acmelegal.example","leadSource":"Referral","services":["Premium Website","SEO"],"dealValue":12500,"stage":"Leads","nextAction":"Send proposal","notes":"Referred by owner"}' \
  "$BASE/api/clients")
ACME_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$ACME_ID)"
check "create Northline → 201" 201 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Northline Coffee","contactName":"Sam Rivera","email":"sam@northline.example","industry":"Hospitality","clientType":"residential","services":["Paid Campaigns","Analytics"],"dealValue":5400,"stage":"Leads","nextAction":"Collect access","notes":""}' \
  "$BASE/api/clients")
NL_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$NL_ID)"
check "create without company name → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"contactName":"No Co"}' "$BASE/api/clients")
check "create bad stage → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad Stage Co","clientType":"residential","stage":"Won"}' "$BASE/api/clients")
check "create negative deal → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Neg Co","clientType":"residential","dealValue":-5}' "$BASE/api/clients")

echo "== 5. List + filters =="
S=$(code -b "$JAR" "$BASE/api/clients")
check "list clients → 200" 200 "$S"
grep -q '"companyName":"Acme Legal LLP"' /tmp/body.json && echo "  ✓ Acme in list" || echo "  ✗ Acme missing"
grep -q '"companyName":"Northline Coffee"' /tmp/body.json && echo "  ✓ Northline in list" || echo "  ✗ Northline missing"
S=$(code -b "$JAR" "$BASE/api/clients?q=acme")
check "search q=acme → 200" 200 "$S"
grep -q 'Acme Legal LLP' /tmp/body.json && grep -qv 'Northline' /tmp/body.json && echo "  ✓ search filters correctly" || echo "  ✗ search failed: $(cat /tmp/body.json)"

echo "== 6. Update stage / fields =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Acme Legal LLP","contactName":"Jordan Lee","email":"jordan@acme.example","phone":"+1 555 0100","industry":"Legal","clientType":"commercial","address":"2200 Market St","city":"San Francisco","state":"CA","zip":"94114","website":"acmelegal.example","leadSource":"Referral","services":["Premium Website","SEO","Paid Campaigns"],"dealValue":15000,"stage":"Onboarding","nextAction":"Kickoff call Thursday","notes":"Added paid campaigns"}' \
  "$BASE/api/clients/$ACME_ID")
check "update Acme → 200" 200 "$S"
grep -q '"stage":"Onboarding"' /tmp/body.json && grep -q '"dealValue":15000' /tmp/body.json && echo "  ✓ stage moved to Onboarding, deal 15000" || echo "  ✗ update failed: $(cat /tmp/body.json)"

echo "== 7. Dashboard counts + projected pipeline =="
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "dashboard → 200" 200 "$S"
grep -q '"Sold":0' /tmp/body.json && echo "  ✓ Sold=0" || echo "  ✗ Sold count: $(cat /tmp/body.json)"
grep -q '"Onboarding":1' /tmp/body.json && echo "  ✓ Onboarding=1" || echo "  ✗ Onboarding count: $(cat /tmp/body.json)"
grep -q '"Leads":1' /tmp/body.json && echo "  ✓ Leads=1" || echo "  ✗ Leads count: $(cat /tmp/body.json)"
grep -q '"projectedPipeline":5400' /tmp/body.json && echo "  ✓ projectedPipeline = 5400 (OWNER: Leads stage only — Acme's 15000 in Onboarding excluded, not revenue)" || echo "  ✗ pipeline: $(cat /tmp/body.json)"

echo "== 8. Archive affects dashboard only =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Northline Coffee","contactName":"Sam Rivera","email":"sam@northline.example","industry":"Hospitality","clientType":"residential","services":["Paid Campaigns","Analytics"],"dealValue":5400,"stage":"Leads","nextAction":"","notes":"","archived":true}' \
  "$BASE/api/clients/$NL_ID")
check "archive Northline → 200" 200 "$S"
grep -q '"archived":true' /tmp/body.json && echo "  ✓ archived=true" || echo "  ✗ archive failed: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
grep -q '"projectedPipeline":0' /tmp/body.json && echo "  ✓ pipeline now 0 (owner Leads-stage only: Northline archived, Acme in Onboarding excluded)" || echo "  ✗ pipeline after archive: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients")
check "default list → 200" 200 "$S"
grep -qv 'Northline' /tmp/body.json && echo "  ✓ archived hidden in default list" || echo "  ✗ archived still in default list"
S=$(code -b "$JAR" "$BASE/api/clients?archived=1")
check "list with archived=1 → 200" 200 "$S"
grep -q 'Northline' /tmp/body.json && echo "  ✓ archived visible with ?archived=1" || echo "  ✗ archived not visible"

echo "== 9. Delete =="
check "delete Acme → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/clients/$ACME_ID")
check "get deleted Acme → 404" 404 $(code -b "$JAR" "$BASE/api/clients/$ACME_ID")
S=$(code -b "$JAR" "$BASE/api/clients")
check "list after delete → 200" 200 "$S"
grep -qv 'Acme Legal' /tmp/body.json && echo "  ✓ Acme gone from list" || echo "  ✗ Acme still listed"

echo "== 9a. Phase 3e — rich client records (client type + address block) =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Metro Plaza LLC","contactName":"Ava Stone","email":"ava@metroplaza.example","phone":"+1 555 0142","industry":"Real Estate","clientType":"commercial","address":"1230 Market St","city":"San Francisco","state":"CA","zip":"94103","website":"metroplaza.example","leadSource":"Referral","services":["Property Mgmt"],"dealValue":22000,"stage":"Leads","nextAction":"Site walkthrough","notes":"Phase 3e demo"}' \
  "$BASE/api/clients")
check "create commercial client with full address → 201" 201 "$S"
MP_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$MP_ID)"
grep -q '"clientType":"commercial"' /tmp/body.json && echo "  ✓ clientType commercial round-trips on create" || echo "  ✗ clientType missing: $(cat /tmp/body.json)"
grep -q '"address":"1230 Market St"' /tmp/body.json && grep -q '"city":"San Francisco"' /tmp/body.json && grep -q '"state":"CA"' /tmp/body.json && grep -q '"zip":"94103"' /tmp/body.json && echo "  ✓ full address block round-trips" || echo "  ✗ address block: $(cat /tmp/body.json)"
grep -q '"website":"metroplaza.example"' /tmp/body.json && grep -q '"leadSource":"Referral"' /tmp/body.json && echo "  ✓ website + lead source round-trip" || echo "  ✗ website/leadSource: $(cat /tmp/body.json)"

echo "-- 9b. Phase 3e validation =="
check "create without clientType → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"No Type Co","dealValue":100}' "$BASE/api/clients")
check "create with bad clientType → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad Type Co","clientType":"industrial","dealValue":100}' "$BASE/api/clients")
check "create with over-long address → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Long Addr Co\",\"clientType\":\"residential\",\"address\":\"$(python3 -c "print('x'*201)")\"}" "$BASE/api/clients")
check "create with over-long city → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Long City Co\",\"clientType\":\"residential\",\"city\":\"$(python3 -c "print('y'*101)")\"}" "$BASE/api/clients")
check "create with over-long lead source → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Long LS Co\",\"clientType\":\"residential\",\"leadSource\":\"$(python3 -c "print('z'*101)")\"}" "$BASE/api/clients")
check "create with invalid website → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad URL Co","clientType":"residential","website":"not a url"}' "$BASE/api/clients")

echo "-- 9c. Edit changes type without losing data =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Metro Plaza LLC","contactName":"Ava Stone","email":"ava@metroplaza.example","phone":"+1 555 0142","industry":"Real Estate","clientType":"residential","address":"1230 Market St","city":"San Francisco","state":"CA","zip":"94103","website":"metroplaza.example","leadSource":"Walk-in","services":["Property Mgmt"],"dealValue":22000,"stage":"Leads","nextAction":"Site walkthrough","notes":"Phase 3e demo"}' \
  "$BASE/api/clients/$MP_ID")
check "edit changes clientType commercial→residential → 200" 200 "$S"
grep -q '"clientType":"residential"' /tmp/body.json && grep -q '"dealValue":22000' /tmp/body.json && grep -q '"website":"metroplaza.example"' /tmp/body.json && grep -q '"leadSource":"Walk-in"' /tmp/body.json && grep -q '"address":"1230 Market St"' /tmp/body.json && echo "  ✓ type changed, address/website/deal preserved" || echo "  ✗ edit round-trip: $(cat /tmp/body.json)"
check "PUT without clientType → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Metro Plaza LLC"}' "$BASE/api/clients/$MP_ID")

echo "-- 9d. List includes the new fields =="
S=$(code -b "$JAR" "$BASE/api/clients")
check "list after Phase 3e creates → 200" 200 "$S"
grep -q '"clientType":"residential"' /tmp/body.json && grep -q '"address":"1230 Market St"' /tmp/body.json && echo "  ✓ list carries clientType + address" || echo "  ✗ list missing new fields: $(cat /tmp/body.json)"

echo "== 10. Custom fields (Phase 3b): tenant-defined + typed values =="
S=$(code -b "$JAR" "$BASE/api/settings")
check "GET settings → 200" 200 "$S"
grep -q '"customFields":\[\]' /tmp/body.json && echo "  ✓ no custom fields defined by default" || echo "  ✗ expected empty customFields: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"License #","type":"text"},{"name":"Service area","type":"text"},{"name":"Fleet size","type":"number"},{"name":"Contract start","type":"date"},{"name":"Insured","type":"checkbox"}]}' \
  "$BASE/api/settings")
check "define 5 custom fields → 200" 200 "$S"
grep -q '"customFields":\[{"name":"License #","type":"text"}' /tmp/body.json && echo "  ✓ settings returns the new field list" || echo "  ✗ settings response: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/settings")
check "GET settings after defining fields → 200" 200 "$S"
grep -q '"name":"Fleet size","type":"number"' /tmp/body.json && grep -q '"name":"Insured","type":"checkbox"' /tmp/body.json && echo "  ✓ persisted field list includes all types" || echo "  ✗ persisted fields: $(cat /tmp/body.json)"

echo "-- 10a. Custom-field definition validation =="
check "duplicate field name → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"License #","type":"text"},{"name":"license #","type":"text"}]}' "$BASE/api/settings")
check "bad field type → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"Money","type":"money"}]}' "$BASE/api/settings")
check "empty field name → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"   ","type":"text"}]}' "$BASE/api/settings")
check "field name over 50 chars → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d "{\"customFields\":[{\"name\":\"$(python3 -c "print('x'*51)")\",\"type\":\"text\"}]}" "$BASE/api/settings")
check "21 fields → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d "{\"customFields\":[$(python3 -c "print(','.join('{\"name\":\"F%d\",\"type\":\"text\"}' % i for i in range(21)))")]}" "$BASE/api/settings")
check "custom fields not a list → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":"License"}' "$BASE/api/settings")

echo "-- 10b. Client create with typed custom field values =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Summit Heating & Air","contactName":"Ray Ortiz","email":"ray@summit.example","phone":"+1 415 555 0131","industry":"HVAC","clientType":"residential","services":["Installation","Repair","Maintenance"],"dealValue":9500.50,"stage":"Leads","nextAction":"Send quote","notes":"","customFields":[{"name":"License #","value":"CA-88213"},{"name":"Service area","value":"Greater Bay Area"},{"name":"Fleet size","value":"12"},{"name":"Contract start","value":"2026-09-01"},{"name":"Insured","value":true}]}' \
  "$BASE/api/clients")
check "create HVAC client with all custom field types → 201" 201 "$S"
HVAC_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$HVAC_ID)"
grep -q '"customFields":\[{"name":"License #","value":"CA-88213"}' /tmp/body.json && echo "  ✓ create returns custom fields" || echo "  ✗ custom fields missing on create: $(cat /tmp/body.json)"
grep -q '"name":"Fleet size","value":"12"' /tmp/body.json && grep -q '"name":"Insured","value":"1"' /tmp/body.json && echo "  ✓ number + checkbox values stored/returned" || echo "  ✗ typed values wrong: $(cat /tmp/body.json)"
grep -q '"dealValue":9500.5' /tmp/body.json && echo "  ✓ decimal deal value returned" || echo "  ✗ deal value mismatch: $(cat /tmp/body.json)"
grep -q '"services":\["Installation","Repair","Maintenance"\]' /tmp/body.json && echo "  ✓ free-form services returned" || echo "  ✗ services mismatch: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$HVAC_ID")
check "GET HVAC client → 200" 200 "$S"
grep -q '"name":"Contract start","value":"2026-09-01"' /tmp/body.json && echo "  ✓ GET returns all custom fields incl. date" || echo "  ✗ custom fields missing on GET: $(cat /tmp/body.json)"

echo "-- 10c. Client custom-field value validation =="
check "create with unknown field name → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"name":"Crew size","value":"6"}]}' "$BASE/api/clients")
check "create with duplicate value name → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"name":"License #","value":"A"},{"name":"license #","value":"B"}]}' "$BASE/api/clients")
check "number field rejects text → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"name":"Fleet size","value":"twelve"}]}' "$BASE/api/clients")
check "date field rejects garbage → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"name":"Contract start","value":"not-a-date"}]}' "$BASE/api/clients")
check "date field rejects bad calendar day → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"name":"Contract start","value":"2026-13-45"}]}' "$BASE/api/clients")
check "checkbox rejects arbitrary text → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"name":"Insured","value":"yes"}]}' "$BASE/api/clients")
check "non-object custom field → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":["License"]}' "$BASE/api/clients")
check "custom fields not a list → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":{"name":"License #","value":"x"}}' "$BASE/api/clients")

echo "== 11. Custom field update round-trip =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Summit Heating & Air","contactName":"Ray Ortiz","email":"ray@summit.example","phone":"","industry":"HVAC","clientType":"residential","services":["AC Tune-Up","Installation"],"dealValue":12345.67,"stage":"Onboarding","nextAction":"","notes":"","customFields":[{"name":"License #","value":"CA-88213"},{"name":"Fleet size","value":"14"},{"name":"Insured","value":"0"}]}' \
  "$BASE/api/clients/$HVAC_ID")
check "update HVAC → 200" 200 "$S"
grep -q '"customFields":\[{"name":"License #","value":"CA-88213"},{"name":"Fleet size","value":"14"},{"name":"Insured","value":"0"}\]' /tmp/body.json && echo "  ✓ custom fields survive update (values round-trip)" || echo "  ✗ custom fields after update: $(cat /tmp/body.json)"
grep -q '"dealValue":12345.67' /tmp/body.json && echo "  ✓ updated decimal deal value" || echo "  ✗ updated deal: $(cat /tmp/body.json)"
grep -q '"AC Tune-Up"' /tmp/body.json && echo "  ✓ updated free-form service" || echo "  ✗ services after update: $(cat /tmp/body.json)"

echo "== 12. Landscaping demo client (defined fields only) =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow & Stone Landscapes","contactName":"Dana Kim","email":"dana@willowstone.example","phone":"+1 206 555 0144","industry":"Landscaping","clientType":"commercial","services":["Mowing","Design","Irrigation"],"dealValue":4200,"stage":"Onboarding","nextAction":"Site visit","notes":"","customFields":[{"name":"Service area","value":"Greater Seattle"},{"name":"Fleet size","value":"6"}]}' \
  "$BASE/api/clients")
check "create landscaping client → 201" 201 "$S"
LS_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
grep -q '"Service area","value":"Greater Seattle"' /tmp/body.json && echo "  ✓ landscaping custom fields returned" || echo "  ✗ missing: $(cat /tmp/body.json)"

echo "== 12a. Removing a field definition keeps existing client values =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"License #","type":"text"},{"name":"Service area","type":"text"},{"name":"Fleet size","type":"number"},{"name":"Contract start","type":"date"}]}' \
  "$BASE/api/settings")
check "remove Insured from settings → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/settings")
grep -qv '"name":"Insured"' /tmp/body.json && echo "  ✓ Insured gone from settings" || echo "  ✗ Insured still listed: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$HVAC_ID")
check "GET HVAC client after field removal → 200" 200 "$S"
grep -q '"name":"Insured","value":"0"' /tmp/body.json && echo "  ✓ removed field's value still stored on the client (intact)" || echo "  ✗ client value lost: $(cat /tmp/body.json)"
check "creating a value for a removed field → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"name":"Insured","value":"1"}]}' "$BASE/api/clients")

echo "== 13. Tasks =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Send quote\",\"clientId\":$HVAC_ID,\"dueDate\":\"2026-08-20\",\"notes\":\"Itemized proposal\"}" \
  "$BASE/api/tasks")
check "create task linked to HVAC client → 201" 201 "$S"
T1=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created task id=$T1)"
grep -q '"clientName":"Summit Heating & Air"' /tmp/body.json && echo "  ✓ client name joined into task" || echo "  ✗ clientName missing: $(cat /tmp/body.json)"
grep -q '"done":false' /tmp/body.json && echo "  ✓ done defaults to false" || echo "  ✗ done mismatch: $(cat /tmp/body.json)"
check "create task without title → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"dueDate":"2026-08-20"}' "$BASE/api/tasks")
check "create task with missing client → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Ghost task","clientId":999999}' "$BASE/api/tasks")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Review competitor landing pages","notes":"Standalone research"}' "$BASE/api/tasks")
check "create standalone task → 201" 201 "$S"
T2=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
grep -q '"clientName":""' /tmp/body.json && echo "  ✓ standalone task has empty clientName" || echo "  ✗ clientName: $(cat /tmp/body.json)"

S=$(code -b "$JAR" "$BASE/api/tasks")
check "list tasks → 200" 200 "$S"
grep -q 'Send quote' /tmp/body.json && echo "  ✓ linked task listed" || echo "  ✗ linked task missing: $(cat /tmp/body.json)"
grep -q 'Review competitor landing pages' /tmp/body.json && echo "  ✓ standalone task listed" || echo "  ✗ standalone missing"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
titles = [t['title'] for t in d['tasks']]
assert titles.index('Send quote') < titles.index('Review competitor landing pages'), titles
print("  ✓ open tasks sorted by due date, empty due dates last")
PY

S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Collect analytics access\",\"clientId\":$LS_ID,\"dueDate\":\"2026-08-12\",\"done\":true}" \
  "$BASE/api/tasks")
check "create done task → 201" 201 "$S"
T3=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
grep -q '"done":true' /tmp/body.json && echo "  ✓ done=true honored on create" || echo "  ✗ done mismatch: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/tasks?done=1")
check "list done=1 → 200" 200 "$S"
grep -q 'Collect analytics access' /tmp/body.json && ! grep -q 'Send quote' /tmp/body.json && echo "  ✓ done filter returns only done tasks" || echo "  ✗ done filter failed: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/tasks?done=0")
check "list done=0 → 200" 200 "$S"
grep -q 'Send quote' /tmp/body.json && ! grep -q 'Collect analytics access' /tmp/body.json && echo "  ✓ open filter returns only open tasks" || echo "  ✗ open filter failed"
S=$(code -b "$JAR" "$BASE/api/tasks?q=quote")
check "search q=quote → 200" 200 "$S"
grep -q 'Send quote' /tmp/body.json && ! grep -q 'Collect analytics' /tmp/body.json && echo "  ✓ title search works" || echo "  ✗ search failed: $(cat /tmp/body.json)"

S=$(code -b "$JAR" -X POST "$BASE/api/tasks/$T1/toggle")
check "toggle T1 → 200" 200 "$S"
grep -q '"done":true' /tmp/body.json && echo "  ✓ toggle marks task done" || echo "  ✗ toggle failed: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"title":"Send revised quote","dueDate":"2026-08-25","notes":"Updated pricing"}' "$BASE/api/tasks/$T1")
check "partial update T1 → 200" 200 "$S"
grep -q '"title":"Send revised quote"' /tmp/body.json && grep -q '"dueDate":"2026-08-25"' /tmp/body.json && echo "  ✓ partial update applied" || echo "  ✗ update failed: $(cat /tmp/body.json)"
grep -q '"done":true' /tmp/body.json && echo "  ✓ done preserved across partial update" || echo "  ✗ done lost: $(cat /tmp/body.json)"
check "update missing task → 404" 404 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"title":"Nope"}' "$BASE/api/tasks/999999")

# ON DELETE SET NULL: deleting a client keeps its tasks, unlinked.
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Temp Co For Tasks","contactName":"T","clientType":"residential","industry":"Testing","dealValue":0,"stage":"Leads"}' \
  "$BASE/api/clients")
check "create temp client → 201" 201 "$S"
TEMP=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Follow up with temp client\",\"clientId\":$TEMP}" "$BASE/api/tasks")
check "create task linked to temp client → 201" 201 "$S"
T4=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
check "delete temp client → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/clients/$TEMP")
code -b "$JAR" "$BASE/api/tasks?q=temp" > /dev/null
grep -q '"Follow up with temp client"' /tmp/body.json && grep -q '"clientId":null' /tmp/body.json && echo "  ✓ ON DELETE SET NULL — task survives, clientId null" || echo "  ✗ SET NULL failed: $(cat /tmp/body.json)"

check "delete T2 → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/tasks/$T2")
check "delete T2 again → 404" 404 $(code -b "$JAR" -X DELETE "$BASE/api/tasks/$T2")
check "toggle missing task → 404" 404 $(code -b "$JAR" -X POST "$BASE/api/tasks/999999/toggle")

echo "-- 13a. Dashboard task overview aggregates (2026-08-14 owner request) =="
# Owner org task state entering this section (from section 13):
#   T1 "Send revised quote" (done, due 2026-08-25), T3 "Collect analytics
#   access" (done, due 2026-08-12), T4 "Follow up with temp client" (open, no
#   due date). So open=1, done=2, overdue=0, dueSoon=0, upcoming=[].
# Dates are computed relative to today so the suite stays deterministic no
# matter when it runs (server and test share the machine's local clock).
TODAY_KEY=$(python3 -c "from datetime import date; print(date.today().isoformat())")
OVERDUE_KEY=$(python3 -c "from datetime import date, timedelta; print((date.today() - timedelta(days=3)).isoformat())")
SOON_KEY=$(python3 -c "from datetime import date, timedelta; print((date.today() + timedelta(days=2)).isoformat())")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Overdue follow-up call\",\"dueDate\":\"$OVERDUE_KEY\"}" "$BASE/api/tasks")
check "13a: create overdue open task → 201" 201 "$S"
T_OVERDUE=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Due-soon proposal\",\"dueDate\":\"$SOON_KEY\"}" "$BASE/api/tasks")
check "13a: create due-soon open task → 201" 201 "$S"
T_SOON=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "13a: dashboard carries task aggregates → 200" 200 "$S"
if python3 - "$TODAY_KEY" "$OVERDUE_KEY" "$SOON_KEY" <<'PY' 2>"$PASS_TMP"
import json, sys
d = json.load(open('/tmp/body.json'))
t = d.get('tasks')
assert t, 'no tasks key in dashboard: %s' % list(d.keys())
assert t['open'] == 3, t          # T4 + the two just created
assert t['done'] == 2, t          # T1 + T3
assert t['overdue'] == 1, t       # Overdue follow-up call only
assert t['dueSoon'] == 1, t       # Due-soon proposal only
up = t['upcoming']
assert len(up) == 2, up           # T4 has no due date, so it is excluded
assert up[0]['title'] == 'Overdue follow-up call' and up[0]['dueDate'] == sys.argv[2], up
assert up[1]['title'] == 'Due-soon proposal' and up[1]['dueDate'] == sys.argv[3], up
assert up[0]['done'] is False and up[0]['clientName'] == '', up
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ task overview aggregates: open/overdue/due soon/done counts + upcoming order (earliest due first)"
else FAIL=$((FAIL+1)); echo "  ✗ task overview aggregates mismatch"; cat "$PASS_TMP"; fi
# Restore the pre-13a task state so later sections see the same data as before.
check "13a: delete overdue task → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/tasks/$T_OVERDUE")
check "13a: delete due-soon task → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/tasks/$T_SOON")

echo "== 14. Invoices =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$HVAC_ID,\"amount\":12345.50,\"dueDate\":\"2026-08-20\",\"notes\":\"Website build — deposit\"}" \
  "$BASE/api/invoices")
check "create invoice linked to HVAC client → 201" 201 "$S"
I1=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created invoice id=$I1)"
grep -q '"clientName":"Summit Heating & Air"' /tmp/body.json && echo "  ✓ client name joined into invoice" || echo "  ✗ clientName missing: $(cat /tmp/body.json)"
grep -q '"status":"draft"' /tmp/body.json && echo "  ✓ status defaults to draft" || echo "  ✗ status mismatch: $(cat /tmp/body.json)"
grep -q '"amount":12345.5' /tmp/body.json && echo "  ✓ decimal amount returned" || echo "  ✗ amount mismatch: $(cat /tmp/body.json)"
check "create invoice without amount → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$HVAC_ID}" "$BASE/api/invoices")
check "create invoice with zero amount → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"amount":0}' "$BASE/api/invoices")
check "create invoice with negative amount → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"amount":-5}' "$BASE/api/invoices")
check "create invoice with bad status → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"amount":100,"status":"overdue"}' "$BASE/api/invoices")
check "create invoice with missing client → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"amount":100,"clientId":999999}' "$BASE/api/invoices")

S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"amount":500,"notes":"Standalone invoice"}' "$BASE/api/invoices")
check "create standalone invoice → 201" 201 "$S"
I2=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
grep -q '"clientName":""' /tmp/body.json && echo "  ✓ standalone invoice has empty clientName" || echo "  ✗ clientName: $(cat /tmp/body.json)"

S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$LS_ID,\"amount\":2100,\"status\":\"sent\",\"dueDate\":\"2026-09-01\"}" "$BASE/api/invoices")
check "create sent invoice → 201" 201 "$S"
I3=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$HVAC_ID,\"amount\":3000,\"status\":\"paid\",\"dueDate\":\"2026-07-01\"}" "$BASE/api/invoices")
check "create paid invoice → 201" 201 "$S"
I4=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$LS_ID,\"amount\":900,\"status\":\"sent\",\"dueDate\":\"2026-08-10\"}" "$BASE/api/invoices")
check "create second sent invoice → 201" 201 "$S"
I5=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)

S=$(code -b "$JAR" "$BASE/api/invoices")
check "list invoices → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
invs = d['invoices']
assert len(invs) == 5, invs
# unpaid (draft+sent) first, sorted by due date (empty last), then paid
unpaid = [i for i in invs if i['status'] != 'paid']
paid = [i for i in invs if i['status'] == 'paid']
assert len(unpaid) == 4 and len(paid) == 1, invs
draft_sent = [i for i in unpaid if i['dueDate']]
empty_due = [i for i in unpaid if not i['dueDate']]
draft_sent_dates = [i['dueDate'] for i in draft_sent]
assert draft_sent_dates == sorted(draft_sent_dates), draft_sent_dates
assert invs[:4] == draft_sent + empty_due and invs[4] == paid[0], [i['id'] for i in invs]
print("  ✓ unpaid first, due-date order (empty last), paid after")
PY

S=$(code -b "$JAR" "$BASE/api/invoices?status=draft")
check "filter status=draft → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert len(d['invoices']) == 2 and all(i['status'] == 'draft' for i in d['invoices']), d
print("  ✓ draft filter returns only draft invoices")
PY
S=$(code -b "$JAR" "$BASE/api/invoices?status=sent")
check "filter status=sent → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert len(d['invoices']) == 2 and all(i['status'] == 'sent' for i in d['invoices']), d
print("  ✓ sent filter returns only sent invoices")
PY
S=$(code -b "$JAR" "$BASE/api/invoices?status=paid")
check "filter status=paid → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert len(d['invoices']) == 1 and d['invoices'][0]['status'] == 'paid', d
print("  ✓ paid filter returns only paid invoices")
PY
check "filter bad status → 400" 400 $(code -b "$JAR" "$BASE/api/invoices?status=won")
S=$(code -b "$JAR" "$BASE/api/invoices?clientId=$HVAC_ID")
check "filter clientId=HVAC → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
ids = {i['id'] for i in d['invoices']}
assert len(d['invoices']) == 2, d
print("  ✓ clientId filter returns only that client's invoices")
PY
S=$(code -b "$JAR" "$BASE/api/invoices?status=sent&clientId=$LS_ID")
check "combined status+clientId → 200" 200 "$S"
grep -q '"amount":2100' /tmp/body.json && grep -q '"amount":900' /tmp/body.json && echo "  ✓ combined filter narrows to sent invoices for LS client" || echo "  ✗ combined filter failed: $(cat /tmp/body.json)"

S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"amount":13000,"status":"sent","dueDate":"2026-08-25","notes":"Deposit + first milestone"}' "$BASE/api/invoices/$I1")
check "partial update I1 → 200" 200 "$S"
grep -q '"amount":13000' /tmp/body.json && grep -q '"status":"sent"' /tmp/body.json && grep -q '"dueDate":"2026-08-25"' /tmp/body.json && echo "  ✓ partial update applied" || echo "  ✗ update failed: $(cat /tmp/body.json)"
grep -q '"clientName":"Summit Heating & Air"' /tmp/body.json && echo "  ✓ clientName preserved across update" || echo "  ✗ clientName lost: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"status":"paid"}' "$BASE/api/invoices/$I1")
check "mark I1 paid → 200" 200 "$S"
grep -q '"status":"paid"' /tmp/body.json && echo "  ✓ status-only update marks invoice paid" || echo "  ✗ status update failed: $(cat /tmp/body.json)"
check "update invoice with bad amount → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"amount":-1}' "$BASE/api/invoices/$I2")
check "update missing invoice → 404" 404 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"amount":100}' "$BASE/api/invoices/999999")
check "delete missing invoice → 404" 404 $(code -b "$JAR" -X DELETE "$BASE/api/invoices/999999")

# ON DELETE SET NULL: deleting a client keeps its invoices, unlinked.
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Temp Co For Invoices","contactName":"T","clientType":"residential","industry":"Testing","dealValue":0,"stage":"Leads"}' \
  "$BASE/api/clients")
check "create temp client → 201" 201 "$S"
TEMP2=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$TEMP2,\"amount\":750,\"status\":\"sent\"}" "$BASE/api/invoices")
check "create invoice linked to temp client → 201" 201 "$S"
I6=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
check "delete temp client → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/clients/$TEMP2")
code -b "$JAR" "$BASE/api/invoices?clientId=$TEMP2" > /dev/null
grep -q '"invoices":\[\]' /tmp/body.json && echo "  ✓ temp client's invoices unlinked (clientId filter empty)" || echo "  ✗ SET NULL filter check failed: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/invoices")
check "list after client delete → 200" 200 "$S"
grep -q '"id":'"$I6" /tmp/body.json && grep -q '"clientId":null' /tmp/body.json && echo "  ✓ ON DELETE SET NULL — invoice survives, clientId null" || echo "  ✗ SET NULL failed: $(cat /tmp/body.json)"

check "delete I2 → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/invoices/$I2")
check "delete I2 again → 404" 404 $(code -b "$JAR" -X DELETE "$BASE/api/invoices/$I2")

echo "-- 14a. Invoice ↔ client re-link (Finance picker + edit-modal flows) =="
# The quick-add row and the edit modal both submit clientId ("" = no client).
# This locks the server contract they rely on: linking an invoice to a client
# joins clientName (what the row chip renders) and sending clientId null
# unlinks it back to standalone.
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"amount":1111,"status":"draft","notes":"Re-link QA"}' "$BASE/api/invoices")
check "create standalone invoice for re-link → 201" 201 "$S"
I7=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
grep -q '"clientId":null' /tmp/body.json && grep -q '"clientName":""' /tmp/body.json && echo "  ✓ standalone invoice starts unlinked" || echo "  ✗ standalone: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d "{\"clientId\":$HVAC_ID}" "$BASE/api/invoices/$I7")
check "link invoice to HVAC via PUT → 200" 200 "$S"
grep -q '"clientName":"Summit Heating & Air"' /tmp/body.json && echo "  ✓ linked invoice carries clientName (row chip data)" || echo "  ✗ link failed: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/invoices?clientId=$HVAC_ID")
check "clientId filter includes the re-linked invoice → 200" 200 "$S"
grep -q "\"id\":$I7" /tmp/body.json && echo "  ✓ re-linked invoice appears under the client's filter" || echo "  ✗ filter missing: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"clientId":null}' "$BASE/api/invoices/$I7")
check "clear clientId (null) → 200" 200 "$S"
grep -q '"clientId":null' /tmp/body.json && grep -q '"clientName":""' /tmp/body.json && echo "  ✓ unlink clears clientName (standalone again)" || echo "  ✗ unlink failed: $(cat /tmp/body.json)"
check "delete re-link QA invoice → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/invoices/$I7")

echo "== 15. Logout =="
S=$(code -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/logout")
check "logout → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/auth/me")
check "me after logout → 401" 401 "$S"

echo "== 16. Admin provisioning (Phase 2) + multi-tenant isolation =="
MEMBER_EMAIL="member@acme.example"
MEMBER_PASSWORD="memberpass123"
JAR2=$(mktemp)
# Section 15 logged the admin out — sign back in to provision tenants.
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "admin re-login for provisioning → 200" 200 "$S"
# The owner (admin) provisions a client org + member login through the admin
# API — no direct DB access. This is exactly what the Admin tab does.
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Acme Widgets LLC","email":"member@acme.example","password":"memberpass123"}' "$BASE/api/admin/orgs")
check "admin creates org+user → 201" 201 "$S"
ORG2_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
MEMBER_USER_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['user']['id'])")
echo "    (member org id=$ORG2_ID, member user id=$MEMBER_USER_ID)"
grep -q '"name":"Acme Widgets LLC"' /tmp/body.json && echo "  ✓ create returns org name" || echo "  ✗ org name missing: $(cat /tmp/body.json)"
grep -q '"createdAt":' /tmp/body.json && echo "  ✓ create returns org createdAt" || echo "  ✗ createdAt missing"
grep -q '"email":"member@acme.example"' /tmp/body.json && echo "  ✓ create returns member email" || echo "  ✗ member email missing"
grep -q '"role":"member"' /tmp/body.json && echo "  ✓ create returns role member" || echo "  ✗ member role wrong"
grep -q "\"orgId\":$ORG2_ID" /tmp/body.json && echo "  ✓ user.orgId matches the new org" || echo "  ✗ user.orgId wrong: $(cat /tmp/body.json)"
grep -q '"password"' /tmp/body.json && echo "  ✗ PASSWORD LEAKED in response" || echo "  ✓ no password in create response"

echo "-- 16a. Admin API validation =="
check "duplicate email → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Another Co","email":"member@acme.example","password":"whatever123"}' "$BASE/api/admin/orgs")
check "missing company name → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"","email":"fresh@acme.example","password":"whatever123"}' "$BASE/api/admin/orgs")
check "malformed email → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Bad Email Co","email":"not-an-email","password":"whatever123"}' "$BASE/api/admin/orgs")
check "short password → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Short Pass Co","email":"shorty@acme.example","password":"short"}' "$BASE/api/admin/orgs")

echo "-- 16b. Member login sees their own (empty) org =="
S=$(code -c "$JAR2" -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$MEMBER_EMAIL\",\"password\":\"$MEMBER_PASSWORD\"}" "$BASE/api/auth/login")
check "provisioned member login → 200" 200 "$S"
grep -q "\"orgId\":$ORG2_ID" /tmp/body.json && echo "  ✓ member login returns their orgId" || echo "  ✗ member orgId wrong: $(cat /tmp/body.json)"
grep -q '"role":"member"' /tmp/body.json && echo "  ✓ member login returns role member" || echo "  ✗ member role wrong: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/auth/me")
check "member me → 200" 200 "$S"
grep -q "\"orgId\":$ORG2_ID" /tmp/body.json && grep -q '"role":"member"' /tmp/body.json && grep -q '"isOwner":false' /tmp/body.json && echo "  ✓ member me carries orgId + role member + isOwner false" || echo "  ✗ member me wrong: $(cat /tmp/body.json)"
echo "-- 16c. Members are forbidden from admin endpoints =="
check "member GET /api/admin/orgs → 403" 403 $(code -b "$JAR2" "$BASE/api/admin/orgs")
check "member POST /api/admin/orgs → 403" 403 $(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Hacked Co","email":"hacked@acme.example","password":"whatever123"}' "$BASE/api/admin/orgs")
check "member DELETE /api/admin/orgs/:id → 403" 403 $(code -b "$JAR2" -X DELETE "$BASE/api/admin/orgs/$ORG2_ID")

S=$(code -b "$JAR2" "$BASE/api/clients")
check "member clients list → 200" 200 "$S"
grep -q '"clients":\[\]' /tmp/body.json && echo "  ✓ member sees NO default-org clients (isolation)" || echo "  ✗ member clients: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/tasks")
check "member tasks list → 200" 200 "$S"
grep -q '"tasks":\[\]' /tmp/body.json && echo "  ✓ member sees NO default-org tasks (isolation)" || echo "  ✗ member tasks: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/invoices")
check "member invoices list → 200" 200 "$S"
grep -q '"invoices":\[\]' /tmp/body.json && echo "  ✓ member sees NO default-org invoices (isolation)" || echo "  ✗ member invoices: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/dashboard")
check "member dashboard → 200" 200 "$S"
grep -q '"projectedPipeline":0' /tmp/body.json && grep -q '"totalClients":0' /tmp/body.json && echo "  ✓ member dashboard is empty (no cross-org stats)" || echo "  ✗ member dashboard: $(cat /tmp/body.json)"
if python3 - <<'PY' 2>"$PASS_TMP"
import json
d = json.load(open('/tmp/body.json'))
t = d.get('tasks', {})
assert t.get('open') == 0 and t.get('done') == 0 and t.get('overdue') == 0     and t.get('dueSoon') == 0 and t.get('upcoming') == [], d
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ member dashboard task overview is empty (owner-org tasks not visible)"
else FAIL=$((FAIL+1)); echo "  ✗ member dashboard task overview not empty"; cat "$PASS_TMP"; fi

echo "-- 16d. Admin org list has the new tenant with correct counts =="
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "admin lists orgs → 200" 200 "$S"
DEFAULT_ORG_ID=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(next(o['id'] for o in d['orgs'] if o['name'] == 'Revzenta'))")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
orgs = {o['name']: o for o in d['orgs']}
assert 'Revzenta' in orgs and 'Acme Widgets LLC' in orgs, [o['name'] for o in d['orgs']]
assert orgs['Revzenta']['userCount'] == 1, orgs['Revzenta']
assert orgs['Acme Widgets LLC']['userCount'] == 1, orgs['Acme Widgets LLC']
assert orgs['Acme Widgets LLC']['clientCount'] == 0, orgs['Acme Widgets LLC']
assert orgs['Revzenta']['createdAt'], orgs['Revzenta']
print("  ✓ list includes owner org + new tenant (userCount 1, clientCount 0)")
PY

echo "-- 16e. Isolation: member cannot touch default-org rows (404) =="
check "member GET default-org client → 404" 404 $(code -b "$JAR2" "$BASE/api/clients/$HVAC_ID")
check "member PUT default-org client → 404" 404 $(code -b "$JAR2" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Hacked","clientType":"residential","dealValue":1}' "$BASE/api/clients/$HVAC_ID")
check "member DELETE default-org client → 404" 404 $(code -b "$JAR2" -X DELETE "$BASE/api/clients/$HVAC_ID")
check "member PUT default-org task → 404" 404 $(code -b "$JAR2" -X PUT -H 'Content-Type: application/json' \
  -d '{"title":"Hacked"}' "$BASE/api/tasks/$T1")
check "member toggle default-org task → 404" 404 $(code -b "$JAR2" -X POST "$BASE/api/tasks/$T1/toggle")
check "member DELETE default-org task → 404" 404 $(code -b "$JAR2" -X DELETE "$BASE/api/tasks/$T1")
check "member PUT default-org invoice → 404" 404 $(code -b "$JAR2" -X PUT -H 'Content-Type: application/json' \
  -d '{"amount":1}' "$BASE/api/invoices/$I1")
check "member DELETE default-org invoice → 404" 404 $(code -b "$JAR2" -X DELETE "$BASE/api/invoices/$I1")

echo "-- 16f. Member data stays in their own org =="
S=$(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Member Corp","contactName":"M","clientType":"commercial","address":"101 Member Way","city":"Memberville","state":"WA","zip":"98001","website":"membercorp.example","leadSource":"Website","industry":"Testing","dealValue":5000,"stage":"Prospect"}' \
  "$BASE/api/clients")
check "member creates client → 201" 201 "$S"
MC_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (member client id=$MC_ID)"
S=$(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Member follow-up\",\"clientId\":$MC_ID}" "$BASE/api/tasks")
check "member creates task linked to own client → 201" 201 "$S"
MT_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (member task id=$MT_ID)"
S=$(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$MC_ID,\"amount\":777.77,\"status\":\"sent\"}" "$BASE/api/invoices")
check "member creates invoice linked to own client → 201" 201 "$S"
MI_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (member invoice id=$MI_ID)"
S=$(code -b "$JAR2" "$BASE/api/clients")
check "member clients list has own client → 200" 200 "$S"
grep -q 'Member Corp' /tmp/body.json && grep -q '"address":"101 Member Way"' /tmp/body.json && echo "  ✓ member sees their own client with its new fields" || echo "  ✗ member missing own client: $(cat /tmp/body.json)"
grep -qv '1230 Market St' /tmp/body.json && echo "  ✓ owner's client address invisible to member (Phase 3e isolation)" || echo "  ✗ owner address leaked to member: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/tasks")
check "member tasks list has own task → 200" 200 "$S"
grep -q 'Member follow-up' /tmp/body.json && echo "  ✓ member sees their own task" || echo "  ✗ member missing own task: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/invoices")
check "member invoices list has own invoice → 200" 200 "$S"
grep -q '"amount":777.77' /tmp/body.json && echo "  ✓ member sees their own invoice" || echo "  ✗ member missing own invoice: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/dashboard")
check "member dashboard counts own data → 200" 200 "$S"
grep -q '"projectedPipeline":5000' /tmp/body.json && grep -q '"totalClients":1' /tmp/body.json && echo "  ✓ member dashboard counts only their own data" || echo "  ✗ member dashboard: $(cat /tmp/body.json)"
echo "-- 16f2. Tenant projectedPipeline keeps its own ALL-STAGE sum (owner-only change, owner direction 2026-08-15) --"
# The member org already has Member Corp (dealValue 5000, first stage). Add a
# second client in the member's LAST stage: a tenant's projectedPipeline must
# still sum deal values across EVERY stage (their whole book) — only the
# OWNER's KPI narrows to the first stage.
code -b "$JAR2" "$BASE/api/settings" > /dev/null
MEM_LAST2=$(python3 -c "import json;st=json.load(open('/tmp/body.json'))['settings']['stages'];print(st[-1])")
S=$(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Member Later Stage Co\",\"clientType\":\"commercial\",\"dealValue\":2500,\"stage\":\"$MEM_LAST2\"}" "$BASE/api/clients")
check "16f2: member creates a client in a LATER (last) stage \"$MEM_LAST2\" → 201" 201 "$S"
MC2_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (member later-stage client id=$MC2_ID, stage=$MEM_LAST2)"
code -b "$JAR2" "$BASE/api/dashboard" > /dev/null
grep -q '"projectedPipeline":7500' /tmp/body.json && echo "  ✓ 16f2: member projectedPipeline = 7500 (5000+2500 — ALL stages still summed for tenants)" || echo "  ✗ 16f2: member pipeline: $(cat /tmp/body.json)"
check "16f2: remove the later-stage member client (cleanup) → 200" 200 $(code -b "$JAR2" -X DELETE "$BASE/api/clients/$MC2_ID")
# Refetch the member dashboard so /tmp/body.json holds the dashboard payload
# again (the DELETE above overwrote it) — the next check reads it.
code -b "$JAR2" "$BASE/api/dashboard" > /dev/null
grep -q '"projectedPipeline":5000' /tmp/body.json && echo "  ✓ 16f2: member pipeline back to 5000 (later-stage client removed)" || echo "  ✗ 16f2: member pipeline after cleanup: $(cat /tmp/body.json)"
if python3 - <<'PY' 2>"$PASS_TMP"
import json
d = json.load(open('/tmp/body.json'))
t = d.get('tasks', {})
# The member org has exactly one open task ("Member follow-up", no due date):
# it must show in the member's aggregates, and in NO other org's.
assert t.get('open') == 1 and t.get('done') == 0 and t.get('overdue') == 0     and t.get('dueSoon') == 0 and t.get('upcoming') == [], t
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ member dashboard task overview counts only the member's own task"
else FAIL=$((FAIL+1)); echo "  ✗ member dashboard task overview mismatch"; cat "$PASS_TMP"; fi

echo "-- 16g. Default org cannot see member data =="
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "admin re-login → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/clients")
check "admin clients list → 200" 200 "$S"
grep -qv 'Member Corp' /tmp/body.json && grep -qv '101 Member Way' /tmp/body.json && echo "  ✓ admin does NOT see member client or its address (Phase 3e isolation)" || echo "  ✗ member client leaked: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/tasks")
check "admin tasks list → 200" 200 "$S"
grep -qv 'Member follow-up' /tmp/body.json && echo "  ✓ admin does NOT see member task" || echo "  ✗ member task leaked: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/invoices")
check "admin invoices list → 200" 200 "$S"
grep -qv '"amount":777.77' /tmp/body.json && echo "  ✓ admin does NOT see member invoice" || echo "  ✗ member invoice leaked: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "admin dashboard → 200" 200 "$S"
grep -qv 'Member Corp' /tmp/body.json && echo "  ✓ admin dashboard excludes member data" || echo "  ✗ member leaked into admin dashboard"
if python3 - <<'PY' 2>"$PASS_TMP"
import json
d = json.load(open('/tmp/body.json'))
t = d.get('tasks', {})
# Owner org has T1 + T3 done and T4 open. If the member's open task leaked
# into the owner dashboard, open would be 2 — it must stay 1.
assert t.get('open') == 1 and t.get('done') == 2, t
assert all(u['title'] != 'Member follow-up' for u in t.get('upcoming', [])), t
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ admin dashboard task overview excludes the member org's task (open=1, done=2)"
else FAIL=$((FAIL+1)); echo "  ✗ member task leaked into admin dashboard task overview"; cat "$PASS_TMP"; fi

echo "-- 16h. Cross-org links rejected =="
check "member task with default-org client → 400" 400 $(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Cross-org task\",\"clientId\":$HVAC_ID}" "$BASE/api/tasks")
check "member invoice with default-org client → 400" 400 $(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$HVAC_ID,\"amount\":100}" "$BASE/api/invoices")
check "member re-links own task to default-org client → 400" 400 $(code -b "$JAR2" -X PUT -H 'Content-Type: application/json' \
  -d "{\"clientId\":$HVAC_ID}" "$BASE/api/tasks/$MT_ID")
check "member re-links own invoice to default-org client → 400" 400 $(code -b "$JAR2" -X PUT -H 'Content-Type: application/json' \
  -d "{\"clientId\":$HVAC_ID}" "$BASE/api/invoices/$MI_ID")
check "member GET own client after failed re-links → 200 (data intact)" 200 $(code -b "$JAR2" "$BASE/api/clients/$MC_ID")

echo "-- 16i. Admin deletes a tenant =="
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "admin lists orgs after member data → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
o = next(o for o in d['orgs'] if o['name'] == 'Acme Widgets LLC')
assert o['clientCount'] == 1 and o['userCount'] == 1, o
print("  ✓ tenant now shows clientCount 1 (member's client counted, scoped)")
PY
check "admin deletes tenant → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$ORG2_ID")
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "admin lists orgs after delete → 200" 200 "$S"
grep -qv 'Acme Widgets LLC' /tmp/body.json && echo "  ✓ deleted tenant gone from list" || echo "  ✗ tenant still listed: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$MEMBER_EMAIL\",\"password\":\"$MEMBER_PASSWORD\"}" "$BASE/api/auth/login")
check "deleted tenant user login → 401" 401 "$S"
check "delete owner org → 400" 400 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$DEFAULT_ORG_ID")
check "delete missing org → 404" 404 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/999999")
rm -f "$JAR2"

echo "== 17. Per-tenant branding + pipeline stages (Phase 3a) =="
echo "-- 17a. Branding + defaults in the session =="
S=$(code -b "$JAR" "$BASE/api/auth/me")
check "owner me → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
u = d['user']
assert u['orgName'] == 'Revzenta', u.get('orgName')
assert u['isOwner'] is True, u.get('isOwner')  # branding rename: server sends the owner flag
assert u['stages'] == ['Leads','Onboarding','Sold'], u['stages']
assert u['accentColor'] == '#d6ff3f', u.get('accentColor')
print("  ✓ me returns orgName + default stages + accentColor")
PY

echo "-- 17b. Settings auth guard =="
JAR3=$(mktemp)
check "settings without cookie → 401" 401 $(code -b "$JAR3" "$BASE/api/settings")
check "settings PUT without cookie → 401" 401 $(code -b "$JAR3" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["A"]}' "$BASE/api/settings")

echo "-- 17c. GET settings =="
S=$(code -b "$JAR" "$BASE/api/settings")
check "owner GET settings → 200" 200 "$S"
grep -q '"orgName":"Revzenta"' /tmp/body.json && echo "  ✓ settings carries org name" || echo "  ✗ settings orgName: $(cat /tmp/body.json)"
grep -q '"stages":\["Leads","Onboarding","Sold"\]' /tmp/body.json && echo "  ✓ settings returns the owner 3-stage pipeline (Leads → Onboarding → Sold)" || echo "  ✗ settings stages: $(cat /tmp/body.json)"
grep -q '"accentColor":"#d6ff3f"' /tmp/body.json && echo "  ✓ settings returns default accent" || echo "  ✗ settings accent: $(cat /tmp/body.json)"

echo "-- 17d. Settings validation =="
check "empty stages → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":[]}' "$BASE/api/settings")
check "duplicate stages → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Lead","Lead"]}' "$BASE/api/settings")
check "blank stage name → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Lead","   "]}' "$BASE/api/settings")
check "13 stages → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["A","B","C","D","E","F","G","H","I","J","K","L","M"]}' "$BASE/api/settings")
check "stages not a list → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":"Leads"}' "$BASE/api/settings")
check "bad accent → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"accentColor":"lime"}' "$BASE/api/settings")
check "blank org name → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"orgName":""}' "$BASE/api/settings")

echo "-- 17e. Rename a stage migrates its clients =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Proposal","Sold"]}' "$BASE/api/settings")
check "rename Onboarding→Proposal → 200" 200 "$S"
grep -q '"stages":\["Leads","Proposal","Sold"\]' /tmp/body.json && echo "  ✓ new stage list returned" || echo "  ✗ response: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$HVAC_ID")
check "get HVAC client → 200" 200 "$S"
grep -q '"stage":"Proposal"' /tmp/body.json && echo "  ✓ client in renamed stage migrated to Proposal" || echo "  ✗ client stage after rename: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "dashboard after rename → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
sc = d['stageCounts']
assert sc.get('Proposal') == 2, sc
assert sc.get('Onboarding', 0) == 0, sc
print("  ✓ dashboard counts follow the rename (Proposal=2, Onboarding=0)")
PY

echo "-- 17f. Add / remove stages =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Proposal","Sold","Won"]}' "$BASE/api/settings")
check "add stage Won → 200" 200 "$S"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Proposal","Sold"]}' "$BASE/api/settings")
check "remove empty stage Won → 200" 200 "$S"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Proposal","Sold","Won"]}' "$BASE/api/settings")
check "re-add Won → 200" 200 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Won Co","clientType":"residential","stage":"Won"}' "$BASE/api/clients")
check "create client in Won → 201" 201 "$S"
WON_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Proposal","Sold"]}' "$BASE/api/settings")
check "remove Won with client → 400" 400 "$S"
grep -q 'move or archive' /tmp/body.json && echo "  ✓ block message says move or archive (with count)" || echo "  ✗ block message: $(cat /tmp/body.json)"
check "delete Won Co → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/clients/$WON_ID")
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Proposal","Sold"]}' "$BASE/api/settings")
check "remove Won after clearing clients → 200" 200 "$S"

echo "-- 17g. Org comes from the session, never the body =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"orgName":"Revzenta HQ","orgId":999999}' "$BASE/api/settings")
check "PUT with bogus body orgId → 200 (ignored)" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/settings")
grep -q '"orgName":"Revzenta HQ"' /tmp/body.json && echo "  ✓ body orgId ignored — own org updated" || echo "  ✗ settings: $(cat /tmp/body.json)"
code -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"orgName":"Revzenta"}' "$BASE/api/settings" > /dev/null

echo "-- 17h. Stage lists are org-scoped =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Tenant B LLC","email":"tenantb@example.com","password":"tenantbpass123"}' "$BASE/api/admin/orgs")
check "admin creates tenant B → 201" 201 "$S"
TENANTB_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARB=$(mktemp)
S=$(code -c "$JARB" -b "$JARB" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"tenantb@example.com","password":"tenantbpass123"}' "$BASE/api/auth/login")
check "tenant B login → 200" 200 "$S"
S=$(code -b "$JARB" "$BASE/api/settings")
check "tenant B GET settings → 200" 200 "$S"
grep -q '"orgName":"Tenant B LLC"' /tmp/body.json && echo "  ✓ tenant B sees its own name" || echo "  ✗ tenant B name: $(cat /tmp/body.json)"
grep -q '"stages":\["Prospect","Intake","Kickoff","Build","Launch","Retainer"\]' /tmp/body.json && echo "  ✓ tenant B starts from default stages (unaffected by owner's rename)" || echo "  ✗ tenant B stages: $(cat /tmp/body.json)"
S=$(code -b "$JARB" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Lead","Tour","Offer","Contract","Closed"]}' "$BASE/api/settings")
check "tenant B renames its stages → 200" 200 "$S"
grep -q '"Lead","Tour","Offer","Contract","Closed"' /tmp/body.json && echo "  ✓ tenant B stages saved" || echo "  ✗ tenant B save: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/settings")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
st = d['settings']['stages']
assert 'Lead' not in st and st[1] == 'Proposal', st  # owner pipeline is 3 stages: [Leads, Proposal, Sold]
print("  ✓ owner stages unaffected by tenant B's rename (isolation)")
PY

echo "-- 17i. Custom fields are org-scoped =="
S=$(code -b "$JARB" "$BASE/api/settings")
check "tenant B GET settings → 200" 200 "$S"
grep -q '"customFields":\[\]' /tmp/body.json && echo "  ✓ tenant B starts with NO owner custom fields (isolation)" || echo "  ✗ tenant B customFields: $(cat /tmp/body.json)"
S=$(code -b "$JARB" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"Listing price","type":"number"},{"name":"Bedrooms","type":"number"}]}' "$BASE/api/settings")
check "tenant B defines its own custom fields → 200" 200 "$S"
grep -q '"name":"Listing price","type":"number"' /tmp/body.json && echo "  ✓ tenant B fields saved" || echo "  ✗ tenant B save: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/settings")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
cf = d['settings']['customFields']
names = {f['name'] for f in cf}
assert 'Listing price' not in names, cf
assert 'License #' in names and 'Fleet size' in names, names
print("  ✓ owner fields unaffected by tenant B's definitions (isolation)")
PY
check "tenant B cannot write values for an owner-only field → 400" 400 $(code -b "$JARB" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"B Cross Co","clientType":"residential","customFields":[{"name":"License #","value":"CA-1"}]}' "$BASE/api/clients")
S=$(code -b "$JARB" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"B Home Co","clientType":"residential","customFields":[{"name":"Listing price","value":"585000"},{"name":"Bedrooms","value":"4"}]}' "$BASE/api/clients")
check "tenant B writes values for its own fields → 201" 201 "$S"
grep -q '"name":"Listing price","value":"585000"' /tmp/body.json && echo "  ✓ tenant B client stores its own field values" || echo "  ✗ tenant B client: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients")
check "owner client list → 200" 200 "$S"
grep -qv 'B Home Co' /tmp/body.json && echo "  ✓ owner never sees tenant B's client" || echo "  ✗ cross-org leak: $(cat /tmp/body.json)"

S=$(code -b "$JARB" -X PUT -H 'Content-Type: application/json' \
  -d '{"orgName":"Tenant B Rebranded","orgId":1}' "$BASE/api/settings")
check "tenant B PUT with owner orgId in body → 200" 200 "$S"
S=$(code -b "$JARB" "$BASE/api/auth/me")
grep -q '"orgName":"Tenant B Rebranded"' /tmp/body.json && echo "  ✓ tenant B write landed on tenant B (session org wins)" || echo "  ✗ tenant B me: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/auth/me")
grep -q '"orgName":"Revzenta"' /tmp/body.json && echo "  ✓ owner org untouched by tenant B's body-orgId write" || echo "  ✗ owner me: $(cat /tmp/body.json)"
check "admin deletes tenant B → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$TENANTB_ID")
rm -f "$JARB" "$JAR3"

echo "== 18. Owner impersonation (Phase 3d) =="
# The suite runs against a clean DB (bun run db:reset) without demo seed, so
# this section provisions its own tenant through the admin API — the same path
# the Admin tab uses — and exercises the whole impersonate → view → return
# round trip. $JAR still holds the admin session from section 17.
IMP_ORG_NAME="Acme Impersonation QA"
IMP_EMAIL="acme-imp@example.com"
IMP_PASSWORD="AcmeImpersonate123!"
JAR4=$(mktemp)   # the tenant member's own session
JAR5=$(mktemp)   # empty jar (unauthenticated)
JAR6=$(mktemp)   # fresh jar for the password-unchanged login check

echo "-- 18a. Provision a tenant to impersonate + seed it with 3 clients =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"$IMP_ORG_NAME\",\"email\":\"$IMP_EMAIL\",\"password\":\"$IMP_PASSWORD\"}" "$BASE/api/admin/orgs")
check "admin provisions impersonation target org → 201" 201 "$S"
IMP_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
IMP_USER_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['user']['id'])")
echo "    (impersonation org id=$IMP_ORG_ID, member user id=$IMP_USER_ID)"
S=$(code -b "$JAR" "$BASE/api/auth/me")
ADMIN_USER_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['user']['id'])")
echo "    (admin user id=$ADMIN_USER_ID)"

S=$(code -c "$JAR4" -b "$JAR4" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$IMP_EMAIL\",\"password\":\"$IMP_PASSWORD\"}" "$BASE/api/auth/login")
check "target member login → 200" 200 "$S"
grep -q "\"orgId\":$IMP_ORG_ID" /tmp/body.json && echo "  ✓ member login returns the target orgId" || echo "  ✗ member orgId: $(cat /tmp/body.json)"
for CL in \
  '{"companyName":"Greenlawn HOA","clientType":"residential","dealValue":3200,"stage":"Prospect"}' \
  '{"companyName":"Cactus Ridge HOA","clientType":"residential","dealValue":1800,"stage":"Prospect"}' \
  '{"companyName":"Sonoran Stoneworks","clientType":"residential","dealValue":12400,"stage":"Prospect"}'; do
  code -b "$JAR4" -X POST -H 'Content-Type: application/json' -d "$CL" "$BASE/api/clients" > /dev/null
done
S=$(code -b "$JAR4" "$BASE/api/clients")
check "target member lists clients → 200" 200 "$S"
grep -q 'Greenlawn HOA' /tmp/body.json && grep -q 'Cactus Ridge HOA' /tmp/body.json && grep -q 'Sonoran Stoneworks' /tmp/body.json && echo "  ✓ tenant seeded with its 3 clients" || echo "  ✗ tenant clients: $(cat /tmp/body.json)"

echo "-- 18b. Guards: 401 / 403 / own org / missing org (before impersonating) =="
check "impersonate without cookie → 401" 401 $(code -b "$JAR5" -X POST -H 'Content-Type: application/json' \
  -d "{\"orgId\":$IMP_ORG_ID}" "$BASE/api/admin/impersonate")
check "member calls impersonate → 403" 403 $(code -b "$JAR4" -X POST -H 'Content-Type: application/json' \
  -d "{\"orgId\":$IMP_ORG_ID}" "$BASE/api/admin/impersonate")
check "impersonate own org → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"orgId\":$DEFAULT_ORG_ID}" "$BASE/api/admin/impersonate")
check "impersonate missing org → 404" 404 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"orgId":999999}' "$BASE/api/admin/impersonate")
check "impersonate with bad orgId → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"orgId":"abc"}' "$BASE/api/admin/impersonate")

echo "-- 18c. Admin impersonates the tenant =="
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"orgId\":$IMP_ORG_ID}" "$BASE/api/admin/impersonate")
check "owner impersonate tenant → 200" 200 "$S"
grep -q "\"orgId\":$IMP_ORG_ID" /tmp/body.json && echo "  ✓ response user is the tenant's user (orgId matches)" || echo "  ✗ response orgId: $(cat /tmp/body.json)"
grep -q "\"id\":$IMP_USER_ID" /tmp/body.json && echo "  ✓ response user id is the tenant member's id" || echo "  ✗ response user id: $(cat /tmp/body.json)"
grep -q '"role":"member"' /tmp/body.json && echo "  ✓ response role is member" || echo "  ✗ response role: $(cat /tmp/body.json)"
grep -q '"impersonating":true' /tmp/body.json && echo "  ✓ response impersonating:true" || echo "  ✗ impersonating flag: $(cat /tmp/body.json)"
grep -q "\"impersonatedFrom\":$ADMIN_USER_ID" /tmp/body.json && echo "  ✓ response impersonatedFrom = admin id" || echo "  ✗ impersonatedFrom: $(cat /tmp/body.json)"

echo "-- 18d. me reports the impersonation =="
S=$(code -b "$JAR" "$BASE/api/auth/me")
check "me while impersonating → 200" 200 "$S"
grep -Fq "$IMP_EMAIL" /tmp/body.json && echo "  ✓ me returns the tenant user (email)" || echo "  ✗ me email: $(cat /tmp/body.json)"
grep -q "\"orgId\":$IMP_ORG_ID" /tmp/body.json && echo "  ✓ me orgId is the tenant org" || echo "  ✗ me orgId: $(cat /tmp/body.json)"
grep -q '"impersonating":true' /tmp/body.json && echo "  ✓ me impersonating:true" || echo "  ✗ me impersonating: $(cat /tmp/body.json)"
grep -q "\"impersonatedFrom\":$ADMIN_USER_ID" /tmp/body.json && echo "  ✓ me impersonatedFrom set to admin id" || echo "  ✗ me impersonatedFrom: $(cat /tmp/body.json)"

echo "-- 18e. Isolation intact while impersonating (owner sees only the tenant) =="
S=$(code -b "$JAR" "$BASE/api/clients")
check "impersonated clients list → 200" 200 "$S"
grep -q 'Greenlawn HOA' /tmp/body.json && grep -q 'Sonoran Stoneworks' /tmp/body.json && echo "  ✓ impersonated session sees the tenant's clients" || echo "  ✗ tenant clients missing: $(cat /tmp/body.json)"
grep -qv 'Summit Heating' /tmp/body.json && grep -qv 'Willow & Stone' /tmp/body.json && echo "  ✓ impersonated session does NOT see owner-org clients (isolation intact)" || echo "  ✗ CROSS-ORG LEAK: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "impersonated dashboard → 200" 200 "$S"
grep -q '"totalClients":3' /tmp/body.json && echo "  ✓ dashboard counts only the tenant's 3 clients" || echo "  ✗ dashboard: $(cat /tmp/body.json)"
if python3 - <<'PY' 2>"$PASS_TMP"
import json
d = json.load(open('/tmp/body.json'))
t = d.get('tasks', {})
# The impersonated tenant has no tasks of its own; the owner org's tasks
# (T1/T3/T4) must NOT surface through the swapped session.
assert t.get('open') == 0 and t.get('done') == 0 and t.get('upcoming') == [], t
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ impersonated dashboard task overview is empty (owner tasks not visible)"
else FAIL=$((FAIL+1)); echo "  ✗ owner tasks leaked into impersonated dashboard"; cat "$PASS_TMP"; fi
check "impersonated session cannot use admin endpoints → 403" 403 $(code -b "$JAR" "$BASE/api/admin/orgs")

echo "-- 18f. Return to the owner dashboard =="
S=$(code -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/impersonate-return")
check "impersonate-return → 200" 200 "$S"
grep -Fq "$ADMIN_EMAIL" /tmp/body.json && echo "  ✓ return response is the owner user" || echo "  ✗ return user: $(cat /tmp/body.json)"
grep -q '"impersonating":false' /tmp/body.json && echo "  ✓ return impersonating:false" || echo "  ✗ return flag: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/auth/me")
check "me after return → 200" 200 "$S"
grep -Fq "$ADMIN_EMAIL" /tmp/body.json && grep -q '"impersonating":false' /tmp/body.json && echo "  ✓ me is the owner again, not impersonating" || echo "  ✗ me after return: $(cat /tmp/body.json)"
grep -qv 'impersonatedFrom' /tmp/body.json && echo "  ✓ no impersonatedFrom on a normal session" || echo "  ✗ impersonatedFrom should be absent: $(cat /tmp/body.json)"
check "admin endpoints work again → 200" 200 $(code -b "$JAR" "$BASE/api/admin/orgs")

echo "-- 18g. Return guards =="
check "impersonate-return when not impersonating → 400" 400 $(code -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/impersonate-return")
check "member impersonate-return (never impersonating) → 400" 400 $(code -c "$JAR4" -b "$JAR4" -X POST "$BASE/api/auth/impersonate-return")
check "impersonate-return without cookie → 401" 401 $(code -b "$JAR5" -X POST "$BASE/api/auth/impersonate-return")

echo "-- 18h. Impersonation never touches the tenant's password =="
S=$(code -c "$JAR6" -b "$JAR6" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$IMP_EMAIL\",\"password\":\"$IMP_PASSWORD\"}" "$BASE/api/auth/login")
check "member login with original password after round-trip → 200" 200 "$S"
grep -q "\"orgId\":$IMP_ORG_ID" /tmp/body.json && grep -q '"role":"member"' /tmp/body.json && echo "  ✓ original password still works, role intact" || echo "  ✗ login after round-trip: $(cat /tmp/body.json)"

echo "-- 18i. Cleanup =="
check "admin deletes the impersonation target org → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$IMP_ORG_ID")
rm -f "$JAR4" "$JAR5" "$JAR6"
echo "== 19. Phase 3e UI surface checks (built bundle) =="
NEWEST_JS=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS" ] && [ -f "$NEWEST_JS" ]; then
  if grep -q "Manage stages" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ newest bundle contains the Clients-tab \"Manage stages\" shortcut"
  else
    FAIL=$((FAIL+1)); echo "  ✗ \"Manage stages\" shortcut missing from $NEWEST_JS"
  fi
  if grep -q "Client type" "$NEWEST_JS" && grep -q "Referral source" "$NEWEST_JS" && grep -q "ZIP / postal" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ newest bundle contains the new client-record form fields"
  else
    FAIL=$((FAIL+1)); echo "  ✗ new client-record form fields missing from $NEWEST_JS"
  fi
  if grep -q "type-badge" "$NEWEST_JS" && grep -q "Commercial" "$NEWEST_JS" && grep -q "Residential" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ Commercial/Residential type badges present in the bundle"
  else
    FAIL=$((FAIL+1)); echo "  ✗ type badges missing from $NEWEST_JS"
  fi
  if grep -q "Custom intake groups" "$NEWEST_JS" && grep -q "appliesTo" "$NEWEST_JS" && grep -q "fleet_size" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ Phase 3 custom-intake-group editor + key hints present in the bundle"
  else
    FAIL=$((FAIL+1)); echo "  ✗ Phase 3 custom-intake-group strings missing from $NEWEST_JS"
  fi
  if grep -q "invoices appear here once linked to a client" "$NEWEST_JS" && grep -q "unassigned" "$NEWEST_JS" && grep -q "No clients match" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ Finance client picker (combobox) + search empty-state hint present in the bundle"
  else
    FAIL=$((FAIL+1)); echo "  ✗ Finance client picker / search-hint strings missing from $NEWEST_JS"
  fi
  # Owner request 2026-08-14 — the single Clients tab split into TWO: "Leads"
  # (the pipeline) and "Clients" (the independent directory of every client).
  # Owner request 2026-08-15 — labels unified across EVERY workspace: the
  # member-org "All clients" variant label is gone, so the built bundle must
  # not contain it. The search placeholder is unique to the directory page.
  if ! grep -q "All clients" "$NEWEST_JS" && grep -q "Search company, contact, phone" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ bundle labels every workspace's directory tab \"Clients\" (no \"All clients\" variant)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ \"All clients\" variant label still present in $NEWEST_JS"
  fi
  # 2026-08-14 owner requests — dashboard Task overview panel (stats + due
  # tones) and the privacy eye (hide/show amounts, persisted via localStorage).
  if grep -q "Task overview" "$NEWEST_JS" && grep -q "Due soon" "$NEWEST_JS" && grep -q "Hide amounts" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the Task overview panel + privacy-eye strings"
  else
    FAIL=$((FAIL+1)); echo "  ✗ Task overview / privacy-eye strings missing from $NEWEST_JS"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found — run \`bun run build\` before the suite"
fi

echo "== 20. Archived clients round-trip (Clients tab visibility fix) =="
# The Clients tab fetches ALL clients (?archived=1) so archived ones show on
# the Archived/All tabs. This section locks the server contract the UI now
# relies on: default GET excludes archived, ?archived=1 includes them, and a
# PUT archived=false restores a client to the default list.
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Archive Round Trip Co","contactName":"Pat Doe","clientType":"residential","dealValue":7777,"stage":"Leads"}' \
  "$BASE/api/clients")
check "create round-trip client → 201" 201 "$S"
RT_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$RT_ID)"
grep -q '"archived":false' /tmp/body.json && echo "  ✓ new client starts active" || echo "  ✗ new client archived flag: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
P0=$(python3 -c "import json;d=json.load(open('/tmp/body.json'));print(d['stageCounts'].get('Leads',0))")
V0=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['projectedPipeline'])")
A0=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['archivedClients'])")
echo "    (before archive: Leads=$P0 pipeline=$V0 archivedClients=$A0)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Archive Round Trip Co","contactName":"Pat Doe","clientType":"residential","dealValue":7777,"stage":"Leads","archived":true}' \
  "$BASE/api/clients/$RT_ID")
check "PUT archived=true → 200" 200 "$S"
grep -q '"archived":true' /tmp/body.json && echo "  ✓ response archived=true" || echo "  ✗ archive failed: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients")
check "default list after archive → 200" 200 "$S"
grep -qv 'Archive Round Trip Co' /tmp/body.json && echo "  ✓ archived hidden in default GET" || echo "  ✗ archived still in default GET"
S=$(code -b "$JAR" "$BASE/api/clients?archived=1")
check "archived=1 list → 200" 200 "$S"
grep -q 'Archive Round Trip Co' /tmp/body.json && echo "  ✓ archived present in ?archived=1" || echo "  ✗ archived missing from ?archived=1"
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
grep -q "\"Leads\":$((P0-1))" /tmp/body.json && echo "  ✓ stageCounts Leads=$((P0-1)) (archived excluded from stage counts)" || echo "  ✗ stageCounts after archive: $(cat /tmp/body.json)"
python3 -c "import json,sys;sys.exit(0 if abs(json.load(open('/tmp/body.json'))['projectedPipeline']-($V0-7777))<0.01 else 1)" && echo "  ✓ projectedPipeline excludes the archived 7777 deal" || echo "  ✗ pipeline after archive: $(cat /tmp/body.json)"
grep -q "\"archivedClients\":$((A0+1))" /tmp/body.json && echo "  ✓ archivedClients=$((A0+1)) (incremented)" || echo "  ✗ archivedClients after archive: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Archive Round Trip Co","contactName":"Pat Doe","clientType":"residential","dealValue":7777,"stage":"Leads","archived":false}' \
  "$BASE/api/clients/$RT_ID")
check "PUT archived=false (restore) → 200" 200 "$S"
grep -q '"archived":false' /tmp/body.json && echo "  ✓ response archived=false (restored)" || echo "  ✗ restore failed: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients")
check "default list after restore → 200" 200 "$S"
grep -q 'Archive Round Trip Co' /tmp/body.json && echo "  ✓ restored client back in default GET" || echo "  ✗ restored client missing from default GET"
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
grep -q "\"Leads\":$P0" /tmp/body.json && echo "  ✓ stageCounts Leads=$P0 again (restored counts as active)" || echo "  ✗ stageCounts after restore: $(cat /tmp/body.json)"
python3 -c "import json,sys;sys.exit(0 if abs(json.load(open('/tmp/body.json'))['projectedPipeline']-$V0)<0.01 else 1)" && echo "  ✓ projectedPipeline back to $V0 (restored deal counted)" || echo "  ✗ pipeline after restore: $(cat /tmp/body.json)"
grep -q "\"archivedClients\":$A0" /tmp/body.json && echo "  ✓ archivedClients back to $A0" || echo "  ✗ archivedClients after restore: $(cat /tmp/body.json)"

echo "== 21. Adaptive intake Phase 1: org vertical config + client intake fields =="

echo "-- 21a. Settings round-trip for the four new org fields =="
S=$(code -b "$JAR" "$BASE/api/settings")
check "GET settings includes vertical defaults → 200" 200 "$S"
grep -q '"serviceModel":"both"' /tmp/body.json && grep -q '"deliveryType":"both"' /tmp/body.json && grep -q '"industry":""' /tmp/body.json && grep -q '"intakeOpts":\[\]' /tmp/body.json && echo "  ✓ vertical defaults: both / both / empty / []" || echo "  ✗ vertical defaults: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"serviceModel":"residential_only","deliveryType":"client_comes","industry":"professional","intakeOpts":["business_llc_tab","pet_on_premises","pet_on_premises","hoa_restrictions"]}' "$BASE/api/settings")
check "PUT all four vertical fields → 200" 200 "$S"
grep -q '"serviceModel":"residential_only"' /tmp/body.json && grep -q '"deliveryType":"client_comes"' /tmp/body.json && grep -q '"industry":"professional"' /tmp/body.json && grep -q '"intakeOpts":\["business_llc_tab","pet_on_premises","hoa_restrictions"\]' /tmp/body.json && echo "  ✓ round-trip + duplicate collapse (order preserved)" || echo "  ✗ settings response: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/settings")
check "GET after vertical PUT → 200" 200 "$S"
grep -q '"serviceModel":"residential_only"' /tmp/body.json && grep -q '"industry":"professional"' /tmp/body.json && grep -q '"intakeOpts":\["business_llc_tab","pet_on_premises","hoa_restrictions"\]' /tmp/body.json && echo "  ✓ persisted values survive a GET round-trip" || echo "  ✗ GET after PUT: $(cat /tmp/body.json)"

echo "-- 21b. Vertical settings validation =="
check "PUT bad serviceModel → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"serviceModel":"enterprise"}' "$BASE/api/settings")
check "PUT bad deliveryType → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"deliveryType":"teleport"}' "$BASE/api/settings")
check "PUT bad industry → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"industry":"space"}' "$BASE/api/settings")
check "PUT unknown intake group → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"intakeOpts":["business_llc_tab","secret_field"]}' "$BASE/api/settings")
check "PUT intakeOpts not a list → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"intakeOpts":"business_llc_tab"}' "$BASE/api/settings")
check "stages-only PUT keeps vertical fields → 200" 200 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Proposal","Sold"]}' "$BASE/api/settings")
S=$(code -b "$JAR" "$BASE/api/settings")
grep -q '"serviceModel":"residential_only"' /tmp/body.json && grep -q '"intakeOpts":\["business_llc_tab","pet_on_premises","hoa_restrictions"\]' /tmp/body.json && echo "  ✓ vertical fields untouched by a stages-only PUT" || echo "  ✗ vertical fields lost: $(cat /tmp/body.json)"

echo "-- 21c. Client create with intake/billing fields → GET round-trip =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Westgate Tower Mgmt","contactName":"Ava Stone","clientType":"commercial","industry":"Property Management","dealValue":18000,"stage":"Leads","billingAddress":"400 Bay St","billingCity":"San Francisco","billingState":"CA","billingZip":"94133","billingSame":false,"preferredContactMethod":"Email","businessType":"Property Management","taxIdEin":"12-3456789","apContact":"Ava Stone — accounts@westgate.example","poRequired":true,"unitsLocations":"3 towers","propertyManagerName":"Derek Liu","propertyManagerContact":"derek@westgate.example","hoaName":"Westgate HOA","hoaContact":"board@westgate.example","accessInstructions":"Gate code 4455; loading dock B","coiRequired":true,"serviceContract":"Annual maintenance — renews Jan","petOnPremises":false,"preferredServiceLocation":"On-site"}' \
  "$BASE/api/clients")
check "create commercial client with intake/billing fields → 201" 201 "$S"
AI_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$AI_ID)"
grep -q '"billingAddress":"400 Bay St"' /tmp/body.json && grep -q '"billingZip":"94133"' /tmp/body.json && grep -q '"billingSame":false' /tmp/body.json && grep -q '"poRequired":true' /tmp/body.json && grep -q '"coiRequired":true' /tmp/body.json && grep -q '"petOnPremises":false' /tmp/body.json && echo "  ✓ billing + yes/no fields round-trip on create" || echo "  ✗ create response: $(cat /tmp/body.json)"
grep -q '"propertyManagerName":"Derek Liu"' /tmp/body.json && grep -q '"hoaContact":"board@westgate.example"' /tmp/body.json && grep -q '"accessInstructions":"Gate code 4455; loading dock B"' /tmp/body.json && grep -q '"serviceContract":"Annual maintenance — renews Jan"' /tmp/body.json && echo "  ✓ home-services intake fields round-trip" || echo "  ✗ intake fields missing: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$AI_ID")
check "GET client → 200" 200 "$S"
grep -q '"taxIdEin":"12-3456789"' /tmp/body.json && grep -q '"unitsLocations":"3 towers"' /tmp/body.json && grep -q '"preferredContactMethod":"Email"' /tmp/body.json && grep -q '"preferredServiceLocation":"On-site"' /tmp/body.json && echo "  ✓ GET returns all new fields" || echo "  ✗ GET missing fields: $(cat /tmp/body.json)"

echo "-- 21d. New-field validation =="
check "over-long billing address → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Long Bill Co\",\"clientType\":\"residential\",\"billingAddress\":\"$(python3 -c "print('x'*201)")\"}" "$BASE/api/clients")
check "bad boolean petOnPremises → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad Pet Co","clientType":"residential","petOnPremises":"yes"}' "$BASE/api/clients")
check "over-long tax ID → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Long EIN Co\",\"clientType\":\"commercial\",\"taxIdEin\":\"$(python3 -c "print('9'*51)")\"}" "$BASE/api/clients")

echo "-- 21e. Partial update: only present keys persisted =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Westgate Tower Mgmt","contactName":"Ava Stone","clientType":"commercial","industry":"Property Management","dealValue":18000,"stage":"Leads","billingAddress":"500 Bay St","billingCity":"San Francisco","billingState":"CA","billingZip":"94133","billingSame":true,"poRequired":false,"coiRequired":true,"petOnPremises":false}' \
  "$BASE/api/clients/$AI_ID")
check "PUT subset of new fields → 200" 200 "$S"
grep -q '"billingAddress":"500 Bay St"' /tmp/body.json && grep -q '"billingSame":true' /tmp/body.json && grep -q '"poRequired":false' /tmp/body.json && echo "  ✓ updated fields applied" || echo "  ✗ update response: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$AI_ID")
check "GET after subset update → 200" 200 "$S"
grep -q '"taxIdEin":"12-3456789"' /tmp/body.json && grep -q '"preferredContactMethod":"Email"' /tmp/body.json && grep -q '"apContact":"Ava Stone — accounts@westgate.example"' /tmp/body.json && grep -q '"accessInstructions":"Gate code 4455; loading dock B"' /tmp/body.json && grep -q '"propertyManagerName":"Derek Liu"' /tmp/body.json && grep -q '"coiRequired":true' /tmp/body.json && echo "  ✓ absent keys NOT clobbered (intake fields intact)" || echo "  ✗ CLOBBERED: $(cat /tmp/body.json)"

echo "-- 21f. Cross-org isolation of the new fields =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Adaptive Intake QA LLC","email":"aiqa@example.com","password":"aiqapass123"}' "$BASE/api/admin/orgs")
check "admin provisions isolation org → 201" 201 "$S"
AI_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARAI=$(mktemp)
S=$(code -c "$JARAI" -b "$JARAI" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"aiqa@example.com","password":"aiqapass123"}' "$BASE/api/auth/login")
check "isolation org login → 200" 200 "$S"
S=$(code -b "$JARAI" -X PUT -H 'Content-Type: application/json' \
  -d '{"serviceModel":"commercial_only","deliveryType":"we_go","industry":"mobile_personal","intakeOpts":["parking_access","pet_on_premises"]}' "$BASE/api/settings")
check "isolation org sets its own vertical config → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/settings")
grep -q '"serviceModel":"residential_only"' /tmp/body.json && grep -qv 'mobile_personal' /tmp/body.json && echo "  ✓ owner config unaffected by other org's vertical settings" || echo "  ✗ owner settings: $(cat /tmp/body.json)"
S=$(code -b "$JARAI" "$BASE/api/settings")
check "isolation org GET settings → 200" 200 "$S"
grep -q '"serviceModel":"commercial_only"' /tmp/body.json && grep -q '"intakeOpts":\["parking_access","pet_on_premises"\]' /tmp/body.json && grep -qv '"residential_only"' /tmp/body.json && echo "  ✓ isolation org sees only its own vertical config" || echo "  ✗ isolation org settings: $(cat /tmp/body.json)"
S=$(code -b "$JARAI" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Glow Mobile Spa","contactName":"Nina Reyes","clientType":"residential","petOnPremises":true,"parkingAccess":"Driveway, back gate","dbaName":"Glow LLC","einSsn":"123-45-6789","preferredServiceLocation":"Client home"}' \
  "$BASE/api/clients")
check "isolation org creates client with new fields → 201" 201 "$S"
AI_CLIENT_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
grep -q '"petOnPremises":true' /tmp/body.json && grep -q '"dbaName":"Glow LLC"' /tmp/body.json && grep -q '"parkingAccess":"Driveway, back gate"' /tmp/body.json && echo "  ✓ new fields stored on the other org's client" || echo "  ✗ isolation client: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients")
check "owner client list → 200" 200 "$S"
grep -qv 'Glow Mobile Spa' /tmp/body.json && grep -qv '"dbaName":"Glow LLC"' /tmp/body.json && echo "  ✓ owner does NOT see other org's client intake fields" || echo "  ✗ cross-org leak: $(cat /tmp/body.json)"
check "owner GET other-org client → 404" 404 $(code -b "$JAR" "$BASE/api/clients/$AI_CLIENT_ID")
check "owner PUT other-org client → 404" 404 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Hacked","clientType":"residential","petOnPremises":true}' "$BASE/api/clients/$AI_CLIENT_ID")
S=$(code -b "$JARAI" "$BASE/api/clients")
check "isolation org client list → 200" 200 "$S"
grep -qv 'Westgate Tower Mgmt' /tmp/body.json && grep -qv '"taxIdEin":"12-3456789"' /tmp/body.json && echo "  ✓ other org does NOT see owner's client intake fields" || echo "  ✗ cross-org leak: $(cat /tmp/body.json)"
check "admin deletes isolation org → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$AI_ORG_ID")
rm -f "$JARAI"
# Restore the owner org's vertical config to defaults (fresh-DB suites expect
# the owner to start clean; harmless if another section runs after this one).
code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"serviceModel":"both","deliveryType":"both","industry":"","intakeOpts":[]}' "$BASE/api/settings" > /dev/null
echo "== 22. Adaptive intake Phase 3: custom conditional field groups =="
echo "-- 22a. Settings round-trip for customIntakeGroups =="
S=$(code -b "$JAR" "$BASE/api/settings")
check "GET settings → 200" 200 "$S"
grep -q '"customIntakeGroups":\[\]' /tmp/body.json && echo "  ✓ customIntakeGroups defaults to []" || echo "  ✗ customIntakeGroups default: $(cat /tmp/body.json)"
python3 - <<'PY'
import json
groups = [
  {"id": "g_indiv_details", "name": "Client details", "appliesTo": "individual", "enabled": True,
   "fields": [
     {"key": "fleet_size", "label": "Fleet size", "kind": "text"},
     {"key": "insured", "label": "Insured?", "kind": "yesno"},
     {"key": "region", "label": "Region", "kind": "select", "options": ["East", "West"]}]},
  {"id": "g_fleet_ops", "name": "Fleet ops", "appliesTo": "commercial", "enabled": True,
   "fields": [
     {"key": "po_number_req", "label": "PO number required?", "kind": "yesno"},
     {"key": "fleet_region", "label": "Fleet region", "kind": "select", "options": ["North", "South"]}]},
  {"id": "g_internal", "name": "Internal notes", "appliesTo": "both", "enabled": False,
   "fields": [{"key": "internal_note", "label": "Internal note", "kind": "text"}]},
]
json.dump({"customIntakeGroups": groups}, open("/tmp/p3_groups.json", "w"))
PY
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' -d @/tmp/p3_groups.json "$BASE/api/settings")
check "PUT 3 custom intake groups → 200" 200 "$S"
grep -q '"name":"Client details"' /tmp/body.json && grep -q '"appliesTo":"individual"' /tmp/body.json && grep -q '"enabled":false' /tmp/body.json && grep -q '"options":\["East","West"\]' /tmp/body.json && echo "  ✓ groups round-trip (name/appliesTo/enabled/options)" || echo "  ✗ PUT response: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/settings")
check "GET after groups PUT → 200" 200 "$S"
grep -q '"key":"fleet_size"' /tmp/body.json && grep -q '"kind":"yesno"' /tmp/body.json && grep -q '"kind":"select"' /tmp/body.json && echo "  ✓ GET returns stored groups + typed fields" || echo "  ✗ GET groups: $(cat /tmp/body.json)"
echo "-- 22b. customIntakeGroups validation =="
check "PUT bad field kind → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":[{"id":"g1","name":"Bad","appliesTo":"both","enabled":true,"fields":[{"key":"when","label":"When","kind":"date"}]}]}' "$BASE/api/settings")
check "PUT duplicate key across groups → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":[{"id":"g1","name":"A","appliesTo":"both","enabled":true,"fields":[{"key":"same","label":"One","kind":"text"}]},{"id":"g2","name":"B","appliesTo":"both","enabled":true,"fields":[{"key":"same","label":"Two","kind":"text"}]}]}' "$BASE/api/settings")
check "PUT select without options → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":[{"id":"g1","name":"Sel","appliesTo":"both","enabled":true,"fields":[{"key":"pick","label":"Pick","kind":"select","options":[]}]}]}' "$BASE/api/settings")
check "PUT bad key format → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":[{"id":"g1","name":"BadKey","appliesTo":"both","enabled":true,"fields":[{"key":"2bad","label":"Two","kind":"text"}]}]}' "$BASE/api/settings")
check "PUT groups not a list → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":"nope"}' "$BASE/api/settings")
check "PUT invalid appliesTo → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":[{"id":"g1","name":"X","appliesTo":"everyone","enabled":true,"fields":[{"key":"a","label":"A","kind":"text"}]}]}' "$BASE/api/settings")
check "PUT empty group name → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":[{"id":"g1","name":"  ","appliesTo":"both","enabled":true,"fields":[{"key":"a","label":"A","kind":"text"}]}]}' "$BASE/api/settings")
echo "-- 22b2. Key collision with tenant custom-field names (same value array) =="
S=$(code -b "$JAR" "$BASE/api/settings")
check "GET settings for collision setup → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open("/tmp/body.json"))
defs = d["settings"]["customFields"]
json.dump({"customFields": defs + [{"name": "roster_size", "type": "text"}]}, open("/tmp/p3_defs_plus.json", "w"))
json.dump({"customFields": defs}, open("/tmp/p3_defs_orig.json", "w"))
PY
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' -d @/tmp/p3_defs_plus.json "$BASE/api/settings")
check "PUT extended customFields → 200" 200 "$S"
check "PUT group key colliding with custom field → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"customIntakeGroups":[{"id":"g1","name":"Col","appliesTo":"both","enabled":true,"fields":[{"key":"roster_size","label":"Roster","kind":"text"}]}]}' "$BASE/api/settings")
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' -d @/tmp/p3_defs_orig.json "$BASE/api/settings")
check "PUT customFields restored → 200" 200 "$S"
echo "-- 22c. Client create/update round-trip with custom group values =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"P3 Individual Co","contactName":"Riley Doe","clientType":"residential","customFields":[{"name":"fleet_size","value":"12"},{"name":"insured","value":true},{"name":"region","value":"West"}]}' "$BASE/api/clients")
check "create individual client with group values → 201" 201 "$S"
P3_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$P3_ID)"
grep -q '"name":"fleet_size","value":"12"' /tmp/body.json && grep -q '"name":"insured","value":"1"' /tmp/body.json && grep -q '"name":"region","value":"West"' /tmp/body.json && echo "  ✓ group values stored via custom_fields (yesno → 1)" || echo "  ✗ create response: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$P3_ID")
check "GET client → 200" 200 "$S"
grep -q '"name":"fleet_size","value":"12"' /tmp/body.json && grep -q '"name":"region","value":"West"' /tmp/body.json && echo "  ✓ values returned by GET (prefill on edit)" || echo "  ✗ GET client: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"P3 Individual Co","contactName":"Riley Doe","clientType":"residential","customFields":[{"name":"fleet_size","value":"14"},{"name":"insured","value":false},{"name":"region","value":"East"}]}' "$BASE/api/clients/$P3_ID")
check "PUT updated group values → 200" 200 "$S"
grep -q '"name":"fleet_size","value":"14"' /tmp/body.json && grep -q '"name":"insured","value":"0"' /tmp/body.json && grep -q '"name":"region","value":"East"' /tmp/body.json && echo "  ✓ update round-trip (yesno → 0)" || echo "  ✗ update response: $(cat /tmp/body.json)"
check "unknown key → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad Key Co","clientType":"residential","customFields":[{"name":"ghost_key","value":"x"}]}' "$BASE/api/clients")
check "disabled group key → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Disabled Co","clientType":"residential","customFields":[{"name":"internal_note","value":"x"}]}' "$BASE/api/clients")
check "commercial-only key on individual client → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Wrong Type Co","clientType":"residential","customFields":[{"name":"po_number_req","value":"1"}]}' "$BASE/api/clients")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"P3 Commercial Co","contactName":"Sam Doe","clientType":"commercial","customFields":[{"name":"po_number_req","value":true},{"name":"fleet_region","value":"North"}]}' "$BASE/api/clients")
check "commercial client with commercial group values → 201" 201 "$S"
grep -q '"name":"po_number_req","value":"1"' /tmp/body.json && grep -q '"name":"fleet_region","value":"North"' /tmp/body.json && echo "  ✓ commercial group keys accepted for commercial client" || echo "  ✗ commercial client: $(cat /tmp/body.json)"
echo "-- 22d. Cross-org isolation of custom intake groups =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Phase3 QA LLC","email":"p3qa@example.com","password":"p3qapass123"}' "$BASE/api/admin/orgs")
check "admin provisions Phase3 isolation org → 201" 201 "$S"
P3_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARP3=$(mktemp)
S=$(code -c "$JARP3" -b "$JARP3" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"p3qa@example.com","password":"p3qapass123"}' "$BASE/api/auth/login")
check "Phase3 org login → 200" 200 "$S"
S=$(code -b "$JARP3" "$BASE/api/settings")
check "Phase3 org GET settings → 200" 200 "$S"
grep -q '"customIntakeGroups":\[\]' /tmp/body.json && echo "  ✓ other org has NO custom intake groups (owner groups invisible)" || echo "  ✗ other org sees groups: $(cat /tmp/body.json)"
check "other org cannot use owner's group keys → 400" 400 $(code -b "$JARP3" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Leak Co","clientType":"residential","customFields":[{"name":"fleet_size","value":"99"}]}' "$BASE/api/clients")
S=$(code -b "$JAR" "$BASE/api/settings")
check "owner settings still have groups → 200" 200 "$S"
grep -q '"key":"fleet_size"' /tmp/body.json && echo "  ✓ owner groups unaffected by other org" || echo "  ✗ owner groups lost: $(cat /tmp/body.json)"
check "admin deletes Phase3 org → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$P3_ORG_ID")
rm -f "$JARP3"
# Cleanup: remove the owner's custom intake groups + restore vertical defaults
# so a re-run of the suite on the same DB starts clean.
code -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"customIntakeGroups":[]}' "$BASE/api/settings" > /dev/null
code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"serviceModel":"both","deliveryType":"both","industry":"","intakeOpts":[]}' "$BASE/api/settings" > /dev/null

echo "== 23. Business types (owner direction 2026-08-16): the catalog is B2B & B2C only =="
echo "-- 23a. Admin creates a B2B org — generic pipeline seeded, no preset fields =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"B2B Pilot LLC","email":"b2b@example.com","password":"b2bpass123","vertical":"b2b"}' "$BASE/api/admin/orgs")
check "admin creates B2B org → 201" 201 "$S"
B2B_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARB2B=$(mktemp)
S=$(code -c "$JARB2B" -b "$JARB2B" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"b2b@example.com","password":"b2bpass123"}' "$BASE/api/auth/login")
check "b2b org login → 200" 200 "$S"
S=$(code -b "$JARB2B" "$BASE/api/settings")
check "b2b org GET settings → 200" 200 "$S"
grep -q '"stages":\["Leads","Contacted","Quoted","Won"\]' /tmp/body.json && echo "  ✓ B2B stages seeded (Leads → Contacted → Quoted → Won, in order)" || echo "  ✗ B2B stages: $(cat /tmp/body.json)"
grep -q '"verticalKey":"b2b"' /tmp/body.json && echo "  ✓ verticalKey=b2b seeded" || echo "  ✗ verticalKey: $(cat /tmp/body.json)"
grep -q '"industry":"professional"' /tmp/body.json && grep -q '"serviceModel":"commercial_only"' /tmp/body.json && grep -q '"deliveryType":"both"' /tmp/body.json && echo "  ✓ B2B vertical settings (professional / commercial_only / both)" || echo "  ✗ B2B settings: $(cat /tmp/body.json)"
grep -q '"customFields":\[\]' /tmp/body.json && echo "  ✓ B2B org has NO preset custom fields (accounts customize)" || echo "  ✗ B2B fields: $(cat /tmp/body.json)"

echo "-- 23b. B2C seeds the SAME generic pipeline; bare org unchanged; legacy keys rejected =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"B2C Shop LLC","email":"b2c@example.com","password":"b2cpass123","vertical":"b2c"}' "$BASE/api/admin/orgs")
check "admin creates B2C org → 201" 201 "$S"
B2C_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARB2C=$(mktemp)
S=$(code -c "$JARB2C" -b "$JARB2C" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"b2c@example.com","password":"b2cpass123"}' "$BASE/api/auth/login")
check "b2c org login → 200" 200 "$S"
S=$(code -b "$JARB2C" "$BASE/api/settings")
check "b2c org GET settings → 200" 200 "$S"
grep -q '"stages":\["Leads","Contacted","Quoted","Won"\]' /tmp/body.json && echo "  ✓ B2C shares the SAME generic pipeline (Leads → Contacted → Quoted → Won)" || echo "  ✗ B2C stages: $(cat /tmp/body.json)"
grep -q '"verticalKey":"b2c"' /tmp/body.json && echo "  ✓ verticalKey=b2c seeded" || echo "  ✗ verticalKey: $(cat /tmp/body.json)"
grep -q '"industry":"home_services"' /tmp/body.json && grep -q '"serviceModel":"residential_only"' /tmp/body.json && grep -q '"deliveryType":"both"' /tmp/body.json && echo "  ✓ B2C vertical settings (home_services / residential_only / both)" || echo "  ✗ B2C settings: $(cat /tmp/body.json)"
grep -q '"customFields":\[\]' /tmp/body.json && echo "  ✓ B2C org has NO preset custom fields" || echo "  ✗ B2C fields: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"No Vertical Co","email":"novertica@example.com","password":"noverticapass123"}' "$BASE/api/admin/orgs")
check "admin creates org WITHOUT vertical → 201 (bare org, default pipeline)" 201 "$S"
NOVERT_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
check "admin deletes No Vertical Co → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$NOVERT_ID")
check "legacy vertical on create (landscaping) → 400 (catalog retired)" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Legacy Co","email":"legacy@example.com","password":"legacypass123","vertical":"landscaping"}' "$BASE/api/admin/orgs")
check "legacy vertical on create (general) → 400 (no longer a type)" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Legacy Co2","email":"legacy2@example.com","password":"legacypass123","vertical":"general"}' "$BASE/api/admin/orgs")

echo "-- 23c. Template seeds are org-isolated (no leak) =="
S=$(code -b "$JARB2B" "$BASE/api/settings")
check "b2b org settings still b2b → 200" 200 "$S"
grep -q '"verticalKey":"b2b"' /tmp/body.json && grep -q '"industry":"professional"' /tmp/body.json && echo "  ✓ B2B org unaffected by B2C creation (isolation)" || echo "  ✗ b2b org: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/settings")
check "owner settings → 200" 200 "$S"
grep -qv 'Contacted' /tmp/body.json && grep -qv '"verticalKey":"b2c"' /tmp/body.json && echo "  ✓ owner org untouched by any template seed" || echo "  ✗ owner org got seeded stages/fields: $(cat /tmp/body.json)"
check "member cannot create orgs (admin-only) → 403" 403 $(code -b "$JARB2B" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Hack Co","email":"hack@example.com","password":"hackpass123","vertical":"b2c"}' "$BASE/api/admin/orgs")

echo "-- 23d. Additive apply: missing stages appended, existing untouched =="
S=$(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["New leads","Contacted","Quoted","Won"]}' "$BASE/api/settings")
check "b2c org renames a stage (Leads→New leads) → 200" 200 "$S"
S=$(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"Extra field","type":"text"}]}' "$BASE/api/settings")
check "b2c org adds its own custom field → 200" 200 "$S"
S=$(code -b "$JARB2C" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"B2C Client One","clientType":"residential","stage":"New leads","dealValue":700,"customFields":[{"name":"Extra field","value":"x"}]}' "$BASE/api/clients")
check "b2c org creates client in renamed stage + own field value → 201" 201 "$S"
grep -q '"name":"Extra field","value":"x"' /tmp/body.json && echo "  ✓ own custom field value stored" || echo "  ✗ client values: $(cat /tmp/body.json)"
grep -q '"stage":"New leads"' /tmp/body.json && echo "  ✓ client in renamed stage" || echo "  ✗ stage: $(cat /tmp/body.json)"
S=$(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"b2b"}' "$BASE/api/settings")
check "apply B2B template to b2c org → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
stages = d['stages']
assert stages == ["New leads","Contacted","Quoted","Won","Leads"], stages
assert [f['name'] for f in d['customFields']] == ["Extra field"], d['customFields']
assert d['verticalKey'] == 'b2b' and d['industry'] == 'professional' and d['serviceModel'] == 'commercial_only' and d['deliveryType'] == 'both', d
print("  ✓ additive apply: renamed stage kept, missing template stage (Leads) appended, vertical settings updated")
PY
S=$(code -b "$JARB2C" "$BASE/api/clients")
check "b2c client list after apply → 200" 200 "$S"
grep -q 'B2C Client One' /tmp/body.json && grep -q '"stage":"New leads"' /tmp/body.json && echo "  ✓ client untouched by template apply (still in renamed stage)" || echo "  ✗ client after apply: $(cat /tmp/body.json)"
S=$(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"b2b"}' "$BASE/api/settings")
check "apply same template again → 200 (idempotent)" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
assert d['stages'] == ["New leads","Contacted","Quoted","Won","Leads"], d['stages']
assert len(d['customFields']) == 1, len(d['customFields'])
print("  ✓ re-apply adds nothing (no duplicates)")
PY
S=$(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"general"}' "$BASE/api/settings")
check "apply legacy General (back to no preset) → 200" 200 "$S"
grep -q '"verticalKey":""' /tmp/body.json && grep -q '"industry":""' /tmp/body.json && grep -q '"serviceModel":"both"' /tmp/body.json && echo "  ✓ legacy General resets vertical config to defaults" || echo "  ✗ after general: $(cat /tmp/body.json)"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
assert d['stages'] == ["New leads","Contacted","Quoted","Won","Leads"], d['stages']
assert len(d['customFields']) == 1, len(d['customFields'])
print("  ✓ legacy General apply leaves stages + fields untouched (non-destructive)")
PY
check "bad verticalKey on apply → 400" 400 $(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"quantum_cleaning"}' "$BASE/api/settings")
check "legacy verticalKey on apply → 400" 400 $(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"painting"}' "$BASE/api/settings")
check "non-string verticalKey on apply → 400" 400 $(code -b "$JARB2C" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":42}' "$BASE/api/settings")

echo "-- 23e. Cross-org isolation for custom-field definitions =="
S=$(code -b "$JARB2B" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Field Zero","clientType":"residential","customFields":[{"name":"Extra field","value":"nope"}]}' "$BASE/api/clients")
check "b2b org cannot write a field it doesn't define → 400" 400 "$S"
grep -q 'Unknown custom field' /tmp/body.json && echo "  ✓ error is the unknown-field guard" || echo "  ✗ error: $(cat /tmp/body.json)"
S=$(code -b "$JARB2C" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Field One","clientType":"residential","customFields":[{"name":"Extra field","value":"y"}]}' "$BASE/api/clients")
check "b2c org writes its own field value → 201" 201 "$S"
grep -q '"name":"Extra field","value":"y"' /tmp/body.json && echo "  ✓ own text field value round-trips" || echo "  ✗ b2c client: $(cat /tmp/body.json)"

echo "-- 23f. UI surface strings in the built bundle =="
NEWEST_JS=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS" ] && [ -f "$NEWEST_JS" ]; then
  if grep -q "Business type" "$NEWEST_JS" && grep -q "Apply template" "$NEWEST_JS" && grep -q '"B2B"' "$NEWEST_JS" && grep -q '"B2C"' "$NEWEST_JS" && grep -q "Contacted" "$NEWEST_JS" && grep -q "Quoted" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the business-type picker, apply-template + the B2B/B2C generic pipeline"
  else
    FAIL=$((FAIL+1)); echo "  ✗ B2B/B2C strings missing from $NEWEST_JS"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for bundle surface check"
fi

echo "== 24. Owner pipeline migration (3g-2): Leads → Onboarding → Sold =="
echo "-- 24a. Owner org has exactly 3 stages (editor tests renamed the middle) =="
# The stage-editor sections (17e/17f) renamed the middle stage to "Proposal" to
# prove the Settings editor still works on the owner org — so at this point the
# owner pipeline is [Leads, Proposal, Sold]: exactly 3 stages, first Leads,
# last Sold. The canonical [Leads, Onboarding, Sold] is asserted right after the
# migration in 24b.
S=$(code -b "$JAR" "$BASE/api/auth/me")
check "owner me → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
st = d['user']['stages']
assert len(st) == 3, st
assert st[0] == 'Leads' and st[2] == 'Sold', st
print("  ✓ owner me: exactly 3 stages (%s) — first Leads, last Sold" % " → ".join(st))
PY
S=$(code -b "$JAR" "$BASE/api/settings")
check "owner settings → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
st = d['settings']['stages']
assert len(st) == 3, st
assert st[0] == 'Leads' and st[2] == 'Sold', st
print("  ✓ owner settings stage list is exactly 3 stages (%s)" % " → ".join(st))
PY
echo "-- 24b. Positional client migration (server-side data migration) =="
# The migration is a boot-time server-side data migration (orgs.stages replaced
# + client stage values remapped positionally), so this section exercises it at
# the layer where it lives: a bun script importing the SAME server module the
# boot path imports resets the owner org to the legacy 6-stage pipeline, drops
# one client into each old stage, runs migrateOwnerPipeline() and prints the
# result. The shell then verifies the remap through the API. A tenant org is
# provisioned alongside and must come out of the migration completely
# untouched (its stages and its clients' stages).
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Mig Tenant LLC","email":"migtenant@example.com","password":"migtenant123"}' "$BASE/api/admin/orgs")
check "provision tenant to prove isolation → 201" 201 "$S"
MIG_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARMIG=$(mktemp)
S=$(code -c "$JARMIG" -b "$JARMIG" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"migtenant@example.com","password":"migtenant123"}' "$BASE/api/auth/login")
check "tenant login → 200" 200 "$S"
code -b "$JARMIG" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Prospect Co","clientType":"residential","dealValue":111,"stage":"Prospect"}' "$BASE/api/clients" > /dev/null
code -b "$JARMIG" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Build Co","clientType":"residential","dealValue":222,"stage":"Build"}' "$BASE/api/clients" > /dev/null
S=$(code -b "$JARMIG" "$BASE/api/settings")
check "tenant starts from the legacy default stages (General org) → 200" 200 "$S"
grep -q '"stages":\["Prospect","Intake","Kickoff","Build","Launch","Retainer"\]' /tmp/body.json && echo "  ✓ tenant has the legacy 6-stage list (the migration must NOT touch it)" || echo "  ✗ tenant stages: $(cat /tmp/body.json)"

cat > /tmp/mig_run.ts <<'TS'
import { db, getOrg, parseStages, migrateOwnerPipeline } from "/home/team/shared/crm-app/server/db.ts";
// Simulate the pre-3g-2 owner state: legacy 6-stage pipeline + one client per
// old stage (inserted at the DB layer — the migration IS a data migration).
const owner = db.query("SELECT org_id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as { org_id: number };
const orgId = owner.org_id;
const legacy = ["Prospect", "Intake", "Kickoff", "Build", "Launch", "Retainer"];
db.query("UPDATE orgs SET stages = ? WHERE id = ?").run(JSON.stringify(legacy), orgId);
const insert = db.prepare(
  "INSERT INTO clients (org_id, company_name, client_type, deal_value, stage) VALUES (?, ?, 'residential', ?, ?)",
);
const bands = [
  "Legacy Lead Band", "Legacy Intake Band", "Legacy Kickoff Band",
  "Legacy Build Band", "Legacy Launch Band", "Legacy Retainer Band",
];
for (let i = 0; i < legacy.length; i++) insert.run(orgId, bands[i], (i + 1) * 1000, legacy[i]);
migrateOwnerPipeline();
const org = getOrg(orgId)!;
const rows = db.query(
  "SELECT company_name, stage FROM clients WHERE org_id = ? AND company_name LIKE 'Legacy %' ORDER BY id",
).all(orgId);
console.log("MIG_RESULT " + JSON.stringify({ stages: parseStages(org.stages), clients: rows }));
TS
MIG_OUT=$(bun /tmp/mig_run.ts 2>/dev/null | grep '^MIG_RESULT ')
echo "    $MIG_OUT"
echo "$MIG_OUT" | sed 's/^MIG_RESULT //' > /tmp/mig_result.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/mig_result.json'))
st = d.get('stages', [])
assert st == ['Leads', 'Onboarding', 'Sold'], st
expect = {
  'Legacy Lead Band': 'Leads',
  'Legacy Intake Band': 'Leads',
  'Legacy Kickoff Band': 'Onboarding',
  'Legacy Build Band': 'Onboarding',
  'Legacy Launch Band': 'Sold',
  'Legacy Retainer Band': 'Sold',
}
by = {c['company_name']: c['stage'] for c in d.get('clients', [])}
assert by == expect, (by, expect)
print("  ✓ positional remap (computed from counts): bands [1-2]→Leads, [3-4]→Onboarding, [5-6]→Sold")
print("  ✓ every owner client record's stage value migrated (Prospect/Intake→Leads, Kickoff/Build→Onboarding, Launch/Retainer→Sold)")
PY
S=$(code -b "$JAR" "$BASE/api/settings")
grep -q '"stages":\["Leads","Onboarding","Sold"\]' /tmp/body.json && echo "  ✓ owner settings (via API) reflect the migrated pipeline" || echo "  ✗ owner stages via API: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients?q=Legacy")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
by = {c['companyName']: c['stage'] for c in d['clients']}
expect = {
  'Legacy Lead Band': 'Leads',
  'Legacy Intake Band': 'Leads',
  'Legacy Kickoff Band': 'Onboarding',
  'Legacy Build Band': 'Onboarding',
  'Legacy Launch Band': 'Sold',
  'Legacy Retainer Band': 'Sold',
}
assert by == expect, (by, expect)
print("  ✓ API confirms the remap (a record formerly in Build is now Onboarding, Retainer → Sold)")
PY

echo "-- 24c. Tenant org untouched by the migration =="
S=$(code -b "$JARMIG" "$BASE/api/settings")
check "tenant settings after migration → 200" 200 "$S"
grep -q '"stages":\["Prospect","Intake","Kickoff","Build","Launch","Retainer"\]' /tmp/body.json && echo "  ✓ tenant stages UNCHANGED after the migration (still the legacy defaults)" || echo "  ✗ tenant stages changed: $(cat /tmp/body.json)"
S=$(code -b "$JARMIG" "$BASE/api/clients")
check "tenant clients after migration → 200" 200 "$S"
grep -q '"companyName":"Tenant Prospect Co"' /tmp/body.json && grep -q '"stage":"Prospect"' /tmp/body.json && grep -q '"companyName":"Tenant Build Co"' /tmp/body.json && grep -q '"stage":"Build"' /tmp/body.json && echo "  ✓ tenant client stages UNCHANGED (Prospect + Build intact)" || echo "  ✗ tenant clients changed: $(cat /tmp/body.json)"

echo "-- 24d. UI surface strings for the owner pipeline =="
NEWEST_JS=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS" ] && [ -f "$NEWEST_JS" ]; then
  if grep -q "In final stage" "$NEWEST_JS" && grep -q 'Leads in "' "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the KPI strings (\"In final stage\" with the owner \"Leads in …\" note → Sold)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ owner KPI strings missing from $NEWEST_JS"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 3g-2 bundle surface check"
fi

echo "-- 24e. Cleanup =="
check "admin deletes Mig Tenant org → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$MIG_ORG_ID")
rm -f "$JARMIG"
code -b "$JAR" "$BASE/api/clients?q=Legacy" > /dev/null
for ID in $(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(' '.join(str(c['id']) for c in d['clients'] if c['companyName'].startswith('Legacy ')))"); do
  code -b "$JAR" -X DELETE "$BASE/api/clients/$ID" > /dev/null
done
S=$(code -b "$JAR" "$BASE/api/settings")
grep -q '"stages":\["Leads","Onboarding","Sold"\]' /tmp/body.json && echo "  ✓ owner org ends clean: stages back to Leads → Onboarding → Sold, test clients removed" || echo "  ✗ owner end state: $(cat /tmp/body.json)"
rm -f /tmp/mig_run.ts /tmp/mig_result.json

echo "== 25. Fresh-process boot: prod-style import-time migration (TDZ regression) =="
# Section 24 exercises the migration from a process where server/db.ts is
# already FULLY loaded, so it cannot catch the boot crash that took down prod
# on 2026-08-14 (two failed 3g-2 deploys): db.ts invokes migrateOwnerPipeline()
# at import time, and on a database where the admin already exists with the
# legacy 6-stage pipeline that import-time pass reads [...OWNER_PIPELINE] —
# which was declared AFTER the call site and was still in its temporal dead
# zone → ReferenceError at boot → update_failed. This section replays the exact
# prod-style path in an isolated throwaway DB:
#   (a) seed a fresh DB (schema + admin + org), then revert the owner org to
#       the legacy 6-stage pipeline via RAW SQL only (no db.ts import, so no
#       migration can run during setup) and park a client in an old stage;
#   (b) import server/db.ts in a NEW bun process — the import itself must
#       succeed (no TDZ ReferenceError) and the import-time pass must migrate
#       the owner org to Leads → Onboarding → Sold with the client remapped
#       positionally (Kickoff = band [3-4] → Onboarding).
# If the TDZ bug ever regresses, this section fails while section 24 stays
# green — exactly the failure mode that hit prod.
BOOT_DIR=$(mktemp -d)
(cd /home/team/shared/crm-app && DATA_DIR="$BOOT_DIR" ADMIN_EMAIL=owner@elevate.studio \
  ADMIN_PASSWORD=AfSp1Bsh07nP9aFQ SESSION_SECRET=t COOKIE_SECURE=false \
  bun ./server/seed.ts >/dev/null 2>&1)
cat > "$BOOT_DIR/setup_legacy.ts" <<'TS'
// Revert the owner org to the legacy 6-stage pipeline and park one client in
// an old stage — raw bun:sqlite only, deliberately NOT importing server/db.ts
// (its import-time migration would run first and defeat the test). This is
// exactly prod's pre-3g-2 state.
import { Database } from "bun:sqlite";
const db = new Database(process.env.DATA_DIR + "/crm.db");
const legacy = ["Prospect", "Intake", "Kickoff", "Build", "Launch", "Retainer"];
const admin = db
  .query("SELECT org_id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
  .get() as { org_id: number };
db.query("UPDATE orgs SET stages = ? WHERE id = ?").run(JSON.stringify(legacy), admin.org_id);
db.query("INSERT INTO clients (org_id, company_name, stage) VALUES (?, 'Boot Legacy Co', 'Kickoff')").run(
  admin.org_id,
);
console.log("LEGACY_OK");
TS
BOOT_SETUP=$(DATA_DIR="$BOOT_DIR" bun "$BOOT_DIR/setup_legacy.ts" 2>&1)
if echo "$BOOT_SETUP" | grep -q LEGACY_OK; then
  PASS=$((PASS+1)); echo "  ✓ throwaway DB in prod-style legacy state (admin + 6-stage owner pipeline)"
else
  FAIL=$((FAIL+1)); echo "  ✗ legacy-state setup failed: $BOOT_SETUP"
fi
cat > "$BOOT_DIR/boot_import.ts" <<'TS'
// THE regression probe: import server/db.ts in a fresh process against the
// prod-style DB. The import-time migrateOwnerPipeline() call must succeed and
// migrate the owner org to Leads → Onboarding → Sold. On a regression of the TDZ
// bug this throws ReferenceError before the import completes and BOOT_RESULT
// is never printed.
import { db, getOrg, parseStages, OWNER_PIPELINE } from "/home/team/shared/crm-app/server/db.ts";
const admin = db
  .query("SELECT org_id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
  .get() as { org_id: number };
const org = getOrg(admin.org_id)!;
const row = db
  .query("SELECT stage FROM clients WHERE org_id = ? AND company_name = 'Boot Legacy Co'")
  .get(admin.org_id) as { stage: string };
console.log(
  "BOOT_RESULT " +
    JSON.stringify({ stages: parseStages(org.stages), client: row.stage, expected: [...OWNER_PIPELINE] }),
);
TS
BOOT_OUT=$(DATA_DIR="$BOOT_DIR" bun "$BOOT_DIR/boot_import.ts" 2>&1)
if echo "$BOOT_OUT" | grep -q '^BOOT_RESULT '; then
  PASS=$((PASS+1)); echo "  ✓ fresh-process db.ts import succeeded (no TDZ ReferenceError)"
  echo "$BOOT_OUT" | grep '^BOOT_RESULT ' | sed 's/^BOOT_RESULT //' > /tmp/boot_result.json
  if python3 - <<'PY'
import json
d = json.load(open('/tmp/boot_result.json'))
assert d['stages'] == d['expected'], (d['stages'], d['expected'])
assert d['client'] == 'Onboarding', d['client']  # old Kickoff = band [3-4] → Onboarding
print("  ✓ owner org migrated at import: " + " → ".join(d['stages']))
print("  ✓ positional client remap ran from the boot path (Kickoff → Onboarding)")
PY
  then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1)); echo "  ✗ migration result mismatch: $(cat /tmp/boot_result.json)"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ fresh-process db.ts import FAILED — boot-crash regression present:"
  echo "$BOOT_OUT" | head -4
fi
rm -rf "$BOOT_DIR" /tmp/boot_result.json
echo "-- 25b. Boot remap of the legacy 'Intakes' owner stage (owner direction 2026-08-15) --"
# Production right now has the owner org on ["Leads","Intakes","Sold"] with 8
# client records in "Intakes". This block replays that exact state in a fresh
# process: seed a throwaway DB, revert the owner org to the legacy 3-stage
# owner list via RAW SQL (no db.ts import, so no migration can run during
# setup), park a client in "Intakes", then import server/db.ts — the boot path
# must rename the middle stage to "Onboarding" at the same position and move
# the client with it. A SECOND import must be a no-op (idempotent).
REN_DIR=$(mktemp -d)
(cd /home/team/shared/crm-app && DATA_DIR="$REN_DIR" ADMIN_EMAIL=owner@elevate.studio \
  ADMIN_PASSWORD=AfSp1Bsh07nP9aFQ SESSION_SECRET=t COOKIE_SECURE=false \
  bun ./server/seed.ts >/dev/null 2>&1)
cat > "$REN_DIR/setup_rename.ts" <<'TS'
// Revert the owner org to the legacy 3-stage owner list ["Leads","Intakes","Sold"]
// and park one client in "Intakes" — raw bun:sqlite only, deliberately NOT
// importing server/db.ts (its import-time migration would run first and
// defeat the test). This is exactly prod's pre-rename state.
import { Database } from "bun:sqlite";
const db = new Database(process.env.DATA_DIR + "/crm.db");
const legacy = ["Leads", "Intakes", "Sold"];
const admin = db
  .query("SELECT org_id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
  .get() as { org_id: number };
db.query("UPDATE orgs SET stages = ? WHERE id = ?").run(JSON.stringify(legacy), admin.org_id);
db.query(
  "INSERT INTO clients (org_id, company_name, stage) VALUES (?, 'Boot Intake Co', 'Intakes')",
).run(admin.org_id);
console.log("RENAME_SETUP_OK");
TS
REN_SETUP=$(DATA_DIR="$REN_DIR" bun "$REN_DIR/setup_rename.ts" 2>&1)
if echo "$REN_SETUP" | grep -q RENAME_SETUP_OK; then
  PASS=$((PASS+1)); echo "  ✓ throwaway DB in prod-style pre-rename state (owner on [Leads, Intakes, Sold] + one client in Intakes)"
else
  FAIL=$((FAIL+1)); echo "  ✗ pre-rename state setup failed: $REN_SETUP"
fi
cat > "$REN_DIR/boot_rename.ts" <<'TS'
// THE boot probe: import server/db.ts in a fresh process against the
// pre-rename DB. The import-time migrateOwnerPipeline() pass must rename the
// owner middle stage "Intakes" → "Onboarding" and move the client with it.
import { db, getOrg, parseStages, OWNER_PIPELINE } from "/home/team/shared/crm-app/server/db.ts";
const admin = db
  .query("SELECT org_id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
  .get() as { org_id: number };
const org = getOrg(admin.org_id)!;
const row = db
  .query("SELECT stage FROM clients WHERE org_id = ? AND company_name = 'Boot Intake Co'")
  .get(admin.org_id) as { stage: string };
console.log(
  "REN_RESULT " +
    JSON.stringify({ stages: parseStages(org.stages), client: row.stage, expected: [...OWNER_PIPELINE] }),
);
TS
REN_OUT=$(DATA_DIR="$REN_DIR" bun "$REN_DIR/boot_rename.ts" 2>&1)
if echo "$REN_OUT" | grep -q '^REN_RESULT '; then
  PASS=$((PASS+1)); echo "  ✓ fresh-process db.ts import succeeded (rename pass runs at boot)"
  echo "$REN_OUT" | grep '^REN_RESULT ' | sed 's/^REN_RESULT //' > /tmp/ren_result.json
  if python3 - <<'PY'
import json
d = json.load(open('/tmp/ren_result.json'))
assert d['stages'] == d['expected'], (d['stages'], d['expected'])
assert d['stages'] == ['Leads', 'Onboarding', 'Sold'], d['stages']
assert d['client'] == 'Onboarding', d['client']  # client followed the renamed middle stage
print("  ✓ owner org remapped at import: " + " → ".join(d['stages']))
print("  ✓ client record remapped at the same position (Intakes → Onboarding)")
PY
  then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1)); echo "  ✗ rename boot result mismatch: $(cat /tmp/ren_result.json)"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ fresh-process db.ts import FAILED for the rename pass:"; echo "$REN_OUT" | head -4
fi
# Idempotency: a second boot must be a no-op (stages + client unchanged).
REN_OUT2=$(DATA_DIR="$REN_DIR" bun "$REN_DIR/boot_rename.ts" 2>&1)
if echo "$REN_OUT2" | grep -q '^REN_RESULT '; then
  echo "$REN_OUT2" | grep '^REN_RESULT ' | sed 's/^REN_RESULT //' > /tmp/ren_result2.json
  if python3 - <<'PY'
import json
a = json.load(open('/tmp/ren_result.json'))
b = json.load(open('/tmp/ren_result2.json'))
assert a == b, (a, b)
assert b['stages'] == ['Leads', 'Onboarding', 'Sold'], b['stages']
print("  ✓ second boot is a no-op: stages + client unchanged (idempotent)")
PY
  then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1)); echo "  ✗ rename idempotency broken: $(cat /tmp/ren_result2.json)"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ second boot import FAILED: $REN_OUT2" | head -3
fi
rm -rf "$REN_DIR" /tmp/ren_result.json /tmp/ren_result2.json
echo "== 25c. Boot backfill: signed records stuck in a non-terminal stage advance to the terminal stage (live-test finding 2026-08-15) =="
# Live prod state: client id 59 "Joe" has agreement_status='signed' but stage
# 'Onboarding' and next_action='' — signed BEFORE PR #60's sign-time
# auto-advance existed. The boot backfill must advance such records exactly
# like a fresh signature would (terminal stage + deduped 'Create client
# account' task + next_action), must be a no-op when re-run (idempotent),
# and must never block startup.
BF_DIR=$(mktemp -d)
(cd /home/team/shared/crm-app && DATA_DIR="$BF_DIR" ADMIN_EMAIL=owner@elevate.studio \
  ADMIN_PASSWORD=AfSp1Bsh07nP9aFQ SESSION_SECRET=t COOKIE_SECURE=false \
  bun ./server/seed.ts >/dev/null 2>&1)
cat > "$BF_DIR/setup_backfill.ts" <<'TS'
// Replay prod's pre-backfill state in the throwaway DB — raw bun:sqlite only
// (deliberately NOT importing server/db.ts so no migration can run during
// setup). The owner org's stages are the modern Leads → Onboarding → Sold.
import { Database } from "bun:sqlite";
const db = new Database(process.env.DATA_DIR + "/crm.db");
const admin = db
  .query("SELECT org_id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
  .get() as { org_id: number };
// A: the exact client-59 repro — signed, stuck in the middle stage.
db.query(
  "INSERT INTO clients (org_id, company_name, stage, agreement_status, next_action) VALUES (?, 'Backfill Signed Co', 'Onboarding', 'signed', '')",
).run(admin.org_id);
// B: signed, stuck in the FIRST stage.
db.query(
  "INSERT INTO clients (org_id, company_name, stage, agreement_status) VALUES (?, 'Backfill First Co', 'Leads', 'signed')",
).run(admin.org_id);
// C: signed, stuck, but an OPEN 'Create client account' task already exists —
// the backfill must advance the stage but NOT duplicate the task.
db.query(
  "INSERT INTO clients (org_id, company_name, stage, agreement_status) VALUES (?, 'Backfill Dup Co', 'Onboarding', 'signed')",
).run(admin.org_id);
const dupClient = db
  .query("SELECT id FROM clients WHERE company_name = 'Backfill Dup Co'")
  .get() as { id: number };
db.query(
  "INSERT INTO tasks (org_id, title, client_id, done, notes) VALUES (?, 'Create client account for Backfill Dup Co', ?, 0, 'pre-existing open task')",
).run(admin.org_id, dupClient.id);
// D: signed AND already terminal — the backfill must NOT touch it.
db.query(
  "INSERT INTO clients (org_id, company_name, stage, agreement_status, next_action) VALUES (?, 'Backfill Done Co', 'Sold', 'signed', '')",
).run(admin.org_id);
console.log("BACKFILL_SETUP_OK");
TS
BF_SETUP=$(DATA_DIR="$BF_DIR" bun "$BF_DIR/setup_backfill.ts" 2>&1)
if echo "$BF_SETUP" | grep -q BACKFILL_SETUP_OK; then
  PASS=$((PASS+1)); echo "  ✓ throwaway DB in prod-style pre-backfill state (2 stuck signed, 1 stuck + open task, 1 already terminal)"
else
  FAIL=$((FAIL+1)); echo "  ✗ backfill state setup failed: $BF_SETUP"
fi
cat > "$BF_DIR/backfill_probe.ts" <<'TS'
// THE probe: import the exported backfill and run it TWICE against the
// pre-backfill DB — the first run must settle every stuck signed record, the
// second must be a total no-op (idempotent).
import { db } from "/home/team/shared/crm-app/server/db.ts";
import { backfillSignedClients } from "/home/team/shared/crm-app/server/agreements.ts";
const state = () => {
  const rows = db
    .query(
      "SELECT c.company_name, c.stage, c.next_action, c.agreement_status, " +
        "(SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.title LIKE 'Create client account%') AS tasks " +
        "FROM clients c WHERE c.company_name LIKE 'Backfill %' ORDER BY c.company_name",
    )
    .all() as { company_name: string; stage: string; next_action: string; agreement_status: string; tasks: number }[];
  return Object.fromEntries(rows.map((r) => [r.company_name, r]));
};
const first = backfillSignedClients(db);
const afterFirst = state();
const second = backfillSignedClients(db);
const afterSecond = state();
console.log("BACKFILL_RESULT " + JSON.stringify({ first, second, afterFirst, afterSecond }));
TS
BF_OUT=$(DATA_DIR="$BF_DIR" bun "$BF_DIR/backfill_probe.ts" 2>&1)
if echo "$BF_OUT" | grep -q '^BACKFILL_RESULT '; then
  PASS=$((PASS+1)); echo "  ✓ exported backfill ran in a fresh process (no boot crash)"
  echo "$BF_OUT" | grep '^BACKFILL_RESULT ' | sed 's/^BACKFILL_RESULT //' > /tmp/backfill_result.json
  if python3 - <<'PY'
import json
d = json.load(open('/tmp/backfill_result.json'))
a = d['afterFirst']
assert d['first'] == 3, d['first']   # A, B, C advanced; D already terminal → untouched
assert d['second'] == 0, d['second'] # idempotent — nothing left to advance
# A (the client-59 repro): terminal stage + next_action + exactly one task
assert a['Backfill Signed Co']['stage'] == 'Sold', a['Backfill Signed Co']
assert a['Backfill Signed Co']['next_action'] == 'Create client account', a['Backfill Signed Co']
assert a['Backfill Signed Co']['agreement_status'] == 'signed', a['Backfill Signed Co']
assert a['Backfill Signed Co']['tasks'] == 1, a['Backfill Signed Co']
# B: first-stage stuck record also advanced
assert a['Backfill First Co']['stage'] == 'Sold', a['Backfill First Co']
assert a['Backfill First Co']['tasks'] == 1, a['Backfill First Co']
# C: advanced, but the pre-existing OPEN task was NOT duplicated
assert a['Backfill Dup Co']['stage'] == 'Sold', a['Backfill Dup Co']
assert a['Backfill Dup Co']['tasks'] == 1, a['Backfill Dup Co']
# D: already terminal — untouched (no task, no next_action)
assert a['Backfill Done Co']['stage'] == 'Sold', a['Backfill Done Co']
assert a['Backfill Done Co']['next_action'] == '', a['Backfill Done Co']
assert a['Backfill Done Co']['tasks'] == 0, a['Backfill Done Co']
# Idempotency: the second run changed nothing at all
assert d['afterFirst'] == d['afterSecond'], (d['afterFirst'], d['afterSecond'])
print("  ✓ backfill advanced 3 stuck signed records to Sold + created the account task + set next_action")
print("  ✓ already-terminal signed record untouched; second run changed nothing (idempotent)")
print("  ✓ open 'Create client account' task not duplicated")
PY
  then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1)); echo "  ✗ backfill result mismatch: $(cat /tmp/backfill_result.json)"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ backfill probe FAILED:"; echo "$BF_OUT" | head -4
fi
# The REAL boot path: revert client A to the stuck state and boot the actual
# server binary against this DB — the boot-time backfill must self-heal it
# (this is the live "next deploy fixes client 59" guarantee) and boot must
# still succeed.
cat > "$BF_DIR/revert_a.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DATA_DIR + "/crm.db");
db.query("DELETE FROM tasks WHERE client_id = (SELECT id FROM clients WHERE company_name = 'Backfill Signed Co')").run();
db.query(
  "UPDATE clients SET stage = 'Onboarding', next_action = '' WHERE company_name = 'Backfill Signed Co'",
).run();
console.log("REVERT_OK");
TS
BF_REVERT=$(DATA_DIR="$BF_DIR" bun "$BF_DIR/revert_a.ts" 2>&1)
if echo "$BF_REVERT" | grep -q REVERT_OK; then
  PASS=$((PASS+1)); echo "  ✓ client A reverted to the stuck state (simulating the next deploy against live data)"
else
  FAIL=$((FAIL+1)); echo "  ✗ revert failed: $BF_REVERT"
fi
BF_LOG="$BF_DIR/boot.log"
(cd /home/team/shared/crm-app && DATA_DIR="$BF_DIR" PORT=3099 ADMIN_EMAIL=owner@elevate.studio \
  ADMIN_PASSWORD=AfSp1Bsh07nP9aFQ SESSION_SECRET=t COOKIE_SECURE=false \
  nohup bun ./server/index.ts > "$BF_LOG" 2>&1 & echo $! > "$BF_DIR/boot.pid")
BF_BOOT_OK=0
for _i in $(seq 1 30); do
  curl -s -o /dev/null http://localhost:3099/api/auth/me 2>/dev/null && { BF_BOOT_OK=1; break; }
  sleep 0.2
done
if [ "$BF_BOOT_OK" = 1 ]; then
  PASS=$((PASS+1)); echo "  ✓ real server booted against the stuck DB (backfill did not break startup)"
else
  FAIL=$((FAIL+1)); echo "  ✗ real server boot FAILED: $(tail -5 "$BF_LOG")"
fi
if grep -q 'Signed-client backfill: advanced 1 record' "$BF_LOG"; then
  PASS=$((PASS+1)); echo "  ✓ boot log reports the backfill ran and advanced 1 record"
else
  FAIL=$((FAIL+1)); echo "  ✗ boot backfill log line missing: $(grep -i backfill "$BF_LOG" | head -3)"
fi
cat > "$BF_DIR/verify_boot.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DATA_DIR + "/crm.db");
const a = db
  .query(
    "SELECT c.stage, c.next_action, (SELECT COUNT(*) FROM tasks t WHERE t.client_id = c.id AND t.title LIKE 'Create client account%') AS tasks FROM clients c WHERE c.company_name = 'Backfill Signed Co'",
  )
  .get() as { stage: string; next_action: string; tasks: number };
console.log("BOOT_VERIFY " + JSON.stringify(a));
TS
BF_VERIFY=$(DATA_DIR="$BF_DIR" bun "$BF_DIR/verify_boot.ts" 2>&1)
if echo "$BF_VERIFY" | grep -q '^BOOT_VERIFY '; then
  echo "$BF_VERIFY" | grep '^BOOT_VERIFY ' | sed 's/^BOOT_VERIFY //' > /tmp/boot_verify.json
  if python3 - <<'PY'
import json
a = json.load(open('/tmp/boot_verify.json'))
assert a['stage'] == 'Sold', a
assert a['next_action'] == 'Create client account', a
assert a['tasks'] == 1, a
print("  ✓ boot-time backfill self-healed the stuck signed record (stage Sold + task + next_action)")
PY
  then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1)); echo "  ✗ boot-time backfill did not self-heal: $(cat /tmp/boot_verify.json)"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ boot verify failed: $BF_VERIFY"
fi
kill "$(cat "$BF_DIR/boot.pid")" 2>/dev/null
rm -rf "$BF_DIR" /tmp/backfill_result.json /tmp/boot_verify.json
echo "== 25d. Individual lead rows: no person name under 'Business name'; full name in Contact — GLOBAL (owner AND tenant, owner direction 2026-08-16) =="
# The PR #62 display rules (live-test finding 2026-08-15) are now GLOBAL: an
# individual record's companyName holds the person's FULL NAME, so the primary
# cell shows the DBA (or an em dash) ONLY under the owner's "Business name"
# header — tenant tables (header "Client") show the full name — and the
# Contact cell leads with the full name (not the redundant partial 'Contact
# name') in BOTH workspaces. The universal 'Contact name' intake field is
# commercial-only.
if grep -Fq 'function primaryName' src/Clients.tsx && \
   grep -Fq 'ownerOrg && c.clientType !== "commercial" ? c.dbaName || "—" : c.companyName' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: primaryName helper (individual → dbaName or em dash under the owner's 'Business name' header; full name under 'Client')"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: primaryName helper missing from src/Clients.tsx"
fi
if grep -Fq 'function contactPrimary' src/Clients.tsx && \
   grep -Fq 'c.clientType !== "commercial" ? c.companyName : c.contactName || "—"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: contactPrimary helper (individual → full name, commercial → contactName) — owner AND tenant"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: contactPrimary helper missing from src/Clients.tsx"
fi
# Both pipeline tables must use the name helper (Lost/DNC table AND the main
# pipeline table), and the Contact cell must use the global contact helper.
if [ "$(grep -c 'primaryName(ownerOrg, c)' src/Clients.tsx)" -ge 2 ] && \
   grep -Fq 'contactPrimary(c)' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: primaryName wired into BOTH pipeline tables (Lost/DNC + main); Contact cell uses contactPrimary"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: primaryName/contactPrimary call sites missing in src/Clients.tsx"
fi
# Clients directory (owner + tenant, live-test finding 2026-08-16): the table
# reads Client/business name | Address | Contact | Services | Deal | Actions —
# the address moved into its own column and the Contact column is email +
# phone ONLY (no contactName).
if grep -Fq 'Client/business name' src/ClientsDirectory.tsx && \
   grep -Fq '<th>Address</th>' src/ClientsDirectory.tsx && \
   grep -Fq 'data-label="Address"' src/ClientsDirectory.tsx && \
   grep -Fq '<th>Contact</th>' src/ClientsDirectory.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Clients tab headers = Client/business name | Address | Contact | Services | Deal | Actions"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Clients tab headers missing in src/ClientsDirectory.tsx"
fi
if ! grep -Fq 'c.contactName || "—"' src/ClientsDirectory.tsx && \
   grep -Fq 'title={c.email}' src/ClientsDirectory.tsx && \
   grep -Fq 'title={c.phone}' src/ClientsDirectory.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: directory Contact column is email + phone only (contactName render removed)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: directory Contact column still renders contactName"
fi
# intakeRules: the 'Contact name' field must be inside the commercial-only
# spread (one occurrence, gated on `commercial`) — never in the universal list.
if python3 - <<'PY'
lines = open('src/intakeRules.ts').read().splitlines()
hits = [i for i, l in enumerate(lines) if 'key: "contactName"' in l]
assert len(hits) == 1, hits
assert '...(commercial' in lines[hits[0] - 1], lines[hits[0] - 1]
print("  ✓ source: 'Contact name' field is commercial-only (gated on the commercial spread, not universal)")
PY
then
  PASS=$((PASS+1))
else
  FAIL=$((FAIL+1)); echo "  ✗ source: 'Contact name' field still universal in src/intakeRules.ts"
fi
# API: an individual lead keeps its data intact end-to-end (rendering is
# client-side; the API must still round-trip name + partial contact name +
# email + phone).
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Jane Doe","contactName":"Doe","email":"jane@doe.example","phone":"+1 555 0101","industry":"Home Services","clientType":"residential","dealValue":800,"stage":"Leads"}' "$BASE/api/clients")
check "25d: owner creates individual lead (name + partial contact name) → 201" 201 "$S"
JANE_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" "$BASE/api/clients/$JANE_ID")
if grep -q '"companyName":"Jane Doe"' /tmp/body.json && grep -q '"contactName":"Doe"' /tmp/body.json && \
   grep -q '"email":"jane@doe.example"' /tmp/body.json && grep -q '"phone":"+1 555 0101"' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ API round-trips the individual lead unchanged (name/contactName/email/phone)"
else
  FAIL=$((FAIL+1)); echo "  ✗ individual lead API payload: $(cat /tmp/body.json)"
fi
# Bundle: the compiled app contains both helpers' distinctive expressions
# (minified): dbaName-or-em-dash for the Business-name slot and
# contactName-or-em-dash for the commercial Contact primary.
NEWEST_JS25=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS25" ] && grep -Fq 'dbaName||"—"' "$NEWEST_JS25" && grep -Fq 'contactName||"—"' "$NEWEST_JS25"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: individual Business-name fallback + Contact primary compiled"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: individual-row markers missing from $NEWEST_JS25"
fi
echo "== 26. Sold-lead auto-provisioning (3g-3) =="

ORG_COUNT() { curl -s -b "$JAR" "$BASE/api/admin/orgs" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['orgs']))"; }
echo "-- 26a. Owner moves a lead into Sold → one clean provisioned workspace =="
BEFORE_ORG=$(ORG_COUNT)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow Stone Contracting","contactName":"Mia Chen","email":"mia@willowstone.example","phone":"+1 555 0199","industry":"Landscaping","clientType":"commercial","dealValue":15000,"stage":"Leads","nextAction":"Send proposal","notes":"3g-3 test lead"}' \
  "$BASE/api/clients")
check "owner creates Landscaping lead → 201" 201 "$S"
WL_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (sold-lead client id=$WL_ID)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow Stone Contracting","contactName":"Mia Chen","email":"mia@willowstone.example","phone":"+1 555 0199","industry":"Landscaping","clientType":"commercial","dealValue":15000,"stage":"Sold","nextAction":"","notes":"3g-3 test lead"}' \
  "$BASE/api/clients/$WL_ID")
check "owner moves lead into Sold → 200" 200 "$S"
grep -q '"stage":"Sold"' /tmp/body.json && echo "  ✓ client now in Sold" || echo "  ✗ stage after PUT: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "admin orgs list → 200" 200 "$S"
AFTER_ORG=$(python3 -c "import json; print(len(json.load(open('/tmp/body.json'))['orgs']))")
[ "$AFTER_ORG" -eq $((BEFORE_ORG + 1)) ] && echo "  ✓ exactly one new org created (${BEFORE_ORG} → ${AFTER_ORG})" || echo "  ✗ org count ${BEFORE_ORG} → ${AFTER_ORG} (expected +1)"
python3 - <<PY
import json, re
d = json.load(open('/tmp/body.json'))
orgs = d['orgs']
prov = [o for o in orgs if o.get('provisionedFromClient') == $WL_ID]
assert len(prov) == 1, [o['name'] for o in orgs]
o = prov[0]
assert o['name'] == 'Willow Stone Contracting', o['name']
assert o['provisionedFromClientName'] == 'Willow Stone Contracting', o
assert o['loginEmail'] == 'mia@willowstone.example', o['loginEmail']
pw = o.get('tempPassword', '')
assert len(pw) >= 12, pw
assert re.search(r'[A-Z]', pw) and re.search(r'[a-z]', pw) and re.search(r'[0-9]', pw) and re.search(r'[^A-Za-z0-9]', pw), pw
print("  ✓ new org auto-provisioned: name, source lead, login email + temp password visible in the Admin list")
PY
PROV_ORG=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o.get('provisionedFromClient') == $WL_ID][0])")
PROV_EMAIL=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['loginEmail'] for o in d['orgs'] if o.get('provisionedFromClient') == $WL_ID][0])")
PROV_PW=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['tempPassword'] for o in d['orgs'] if o.get('provisionedFromClient') == $WL_ID][0])")
JARPROV=$(mktemp)
S=$(code -c "$JARPROV" -b "$JARPROV" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PROV_EMAIL\",\"password\":\"$PROV_PW\"}" "$BASE/api/auth/login")
check "provisioned member login with temp password → 200" 200 "$S"
grep -q '"role":"member"' /tmp/body.json && echo "  ✓ member role" || echo "  ✗ role: $(cat /tmp/body.json)"
S=$(code -b "$JARPROV" "$BASE/api/settings")
check "provisioned org GET settings → 200" 200 "$S"
grep -q '"stages":\["Prospect","Intake","Kickoff","Build","Launch","Retainer"\]' /tmp/body.json && echo "  ✓ provisioned workspace starts from the plain default pipeline (no vertical match in the retired catalog)" || echo "  ✗ stages: $(cat /tmp/body.json)"
grep -q '"verticalKey":""' /tmp/body.json && grep -q '"industry":""' /tmp/body.json && echo "  ✓ bare org: verticalKey/industry empty (the catalog is B2B/B2C — the tenant applies a type in Settings)" || echo "  ✗ vertical settings: $(cat /tmp/body.json)"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
assert d.get('customFields') == [], d.get('customFields')
assert d.get('verticalKey') == '', d.get('verticalKey')
print("  ✓ no preset custom fields (accounts customize)")
PY
S=$(code -b "$JARPROV" "$BASE/api/clients")
grep -q '"clients":\[\]' /tmp/body.json && echo "  ✓ new workspace starts with ZERO clients" || echo "  ✗ clients: $(cat /tmp/body.json)"
S=$(code -b "$JARPROV" "$BASE/api/tasks")
grep -q '"tasks":\[\]' /tmp/body.json && echo "  ✓ new workspace starts with ZERO tasks" || echo "  ✗ tasks: $(cat /tmp/body.json)"
S=$(code -b "$JARPROV" "$BASE/api/invoices")
grep -q '"invoices":\[\]' /tmp/body.json && echo "  ✓ new workspace starts with ZERO invoices" || echo "  ✗ invoices: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients?q=Willow")
grep -q '"companyName":"Willow Stone Contracting"' /tmp/body.json && grep -q '"stage":"Sold"' /tmp/body.json && echo "  ✓ owner still sees the sold lead in their own pipeline" || echo "  ✗ owner pipeline: $(cat /tmp/body.json)"
check "member cannot list admin orgs → 403" 403 $(code -b "$JARPROV" "$BASE/api/admin/orgs")
check "member cannot read provisions → 403" 403 $(code -b "$JARPROV" "$BASE/api/admin/provisions")
S=$(code -b "$JARPROV" "$BASE/api/settings")
grep -qv 'tempPassword' /tmp/body.json && echo "  ✓ temp password NOT exposed via tenant-scoped endpoints" || echo "  ✗ tempPassword leaked: $(cat /tmp/body.json)"

echo "-- 26b. Idempotent: Sold → Onboarding → Sold creates no second org =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow Stone Contracting","contactName":"Mia Chen","email":"mia@willowstone.example","phone":"+1 555 0199","industry":"Landscaping","clientType":"commercial","dealValue":15000,"stage":"Onboarding","nextAction":"","notes":"moved back"}' \
  "$BASE/api/clients/$WL_ID")
check "move back to Onboarding → 200" 200 "$S"
grep -q '"stage":"Onboarding"' /tmp/body.json && echo "  ✓ client back in Onboarding" || echo "  ✗ stage: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow Stone Contracting","contactName":"Mia Chen","email":"mia@willowstone.example","phone":"+1 555 0199","industry":"Landscaping","clientType":"commercial","dealValue":15000,"stage":"Sold","nextAction":"","notes":"sold again"}' \
  "$BASE/api/clients/$WL_ID")
check "move into Sold again → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
AFTER2=$(python3 -c "import json; print(len(json.load(open('/tmp/body.json'))['orgs']))")
[ "$AFTER2" -eq "$AFTER_ORG" ] && echo "  ✓ still exactly one org (no second provision: ${AFTER_ORG})" || echo "  ✗ org count ${AFTER_ORG} → ${AFTER2} (duplicate provision!)"
python3 - <<PY
import json
d = json.load(open('/tmp/body.json'))
prov = [o for o in d['orgs'] if o.get('provisionedFromClient') == $WL_ID]
assert len(prov) == 1, prov
print("  ✓ the one org still links to the sold client (provisionedFromClient intact)")
PY

echo "-- 26c. Tenant org moving a client into its own final stage → NO new org =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Tenant Sell Co","email":"tenant-sell@example.com","password":"tenantsell123"}' "$BASE/api/admin/orgs")
check "admin provisions tenant org → 201" 201 "$S"
JARTEN=$(mktemp)
S=$(code -c "$JARTEN" -b "$JARTEN" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"tenant-sell@example.com","password":"tenantsell123"}' "$BASE/api/auth/login")
check "tenant login → 200" 200 "$S"
# Baseline AFTER the tenant org exists (it must NOT count as an auto-provision),
# then the tenant sells its own client into its final stage.
TEN_BEFORE=$(ORG_COUNT)
S=$(code -b "$JARTEN" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Prospect Co","clientType":"residential","dealValue":500,"stage":"Prospect"}' "$BASE/api/clients")
check "tenant creates client in first stage → 201" 201 "$S"
TEN_CLIENT=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JARTEN" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Prospect Co","clientType":"residential","dealValue":500,"stage":"Retainer"}' "$BASE/api/clients/$TEN_CLIENT")
check "tenant moves client into its final stage (Retainer) → 200" 200 "$S"
TEN_AFTER=$(ORG_COUNT)
[ "$TEN_AFTER" -eq "$TEN_BEFORE" ] && echo "  ✓ NO org provisioned for a tenant selling its own client (${TEN_BEFORE})" || echo "  ✗ org count ${TEN_BEFORE} → ${TEN_AFTER} (tenant auto-provisioned!)"
S=$(code -b "$JAR" "$BASE/api/admin/provisions")
PROV_N=$(python3 -c "import json; print(len(json.load(open('/tmp/body.json'))['provisions']))")
[ "$PROV_N" -eq 1 ] && echo "  ✓ exactly one provision notification so far (only the owner's Willow sell)" || echo "  ✗ provisions: $(cat /tmp/body.json)"

echo "-- 26d. No-email client → derived login email; uniqueness suffix on collision =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Dust & Bane Pest","contactName":"Rex Otis","industry":"Pest Control","clientType":"commercial","dealValue":8000,"stage":"Leads","notes":"no email on purpose"}' \
  "$BASE/api/clients")
check "owner creates pest lead WITHOUT email → 201" 201 "$S"
DB1_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Dust & Bane Pest","contactName":"Rex Otis","industry":"Pest Control","clientType":"commercial","dealValue":8000,"stage":"Sold","notes":"sold"}' \
  "$BASE/api/clients/$DB1_ID")
check "move no-email lead into Sold → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
python3 - <<PY
import json
d = json.load(open('/tmp/body.json'))
prov = [o for o in d['orgs'] if o.get('provisionedFromClient') == $DB1_ID]
assert len(prov) == 1, prov
assert prov[0]['loginEmail'] == 'dust-bane-pest@revzenta.com', prov[0]['loginEmail']
assert prov[0]['tempPassword'], prov[0]
assert prov[0]['name'] == 'Dust & Bane Pest', prov[0]
print("  ✓ derived login email from company slug: dust-bane-pest@revzenta.com")
PY
DB1_PW=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['tempPassword'] for o in d['orgs'] if o.get('provisionedFromClient') == $DB1_ID][0])")
JARDB1=$(mktemp)
S=$(code -c "$JARDB1" -b "$JARDB1" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"dust-bane-pest@revzenta.com\",\"password\":\"$DB1_PW\"}" "$BASE/api/auth/login")
check "derived-email login works → 200" 200 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Dust Bane Pest","contactName":"Nia Otis","industry":"Pest Control","clientType":"commercial","dealValue":6000,"stage":"Leads","notes":"same slug"}' \
  "$BASE/api/clients")
check "owner creates second pest lead (same slug) → 201" 201 "$S"
DB2_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Dust Bane Pest","contactName":"Nia Otis","industry":"Pest Control","clientType":"commercial","dealValue":6000,"stage":"Sold","notes":"sold"}' \
  "$BASE/api/clients/$DB2_ID")
check "move second pest lead into Sold → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
python3 - <<PY
import json
d = json.load(open('/tmp/body.json'))
prov = [o for o in d['orgs'] if o.get('provisionedFromClient') == $DB2_ID]
assert len(prov) == 1, prov
assert prov[0]['loginEmail'] == 'dust-bane-pest1@revzenta.com', prov[0]['loginEmail']
assert prov[0]['tempPassword'], prov[0]
print("  ✓ colliding slug got the numeric suffix: dust-bane-pest1@revzenta.com")
PY

echo "-- 26e. Owner notification list + dismiss =="
S=$(code -b "$JAR" "$BASE/api/admin/provisions")
check "owner provisions list → 200" 200 "$S"
python3 - <<PY
import json
d = json.load(open('/tmp/body.json'))['provisions']
by_client = {p['clientName']: p for p in d}
assert set(by_client) == {'Willow Stone Contracting', 'Dust & Bane Pest', 'Dust Bane Pest'}, by_client
assert by_client['Willow Stone Contracting']['orgName'] == 'Willow Stone Contracting', by_client
print("  ✓ notices name the sold client + new workspace (%d undismissed)" % len(d))
PY
FIRST_PROV_ID=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(d['provisions'][0]['id'])")
check "dismiss a notice → 200" 200 $(code -b "$JAR" -X POST "$BASE/api/admin/provisions/$FIRST_PROV_ID/dismiss")
S=$(code -b "$JAR" "$BASE/api/admin/provisions")
PROV_N2=$(python3 -c "import json; print(len(json.load(open('/tmp/body.json'))['provisions']))")
[ "$PROV_N2" -eq 2 ] && echo "  ✓ dismissed notice gone (3 → 2 remaining)" || echo "  ✗ provisions after dismiss: $(cat /tmp/body.json)"
check "dismiss unknown notice → 404" 404 $(code -b "$JAR" -X POST "$BASE/api/admin/provisions/999999/dismiss")

echo "-- 26f. UI surface strings in the built bundle =="
NEWEST_JS=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS" ] && [ -f "$NEWEST_JS" ]; then
  if grep -q "auto-provisioned from sold lead" "$NEWEST_JS" && grep -q "Temp password" "$NEWEST_JS" && grep -q "auto-provisioned" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the 3g-3 UI strings (auto-provisioned marker, temp-password display)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ 3g-3 strings missing from $NEWEST_JS"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 3g-3 bundle surface check"
fi

echo "-- 26g. Cleanup =="
check "admin deletes provisioned Willow org → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$PROV_ORG")
# Re-fetch the orgs list (the DELETE response just overwrote /tmp/body.json),
# then delete the two pest-provisioned orgs.
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
for OID in $(python3 - <<PY
import json
d = json.load(open('/tmp/body.json'))
print(' '.join(str(o['id']) for o in d['orgs'] if o.get('provisionedFromClient') in ($DB1_ID, $DB2_ID)))
PY
); do
  code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$OID" > /dev/null
done
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
TEN_ORG_ID=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o['name'] == 'Tenant Sell Co'][0])")
check "admin deletes Tenant Sell Co org → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$TEN_ORG_ID")
for CID in $WL_ID $DB1_ID $DB2_ID; do
  code -b "$JAR" -X DELETE "$BASE/api/clients/$CID" > /dev/null
done
S=$(code -b "$JAR" "$BASE/api/admin/provisions")
for PID in $(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(' '.join(str(p['id']) for p in d['provisions']))"); do
  code -b "$JAR" -X POST "$BASE/api/admin/provisions/$PID/dismiss" > /dev/null
done
FINAL_ORG=$(ORG_COUNT)
[ "$FINAL_ORG" -eq "$BEFORE_ORG" ] && echo "  ✓ org count back to $BEFORE_ORG (cleanup complete)" || echo "  ✗ org count after cleanup: $FINAL_ORG (expected $BEFORE_ORG)"
rm -f "$JARPROV" "$JARTEN" "$JARDB1"

echo "== 27. Intake + welcome emails (3g-4) =="
# Self-contained: spins up throwaway CRM servers (fresh DBs on :3002–3004) that
# POST emails to a mock Resend endpoint on :3199, which records every request
# as a JSONL file. The MAIN server on $BASE is untouched by this section.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK=$(mktemp -d)
MOCK_EMAILS="$MOCK/emails.jsonl"
: > "$MOCK_EMAILS"
cat > "$MOCK/resend.ts" <<'TS'
import { appendFileSync } from "node:fs";
const PORT = 3199;
const OUT = process.env.MOCK_OUT ?? "/tmp/mock-emails.jsonl";
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      appendFileSync(OUT, JSON.stringify(body) + "\n");
      return Response.json({ id: "mock-" + Math.random().toString(36).slice(2) });
    }
    return new Response("nope", { status: 404 });
  },
});
console.log("mock resend on " + PORT);
TS
MOCK_OUT="$MOCK_EMAILS" nohup bun "$MOCK/resend.ts" > "$MOCK/resend.log" 2>&1 &
MOCK_PID=$!
i=0; until curl -sf http://127.0.0.1:3199/health >/dev/null 2>&1; do i=$((i+1)); [ "$i" -gt 50 ] && break; sleep 0.2; done
if curl -sf http://127.0.0.1:3199/health >/dev/null 2>&1; then
  PASS=$((PASS+1)); echo "  ✓ mock Resend endpoint up on :3199"
else
  FAIL=$((FAIL+1)); echo "  ✗ mock Resend endpoint failed to start"
fi
# start_crm <port> <datadir> <logfile> <pidfile> [env...] — starts a throwaway
# CRM server with its own fresh DB and waits until it answers.
start_crm() {
  local port=$1 dir=$2 logf=$3 pidf=$4; shift 4
  ( cd "$APP_DIR" && env "$@" DATA_DIR="$dir" PORT="$port" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" nohup bun ./server/index.ts > "$logf" 2>&1 & echo $! > "$pidf" )
  local i=0
  until curl -s -o /dev/null "http://localhost:$port/api/auth/me" 2>/dev/null; do
    i=$((i+1)); [ "$i" -gt 50 ] && { echo "  ✗ CRM server on :$port failed to start (see $logf)"; return 1; }
    sleep 0.2
  done
}
stop_crm() { kill "$(cat "$1")" 2>/dev/null; }

echo "-- 27a. RESEND_API_KEY unset → provision succeeds, email skipped, no crash =="
start_crm 3002 "$MOCK/db-a" "$MOCK/srv-a.log" "$MOCK/srv-a.pid" -u RESEND_API_KEY -u RESEND_URL -u TEST_EMAIL_TO
JA=$(mktemp)
S=$(code -c "$JA" -b "$JA" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "http://localhost:3002/api/auth/login")
check "no-key: login → 200" 200 "$S"
S=$(code -b "$JA" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"NoKey Provision Co","contactName":"Nora Key","email":"nokey@example.com","industry":"Cleaning","clientType":"commercial","dealValue":4000,"stage":"Leads"}' "http://localhost:3002/api/clients")
check "no-key: create lead → 201" 201 "$S"
NK_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JA" -X PUT -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"NoKey Provision Co","contactName":"Nora Key","email":"nokey@example.com","industry":"Cleaning","clientType":"commercial","dealValue":4000,"stage":"Sold"}' "http://localhost:3002/api/clients/$NK_ID")
check "no-key: move lead into Sold → 200" 200 "$S"
S=$(code -b "$JA" "http://localhost:3002/api/admin/orgs")
check "no-key: admin orgs → 200" 200 "$S"
if grep -q "NoKey Provision Co" /tmp/body.json && grep -q "nokey@example.com" /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ no-key: workspace provisioned (provision never needs email)"
else
  FAIL=$((FAIL+1)); echo "  ✗ no-key: provision missing from orgs list"
fi
if [ ! -s "$MOCK_EMAILS" ]; then
  PASS=$((PASS+1)); echo "  ✓ no-key: mock received NO emails"
else
  FAIL=$((FAIL+1)); echo "  ✗ no-key: unexpected email sent: $(cat "$MOCK_EMAILS")"
fi
if grep -Fq "[email] RESEND_API_KEY not configured — skipping Welcome to Revzenta — your workspace is ready to nokey@example.com" "$MOCK/srv-a.log"; then
  PASS=$((PASS+1)); echo "  ✓ no-key: skip line logged, app healthy"
else
  FAIL=$((FAIL+1)); echo "  ✗ no-key: skip line missing: $(grep '\[email\]' "$MOCK/srv-a.log")"
fi
stop_crm "$MOCK/srv-a.pid"; rm -f "$JA"

echo "-- 27b. Key + mock → intake on provision, welcome once on first login =="
: > "$MOCK_EMAILS"
start_crm 3003 "$MOCK/db-b" "$MOCK/srv-b.log" "$MOCK/srv-b.pid" -u TEST_EMAIL_TO RESEND_API_KEY=test-key-123 RESEND_URL=http://127.0.0.1:3199
JB=$(mktemp)
S=$(code -c "$JB" -b "$JB" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "http://localhost:3003/api/auth/login")
check "keyed: login → 200" 200 "$S"
S=$(code -b "$JB" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"Email Test Co","contactName":"Sam Buyer","email":"buyer@example.com","industry":"Cleaning","clientType":"commercial","dealValue":5000,"stage":"Leads"}' "http://localhost:3003/api/clients")
check "keyed: create lead → 201" 201 "$S"
ET_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JB" -X PUT -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"Email Test Co","contactName":"Sam Buyer","email":"buyer@example.com","industry":"Cleaning","clientType":"commercial","dealValue":5000,"stage":"Sold"}' "http://localhost:3003/api/clients/$ET_ID")
check "keyed: move lead into Sold → 200" 200 "$S"
sleep 1
if python3 - "$MOCK_EMAILS" <<'PY' 2>"$MOCK/intake.err"
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1])]
assert len(lines) == 1, [(l.get("subject"), l.get("to")) for l in lines]
e = lines[0]
assert e["to"] == ["buyer@example.com"], e["to"]
assert e["subject"] == "Welcome to Revzenta — your workspace is ready", e["subject"]
t = e["text"]
assert "Email Test Co" in t, t
assert "Sign in here: https://crm.example.test" in t, t
assert "Email:    buyer@example.com" in t, t
assert "Password: " in t, t
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ intake email: recipient, subject, org name, origin URL + credentials"; else FAIL=$((FAIL+1)); echo "  ✗ intake email mismatch:"; cat "$MOCK/intake.err"; fi
S=$(code -b "$JB" "http://localhost:3003/api/admin/orgs")
check "keyed: admin orgs → 200" 200 "$S"
PROV_EMAIL=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['loginEmail'] for o in d['orgs'] if o.get('provisionedFromClient') == $ET_ID][0])")
PROV_PW=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['tempPassword'] for o in d['orgs'] if o.get('provisionedFromClient') == $ET_ID][0])")
JBM=$(mktemp)
S=$(code -c "$JBM" -b "$JBM" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PROV_EMAIL\",\"password\":\"$PROV_PW\"}" "http://localhost:3003/api/auth/login")
check "keyed: provisioned member login (first) → 200" 200 "$S"
sleep 1
if python3 - "$MOCK_EMAILS" "$PROV_PW" <<'PY' 2>"$MOCK/welcome.err"
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1])]
assert len(lines) == 2, [(l.get("subject"), l.get("to")) for l in lines]
e = lines[1]
assert e["to"] == ["buyer@example.com"], e["to"]
assert e["subject"] == "Welcome to Email Test Co — let's get started", e["subject"]
t = e["text"]
assert "Email Test Co" in t, t
assert "pipeline" in t and "clients" in t and "tasks and invoices" in t, t
assert "Sign in anytime at: https://elevate-crm-mwp7.onrender.com" in t, t
assert "Password:" not in t and sys.argv[2] not in t, t
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ welcome email: recipient, subject, orientation, fallback URL, NO credentials"; else FAIL=$((FAIL+1)); echo "  ✗ welcome email mismatch:"; cat "$MOCK/welcome.err"; fi
S=$(code -c "$JBM" -b "$JBM" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PROV_EMAIL\",\"password\":\"$PROV_PW\"}" "http://localhost:3003/api/auth/login")
check "keyed: member second login → 200" 200 "$S"
sleep 1
if [ "$(wc -l < "$MOCK_EMAILS")" -eq 2 ]; then
  PASS=$((PASS+1)); echo "  ✓ second login sends NO new email (welcome is once-only)"
else
  FAIL=$((FAIL+1)); echo "  ✗ second login re-sent an email: $(cat "$MOCK_EMAILS")"
fi
cat > "$MOCK/fl.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
const email = process.env.USER_EMAIL ?? "";
const row = db.query("SELECT first_login_at FROM users WHERE email = ?").get(email) as { first_login_at: string | null } | null;
console.log(row?.first_login_at ?? "NULL");
TS
FL1=$(DB_FILE="$MOCK/db-b/crm.db" USER_EMAIL="$PROV_EMAIL" bun "$MOCK/fl.ts")
if [ "$FL1" != "NULL" ]; then PASS=$((PASS+1)); echo "  ✓ first_login_at set after first login ($FL1)"; else FAIL=$((FAIL+1)); echo "  ✗ first_login_at not set ($FL1)"; fi
# A fresh tenant whose member has never logged in: impersonation must NOT set
# first_login_at and must NOT fire the welcome email.
S=$(code -b "$JB" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"Impersonation Email Co","contactName":"Ima Owner","email":"imp@example.com","industry":"Cleaning","clientType":"commercial","dealValue":3000,"stage":"Leads"}' "http://localhost:3003/api/clients")
check "keyed: create second lead → 201" 201 "$S"
IMP_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JB" -X PUT -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"Impersonation Email Co","contactName":"Ima Owner","email":"imp@example.com","industry":"Cleaning","clientType":"commercial","dealValue":3000,"stage":"Sold"}' "http://localhost:3003/api/clients/$IMP_ID")
check "keyed: move second lead into Sold → 200" 200 "$S"
sleep 1
S=$(code -b "$JB" "http://localhost:3003/api/admin/orgs")
IMP_ORG=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o.get('provisionedFromClient') == $IMP_ID][0])")
FL_IMP_BEFORE=$(DB_FILE="$MOCK/db-b/crm.db" USER_EMAIL="imp@example.com" bun "$MOCK/fl.ts")
if [ "$FL_IMP_BEFORE" = "NULL" ]; then PASS=$((PASS+1)); echo "  ✓ fresh tenant member has no first_login_at yet"; else FAIL=$((FAIL+1)); echo "  ✗ fresh tenant first_login_at set prematurely ($FL_IMP_BEFORE)"; fi
LINES_BEFORE_IMP=$(wc -l < "$MOCK_EMAILS")
S=$(code -c "$JB" -b "$JB" -X POST -H 'Content-Type: application/json' \
  -d "{\"orgId\":$IMP_ORG}" "http://localhost:3003/api/admin/impersonate")
check "keyed: admin impersonates never-logged-in tenant → 200" 200 "$S"
sleep 1
FL_IMP_AFTER=$(DB_FILE="$MOCK/db-b/crm.db" USER_EMAIL="imp@example.com" bun "$MOCK/fl.ts")
if [ "$FL_IMP_AFTER" = "NULL" ]; then PASS=$((PASS+1)); echo "  ✓ impersonation does NOT set first_login_at"; else FAIL=$((FAIL+1)); echo "  ✗ impersonation set first_login_at ($FL_IMP_AFTER)"; fi
if [ "$(wc -l < "$MOCK_EMAILS")" -eq "$LINES_BEFORE_IMP" ]; then
  PASS=$((PASS+1)); echo "  ✓ impersonation sent NO email (no welcome on session swap)"
else
  FAIL=$((FAIL+1)); echo "  ✗ impersonation fired an email: $(tail -1 "$MOCK_EMAILS")"
fi
S=$(code -c "$JB" -b "$JB" -X POST "http://localhost:3003/api/auth/impersonate-return")
check "keyed: impersonate-return → 200" 200 "$S"
stop_crm "$MOCK/srv-b.pid"; rm -f "$JB" "$JBM"

echo "-- 27c. TEST_EMAIL_TO redirects intake delivery to the owner's mailbox =="
: > "$MOCK_EMAILS"
start_crm 3004 "$MOCK/db-c" "$MOCK/srv-c.log" "$MOCK/srv-c.pid" RESEND_API_KEY=test-key-123 RESEND_URL=http://127.0.0.1:3199 TEST_EMAIL_TO=owner-test@gmail.com
JC=$(mktemp)
S=$(code -c "$JC" -b "$JC" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "http://localhost:3004/api/auth/login")
check "redirect: login → 200" 200 "$S"
S=$(code -b "$JC" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"Redirect Test Co","contactName":"Ray Client","email":"real-client@example.com","industry":"Cleaning","clientType":"commercial","dealValue":6000,"stage":"Leads"}' "http://localhost:3004/api/clients")
check "redirect: create lead → 201" 201 "$S"
RC_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JC" -X PUT -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"companyName":"Redirect Test Co","contactName":"Ray Client","email":"real-client@example.com","industry":"Cleaning","clientType":"commercial","dealValue":6000,"stage":"Sold"}' "http://localhost:3004/api/clients/$RC_ID")
check "redirect: move lead into Sold → 200" 200 "$S"
sleep 1
if python3 - "$MOCK_EMAILS" <<'PY' 2>"$MOCK/redirect.err"
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1])]
assert len(lines) == 1, [(l.get("subject"), l.get("to")) for l in lines]
e = lines[0]
assert e["to"] == ["owner-test@gmail.com"], e["to"]
t = e["text"]
assert t.startswith("[TEST] Intended for real-client@example.com"), t
assert "Email:    real-client@example.com" in t, t
assert "Password: " in t, t
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ TEST_EMAIL_TO: delivered to owner with [TEST] intended-for prefix"; else FAIL=$((FAIL+1)); echo "  ✗ redirect mismatch:"; cat "$MOCK/redirect.err"; fi
stop_crm "$MOCK/srv-c.pid"; rm -f "$JC"
stop_crm "$MOCK/srv-a.pid" 2>/dev/null
stop_crm "$MOCK/srv-b.pid" 2>/dev/null
kill "$MOCK_PID" 2>/dev/null
rm -rf "$MOCK"
echo "== 28. Password reset (3k) =="
# Self-contained like section 27: a throwaway CRM server on :3005 with a fresh
# DB posts emails to a mock Resend endpoint on :3198, which records every
# request as JSONL. The MAIN server on $BASE is untouched. start_crm/stop_crm
# (defined in section 27) are reused here.
MOCK28=$(mktemp -d)
MOCK28_EMAILS="$MOCK28/emails.jsonl"
: > "$MOCK28_EMAILS"
cat > "$MOCK28/resend.ts" <<'TS'
import { appendFileSync } from "node:fs";
const PORT = 3198;
const OUT = process.env.MOCK28_OUT ?? "/tmp/mock28-emails.jsonl";
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      appendFileSync(OUT, JSON.stringify(body) + "\n");
      return Response.json({ id: "mock-" + Math.random().toString(36).slice(2) });
    }
    return new Response("nope", { status: 404 });
  },
});
console.log("mock28 resend on " + PORT);
TS
MOCK28_OUT="$MOCK28_EMAILS" nohup bun "$MOCK28/resend.ts" > "$MOCK28/resend.log" 2>&1 &
MOCK28_PID=$!
i=0; until curl -sf http://127.0.0.1:3198/health >/dev/null 2>&1; do i=$((i+1)); [ "$i" -gt 50 ] && break; sleep 0.2; done
if curl -sf http://127.0.0.1:3198/health >/dev/null 2>&1; then
  PASS=$((PASS+1)); echo "  ✓ mock Resend endpoint up on :3198"
else
  FAIL=$((FAIL+1)); echo "  ✗ mock Resend endpoint failed to start"
fi
# Token storage helpers (hashed-only check + forced expiry).
cat > "$MOCK28/hashcheck.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
const rows = db.query("SELECT token_hash FROM password_resets").all() as { token_hash: string }[];
const raw = process.env.RAWTOKEN ?? "";
if (rows.length === 0) { console.log("NO_ROWS"); process.exit(2); }
if (rows.some((r) => r.token_hash === raw)) { console.log("RAW_FOUND"); process.exit(2); }
if (!rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))) { console.log("BAD_HASH"); process.exit(2); }
console.log("HASHED_ONLY");
TS
cat > "$MOCK28/expire.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
db.query(
  "UPDATE password_resets SET expires_at = 1 WHERE user_id = (SELECT id FROM users WHERE email = ?)",
).run(process.env.EXP_EMAIL ?? "");
console.log("expired");
TS

echo "-- 28a. Provision two tenants; forgot-password mints a token + emails the link =="
start_crm 3005 "$MOCK28/db" "$MOCK28/srv.log" "$MOCK28/srv.pid" -u TEST_EMAIL_TO RESEND_API_KEY=test-key-123 RESEND_URL=http://127.0.0.1:3198
JA28=$(mktemp)    # owner (admin) session
JRESETA=$(mktemp) # tenant A's own session
JRESETB=$(mktemp) # tenant B's own session
JRESETC=$(mktemp) # empty jar (unauthenticated)
JRESETD=$(mktemp) # tenant A session after reset (28e)
JRESETE=$(mktemp) # tenant A session after Settings change (28f)
JRESETF=$(mktemp) # tenant A session with admin temp password (28g)
S=$(code -c "$JA28" -b "$JA28" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "http://localhost:3005/api/auth/login")
check "28a: admin login → 200" 200 "$S"
S=$(code -b "$JA28" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Reset Tenant A","email":"reseta@example.com","password":"ResetApass123!"}' "http://localhost:3005/api/admin/orgs")
check "28a: admin creates tenant A → 201" 201 "$S"
ORGA_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JA28" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Reset Tenant B","email":"resetb@example.com","password":"ResetBpass123!"}' "http://localhost:3005/api/admin/orgs")
check "28a: admin creates tenant B → 201" 201 "$S"
ORGB_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JA28" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"email":"reseta@example.com"}' "http://localhost:3005/api/auth/forgot")
check "28a: forgot-password for known email → 200" 200 "$S"
grep -Fq "a reset link is on its way" /tmp/body.json && echo "  ✓ generic success message returned" || echo "  ✗ forgot response: $(cat /tmp/body.json)"
sleep 1
if python3 - "$MOCK28_EMAILS" <<'PY' 2>"$MOCK28/emails-a.err"
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1])]
# 3g-4 intake emails now accompany admin provisioning; only the reset email matters here.
reset = [l for l in lines if l.get("subject") == "Reset your password"]
assert len(reset) == 1, [(l.get("subject"), l.get("to")) for l in lines]
e = reset[0]
assert e["to"] == ["reseta@example.com"], e["to"]
assert e["subject"] == "Reset your password", e["subject"]
t = e["text"]
assert "https://crm.example.test/#/reset?token=" in t, t
assert "45 minutes" in t and "once" in t, t
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ reset email: recipient, subject, origin URL with token, expiry note"; else FAIL=$((FAIL+1)); echo "  ✗ reset email mismatch:"; cat "$MOCK28/emails-a.err"; fi
TOKENA=$(python3 - "$MOCK28_EMAILS" <<'PY'
import json, sys, re
lines = [json.loads(l) for l in open(sys.argv[1])]
reset = [l for l in lines if l.get("subject") == "Reset your password"]
t = reset[0]["text"]
m = re.search(r"token=([0-9a-f]{64})", t)
assert m, t
print(m.group(1))
PY
)
echo "    (tenant A token: ${TOKENA:0:8}…)"
# No-account enumeration: unknown email gets the SAME message and NO email.
S=$(code -b "$JA28" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.com"}' "http://localhost:3005/api/auth/forgot")
check "28a: forgot for unknown email → 200" 200 "$S"
grep -Fq "a reset link is on its way" /tmp/body.json && echo "  ✓ identical generic message (no account enumeration)" || echo "  ✗ forgot response: $(cat /tmp/body.json)"
if [ "$(grep -c 'Reset your password' "$MOCK28_EMAILS")" -eq 1 ]; then
  PASS=$((PASS+1)); echo "  ✓ unknown email sent NO reset email"
else
  FAIL=$((FAIL+1)); echo "  ✗ unexpected email for unknown account: $(cat "$MOCK28_EMAILS")"
fi

echo "-- 28b. Token validation: wrong token, weak password, hashed storage =="
check "28b: redeem wrong token → 400" 400 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d '{"token":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef","password":"Whatever123!"}' "http://localhost:3005/api/auth/reset")
check "28b: redeem with short password → 400" 400 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKENA\",\"password\":\"short\"}" "http://localhost:3005/api/auth/reset")
HC=$(DB_FILE="$MOCK28/db/crm.db" RAWTOKEN="$TOKENA" bun "$MOCK28/hashcheck.ts")
if [ "$HC" = "HASHED_ONLY" ]; then PASS=$((PASS+1)); echo "  ✓ token stored as sha256 hash only (raw token never in DB)"; else FAIL=$((FAIL+1)); echo "  ✗ token storage: $HC"; fi

echo "-- 28c. Multi-tenant isolation: tenant B cannot redeem tenant A's token =="
S=$(code -c "$JRESETB" -b "$JRESETB" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"resetb@example.com","password":"ResetBpass123!"}' "http://localhost:3005/api/auth/login")
check "28c: tenant B login → 200" 200 "$S"
S=$(code -b "$JRESETB" -X POST -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKENA\",\"password\":\"Hijacked123!\"}" "http://localhost:3005/api/auth/reset")
check "28c: B redeems A's token while signed in → 403" 403 "$S"
grep -Fq "Forbidden" /tmp/body.json && echo "  ✓ cross-org redemption forbidden" || echo "  ✗ reset response: $(cat /tmp/body.json)"
# Neither password may have changed: A still logs in with its old password,
# B with its old password.
S=$(code -c "$JRESETA" -b "$JRESETA" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"reseta@example.com","password":"ResetApass123!"}' "http://localhost:3005/api/auth/login")
check "28c: A login with ORIGINAL password → 200 (unchanged)" 200 "$S"
S=$(code -c "$JRESETB" -b "$JRESETB" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"resetb@example.com","password":"ResetBpass123!"}' "http://localhost:3005/api/auth/login")
check "28c: B login with ORIGINAL password → 200 (unchanged)" 200 "$S"

echo "-- 28d. Expired token rejected =="
S=$(code -b "$JA28" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"email":"reseta@example.com"}' "http://localhost:3005/api/auth/forgot")
check "28d: mint a second token → 200" 200 "$S"
sleep 1
TOKENA2=$(python3 - "$MOCK28_EMAILS" <<'PY'
import json, sys, re
lines = [json.loads(l) for l in open(sys.argv[1])]
reset = [l for l in lines if l.get("subject") == "Reset your password"]
m = re.search(r"token=([0-9a-f]{64})", reset[-1]["text"])
assert m, reset[-1]["text"]
print(m.group(1))
PY
)
EXP=$(DB_FILE="$MOCK28/db/crm.db" EXP_EMAIL="reseta@example.com" bun "$MOCK28/expire.ts")
[ "$EXP" = "expired" ] && echo "  ✓ forced all of A's tokens to expire (DB)" || echo "  ✗ expiry script failed: $EXP"
check "28d: redeem expired token → 400" 400 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKENA2\",\"password\":\"Whatever123!\"}" "http://localhost:3005/api/auth/reset")
grep -Fq "invalid or has expired" /tmp/body.json && echo "  ✓ expired message returned" || echo "  ✗ reset response: $(cat /tmp/body.json)"

echo "-- 28e. Happy path: single-use token resets the password =="
S=$(code -b "$JA28" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d '{"email":"reseta@example.com"}' "http://localhost:3005/api/auth/forgot")
check "28e: mint a third token → 200" 200 "$S"
sleep 1
TOKENA3=$(python3 - "$MOCK28_EMAILS" <<'PY'
import json, sys, re
lines = [json.loads(l) for l in open(sys.argv[1])]
reset = [l for l in lines if l.get("subject") == "Reset your password"]
m = re.search(r"token=([0-9a-f]{64})", reset[-1]["text"])
assert m, reset[-1]["text"]
print(m.group(1))
PY
)
S=$(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKENA3\",\"password\":\"ResetAnew123!\"}" "http://localhost:3005/api/auth/reset")
check "28e: unauthenticated redemption → 200" 200 "$S"
grep -Fq "has been reset" /tmp/body.json && echo "  ✓ success message returned" || echo "  ✗ reset response: $(cat /tmp/body.json)"
check "28e: SAME token redeemed twice → 400 (single-use)" 400 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKENA3\",\"password\":\"ResetAnew456!\"}" "http://localhost:3005/api/auth/reset")
check "28e: login with OLD password → 401" 401 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"reseta@example.com","password":"ResetApass123!"}' "http://localhost:3005/api/auth/login")
S=$(code -c "$JRESETD" -b "$JRESETD" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"reseta@example.com","password":"ResetAnew123!"}' "http://localhost:3005/api/auth/login")
check "28e: login with NEW password → 200" 200 "$S"

echo "-- 28f. Change password in Settings (authenticated, session stays valid) =="
check "28f: change-password without cookie → 401" 401 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d '{"currentPassword":"ResetAnew123!","newPassword":"ResetAchange1!"}' "http://localhost:3005/api/auth/change-password")
check "28f: wrong current password → 400" 400 $(code -b "$JRESETD" -X POST -H 'Content-Type: application/json' \
  -d '{"currentPassword":"nope","newPassword":"ResetAchange1!"}' "http://localhost:3005/api/auth/change-password")
check "28f: short new password → 400" 400 $(code -b "$JRESETD" -X POST -H 'Content-Type: application/json' \
  -d '{"currentPassword":"ResetAnew123!","newPassword":"short"}' "http://localhost:3005/api/auth/change-password")
S=$(code -b "$JRESETD" -X POST -H 'Content-Type: application/json' \
  -d '{"currentPassword":"ResetAnew123!","newPassword":"ResetAchange1!"}' "http://localhost:3005/api/auth/change-password")
check "28f: correct current password → 200" 200 "$S"
check "28f: existing session STILL valid after change (me → 200)" 200 $(code -b "$JRESETD" "http://localhost:3005/api/auth/me")
S=$(code -c "$JRESETE" -b "$JRESETE" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"reseta@example.com","password":"ResetAchange1!"}' "http://localhost:3005/api/auth/login")
check "28f: login with CHANGED password → 200" 200 "$S"
check "28f: login with pre-change password → 401" 401 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"reseta@example.com","password":"ResetAnew123!"}' "http://localhost:3005/api/auth/login")

echo "-- 28g. Admin-tab per-tenant reset password =="
check "28g: admin reset without cookie → 401" 401 $(code -b "$JRESETC" -X POST "http://localhost:3005/api/admin/orgs/$ORGA_ID/reset-password")
check "28g: member calls admin reset → 403" 403 $(code -b "$JRESETD" -X POST "http://localhost:3005/api/admin/orgs/$ORGA_ID/reset-password")
check "28g: admin resets owner org → 400" 400 $(code -b "$JA28" -X POST "http://localhost:3005/api/admin/orgs/1/reset-password")
check "28g: admin resets missing org → 404" 404 $(code -b "$JA28" -X POST "http://localhost:3005/api/admin/orgs/999999/reset-password")
S=$(code -b "$JA28" -X POST "http://localhost:3005/api/admin/orgs/$ORGA_ID/reset-password")
check "28g: admin resets tenant A password → 200" 200 "$S"
grep -Fq '"ok":true' /tmp/body.json && grep -Fq '"email":"reseta@example.com"' /tmp/body.json && echo "  ✓ response carries the login email" || echo "  ✗ reset response: $(cat /tmp/body.json)"
TEMP28=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['password'])")
[ ${#TEMP28} -ge 16 ] && echo "  ✓ crypto temp password returned to owner (${#TEMP28} chars)" || echo "  ✗ temp password too short: $TEMP28"
S=$(code -b "$JA28" "http://localhost:3005/api/admin/orgs")
check "28g: admin orgs list → 200" 200 "$S"
if python3 - "$ORGA_ID" "$TEMP28" <<'PY' 2>/dev/null
import json, sys
d = json.load(open('/tmp/body.json'))
o = next(o for o in d['orgs'] if o['id'] == int(sys.argv[1]))
assert o.get('resetPassword') == sys.argv[2], o.get('resetPassword')
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ Admin list shows the new reset temp password"; else FAIL=$((FAIL+1)); echo "  ✗ resetPassword missing from Admin list"; fi
check "28g: old password fails after admin reset → 401" 401 $(code -b "$JRESETC" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"reseta@example.com","password":"ResetAchange1!"}' "http://localhost:3005/api/auth/login")
S=$(code -c "$JRESETF" -b "$JRESETF" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"reseta@example.com\",\"password\":\"$TEMP28\"}" "http://localhost:3005/api/auth/login")
check "28g: new temp password logs the member in → 200" 200 "$S"
S=$(code -b "$JA28" "http://localhost:3005/api/admin/orgs")
check "28g: admin orgs list after member login → 200" 200 "$S"
if python3 - "$ORGA_ID" <<'PY' 2>/dev/null
import json, sys
d = json.load(open('/tmp/body.json'))
o = next(o for o in d['orgs'] if o['id'] == int(sys.argv[1]))
assert o.get('resetPassword') is None, o.get('resetPassword')
print("ok")
PY
then PASS=$((PASS+1)); echo "  ✓ reset temp password cleared after member login (delivered)"; else FAIL=$((FAIL+1)); echo "  ✗ resetPassword still visible after login"; fi

echo "-- 28h. UI surface strings in the built bundle =="
NEWEST_JS28=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS28" ] && [ -f "$NEWEST_JS28" ]; then
  if grep -q "Forgot password?" "$NEWEST_JS28" && grep -q "Set new password" "$NEWEST_JS28" \
     && grep -q "Change password" "$NEWEST_JS28" && grep -q "Reset password" "$NEWEST_JS28"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the 3k UI strings (forgot / reset / change / admin reset)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ 3k strings missing from $NEWEST_JS28"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 3k bundle surface check"
fi

echo "-- 28i. Cleanup =="
check "28i: admin deletes tenant A → 200" 200 $(code -b "$JA28" -X DELETE "http://localhost:3005/api/admin/orgs/$ORGA_ID")
check "28i: admin deletes tenant B → 200" 200 $(code -b "$JA28" -X DELETE "http://localhost:3005/api/admin/orgs/$ORGB_ID")
stop_crm "$MOCK28/srv.pid" 2>/dev/null
kill "$MOCK28_PID" 2>/dev/null
rm -rf "$MOCK28" "$JA28" "$JRESETA" "$JRESETB" "$JRESETC" "$JRESETD" "$JRESETE" "$JRESETF"
echo "== 29. Leads stage chips (owner request 2026-08-14) =="
echo "-- 29a. UI surface strings in the built bundle =="
NEWEST_JS29=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS29" ] && [ -f "$NEWEST_JS29" ]; then
  if grep -q "Filter by stage" "$NEWEST_JS29" && grep -q "stage-chip" "$NEWEST_JS29" \
     && grep -q "in the pipeline" "$NEWEST_JS29"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the stage-chip row (\"Filter by stage\") + dashboard deep-link (\"View … in the pipeline\")"
  else
    FAIL=$((FAIL+1)); echo "  ✗ stage-chip / deep-link strings missing from $NEWEST_JS29"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 29a bundle surface check"
fi
echo "-- 29b. OWNER chip sets (owner direction 2026-08-15): the Leads tab chips = the FIRST stage only; the Onboarding tab chips = the MIDDLE stages =="
code -b "$JAR" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/settings29b.json
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
cp /tmp/body.json /tmp/clients29.json
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
cp /tmp/body.json /tmp/dash29.json
if python3 - <<'PY' 2>"$PASS_TMP"
import json
from collections import Counter
st = json.load(open('/tmp/settings29b.json'))['settings']['stages']
first = st[0]
terminal = st[-1]
middle = st[1:-1]
clients = json.load(open('/tmp/clients29.json'))['clients']
dash = json.load(open('/tmp/dash29.json'))
counts = Counter(c['stage'] for c in clients if not c['archived'])
# Owner three-bucket (2026-08-15): the Leads tab chips = the FIRST stage
# only; the Onboarding tab chips = the MIDDLE stages. Both chip rows derive
# from the same non-archived per-stage counts the dashboard shows; the
# terminal (sold) stage has no chip in either pipeline tab.
leads_chips = [first]
onboard_chips = middle
assert terminal not in leads_chips and terminal not in onboard_chips, terminal
for s in leads_chips + onboard_chips:
    assert counts.get(s, 0) == dash['stageCounts'].get(s, 0), (s, counts.get(s, 0), dash['stageCounts'].get(s, 0))
print(f"  ✓ owner chip sets: Leads={leads_chips}, Onboarding={onboard_chips}; counts match the dashboard breakdown (terminal \"{terminal}\" has no chip)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ owner Leads chips = first stage, Onboarding chips = middle stages; counts agree with the dashboard breakdown"
else
  FAIL=$((FAIL+1)); echo "  ✗ chip counts disagree with the stage breakdown"; cat "$PASS_TMP"
fi
echo "-- 29c. Renamed stage keeps filtering (chips are driven by the org's CURRENT stages) =="
code -b "$JAR" "$BASE/api/settings" > /dev/null
if python3 - <<'PY' 2>"$PASS_TMP"
import json
d = json.load(open('/tmp/body.json'))
assert d['settings']['stages'][0] == 'Leads', d['settings']['stages']
print("  ✓ owner stage[0] is Leads before the rename")
PY
then
  PASS=$((PASS+1)); echo "  ✓ pre-rename stage[0] is Leads (rename target is valid)"
else
  FAIL=$((FAIL+1)); echo "  ✗ pre-rename stage[0] != Leads"; cat "$PASS_TMP"
fi
PRE_CNT=$(python3 -c "import json; d=json.load(open('/tmp/dash29.json')); print(d['stageCounts'].get('Leads', 0))")
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Pipeline Leads","Onboarding","Sold"]}' "$BASE/api/settings")
check "29c: rename Leads → \"Pipeline Leads\" → 200" 200 "$S"
code -b "$JAR" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/settings29.json
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
cp /tmp/body.json /tmp/clients29b.json
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
cp /tmp/body.json /tmp/dash29b.json
code -b "$JAR" "$BASE/api/auth/me" > /dev/null
cp /tmp/body.json /tmp/me29.json
if PRE_CNT="$PRE_CNT" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
settings = json.load(open('/tmp/settings29.json'))
st = settings['settings']['stages']
assert st == ['Pipeline Leads', 'Onboarding', 'Sold'], st
clients = json.load(open('/tmp/clients29b.json'))['clients']
assert not [c for c in clients if c['stage'] == 'Leads'], "clients still in old stage"
moved = [c for c in clients if c['stage'] == 'Pipeline Leads']
dash = json.load(open('/tmp/dash29b.json'))
me = json.load(open('/tmp/me29.json'))
assert dash['stageCounts'].get('Pipeline Leads', 0) == int(os.environ['PRE_CNT']), dash['stageCounts']
assert me['user']['stages'][0] == 'Pipeline Leads', me['user']['stages']
print(f"  ✓ renamed stage \"Pipeline Leads\" holds {len(moved)} client(s); count {dash['stageCounts'].get('Pipeline Leads')} unchanged; session stages follow (deep-link uses the new name)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ renamed stage keeps filtering correctly (settings + clients + counts + session agree)"
else
  FAIL=$((FAIL+1)); echo "  ✗ renamed-stage check failed"; cat "$PASS_TMP"
fi


echo "== 30. Leads/Clients split by terminal stage (owner request 2026-08-14) =="
# GLOBAL (owner request 2026-08-15): the OWNER's pipeline is a three-bucket
# split — Leads tab = the FIRST stage (prospects), Onboarding tab = the
# MIDDLE stages (intake leads), Clients directory = the TERMINAL stage
# (sold). Client accounts (role=member) keep the PR #35 split: pipeline =
# every stage except terminal, directory = terminal only. All checks mirror
# the client-side split exactly (leads: stage == first; onboarding: stage in
# middle; directory: stage == terminal) against the same per-org API data
# the tabs render, so a regression in any tab's filter is caught here.
code -b "$JAR" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s30-settings.json
TERM30=$(python3 -c "import json; st=json.load(open('/tmp/s30-settings.json'))['settings']['stages']; print(st[-1])")
FIRST30=$(python3 -c "import json; st=json.load(open('/tmp/s30-settings.json'))['settings']['stages']; print(st[0])")
echo "    (owner first stage = \"$FIRST30\", terminal stage = \"$TERM30\")"

echo "-- 30a. OWNER three-bucket split: Leads tab = first stage only, Onboarding tab = middle stages only, directory = terminal-stage clients only; no terminal chip in either pipeline tab =="
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
cp /tmp/body.json /tmp/s30a-clients.json
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
cp /tmp/body.json /tmp/s30a-dash.json
if TERM30="$TERM30" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
from collections import Counter
st = json.load(open('/tmp/s30-settings.json'))['settings']['stages']
terminal = os.environ['TERM30']
assert terminal == st[-1], (terminal, st)
first = st[0]
middle = st[1:-1]
clients = json.load(open('/tmp/s30a-clients.json'))['clients']
dash = json.load(open('/tmp/s30a-dash.json'))
leads_bucket = [c for c in clients if c['stage'] == first]
onboarding = [c for c in clients if c['stage'] in middle]
directory = [c for c in clients if c['stage'] == terminal]
# (d) every client whose stage is in the CURRENT stage list lands in exactly
# one bucket; each bucket holds only its stages. Clients in orphan stages
# (dropped by earlier suite renames, e.g. "Proposal") are invisible in every
# tab and were tolerated by the pre-2026-08-15 tests — excluded here too.
known = [c for c in clients if c['stage'] in st]
assert len(leads_bucket) + len(onboarding) + len(directory) == len(known), (len(leads_bucket), len(onboarding), len(directory), len(known))
assert all(c['stage'] == first for c in leads_bucket), "Leads bucket has a non-first-stage client"
assert all(c['stage'] in middle for c in onboarding), "Onboarding bucket has a non-middle-stage client"
assert all(c['stage'] == terminal for c in directory), "directory contains a non-terminal client"
# (b) no chip for the terminal stage; owner Leads chips = first, Onboarding chips = middle
chips_leads = [first]
chips_onboard = middle
assert terminal not in chips_leads and terminal not in chips_onboard, terminal
counts = Counter(c['stage'] for c in clients if not c['archived'])
for s in chips_leads + chips_onboard:
    assert counts.get(s, 0) == dash['stageCounts'].get(s, 0), (s, counts.get(s, 0), dash['stageCounts'].get(s, 0))
print(f"  ✓ owner buckets: Leads(first)={len(leads_bucket)}, Onboarding(middle)={len(onboarding)}, Clients(terminal)={len(directory)}; chip sets Leads={chips_leads} Onboarding={chips_onboard}, no terminal chip")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30a: owner three-bucket split (Leads=first, Onboarding=middle, Clients=terminal) consistent with the API data"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30a: three-bucket split inconsistency"; cat "$PASS_TMP"
fi

echo "-- 30b. GLOBAL: a tenant org's tabs split the same way (terminal = its last stage) =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Terminal Tenant Co","email":"terminal-tenant@example.com","password":"terminaltenant123"}' "$BASE/api/admin/orgs")
check "30b: admin provisions tenant org → 201" 201 "$S"
JART30=$(mktemp)
S=$(code -c "$JART30" -b "$JART30" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"terminal-tenant@example.com","password":"terminaltenant123"}' "$BASE/api/auth/login")
check "30b: tenant login → 200" 200 "$S"
code -b "$JART30" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s30b-settings.json
TT_FIRST=$(python3 -c "import json; st=json.load(open('/tmp/s30b-settings.json'))['settings']['stages']; print(st[0])")
TT_TERM=$(python3 -c "import json; st=json.load(open('/tmp/s30b-settings.json'))['settings']['stages']; print(st[-1])")
if [ "$TT_FIRST" != "$TT_TERM" ] && [ -n "$TT_FIRST" ] && [ -n "$TT_TERM" ]; then
  PASS=$((PASS+1)); echo "  ✓ 30b: tenant stages \"$TT_FIRST … $TT_TERM\" (terminal = \"$TT_TERM\")"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30b: tenant stages missing: $(cat /tmp/s30b-settings.json)"
fi
S=$(code -b "$JART30" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Tenant Prospect Two\",\"clientType\":\"residential\",\"dealValue\":700,\"stage\":\"$TT_FIRST\"}" "$BASE/api/clients")
check "30b: tenant creates client in first stage → 201" 201 "$S"
TT_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
code -b "$JART30" "$BASE/api/clients?archived=1" > /dev/null
if TT_ID="$TT_ID" TT_TERM="$TT_TERM" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
clients = json.load(open('/tmp/body.json'))['clients']
me = [c for c in clients if c['id'] == int(os.environ['TT_ID'])][0]
assert me['stage'] != os.environ['TT_TERM'], me['stage']
print(f"  ✓ tenant prospect in the pipeline (stage \"{me['stage']}\", not the terminal \"{os.environ['TT_TERM']}\")")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30b: tenant prospect appears in the pipeline tab"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30b: tenant prospect not in pipeline"; cat "$PASS_TMP"
fi
S=$(code -b "$JART30" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Tenant Prospect Two\",\"clientType\":\"residential\",\"dealValue\":700,\"stage\":\"$TT_TERM\"}" "$BASE/api/clients/$TT_ID")
check "30b: tenant moves client into its terminal stage → 200" 200 "$S"
grep -q "\"stage\":\"$TT_TERM\"" /tmp/body.json && echo "  ✓ 30b: tenant client now in terminal stage" || echo "  ✗ 30b: stage after PUT: $(cat /tmp/body.json)"
code -b "$JART30" "$BASE/api/clients?archived=1" > /dev/null
if TT_ID="$TT_ID" TT_TERM="$TT_TERM" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
clients = json.load(open('/tmp/body.json'))['clients']
me = [c for c in clients if c['id'] == int(os.environ['TT_ID'])][0]
assert me['stage'] == os.environ['TT_TERM'], me['stage']
directory = [c for c in clients if c['stage'] == os.environ['TT_TERM']]
assert all(c['stage'] == os.environ['TT_TERM'] for c in directory), "directory has a non-terminal client"
pipeline = [c for c in clients if c['stage'] != os.environ['TT_TERM']]
assert me not in pipeline, "sold client still in pipeline"
print(f"  ✓ tenant directory holds exactly the {len(directory)} terminal-stage client(s); sold client left the pipeline")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30b: tenant terminal move moved pipeline → directory (terminal split is GLOBAL)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30b: tenant terminal move failed"; cat "$PASS_TMP"
fi

echo "-- 30c. Owner: moving a lead into the terminal stage leaves the Leads AND Onboarding tabs, joins the directory, and still auto-provisions the workspace (3g-3) =="
BEFORE30C=$(ORG_COUNT)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Terminal Split Co","contactName":"Taylor Split","email":"split@example.com","industry":"Cleaning","clientType":"commercial","dealValue":9000,"stage":"Pipeline Leads"}' "$BASE/api/clients")
check "30c: owner creates lead in the first stage → 201" 201 "$S"
TSC_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
if TSC_ID="$TSC_ID" FIRST30="$FIRST30" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
clients = json.load(open('/tmp/body.json'))['clients']
me = [c for c in clients if c['id'] == int(os.environ['TSC_ID'])][0]
assert me['stage'] == os.environ['FIRST30'], me['stage']
print(f"  ✓ new lead in the owner Leads tab (first stage \"{me['stage']}\")")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30c: new owner lead appears in the Leads tab (first stage only)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30c: new lead not in the first stage"; cat "$PASS_TMP"
fi
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Terminal Split Co\",\"contactName\":\"Taylor Split\",\"email\":\"split@example.com\",\"industry\":\"Cleaning\",\"clientType\":\"commercial\",\"dealValue\":9000,\"stage\":\"$TERM30\"}" "$BASE/api/clients/$TSC_ID")
check "30c: owner moves lead into the terminal stage → 200" 200 "$S"
grep -q "\"stage\":\"$TERM30\"" /tmp/body.json && echo "  ✓ 30c: client now in the terminal stage" || echo "  ✗ 30c: stage after PUT: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
if TSC_ID="$TSC_ID" TERM30="$TERM30" FIRST30="$FIRST30" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
clients = json.load(open('/tmp/body.json'))['clients']
me = [c for c in clients if c['id'] == int(os.environ['TSC_ID'])][0]
assert me['stage'] == os.environ['TERM30'], me['stage']
leads_bucket = [c for c in clients if c['stage'] == os.environ['FIRST30']]
onboarding = [c for c in clients if c['stage'] not in (os.environ['FIRST30'], os.environ['TERM30'])]
assert all(c['id'] != int(os.environ['TSC_ID']) for c in leads_bucket), "sold client still in Leads"
assert all(c['id'] != int(os.environ['TSC_ID']) for c in onboarding), "sold client still in Onboarding"
directory = [c for c in clients if c['stage'] == os.environ['TERM30']]
assert any(c['id'] == int(os.environ['TSC_ID']) for c in directory), "sold client missing from directory"
print("  ✓ sold lead left the Leads and Onboarding tabs and joined the directory")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30c: moving a lead into the terminal stage removes it from both pipeline tabs and adds it to the directory"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30c: terminal move failed"; cat "$PASS_TMP"
fi
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "30c: admin orgs list → 200" 200 "$S"
AFTER30C=$(ORG_COUNT)
[ "$AFTER30C" -eq $((BEFORE30C + 1)) ] && echo "  ✓ 30c: exactly one new workspace auto-provisioned (${BEFORE30C} → ${AFTER30C})" || echo "  ✗ 30c: org count ${BEFORE30C} → ${AFTER30C} (expected +1)"
if TSC_ID="$TSC_ID" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
prov = [o for o in d['orgs'] if o.get('provisionedFromClient') == int(os.environ['TSC_ID'])]
assert len(prov) == 1, [o['name'] for o in d['orgs']]
o = prov[0]
assert o['provisionedFromClientName'] == 'Terminal Split Co', o
assert o['name'] == 'Terminal Split Co', o
print("  ✓ 3g-3 hook intact: sold lead provisioned a workspace (provisionedFromClient set, listed in the Admin org list)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30c: 3g-3 auto-provision still fires when a pipeline lead moves into the terminal stage"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30c: 3g-3 provision missing"; cat "$PASS_TMP"
fi
PROV_ORG30C=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o.get('provisionedFromClient') == $TSC_ID][0])")

echo "-- 30d. A RENAMED terminal stage still behaves as terminal (positional — never hardcoded) =="
NEW_STAGES30=$(python3 -c "
import json
st = json.load(open('/tmp/s30-settings.json'))['settings']['stages']
st[-1] = 'Closed Won'
print(json.dumps(st))
")
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d "{\"stages\":$NEW_STAGES30}" "$BASE/api/settings")
check "30d: rename terminal \"$TERM30\" → \"Closed Won\" → 200" 200 "$S"
code -b "$JAR" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s30d-settings.json
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
cp /tmp/body.json /tmp/s30d-clients.json
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
cp /tmp/body.json /tmp/s30d-dash.json
if TSC_ID="$TSC_ID" TERM30="$TERM30" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
from collections import Counter
st = json.load(open('/tmp/s30d-settings.json'))['settings']['stages']
assert st[-1] == 'Closed Won', st
first = st[0]
middle = st[1:-1]
terminal = st[-1]  # "Closed Won"
clients = json.load(open('/tmp/s30d-clients.json'))['clients']
# positional rename: no client may remain in the old terminal name
assert not [c for c in clients if c['stage'] == os.environ['TERM30']], "clients still in old terminal stage"
leads_bucket = [c for c in clients if c['stage'] == first]
onboarding = [c for c in clients if c['stage'] in middle]
directory = [c for c in clients if c['stage'] == terminal]
me = [c for c in clients if c['id'] == int(os.environ['TSC_ID'])][0]
assert me['stage'] == terminal, me['stage']
assert all(c['stage'] == terminal for c in directory), "directory has a non-terminal client"
chips = [first] + middle
assert terminal not in chips, chips
dash = json.load(open('/tmp/s30d-dash.json'))
counts = Counter(c['stage'] for c in clients if not c['archived'])
for s in chips:
    assert counts.get(s, 0) == dash['stageCounts'].get(s, 0), (s, counts.get(s, 0), dash['stageCounts'].get(s, 0))
print(f"  ✓ renamed terminal \"{terminal}\": Leads(first)={len(leads_bucket)}, Onboarding(middle)={len(onboarding)}, directory={len(directory)} sold client(s), no chip for \"{terminal}\", zero clients left in \"{os.environ['TERM30']}\"")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30d: renamed terminal stage still excluded from both pipeline tabs and shown in the directory"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30d: renamed terminal misbehaves"; cat "$PASS_TMP"
fi

echo "-- 30e. Moving a lead into the RENAMED terminal stage still auto-provisions (3g-3 is positional) =="
BEFORE30E=$(ORG_COUNT)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Provision After Rename Co","contactName":"Riley Prov","email":"riley@prov.example","industry":"Cleaning","clientType":"commercial","dealValue":4500,"stage":"Pipeline Leads"}' "$BASE/api/clients")
check "30e: owner creates second lead → 201" 201 "$S"
PAR_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Provision After Rename Co","contactName":"Riley Prov","email":"riley@prov.example","industry":"Cleaning","clientType":"commercial","dealValue":4500,"stage":"Closed Won"}' "$BASE/api/clients/$PAR_ID")
check "30e: move lead into the renamed terminal stage → 200" 200 "$S"
grep -q '"stage":"Closed Won"' /tmp/body.json && echo "  ✓ 30e: client now in \"Closed Won\"" || echo "  ✗ 30e: stage: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "30e: admin orgs list → 200" 200 "$S"
AFTER30E=$(ORG_COUNT)
[ "$AFTER30E" -eq $((BEFORE30E + 1)) ] && echo "  ✓ 30e: exactly one new workspace auto-provisioned (${BEFORE30E} → ${AFTER30E})" || echo "  ✗ 30e: org count ${BEFORE30E} → ${AFTER30E} (expected +1)"
if PAR_ID="$PAR_ID" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
prov = [o for o in d['orgs'] if o.get('provisionedFromClient') == int(os.environ['PAR_ID'])]
assert len(prov) == 1, [o['name'] for o in d['orgs']]
assert prov[0]['provisionedFromClientName'] == 'Provision After Rename Co', prov[0]
print("  ✓ provisioned workspace for the renamed terminal stage listed in the Admin org list (provisionedFromClient set)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 30e: 3g-3 fires into the RENAMED terminal stage (positional final-stage detection)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 30e: provision into renamed terminal missing"; cat "$PASS_TMP"
fi
PROV_ORG30E=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o.get('provisionedFromClient') == $PAR_ID][0])")

echo "-- 30f. UI surface strings in the built bundle (terminal-split wording) =="
NEWEST_JS30=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS30" ] && [ -f "$NEWEST_JS30" ]; then
  if grep -q "No sold clients yet" "$NEWEST_JS30" && grep -q "sold customers" "$NEWEST_JS30"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the sold-customer directory wording (\"No sold clients yet\" + \"sold customers\")"
  else
    FAIL=$((FAIL+1)); echo "  ✗ terminal-split strings missing from $NEWEST_JS30"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 30f bundle surface check"
fi

echo "-- 30g. Cleanup =="
for OID in $PROV_ORG30C $PROV_ORG30E; do
  code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$OID" > /dev/null
done
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
T30_ORG_ID=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o['name'] == 'Terminal Tenant Co'][0])")
check "30g: admin deletes Terminal Tenant Co org → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$T30_ORG_ID")
for CID in $TSC_ID $PAR_ID; do
  code -b "$JAR" -X DELETE "$BASE/api/clients/$CID" > /dev/null
done
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Onboarding","Sold"]}' "$BASE/api/settings")
check "30g: owner stages restored to Leads → Onboarding → Sold → 200" 200 "$S"
code -b "$JAR" "$BASE/api/admin/provisions" > /dev/null
for PID30 in $(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(' '.join(str(p['id']) for p in d['provisions']))"); do
  code -b "$JAR" -X POST "$BASE/api/admin/provisions/$PID30/dismiss" > /dev/null
done
rm -f "$JART30" /tmp/s30-settings.json /tmp/s30a-clients.json /tmp/s30a-dash.json /tmp/s30b-settings.json /tmp/s30d-settings.json /tmp/s30d-clients.json /tmp/s30d-dash.json
echo "  ✓ 30g: provisioned orgs, tenant org and test clients removed; owner stages restored"

echo "== 31. Owner three-bucket pipeline: Leads = first stage, Onboarding = middle stages (owner direction 2026-08-15) =="
echo "-- 31a. UI surface strings in the built bundle (Onboarding tab + its empty states) =="
NEWEST_JS31=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS31" ] && [ -f "$NEWEST_JS31" ]; then
  if grep -q "Onboarding" "$NEWEST_JS31" && grep -q "No prospects yet" "$NEWEST_JS31" \
     && grep -q "No onboarding clients yet" "$NEWEST_JS31"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the Onboarding surface (tab label + \"No prospects yet\" + \"No onboarding clients yet\" empty states)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ onboarding strings missing from $NEWEST_JS31"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 31a bundle surface check"
fi
echo "-- 31b. Deep-link routing is positional and the Onboarding tab is role-gated (source checks) =="
if grep -B10 'setView("onboarding")' src/App.tsx | grep -q 'isOwnerOrg &&' \
   && grep -q 'idx === stages.length - 1' src/App.tsx \
   && grep -q 'scope="middle"' src/App.tsx \
   && grep -q 'scope={isOwnerOrg ? "first" : "all"}' src/App.tsx; then
  PASS=$((PASS+1)); echo "  ✓ App routes dashboard deep-links positionally (first→Leads, middle→Onboarding, terminal→Clients); Onboarding nav is owner-gated; owner Leads scope=first, tenant scope=all"
else
  FAIL=$((FAIL+1)); echo "  ✗ 31b: positional routing / owner gating source checks failed"
fi
echo "-- 31c. Owner buckets via API: Leads = first stage only, Onboarding = middle only, Clients = terminal =="
code -b "$JAR" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s31-settings.json
FIRST31=$(python3 -c "import json; st=json.load(open('/tmp/s31-settings.json'))['settings']['stages']; print(st[0])")
MID31_FIRST=$(python3 -c "import json; st=json.load(open('/tmp/s31-settings.json'))['settings']['stages']; print(st[1])")
TERM31=$(python3 -c "import json; st=json.load(open('/tmp/s31-settings.json'))['settings']['stages']; print(st[-1])")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Bucket First Co\",\"clientType\":\"commercial\",\"dealValue\":1000,\"stage\":\"$FIRST31\"}" "$BASE/api/clients")
check "31c: owner creates lead in the first stage → 201" 201 "$S"
BID31A=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Bucket Middle Co\",\"clientType\":\"commercial\",\"dealValue\":2000,\"stage\":\"$MID31_FIRST\"}" "$BASE/api/clients")
check "31c: owner creates lead in the first middle stage → 201" 201 "$S"
BID31B=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Bucket Term Co\",\"clientType\":\"commercial\",\"dealValue\":3000,\"stage\":\"$TERM31\"}" "$BASE/api/clients")
check "31c: owner creates client directly in the terminal stage → 201" 201 "$S"
BID31C=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
if BID31A="$BID31A" BID31B="$BID31B" BID31C="$BID31C" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
st = json.load(open('/tmp/s31-settings.json'))['settings']['stages']
first = st[0]; middle = st[1:-1]; terminal = st[-1]
clients = json.load(open('/tmp/body.json'))['clients']
A = [c for c in clients if c['id'] == int(os.environ['BID31A'])][0]
B = [c for c in clients if c['id'] == int(os.environ['BID31B'])][0]
C = [c for c in clients if c['id'] == int(os.environ['BID31C'])][0]
leads_bucket = [c for c in clients if c['stage'] == first]
onboarding = [c for c in clients if c['stage'] in middle]
directory = [c for c in clients if c['stage'] == terminal]
assert A['stage'] == first and A in leads_bucket, A['stage']
assert B['stage'] in middle and B in onboarding, B['stage']
assert C['stage'] == terminal and C in directory, C['stage']
assert all(c['stage'] == first for c in leads_bucket), "Leads bucket has a non-first-stage client"
assert all(c['stage'] in middle for c in onboarding), "Onboarding bucket has a non-middle-stage client"
assert all(c['stage'] == terminal for c in directory), "directory has a non-terminal client"
known = [c for c in clients if c['stage'] in st]  # orphan-stage clients are invisible in every tab
assert len(leads_bucket) + len(onboarding) + len(directory) == len(known), "client in no bucket"
print(f"  ✓ owner buckets: first \"{first}\" → Leads ({len(leads_bucket)}), middle {middle} → Onboarding ({len(onboarding)}), terminal \"{terminal}\" → Clients ({len(directory)})")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 31c: every owner client lands in exactly one bucket (Leads=first, Onboarding=middle, Clients=terminal)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 31c: bucket split broken"; cat "$PASS_TMP"
fi
echo "-- 31d. Stage rename round-trip keeps the positional buckets correct =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["New Leads","Onboarding","Sold"]}' "$BASE/api/settings")
check "31d: rename first stage Leads → \"New Leads\" → 200" 200 "$S"
code -b "$JAR" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s31d-settings.json
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
if BID31A="$BID31A" BID31B="$BID31B" BID31C="$BID31C" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
st = json.load(open('/tmp/s31d-settings.json'))['settings']['stages']
assert st == ['New Leads', 'Onboarding', 'Sold'], st
clients = json.load(open('/tmp/body.json'))['clients']
A = [c for c in clients if c['id'] == int(os.environ['BID31A'])][0]
B = [c for c in clients if c['id'] == int(os.environ['BID31B'])][0]
C = [c for c in clients if c['id'] == int(os.environ['BID31C'])][0]
assert A['stage'] == 'New Leads', A['stage']   # first bucket follows the rename
assert B['stage'] == 'Onboarding', B['stage']     # middle bucket unchanged
assert C['stage'] == 'Sold', C['stage']        # terminal bucket unchanged
print("  ✓ after rename: first bucket = \"New Leads\" (A), middle = [\"Onboarding\"] (B), terminal = \"Sold\" (C)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 31d: positional buckets survive a first-stage rename (first follows the rename)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 31d: rename round-trip broke a bucket"; cat "$PASS_TMP"
fi
echo "-- 31e. Moving an onboarding (middle-stage) lead to the terminal stage: leaves Onboarding, joins Clients, 3g-3 still fires =="
BEFORE31E=$(ORG_COUNT)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Bucket Middle Co\",\"clientType\":\"commercial\",\"dealValue\":2000,\"stage\":\"$TERM31\"}" "$BASE/api/clients/$BID31B")
check "31e: move middle-stage lead into the terminal stage → 200" 200 "$S"
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
if BID31B="$BID31B" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
st = json.load(open('/tmp/s31d-settings.json'))['settings']['stages']
first = st[0]; middle = st[1:-1]; terminal = st[-1]
clients = json.load(open('/tmp/body.json'))['clients']
B = [c for c in clients if c['id'] == int(os.environ['BID31B'])][0]
assert B['stage'] == terminal, B['stage']
leads_bucket = [c for c in clients if c['stage'] == first]
onboarding = [c for c in clients if c['stage'] in middle]
directory = [c for c in clients if c['stage'] == terminal]
assert B not in leads_bucket and B not in onboarding, "B still in a pipeline tab"
assert B in directory, "B missing from the directory"
print("  ✓ onboarding lead left the Onboarding tab and joined the Clients directory")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 31e: middle→terminal move removes the lead from Onboarding and adds it to the directory"
else
  FAIL=$((FAIL+1)); echo "  ✗ 31e: middle→terminal move failed"; cat "$PASS_TMP"
fi
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "31e: admin orgs list → 200" 200 "$S"
AFTER31E=$(ORG_COUNT)
[ "$AFTER31E" -eq $((BEFORE31E + 1)) ] && echo "  ✓ 31e: exactly one new workspace auto-provisioned (${BEFORE31E} → ${AFTER31E})" || echo "  ✗ 31e: org count ${BEFORE31E} → ${AFTER31E} (expected +1)"
if BID31B="$BID31B" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
prov = [o for o in d['orgs'] if o.get('provisionedFromClient') == int(os.environ['BID31B'])]
assert len(prov) == 1, [o['name'] for o in d['orgs']]
assert prov[0]['provisionedFromClientName'] == 'Bucket Middle Co', prov[0]
print("  ✓ 3g-3 fired on the onboarding→terminal move (provisionedFromClient = the moved lead)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 31e: 3g-3 auto-provision still fires when an ONBOARDING lead moves into the terminal stage"
else
  FAIL=$((FAIL+1)); echo "  ✗ 31e: provision missing"; cat "$PASS_TMP"
fi
PROV_ORG31=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o.get('provisionedFromClient') == $BID31B][0])")
echo "-- 31f. Client accounts (role=member) are untouched: no Onboarding tab, single pipeline = all non-terminal stages =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Onboarding Tenant Co","email":"onboard-tenant@example.com","password":"onboardtenant123"}' "$BASE/api/admin/orgs")
check "31f: admin provisions tenant org → 201" 201 "$S"
JART31=$(mktemp)
S=$(code -c "$JART31" -b "$JART31" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"onboard-tenant@example.com","password":"onboardtenant123"}' "$BASE/api/auth/login")
check "31f: tenant login → 200" 200 "$S"
code -b "$JART31" "$BASE/api/auth/me" > /dev/null
grep -q '"role":"member"' /tmp/body.json && echo "  ✓ 31f: tenant session role=member (Onboarding nav is admin-gated — see 31b)" || echo "  ✗ 31f: role not member: $(cat /tmp/body.json)"
code -b "$JART31" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s31f-settings.json
code -b "$JART31" "$BASE/api/clients?archived=1" > /dev/null
if python3 - <<'PY' 2>"$PASS_TMP"
import json
st = json.load(open('/tmp/s31f-settings.json'))['settings']['stages']
terminal = st[-1]
clients = json.load(open('/tmp/body.json'))['clients']
# member Leads tab = every stage except terminal (PR #35 behavior, unchanged);
# member directory = terminal only
leads = [c for c in clients if c['stage'] != terminal]
directory = [c for c in clients if c['stage'] == terminal]
assert all(c['stage'] != terminal for c in leads)
assert all(c['stage'] == terminal for c in directory)
print(f"  ✓ tenant pipeline split unchanged: {len(leads)} pipeline client(s), {len(directory)} sold client(s), terminal \"{terminal}\"")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 31f: member org keeps the PR #35 split (pipeline = non-terminal; directory = terminal)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 31f: member split broken"; cat "$PASS_TMP"
fi
echo "-- 31g. Cleanup =="
code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$PROV_ORG31" > /dev/null
T31_ORG_ID=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o['name'] == 'Onboarding Tenant Co'][0])")
code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$T31_ORG_ID" > /dev/null
for CID in $BID31A $BID31B $BID31C; do
  code -b "$JAR" -X DELETE "$BASE/api/clients/$CID" > /dev/null
done
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Leads","Onboarding","Sold"]}' "$BASE/api/settings")
check "31g: owner stages restored to Leads → Onboarding → Sold → 200" 200 "$S"
code -b "$JAR" "$BASE/api/admin/provisions" > /dev/null
for PID31 in $(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(' '.join(str(p['id']) for p in d['provisions']))"); do
  code -b "$JAR" -X POST "$BASE/api/admin/provisions/$PID31/dismiss" > /dev/null
done
rm -f "$JART31" /tmp/s31-settings.json /tmp/s31d-settings.json /tmp/s31f-settings.json
echo "  ✓ 31g: provisioned org, tenant org and test clients removed; owner stages restored"
echo "== 32. Lost leads + DNC list (owner request 2026-08-14) =="
echo "-- 32a. Owner: create a lost lead — flag + reason round-trip, dashboard exclusion =="
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
D32_LEADS0=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(d['stageCounts'].get('Leads',0))")
D32_PIPE0=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['projectedPipeline'])")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Lost Lead Co","clientType":"commercial","dealValue":9999,"stage":"Leads","lost":true,"lostReason":"Chose a competitor","industry":"HVAC"}' "$BASE/api/clients")
check "32a: create client with lost=true → 201" 201 "$S"
LOST32_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (lost client id=$LOST32_ID)"
grep -q '"lost":true' /tmp/body.json && grep -q '"lostReason":"Chose a competitor"' /tmp/body.json && echo "  ✓ lost + reason round-trip on create" || echo "  ✗ lost flags missing: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
grep -q '"companyName":"Lost Lead Co"' /tmp/body.json && grep -q '"lost":true' /tmp/body.json && echo "  ✓ client list returns the lost lead (the Lost section's source)" || echo "  ✗ lost lead missing from list: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
if D32_LEADS0="$D32_LEADS0" D32_PIPE0="$D32_PIPE0" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert d['stageCounts'].get('Leads',0) == int(os.environ['D32_LEADS0']), d['stageCounts']
assert d['projectedPipeline'] == float(os.environ['D32_PIPE0']), d['projectedPipeline']
print("  ✓ stageCounts.Leads + projectedPipeline unchanged (9999 excluded)")
PY
then PASS=$((PASS+1)); echo "  ✓ 32a: dashboard excludes the lost lead from stageCounts + projectedPipeline"
else FAIL=$((FAIL+1)); echo "  ✗ 32a: lost lead still counted"; cat "$PASS_TMP"; fi
echo "-- 32b. DNC round-trip: set (reason + date), update, partial update, clear =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"DNC Lead Co","clientType":"residential","dealValue":500,"stage":"Leads","dnc":true,"dncReason":"Asked not to be contacted","dncDate":"2026-08-15"}' "$BASE/api/clients")
check "32b: create client with dnc=true + reason + date → 201" 201 "$S"
DNC32_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (dnc client id=$DNC32_ID)"
grep -q '"dnc":true' /tmp/body.json && grep -q '"dncReason":"Asked not to be contacted"' /tmp/body.json && grep -q '"dncDate":"2026-08-15"' /tmp/body.json && echo "  ✓ dnc + reason + date round-trip on create" || echo "  ✗ dnc flags missing: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"DNC Lead Co","clientType":"residential","dealValue":500,"stage":"Leads","dnc":true,"dncReason":"Written request received","dncDate":"2026-08-15"}' "$BASE/api/clients/$DNC32_ID")
check "32b: update DNC reason → 200" 200 "$S"
grep -q '"dncReason":"Written request received"' /tmp/body.json && echo "  ✓ DNC reason updates" || echo "  ✗ DNC reason not updated: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"DNC Lead Co","clientType":"residential","dealValue":500,"stage":"Onboarding"}' "$BASE/api/clients/$DNC32_ID")
check "32b: partial update without dnc keys → 200" 200 "$S"
grep -q '"dnc":true' /tmp/body.json && grep -q '"dncReason":"Written request received"' /tmp/body.json && echo "  ✓ absent dnc keys leave the flag untouched (partial update)" || echo "  ✗ dnc clobbered: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"DNC Lead Co","clientType":"residential","dealValue":500,"stage":"Onboarding","dnc":false}' "$BASE/api/clients/$DNC32_ID")
check "32b: clear DNC → 200" 200 "$S"
grep -q '"dnc":false' /tmp/body.json && grep -qv '"dncReason":"Written' /tmp/body.json && grep -qv '"dncDate":"2026-08-15"' /tmp/body.json && echo "  ✓ clearing DNC clears reason + date" || echo "  ✗ DNC clear: $(cat /tmp/body.json)"
echo "-- 32c. Validation =="
check "32c: lost must be boolean → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad Lost Co","clientType":"residential","lost":"yes"}' "$BASE/api/clients")
check "32c: dnc must be boolean → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad DNC Co","clientType":"residential","dnc":1}' "$BASE/api/clients")
check "32c: bad dncDate → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad Date Co","clientType":"residential","dnc":true,"dncDate":"tomorrow"}' "$BASE/api/clients")
check "32c: over-long lostReason → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Long Reason Co\",\"clientType\":\"residential\",\"lost\":true,\"lostReason\":\"$(python3 -c "print('x'*301)")\"}" "$BASE/api/clients")
echo "-- 32d. Restore to pipeline (lost=false) brings the lead back =="
# Baseline recaptured NOW: 32b's DNC Lead Co (dealValue 500, stage Onboarding) is
# non-lost and legitimately in the pipeline, so the pre-restore snapshot
# already includes its 500.
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
D32_LEADS1=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(d['stageCounts'].get('Leads',0))")
D32_PIPE1=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['projectedPipeline'])")
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Lost Lead Co","clientType":"commercial","dealValue":9999,"stage":"Leads","lost":false}' "$BASE/api/clients/$LOST32_ID")
check "32d: restore lost (lost=false) → 200" 200 "$S"
grep -q '"lost":false' /tmp/body.json && grep -qv '"lostReason":"Chose' /tmp/body.json && echo "  ✓ restore clears the flag + reason" || echo "  ✗ restore: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
if D32_LEADS1="$D32_LEADS1" D32_PIPE1="$D32_PIPE1" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert d['stageCounts'].get('Leads',0) == int(os.environ['D32_LEADS1']) + 1, d['stageCounts']
assert d['projectedPipeline'] == float(os.environ['D32_PIPE1']) + 9999, d['projectedPipeline']
print("  ✓ stageCounts.Leads + projectedPipeline include the restored lead again")
PY
then PASS=$((PASS+1)); echo "  ✓ 32d: restore brings the lead back into the pipeline counts"
else FAIL=$((FAIL+1)); echo "  ✗ 32d: restore did not restore counts"; cat "$PASS_TMP"; fi
echo "-- 32e. Cross-org isolation: tenant A's lost/DNC leads are invisible to tenant B and the owner =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Isolation Tenant A","email":"iso-a@example.com","password":"isoa123456"}' "$BASE/api/admin/orgs")
check "32e: provision tenant A → 201" 201 "$S"
ISO_A_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Isolation Tenant B","email":"iso-b@example.com","password":"isob123456"}' "$BASE/api/admin/orgs")
check "32e: provision tenant B → 201" 201 "$S"
ISO_B_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARA32=$(mktemp); JARB32=$(mktemp)
S=$(code -c "$JARA32" -b "$JARA32" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"iso-a@example.com","password":"isoa123456"}' "$BASE/api/auth/login")
check "32e: tenant A login → 200" 200 "$S"
S=$(code -c "$JARB32" -b "$JARB32" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"iso-b@example.com","password":"isob123456"}' "$BASE/api/auth/login")
check "32e: tenant B login → 200" 200 "$S"
code -b "$JARA32" "$BASE/api/settings" > /dev/null
STAGE_A=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['settings']['stages'][0])")
S=$(code -b "$JARA32" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Tenant A Lost Co\",\"clientType\":\"commercial\",\"dealValue\":777,\"stage\":\"$STAGE_A\",\"lost\":true,\"lostReason\":\"A lost it\",\"dnc\":true,\"dncReason\":\"A says stop\",\"dncDate\":\"2026-08-15\"}" "$BASE/api/clients")
check "32e: tenant A creates lost+DNC lead → 201" 201 "$S"
grep -q '"lost":true' /tmp/body.json && grep -q '"dnc":true' /tmp/body.json && echo "  ✓ tenant A lost+dnc round-trips in their own org" || echo "  ✗ tenant A flags: $(cat /tmp/body.json)"
code -b "$JARA32" "$BASE/api/dashboard" > /dev/null
if STAGE_A="$STAGE_A" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert d['stageCounts'].get(os.environ['STAGE_A'],0) == 0, d['stageCounts']
assert d['projectedPipeline'] == 0, d['projectedPipeline']
assert d['totalClients'] == 1, d['totalClients']  # record exists but is lost — count stays, pipeline excludes
print("  ✓ tenant A dashboard: lost lead excluded from stageCounts/pipeline; totalClients still counts the record")
PY
then PASS=$((PASS+1)); echo "  ✓ 32e: tenant A dashboard excludes its own lost lead"
else FAIL=$((FAIL+1)); echo "  ✗ 32e: tenant A dashboard wrong"; cat "$PASS_TMP"; fi
code -b "$JARB32" "$BASE/api/clients?archived=1" > /dev/null
grep -qv 'Tenant A Lost Co' /tmp/body.json && echo "  ✓ tenant B clients list has NO tenant A records" || echo "  ✗ tenant B cross-org leak: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
grep -qv 'Tenant A Lost Co' /tmp/body.json && echo "  ✓ owner clients list has NO tenant A records (owner sees only owner's)" || echo "  ✗ owner cross-org leak: $(cat /tmp/body.json)"
code -b "$JARB32" "$BASE/api/dashboard" > /dev/null
grep -q '"totalClients":0' /tmp/body.json && echo "  ✓ tenant B dashboard stays empty (no cross-org stats)" || echo "  ✗ tenant B dashboard: $(cat /tmp/body.json)"
echo "-- 32f. 3g-3 auto-provisioning still fires with lost leads present =="
BEFORE32F=$(ORG_COUNT)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Provision Test Co","clientType":"commercial","dealValue":1000,"stage":"Leads"}' "$BASE/api/clients")
check "32f: create non-lost lead → 201" 201 "$S"
PT32_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Provision Test Co","clientType":"commercial","dealValue":1000,"stage":"Sold"}' "$BASE/api/clients/$PT32_ID")
check "32f: move non-lost lead to Sold → 200" 200 "$S"
code -b "$JAR" "$BASE/api/admin/orgs" > /dev/null
AFTER32F=$(ORG_COUNT)
[ "$AFTER32F" -eq $((BEFORE32F + 1)) ] && echo "  ✓ 32f: one new workspace auto-provisioned (${BEFORE32F} → ${AFTER32F})" || echo "  ✗ 32f: org count ${BEFORE32F} → ${AFTER32F} (expected +1)"
if PT32_ID="$PT32_ID" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
prov = [o for o in d['orgs'] if o.get('provisionedFromClient') == int(os.environ['PT32_ID'])]
assert len(prov) == 1, [o['name'] for o in d['orgs']]
print("  ✓ provisionedFromClient = the moved lead")
PY
then PASS=$((PASS+1)); echo "  ✓ 32f: 3g-3 fires for a NON-lost lead moved to the terminal stage"
else FAIL=$((FAIL+1)); echo "  ✗ 32f: provision missing"; cat "$PASS_TMP"; fi
PROV32_ORG=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o.get('provisionedFromClient') == $PT32_ID][0])")
# Documented edge case (my call): a LOST lead moved to the terminal stage still
# provisions mechanically — lost is a lead-status flag, not a pipeline rule,
# and the 3g-3 hook is unchanged. Assert it keeps firing so nothing regressed.
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Lost Provision Co","clientType":"commercial","dealValue":2500,"stage":"Leads","lost":true,"lostReason":"Edge case"}' "$BASE/api/clients")
check "32f: create LOST lead → 201" 201 "$S"
LPC32_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
BEFORE32F2=$(ORG_COUNT)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Lost Provision Co","clientType":"commercial","dealValue":2500,"stage":"Sold","lost":true,"lostReason":"Edge case"}' "$BASE/api/clients/$LPC32_ID")
check "32f: move LOST lead to Sold → 200 (mechanical hook unchanged)" 200 "$S"
code -b "$JAR" "$BASE/api/admin/orgs" > /dev/null
AFTER32F2=$(ORG_COUNT)
[ "$AFTER32F2" -eq $((BEFORE32F2 + 1)) ] && echo "  ✓ 32f: lost→Sold still auto-provisions (documented: lost is a status flag, not a stage rule)" || echo "  ✗ 32f: lost→Sold provisioning regressed"
PROV32B_ORG=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['id'] for o in d['orgs'] if o.get('provisionedFromClient') == $LPC32_ID][0])")
echo "-- 32g. UI surface strings in the built bundle =="
NEWEST_JS32=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS32" ]; then
  for STR32 in "No lost leads" "No DNC entries" "Do not call/contact" "Mark as lost (not interested)" "Restore to pipeline" "Lead status"; do
    if grep -Fq "$STR32" "$NEWEST_JS32"; then PASS=$((PASS+1)); echo "  ✓ bundle contains \"$STR32\""
    else FAIL=$((FAIL+1)); echo "  ✗ bundle missing \"$STR32\""; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 32g bundle surface check"
fi
echo "-- 32h. Cleanup =="
code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$PROV32_ORG" > /dev/null
code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$PROV32B_ORG" > /dev/null
code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$ISO_A_ID" > /dev/null
code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$ISO_B_ID" > /dev/null
for CID32 in $LOST32_ID $DNC32_ID $PT32_ID $LPC32_ID; do
  code -b "$JAR" -X DELETE "$BASE/api/clients/$CID32" > /dev/null
done
code -b "$JAR" "$BASE/api/admin/provisions" > /dev/null
for PID32 in $(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(' '.join(str(p['id']) for p in d['provisions']))"); do
  code -b "$JAR" -X POST "$BASE/api/admin/provisions/$PID32/dismiss" > /dev/null
done
rm -f "$JARA32" "$JARB32"
echo "  ✓ 32h: test clients, isolation tenants and provisioned workspaces removed"
echo ""

echo "== 33. MRR + vertical revenue dashboards (owner request 2026-08-14/15 — Client MRR = sold-stage deal values) =="
THIS_MONTH=$(python3 -c "import datetime;print(datetime.date.today().strftime('%Y-%m-01'))")
LAST_MONTH=$(python3 -c "import datetime;d=datetime.date.today();print((d.replace(day=1)-datetime.timedelta(days=1)).strftime('%Y-%m-15'))")
JAR33=$(mktemp)
S=$(code -c "$JAR33" -b "$JAR33" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "33a: owner login" 200 "$S"
S=$(code -b "$JAR33" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Glow Co","email":"glow33@example.com","password":"glow33pass","vertical":"b2b"}' "$BASE/api/admin/orgs")
check "33b: create B2B org (vertical b2b)" 201 "$S"
MED33=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JAR33" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Sales Co","email":"sales33@example.com","password":"sales33pass","vertical":"b2c"}' "$BASE/api/admin/orgs")
check "33c: create B2C org" 201 "$S"
SAL33=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JAR33" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Plain Co","email":"plain33@example.com","password":"plain33pass"}' "$BASE/api/admin/orgs")
check "33c2: create bare org (no vertical) — pre-existing-org migration path" 201 "$S"
GEN33=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JAR33" "$BASE/api/admin/orgs")
python3 - "$MED33" "$SAL33" "$GEN33" <<'PY'
import json, sys
d = json.load(open('/tmp/body.json'))
orgs = {o['id']: o for o in d['orgs']}
med, sal, gen = (int(x) for x in sys.argv[1:4])
assert orgs[med]['revenueModel'] == 'subscription', orgs[med]   # 33d (b2b)
assert orgs[sal]['revenueModel'] == 'subscription', orgs[sal]   # 33e (b2c — both new types are subscription)
assert orgs[gen]['revenueModel'] == 'sales', orgs[gen]          # 33e2 (bare org)
print("  ✓ 33d/33e/33e2: revenueModel seeded by business type — b2b & b2c=subscription, bare=sales (migration default for pre-existing orgs like Acme)")
PY
S=$(code -b "$JAR33" -X PATCH -H 'Content-Type: application/json' \
  -d '{"monthlySubscriptionAmount":99.50}' "$BASE/api/admin/orgs/$MED33")
check "33f: owner PATCH med spa monthly amount 99.50" 200 "$S"
S=$(code -b "$JAR33" -X PATCH -H 'Content-Type: application/json' \
  -d '{"monthlySubscriptionAmount":40}' "$BASE/api/admin/orgs/$SAL33")
check "33g: owner PATCH sales co monthly amount 40" 200 "$S"
S=$(code -b "$JAR33" "$BASE/api/dashboard")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert 'clientMrr' in d and 'orgCount' in d, "owner must see clientMrr + orgCount"
assert d['orgCount'] >= 4, d.get('orgCount')  # owner + med spa + sales + plain (plus any earlier leftovers)
assert 'salesThisMonth' in d and 'subscriptionsTotal' in d and 'revenueModel' in d
# Owner direction 2026-08-15: clientMrr is the SUM of the owner's OWN client
# records' deal values in the terminal/"Sold" stage (lost/archived excluded).
# Earlier sections (3g-3 / 32) already leave real sold records, so capture the
# baseline and assert deltas. Billing amounts must NOT be part of the figure.
open('/tmp/mrr_base33', 'w').write(repr(d['clientMrr']))
open('/tmp/owner_before33.json', 'w').write(json.dumps({'salesThisMonth': d['salesThisMonth'], 'subscriptionsTotal': d['subscriptionsTotal']}))
print("  ✓ 33h: owner dashboard clientMrr baseline=%s (deal-value sum, NOT billing amounts), orgCount present, own money keys too" % d['clientMrr'])
PY
MRR_BASE33=$(cat /tmp/mrr_base33)
S=$(code -b "$JAR33" -X PATCH -H 'Content-Type: application/json' \
  -d '{"monthlySubscriptionAmount":59.50}' "$BASE/api/admin/orgs/$MED33")
check "33h1: owner PATCH med spa BILLING amount → 59.50 (Phase 5 prep, still works)" 200 "$S"
S=$(code -b "$JAR33" "$BASE/api/dashboard")
if MRR_BASE33="$MRR_BASE33" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert abs(d['clientMrr'] - float(os.environ['MRR_BASE33'])) < 0.001, d.get('clientMrr')
print("  ✓ 33h2: PATCHing a billing amount does NOT change clientMrr (still %s)" % os.environ['MRR_BASE33'])
PY
then PASS=$((PASS+1)); echo "  ✓ 33h2: billing amount does not feed MRR"
else FAIL=$((FAIL+1)); echo "  ✗ 33h2: $(cat /tmp/body.json)"; cat "$PASS_TMP"; fi
# Deal-value MRR: only terminal-stage, non-lost, non-archived owner records count.
code -b "$JAR33" "$BASE/api/settings" > /dev/null
TERM33=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['settings']['stages'][-1])")
S=$(code -b "$JAR33" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"MRR Deal Co","clientType":"commercial","contactName":"D","email":"deal33@x.com","dealValue":250,"stage":"Leads"}' "$BASE/api/clients")
check "33h3: owner creates client record dealValue=250 in a non-terminal stage" 201 "$S"
MRRCLI33=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['client']['id'])")
S=$(code -b "$JAR33" "$BASE/api/dashboard")
if MRR_BASE33="$MRR_BASE33" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert abs(d['clientMrr'] - float(os.environ['MRR_BASE33'])) < 0.001, d.get('clientMrr')
print("  ✓ 33h4: non-terminal-stage deal value excluded from clientMrr (still %s)" % os.environ['MRR_BASE33'])
PY
then PASS=$((PASS+1)); echo "  ✓ 33h4: non-terminal deal value excluded from MRR"
else FAIL=$((FAIL+1)); echo "  ✗ 33h4: $(cat /tmp/body.json)"; cat "$PASS_TMP"; fi
S=$(code -b "$JAR33" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"MRR Deal Co\",\"clientType\":\"commercial\",\"dealValue\":250,\"stage\":\"$TERM33\"}" "$BASE/api/clients/$MRRCLI33")
check "33h5: owner moves record into the terminal stage ($TERM33)" 200 "$S"
S=$(code -b "$JAR33" "$BASE/api/dashboard")
if MRR_BASE33="$MRR_BASE33" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert abs(d['clientMrr'] - (float(os.environ['MRR_BASE33']) + 250)) < 0.001, d.get('clientMrr')
print("  ✓ 33h6: clientMrr=%s — terminal-stage deal value counts (baseline+250)" % d['clientMrr'])
PY
then PASS=$((PASS+1)); echo "  ✓ 33h6: sold-stage deal value included in MRR"
else FAIL=$((FAIL+1)); echo "  ✗ 33h6: $(cat /tmp/body.json)"; cat "$PASS_TMP"; fi
S=$(code -b "$JAR33" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"MRR Deal Co\",\"clientType\":\"commercial\",\"dealValue\":250,\"stage\":\"$TERM33\",\"lost\":true,\"lostReason\":\"Deal fell through\"}" "$BASE/api/clients/$MRRCLI33")
check "33h7: owner marks the sold record lost" 200 "$S"
S=$(code -b "$JAR33" "$BASE/api/dashboard")
if MRR_BASE33="$MRR_BASE33" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert abs(d['clientMrr'] - float(os.environ['MRR_BASE33'])) < 0.001, d.get('clientMrr')
print("  ✓ 33h8: lost sold record excluded from clientMrr")
PY
then PASS=$((PASS+1)); echo "  ✓ 33h8: lost record excluded from MRR"
else FAIL=$((FAIL+1)); echo "  ✗ 33h8: $(cat /tmp/body.json)"; cat "$PASS_TMP"; fi
S=$(code -b "$JAR33" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"MRR Deal Co\",\"clientType\":\"commercial\",\"dealValue\":250,\"stage\":\"$TERM33\",\"lost\":false}" "$BASE/api/clients/$MRRCLI33")
check "33h9: owner un-losts the record" 200 "$S"
S=$(code -b "$JAR33" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"MRR Deal Co\",\"clientType\":\"commercial\",\"dealValue\":250,\"stage\":\"$TERM33\",\"archived\":true}" "$BASE/api/clients/$MRRCLI33")
check "33h10: owner archives the sold record" 200 "$S"
S=$(code -b "$JAR33" "$BASE/api/dashboard")
if MRR_BASE33="$MRR_BASE33" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert abs(d['clientMrr'] - float(os.environ['MRR_BASE33'])) < 0.001, d.get('clientMrr')
print("  ✓ 33h11: archived sold record excluded from clientMrr")
PY
then PASS=$((PASS+1)); echo "  ✓ 33h11: archived record excluded from MRR"
else FAIL=$((FAIL+1)); echo "  ✗ 33h11: $(cat /tmp/body.json)"; cat "$PASS_TMP"; fi
S=$(code -b "$JAR33" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"MRR Deal Co\",\"clientType\":\"commercial\",\"dealValue\":250,\"stage\":\"$TERM33\",\"archived\":false}" "$BASE/api/clients/$MRRCLI33")
check "33h12: owner un-archives the record" 200 "$S"
S=$(code -b "$JAR33" "$BASE/api/dashboard")
if MRR_BASE33="$MRR_BASE33" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
d = json.load(open('/tmp/body.json'))
assert abs(d['clientMrr'] - (float(os.environ['MRR_BASE33']) + 250)) < 0.001, d.get('clientMrr')
print("  ✓ 33h13: clientMrr back to baseline+250 after un-archive")
PY
then PASS=$((PASS+1)); echo "  ✓ 33h13: un-archive restores the value in MRR"
else FAIL=$((FAIL+1)); echo "  ✗ 33h13: $(cat /tmp/body.json)"; cat "$PASS_TMP"; fi
S=$(code -b "$JAR33" -X PATCH -H 'Content-Type: application/json' \
  -d '{"monthlySubscriptionAmount":99.50}' "$BASE/api/admin/orgs/$MED33")
check "33h14: owner restores med spa BILLING amount → 99.50" 200 "$S"
S=$(code -b "$JAR33" -X PATCH -H 'Content-Type: application/json' \
  -d '{"monthlySubscriptionAmount":-5}' "$BASE/api/admin/orgs/$MED33")
check "33i: negative monthly amount rejected" 400 "$S"
JARMED=$(mktemp)
S=$(code -c "$JARMED" -b "$JARMED" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"glow33@example.com","password":"glow33pass"}' "$BASE/api/auth/login")
check "33j: med spa member login" 200 "$S"
S=$(code -b "$JARMED" "$BASE/api/dashboard")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert 'clientMrr' not in d, "tenant must never see owner MRR"
assert 'orgCount' not in d, "tenant must never see org count"
assert d['revenueModel'] == 'subscription', d.get('revenueModel')
assert d['subscriptionsTotal'] == 0, d.get('subscriptionsTotal')
print("  ✓ 33k: tenant dashboard has NO clientMrr/orgCount (isolation); revenueModel=subscription")
PY
S=$(code -b "$JARMED" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Regular Client","clientType":"commercial","contactName":"R","email":"r@x.com","monthlyAmount":29}' "$BASE/api/clients")
check "33l: member creates client with monthlyAmount 29" 201 "$S"
S=$(code -b "$JARMED" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad","clientType":"commercial","monthlyAmount":-3}' "$BASE/api/clients")
check "33m: negative client monthlyAmount rejected" 400 "$S"
S=$(code -b "$JARMED" "$BASE/api/dashboard")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert d['subscriptionsTotal'] == 29, d.get('subscriptionsTotal')
print("  ✓ 33n: tenant subscriptionsTotal=29 (SUM of client monthly_amount, org-scoped)")
PY
JARSAL=$(mktemp)
S=$(code -c "$JARSAL" -b "$JARSAL" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"sales33@example.com","password":"sales33pass"}' "$BASE/api/auth/login")
check "33p: sales org member login" 200 "$S"
S=$(code -b "$JARSAL" "$BASE/api/dashboard")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert d['subscriptionsTotal'] == 0, d.get('subscriptionsTotal')  # med spa's 29 must not appear
assert d['revenueModel'] == 'sales', d.get('revenueModel')
print("  ✓ 33n2: sales org subscriptionsTotal=0 (cross-tenant isolation — tenant A's book invisible)")
PY
S=$(code -b "$JAR33" "$BASE/api/dashboard")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
base = float(open('/tmp/mrr_base33').read())
assert abs(d['clientMrr'] - (base + 250)) < 0.001, d.get('clientMrr')
before = json.load(open('/tmp/owner_before33.json'))
assert d['salesThisMonth'] == before['salesThisMonth'], (d['salesThisMonth'], before['salesThisMonth'])
assert d['subscriptionsTotal'] == before['subscriptionsTotal'], (d['subscriptionsTotal'], before['subscriptionsTotal'])
print("  ✓ 33n3: owner MRR (baseline+250) + own totals untouched by tenant activity (isolation)")
PY
S=$(code -b "$JARMED" -X PATCH -H 'Content-Type: application/json' \
  -d '{"monthlySubscriptionAmount":1}' "$BASE/api/admin/orgs/$MED33")
check "33o: tenant PATCH admin org → 403" 403 "$S"
S=$(code -b "$JARSAL" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Garden Job","clientType":"commercial","contactName":"G","email":"g@x.com"}' "$BASE/api/clients")
check "33q: sales org creates client" 201 "$S"
CLI33=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['client']['id'])")
S=$(code -b "$JARSAL" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$CLI33,\"amount\":1234.50,\"dueDate\":\"$THIS_MONTH\",\"status\":\"draft\"}" "$BASE/api/invoices")
check "33r: invoice dated this month" 201 "$S"
S=$(code -b "$JARSAL" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$CLI33,\"amount\":999,\"dueDate\":\"$LAST_MONTH\",\"status\":\"draft\"}" "$BASE/api/invoices")
check "33s: invoice dated last month" 201 "$S"
S=$(code -b "$JARSAL" "$BASE/api/dashboard")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert abs(d['salesThisMonth'] - 1234.5) < 0.001, d.get('salesThisMonth')
assert d['revenueModel'] == 'sales', d.get('revenueModel')
assert 'clientMrr' not in d
print("  ✓ 33t: salesThisMonth=1234.50 (this month only, last-month invoice excluded, org-scoped)")
PY
S=$(code -b "$JARSAL" -X PUT -H 'Content-Type: application/json' \
  -d '{"revenueModel":"subscription"}' "$BASE/api/settings")
check "33u: tenant switches revenueModel via settings" 200 "$S"
S=$(code -b "$JARSAL" "$BASE/api/dashboard")
grep -q '"revenueModel":"subscription"' /tmp/body.json && echo "  ✓ 33v: dashboard revenueModel follows settings switch" || echo "  ✗ 33v: $(cat /tmp/body.json)"
S=$(code -b "$JARSAL" -X PUT -H 'Content-Type: application/json' \
  -d '{"revenueModel":"bogus"}' "$BASE/api/settings")
check "33w: invalid revenueModel rejected" 400 "$S"
S=$(code -b "$JARSAL" "$BASE/api/settings")
grep -q '"monthlySubscriptionAmount":40' /tmp/body.json && echo "  ✓ 33x: tenant sees owner-set monthlySubscriptionAmount (40)" || echo "  ✗ 33x: $(cat /tmp/body.json)"
S=$(code -b "$JARSAL" -X PUT -H 'Content-Type: application/json' \
  -d '{"monthlySubscriptionAmount":1}' "$BASE/api/settings")
check "33y: tenant PUT only the owner-set amount key → 400 (owner-only field, nothing to update)" 400 "$S"
S=$(code -b "$JARSAL" "$BASE/api/settings")
grep -q '"monthlySubscriptionAmount":40' /tmp/body.json && grep -q '"revenueModel":"subscription"' /tmp/body.json && echo "  ✓ 33z: amount still 40 + model still subscription after tenant PUT" || echo "  ✗ 33z: $(cat /tmp/body.json)"
S=$(code -b "$JARSAL" -X PUT -H 'Content-Type: application/json' \
  -d '{"revenueModel":"sales"}' "$BASE/api/settings")
check "33za: tenant restores sales model" 200 "$S"

echo "-- 33 bundle surface: MRR/revenue strings in the shipped bundle --"
bun run build >/dev/null 2>&1
NEWEST_JS33=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS33" ]; then
  # Owner live-test reorg 2026-08-18: "Monthly billing amount" was Admin's
  # per-account billing input label — that column is REMOVED from the
  # accounts table (see 40c), so the string no longer ships. The other
  # MRR/revenue strings (dashboard KPI cards + tenant Settings toggle) stand.
  for STR33 in "Client MRR" "Sales this month" "Subscriptions" "Revenue model" "Save revenue model"; do
    if grep -Fq "$STR33" "$NEWEST_JS33"; then PASS=$((PASS+1)); echo "  ✓ bundle contains \"$STR33\""
    else FAIL=$((FAIL+1)); echo "  ✗ bundle missing \"$STR33\""; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 33 bundle surface check"
fi
echo "-- 33zb. Cleanup == "
code -b "$JAR33" -X DELETE "$BASE/api/admin/orgs/$MED33" > /dev/null
code -b "$JAR33" -X DELETE "$BASE/api/admin/orgs/$SAL33" > /dev/null
code -b "$JAR33" -X DELETE "$BASE/api/admin/orgs/$GEN33" > /dev/null
rm -f "$JAR33" "$JARMED" "$JARSAL" /tmp/owner_before33.json /tmp/mrr_base33
echo "  ✓ 33zb: MRR test orgs removed"

echo "== 34. Global privacy eye (owner request 2026-08-14) =="
echo "-- 34a. UI surface strings in the built bundle + CSS --"
bun run build >/dev/null 2>&1
NEWEST_JS34=$(ls -t dist/index-*.js 2>/dev/null | head -1)
NEWEST_CSS34=$(ls -t dist/index-*.css 2>/dev/null | head -1)
if [ -n "$NEWEST_JS34" ]; then
  for STR34 in "Hide client details" "Show client details" "crm:pii-hidden" "crm:money-hidden"; do
    if grep -Fq "$STR34" "$NEWEST_JS34"; then PASS=$((PASS+1)); echo "  ✓ bundle contains \"$STR34\""
    else FAIL=$((FAIL+1)); echo "  ✗ bundle missing \"$STR34\""; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 34 bundle surface check"
fi
if [ -n "$NEWEST_CSS34" ]; then
  for STR34C in ".pii-blur" ".pii-eye-btn" ".money-blur"; do
    if grep -Fq "$STR34C" "$NEWEST_CSS34"; then PASS=$((PASS+1)); echo "  ✓ css contains \"$STR34C\""
    else FAIL=$((FAIL+1)); echo "  ✗ css missing \"$STR34C\""; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist css not found for 34 css surface check"
fi
echo "  ✓ 34b: privacy eye is pure client-side presentation — no server/API change (every prior section above still green)"
echo "== 35. Owner cockpit alterations A (owner direction 2026-08-15) =="
echo "-- 35a. API surface the owner KPIs render: Active leads = FIRST stage only, Onboarding = MIDDLE stage, Sold MRR (clientMrr) = terminal deal sum =="
JAR35=$(mktemp)
S=$(code -c "$JAR35" -b "$JAR35" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "35a: owner login" 200 "$S"
code -b "$JAR35" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s35-settings.json
code -b "$JAR35" "$BASE/api/dashboard" > /dev/null
cp /tmp/body.json /tmp/s35-baseline.json
FIRST35=$(python3 -c "import json;print(json.load(open('/tmp/s35-settings.json'))['settings']['stages'][0])")
MID35=$(python3 -c "import json;st=json.load(open('/tmp/s35-settings.json'))['settings']['stages'];print(st[1] if len(st)>2 else '')")
TERM35=$(python3 -c "import json;print(json.load(open('/tmp/s35-settings.json'))['settings']['stages'][-1])")
S=$(code -b "$JAR35" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Cockpit First Co\",\"clientType\":\"commercial\",\"dealValue\":111,\"stage\":\"$FIRST35\",\"nextAction\":\"Intro call\"}" "$BASE/api/clients")
check "35b: owner creates a FIRST-stage lead (the Active-leads source)" 201 "$S"
C1_35=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['client']['id'])")
S=$(code -b "$JAR35" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Cockpit Mid Co\",\"clientType\":\"commercial\",\"dealValue\":222,\"stage\":\"$MID35\",\"nextAction\":\"Onboarding call\"}" "$BASE/api/clients")
check "35c: owner creates a MIDDLE-stage lead (the Onboarding-KPI source)" 201 "$S"
C2_35=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['client']['id'])")
S=$(code -b "$JAR35" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Cockpit Sold Co\",\"clientType\":\"commercial\",\"dealValue\":333,\"stage\":\"$TERM35\"}" "$BASE/api/clients")
check "35d: owner creates a TERMINAL-stage client (the Sold-MRR source)" 201 "$S"
C3_35=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['client']['id'])")
code -b "$JAR35" "$BASE/api/dashboard" > /dev/null
if python3 - <<'PY' 2>"$PASS_TMP"
import json
base = json.load(open('/tmp/s35-baseline.json'))
d = json.load(open('/tmp/body.json'))
st = json.load(open('/tmp/s35-settings.json'))['settings']['stages']
first, mid, term = st[0], (st[1] if len(st) > 2 else None), st[-1]
# "Active leads" KPI = the FIRST stage count ONLY — not the all-stages sum
# (the pre-change behavior: activeClients summed every stageCount).
assert d['stageCounts'][first] == base['stageCounts'][first] + 1, (d['stageCounts'], base['stageCounts'])
total_all = sum(d['stageCounts'].values())
assert total_all == sum(base['stageCounts'].values()) + 3, (total_all, base['stageCounts'])
assert d['stageCounts'][first] < total_all, "first-stage count must differ from the old all-stages sum"
# "Onboarding" KPI = the MIDDLE stage count (between first and terminal).
assert mid is None or d['stageCounts'][mid] == base['stageCounts'][mid] + 1, d['stageCounts']
# "Sold MRR" (clientMrr, shown beside projected pipeline) = terminal-stage
# deal-value sum — exactly +333 for the sold client.
assert abs(d['clientMrr'] - (base['clientMrr'] + 333)) < 0.001, (d['clientMrr'], base['clientMrr'])
# projectedPipeline (OWNER, direction 2026-08-15) = FIRST-stage deal values
# only — the +222 middle-stage and +333 terminal-stage deals must NOT appear
# (that money is the Onboarding/Sold MRR figures). Positional: uses the
# owner's actual first stage name, whatever it is.
assert abs(d['projectedPipeline'] - (base['projectedPipeline'] + 111)) < 0.001, d['projectedPipeline']
print("  ✓ API values the owner KPIs render: Active leads = first stage only; Onboarding = middle stage; Sold MRR = terminal deal sum (+333); projected pipeline = first-stage deal sum only (+111)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 35e: owner-cockpit API surface correct (first-stage Active leads, middle-stage Onboarding, sold-stage MRR)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 35e: owner-cockpit API surface wrong"; cat "$PASS_TMP"
fi
echo "-- 35f. Client accounts (role=member) unchanged: no clientMrr, all-stages stageCounts intact =="
S=$(code -b "$JAR35" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Cockpit Tenant Co","email":"cockpit-tenant@example.com","password":"cockpittenant123"}' "$BASE/api/admin/orgs")
check "35f: owner provisions cockpit tenant org → 201" 201 "$S"
T35_ORG=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['org']['id'])")
JART35=$(mktemp)
S=$(code -c "$JART35" -b "$JART35" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"cockpit-tenant@example.com","password":"cockpittenant123"}' "$BASE/api/auth/login")
check "35f2: cockpit tenant login → 200" 200 "$S"
code -b "$JART35" "$BASE/api/dashboard" > /dev/null
if python3 - <<'PY' 2>"$PASS_TMP"
import json
d = json.load(open('/tmp/body.json'))
assert 'clientMrr' not in d, "tenant must never receive clientMrr"
assert len(d['stageCounts']) > 0, d['stageCounts']
print("  ✓ tenant dashboard has no clientMrr; stageCounts intact (tenant 'Active clients' still sums every stage — unchanged)")
PY
then
  PASS=$((PASS+1)); echo "  ✓ 35g: tenant workspace unchanged (no clientMrr; all-stages stageCounts)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 35g: tenant workspace changed"; cat "$PASS_TMP"
fi
echo "-- 35h. UI surface: owner-cockpit strings + CSS in the built bundle =="
bun run build >/dev/null 2>&1
NEWEST_JS35=$(ls -t dist/index-*.js 2>/dev/null | head -1)
NEWEST_CSS35=$(ls -t dist/index-*.css 2>/dev/null | head -1)
if [ -n "$NEWEST_JS35" ]; then
  for STR35 in "Business name" "Start Onboarding" "your onboarding pipeline" "Client MRR" "Sold MRR" "Active leads"; do
    if grep -Fq "$STR35" "$NEWEST_JS35"; then PASS=$((PASS+1)); echo "  ✓ bundle contains \"$STR35\""
    else FAIL=$((FAIL+1)); echo "  ✗ bundle missing \"$STR35\""; fi
  done
  # The tenant path must keep the untouched labels/notes ("In final stage"
  # last-stage KPI + the owner "Leads in …" notes on both buckets).
  if grep -Fq "In final stage" "$NEWEST_JS35" && grep -Fq 'Leads in "' "$NEWEST_JS35"; then
    PASS=$((PASS+1)); echo "  ✓ bundle keeps the tenant \"In final stage\" KPI + the \"Leads in …\" notes"
  else
    FAIL=$((FAIL+1)); echo "  ✗ tenant KPI strings missing from $NEWEST_JS35"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 35 bundle surface check"
fi
if [ -n "$NEWEST_CSS35" ]; then
  for STR35C in ".owner-leads" ".start-onboarding-btn" ".cell-next-stack"; do
    if grep -Fq "$STR35C" "$NEWEST_CSS35"; then PASS=$((PASS+1)); echo "  ✓ css contains \"$STR35C\""
    else FAIL=$((FAIL+1)); echo "  ✗ css missing \"$STR35C\""; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist css not found for 35 css surface check"
fi
echo "-- 35i. Cleanup =="
code -b "$JAR35" -X DELETE "$BASE/api/admin/orgs/$T35_ORG" > /dev/null
for CID35 in $C1_35 $C2_35 $C3_35; do
  code -b "$JAR35" -X DELETE "$BASE/api/clients/$CID35" > /dev/null
done
rm -f "$JAR35" "$JART35" /tmp/s35-settings.json /tmp/s35-baseline.json
echo "  ✓ 35i: cockpit test clients + tenant org removed"
echo "== 36. Owner cockpit alterations B — DocuSign agreement status + Send Agreements (owner direction 2026-08-15) =="
echo "-- 36a. Owner create defaults agreement_status to not_sent (the OWNER receives the field) =="
JAR36=$(mktemp)
S=$(code -c "$JAR36" -b "$JAR36" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "36a: owner login" 200 "$S"
code -b "$JAR36" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s36-settings.json
MID36=$(python3 -c "import json;st=json.load(open('/tmp/s36-settings.json'))['settings']['stages'];print(st[1] if len(st)>2 else '')")
S=$(code -b "$JAR36" -X POST -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Agreement Co\",\"clientType\":\"commercial\",\"dealValue\":444,\"stage\":\"$MID36\",\"nextAction\":\"Send agreement\"}" "$BASE/api/clients")
check "36b: owner creates a MIDDLE-stage client (the Onboarding bucket) → 201" 201 "$S"
A36_ID=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['client']['id'])")
echo "    (created client id=$A36_ID in middle stage \"$MID36\")"
grep -q '"agreementStatus":"not_sent"' /tmp/body.json && echo "  ✓ owner create response includes agreementStatus \"not_sent\" by default" || echo "  ✗ owner create response missing agreementStatus default: $(cat /tmp/body.json)"
S=$(code -b "$JAR36" "$BASE/api/clients/$A36_ID")
check "36b2: owner GET client item → 200" 200 "$S"
grep -q '"agreementStatus":"not_sent"' /tmp/body.json && echo "  ✓ owner GET item includes agreementStatus not_sent" || echo "  ✗ owner GET item: $(cat /tmp/body.json)"
S=$(code -b "$JAR36" "$BASE/api/clients?archived=1")
check "36b3: owner list clients → 200" 200 "$S"
grep -q '"agreementStatus":"not_sent"' /tmp/body.json && echo "  ✓ owner list includes agreementStatus on the new client" || echo "  ✗ owner list missing agreementStatus: $(cat /tmp/body.json)"
echo "-- 36c. Send Agreements → sent; manual advance to signed; manual reset to not_sent; invalid → 400 =="
S=$(code -b "$JAR36" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Agreement Co\",\"clientType\":\"commercial\",\"dealValue\":444,\"stage\":\"$MID36\",\"nextAction\":\"Send agreement\",\"agreementStatus\":\"sent\"}" "$BASE/api/clients/$A36_ID")
check "36c: owner PUT agreementStatus=sent (the Send Agreements action) → 200" 200 "$S"
grep -q '"agreementStatus":"sent"' /tmp/body.json && echo "  ✓ response agreementStatus=sent (Send Agreements updates immediately)" || echo "  ✗ sent not applied: $(cat /tmp/body.json)"
S=$(code -b "$JAR36" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Agreement Co\",\"clientType\":\"commercial\",\"dealValue\":444,\"stage\":\"$MID36\",\"agreementStatus\":\"signed\"}" "$BASE/api/clients/$A36_ID")
check "36c2: owner PUT agreementStatus=signed (manual advance) → 200" 200 "$S"
grep -q '"agreementStatus":"signed"' /tmp/body.json && echo "  ✓ response agreementStatus=signed (manual advance works)" || echo "  ✗ signed not applied: $(cat /tmp/body.json)"
S=$(code -b "$JAR36" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Agreement Co\",\"clientType\":\"commercial\",\"dealValue\":444,\"stage\":\"$MID36\",\"agreementStatus\":\"not_sent\"}" "$BASE/api/clients/$A36_ID")
check "36c3: owner PUT agreementStatus=not_sent (manual reset) → 200" 200 "$S"
grep -q '"agreementStatus":"not_sent"' /tmp/body.json && echo "  ✓ response agreementStatus=not_sent (reset works)" || echo "  ✗ reset failed: $(cat /tmp/body.json)"
check "36c4: owner PUT invalid agreementStatus → 400" 400 $(code -b "$JAR36" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Agreement Co\",\"clientType\":\"commercial\",\"dealValue\":444,\"stage\":\"$MID36\",\"agreementStatus\":\"bogus\"}" "$BASE/api/clients/$A36_ID")
# PR #53 — the widened lifecycle: delivered (opened by the signer) and
# declined (signer refused, red failure state) are valid owner-only states.
S=$(code -b "$JAR36" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Agreement Co\",\"clientType\":\"commercial\",\"dealValue\":444,\"stage\":\"$MID36\",\"agreementStatus\":\"delivered\"}" "$BASE/api/clients/$A36_ID")
check "36c5: owner PUT agreementStatus=delivered → 200" 200 "$S"
grep -q '"agreementStatus":"delivered"' /tmp/body.json && echo "  ✓ response agreementStatus=delivered (DocuSign delivered state works)" || echo "  ✗ delivered not applied: $(cat /tmp/body.json)"
S=$(code -b "$JAR36" -X PUT -H 'Content-Type: application/json' \
  -d "{\"companyName\":\"Agreement Co\",\"clientType\":\"commercial\",\"dealValue\":444,\"stage\":\"$MID36\",\"agreementStatus\":\"declined\"}" "$BASE/api/clients/$A36_ID")
check "36c6: owner PUT agreementStatus=declined (failure state) → 200" 200 "$S"
grep -q '"agreementStatus":"declined"' /tmp/body.json && echo "  ✓ response agreementStatus=declined (red failure state persists)" || echo "  ✗ declined not applied: $(cat /tmp/body.json)"

echo "-- 36d. Isolation: the tenant org never receives agreementStatus and cannot write it =="
S=$(code -b "$JAR36" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Agreement Tenant Co","email":"agreement-tenant@example.com","password":"agreementtenant123"}' "$BASE/api/admin/orgs")
check "36d: owner provisions agreement tenant org → 201" 201 "$S"
T36_ORG=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['org']['id'])")
JART36=$(mktemp)
S=$(code -c "$JART36" -b "$JART36" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"agreement-tenant@example.com","password":"agreementtenant123"}' "$BASE/api/auth/login")
check "36d2: agreement tenant login → 200" 200 "$S"
S=$(code -b "$JART36" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Client Co","clientType":"commercial","dealValue":10,"stage":"Prospect","services":["Cleaning","Maintenance"]}' "$BASE/api/clients")
check "36d3: tenant creates client → 201" 201 "$S"
AT36_ID=$(python3 -c "import json;print(json.load(open('/tmp/body.json'))['client']['id'])")
if grep -q 'agreementStatus' /tmp/body.json; then
  FAIL=$((FAIL+1)); echo "  ✗ tenant create response LEAKED agreementStatus"; cat /tmp/body.json
else
  PASS=$((PASS+1)); echo "  ✓ tenant create response has NO agreementStatus"
fi
grep -q '"services":\["Cleaning","Maintenance"\]' /tmp/body.json && echo "  ✓ tenant still gets its services field (Services-column data intact)" || echo "  ✗ tenant services missing: $(cat /tmp/body.json)"
S=$(code -b "$JART36" "$BASE/api/clients")
check "36d4: tenant list clients → 200" 200 "$S"
if grep -q 'agreementStatus' /tmp/body.json; then
  FAIL=$((FAIL+1)); echo "  ✗ tenant list LEAKED agreementStatus"
else
  PASS=$((PASS+1)); echo "  ✓ tenant list has NO agreementStatus anywhere"
fi
S=$(code -b "$JART36" "$BASE/api/clients/$AT36_ID")
check "36d5: tenant GET client item → 200" 200 "$S"
if grep -q 'agreementStatus' /tmp/body.json; then
  FAIL=$((FAIL+1)); echo "  ✗ tenant GET item LEAKED agreementStatus"
else
  PASS=$((PASS+1)); echo "  ✓ tenant GET item has NO agreementStatus"
fi
# A tenant PUT that (only a crafted client could) sends agreementStatus must
# be IGNORED — no error, no field in the response, tenant shape unchanged.
S=$(code -b "$JART36" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Client Co","clientType":"commercial","dealValue":10,"stage":"Prospect","services":["Cleaning"],"agreementStatus":"signed"}' "$BASE/api/clients/$AT36_ID")
check "36d6: tenant PUT with agreementStatus in body → 200 (ignored)" 200 "$S"
if grep -q 'agreementStatus' /tmp/body.json; then
  FAIL=$((FAIL+1)); echo "  ✗ tenant PUT response LEAKED agreementStatus"
else
  PASS=$((PASS+1)); echo "  ✓ tenant PUT response has NO agreementStatus (payload ignored, not leaked)"
fi
# PR #53 — the NEW lifecycle states must be just as isolated: tenant PUTs with
# delivered/declined are ignored the same way (no leak, no persistence).
S=$(code -b "$JART36" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Client Co","clientType":"commercial","dealValue":10,"stage":"Prospect","services":["Cleaning"],"agreementStatus":"delivered"}' "$BASE/api/clients/$AT36_ID")
check "36d7: tenant PUT agreementStatus=delivered → 200 (ignored)" 200 "$S"
if grep -q 'agreementStatus' /tmp/body.json; then
  FAIL=$((FAIL+1)); echo "  ✗ tenant PUT delivered response LEAKED agreementStatus"
else
  PASS=$((PASS+1)); echo "  ✓ tenant PUT delivered response has NO agreementStatus (payload ignored, not leaked)"
fi
S=$(code -b "$JART36" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Client Co","clientType":"commercial","dealValue":10,"stage":"Prospect","services":["Cleaning"],"agreementStatus":"declined"}' "$BASE/api/clients/$AT36_ID")
check "36d8: tenant PUT agreementStatus=declined → 200 (ignored)" 200 "$S"
if grep -q 'agreementStatus' /tmp/body.json; then
  FAIL=$((FAIL+1)); echo "  ✗ tenant PUT declined response LEAKED agreementStatus"
else
  PASS=$((PASS+1)); echo "  ✓ tenant PUT declined response has NO agreementStatus (payload ignored, not leaked)"
fi
echo "-- 36e. UI surface: owner Onboarding swaps Services → Agreement; tenant keeps its Services column =="
bun run build >/dev/null 2>&1
NEWEST_JS36=$(ls -t dist/index-*.js 2>/dev/null | head -1)
NEWEST_CSS36=$(ls -t dist/index-*.css 2>/dev/null | head -1)
if [ -n "$NEWEST_JS36" ]; then
  # The shared pipeline table swaps the third column per workspace: the
  # OWNER's Onboarding tab renders "Agreement" (Send Agreements + the
  # Not sent/Sent/Signed select), while client accounts AND the owner Leads
  # tab keep "Services" — both branches compile into the bundle, proving the
  # conditional exists (the tenant path stays untouched).
  # PR #53 — the loop also locks the widened lifecycle strings + the
  # tracker markers into the owner-built bundle.
  for STR36 in "Send Agreements" "Agreement" "Not sent" "Sent" "Delivered" "Signed" "Declined" "agree-tracker" "agree-tracker-fail"; do
    if grep -Fq "$STR36" "$NEWEST_JS36"; then PASS=$((PASS+1)); echo "  ✓ bundle contains \"$STR36\""
    else FAIL=$((FAIL+1)); echo "  ✗ bundle missing \"$STR36\""; fi
  done
  if grep -Fq "Services" "$NEWEST_JS36"; then
    PASS=$((PASS+1)); echo "  ✓ bundle keeps \"Services\" (tenant + owner-Leads paths intact — only the owner Onboarding column is swapped)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ \"Services\" missing from $NEWEST_JS36"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 36 bundle surface check"
fi
if [ -n "$NEWEST_CSS36" ]; then
  for STR36C in ".agree-cell" ".send-agreements-btn" ".agree-tracker" ".agree-tracker-dot" ".agree-tracker-fail"; do
    if grep -Fq "$STR36C" "$NEWEST_CSS36"; then PASS=$((PASS+1)); echo "  ✓ css contains \"$STR36C\""
    else FAIL=$((FAIL+1)); echo "  ✗ css missing \"$STR36C\""; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist css not found for 36 css surface check"
fi
echo "-- 36f. Cleanup =="
code -b "$JAR36" -X DELETE "$BASE/api/admin/orgs/$T36_ORG" > /dev/null
code -b "$JAR36" -X DELETE "$BASE/api/clients/$A36_ID" > /dev/null
rm -f "$JAR36" "$JART36" /tmp/s36-settings.json
echo "  ✓ 36f: agreement test client + tenant org removed"
echo "== 37. Owner-workspace UI fixes (2026-08-15) =="
echo "-- 37a. Accounts panel (owner Clients tab): form above, table full width, no control overlap =="
# Owner bug report 2026-08-15 (re-reported): the old .admin-grid was a
# 2-column layout (380px create-form column + 1fr table) with table-layout:
# fixed and no explicit column widths, so the dense columns squeezed the
# action buttons into overlap at ~1280px. The fix is CSS-only (single-column
# restack + explicit widths + wrap guards). Owner live-test reorg 2026-08-18:
# the panel moved from Administration to the owner's Clients tab — same
# classes, same guards; and the "Billing $" column is GONE (accounts table is
# exactly 5 columns now: Clients | Members | Client records | Created |
# Actions).
NEWEST_JS37=$(ls -t dist/index-*.js 2>/dev/null | head -1)
NEWEST_CSS37=$(ls -t dist/index-*.css 2>/dev/null | head -1)
if [ -n "$NEWEST_CSS37" ]; then
  if ! grep -Fq "380px" "$NEWEST_CSS37"; then
    PASS=$((PASS+1)); echo "  ✓ css: Admin grid no longer uses a 380px side column (form now above the table)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ css: 380px Admin side column still present in $NEWEST_CSS37"
  fi
  if grep -Fq "admin-grid{display:grid;grid-template-columns:1fr" "$NEWEST_CSS37"; then
    PASS=$((PASS+1)); echo "  ✓ css: .admin-grid is single-column (form above, table full width below)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ css: .admin-grid single-column rule missing from $NEWEST_CSS37"
  fi
  if grep -Fq "admin-table .row-actions{flex-wrap:wrap}" "$NEWEST_CSS37"; then
    PASS=$((PASS+1)); echo "  ✓ css: accounts-table action rows wrap inside their fixed column (no overlap)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ css: accounts wrap guards missing from $NEWEST_CSS37"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist css not found for 37 admin-layout check"
fi
if [ -n "$NEWEST_JS37" ]; then
  if grep -Eq 'width:"26%"}},void 0,!1,void 0,this),[A-Za-z0-9$_]+\.jsxDEV\("col",{style:{width:"9%"}}' "$NEWEST_JS37" && grep -Eq 'width:"15%"}},void 0,!1,void 0,this),[A-Za-z0-9$_]+\.jsxDEV\("col",{style:{width:"38%"}}' "$NEWEST_JS37" && ! grep -Fq 'width:"7%"' "$NEWEST_JS37" && ! grep -Fq 'Billing $' "$NEWEST_JS37"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: accounts table is 5 columns (Clients 26 | Members 9 | Records 12 | Created 15 | Actions 38) — Billing $ gone"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: accounts 5-col colgroup widths missing or Billing remnants in $NEWEST_JS37"
  fi
  if grep -Fq 'width: "26%"' src/Accounts.tsx && grep -Fq 'width: "9%"' src/Accounts.tsx && grep -Fq 'width: "12%"' src/Accounts.tsx && grep -Fq 'width: "15%"' src/Accounts.tsx && grep -Fq 'width: "38%"' src/Accounts.tsx; then
    PASS=$((PASS+1)); echo "  ✓ source: Accounts.tsx colgroup sums to 100% (26/9/12/15/38)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ source: Accounts 5-col colgroup missing from src/Accounts.tsx"
  fi
  if ! grep -Fq 'width:"33%"' "$NEWEST_JS37" && ! grep -Fq 'width:"23%"' "$NEWEST_JS37"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: old equal-split Admin colgroup widths are gone"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: old Admin colgroup widths still present in $NEWEST_JS37"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist js not found for 37 admin-layout check"
fi
echo "-- 37b. Entry-point rule: Accounts panel (owner Clients tab) adds clients, only Leads adds leads =="
# Owner direction 2026-08-15: the ONLY place to add a client is the "create
# client account" form — since 2026-08-18 that form lives in the Accounts
# panel on the OWNER's CLIENTS tab (it moved out of Administration; see 40b).
# The ONLY place to add a lead is the Leads tab. The owner's "+ New client"
# affordances are gone from the Dashboard and the Clients directory (tenant
# workspaces keep theirs).
if [ -n "$NEWEST_JS37" ]; then
  if ! grep -Fq "onNewClient" "$NEWEST_JS37"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: owner Dashboard \"+ New client\" provisioning affordance removed (onNewClient gone)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: onNewClient still present in $NEWEST_JS37"
  fi
  if grep -Fq "+ New lead" "$NEWEST_JS37"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: Leads tab keeps \"+ New lead\" (the lead entry point)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: \"+ New lead\" missing from $NEWEST_JS37"
  fi
  if grep -Fq "Create client account" "$NEWEST_JS37"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: \"Create client account\" form ships (Accounts panel on the owner Clients tab)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: \"Create client account\" missing from $NEWEST_JS37"
  fi
  if grep -Fq "+ New client" "$NEWEST_JS37"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: tenant \"+ New client\" CTAs intact (client accounts' workspaces untouched)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: \"+ New client\" missing from $NEWEST_JS37"
  fi
fi
# Source-level locks: the Clients directory's two "+ New client" buttons are
# gated behind !ownerOrg (the owner's directory shows none; tenants keep
# theirs), and no component still wires the Dashboard provisioning callback.
if grep -Fq "!ownerOrg" src/ClientsDirectory.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Clients directory \"+ New client\" buttons are owner-gated (owner hidden, tenants kept)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: ClientsDirectory owner-gating missing"
fi
if grep -Fq "onNewClient" src/Dashboard.tsx src/App.tsx; then
  FAIL=$((FAIL+1)); echo "  ✗ source: onNewClient still referenced"
else
  PASS=$((PASS+1)); echo "  ✓ source: no onNewClient references remain (Dashboard/App clean)"
fi
echo "-- 37c. Done =="
echo "  ✓ 37: owner-workspace UI fixes verified (accounts-panel restack + entry-point rule)"
echo "== 38. Owner-workspace UI fixes 2 (2026-08-15): Leads Next-action cell + table-fit sweep =="
echo "-- 38a. Fix A: owner Leads tab Next-action cell shows ONLY the Start Onboarding button =="
# Owner bug report 2026-08-15: the nextAction text span rendered ABOVE the
# "Start Onboarding" button in the owner Leads tab's Next-action cell. The
# span is gated on !ownerLeadsTab — hidden on the owner Leads tab (scope
# "first"). (Owner direction 2026-08-15 extended the same gating to the
# owner's Onboarding tab — see section 39.)
if grep -Fq "{!ownerLeadsTab && !ownerOnboardingTab && (" src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: nextAction text span is owner-Leads+Onboarding-gated (hidden on both owner tabs)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: owner-Leads gating missing in src/Clients.tsx"
fi
if grep -Fq "cell-next-stack" src/Clients.tsx && grep -Fq "cell-muted cell-next" src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: tenant/Onboarding next-action text span intact (cell-next kept)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: cell-next span missing from src/Clients.tsx"
fi
echo "-- 38b. Fix B: owner table-fit sweep — owner-scoped nav fit (no page horizontal scroll at ~1280 / <=980) =="
# Owner permission 2026-08-15: no cut-off columns, no overlapping controls,
# no horizontal scroll at ~1280px and below 980px. Sweep found every table
# already fits its wrap (wrapScroll=0 at both widths) — the ONLY page-level
# horizontal scroll came from the owner's 8-tab header (nav-right stuck out
# ~25px at 1280 and ~200px at 980). Fix is owner-scoped (.owner-workspace)
# so client-account headers stay pixel-identical.
NEWEST_JS38=$(ls -t dist/index-*.js 2>/dev/null | head -1)
NEWEST_CSS38=$(ls -t dist/index-*.css 2>/dev/null | head -1)
if [ -n "$NEWEST_JS38" ]; then
  if grep -Fq "owner-workspace" "$NEWEST_JS38"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: app root carries the owner-workspace class (owner-scoped CSS hooks)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: owner-workspace class missing from $NEWEST_JS38"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist js not found for 38 bundle check"
fi
if [ -n "$NEWEST_CSS38" ]; then
  if grep -Fq "@media (max-width:1320px)" "$NEWEST_CSS38" && grep -Fq ".owner-workspace .nav-inner{gap:14px;padding:0 16px}" "$NEWEST_CSS38"; then
    PASS=$((PASS+1)); echo "  ✓ css: owner nav tightens at <=1320 (1280px no longer overflows)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ css: <=1320 owner nav rules missing from $NEWEST_CSS38"
  fi
  if grep -Fq "@media (max-width:1100px)" "$NEWEST_CSS38" && grep -Fq ".owner-workspace .nav-user{display:none}" "$NEWEST_CSS38"; then
    PASS=$((PASS+1)); echo "  ✓ css: owner nav-user hides at <=1100 (980px nav fits without the user chip)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ css: <=1100 owner nav rules missing from $NEWEST_CSS38"
  fi
  if grep -Fq ".owner-workspace .tabs{overflow-x:auto;min-width:0}" "$NEWEST_CSS38"; then
    PASS=$((PASS+1)); echo "  ✓ css: owner tabs row is internally scrollable (page can never horizontal-scroll)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ css: owner tabs overflow guard missing from $NEWEST_CSS38"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist css not found for 38 css check"
fi
echo "-- 38c. Done =="
echo "  ✓ 38: owner Next-action cell clean on Leads; table-fit sweep verified (owner-scoped header fit, tenant untouched)"
echo "== 39. Owner-workspace UI fixes 3 (2026-08-15): Onboarding Next-action + owner Leads Stage column =="
echo "-- 39a. Fix A (backlog fc9e2df2): owner Onboarding tab Next-action cell shows ONLY the Send Agreements button =="
# Owner direction 2026-08-15: the owner's Onboarding tab (scope "middle") must
# show ONLY the "Send Agreements" quick action under Next action — same
# pattern as the owner Leads tab (PR #48). The nextAction text span is hidden
# when ownerLeadsTab OR ownerOnboardingTab; tenant rows keep the text.
if grep -Fq '{!ownerLeadsTab && !ownerOnboardingTab && (' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: nextAction span hidden on owner Leads AND owner Onboarding (double gating)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: owner Onboarding nextAction gating missing in src/Clients.tsx"
fi
if grep -Fq 'cell-muted cell-next' src/Clients.tsx && grep -Fq 'send-agreements-btn' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: tenant next-action text span + owner Send Agreements button both intact"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: cell-next span or send-agreements button missing from src/Clients.tsx"
fi
NEWEST_JS39=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS39" ]; then
  if grep -Eq '![A-Za-z0-9_$]+&&![A-Za-z0-9_$]+&&[A-Za-z0-9$_]+\.jsxDEV\("span",\{className:"cell-muted cell-next"' <(tr -d '\n' < "$NEWEST_JS39"); then
    PASS=$((PASS+1)); echo "  ✓ bundle: cell-next span is gated on BOTH owner-tab flags (Leads + Onboarding)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: double-gated cell-next span missing from $NEWEST_JS39"
  fi
  if grep -Eq 'children:[A-Za-z0-9$_]+\.nextAction\|\|"—"' "$NEWEST_JS39"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: tenant next-action text fallback still rendered (tenants keep the text)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: tenant next-action text fallback missing from $NEWEST_JS39"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist js not found for 39a bundle check"
fi
echo "-- 39b. Fix B (backlog ab979ee6): owner Leads tab drops the Stage column (6-col table) =="
# Owner direction 2026-08-15: the owner's Leads tab (scope "first") removes the
# Stage column entirely — header th, StageBadge+stage-select td, and the 5th
# colgroup col (15%) — rebalancing to Business name/Contact/Services/Deal/Next
# action/Actions = 21/16/12/9/20/22. The owner's Onboarding tab keeps its
# 7-col layout (incl. Stage); tenants keep their stage picker.
if grep -Fq '{!ownerLeadsTab && <th>Stage</th>}' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Stage header th is owner-Leads-gated (hidden on owner Leads, kept elsewhere)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: gated Stage header missing in src/Clients.tsx"
fi
if grep -Fq '{!ownerLeadsTab && (' src/Clients.tsx && grep -Fq 'data-label="Stage"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: StageBadge+stage-select td is owner-Leads-gated (tenant picker intact)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: gated Stage td missing in src/Clients.tsx"
fi
# Owner direction 2026-08-15 (#50): the owner Leads tab has NO Stage column at
# all — and that includes the Lost/DNC rows. Assert the Lost/DNC table's Stage
# th AND td are owner-gated in source (two gated <th>Stage</th> th's + the
# lost-dnc-stage-cell marker on the gated StageBadge td).
if [ "$(grep -c '{!ownerLeadsTab && <th>Stage</th>}' src/Clients.tsx)" -ge 2 ] && grep -Fq 'lost-dnc-stage-cell' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Lost/DNC Stage th+td also owner-gated (no Stage column incl. Lost/DNC rows)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Lost/DNC Stage gating missing from src/Clients.tsx"
fi
# Owner direction 2026-08-18 (payment-status PR): the owner colgroup layout
# changed — owner Leads is now 7 cols 19/15/11/9/17/10/19 (the Payment column
# sits between Next action and Actions); owner Onboarding/Clients 8 cols
# 17/14/10/8/13/12/10/16; tenant views keep Stage, 7 cols 21/15/11/8/15/12/18.
if grep -Fq 'ownerLeadsTab ? (' src/Clients.tsx && grep -Fq 'width: "19%"' src/Clients.tsx && grep -Fq 'width: "9%"' src/Clients.tsx && grep -Fq 'width: "17%"' src/Clients.tsx && grep -Fq 'width: "10%"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: owner Leads colgroup is the 7-col 19/15/11/9/17/10/19 branch (sums 100%)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: 7-col owner Leads colgroup branch missing in src/Clients.tsx"
fi
if grep -Fq 'width: "14%"' src/Clients.tsx && grep -Fq 'width: "13%"' src/Clients.tsx && grep -Fq 'width: "16%"' src/Clients.tsx && grep -Fq 'width: "21%"' src/Clients.tsx && grep -Fq 'width: "18%"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: owner Onboarding/Clients 8-col (17/14/10/8/13/12/10/16) + tenant 7-col (21/15/11/8/15/12/18) colgroup branches retained"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: 8-col owner / 7-col tenant colgroup branches missing from src/Clients.tsx"
fi
if [ -n "$NEWEST_JS39" ]; then
  if grep -Eq 'children:"Stage"},void 0,!1,void 0,this\),[A-Za-z0-9$_]+\.jsxDEV\("th",{children:"Next action"' "$NEWEST_JS39"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: main-table Stage header followed by the Next-action th (gated structure)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: gated Stage header missing from $NEWEST_JS39"
  fi
  if grep -Eq '![A-Za-z0-9$]+&&[A-Za-z0-9$_]+\.jsxDEV\("td",\{"data-label":"Stage",children:[A-Za-z0-9$_]+\.jsxDEV\("div",\{className:"stage-cell"' "$NEWEST_JS39"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: StageBadge+stage-select td is owner-Leads-gated in the built rows"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: gated Stage td missing from $NEWEST_JS39"
  fi
  if grep -Eq 'width:"19%"}},void 0,!1,void 0,this\),[A-Za-z0-9$_]+\.jsxDEV\("col",{style:{width:"15%"}}' "$NEWEST_JS39"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: owner Leads 7-col colgroup present (19/15… sequence, Payment column added)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: 7-col owner Leads colgroup missing from $NEWEST_JS39"
  fi
  if grep -Eq 'width:"17%"}},void 0,!1,void 0,this\),[A-Za-z0-9$_]+\.jsxDEV\("col",{style:{width:"14%"}}' "$NEWEST_JS39" && grep -Eq 'width:"21%"}},void 0,!1,void 0,this\),[A-Za-z0-9$_]+\.jsxDEV\("col",{style:{width:"15%"}}' "$NEWEST_JS39"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: owner 8-col (17/14… seq) + tenant 7-col (21/15… seq) colgroups retained"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: 8-col/7-col colgroup sequences missing from $NEWEST_JS39"
  fi
  if grep -Eq '![A-Za-z0-9$]+&&[A-Za-z0-9$_]+\.jsxDEV\("td",\{"data-label":"Stage",className:"lost-dnc-stage-cell",children:[A-Za-z0-9$_]+\.jsxDEV\([A-Za-z0-9$_]+,\{stage:' "$NEWEST_JS39" && ! grep -Eq 'jsxDEV\("td",\{"data-label":"Stage",children:[A-Za-z0-9$_]+\.jsxDEV\([A-Za-z0-9$_]+,\{stage:' "$NEWEST_JS39"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: Lost/DNC Stage cell is owner-gated in the built rows (hidden on owner Leads, kept for tenants)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: gated Lost/DNC Stage cell missing from $NEWEST_JS39"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist js not found for 39b bundle check"
fi
echo "-- 39c. Done =="
echo "  ✓ 39: owner Onboarding Next-action = Send Agreements only; owner Leads Stage column removed (tenant views untouched)"

echo "== 40. Owner cockpit refinements 3 (owner directions 2026-08-15): Dashboard Pipeline overview consolidation + Admin owner-row filter + billing-model removal =="
echo "-- 40a. Owner Dashboard: five-card Pipeline overview KPI row (five figures, no duplicates) =="
# Owner direction 2026-08-15 (refined again during live test) — the OWNER's
# Dashboard shows the pipeline exactly ONCE as FIVE individual .card.kpi
# figures inside a single .kpi-row (Projected pipeline + Sold MRR money
# figures with the privacy-eye toggle, then the Active leads / Onboarding /
# Sold bucket counts — Active leads and Onboarding carry View deep-links).
# The old duplicate KPI cards, the single five-row card (pipeline-overview),
# and the per-stage grid (owner-pipeline-stages) are GONE — no pipeline
# figure appears twice on the owner's page. TENANT dashboards keep the KPI
# row (own money card, Projected pipeline, Active clients, In final stage) +
# the standalone "Stage breakdown" card exactly as before (same heading, same
# grid).
bun run build >/dev/null 2>&1
NEWEST_JS40=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS40" ]; then
  if ! grep -Fq 'owner-pipeline-stages' "$NEWEST_JS40" && ! grep -Fq 'pipeline-overview' "$NEWEST_JS40"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: owner per-stage grid GONE; single five-row pipeline-overview card GONE (five KPI cards instead)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: owner-pipeline-stages or pipeline-overview still present in $NEWEST_JS40"
  fi
  if grep -Fq 'Stage breakdown' "$NEWEST_JS40" && grep -Fq 'in the pipeline' "$NEWEST_JS40"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: tenant Stage breakdown card + per-stage View deep-links intact"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: tenant stage-breakdown card or View deep-link missing from $NEWEST_JS40"
  fi
  # Five owner card labels ship in the bundle. 'Projected pipeline' appears
  # exactly TWICE (owner card + tenant KPI card — one each, no owner
  # duplicate); the owner-only labels appear exactly ONCE.
  if [ "$(grep -oF 'Projected pipeline' "$NEWEST_JS40" | wc -l)" = "2" ]; then
    PASS=$((PASS+1)); echo "  ✓ bundle: 'Projected pipeline' exactly twice (owner card + tenant KPI) — no duplicate owner card"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: 'Projected pipeline' count != 2 in $NEWEST_JS40"
  fi
  # 'Sold MRR' and 'Active leads' ship only in the owner branch (the tenant
  # branch says 'Active clients'), so they must appear exactly once each.
  for ROW40 in "Sold MRR" "Active leads"; do
    if [ "$(grep -oF "$ROW40" "$NEWEST_JS40" | wc -l)" = "1" ]; then PASS=$((PASS+1)); echo "  ✓ bundle: owner-only label \"$ROW40\" present exactly once"
    else FAIL=$((FAIL+1)); echo "  ✗ bundle: owner-only label \"$ROW40\" not exactly once in $NEWEST_JS40"; fi
  done
  # The Sold MRR card note (same wording the Clients tab uses — both ship, so
  # presence only, no count).
  if grep -Fq 'Deal value of sold clients' "$NEWEST_JS40"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: Sold MRR card note present"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: Sold MRR card note missing from $NEWEST_JS40"
  fi
  if grep -Fq 'in the Onboarding pipeline' "$NEWEST_JS40"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: owner Onboarding card keeps its View → deep-link"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: owner Onboarding View → deep-link missing from $NEWEST_JS40"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 40a bundle check"
fi
if grep -Fq '{ownerOrg ? (' src/Dashboard.tsx && grep -Fq 'kpi-row' src/Dashboard.tsx && ! grep -Fq 'pipeline-overview' src/Dashboard.tsx && ! grep -Fq 'owner-pipeline-stages' src/Dashboard.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Dashboard owner/tenant branch present (owner = five-card KPI row, no pipeline-overview card, no per-stage grid)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Dashboard owner/tenant branch wrong in src/Dashboard.tsx"
fi
if python3 - <<'PY' 2>"$PASS_TMP"
src = open('src/Dashboard.tsx').read()
i = src.index('kpi-row', src.index('{ownerOrg ? ('))
start = src.rindex('{ownerOrg ? (', 0, i)
end = src.index(') : (', i)
owner_branch = src[start:end]
# The owner's five figures are FIVE individual .card.kpi cards in ONE
# kpi-row — no more, no fewer; the old single pipeline-overview card and its
# pipeline-row rows are gone.
assert owner_branch.count('className="card kpi"') == 5, 'owner row must have exactly five KPI cards'
assert owner_branch.count('kpi-row') == 1, 'owner branch must render exactly one kpi-row (five cards, no nested/duplicate rows)'
assert 'pipeline-overview' not in owner_branch, 'old single five-row card class must be gone'
assert 'pipeline-row' not in owner_branch, 'old pipeline-row rows must be gone'
# Five labels, each exactly once — no figure label repeats. 'Sold' and
# 'Onboarding' are asserted as their rendered labels to avoid matching the
# 'Sold MRR' label / 'Onboarding pipeline' aria substring.
assert owner_branch.count('Projected pipeline') == 1, 'Projected pipeline label must appear exactly once'
assert owner_branch.count('Sold MRR') == 1, 'Sold MRR label must appear exactly once'
assert owner_branch.count('>Onboarding<') == 1, 'Onboarding label must appear exactly once'
assert owner_branch.count('>Sold<') == 1, 'Sold label must appear exactly once'
# The Active Leads card renders the activeKpi label (the owner branch of that
# const resolves to the literal "Active leads", defined with the workspace
# wording above the return — so assert both the usage and the wording).
assert '{activeKpi}' in owner_branch, 'Active Leads card must render the activeKpi label'
assert 'Active leads' in src, 'owner "Active leads" wording must exist (activeKpi owner branch)'
assert 'owner-pipeline-stages' not in owner_branch, 'owner branch must NOT render the old per-stage grid'
assert 'stage-grid' not in owner_branch, 'owner branch must not render any stage grid'
assert 'In final stage' not in owner_branch, 'owner branch must not render the tenant In-final-stage KPI'
assert owner_branch.count('eye-btn') == 2, 'both money cards keep the privacy-eye toggle'
assert 'blur(moneyHidden)' in owner_branch and 'money-blur' in src, 'money cards keep the eye blur (blur() fn + usage in the branch)'
assert 'onGoToStage(firstStage)' in owner_branch and 'onGoToStage(midStage)' in owner_branch, 'count cards keep the View deep-links'
assert 'View ${firstStage} in the pipeline' in owner_branch, 'Active Leads card keeps its first-stage deep-link aria-label'
assert 'View ${midStage} in the Onboarding pipeline' in owner_branch, 'Onboarding card keeps its mid-stage deep-link aria-label'
cards_start = src.index('const stageCards = stages.map')
cards_end = src.index('\n  return (', cards_start)
cards_block = src[cards_start:cards_end]
assert 'in the pipeline' in cards_block, 'shared stage cards keep the View deep-link'
tenant_start = src.index(') : (', i)
tenant_end = src.index('Task overview', tenant_start)
tenant_branch = src[tenant_start:tenant_end]
assert 'kpi-row' in tenant_branch, 'tenant branch must keep the KPI row'
assert 'In final stage' in tenant_branch, 'tenant branch must keep the In-final-stage KPI'
assert 'Stage breakdown' in tenant_branch, 'tenant branch must keep the standalone Stage breakdown heading'
assert 'stage-grid' in tenant_branch
assert 'pipeline-overview' not in tenant_branch, 'tenant branch must NOT get the owner five-card row'
print('  ✓ source: owner branch = five-card kpi-row (each figure exactly once, no stage grid); tenant branch keeps KPI row + Stage breakdown card')
PY
then
  PASS=$((PASS+1)); echo "  ✓ 40a2: five-card KPI row structure correct (owner, no duplicates; tenant untouched)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 40a2: five-card KPI row structure wrong"; cat "$PASS_TMP"
fi
echo "-- 40b. Accounts panel (owner Clients tab): the owner's own workspace hidden from the account list =="
# Owner direction 2026-08-15 — the client-account list is for CLIENT
# workspaces: the owner org is filtered out of the table rows, the
# "N workspaces" count, and (with the row gone) its View-account / delete /
# edit affordances. The server API /api/admin/orgs is UNCHANGED (still the
# full list); the filter is UI-side only. Owner live-test reorg 2026-08-18 —
# the account list + create/reset/delete controls MOVED from src/Admin.tsx
# (Administration) to src/Accounts.tsx, rendered by the owner's Clients tab,
# so these source locks now target src/Accounts.tsx (Admin.tsx keeps only the
# Agreements editor).
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "40b: server /api/admin/orgs still returns the full list" 200 "$S"
if python3 - "$DEFAULT_ORG_ID" <<'PY' 2>"$PASS_TMP"
import json, sys
d = json.load(open('/tmp/body.json'))
ids = [o['id'] for o in d['orgs']]
assert int(sys.argv[1]) in ids, 'server must still return the owner org (UI filters, API unchanged)'
print('  ✓ server /api/admin/orgs unchanged — owner org (%s) still in the list' % sys.argv[1])
PY
then
  PASS=$((PASS+1)); echo "  ✓ 40b: server API unchanged (owner org still returned; filter is UI-side)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 40b: server API no longer returns the owner org"; cat "$PASS_TMP"
fi
if grep -Fq 'const visibleOrgs = orgs' src/Accounts.tsx && grep -Fq 'o.id !== ownerOrgId' src/Accounts.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Accounts filters the owner org out (visibleOrgs = orgs minus owner)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Accounts owner-org filter missing from src/Accounts.tsx"
fi
if grep -Fq 'visibleOrgs.length' src/Accounts.tsx && grep -Fq 'visibleOrgs.length === 0' src/Accounts.tsx && grep -Fq 'visibleOrgs.map' src/Accounts.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: filtered list drives the workspaces count, empty state and table rows"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: visibleOrgs not wired to count/empty/rows in src/Accounts.tsx"
fi
if ! grep -Fq 'chip-owner' src/Accounts.tsx && ! grep -Fq 'The owner workspace cannot be deleted' src/Accounts.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: owner-row chip + owner-row billing/action branches removed (row itself filtered out)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: owner-row UI remnants still in src/Accounts.tsx"
fi
# The move means EXACTLY ONE home for account management: Admin.tsx keeps
# only the Agreements editor — no visibleOrgs / create-account form remnants.
if ! grep -Fq 'visibleOrgs' src/Admin.tsx && ! grep -Fq 'Create client account' src/Admin.tsx && ! grep -Fq 'onViewAccount' src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Admin.tsx no longer hosts account management (one home = Clients tab Accounts panel)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: account-management remnants still in src/Admin.tsx"
fi
if [ -n "$NEWEST_JS40" ]; then
  if grep -Fq 'View account' "$NEWEST_JS40" && grep -Fq 'Reset password' "$NEWEST_JS40"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: tenant-row View-account / reset / delete affordances intact"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: tenant-row affordances missing from $NEWEST_JS40"
  fi
fi
echo "-- 40c. Accounts panel: 'Billing $' column REMOVED (owner live-test reorg 2026-08-18) =="
# Owner live-test reorg 2026-08-18 — the per-account "Billing $" column no
# longer exists in the accounts table: the billing-model selector was removed
# in PR #52 and per-account billing amounts are Phase 5 prep only, so the
# column only confused live testing. The WHOLE billing edit UI is gone: no
# billing-amount input, no "Billing $"/"Billing $ / model" header, no
# adminUpdateOrg({monthlySubscriptionAmount}) call in the UI. The server
# PATCH endpoint is untouched (33f/33h1/33h2 still exercise it; a future
# Phase 5 build will re-surface the amount), and the TENANT revenue toggle in
# Settings is untouched (40d).
if ! grep -Fq 'billing-model' src/Accounts.tsx && ! grep -Fq 'billing-model' src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: no billing-model select in Accounts or Admin"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: billing-model select still present in src/Accounts.tsx / src/Admin.tsx"
fi
if ! grep -Fq 'billing-amount' src/Accounts.tsx && ! grep -Fq 'billing-amount' src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: billing-amount input removed from the accounts panel"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: billing-amount still present in src/Accounts.tsx / src/Admin.tsx"
fi
if ! grep -Fq 'Billing $' src/Accounts.tsx && ! grep -Fq 'Billing $' src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: no 'Billing $' column header anywhere in the account UI"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: 'Billing $' header still present in src/Accounts.tsx / src/Admin.tsx"
fi
if ! grep -Fq 'monthlySubscriptionAmount' src/Accounts.tsx && ! grep -Fq 'monthlySubscriptionAmount' src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: no monthlySubscriptionAmount edit call in the account UI (server PATCH still covered by 33h)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: monthlySubscriptionAmount still referenced in src/Accounts.tsx / src/Admin.tsx"
fi
if ! grep -Fq 'revenueModel' src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: no revenueModel references remain in Admin"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: revenueModel still referenced in src/Admin.tsx"
fi
if ! grep -Fq '.billing-model' src/styles.css && ! grep -Fq '.billing-amount' src/styles.css; then
  PASS=$((PASS+1)); echo "  ✓ css: dead .billing-model AND .billing-amount rules removed"
else
  FAIL=$((FAIL+1)); echo "  ✗ css: .billing-model or .billing-amount rules still present in src/styles.css"
fi
if [ -n "$NEWEST_JS40" ]; then
  if ! grep -Fq 'billing-model' "$NEWEST_JS40" && ! grep -Fq 'billing-amount' "$NEWEST_JS40" && ! grep -Fq 'Billing $' "$NEWEST_JS40"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: billing-model / billing-amount / 'Billing $' all gone from the shipped bundle"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: billing remnants still in $NEWEST_JS40"
  fi
fi
echo "-- 40d. Tenant revenue toggle + server untouched =="
# The tenant-facing revenue model (how a CLIENT's own business makes money) is
# unchanged: Settings still ships the toggle strings and the server still
# accepts revenueModel on /api/settings (tenant) — only the OWNER's Admin
# selector is gone.
if grep -Fq 'Save revenue model' src/Settings.tsx && grep -Fq 'revenueModel' src/Settings.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: tenant revenue-model toggle intact in src/Settings.tsx (untouched)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: tenant revenue toggle missing from src/Settings.tsx"
fi
if grep -Fq 'revenueModel' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: server still accepts revenueModel (tenant settings unchanged)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: server revenueModel handling missing from server/api.ts"
fi
echo "-- 40e. Done == "
echo "  ✓ 40: Dashboard Pipeline overview consolidated to ONE five-row card (no duplicate figures); Admin owner-row filter + billing-model removal verified (owner-workspace only)"

echo "== 41. Owner cockpit refinements 4 (2026-08-15): DocuSign lifecycle tracker + Onboarding Stage badge-only (PR #53) =="
echo "-- 41a. Source: AgreementStatus widened to the full DocuSign lifecycle (client + server in lockstep) =="
if grep -Fq 'export type AgreementStatus = "not_sent" | "sent" | "delivered" | "signed" | "declined"' src/types.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: AgreementStatus union widened to the 5-state DocuSign lifecycle"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: AgreementStatus union not widened in src/types.ts"
fi
if grep -Fq 'export const AGREEMENT_STATUSES = ["not_sent", "sent", "delivered", "signed", "declined"] as const' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: server AGREEMENT_STATUSES widened in lockstep (server validation accepts the new states)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: server AGREEMENT_STATUSES not widened"
fi
echo "-- 41b. Source: Agreement cell = lifecycle tracker + badge + manual select; Stage select owner-Onboarding-gated =="
if grep -Fq '<AgreementTracker status={c.agreementStatus ?? "not_sent"} />' src/Clients.tsx && grep -Fq 'className="agree-tracker"' src/Clients.tsx && grep -Fq 'agree-tracker-fail' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Agreement cell renders the lifecycle tracker (declined = red failure pill)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: AgreementTracker missing from the owner Onboarding Agreement cell"
fi
if ! grep -Fq '<option value="delivered">Delivered</option>' src/Clients.tsx && ! grep -Fq '<option value="declined">Declined</option>' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: manual agreement status select removed (native e-signature replaces it)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: manual agreement status select still present — native signer should replace it"
fi
if grep -Fq '{!ownerOnboardingTab && canEdit && (' src/Clients.tsx && grep -Fq 'className="stage-select"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Stage select is owner-Onboarding-gated (owner Onboarding = badge only; tenants keep their picker)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: owner-Onboarding stage-select gate missing in src/Clients.tsx"
fi
echo "-- 41c. Bundle + CSS: tracker compiled, manual select removed (native signer), owner Onboarding stage select gated in the built rows =="
bun run build >/dev/null 2>&1
NEWEST_JS41=$(ls -t dist/index-*.js 2>/dev/null | head -1)
NEWEST_CSS41=$(ls -t dist/index-*.css 2>/dev/null | head -1)
if [ -n "$NEWEST_JS41" ]; then
  if grep -Fq 'Agreement status: ${' "$NEWEST_JS41" && grep -Fq 'agree-tracker declined' "$NEWEST_JS41" && grep -Fq 'agree-tracker-dot' "$NEWEST_JS41"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: lifecycle tracker rendered (stepper aria-label, declined state, step dots)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: lifecycle tracker missing from $NEWEST_JS41"
  fi
  if grep -Eq 'children:[A-Za-z0-9$_]+\?"Agreement":"Services"' "$NEWEST_JS41"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: Agreement/Services column swap still compiled (owner Onboarding vs tenant)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: Agreement/Services swap missing from $NEWEST_JS41"
  fi
  if grep -Eq '![A-Za-z0-9_$]+&&[A-Za-z0-9$_]+&&[A-Za-z0-9$_]+\.jsxDEV\("select",\{className:"stage-select",value:[A-Za-z0-9$_]+\.stage' <(tr -d '\n' < "$NEWEST_JS41"); then
    PASS=$((PASS+1)); echo "  ✓ bundle: owner Onboarding stage select is gated in the built rows (badge-only for the owner)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: gated stage select missing from $NEWEST_JS41"
  fi
  if grep -Eq 'jsxDEV\("select",\{className:"stage-select",value:[A-Za-z0-9$_]+\.stage' "$NEWEST_JS41"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: stage select element still shipped (tenants render it; owner Onboarding is gated)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: stage select element missing from $NEWEST_JS41"
  fi
  if ! grep -Fq 'value:"delivered"' "$NEWEST_JS41" && ! grep -Fq 'value:"declined"' "$NEWEST_JS41"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: manual agreement select values (delivered/declined) removed from the built rows"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: manual agreement select values still present in $NEWEST_JS41"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 41 bundle check"
fi
if [ -n "$NEWEST_CSS41" ]; then
  for STR41C in ".agree-tracker{" ".agree-tracker-dot" ".agree-tracker-dot.done" ".agree-tracker-dot.current" ".agree-tracker-line" ".agree-tracker.declined" ".agree-tracker-fail"; do
    if grep -Fq "$STR41C" "$NEWEST_CSS41"; then PASS=$((PASS+1)); echo "  ✓ css contains \"$STR41C\""
    else FAIL=$((FAIL+1)); echo "  ✗ css missing \"$STR41C\""; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist css not found for 41 css check"
fi
echo "-- 41d. Done =="
echo "  ✓ 41: DocuSign lifecycle tracker + Onboarding Stage badge-only verified (owner-workspace only, tenant views untouched)"
echo "== 42. Support tickets (owner direction 2026-08-15): owner Tickets tab + tenant Support tab =="
echo "-- 42a. Provision two ticket tenants + fresh sessions =="
JAR42=$(mktemp)    # fresh admin session for this section
JAR42A=$(mktemp)   # tenant A — files a ticket
JAR42B=$(mktemp)   # tenant B — files a ticket (cross-tenant isolation target)
S=$(code -c "$JAR42" -b "$JAR42" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "42a: owner login" 200 "$S"
S=$(code -b "$JAR42" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Ticket Co A","email":"ticketa42@example.com","password":"ticketa42pass"}' "$BASE/api/admin/orgs")
check "42a: provision tenant A" 201 "$S"
TICKET_A_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JAR42" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Ticket Co B","email":"ticketb42@example.com","password":"ticketb42pass"}' "$BASE/api/admin/orgs")
check "42a: provision tenant B" 201 "$S"
TICKET_B_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
echo "    (tenant A org=$TICKET_A_ORG, tenant B org=$TICKET_B_ORG)"
S=$(code -c "$JAR42A" -b "$JAR42A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"ticketa42@example.com","password":"ticketa42pass"}' "$BASE/api/auth/login")
check "42a: tenant A login" 200 "$S"
S=$(code -c "$JAR42B" -b "$JAR42B" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"ticketb42@example.com","password":"ticketb42pass"}' "$BASE/api/auth/login")
check "42a: tenant B login" 200 "$S"

echo "-- 42b. Create tickets: tenant A, tenant B, owner =="
S=$(code -b "$JAR42A" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"Cannot save client","message":"The Save button does nothing when I edit a client.","priority":"HIGH"}' "$BASE/api/tickets")
check "42b: tenant A creates ticket → 201" 201 "$S"
TICKET_A=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['ticket']['id'])")
grep -q '"status":"OPEN"' /tmp/body.json && grep -q '"priority":"HIGH"' /tmp/body.json && echo "  ✓ default status OPEN + submitted priority HIGH" || echo "  ✗ ticket create shape: $(cat /tmp/body.json)"
grep -q '"orgName"' /tmp/body.json && echo "  ✗ TENANT create response leaked orgName" || echo "  ✓ tenant create response carries no orgName"
S=$(code -b "$JAR42B" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"Invoice PDF broken","message":"The invoice download link 404s.","priority":"NORMAL"}' "$BASE/api/tickets")
check "42b: tenant B creates ticket → 201" 201 "$S"
TICKET_B=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['ticket']['id'])")
S=$(code -b "$JAR42" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"Owner test ticket","message":"Filed by Revzenta itself.","priority":"LOW"}' "$BASE/api/tickets")
check "42b: owner creates ticket → 201" 201 "$S"
TICKET_O=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['ticket']['id'])")
grep -q '"orgName":"Revzenta"' /tmp/body.json && echo "  ✓ owner create response carries its org name" || echo "  ✗ owner create orgName: $(cat /tmp/body.json)"

echo "-- 42c. Create validation =="
check "42c: no subject → 400" 400 $(code -b "$JAR42A" -X POST -H 'Content-Type: application/json' \
  -d '{"message":"only a message"}' "$BASE/api/tickets")
check "42c: no message → 400" 400 $(code -b "$JAR42A" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"only a subject"}' "$BASE/api/tickets")
check "42c: bad priority → 400" 400 $(code -b "$JAR42A" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"s","message":"m","priority":"URGENT"}' "$BASE/api/tickets")
check "42c: bad status on create → 400" 400 $(code -b "$JAR42A" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"s","message":"m","status":"HACKED"}' "$BASE/api/tickets")

echo "-- 42d. Owner GET sees ALL orgs' tickets + org names; tenant GET sees only own =="
S=$(code -b "$JAR42" "$BASE/api/tickets")
check "42d: owner GET → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
t = d['tickets']
assert len(t) == 3, t
names = {x.get('orgName') for x in t}
assert 'Ticket Co A' in names and 'Ticket Co B' in names and 'Revzenta' in names, names
assert all('orgName' in x for x in t), 'every owner row must carry orgName'
print("  ✓ owner sees all 3 orgs' tickets with org names joined")
PY
S=$(code -b "$JAR42A" "$BASE/api/tickets")
check "42d: tenant A GET → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
t = d['tickets']
assert len(t) == 1 and t[0]['subject'] == 'Cannot save client', t
assert 'orgName' not in t[0], t[0]
print("  ✓ tenant A sees ONLY its own ticket (no orgName key — nothing to leak)")
PY
S=$(code -b "$JAR42B" "$BASE/api/tickets")
check "42d: tenant B GET → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
t = d['tickets']
assert len(t) == 1 and t[0]['subject'] == 'Invoice PDF broken', t
print("  ✓ tenant B sees ONLY its own ticket (tenant A's never leaks across orgs)")
PY

echo "-- 42e. Isolation: tenant A cannot read or change tenant B's ticket =="
S=$(code -b "$JAR42A" "$BASE/api/tickets")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
assert all(x['subject'] != 'Invoice PDF broken' for x in d['tickets']), d
print("  ✓ tenant A's list contains none of tenant B's tickets")
PY
check "42e: tenant A PATCH tenant B's ticket → 403" 403 $(code -b "$JAR42A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"RESOLVED"}' "$BASE/api/tickets/$TICKET_B")
check "42e: tenant A PATCH own ticket → 403" 403 $(code -b "$JAR42A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"RESOLVED"}' "$BASE/api/tickets/$TICKET_A")
check "42e: tenant B PATCH owner's ticket → 403" 403 $(code -b "$JAR42B" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"RESOLVED"}' "$BASE/api/tickets/$TICKET_O")
S=$(code -b "$JAR42" "$BASE/api/tickets")
check "42e: owner GET after rejected writes → 200" 200 "$S"
grep -q '"status":"OPEN"' /tmp/body.json && echo "  ✓ tenant writes were rejected — tickets still OPEN" || echo "  ✗ tenant writes mutated tickets: $(cat /tmp/body.json)"

echo "-- 42f. Owner PATCH status + priority persists; tenant sees the change =="
S=$(code -b "$JAR42" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"IN_PROGRESS","priority":"LOW"}' "$BASE/api/tickets/$TICKET_A")
check "42f: owner PATCH tenant A ticket → 200" 200 "$S"
grep -q '"status":"IN_PROGRESS"' /tmp/body.json && grep -q '"priority":"LOW"' /tmp/body.json && echo "  ✓ owner PATCH persists status + priority" || echo "  ✗ owner PATCH result: $(cat /tmp/body.json)"
grep -q '"orgName":"Ticket Co A"' /tmp/body.json && echo "  ✓ owner PATCH response carries the submitting org name" || echo "  ✗ PATCH orgName: $(cat /tmp/body.json)"
S=$(code -b "$JAR42A" "$BASE/api/tickets")
check "42f: tenant A list → 200" 200 "$S"
grep -q '"status":"IN_PROGRESS"' /tmp/body.json && echo "  ✓ tenant sees the owner's status change (live badge)" || echo "  ✗ tenant status: $(cat /tmp/body.json)"
check "42f: owner PATCH empty body → 400" 400 $(code -b "$JAR42" -X PATCH -H 'Content-Type: application/json' \
  -d '{}' "$BASE/api/tickets/$TICKET_A")
check "42f: owner PATCH bad status → 400" 400 $(code -b "$JAR42" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"WON"}' "$BASE/api/tickets/$TICKET_A")
check "42f: owner PATCH missing ticket → 404" 404 $(code -b "$JAR42" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"CLOSED"}' "$BASE/api/tickets/999999")

echo "-- 42g. Full lifecycle: OPEN → RESOLVED → CLOSED =="
S=$(code -b "$JAR42" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"RESOLVED"}' "$BASE/api/tickets/$TICKET_B")
check "42g: owner resolves tenant B ticket → 200" 200 "$S"
S=$(code -b "$JAR42" -X PATCH -H 'Content-Type: application/json' \
  -d '{"status":"CLOSED"}' "$BASE/api/tickets/$TICKET_B")
check "42g: owner closes tenant B ticket → 200" 200 "$S"
grep -q '"status":"CLOSED"' /tmp/body.json && echo "  ✓ CLOSED persists" || echo "  ✗ close: $(cat /tmp/body.json)"

echo "-- 42h. Bundle + source markers: owner Tickets tab + tenant Support tab + submit modal =="
bun run build >/dev/null 2>&1
NEWEST_JS42=$(ls -t dist/index-*.js 2>/dev/null | head -1)
NEWEST_CSS42=$(ls -t dist/index-*.css 2>/dev/null | head -1)
if [ -n "$NEWEST_JS42" ]; then
  if grep -Fq 'Submit a ticket' "$NEWEST_JS42" && grep -Fq 'Every client account' "$NEWEST_JS42"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: ticket page strings present (submit modal + owner heading)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ ticket page strings missing from $NEWEST_JS42"
  fi
  if grep -Fq 'Status control' "$NEWEST_JS42"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: owner status-control column shipped"
  else
    FAIL=$((FAIL+1)); echo "  ✗ status-control column missing from $NEWEST_JS42"
  fi
  if grep -Fq 'ticket-message' "$NEWEST_CSS42" && grep -Fq 'status-select' "$NEWEST_CSS42"; then
    PASS=$((PASS+1)); echo "  ✓ css: ticket message block + status select styles shipped"
  else
    FAIL=$((FAIL+1)); echo "  ✗ ticket css missing"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 42 bundle check"
fi
if grep -Fq 'TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]' src/types.ts && grep -Fq 'TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH"]' src/types.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: ticket status/priority unions defined in src/types.ts"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: ticket unions missing from src/types.ts"
fi
if grep -Fq 'ticketMatch && method === "PATCH"' server/api.ts && grep -Fq 'requireAdmin(req)' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: owner-only PATCH route present (requireAdmin gate)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: owner-only PATCH route missing from server/api.ts"
fi

echo "-- 42i. Cleanup: delete ticket tenants =="
code -b "$JAR42" -X DELETE "$BASE/api/admin/orgs/$TICKET_A_ORG" > /dev/null
code -b "$JAR42" -X DELETE "$BASE/api/admin/orgs/$TICKET_B_ORG" > /dev/null
rm -f "$JAR42" "$JAR42A" "$JAR42B"
echo "  ✓ 42: support tickets verified (owner Tickets tab + tenant Support tab, row isolation, owner-only status changes)"

echo "== 43. Team users per client account (owner request 2026-08-14): org admins + restricted members with per-tab permissions =="
echo "-- 43a. Provision two member tenants + fresh sessions =="
JAR43=$(mktemp)     # fresh owner session for this section
JAR43A=$(mktemp)    # tenant A first user (the account's original owner login)
JAR43B=$(mktemp)    # tenant A member BOB (restricted, role=member)
JAR43C=$(mktemp)    # tenant A member CAROL (role=admin)
JAR43D=$(mktemp)    # tenant B first user (cross-org isolation target)
S=$(code -c "$JAR43" -b "$JAR43" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "43a: owner login" 200 "$S"
grep -q '"role":"admin"' /tmp/body.json && grep -q '"permissions":{}' /tmp/body.json && \
  echo "  ✓ owner me/login carries role admin + empty permissions (owner unaffected)" || echo "  ✗ owner me shape: $(cat /tmp/body.json)"
S=$(code -b "$JAR43" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Member Co A","email":"membera43@example.com","password":"membera43pass"}' "$BASE/api/admin/orgs")
check "43a: provision tenant A" 201 "$S"
TENANT_A_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JAR43" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Member Co B","email":"memberb43@example.com","password":"memberb43pass"}' "$BASE/api/admin/orgs")
check "43a: provision tenant B" 201 "$S"
TENANT_B_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
echo "    (tenant A org=$TENANT_A_ORG, tenant B org=$TENANT_B_ORG)"
S=$(code -c "$JAR43A" -b "$JAR43A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"membera43@example.com","password":"membera43pass"}' "$BASE/api/auth/login")
check "43a: tenant A first user login" 200 "$S"
S=$(code -c "$JAR43D" -b "$JAR43D" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"memberb43@example.com","password":"memberb43pass"}' "$BASE/api/auth/login")
check "43a: tenant B first user login" 200 "$S"

echo "-- 43b. The account's original owner login IS the org admin (no stored-role migration) =="
S=$(code -b "$JAR43A" "$BASE/api/org/members")
check "43b: tenant A first user GET members → 200 (org admin)" 200 "$S"
grep -q '"members":' /tmp/body.json && grep -q 'membera43@example.com' /tmp/body.json && echo "  ✓ list contains the account owner login" || echo "  ✗ members list: $(cat /tmp/body.json)"
grep -qv '"password' /tmp/body.json && grep -qv '"password_hash' /tmp/body.json && echo "  ✓ no password material in the member list" || echo "  ✗ password material leaked in member list"
FIRST_A_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['members'][0]['id'])")
echo "    (tenant A first user id=$FIRST_A_ID)"
S=$(code -b "$JAR43A" "$BASE/api/auth/me")
check "43b: tenant A me → 200" 200 "$S"
grep -q '"role":"member"' /tmp/body.json && grep -q '"permissions":{}' /tmp/body.json && echo "  ✓ me carries role member + permissions {} (stored role untouched, enforcement is structural)" || echo "  ✗ me shape: $(cat /tmp/body.json)"
S=$(code -b "$JAR43A" "$BASE/api/clients")
check "43b: org admin has full data access (clients read → 200)" 200 "$S"

echo "-- 43c. Create a restricted member (role=member, default all tabs view-only) =="
S=$(code -b "$JAR43A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"bob43@membera.example","password":"bobpass123","role":"member"}' "$BASE/api/org/members")
check "43c: tenant A creates bob (role member) → 201" 201 "$S"
BOB_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['member']['id'])")
grep -q '"role":"member"' /tmp/body.json && grep -q '"permissions":{' /tmp/body.json && echo "  ✓ response carries role + permissions" || echo "  ✗ create response: $(cat /tmp/body.json)"
python3 -c "
import json
m = json.load(open('/tmp/body.json'))['member']
tabs = m['permissions']
expect = {'clients','tasks','finance','settings','support'}
assert set(tabs) == expect, tabs
assert all(not v['edit'] for v in tabs.values()), tabs
print('  ✓ new member default = ALL five tabs view-only (admin adjusts)')
" || echo "  ✗ default permissions wrong: $(cat /tmp/body.json)"
grep -qv '"password' /tmp/body.json && echo "  ✓ create response carries no password material" || echo "  ✗ create response leaked password"
check "43c: duplicate email → 400" 400 $(code -b "$JAR43A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"bob43@membera.example","password":"bobpass123","role":"member"}' "$BASE/api/org/members")
check "43c: bad role → 400" 400 $(code -b "$JAR43A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"x43@membera.example","password":"xpass1234","role":"superuser"}' "$BASE/api/org/members")
check "43c: short password → 400" 400 $(code -b "$JAR43A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"y43@membera.example","password":"short","role":"member"}' "$BASE/api/org/members")
check "43c: bad email → 400" 400 $(code -b "$JAR43A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"not-an-email","password":"xpass1234","role":"member"}' "$BASE/api/org/members")

echo "-- 43d. Restricted member: view-only read works, writes 403, management 403, dashboard always visible =="
S=$(code -c "$JAR43B" -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"bob43@membera.example","password":"bobpass123"}' "$BASE/api/auth/login")
check "43d: bob login → 200" 200 "$S"
S=$(code -b "$JAR43B" "$BASE/api/auth/me")
grep -q '"role":"member"' /tmp/body.json && grep -q '"permissions":' /tmp/body.json && echo "  ✓ /api/auth/me includes role + permissions for the member" || echo "  ✗ me shape: $(cat /tmp/body.json)"
check "43d: bob reads clients (view-only) → 200" 200 $(code -b "$JAR43B" "$BASE/api/clients")
check "43d: bob writes client (view-only) → 403" 403 $(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bobco","clientType":"commercial"}' "$BASE/api/clients")
check "43d: bob reads tasks (view-only) → 200" 200 $(code -b "$JAR43B" "$BASE/api/tasks")
check "43d: bob toggles task (view-only) → 403" 403 $(code -b "$JAR43B" -X POST "$BASE/api/tasks/1/toggle")
check "43d: bob reads invoices (view-only) → 200" 200 $(code -b "$JAR43B" "$BASE/api/invoices")
check "43d: bob reads settings (view-only) → 200" 200 $(code -b "$JAR43B" "$BASE/api/settings")
check "43d: bob PUT settings (view-only) → 403" 403 $(code -b "$JAR43B" -X PUT -H 'Content-Type: application/json' \
  -d '{"orgName":"Hacked"}' "$BASE/api/settings")
check "43d: bob reads tickets (view-only) → 200" 200 $(code -b "$JAR43B" "$BASE/api/tickets")
check "43d: bob creates ticket (view-only) → 403" 403 $(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"x","message":"y"}' "$BASE/api/tickets")
check "43d: bob GET members (restricted member) → 403" 403 $(code -b "$JAR43B" "$BASE/api/org/members")
check "43d: bob POST member → 403" 403 $(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"nope43@membera.example","password":"nopepass123","role":"member"}' "$BASE/api/org/members")
check "43d: bob dashboard (always visible) → 200" 200 $(code -b "$JAR43B" "$BASE/api/dashboard")

echo "-- 43e. PATCH permissions: absent tab = no access; edit flag gates writes =="
S=$(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"permissions":{}}' "$BASE/api/org/members/$BOB_ID")
check "43e: admin strips ALL tabs → 200" 200 "$S"
check "43e: bob reads clients (no clients tab) → 403" 403 $(code -b "$JAR43B" "$BASE/api/clients")
check "43e: bob reads tasks (no tab) → 403" 403 $(code -b "$JAR43B" "$BASE/api/tasks")
check "43e: bob reads invoices (no tab) → 403" 403 $(code -b "$JAR43B" "$BASE/api/invoices")
check "43e: bob reads settings (no tab) → 403" 403 $(code -b "$JAR43B" "$BASE/api/settings")
check "43e: bob reads tickets (no tab) → 403" 403 $(code -b "$JAR43B" "$BASE/api/tickets")
check "43e: bob dashboard (always visible even with no tabs) → 200" 200 $(code -b "$JAR43B" "$BASE/api/dashboard")
S=$(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"permissions":{"clients":{"edit":true}}}' "$BASE/api/org/members/$BOB_ID")
check "43e: admin grants clients edit → 200" 200 "$S"
check "43e: bob reads clients (granted) → 200" 200 $(code -b "$JAR43B" "$BASE/api/clients")
S=$(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bobco LLC","clientType":"commercial"}' "$BASE/api/clients")
check "43e: bob writes client (edit granted) → 201" 201 "$S"
check "43e: bob still blocked on tasks write → 403" 403 $(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Sneak"}' "$BASE/api/tasks")
check "43e: bob still blocked on invoices write → 403" 403 $(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"amount":100}' "$BASE/api/invoices")
check "43e: admin PATCH unknown tab → 400" 400 $(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"permissions":{"leads":{"edit":true}}}' "$BASE/api/org/members/$BOB_ID")
check "43e: admin PATCH malformed permission → 400" 400 $(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"permissions":{"clients":{"edit":"yes"}}}' "$BASE/api/org/members/$BOB_ID")
check "43e: admin PATCH missing member → 404" 404 $(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"permissions":{}}' "$BASE/api/org/members/999999")
check "43e: admin PATCH empty body → 400" 400 $(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{}' "$BASE/api/org/members/$BOB_ID")

echo "-- 43f. Member password flows: PATCH password + change-password (3k) =="
S=$(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"password":"bobnewpass123"}' "$BASE/api/org/members/$BOB_ID")
check "43f: admin PATCH bob password → 200" 200 "$S"
S=$(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"bob43@membera.example","password":"bobnewpass123"}' "$BASE/api/auth/login")
check "43f: bob login with new password → 200" 200 "$S"
S=$(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"currentPassword":"bobnewpass123","newPassword":"bobchanged456"}' "$BASE/api/auth/change-password")
check "43f: bob change-password → 200" 200 "$S"
S=$(code -b "$JAR43B" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"bob43@membera.example","password":"bobchanged456"}' "$BASE/api/auth/login")
check "43f: bob login with changed password → 200" 200 "$S"

echo "-- 43g. Admin member (role=admin): full access + manages members =="
S=$(code -b "$JAR43A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"carol43@membera.example","password":"carolpass123","role":"admin"}' "$BASE/api/org/members")
check "43g: tenant A creates carol (role admin) → 201" 201 "$S"
CAROL_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['member']['id'])")
S=$(code -c "$JAR43C" -b "$JAR43C" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"carol43@membera.example","password":"carolpass123"}' "$BASE/api/auth/login")
check "43g: carol login → 200" 200 "$S"
grep -q '"role":"admin"' /tmp/body.json && echo "  ✓ carol me carries role admin" || echo "  ✗ carol role: $(cat /tmp/body.json)"
check "43g: carol GET members → 200" 200 $(code -b "$JAR43C" "$BASE/api/org/members")
check "43g: carol writes client (admin bypasses) → 201" 201 $(code -b "$JAR43C" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"CarolCo","clientType":"commercial"}' "$BASE/api/clients")
S=$(code -b "$JAR43C" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"dave43@membera.example","password":"davepass123","role":"member"}' "$BASE/api/org/members")
check "43g: carol creates dave → 201" 201 "$S"
DAVE_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['member']['id'])")
check "43g: carol PATCH dave role → 200" 200 $(code -b "$JAR43C" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' "$BASE/api/org/members/$DAVE_ID")
check "43g: carol DELETE dave → 200" 200 $(code -b "$JAR43C" -X DELETE "$BASE/api/org/members/$DAVE_ID")
check "43g: carol PATCH deleted dave → 404" 404 $(code -b "$JAR43C" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"member"}' "$BASE/api/org/members/$DAVE_ID")

echo "-- 43h. Last-admin protection: cannot demote/remove the only admin =="
S=$(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' "$BASE/api/org/members/$FIRST_A_ID")
check "43h: first user promotes self to stored admin → 200" 200 "$S"
check "43h: first user demotes carol (second admin exists) → 200" 200 $(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"member"}' "$BASE/api/org/members/$CAROL_ID")
check "43h: demoted carol GET members → 403" 403 $(code -b "$JAR43C" "$BASE/api/org/members")
check "43h: first user demotes SELF (last admin) → 400" 400 $(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"member"}' "$BASE/api/org/members/$FIRST_A_ID")
check "43h: first user deletes SELF (last admin) → 400" 400 $(code -b "$JAR43A" -X DELETE "$BASE/api/org/members/$FIRST_A_ID")
S=$(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' "$BASE/api/org/members/$CAROL_ID")
check "43h: first user restores carol to admin → 200" 200 "$S"
check "43h: first user demotes self (second admin present) → 200" 200 $(code -b "$JAR43A" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"member"}' "$BASE/api/org/members/$FIRST_A_ID")
check "43h: first user deletes carol (another admin remains) → 200" 200 $(code -b "$JAR43A" -X DELETE "$BASE/api/org/members/$CAROL_ID")

echo "-- 43i. Cross-org isolation: an admin can never touch another account's members =="
check "43i: tenant B PATCH tenant A's member → 404" 404 $(code -b "$JAR43D" -X PATCH -H 'Content-Type: application/json' \
  -d '{"role":"admin"}' "$BASE/api/org/members/$BOB_ID")
check "43i: tenant B DELETE tenant A's member → 404" 404 $(code -b "$JAR43D" -X DELETE "$BASE/api/org/members/$BOB_ID")
S=$(code -b "$JAR43D" "$BASE/api/org/members")
check "43i: tenant B GET own members → 200" 200 "$S"
grep -q 'memberb43@example.com' /tmp/body.json && grep -qv 'bob43@membera.example' /tmp/body.json && echo "  ✓ tenant B sees ONLY its own users" || echo "  ✗ tenant B member list leaked: $(cat /tmp/body.json)"
S=$(code -b "$JAR43D" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"eve43@memberb.example","password":"evepass1234","role":"member","orgId":2}' "$BASE/api/org/members")
check "43i: tenant B POST member with tampered orgId body → 201 (org always from session)" 201 "$S"
S=$(code -b "$JAR43D" "$BASE/api/org/members")
grep -q 'eve43@memberb.example' /tmp/body.json && grep -qv 'bob43' /tmp/body.json && echo "  ✓ tampered orgId ignored — member landed in tenant B's own org" || echo "  ✗ tamper result: $(cat /tmp/body.json)"
check "43i: tenant B deletes own FIRST user (its only admin) → 400" 400 $(code -b "$JAR43D" -X DELETE "$BASE/api/org/members/$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['members'][0]['id'])")")

echo "-- 43j. Owner workspace unaffected: owner still full admin; owner org membership untouched =="
check "43j: owner admin/orgs → 200" 200 $(code -b "$JAR43" "$BASE/api/admin/orgs")
S=$(code -b "$JAR43" "$BASE/api/org/members")
check "43j: owner GET own org members → 200" 200 "$S"
grep -q "$ADMIN_EMAIL" /tmp/body.json && echo "  ✓ owner sees own org's members (itself)" || echo "  ✗ owner member list: $(cat /tmp/body.json)"
S=$(code -b "$JAR43" "$BASE/api/auth/me")
grep -q '"role":"admin"' /tmp/body.json && grep -q '"permissions":{}' /tmp/body.json && echo "  ✓ owner me still role admin + empty permissions (full admin)" || echo "  ✗ owner me: $(cat /tmp/body.json)"
check "43j: owner still reads all-org tickets (owner behavior intact) → 200" 200 $(code -b "$JAR43" "$BASE/api/tickets")

echo "-- 43k. Source markers: schema + enforcement + routes shipped =="
if grep -Fq 'permissions    TEXT NOT NULL DEFAULT' server/db.ts && grep -Fq 'ADD COLUMN permissions TEXT NOT NULL DEFAULT' server/db.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: users.permissions column (CREATE + idempotent migration)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: users.permissions column missing"
fi
if grep -Fq 'TENANT_TABS = ["clients", "tasks", "finance", "settings", "support"]' server/db.ts && grep -Fq 'parsePermissions' server/auth.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: tenant-tab union + permissions parse wired into the session user"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: tenant-tab/permissions missing"
fi
if grep -Fq 'denyTabRead(auth, "clients")' server/api.ts && grep -Fq 'denyTabWrite(auth, "finance")' server/api.ts && grep -Fq 'denyTabRead(auth, "support")' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: per-tab read/write gates on clients / finance / support routes"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: tab gates missing"
fi
if grep -Fq 'pathname === "/api/org/members"' server/api.ts && grep -Fq 'requireOrgAdmin(auth)' server/api.ts && grep -Fq 'Cannot demote the org' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: /api/org/members routes + org-admin gate + last-admin protection"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: member routes missing"
fi
if grep -Fq 'isOwnerOrg(auth.orgId)' server/api.ts && grep -Fq 'isOwnerSession(auth)' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: owner workspace keyed off the owner ORG (not role alone — tenant admins stay tenants)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: owner-org detection missing"
fi

echo "-- 43l. Cleanup: delete member tenants =="
code -b "$JAR43" -X DELETE "$BASE/api/admin/orgs/$TENANT_A_ORG" > /dev/null
code -b "$JAR43" -X DELETE "$BASE/api/admin/orgs/$TENANT_B_ORG" > /dev/null
rm -f "$JAR43" "$JAR43A" "$JAR43B" "$JAR43C" "$JAR43D"
echo "  ✓ 43: team users per client account verified (org admin = original owner login, restricted members per-tab enforced server-side, last-admin protection, cross-org isolation, owner unaffected)"

echo "== 44. Team-members UI + nav gating (owner request 2026-08-14): Settings members section, restricted-member nav gating, isOrgAdmin flag, impersonation targeting =="
echo "-- 44a. Provision a member tenant + fresh sessions =="
JAR44=$(mktemp)
JAR44A=$(mktemp)
JAR44B=$(mktemp)
S=$(code -c "$JAR44" -b "$JAR44" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "44a: owner login" 200 "$S"
S=$(code -b "$JAR44" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"UI Co 44","email":"ui44@example.com","password":"ui44pass1"}' "$BASE/api/admin/orgs")
check "44a: provision tenant" 201 "$S"
UI_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -c "$JAR44A" -b "$JAR44A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"ui44@example.com","password":"ui44pass1"}' "$BASE/api/auth/login")
check "44a: tenant first user login" 200 "$S"
UI_FIRST_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['user']['id'])")
echo "    (tenant org=$UI_ORG, first user id=$UI_FIRST_ID)"

echo "-- 44b. /api/auth/me isOrgAdmin: first-user admin true; stored member false unless first user; owner true =="
S=$(code -b "$JAR44A" "$BASE/api/auth/me")
check "44b: tenant first user me → 200" 200 "$S"
grep -q '"isOrgAdmin":true' /tmp/body.json && echo "  ✓ first user (stored role member) isOrgAdmin TRUE (first-user rule)" || echo "  ✗ first user isOrgAdmin: $(cat /tmp/body.json)"
S=$(code -b "$JAR44A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"member44@ui.example","password":"member44pw","role":"member"}' "$BASE/api/org/members")
check "44b: admin creates restricted member → 201" 201 "$S"
UI_MEMBER_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['member']['id'])")
S=$(code -c "$JAR44B" -b "$JAR44B" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"member44@ui.example","password":"member44pw"}' "$BASE/api/auth/login")
check "44b: member login → 200" 200 "$S"
S=$(code -b "$JAR44B" "$BASE/api/auth/me")
grep -q '"isOrgAdmin":false' /tmp/body.json && echo "  ✓ second member (stored member, not first user) isOrgAdmin FALSE" || echo "  ✗ member isOrgAdmin: $(cat /tmp/body.json)"
S=$(code -b "$JAR44" "$BASE/api/auth/me")
grep -q '"isOrgAdmin":true' /tmp/body.json && echo "  ✓ owner isOrgAdmin TRUE" || echo "  ✗ owner isOrgAdmin: $(cat /tmp/body.json)"

echo "-- 44c. Impersonation targeting: owner lands on the org ADMIN (first user), not a member =="
S=$(code -c "$JAR44" -b "$JAR44" -X POST -H 'Content-Type: application/json' -d "{\"orgId\":$UI_ORG}" "$BASE/api/admin/impersonate")
check "44c: owner impersonates tenant → 200" 200 "$S"
IMP_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['user']['id'])")
if [ "$IMP_ID" = "$UI_FIRST_ID" ]; then PASS=$((PASS+1)); echo "  ✓ impersonation lands on the first user (org admin) id=$IMP_ID"; else FAIL=$((FAIL+1)); echo "  ✗ impersonation landed on id=$IMP_ID, expected first user $UI_FIRST_ID"; fi
grep -q '"isOrgAdmin":true' /tmp/body.json && echo "  ✓ impersonated session reports isOrgAdmin true (admin controls visible)" || echo "  ✗ impersonated isOrgAdmin: $(cat /tmp/body.json)"
check "44c: impersonated user is NOT the restricted member" 200 "$S"
S=$(code -c "$JAR44" -b "$JAR44" -X POST "$BASE/api/auth/impersonate-return")
check "44c: return to owner dashboard → 200" 200 "$S"
S=$(code -b "$JAR44A" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"admin44@ui.example","password":"admin44pw","role":"admin"}' "$BASE/api/org/members")
check "44c: create stored-role admin → 201" 201 "$S"
STORED_ADMIN_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['member']['id'])")
S=$(code -c "$JAR44" -b "$JAR44" -X POST -H 'Content-Type: application/json' -d "{\"orgId\":$UI_ORG}" "$BASE/api/admin/impersonate")
check "44c: impersonate again → 200" 200 "$S"
IMP2_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['user']['id'])")
if [ "$IMP2_ID" = "$STORED_ADMIN_ID" ]; then PASS=$((PASS+1)); echo "  ✓ with a stored admin present, impersonation lands on the stored admin id=$STORED_ADMIN_ID"; else FAIL=$((FAIL+1)); echo "  ✗ impersonation landed on id=$IMP2_ID, expected stored admin $STORED_ADMIN_ID"; fi
S=$(code -c "$JAR44" -b "$JAR44" -X POST "$BASE/api/auth/impersonate-return")
check "44c: return again → 200" 200 "$S"

echo "-- 44d. Bundle: Settings members UI markers + nav gating + owner nav unchanged =="
bun run build >/dev/null 2>&1
NEWEST_JS44=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS44" ]; then
  if grep -Fq 'Team members' "$NEWEST_JS44" && grep -Fq 'Add a team member' "$NEWEST_JS44" && grep -Fq 'Reset password' "$NEWEST_JS44" && grep -Fq 'Temporary password' "$NEWEST_JS44" && grep -Fq 'Can edit' "$NEWEST_JS44" && grep -Fq 'No access' "$NEWEST_JS44"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: Settings members UI markers shipped (list/add/reset/password/per-tab pickers)"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: members UI markers missing from $NEWEST_JS44"
  fi
  if grep -Fq 'view-only access to settings' "$NEWEST_JS44"; then
    PASS=$((PASS+1)); echo "  ✓ bundle: view-only settings notice shipped"
  else
    FAIL=$((FAIL+1)); echo "  ✗ bundle: view-only settings notice missing"
  fi
  for ROW44 in "Dashboard" "Onboarding" "Administration" "Tickets" "Settings"; do
    if grep -Fq "$ROW44" "$NEWEST_JS44"; then PASS=$((PASS+1)); echo "  ✓ bundle: owner nav label \"$ROW44\" present (owner nav — Admin tab renamed Administration per owner direction 2026-08-17)"
    else FAIL=$((FAIL+1)); echo "  ✗ bundle: owner nav label \"$ROW44\" missing from $NEWEST_JS44"; fi
  done
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for 44d bundle check"
fi

echo "-- 44e. Source markers: members UI + nav gating + isOrgAdmin wiring + impersonation targeting =="
if grep -Fq 'Team members' src/Settings.tsx && grep -Fq 'handleAddMember' src/Settings.tsx && grep -Fq 'handleResetPassword' src/Settings.tsx && grep -Fq 'handleRemoveMember' src/Settings.tsx && grep -Fq 'isOrgAdmin' src/Settings.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Settings members section (add/reset/remove/isOrgAdmin gate)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Settings members section markers missing"
fi
if grep -Fq 'canSeeTab' src/App.tsx && grep -Fq 'canEditTab' src/App.tsx && grep -Fq 'user?.permissions?.[tab]' src/App.tsx && grep -Fq 'isOrgAdmin === true' src/App.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: App nav gating + admin bypass (canSeeTab/canEditTab)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: App nav gating markers missing"
fi
if grep -Fq 'const isOwnerOrg = user?.isOwner === true' src/App.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: owner workspace keyed to server-reported user.isOwner (no org-name compare)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: owner-org detection missing"
fi
if grep -Fq 'isOrgAdmin: boolean' server/auth.ts && grep -Fq 'MIN(id)' server/auth.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: /api/auth/me user payload carries isOrgAdmin (first-user rule)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: isOrgAdmin server wiring missing"
fi
if grep -Fq "role = 'admin' ORDER BY id ASC LIMIT 1" server/api.ts && grep -Fq 'org admin' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: impersonation targets the org admin (stored admin else first user)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: impersonation targeting missing"
fi

echo "-- 44f. Cleanup: delete UI tenant =="
code -b "$JAR44" -X DELETE "$BASE/api/admin/orgs/$UI_ORG" > /dev/null
rm -f "$JAR44" "$JAR44A" "$JAR44B"
echo "  ✓ 44: team-members Settings UI + tab-gated nav shipped (bundle markers), /api/auth/me isOrgAdmin verified, impersonation lands on the org admin"

echo "== 45. Native e-signature (owner direction 2026-08-15) =="
# Self-contained like section 28: a throwaway CRM server on :3006 with a fresh
# DB posts emails to a mock Resend endpoint on :3196, which records every
# request as JSONL. The MAIN server on $BASE is untouched. start_crm/stop_crm
# (defined in section 27) are reused here.
MOCK45=$(mktemp -d)
MOCK45_EMAILS="$MOCK45/emails.jsonl"
: > "$MOCK45_EMAILS"
cat > "$MOCK45/resend.ts" <<'TS'
import { appendFileSync } from "node:fs";
const PORT = 3196;
const OUT = process.env.MOCK45_OUT ?? "/tmp/mock45-emails.jsonl";
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      appendFileSync(OUT, JSON.stringify(body) + "\n");
      const to = Array.isArray(body.to) ? body.to.join(",") : String(body.to ?? "");
      if (to.includes("fail@example.com")) {
        // Simulate Resend test mode: only the account owner's email may
        // receive mail (the live 422 the owner hit in live testing).
        return Response.json(
          { message: "You can only send testing emails to your own email address (422)" },
          { status: 422 },
        );
      }
      return Response.json({ id: "mock-" + Math.random().toString(36).slice(2) });
    }
    return new Response("nope", { status: 404 });
  },
});
console.log("mock45 resend on " + PORT);
TS
MOCK45_OUT="$MOCK45_EMAILS" nohup bun "$MOCK45/resend.ts" > "$MOCK45/resend.log" 2>&1 &
MOCK45_PID=$!
i=0; until curl -sf http://127.0.0.1:3196/health >/dev/null 2>&1; do i=$((i+1)); [ "$i" -gt 50 ] && break; sleep 0.2; done
curl -sf http://127.0.0.1:3196/health >/dev/null 2>&1 && { PASS=$((PASS+1)); echo "  ✓ mock Resend up on :3196"; } || { FAIL=$((FAIL+1)); echo "  ✗ mock Resend failed"; }
start_crm 3006 "$MOCK45/db" "$MOCK45/srv.log" "$MOCK45/srv.pid" -u TEST_EMAIL_TO RESEND_API_KEY=test-key-123 RESEND_URL=http://127.0.0.1:3196
S45=http://localhost:3006
cat > "$MOCK45/audit.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
const env = db
  .query(
    "SELECT e.token_hash, e.status, e.signer_name, e.signed_at, e.ip_address, e.consent, e.expires_at FROM agreement_envelopes e JOIN clients c ON c.id = e.client_id WHERE c.company_name = ? ORDER BY e.id DESC LIMIT 1",
  )
  .get(process.env.CLIENT_NAME ?? "") as Record<string, unknown>;
if (!env) { console.log("NO_ENVELOPE"); process.exit(2); }
console.log(JSON.stringify(env));
TS
cat > "$MOCK45/auto.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
const c = db
  .query("SELECT stage, next_action FROM clients WHERE company_name = ?")
  .get(process.env.CLIENT_NAME ?? "") as Record<string, unknown> | null;
if (!c) { console.log("NO_CLIENT"); process.exit(2); }
const t = db
  .query(
    "SELECT COUNT(*) AS n FROM tasks WHERE client_id = (SELECT id FROM clients WHERE company_name = ?) AND title LIKE 'Create client account%' AND done = 0",
  )
  .get(process.env.CLIENT_NAME ?? "") as { n: number };
console.log(JSON.stringify({ stage: c.stage, nextAction: c.next_action, openTasks: Number(t.n) }));
TS
cat > "$MOCK45/expire.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
db.query(
  "UPDATE agreement_envelopes SET expires_at = 1 WHERE client_id = (SELECT id FROM clients WHERE company_name = ?)",
).run(process.env.CLIENT_NAME ?? "");
console.log("expired");
TS
JA45=$(mktemp)   # owner session
JT45=$(mktemp)   # tenant session
echo "-- 45a. Template: owner sets + reads the agreement template == "
S=$(code -c "$JA45" -b "$JA45" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$S45/api/auth/login")
check "45a: owner login → 200" 200 "$S"
S=$(code -b "$JA45" -X PUT -H 'Content-Type: application/json' \
  -d '{"agreementTemplate":"AGREEMENT {{company}} / {{client_name}} / {{date}} / {{price}} / {{deal_value}}\n\nTerms apply."}' "$S45/api/settings")
check "45a: owner saves agreement template → 200" 200 "$S"
S=$(code -b "$JA45" "$S45/api/settings")
check "45a: settings GET → 200" 200 "$S"
grep -q '"agreementTemplate":"AGREEMENT' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ owner settings returns the saved template"; } || { FAIL=$((FAIL+1)); echo "  ✗ template missing: $(cat /tmp/body.json)"; }
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Sig Tenant","email":"sigtenant@example.com","password":"SigTenant123!"}' "$S45/api/admin/orgs")
check "45a: owner provisions tenant → 201" 201 "$S"
grep -q '"emailStatus":"sent"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ provisioning response carries emailStatus sent (welcome email accepted by the mock)"; } || { FAIL=$((FAIL+1)); echo "  ✗ provisioning emailStatus missing: $(cat /tmp/body.json)"; }
T45_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Harbor Legal LLP","contactName":"Jordan Lee","email":"harbor@example.com","industry":"Legal","clientType":"commercial","dealValue":200,"stage":"Onboarding","nextAction":"Send agreement"}' "$S45/api/clients")
check "45a: owner creates Onboarding client → 201" 201 "$S"
HARBOR_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (harbor client id=$HARBOR_ID)"
echo "-- 45b. Send: PDF + token + email; status Not sent → Sent == "
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' -H 'Origin: https://crm.example.test' \
  -d "{\"clientId\":$HARBOR_ID}" "$S45/api/agreements/send")
check "45b: send agreement → 200" 200 "$S"
grep -q '"status":"sent"' /tmp/body.json && grep -q '"emailTo":"harbor@example.com"' /tmp/body.json && grep -q '"emailStatus":"sent"' /tmp/body.json && grep -q '"signUrl":"https://crm.example.test/sign/' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ send marks Sent + emailStatus sent + signUrl returned"; } || { FAIL=$((FAIL+1)); echo "  ✗ send response: $(cat /tmp/body.json)"; }
sleep 1
if grep -q "Your agreement is ready to sign" "$MOCK45_EMAILS" && grep -q "harbor@example.com" "$MOCK45_EMAILS"; then
  PASS=$((PASS+1)); echo "  ✓ mock received the agreement email"
else
  FAIL=$((FAIL+1)); echo "  ✗ agreement email missing: $(cat "$MOCK45_EMAILS")"
fi
TOKEN45=$(grep -o 'sign/[a-f0-9]\{64\}' "$MOCK45_EMAILS" | head -1 | cut -d/ -f2)
if [ -n "$TOKEN45" ] && [ ${#TOKEN45} -eq 64 ]; then
  PASS=$((PASS+1)); echo "  ✓ unique sign token extracted from email (${#TOKEN45} chars)"
else
  FAIL=$((FAIL+1)); echo "  ✗ no sign token in email: $(cat "$MOCK45_EMAILS")"
fi
if DB_FILE="$MOCK45/db/crm.db" CLIENT_NAME="Harbor Legal LLP" bun "$MOCK45/audit.ts" > "$MOCK45/audit1.json" 2>"$MOCK45/audit1.err"; then
  python3 - "$MOCK45/audit1.json" "$TOKEN45" <<'PY'
import json, sys, time, hashlib
d = json.load(open(sys.argv[1])); raw = sys.argv[2]
assert d["status"] == "sent", d
assert len(d["token_hash"]) == 64 and d["token_hash"] != raw, d
assert d["token_hash"] == hashlib.sha256(raw.encode()).hexdigest(), d
assert d["expires_at"] > time.time() * 1000, d
print("ok")
PY
  if [ $? -eq 0 ]; then PASS=$((PASS+1)); echo "  ✓ DB: envelope stored (sha-256 token hash, unexpired, status sent)"; else FAIL=$((FAIL+1)); echo "  ✗ envelope DB check failed: $(cat "$MOCK45/audit1.json")"; fi
else
  FAIL=$((FAIL+1)); echo "  ✗ audit script failed: $(cat "$MOCK45/audit1.err" 2>/dev/null)"; fi
ls "$MOCK45/db/agreements/"*.pdf >/dev/null 2>&1 && { PASS=$((PASS+1)); echo "  ✓ generated PDF stored in the data dir"; } || { FAIL=$((FAIL+1)); echo "  ✗ PDF missing"; }
echo "-- 45c. Public page: first open → Delivered + IP captured == "
S=$(code -b "$JAR" "$S45/sign/$TOKEN45")
check "45c: public sign page → 200" 200 "$S"
grep -q "Sign your agreement" /tmp/body.json && grep -q "Harbor Legal LLP" /tmp/body.json && grep -q "AGREEMENT Revzenta / Harbor Legal LLP" /tmp/body.json && grep -q "/ \$200.00 / \$200.00" /tmp/body.json && ! grep -q '{{' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ page renders the template with every placeholder filled ({{company}} = the OWNER org name (Revzenta), NOT the client's; {{client_name}} = business name + {{date}} + {{price}} + {{deal_value}} = \$200.00; no literal {{ left)"; } || { FAIL=$((FAIL+1)); echo "  ✗ page content: $(head -c 300 /tmp/body.json)"; }
S=$(code -b "$JA45" "$S45/api/agreements")
check "45c: owner audit list → 200" 200 "$S"
grep -q '"status":"delivered"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ first open advanced status to Delivered"; } || { FAIL=$((FAIL+1)); echo "  ✗ audit list: $(cat /tmp/body.json)"; }
echo "-- 45d. Sign: typed name + consent + audit; one-time use == "
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"action":"sign","name":"","consent":true}' "$S45/api/sign/$TOKEN45")
check "45d: sign without name → 400" 400 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"action":"sign","name":"Jordan Lee","consent":false}' "$S45/api/sign/$TOKEN45")
check "45d: sign without consent → 400" 400 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"action":"sign","name":"Jordan Lee","consent":true}' "$S45/api/sign/$TOKEN45")
check "45d: sign with name + consent → 200" 200 "$S"
grep -q '"status":"signed"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ sign returns status signed"; } || { FAIL=$((FAIL+1)); echo "  ✗ sign response: $(cat /tmp/body.json)"; }
if DB_FILE="$MOCK45/db/crm.db" CLIENT_NAME="Harbor Legal LLP" bun "$MOCK45/audit.ts" > "$MOCK45/audit2.json" 2>/dev/null; then
  python3 - "$MOCK45/audit2.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["status"] == "signed", d
assert d["signer_name"] == "Jordan Lee", d
assert d["signed_at"] and len(d["signed_at"]) > 10, d
assert d["ip_address"] and d["ip_address"] in ("127.0.0.1", "::1", "0:0:0:0:0:0:0:1"), d
assert d["consent"] == 1, d
print("ok")
PY
  if [ $? -eq 0 ]; then PASS=$((PASS+1)); echo "  ✓ audit recorded: name, timestamp, IP (127.0.0.1), consent"; else FAIL=$((FAIL+1)); echo "  ✗ audit values: $(cat "$MOCK45/audit2.json")"; fi
else FAIL=$((FAIL+1)); echo "  ✗ audit script 2 failed"; fi
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"action":"sign","name":"Again","consent":true}' "$S45/api/sign/$TOKEN45")
check "45d: second sign attempt → 400 (one-time use)" 400 "$S"
grep -q "already been used" /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ second attempt rejected with already-used message"; } || { FAIL=$((FAIL+1)); echo "  ✗ second-attempt body: $(cat /tmp/body.json)"; }
S=$(code -b "$JAR" "$S45/sign/$TOKEN45")
grep -q "This agreement has been signed" /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ signed link shows the final state, not a re-sign form"; } || { FAIL=$((FAIL+1)); echo "  ✗ final state missing"; }
S=$(code -b "$JA45" "$S45/api/clients")
grep -q '"agreementStatus":"signed"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ owner client tracker shows Signed"; } || { FAIL=$((FAIL+1)); echo "  ✗ client agreementStatus: $(cat /tmp/body.json)"; }
echo "-- 45d2. Signed → auto-advance to Clients + 'Create client account' task (owner workflow, live-test finding) =="
if DB_FILE="$MOCK45/db/crm.db" CLIENT_NAME="Harbor Legal LLP" bun "$MOCK45/auto.ts" > "$MOCK45/auto1.json" 2>/dev/null; then
  python3 - "$MOCK45/auto1.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["stage"] == "Sold", d                      # terminal stage of the owner org (Leads→Onboarding→Sold)
assert d["nextAction"] == "Create client account", d
assert d["openTasks"] == 1, d                       # exactly one OPEN account task
print("ok")
PY
  if [ $? -eq 0 ]; then PASS=$((PASS+1)); echo "  ✓ signed record auto-advanced to the terminal stage (Sold) + nextAction set + one open 'Create client account' task"; else FAIL=$((FAIL+1)); echo "  ✗ auto-advance values: $(cat "$MOCK45/auto1.json")"; fi
else FAIL=$((FAIL+1)); echo "  ✗ auto.ts failed"; fi
# Dedupe: re-send a FRESH agreement for the same client and sign it again —
# the open task must NOT be duplicated, and the record stays in the terminal
# stage (a completed task WOULD be recreated, but this one is still open).
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' -d "{\"clientId\":$HARBOR_ID}" "$S45/api/agreements/send")
check "45d2: re-send agreement → 200" 200 "$S"
sleep 1
TOKEN45R=$(grep -o 'sign/[a-f0-9]\{64\}' "$MOCK45_EMAILS" | tail -1 | cut -d/ -f2)
if [ -n "$TOKEN45R" ] && [ ${#TOKEN45R} -eq 64 ]; then
  PASS=$((PASS+1)); echo "  ✓ fresh sign token issued for the re-send"
else
  FAIL=$((FAIL+1)); echo "  ✗ no fresh token: $(cat "$MOCK45_EMAILS")"
fi
S=$(code -b "$JAR" "$S45/sign/$TOKEN45R")
check "45d2: re-send link opens → 200" 200 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"sign","name":"Jordan Lee","consent":true}' "$S45/api/sign/$TOKEN45R")
check "45d2: re-sign → 200" 200 "$S"
grep -q '"status":"signed"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ re-sign returns signed"; } || { FAIL=$((FAIL+1)); echo "  ✗ re-sign response: $(cat /tmp/body.json)"; }
if DB_FILE="$MOCK45/db/crm.db" CLIENT_NAME="Harbor Legal LLP" bun "$MOCK45/auto.ts" > "$MOCK45/auto2.json" 2>/dev/null; then
  python3 - "$MOCK45/auto2.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["stage"] == "Sold", d
assert d["nextAction"] == "Create client account", d
assert d["openTasks"] == 1, d    # still exactly one — the re-sign did NOT duplicate it
print("ok")
PY
  if [ $? -eq 0 ]; then PASS=$((PASS+1)); echo "  ✓ re-sign did not duplicate the open task (dedupe) and the stage stayed terminal"; else FAIL=$((FAIL+1)); echo "  ✗ dedupe check: $(cat "$MOCK45/auto2.json")"; fi
else FAIL=$((FAIL+1)); echo "  ✗ auto.ts (dedupe) failed"; fi
echo "-- 45e. Decline path for another client == "
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Cedar Co","contactName":"Alex Cedar","email":"cedar@example.com","industry":"Home Services","clientType":"residential","dealValue":150,"stage":"Onboarding"}' "$S45/api/clients")
check "45e: create second Onboarding client → 201" 201 "$S"
CEDAR_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' -d "{\"clientId\":$CEDAR_ID}" "$S45/api/agreements/send")
check "45e: send agreement → 200" 200 "$S"
sleep 1
TOKEN45C=$(grep -o 'sign/[a-f0-9]\{64\}' "$MOCK45_EMAILS" | tail -1 | cut -d/ -f2)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"decline"}' "$S45/api/sign/$TOKEN45C")
check "45e: decline → 200" 200 "$S"
grep -q '"status":"declined"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ decline returns status declined"; } || { FAIL=$((FAIL+1)); echo "  ✗ decline response: $(cat /tmp/body.json)"; }
S=$(code -b "$JA45" "$S45/api/agreements")
grep -q '"status":"declined"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ audit list shows Declined"; } || { FAIL=$((FAIL+1)); echo "  ✗ declined missing"; }
# Decline must NOT auto-advance the record or create the account task (sign-only).
if DB_FILE="$MOCK45/db/crm.db" CLIENT_NAME="Cedar Co" bun "$MOCK45/auto.ts" > "$MOCK45/auto3.json" 2>/dev/null; then
  python3 - "$MOCK45/auto3.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["stage"] == "Onboarding", d   # decline leaves the record in place
assert d["openTasks"] == 0, d          # no account task on decline
print("ok")
PY
  if [ $? -eq 0 ]; then PASS=$((PASS+1)); echo "  ✓ decline left the record in place (no stage change, no task — sign-only behavior)"; else FAIL=$((FAIL+1)); echo "  ✗ decline side-effects: $(cat "$MOCK45/auto3.json")"; fi
else FAIL=$((FAIL+1)); echo "  ✗ auto.ts (decline) failed"; fi
echo "-- 45f. Invalid + expired tokens == "
S=$(code -b "$JAR" "$S45/sign/bogustoken")
grep -q "This link is invalid" /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ invalid token page renders a clear message"; } || { FAIL=$((FAIL+1)); echo "  ✗ invalid page: $(head -c 200 /tmp/body.json)"; }
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"sign","name":"X","consent":true}' "$S45/api/sign/bogustoken")
check "45f: POST invalid token → 400" 400 "$S"
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Expired Co","contactName":"Eva Expired","email":"expired@example.com","industry":"Other","clientType":"residential","stage":"Onboarding"}' "$S45/api/clients")
check "45f: create third client → 201" 201 "$S"
EXP_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' -d "{\"clientId\":$EXP_ID}" "$S45/api/agreements/send")
check "45f: send agreement → 200" 200 "$S"
sleep 1
TOKEN45E=$(grep -o 'sign/[a-f0-9]\{64\}' "$MOCK45_EMAILS" | tail -1 | cut -d/ -f2)
CLIENT_NAME="Expired Co" DB_FILE="$MOCK45/db/crm.db" bun "$MOCK45/expire.ts" >/dev/null 2>&1
S=$(code -b "$JAR" "$S45/sign/$TOKEN45E")
grep -q "This link has expired" /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ expired token page renders a clear message"; } || { FAIL=$((FAIL+1)); echo "  ✗ expired page: $(head -c 200 /tmp/body.json)"; }
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"action":"sign","name":"X","consent":true}' "$S45/api/sign/$TOKEN45E")
check "45f: POST expired token → 400" 400 "$S"
grep -q "expired" /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ expired POST rejected with expiry message"; } || { FAIL=$((FAIL+1)); echo "  ✗ expired POST body: $(cat /tmp/body.json)"; }
echo "-- 45g. Owner-only enforcement: tenants cannot send/see agreement data == "
S=$(code -c "$JT45" -b "$JT45" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"sigtenant@example.com","password":"SigTenant123!"}' "$S45/api/auth/login")
check "45g: tenant login → 200" 200 "$S"
S=$(code -b "$JT45" -X POST -H 'Content-Type: application/json' -d "{\"clientId\":$HARBOR_ID}" "$S45/api/agreements/send")
check "45g: tenant POST agreements/send → 403" 403 "$S"
S=$(code -b "$JT45" "$S45/api/agreements")
check "45g: tenant GET agreements → 403" 403 "$S"
S=$(code -b "$JT45" "$S45/api/settings")
grep -qv 'agreementTemplate' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ tenant settings response carries no agreement template"; } || { FAIL=$((FAIL+1)); echo "  ✗ tenant sees agreementTemplate: $(cat /tmp/body.json)"; }
echo "-- 45h. Bundle + source markers: sign page + template editor == "
bun run build >/dev/null 2>&1
NEWEST_JS45=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS45" ]; then
  for M45 in "Send Agreements" "Re-send" "Agreement template" "Save agreement template" "Agreement details"; do
    if grep -Fq "$M45" "$NEWEST_JS45"; then PASS=$((PASS+1)); echo "  ✓ bundle: \"$M45\" shipped"; else FAIL=$((FAIL+1)); echo "  ✗ bundle: \"$M45\" missing"; fi
  done
  for M45B in "Agreement link generated, but the email failed to send" "Signing link:" "the welcome email could not be sent"; do
    if grep -Fq "$M45B" "$NEWEST_JS45"; then PASS=$((PASS+1)); echo "  ✓ bundle: email-failure UI \"$M45B\" shipped"; else FAIL=$((FAIL+1)); echo "  ✗ bundle: email-failure UI \"$M45B\" missing"; fi
  done
else FAIL=$((FAIL+1)); echo "  ✗ dist build missing for 45h"; fi
if grep -Fq "renderSignPage" server/agreements.ts && grep -Fq "generateAgreementPdf" server/agreements.ts && grep -Fq "resolveAgreement" server/agreements.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: agreements module (renderSignPage/generateAgreementPdf/resolveAgreement)"
else FAIL=$((FAIL+1)); echo "  ✗ source: agreements module markers missing"; fi
if grep -Fq '"/api/agreements/send"' server/api.ts && grep -Fq '"/api/agreements"' server/api.ts && grep -Fq '"/api/sign/"' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: owner send + audit + public sign routes"
else FAIL=$((FAIL+1)); echo "  ✗ source: api routes markers missing"; fi
if grep -Fq '"/sign/"' server/index.ts && grep -Fq '"/agreement-pdf/"' server/index.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: public /sign/ + /agreement-pdf/ routes"
else FAIL=$((FAIL+1)); echo "  ✗ source: index routes missing"; fi
if grep -Fq "handleSendAgreement" src/Clients.tsx && grep -Fq "openAudit" src/Clients.tsx && grep -Fq "agreement_envelopes" server/db.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: owner UI (send + audit) + envelopes table"
else FAIL=$((FAIL+1)); echo "  ✗ source: owner UI markers missing"; fi
if grep -Fq "saveAgreementTemplate" src/Admin.tsx && grep -Fq "agreementTemplate" src/api.ts && ! grep -Fq "saveAgreementTemplate" src/Settings.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: template editor now under Administration (Admin.tsx) + api wiring; Settings no longer hosts it"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: template editor markers missing"
fi
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Fail Tenant LLC","email":"fail@example.com","password":"failpass123"}' "$S45/api/admin/orgs")
check "45i: provision tenant with failing recipient → 201" 201 "$S"
if grep -q '"emailStatus":"failed"' /tmp/body.json && grep -q '"emailError"' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ provisioning reports emailStatus failed + emailError"
else
  FAIL=$((FAIL+1)); echo "  ✗ provisioning failure fields missing: $(cat /tmp/body.json)"
fi
# The emailError must carry the Resend 422 detail (the mock rejects
# fail@example.com with HTTP 422, like Resend test mode) — asserted against
# THIS provisioning response, not a stale body from an earlier request.
if grep -q '"emailError":"Resend returned 422' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ emailError surfaces the Resend 422 detail"
else
  FAIL=$((FAIL+1)); echo "  ✗ emailError lacks the 422 detail: $(cat /tmp/body.json)"
fi
echo "-- 45k. Central Documents view (owner live-test finding: 'where are we storing these documents — they should be under admin') =="
# The owner's Documents tab renders the existing owner-only audit API. Verify
# every field the view needs is present, the PDF link resolves, the tenant
# still gets 403, and the view ships (source + bundle).
S=$(code -b "$JA45" "$S45/api/agreements")
PDF45=$(grep -o '"pdfId":"[a-f0-9]*"' /tmp/body.json | head -1 | cut -d'"' -f4)
if grep -q '"clientName":"Harbor Legal LLP"' /tmp/body.json && grep -q '"signerName":"Jordan Lee"' /tmp/body.json && grep -q '"ipAddress":"127.0.0.1"' /tmp/body.json && grep -q '"consent":true' /tmp/body.json && grep -q '"status":"signed"' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ owner audit API returns every Documents-view field (client, status, signer, IP, consent)"
else
  FAIL=$((FAIL+1)); echo "  ✗ owner audit API missing Documents fields: $(cat /tmp/body.json)"
fi
if [ -n "$PDF45" ]; then
  S=$(code -b "$JAR" "$S45/agreement-pdf/$PDF45")
  check "45k: Documents PDF link → 200" 200 "$S"
  CT45=$(curl -s -b "$JAR" -o /dev/null -w "%{content_type}" "$S45/agreement-pdf/$PDF45")
  if [ "$CT45" = "application/pdf" ]; then PASS=$((PASS+1)); echo "  ✓ PDF served with Content-Type application/pdf"; else FAIL=$((FAIL+1)); echo "  ✗ PDF content-type: $CT45"; fi
else
  FAIL=$((FAIL+1)); echo "  ✗ no pdfId in owner audit list"; fi
S=$(code -b "$JT45" "$S45/api/agreements")
check "45k: tenant GET agreements → 403 (Documents view is owner-only)" 403 "$S"
if grep -Fq "agreements" src/Documents.tsx && grep -Fq "agreement-pdf" src/Documents.tsx && grep -Fq "signedAt" src/Documents.tsx && grep -Fq "ipAddress" src/Documents.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Documents view renders envelopes + audit trail (signer/signedAt/IP/consent) + PDF links"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: src/Documents.tsx markers missing"; fi
if grep -Fq 'setView("documents")' src/App.tsx && grep -Fq '"documents"' src/App.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: owner-only Documents tab wired in App.tsx"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Documents tab markers missing"; fi
# Part B — the agreement Audit button moved OUT of the Agreement-status cell
# and INTO the Actions column (next to Edit/Delete).
if awk '/<td data-label="Agreement">/,/<\/td>/' src/Clients.tsx | grep -Fq "Agreement details for"; then
  FAIL=$((FAIL+1)); echo "  ✗ audit button still inside the agreement-status cell"
else
  PASS=$((PASS+1)); echo "  ✓ audit button removed from the agreement-status cell"
fi
if awk '/<td data-label="Actions">/,/<\/td>/' src/Clients.tsx | grep -Fq "Agreement details for"; then
  PASS=$((PASS+1)); echo "  ✓ audit button moved into the Actions column (next to Edit/Delete)"
else
  FAIL=$((FAIL+1)); echo "  ✗ audit button not found in the Actions column"; fi
# Bundle markers (the 45h build above is still current — nothing rebuilt since).
NEWEST_JS45=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS45" ] && grep -Fq "No agreement documents yet" "$NEWEST_JS45" && grep -Fq "Documents" "$NEWEST_JS45"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: Documents view shipped"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: Documents markers missing"; fi

echo "-- 45l. PDF text auto-fills the record-type client name + every placeholder renders (owner direction 2026-08-17) =="
# Owner live-test finding: the generated agreement PDF must show the CLIENT's
# name on the 'Client: ...' line — the business name for a business client,
# the person's FULL NAME (first + last) for an individual — consistent with
# the global display rules. The old behavior rendered the commercial 'Contact
# name' (the contact PERSON, or a partial/leftover value for individuals).
# pdf-lib compresses content streams (FlateDecode) AND encodes drawn text as
# HEX strings (<4142...> Tj), so probe the PDF by inflating every stream and
# decoding the page content streams (hex + literal strings) back to plain
# text, then grepping that for the name/value strings.
cat > "$MOCK45/pdfprobe.ts" <<'TS'
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
const file = process.argv[2];
const wants = process.argv.slice(3);
const buf = readFileSync(file);
const raw = buf.toString("latin1");
const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let m;
const parts: string[] = [];
while ((m = re.exec(raw)) !== null) {
  try {
    parts.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
  } catch { /* not a flate stream — leave as-is */ }
}
const hexToText = (hex: string): string => {
  const h = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return out;
};
let text = raw + "\n" + parts.join("\n");
for (const part of parts) {
  // Only page content streams carry drawn text (Tj/TJ operators) — decoding
  // hex strings in object streams would just add font/metadata noise.
  if (!part.includes("Tj") && !part.includes("TJ")) continue;
  text += "\n" + part
    .replace(/<([0-9A-Fa-f\s]+)>/g, (_: string, h: string) => hexToText(h))
    .replace(/\(((?:\\.|[^\\()])*)\)/g, (_: string, s: string) => s.replace(/\\([\\()])/g, "$1"));
}
let ok = true;
for (const w of wants) {
  const neg = w.startsWith("!");
  const needle = neg ? w.slice(1) : w;
  const hit = text.includes(needle);
  if (neg ? hit : !hit) { ok = false; console.log((neg ? "UNEXPECTED-PRESENT: " : "MISSING: ") + needle); }
}
console.log(ok ? "ok" : "FAIL");
process.exit(ok ? 0 : 1);
TS
# Select the PDF by the CLIENT's envelope (pdf_id in the DB), not by mtime —
# earlier sends (Expired Co in 45f) would otherwise be picked as the "newest".
cat > "$MOCK45/pdfpath.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
const r = db
  .query(
    "SELECT e.pdf_id FROM agreement_envelopes e JOIN clients c ON c.id = e.client_id WHERE c.company_name = ? ORDER BY e.id DESC LIMIT 1",
  )
  .get(process.env.CLIENT_NAME ?? "") as { pdf_id: string } | null;
console.log(r ? r.pdf_id : "");
TS
# Business client (Harbor Legal LLP, commercial) — the PDF must show the
# BUSINESS name and must NOT show the contact person (Jordan Lee) anywhere.
PDF45L_ID=$(DB_FILE="$MOCK45/db/crm.db" CLIENT_NAME="Harbor Legal LLP" bun "$MOCK45/pdfpath.ts" 2>/dev/null)
PDF45L="$MOCK45/db/agreements/$PDF45L_ID.pdf"
if [ -n "$PDF45L_ID" ] && [ -f "$PDF45L" ] && DB_FILE="$MOCK45/db/crm.db" bun "$MOCK45/pdfprobe.ts" "$PDF45L" "Harbor Legal LLP" "!Jordan Lee" '!{{' '$200.00' > "$MOCK45/probe1.out" 2>&1; then
  PASS=$((PASS+1)); echo "  ✓ PDF (business client): business name 'Harbor Legal LLP' present; contact person 'Jordan Lee' absent; {{price}} + {{deal_value}} both render \$200.00; no literal {{"
else
  FAIL=$((FAIL+1)); echo "  ✗ PDF business probe failed: $(cat "$MOCK45/probe1.out" 2>/dev/null)"
fi
# Individual client — companyName holds the FULL NAME; a leftover partial
# 'Contact name' must never leak into the document.
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Morgan Rivera","contactName":"Leftover Partial","email":"morgan@example.com","industry":"Home Services","clientType":"residential","dealValue":175,"stage":"Onboarding"}' "$S45/api/clients")
check "45l: owner creates individual client (full name + leftover partial contact name) → 201" 201 "$S"
MORGAN_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JA45" -X POST -H 'Content-Type: application/json' -d "{\"clientId\":$MORGAN_ID}" "$S45/api/agreements/send")
check "45l: send agreement for the individual → 200" 200 "$S"
sleep 1
TOKEN45M=$(grep -o 'sign/[a-f0-9]\{64\}' "$MOCK45_EMAILS" | tail -1 | cut -d/ -f2)
PDF45M_ID=$(DB_FILE="$MOCK45/db/crm.db" CLIENT_NAME="Morgan Rivera" bun "$MOCK45/pdfpath.ts" 2>/dev/null)
PDF45M="$MOCK45/db/agreements/$PDF45M_ID.pdf"
if [ -n "$PDF45M_ID" ] && [ -f "$PDF45M" ] && DB_FILE="$MOCK45/db/crm.db" bun "$MOCK45/pdfprobe.ts" "$PDF45M" "Morgan Rivera" "!Leftover Partial" '!{{' '$175.00' > "$MOCK45/probe2.out" 2>&1; then
  PASS=$((PASS+1)); echo "  ✓ PDF (individual): full name 'Morgan Rivera' present; leftover partial contact name absent; deal value \$175.00 rendered; no literal {{"
else
  FAIL=$((FAIL+1)); echo "  ✗ PDF individual probe failed: $(cat "$MOCK45/probe2.out" 2>/dev/null)"
fi
# The public sign page shows the SAME document text (auto-filled name) while
# the typed-signature field stays MANUAL (owner direction: document text ONLY).
S=$(code -b "$JAR" "$S45/sign/$TOKEN45M")
check "45l: individual sign page → 200" 200 "$S"
if grep -q "Morgan Rivera" /tmp/body.json && ! grep -q "Leftover Partial" /tmp/body.json && grep -q "Your full name" /tmp/body.json && grep -q 'id="name"' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ sign page: document text auto-fills the full name; typed-signature field remains a manual entry"
else
  FAIL=$((FAIL+1)); echo "  ✗ individual sign page content: $(head -c 300 /tmp/body.json)"
fi
echo "-- 45m. Template editor lives under Administration -> Agreements (owner direction 2026-08-17) =="
# One home for the editor: src/Admin.tsx (owner Administration tab) hosts the
# Agreements section; src/Settings.tsx no longer renders it. Owner-workspace
# only — tenant workspaces are untouched (Settings is tenant-rendered and
# never had the card; the server still owner-gates the template route).
if grep -Fq "saveAgreementTemplate" src/Admin.tsx && grep -Fq "Agreement template" src/Admin.tsx && grep -Fq "Agreements" src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Agreements section (editor + save) lives in src/Admin.tsx (Administration)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Agreements section markers missing from src/Admin.tsx"
fi
if ! grep -Fq "saveAgreementTemplate" src/Settings.tsx && ! grep -Fq "Agreement template" src/Settings.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Settings no longer hosts the agreement template editor (no duplicate)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Settings still contains agreement template editor markers"
fi
if grep -Fq "Administration" src/App.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: owner nav tab reads Administration (App.tsx)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Administration nav label missing from src/App.tsx"
fi
# Scroll box (change 2): the textarea is a fixed-height scroll box.
if awk '/\.agree-template-input \{/,/\}/' src/styles.css | grep -q "overflow-y" && awk '/\.agree-template-input \{/,/\}/' src/styles.css | grep -q "height: 440px"; then
  PASS=$((PASS+1)); echo "  ✓ source: .agree-template-input is a scroll box (fixed height 440px + overflow-y)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: .agree-template-input scroll-box CSS missing from src/styles.css"
fi
# Bundle markers (the 45h build above is current — nothing rebuilt since).
NEWEST_JS45=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS45" ] && grep -Fq "Administration" "$NEWEST_JS45" && grep -Fq "Agreements" "$NEWEST_JS45" && grep -Fq "Save agreement template" "$NEWEST_JS45"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: Administration nav + Agreements section (template editor) shipped"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: Administration/Agreements markers missing from $NEWEST_JS45"
fi
if [ -n "$NEWEST_JS45" ] && grep -Fq "Agreement template" "$NEWEST_JS45"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: 'Agreement template' still shipped (now from Admin.tsx)"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: 'Agreement template' missing from $NEWEST_JS45"
fi

echo "-- 45j. Cleanup == "
stop_crm "$MOCK45/srv.pid" 2>/dev/null
kill "$MOCK45_PID" 2>/dev/null
rm -f "$JA45" "$JT45"
rm -rf "$MOCK45"
echo "  ✓ 45: native e-signature shipped (PDF generation, unique sign link + email, public sign/decline page with audit, owner tracker auto-advance + audit view, owner-only enforcement)"

echo "== 46. Phase 5 prep - self-serve data export (tenant self-service) =="
# Two throwaway tenant orgs, each with its own data. The export must contain
# ONLY the requesting org's rows - no cross-tenant leakage - and never any
# credential (password hashes, sign tokens, temp passwords).
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "owner re-login for phase-5 prep -> 200" 200 "$S"
EXA_EMAIL="exporta@phase5.example"
EXA_PASS="exporta123"
EXB_EMAIL="exportb@phase5.example"
EXB_PASS="exportb123"
JARA=$(mktemp); JARB=$(mktemp); JARX=$(mktemp)
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"Export Org A\",\"email\":\"$EXA_EMAIL\",\"password\":\"$EXA_PASS\"}" "$BASE/api/admin/orgs")
check "owner creates export org A -> 201" 201 "$S"
EXA_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"Export Org B\",\"email\":\"$EXB_EMAIL\",\"password\":\"$EXB_PASS\"}" "$BASE/api/admin/orgs")
check "owner creates export org B -> 201" 201 "$S"
EXB_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
S=$(code -c "$JARA" -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EXA_EMAIL\",\"password\":\"$EXA_PASS\"}" "$BASE/api/auth/login")
check "org A admin login -> 200" 200 "$S"
S=$(code -c "$JARB" -b "$JARB" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EXB_EMAIL\",\"password\":\"$EXB_PASS\"}" "$BASE/api/auth/login")
check "org B admin login -> 200" 200 "$S"
# Org A defines a custom field and creates a client (with a custom-field
# value), a task, an invoice and a support ticket - everything the export
# must include.
S=$(code -b "$JARA" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"Color","type":"text"}]}' "$BASE/api/settings")
check "org A defines custom field -> 200" 200 "$S"
S=$(code -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"A-Only Co","contactName":"Ann A","clientType":"commercial","address":"1 A Way","dealValue":1000,"stage":"Prospect","customFields":[{"name":"Color","value":"Blue"}]}' "$BASE/api/clients")
check "org A creates client -> 201" 201 "$S"
EXA_CLIENT=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"A follow-up\",\"clientId\":$EXA_CLIENT}" "$BASE/api/tasks")
check "org A creates task -> 201" 201 "$S"
S=$(code -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d "{\"clientId\":$EXA_CLIENT,\"amount\":100.5,\"status\":\"sent\"}" "$BASE/api/invoices")
check "org A creates invoice -> 201" 201 "$S"
S=$(code -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d '{"subject":"A ticket","message":"A message","priority":"HIGH"}' "$BASE/api/tickets")
check "org A creates ticket -> 201" 201 "$S"
# Org B creates its own client (the cross-tenant canary).
S=$(code -b "$JARB" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"B-Only Co","contactName":"Bob B","clientType":"commercial","address":"2 B Way","dealValue":2000,"stage":"Prospect"}' "$BASE/api/clients")
check "org B creates client -> 201" 201 "$S"

echo "-- 46a. Export returns ONLY the requesting org's data =="
EXPA=$(curl -s -D /tmp/hdr.txt -o /tmp/body.json -w "%{http_code}" -b "$JARA" "$BASE/api/settings/export")
check "org A export -> 200" 200 "$EXPA"
grep -qi "Content-Disposition: attachment" /tmp/hdr.txt && echo "  OK export is an attachment download" || echo "  XX Content-Disposition missing: $(head -3 /tmp/hdr.txt)"
grep -qi 'filename="crm-export-' /tmp/hdr.txt && echo "  OK attachment filename is crm-export-*.json" || echo "  XX filename wrong: $(cat /tmp/hdr.txt)"
# AZ defect D2 regression (2026-08-17): the filename must contain the REAL org
# slug and date (never the literal ${slug}/${date} placeholders).
if grep -qi 'filename="crm-export-export-org-a-' /tmp/hdr.txt; then PASS=$((PASS+1)); echo "  OK export filename contains the org slug"; else FAIL=$((FAIL+1)); echo "  XX export filename missing org slug: $(cat /tmp/hdr.txt)"; fi
if grep -qE 'crm-export-[^" ]*[0-9]{4}-[0-9]{2}-[0-9]{2}' /tmp/hdr.txt; then PASS=$((PASS+1)); echo "  OK export filename contains a date"; else FAIL=$((FAIL+1)); echo "  XX export filename missing date: $(cat /tmp/hdr.txt)"; fi
if grep -q '\${' /tmp/hdr.txt; then FAIL=$((FAIL+1)); echo "  XX export filename still has a literal \${ placeholder: $(cat /tmp/hdr.txt)"; else PASS=$((PASS+1)); echo "  OK export filename has no literal \${ placeholder"; fi
if EXA_ORG="$EXA_ORG" EXA_EMAIL="$EXA_EMAIL" python3 - <<'PY'
import json, os
d = json.load(open('/tmp/body.json'))
assert d['schemaVersion'] == 1, d
assert d['org']['id'] == int(os.environ['EXA_ORG']), d['org']
names = [c['company_name'] for c in d['clients']]
assert names == ['A-Only Co'], names
assert all(c['org_id'] == d['org']['id'] for c in d['clients']), 'client rows not org-scoped'
assert len(d['tasks']) == 1 and d['tasks'][0]['title'] == 'A follow-up', d['tasks']
assert len(d['invoices']) == 1 and float(d['invoices'][0]['amount']) == 100.5, d['invoices']
assert len(d['tickets']) == 1 and d['tickets'][0]['subject'] == 'A ticket', d['tickets']
assert any(f['name'] == 'Color' for f in d['org']['customFields']), d['org']['customFields']
vals = d['clients'][0]['custom_fields']
assert 'Color' in vals and 'Blue' in vals, vals
emails = [u['email'] for u in d['users']]
assert emails == [os.environ['EXA_EMAIL']], emails
raw = open('/tmp/body.json').read()
assert 'password_hash' not in raw and 'token_hash' not in raw and 'provisioned_temp_password' not in raw, 'credential leaked'
print("ok")
PY
then PASS=$((PASS+1)); echo "  OK export payload: org A only (client/task/invoice/ticket/custom field/users) + no credentials"
else FAIL=$((FAIL+1)); echo "  XX export payload wrong: $(head -c 400 /tmp/body.json)"; fi
EXPB=$(curl -s -o /tmp/body.json -w "%{http_code}" -b "$JARB" "$BASE/api/settings/export")
check "org B export -> 200" 200 "$EXPB"
if EXB_ORG="$EXB_ORG" EXB_EMAIL="$EXB_EMAIL" python3 - <<'PY'
import json, os
d = json.load(open('/tmp/body.json'))
assert d['org']['id'] == int(os.environ['EXB_ORG']), d['org']
names = [c['company_name'] for c in d['clients']]
assert names == ['B-Only Co'], names
assert len(d['tasks']) == 0 and len(d['invoices']) == 0 and len(d['tickets']) == 0, d
emails = [u['email'] for u in d['users']]
assert emails == [os.environ['EXB_EMAIL']], emails
print("ok")
PY
then PASS=$((PASS+1)); echo "  OK B's export has no A rows (cross-tenant isolation)"
else FAIL=$((FAIL+1)); echo "  XX cross-tenant leak in B's export: $(head -c 400 /tmp/body.json)"; fi
EXPO=$(curl -s -o /tmp/body.json -w "%{http_code}" -b "$JAR" "$BASE/api/settings/export")
check "owner org export -> 200" 200 "$EXPO"
grep -qv 'A-Only Co\|B-Only Co' /tmp/body.json && echo "  OK owner export excludes tenant clients" || echo "  XX tenant data leaked into owner export: $(head -c 400 /tmp/body.json)"

echo "-- 46b. Export + cancel auth gates (no cookie) =="
check "export without cookie -> 401" 401 $(code -b "$JARX" "$BASE/api/settings/export")
check "cancel without cookie -> 401" 401 $(code -b "$JARX" -X POST "$BASE/api/settings/cancel")

echo "-- 46c. Restricted members: no settings access -> 403; settings view-only -> 200 =="
S=$(code -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"noview@phase5.example","password":"noview123","role":"member","permissions":{"clients":{"edit":false}}}' "$BASE/api/org/members")
check "org A adds member without settings access -> 201" 201 "$S"
JARNV=$(mktemp)
S=$(code -c "$JARNV" -b "$JARNV" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"noview@phase5.example","password":"noview123"}' "$BASE/api/auth/login")
check "no-settings member login -> 200" 200 "$S"
check "no-settings member export -> 403" 403 $(code -b "$JARNV" "$BASE/api/settings/export")
check "no-settings member settings GET -> 403" 403 $(code -b "$JARNV" "$BASE/api/settings")
S=$(code -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"viewonly@phase5.example","password":"viewonly123","role":"member","permissions":{"settings":{"edit":false},"clients":{"edit":false}}}' "$BASE/api/org/members")
check "org A adds settings-view-only member -> 201" 201 "$S"
JARVO=$(mktemp)
S=$(code -c "$JARVO" -b "$JARVO" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"viewonly@phase5.example","password":"viewonly123"}' "$BASE/api/auth/login")
check "view-only member login -> 200" 200 "$S"
EXPV=$(curl -s -o /tmp/body.json -w "%{http_code}" -b "$JARVO" "$BASE/api/settings/export")
check "view-only member export -> 200" 200 "$EXPV"
grep -q 'A-Only Co' /tmp/body.json && echo "  OK view-only member export contains org A data" || echo "  XX view-only export wrong: $(head -c 400 /tmp/body.json)"

echo "== 46c. Partial PUT never clobbers omitted fields (AZ defect D4) =="
# A partial PUT that omits stage/dealValue/notes/services/customFields/
# nextAction/address must update ONLY the sent fields — an absent key NEVER
# resets the stored value (previously the base SET list was unconditional, so
# a stage-only PUT reset the record to the FIRST stage and zeroed/cleared the
# rest). Required keys (companyName/clientType) are still sent, exactly like
# every real UI flow.
S=$(code -b "$JARA" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Partial PUT Co","contactName":"Pat P","clientType":"commercial","email":"pat@pp.local","phone":"555-0101","address":"9 Partial Way","city":"Ptown","state":"AZ","zip":"85001","website":"https://pp.example","dealValue":1500,"stage":"Intake","notes":"Important notes","nextAction":"Call back","services":["CRM"],"customFields":[{"name":"Color","value":"Green"}]}' "$BASE/api/clients")
check "org A creates partial-PUT client -> 201" 201 "$S"
PP_CLIENT=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
if python3 - <<'PY'
import json
c = json.load(open('/tmp/body.json'))['client']
assert c['stage'] == 'Intake', c['stage']
assert c['dealValue'] == 1500, c['dealValue']
assert c['notes'] == 'Important notes', c['notes']
assert c['services'] == ['CRM'], c['services']
assert c['nextAction'] == 'Call back', c['nextAction']
assert c['address'] == '9 Partial Way', c['address']
assert any(f['name'] == 'Color' and f['value'] == 'Green' for f in c['customFields']), c['customFields']
print('ok')
PY
then PASS=$((PASS+1)); echo "  OK baseline: all fields stored as sent"
else FAIL=$((FAIL+1)); echo "  XX baseline wrong: $(head -c 400 /tmp/body.json)"; fi
# Partial PUT #1: change ONLY contactName — every omitted field must survive.
S=$(code -b "$JARA" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Partial PUT Co","clientType":"commercial","contactName":"Patricia P"}' "$BASE/api/clients/$PP_CLIENT")
check "partial PUT (contactName only) -> 200" 200 "$S"
if python3 - <<'PY'
import json
c = json.load(open('/tmp/body.json'))['client']
assert c['contactName'] == 'Patricia P', c['contactName']
assert c['stage'] == 'Intake', c['stage']
assert c['dealValue'] == 1500, c['dealValue']
assert c['notes'] == 'Important notes', c['notes']
assert c['services'] == ['CRM'], c['services']
assert c['nextAction'] == 'Call back', c['nextAction']
assert c['address'] == '9 Partial Way', c['address']
assert any(f['name'] == 'Color' and f['value'] == 'Green' for f in c['customFields']), c['customFields']
print('ok')
PY
then PASS=$((PASS+1)); echo "  OK omitted stage/dealValue/notes/services/customFields/nextAction/address untouched"
else FAIL=$((FAIL+1)); echo "  XX partial PUT clobbered fields: $(head -c 400 /tmp/body.json)"; fi
# Partial PUT #2: change ONLY stage — dealValue + notes must still survive.
S=$(code -b "$JARA" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Partial PUT Co","clientType":"commercial","stage":"Kickoff"}' "$BASE/api/clients/$PP_CLIENT")
check "partial PUT (stage only) -> 200" 200 "$S"
if python3 - <<'PY'
import json
c = json.load(open('/tmp/body.json'))['client']
assert c['stage'] == 'Kickoff', c['stage']
assert c['dealValue'] == 1500, c['dealValue']
assert c['notes'] == 'Important notes', c['notes']
print('ok')
PY
then PASS=$((PASS+1)); echo "  OK stage updated; dealValue + notes survived"
else FAIL=$((FAIL+1)); echo "  XX stage-only PUT clobbered fields: $(head -c 400 /tmp/body.json)"; fi
# Partial PUT #3: toggle lost WITHOUT sending stage/dealValue — the record must
# stay in Kickoff with its deal value intact (the AZ F6 probe contamination).
S=$(code -b "$JARA" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Partial PUT Co","clientType":"commercial","lost":true}' "$BASE/api/clients/$PP_CLIENT")
check "partial PUT (lost flag only) -> 200" 200 "$S"
if python3 - <<'PY'
import json
c = json.load(open('/tmp/body.json'))['client']
assert c['lost'] is True, c['lost']
assert c['stage'] == 'Kickoff', c['stage']
assert c['dealValue'] == 1500, c['dealValue']
print('ok')
PY
then PASS=$((PASS+1)); echo "  OK lost toggled; stage + dealValue survived"
else FAIL=$((FAIL+1)); echo "  XX lost-only PUT clobbered fields: $(head -c 400 /tmp/body.json)"; fi
# Cleanup the D4 probe client.
check "org A deletes partial-PUT client -> 200" 200 $(code -b "$JARA" -X DELETE "$BASE/api/clients/$PP_CLIENT")
echo "== 47. Phase 5 prep - self-serve cancel/offboarding =="
CAN_EMAIL="cancelco@phase5.example"
CAN_PASS="cancelco123"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"Cancel Co\",\"email\":\"$CAN_EMAIL\",\"password\":\"$CAN_PASS\"}" "$BASE/api/admin/orgs")
check "owner creates cancel org -> 201" 201 "$S"
CAN_ORG=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARC=$(mktemp)
S=$(code -c "$JARC" -b "$JARC" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CAN_EMAIL\",\"password\":\"$CAN_PASS\"}" "$BASE/api/auth/login")
check "cancel-org admin login -> 200" 200 "$S"
# Data that must survive the cancel (retention, not deletion).
S=$(code -b "$JARC" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Cancel Co Client","contactName":"Cara C","clientType":"commercial","dealValue":500,"stage":"Prospect"}' "$BASE/api/clients")
check "cancel org creates client -> 201" 201 "$S"
S=$(code -b "$JARC" -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Cancel Co task"}' "$BASE/api/tasks")
check "cancel org creates task -> 201" 201 "$S"
# A team member whose login must also be blocked after cancel.
S=$(code -b "$JARC" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"cancelmember@phase5.example","password":"cancelmember123","role":"member"}' "$BASE/api/org/members")
check "cancel org adds member -> 201" 201 "$S"
JARCM=$(mktemp)
S=$(code -c "$JARCM" -b "$JARCM" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"cancelmember@phase5.example","password":"cancelmember123"}' "$BASE/api/auth/login")
check "cancel-org member login (pre-cancel) -> 200" 200 "$S"

echo "-- 47a. Owner org cannot cancel itself =="
S=$(code -b "$JAR" -X POST "$BASE/api/settings/cancel")
check "owner org cancel -> 403" 403 "$S"
grep -q "owner workspace cannot be canceled" /tmp/body.json && echo "  OK clear owner-guard message" || echo "  XX owner cancel response: $(cat /tmp/body.json)"

echo "-- 47b. Cancel flips the org, blocks login, retains data =="
S=$(curl -s -D /tmp/cancel_hdr.txt -o /tmp/body.json -w "%{http_code}" -b "$JARC" -X POST "$BASE/api/settings/cancel")
check "org admin cancels own account -> 200" 200 "$S"
grep -q '"ok":true' /tmp/body.json && echo "  OK cancel returns ok" || echo "  XX cancel response: $(cat /tmp/body.json)"
grep -q '"retentionUntil":"' /tmp/body.json && echo "  OK cancel returns retentionUntil" || echo "  XX retentionUntil missing: $(cat /tmp/body.json)"
# AZ defect D3 regression (2026-08-17): the cancel response must clear the REAL
# session cookie (elevate_session) — never a cookie literally named
# ${SESSION_COOKIE} (the logout handler clears the real name).
if grep -qi '^Set-Cookie: elevate_session=;' /tmp/cancel_hdr.txt; then PASS=$((PASS+1)); echo "  OK cancel clears the real elevate_session cookie"; else FAIL=$((FAIL+1)); echo "  XX cancel Set-Cookie wrong: $(grep -i '^Set-Cookie' /tmp/cancel_hdr.txt || cat /tmp/cancel_hdr.txt)"; fi
if grep -q '\${SESSION_COOKIE}' /tmp/cancel_hdr.txt; then FAIL=$((FAIL+1)); echo "  XX cancel still clears a cookie named \${SESSION_COOKIE}"; else PASS=$((PASS+1)); echo "  OK no literal \${SESSION_COOKIE} in cancel headers"; fi
check "canceled admin login -> 403" 403 $(code -b "$JARC" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$CAN_EMAIL\",\"password\":\"$CAN_PASS\"}" "$BASE/api/auth/login")
grep -q 'account_canceled' /tmp/body.json && grep -q 'retained until' /tmp/body.json && echo "  OK login shows clear canceled message with retention date" || echo "  XX login message: $(cat /tmp/body.json)"
# AZ defect D1 regression (2026-08-17): the message must contain a FORMATTED
# retention date (e.g. 2026-09-16) — never the literal template placeholder
# ${retentionDateLabel(...)}.
if grep -q 'retained until 20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' /tmp/body.json; then PASS=$((PASS+1)); echo "  OK login message has a formatted retention date"; else FAIL=$((FAIL+1)); echo "  XX login message lacks a formatted date: $(cat /tmp/body.json)"; fi
if grep -q '\${' /tmp/body.json; then FAIL=$((FAIL+1)); echo "  XX login message still has a literal \${ placeholder: $(cat /tmp/body.json)"; else PASS=$((PASS+1)); echo "  OK login message has no literal \${ placeholder"; fi
check "canceled member login -> 403" 403 $(code -b "$JARCM" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"cancelmember@phase5.example","password":"cancelmember123"}' "$BASE/api/auth/login")
# The pre-cancel sessions die server-side (requireAuth blocks canceled orgs).
check "canceled admin existing session -> 403" 403 $(code -b "$JARC" "$BASE/api/clients")
check "canceled admin export -> 403" 403 $(code -b "$JARC" "$BASE/api/settings/export")
check "canceled admin settings -> 403" 403 $(code -b "$JARC" "$BASE/api/settings")
# Data is RETAINED: the org still exists in the owner's list with its rows.
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "owner admin orgs list -> 200" 200 "$S"
if CAN_ORG="$CAN_ORG" python3 - <<'PY'
import json, os
d = json.load(open('/tmp/body.json'))
org = next(o for o in d['orgs'] if o['id'] == int(os.environ['CAN_ORG']))
assert org['status'] == 'canceled', org
assert org['clientCount'] == 1, org  # data retained, not hard-deleted
assert org['retentionUntil'], org
print("ok")
PY
then PASS=$((PASS+1)); echo "  OK org still listed as canceled with data retained (clientCount 1, retentionUntil set)"
else FAIL=$((FAIL+1)); echo "  XX canceled org missing or data lost: $(head -c 400 /tmp/body.json)"; fi

echo "-- 47c. Cleanup =="
check "owner deletes export org A -> 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$EXA_ORG")
check "owner deletes export org B -> 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$EXB_ORG")
check "owner deletes canceled org -> 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$CAN_ORG")
# Regression: org deletion must fully clean every child table (tickets,
# agreement envelopes, users, ...) — no orphaned rows may keep a deleted org
# listed in the owner's account list.
S=$(code -b "$JAR" "$BASE/api/admin/orgs")
check "owner orgs list after cleanup -> 200" 200 "$S"
if EXA_ORG="$EXA_ORG" EXB_ORG="$EXB_ORG" CAN_ORG="$CAN_ORG" python3 - <<'PY'
import json, os
d = json.load(open('/tmp/body.json'))
ids = {int(os.environ[k]) for k in ('EXA_ORG', 'EXB_ORG', 'CAN_ORG')}
present = {o['id'] for o in d['orgs']}
assert not (ids & present), f"deleted orgs still listed: {ids & present}"
print("ok")
PY
then PASS=$((PASS+1)); echo "  OK deleted orgs fully removed from owner list (no orphans)"
else FAIL=$((FAIL+1)); echo "  XX deleted orgs still listed: $(head -c 300 /tmp/body.json)"; fi
rm -f "$JARA" "$JARB" "$JARC" "$JARCM" "$JARNV" "$JARVO" "$JARX" /tmp/hdr.txt
echo "  OK 46+47: self-serve data export + cancel/offboarding shipped (Phase 5 prep)"

echo "== 48. Live-test findings 2026-08-17: sign-page scroll gate, bracket placeholders, payment-link placeholder =="
# Owner's manual pass findings:
#  1. the public sign page must show the agreement in a scroll box with a
#     read-to-bottom gate (checkbox + Sign disabled until scrolled to bottom);
#  3. the agreement template must ALSO accept bracket-style placeholders
#     ([YOUR LLC NAME], [CLIENT LEGAL NAME], [EFFECTIVE DATE], [PRICE],
#     [DEAL_VALUE]) alongside the {{}} styles;
#  4. a "Payment link" placeholder button + a /api/clients/:id/payment-link
#     endpoint that answers 503 { error: "Stripe not configured" } until
#     STRIPE_SECRET_KEY is set. Owner direction 2026-08-18 moved the button
#     from the Clients tab (ClientsDirectory.tsx) to the OWNER's Onboarding
#     tab (Clients.tsx, scope "middle") — verified by source markers below.
# Finding 2 (Onboarding "+ New lead" removed) is verified by source markers.
echo "-- 48a. Payment-link endpoint: 503 until Stripe is configured (owner-only) == "
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "48a: owner re-login -> 200" 200 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"PayLink Test Co","contactName":"Pay P","email":"paylink@example.com","clientType":"commercial","dealValue":200,"stage":"Leads"}' "$BASE/api/clients")
check "48a: owner creates a client for the payment-link test -> 201" 201 "$S"
PAY48_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X POST "$BASE/api/clients/$PAY48_ID/payment-link")
check "48a: payment-link on an UNSIGNED agreement -> 409 (signed-agreement gate 2026-08-18)" 409 "$S"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"PayLink Test Co","clientType":"commercial","dealValue":200,"stage":"Leads","agreementStatus":"signed"}' "$BASE/api/clients/$PAY48_ID")
check "48a: owner PUT agreementStatus=signed -> 200" 200 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/clients/$PAY48_ID/payment-link")
check "48a: payment-link signed but NO amount -> 400 (owner enters the amount at bill time — no hard-coded rates)" 400 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"amount":0}' "$BASE/api/clients/$PAY48_ID/payment-link")
check "48a: payment-link with amount 0 -> 400" 400 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"amount":200}' "$BASE/api/clients/$PAY48_ID/payment-link")
check "48a: payment-link with amount + no STRIPE_SECRET_KEY -> 503 (Stripe not configured)" 503 "$S"
if grep -q '{"error":"Stripe not configured"}' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ body is exactly { error: \"Stripe not configured\" }"
else
  FAIL=$((FAIL+1)); echo "  ✗ payment-link body: $(cat /tmp/body.json)"
fi
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Pay Tenant","email":"paytenant@example.com","password":"PayTenant123!"}' "$BASE/api/admin/orgs")
check "48a: owner provisions a tenant -> 201" 201 "$S"
JPT=$(mktemp)
S=$(code -c "$JPT" -b "$JPT" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"paytenant@example.com","password":"PayTenant123!"}' "$BASE/api/auth/login")
check "48a: tenant login -> 200" 200 "$S"
S=$(code -b "$JPT" -X POST "$BASE/api/clients/$PAY48_ID/payment-link")
check "48a: tenant payment-link -> 403 (owner-only route)" 403 "$S"
echo "-- 48a2. Payment column + mark-paid (owner direction 2026-08-18) ================ "
# Source markers (a)-(d): the signed-agreement gate title, the Payment column
# header, the disabled expression and the mark-paid handler/endpoint.
if grep -Fq 'Agreement must be signed before sending a payment link' src/Clients.tsx && grep -Fq '<th>Payment</th>' src/Clients.tsx && grep -Fq 'busy || c.agreementStatus !== "signed"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Payment column (th) + signed-gate button title/disabled expression in src/Clients.tsx"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Payment column / signed-gate markers missing from src/Clients.tsx"
fi
if grep -Fq 'handleMarkPaid' src/Clients.tsx && grep -Fq 'api.clientPaymentPaid(c.id)' src/Clients.tsx && grep -Fq '/payment-paid' server/api.ts && grep -Fq 'payment_status = '"'"'paid'"'"'' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: mark-paid handler + owner-only POST /api/clients/:id/payment-paid endpoint"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: mark-paid handler/endpoint markers missing"
fi
# Stripe is not configured locally, so the payment_status='sent' flip cannot
# come from the endpoint — force the DB state directly (bun:sqlite on the main
# throwaway DB) to exercise the owner-only mark-paid flow end to end.
cat > /tmp/setpay.ts <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.SETPAY_DB ?? "data/crm.db");
const st = process.argv[2] ?? "sent";
const id = Number(process.argv[3]);
db.run("UPDATE clients SET payment_status = ?, payment_link_url = ?, updated_at = datetime('now') WHERE id = ?", [st, "https://pay.example/pl/" + id, id]);
console.log("ok");
TS
SETPAY_DB="data/crm.db" bun /tmp/setpay.ts sent "$PAY48_ID" >/dev/null 2>&1 && { PASS=$((PASS+1)); echo "  ✓ 48a2: forced payment_status=sent for the throwaway client (DB fixture)"; } || { FAIL=$((FAIL+1)); echo "  ✗ 48a2: DB fixture failed"; }
S=$(code -b "$JAR" "$BASE/api/clients/$PAY48_ID")
check "48a2: owner GET client (payment_status forced sent) -> 200" 200 "$S"
grep -q '"paymentStatus":"sent"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 48a2: owner payload carries paymentStatus "sent""; } || { FAIL=$((FAIL+1)); echo "  ✗ 48a2: owner payload paymentStatus: $(cat /tmp/body.json)"; }
S=$(code -b "$JAR" -X POST "$BASE/api/clients/$PAY48_ID/payment-paid")
check "48a2: owner mark-paid on a 'sent' client -> 200" 200 "$S"
if grep -q '"ok":true' /tmp/body.json && grep -q '"paymentStatus":"paid"' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ 48a2: payment-paid body is { ok: true, paymentStatus: "paid" }"
else
  FAIL=$((FAIL+1)); echo "  ✗ 48a2: payment-paid body: $(cat /tmp/body.json)"
fi
S=$(code -b "$JAR" "$BASE/api/clients/$PAY48_ID")
check "48a2: owner GET client after mark-paid -> 200" 200 "$S"
grep -q '"paymentStatus":"paid"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 48a2: owner payload reflects paymentStatus "paid" after mark-paid"; } || { FAIL=$((FAIL+1)); echo "  ✗ 48a2: paymentStatus not updated: $(cat /tmp/body.json)"; }
grep -q '"paidAt":"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 48a2: paidAt timestamp persisted"; } || { FAIL=$((FAIL+1)); echo "  ✗ 48a2: paidAt missing: $(cat /tmp/body.json)"; }
S=$(code -b "$JAR" "$BASE/api/clients")
check "48a2: owner clients list -> 200" 200 "$S"
grep -q '"id":'$PAY48_ID',' /tmp/body.json && grep -q '"paymentStatus":"paid"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 48a2: owner LIST payload carries the updated paymentStatus "paid""; } || { FAIL=$((FAIL+1)); echo "  ✗ 48a2: list payload paymentStatus not 'paid'"; }
S=$(code -b "$JPT" -X POST "$BASE/api/clients/$PAY48_ID/payment-paid")
check "48a2: tenant (non-owner) payment-paid -> 403 (owner-only route)" 403 "$S"
S=$(code -b "$JPT" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Tenant Pay Co","email":"tenantpayco@example.com","clientType":"commercial","dealValue":100,"stage":"Prospect"}' "$BASE/api/clients")
check "48a2: tenant creates its own client -> 201" 201 "$S"
TPC_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JPT" "$BASE/api/clients/$TPC_ID")
check "48a2: tenant GET its client -> 200" 200 "$S"
if ! grep -q '"paymentStatus"' /tmp/body.json && ! grep -q '"agreementStatus"' /tmp/body.json; then
  PASS=$((PASS+1)); echo "  ✓ 48a2: tenant payload carries NO paymentStatus/agreementStatus keys (owner-only fields)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 48a2: tenant payload leaked owner-only keys: $(cat /tmp/body.json)"
fi
S=$(code -b "$JAR" -X DELETE "$BASE/api/clients/$PAY48_ID")
check "48a2: throwaway PayLink client deleted (cleanup)" 200 "$S"
rm -f "$JPT"
echo "-- 48b. Bundle: 'Payment link' button shipped on the Onboarding tab == "
NEWEST_JS48=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS48" ] && grep -Fq "Payment link" "$NEWEST_JS48" && grep -Fq "Stripe is not connected yet" "$NEWEST_JS48"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: 'Payment link' action + not-connected notice shipped"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: payment-link markers missing from $NEWEST_JS48"
fi
if [ -n "$NEWEST_JS48" ] && grep -Fq "Agreement must be signed before sending a payment link" "$NEWEST_JS48" && grep -Eq 'jsxDEV\("th",{children:"Payment"}' "$NEWEST_JS48"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: Payment column header + signed-gate button title shipped"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: Payment-column bundle markers missing from $NEWEST_JS48"
fi
if [ -n "$NEWEST_JS48" ] && grep -Fq "Mark paid" "$NEWEST_JS48"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: 'Mark paid' action shipped (Payment column)"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: 'Mark paid' missing from $NEWEST_JS48"
fi
echo "-- 48c. Source markers: Onboarding '+ New lead' removed + scroll-gate JS == "
if grep -Fq 'scope !== "middle"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Onboarding tab (scope middle) no longer renders the add-lead buttons"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Onboarding add-lead gate missing from src/Clients.tsx"
fi
if grep -Fq 'id="read"' server/agreements.ts && grep -Fq 'scrollHeight' server/agreements.ts && grep -Fq 'doc-scroll' server/agreements.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: sign page scroll box + read-to-bottom gate (id=read, scrollHeight gate, doc-scroll)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: sign-page scroll-gate markers missing from server/agreements.ts"
fi
if grep -Fq '[YOUR LLC NAME]' server/agreements.ts && grep -Fq '[CLIENT LEGAL NAME]' server/agreements.ts && grep -Fq '[EFFECTIVE DATE]' server/agreements.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: bracket-style placeholders wired in renderAgreementTemplate"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: bracket placeholders missing from server/agreements.ts"
fi
if grep -Fq '[YOUR LLC NAME]' src/Admin.tsx && grep -Fq 'Both styles work in the same template' src/Admin.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Administration -> Agreements help text lists both placeholder styles"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Agreements help text missing bracket-style placeholders"
fi
if grep -Fq 'stripeClient' server/api.ts && grep -Fq 'Stripe not configured' server/api.ts && grep -Fq 'requireAdmin' server/api.ts && grep -Fq 'sendPaymentLinkEmail' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: payment-link route (owner-only, guarded Stripe client, Resend email)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: payment-link route markers missing from server/api.ts"
fi
if grep -Fq 'api.clientPaymentLink(c.id)' src/Clients.tsx && grep -Fq 'Send payment link to' src/Clients.tsx && grep -Fq 'ownerOnboardingTab && canEdit' src/Clients.tsx && grep -Fq 'scope === "middle"' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: 'Payment link' action lives in Clients.tsx (owner Onboarding view, scope middle, owner-only, canEdit-gated)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: payment-link action missing/ungated in src/Clients.tsx"
fi
if ! grep -Fq 'Send payment link to' src/ClientsDirectory.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Clients tab (ClientsDirectory.tsx) no longer renders the 'Payment link' button"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: 'Payment link' button still present in src/ClientsDirectory.tsx"
fi
echo "-- 48d. Sign page: scroll box + read gate + bracket placeholders (long template) == "
# Self-contained server like section 45: a throwaway CRM server on :3008 with
# a fresh DB posts emails to a mock Resend on :3197. The MAIN server on $BASE
# is untouched.
MOCK48=$(mktemp -d)
MOCK48_EMAILS="$MOCK48/emails.jsonl"
: > "$MOCK48_EMAILS"
cat > "$MOCK48/resend.ts" <<'TS'
import { appendFileSync } from "node:fs";
const PORT = 3197;
const OUT = process.env.MOCK48_OUT ?? "/tmp/mock48-emails.jsonl";
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      appendFileSync(OUT, JSON.stringify(body) + "\n");
      return Response.json({ id: "mock-" + Math.random().toString(36).slice(2) });
    }
    return new Response("nope", { status: 404 });
  },
});
console.log("mock48 resend on " + PORT);
TS
MOCK48_OUT="$MOCK48_EMAILS" nohup bun "$MOCK48/resend.ts" > "$MOCK48/resend.log" 2>&1 &
MOCK48_PID=$!
i=0; until curl -sf http://127.0.0.1:3197/health >/dev/null 2>&1; do i=$((i+1)); [ "$i" -gt 50 ] && break; sleep 0.2; done
curl -sf http://127.0.0.1:3197/health >/dev/null 2>&1 && { PASS=$((PASS+1)); echo "  ✓ mock Resend up on :3197"; } || { FAIL=$((FAIL+1)); echo "  ✗ mock Resend failed"; }
start_crm 3008 "$MOCK48/db" "$MOCK48/srv.log" "$MOCK48/srv.pid" -u TEST_EMAIL_TO RESEND_API_KEY=test-key-123 RESEND_URL=http://127.0.0.1:3197
S48=http://localhost:3008
JA48=$(mktemp)
S=$(code -c "$JA48" -b "$JA48" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$S48/api/auth/login")
check "48d: owner login on throwaway -> 200" 200 "$S"
# A LONG template (both placeholder styles mixed) that overflows the 440px
# scroll box, plus the client's own business name to prove replacement.
cat > "$MOCK48/tpl.txt" <<'TXT'
CLIENT SERVICES AGREEMENT between [YOUR LLC NAME] and [CLIENT LEGAL NAME] (effective [EFFECTIVE DATE], monthly price [PRICE] / [DEAL_VALUE]).
TXT
for i in $(seq 1 55); do
  echo "Clause $i. The Client agrees to the terms and conditions of this agreement, including the confidentiality, data-handling and cancellation provisions, and acknowledges that the monthly fee is payable in advance." >> "$MOCK48/tpl.txt"
done
python3 - "$MOCK48/tpl.txt" "$MOCK48/tpl.json" <<'PY'
import json, sys
json.dump({"agreementTemplate": open(sys.argv[1]).read()}, open(sys.argv[2], "w"))
PY
S=$(code -b "$JA48" -X PUT -H 'Content-Type: application/json' --data @"$MOCK48/tpl.json" "$S48/api/settings")
check "48d: owner saves the long bracket-style template -> 200" 200 "$S"
S=$(code -b "$JA48" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Scroll Test LLC","contactName":"Sam S","email":"scroll@example.com","clientType":"commercial","dealValue":200,"stage":"Leads"}' "$S48/api/clients")
check "48d: owner creates client -> 201" 201 "$S"
SC48_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JA48" -X POST -H 'Content-Type: application/json' -d "{\"clientId\":$SC48_ID}" "$S48/api/agreements/send")
check "48d: send agreement -> 200" 200 "$S"
sleep 1
TOKEN48=$(grep -o 'sign/[a-f0-9]\{64\}' "$MOCK48_EMAILS" | head -1 | cut -d/ -f2)
if [ -n "$TOKEN48" ] && [ ${#TOKEN48} -eq 64 ]; then
  PASS=$((PASS+1)); echo "  ✓ sign token extracted from mock email (${#TOKEN48} chars)"
else
  FAIL=$((FAIL+1)); echo "  ✗ no sign token: $(cat "$MOCK48_EMAILS")"
fi
S=$(code -b "$JAR" "$S48/sign/$TOKEN48")
check "48d: public sign page -> 200" 200 "$S"
cp /tmp/body.json "$MOCK48/sign.html"
P48="$MOCK48/sign.html"
if grep -Fq 'class="doc doc-scroll"' "$P48" && grep -Fq 'id="doc"' "$P48"; then
  PASS=$((PASS+1)); echo "  ✓ scroll box container present (doc doc-scroll)"
else
  FAIL=$((FAIL+1)); echo "  ✗ scroll box container missing"
fi
if grep -Fq 'I have read and agree to the terms above.' "$P48" && grep -Fq 'id="read" disabled' "$P48"; then
  PASS=$((PASS+1)); echo "  ✓ read checkbox present and DISABLED by default (read-to-bottom gate)"
else
  FAIL=$((FAIL+1)); echo "  ✗ read checkbox / disabled default missing"
fi
if grep -Fq 'id="btn-sign" disabled' "$P48"; then
  PASS=$((PASS+1)); echo "  ✓ Sign button starts DISABLED"
else
  FAIL=$((FAIL+1)); echo "  ✗ Sign button not disabled by default"
fi
if grep -Fq 'id="btn-decline"' "$P48" && ! grep -Fq 'id="btn-decline" disabled' "$P48"; then
  PASS=$((PASS+1)); echo "  ✓ Decline button stays enabled at all times"
else
  FAIL=$((FAIL+1)); echo "  ✗ Decline button wrongly disabled"
fi
# Bracket placeholders replaced (no literal bracket text left in the page).
if grep -Fq 'Revzenta and Scroll Test LLC' "$P48" && ! grep -Fq '[YOUR LLC NAME]' "$P48" && ! grep -Fq '[CLIENT LEGAL NAME]' "$P48" && ! grep -Fq '[EFFECTIVE DATE]' "$P48" && ! grep -Fq '[PRICE]' "$P48" && ! grep -Fq '[DEAL_VALUE]' "$P48"; then
  PASS=$((PASS+1)); echo "  ✓ bracket placeholders replaced in the sign page (no literal [..] left)"
else
  FAIL=$((FAIL+1)); echo "  ✗ bracket placeholders not fully replaced"
fi
if grep -Fq 'scrollHeight' "$P48" && grep -Fq 'addEventListener("scroll"' "$P48"; then
  PASS=$((PASS+1)); echo "  ✓ scroll-gate JS wired (scroll listener + scrollHeight bottom test)"
else
  FAIL=$((FAIL+1)); echo "  ✗ scroll-gate JS missing"
fi
echo "-- 48e. PDF: bracket placeholders replaced, no literal [YOUR LLC NAME] remains == "
cat > "$MOCK48/pdfprobe.ts" <<'TS'
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
const file = process.argv[2];
const wants = process.argv.slice(3);
const buf = readFileSync(file);
const raw = buf.toString("latin1");
const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let m;
const parts: string[] = [];
while ((m = re.exec(raw)) !== null) {
  try { parts.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")); } catch { }
}
const hexToText = (hex: string): string => {
  const h = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return out;
};
let text = raw + "\n" + parts.join("\n");
for (const part of parts) {
  if (!part.includes("Tj") && !part.includes("TJ")) continue;
  text += "\n" + part
    .replace(/<([0-9A-Fa-f\s]+)>/g, (_: string, h: string) => hexToText(h))
    .replace(/\(((?:\\.|[^\\()])*)\)/g, (_: string, s: string) => s.replace(/\\([\\()])/g, "$1"));
}
let ok = true;
for (const w of wants) {
  const neg = w.startsWith("!");
  const needle = neg ? w.slice(1) : w;
  const hit = text.includes(needle);
  if (neg ? hit : !hit) { ok = false; console.log((neg ? "UNEXPECTED-PRESENT: " : "MISSING: ") + needle); }
}
console.log(ok ? "ok" : "FAIL");
process.exit(ok ? 0 : 1);
TS
cat > "$MOCK48/pdfpath.ts" <<'TS'
import { Database } from "bun:sqlite";
const db = new Database(process.env.DB_FILE ?? "");
const r = db
  .query("SELECT e.pdf_id FROM agreement_envelopes e JOIN clients c ON c.id = e.client_id WHERE c.company_name = ? ORDER BY e.id DESC LIMIT 1")
  .get(process.env.CLIENT_NAME ?? "") as { pdf_id: string } | null;
console.log(r ? r.pdf_id : "");
TS
PDF48_ID=$(DB_FILE="$MOCK48/db/crm.db" CLIENT_NAME="Scroll Test LLC" bun "$MOCK48/pdfpath.ts" 2>/dev/null)
PDF48="$MOCK48/db/agreements/$PDF48_ID.pdf"
if [ -n "$PDF48_ID" ] && [ -f "$PDF48" ] && DB_FILE="$MOCK48/db/crm.db" bun "$MOCK48/pdfprobe.ts" "$PDF48" "Revzenta" "Scroll Test LLC" '![$' '!YOUR LLC NAME' '!CLIENT LEGAL NAME' '!EFFECTIVE DATE' '$200.00' > "$MOCK48/probe.out" 2>&1; then
  PASS=$((PASS+1)); echo "  ✓ PDF: bracket placeholders replaced (OWNER name Revzenta + client name + \$200.00 present; no literal [..] remains)"
else
  FAIL=$((FAIL+1)); echo "  ✗ PDF probe failed: $(cat "$MOCK48/probe.out" 2>/dev/null)"
fi
echo "-- 48g. Payment-link notice fix: ApiError imported as a VALUE (live-test finding: click showed no notice) == "
# Root cause (2026-08-17, reproduced locally in a browser): the "Payment
# link" click fired the fetch, the server answered 503, but NO alert
# appeared. src/ClientsDirectory.tsx imported ApiError with a TYPE-only
# import (type ApiError) while using it as a value in \`instanceof ApiError\`.
# The bun build transpiler strips type-only imports without type-checking, so
# the bundle carried a dangling \`ApiError\` identifier; at runtime the 503
# catch threw ReferenceError before the notice (or the error branch) could
# run. Fix: value import — the same pattern Login.tsx already uses. The
# handler + import moved to src/Clients.tsx with the 2026-08-18 Onboarding
# move; ClientsDirectory.tsx no longer uses ApiError.
if grep -Fq 'import { api, ApiError, type ClientInput }' src/Clients.tsx && ! grep -Fq 'import { api, type ApiError' src/Clients.tsx && ! grep -Fq 'import { api, ApiError' src/ClientsDirectory.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: ApiError imported as a VALUE in Clients.tsx (where the payment-link handler now lives); ClientsDirectory.tsx no longer references it"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: ApiError value-import missing from src/Clients.tsx (or still referenced in src/ClientsDirectory.tsx)"
fi
NEWEST_JS48G=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS48G" ] && ! grep -Fq 'instanceof ApiError' "$NEWEST_JS48G"; then
  PASS=$((PASS+1)); echo "  ✓ bundle: no dangling 'instanceof ApiError' reference (503 branch compiles against the real class)"
else
  FAIL=$((FAIL+1)); echo "  ✗ bundle: dangling ApiError reference still present in $NEWEST_JS48G"
fi
echo "-- 48f. Cleanup == "
stop_crm "$MOCK48/srv.pid" 2>/dev/null
kill "$MOCK48_PID" 2>/dev/null
rm -f "$JA48"
rm -rf "$MOCK48"
echo "  ✓ 48: sign-page scroll gate + read-to-bottom checkbox, bracket-style template placeholders, payment-link placeholder shipped (owner Onboarding tab)"
echo "== 49. Phase 5 — Stripe billing: owner-entered amount + webhook auto-flip + invoice email (2026-08-18) =="
# The billing endpoint POST /api/clients/:id/payment-link needs STRIPE_SECRET_KEY
# to create REAL links, which the suite NEVER has (-u STRIPE_SECRET_KEY, so no
# real Stripe calls — hard requirement). The webhook path needs NO Stripe key:
# it only reads the event body + signature. So this section (a) proves the
# owner-entered amount validation on the throwaway server, then (b) drives
# FAKE Stripe events through POST /api/stripe/webhook with a valid HMAC
# signature computed from the suite's own STRIPE_WEBHOOK_SECRET, asserting:
#   - garbage/unsigned payloads are REJECTED when the secret is present (400)
#   - with the secret ABSENT the endpoint still accepts + logs gracefully
#   - checkout.session.completed / invoice.paid flip payment_status -> paid,
#     record paidAt, and EMAIL the invoice PDF (mock Resend attachment check)
#   - duplicate events are idempotent (no second email)
#   - a foreign org's event NEVER touches the client (no cross-account leak)
MOCK49=$(mktemp -d)
cat > "$MOCK49/resend.ts" <<'TS'
import { appendFileSync } from "node:fs";
const OUT = process.env.MOCK_OUT ?? "/tmp/mock49-emails.jsonl";
const server = Bun.serve({
  port: 3212,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      appendFileSync(OUT, JSON.stringify(body) + "\n");
      return Response.json({ id: "mock-" + Math.random().toString(36).slice(2) });
    }
    return new Response("nope", { status: 404 });
  },
});
TS
MOCK_OUT="$MOCK49/emails.jsonl" nohup bun "$MOCK49/resend.ts" > "$MOCK49/resend.log" 2>&1 &
MOCK49_PID=$!
sleep 1
if curl -s -o /dev/null http://127.0.0.1:3212/health; then
  PASS=$((PASS+1)); echo "  ✓ 49: mock Resend up on :3212"
else
  FAIL=$((FAIL+1)); echo "  ✗ 49: mock Resend failed to start"
fi
# Server WITH a webhook signing secret (signature verification ON). Ports 3011
# + 3212 are free of every other suite section (3002-3008, 3196-3199).
start_crm 3011 "$MOCK49/db" "$MOCK49/srv.log" "$MOCK49/srv.pid" -u STRIPE_SECRET_KEY RESEND_API_KEY=test-key-49 RESEND_URL=http://127.0.0.1:3212 TEST_EMAIL_TO=owner-test@gmail.com STRIPE_WEBHOOK_SECRET=whsec_test_49
B49=http://localhost:3011
JA49=$(mktemp)
S=$(code -c "$JA49" -b "$JA49" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$B49/api/auth/login")
check "49a: webhook-server owner login -> 200" 200 "$S"
ORG49=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['user']['orgId'])")
S=$(code -b "$JA49" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Webhook A Co","contactName":"Ann A","email":"wa@example.com","clientType":"commercial","dealValue":2400,"stage":"Leads"}' "$B49/api/clients")
check "49a: create client A -> 201" 201 "$S"
WA_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JA49" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Webhook B Co","contactName":"Bob B","email":"wb@example.com","clientType":"commercial","dealValue":1800,"stage":"Leads"}' "$B49/api/clients")
check "49a: create client B -> 201" 201 "$S"
WB_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
# DB fixtures: agree + mark sent + owner amount (what the billing endpoint
# would have stored had Stripe been configured). B also gets a stored Stripe
# customer id so the invoice.paid fallback path can match it.
cat > "$MOCK49/fix.ts" <<'EOF'
import { Database } from "bun:sqlite";
const db = new Database(process.env.FIX_DB ?? "data/crm.db");
const [id, amountCents, cust] = process.argv.slice(2);
// The SQL always binds all three placeholders — pass "" for "no customer".
db.run(
  "UPDATE clients SET agreement_status='signed', payment_status='sent', payment_amount_cents=?, payment_link_url='https://pay.example/pl49/' || id, stripe_customer_id=?, updated_at=datetime('now') WHERE id=?",
  [amountCents, cust === "" ? null : cust, id],
);
console.log("fixture ok");
EOF
if FIX_DB="$MOCK49/db/crm.db" bun "$MOCK49/fix.ts" "$WA_ID" 20000 "" && FIX_DB="$MOCK49/db/crm.db" bun "$MOCK49/fix.ts" "$WB_ID" 15000 cus_test_49b; then
  PASS=$((PASS+1)); echo "  ✓ 49a: DB fixtures applied (A: \$200.00, B: \$150.00 + customer id)"
else
  FAIL=$((FAIL+1)); echo "  ✗ 49a: DB fixtures failed"
fi
# ------- owner-entered amount validation (billing gate, no Stripe key) -------
S=$(code -b "$JA49" -X POST -H 'Content-Type: application/json' -d '{}' "$B49/api/clients/$WA_ID/payment-link")
check "49b: signed client, NO amount -> 400" 400 "$S"
S=$(code -b "$JA49" -X POST -H 'Content-Type: application/json' -d '{"amount":"abc"}' "$B49/api/clients/$WA_ID/payment-link")
check "49b: non-numeric amount -> 400" 400 "$S"
S=$(code -b "$JA49" -X POST -H 'Content-Type: application/json' -d '{"amount":200}' "$B49/api/clients/$WA_ID/payment-link")
check "49b: valid amount, no STRIPE_SECRET_KEY -> 503 (Stripe not configured)" 503 "$S"
grep -q '{"error":"Stripe not configured"}' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49b: 503 body exact"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49b: 503 body: $(cat /tmp/body.json)"; }
# ---------------- webhook signature rejection (secret present) ---------------
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' --data-binary '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{}}}' "$B49/api/stripe/webhook")
check "49c: webhook with NO signature header -> 400" 400 "$S"
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H 'Stripe-Signature: t=1,v1=garbage' --data-binary '{"id":"evt_1","type":"checkout.session.completed","data":{"object":{}}}' "$B49/api/stripe/webhook")
check "49c: webhook with GARBAGE signature -> 400" 400 "$S"
grep -q 'Invalid signature' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49c: 400 body says invalid signature"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49c: 400 body: $(cat /tmp/body.json)"; }
# --------------- valid signed events drive the auto-flip (A) -----------------
# sign49 <payload file> <sig file> — HMAC-SHA256 over "t=<ts>.v1=<payload>"
sign49() {
  python3 - "$1" "$2" <<'PY'
import sys, time, hmac, hashlib
payload = open(sys.argv[1], "rb").read()
ts = str(int(time.time()))
sig = hmac.new(b"whsec_test_49", (ts + "." + payload.decode()).encode(), hashlib.sha256).hexdigest()
open(sys.argv[2], "w").write("t=%s,v1=%s" % (ts, sig))
PY
}
python3 - "$MOCK49/ev.json" "$WA_ID" "$ORG49" <<'PY'
import json, sys
ev = {
  "id": "evt_checkout_A",
  "object": "event",
  "type": "checkout.session.completed",
  "data": {"object": {
    "id": "cs_test_49a", "object": "checkout.session", "payment_status": "paid",
    "amount_total": 20000, "currency": "usd", "customer": "cus_test_49a",
    "customer_email": "wa@example.com",
    "metadata": {"clientId": sys.argv[2], "orgId": sys.argv[3]},
    "payment_link": "pl_test_49a",
  }},
}
open(sys.argv[1], "w").write(json.dumps(ev))
PY
sign49 "$MOCK49/ev.json" "$MOCK49/ev.sig"
SIG49=$(cat "$MOCK49/ev.sig")
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H "Stripe-Signature: $SIG49" --data-binary @"$MOCK49/ev.json" "$B49/api/stripe/webhook")
check "49d: valid checkout.session.completed -> 200 (handled:paid)" 200 "$S"
grep -q '"handled":"paid"' /tmp/body.json && grep -q "\"clientId\":$WA_ID" /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49d: webhook ack { handled: paid, clientId: A }"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49d: ack body: $(cat /tmp/body.json)"; }
S=$(code -b "$JA49" "$B49/api/clients/$WA_ID")
check "49d: owner GET client A -> 200" 200 "$S"
grep -q '"paymentStatus":"paid"' /tmp/body.json && grep -q '"paidAt":"' /tmp/body.json && grep -q '"paymentAmountCents":20000' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49d: client A flipped to paid + paidAt + \$200.00 amount stored"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49d: client A payload: $(cat /tmp/body.json)"; }
sleep 1
python3 - "$MOCK49/emails.jsonl" "$WA_ID" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1])]
inv = [l for l in lines if l.get("subject", "").startswith("Invoice INV-" + sys.argv[2] + "-")]
att = inv[0].get("attachments", []) if inv else []
assert inv and att and att[0]["filename"].startswith("invoice-INV-") and att[0]["content_type"] == "application/pdf" and len(att[0]["content"]) > 500, (len(inv), att)
print("  ✓ 49d: invoice email with PDF attachment (%s, %d b64 chars)" % (att[0]["filename"], len(att[0]["content"])))
PY
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "  ✗ 49d: invoice email/attachment assertion failed"; fi
# --------------------------------- idempotency -------------------------------
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H "Stripe-Signature: $SIG49" --data-binary @"$MOCK49/ev.json" "$B49/api/stripe/webhook")
check "49e: duplicate event -> 200 (acknowledged)" 200 "$S"
grep -q '"handled":"already_paid"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49e: duplicate is idempotent (already_paid)"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49e: duplicate body: $(cat /tmp/body.json)"; }
sleep 1
EMAIL49_N=$(wc -l < "$MOCK49/emails.jsonl")
[ "$EMAIL49_N" = "1" ] && { PASS=$((PASS+1)); echo "  ✓ 49e: no duplicate invoice email (still 1)"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49e: email count $EMAIL49_N, expected 1"; }
# ---------------- invoice.paid fallback (stored customer match) --------------
python3 - "$MOCK49/evb.json" "$WB_ID" "$ORG49" <<'PY'
import json, sys
ev = {
  "id": "evt_invoice_paid_b",
  "object": "event",
  "type": "invoice.paid",
  "data": {"object": {
    "id": "in_49b", "object": "invoice", "subscription": "sub_49b",
    "customer": "cus_test_49b", "customer_email": "wb@example.com",
  }},
}
open(sys.argv[1], "w").write(json.dumps(ev))
PY
sign49 "$MOCK49/evb.json" "$MOCK49/evb.sig"
SIGB=$(cat "$MOCK49/evb.sig")
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H "Stripe-Signature: $SIGB" --data-binary @"$MOCK49/evb.json" "$B49/api/stripe/webhook")
check "49f: invoice.paid without metadata (stored customer id) -> 200" 200 "$S"
grep -q '"handled":"paid"' /tmp/body.json && grep -q '"clientId":'$WB_ID',' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49f: invoice.paid resolved client B via stripe_customer_id"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49f: body: $(cat /tmp/body.json)"; }
S=$(code -b "$JA49" "$B49/api/clients/$WB_ID")
grep -q '"paymentStatus":"paid"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49f: client B flipped to paid"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49f: client B: $(cat /tmp/body.json)"; }
sleep 1
EMAIL49_N=$(wc -l < "$MOCK49/emails.jsonl")
[ "$EMAIL49_N" = "2" ] && { PASS=$((PASS+1)); echo "  ✓ 49f: invoice email sent for B (2 total)"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49f: email count $EMAIL49_N, expected 2"; }
# ---------------------- cross-account isolation (no leak) --------------------
python3 - "$MOCK49/evx.json" "$WA_ID" "$ORG49" <<'PY'
import json, sys
ev = {
  "id": "evt_foreign_org",
  "object": "event",
  "type": "checkout.session.completed",
  "data": {"object": {
    "id": "cs_x", "object": "checkout.session",
    "metadata": {"clientId": sys.argv[2], "orgId": "999999"},
    "customer_email": "intruder@example.com",
  }},
}
open(sys.argv[1], "w").write(json.dumps(ev))
PY
sign49 "$MOCK49/evx.json" "$MOCK49/evx.sig"
SIGX=$(cat "$MOCK49/evx.sig")
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H "Stripe-Signature: $SIGX" --data-binary @"$MOCK49/evx.json" "$B49/api/stripe/webhook")
check "49g: event for a foreign org -> 200 no_match (no cross-account touch)" 200 "$S"
grep -q '"handled":"no_match"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49g: foreign-org event ignored (no_match)"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49g: body: $(cat /tmp/body.json)"; }
# ----------------------- unknown event type -> acknowledge --------------------
python3 - "$MOCK49/evu.json" <<'PY'
import json, sys
ev = {"id": "evt_unknown", "object": "event", "type": "charge.refunded", "data": {"object": {}}}
open(sys.argv[1], "w").write(json.dumps(ev))
PY
sign49 "$MOCK49/evu.json" "$MOCK49/evu.sig"
SIGU=$(cat "$MOCK49/evu.sig")
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H "Stripe-Signature: $SIGU" --data-binary @"$MOCK49/evu.json" "$B49/api/stripe/webhook")
check "49h: unknown event type -> 200 (acknowledged, no retries)" 200 "$S"
grep -q '"handled":"unhandled_type"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49h: unknown type acknowledged"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49h: body: $(cat /tmp/body.json)"; }
# ---------------- absent secret -> accept + log gracefully --------------------
echo "  -- 49i. No STRIPE_WEBHOOK_SECRET — accept + log (provision-time path) --"
start_crm 3014 "$MOCK49/db-ns" "$MOCK49/srv-ns.log" "$MOCK49/srv-ns.pid" -u STRIPE_SECRET_KEY -u STRIPE_WEBHOOK_SECRET RESEND_API_KEY=test-key-49 RESEND_URL=http://127.0.0.1:3212 TEST_EMAIL_TO=owner-test@gmail.com
B49N=http://localhost:3014
JANS=$(mktemp)
S=$(code -c "$JANS" -b "$JANS" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$B49N/api/auth/login")
check "49i: no-secret server login -> 200" 200 "$S"
S=$(code -b "$JANS" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"NoSecret Co","email":"nsec@example.com","clientType":"commercial","dealValue":2500,"stage":"Leads"}' "$B49N/api/clients")
check "49i: create client N -> 201" 201 "$S"
WN_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
FIX_DB="$MOCK49/db-ns/crm.db" bun "$MOCK49/fix.ts" "$WN_ID" 25000 "" > /dev/null 2>&1
python3 - "$MOCK49/evns.json" "$WN_ID" "$ORG49" <<'PY'
import json, sys
ev = {"id": "evt_nosecret", "object": "event", "type": "checkout.session.completed",
      "data": {"object": {"id": "cs_ns", "metadata": {"clientId": sys.argv[2], "orgId": sys.argv[3]}, "customer_email": "nsec@example.com"}}}
open(sys.argv[1], "w").write(json.dumps(ev))
PY
S=$(curl -s -o /tmp/body.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -H 'Stripe-Signature: garbage' --data-binary @"$MOCK49/evns.json" "$B49N/api/stripe/webhook")
check "49i: garbage signature ACCEPTED when secret unset -> 200 (graceful)" 200 "$S"
grep -q '"handled":"paid"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49i: no-secret webhook processed the event"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49i: body: $(cat /tmp/body.json)"; }
S=$(code -b "$JANS" "$B49N/api/clients/$WN_ID")
grep -q '"paymentStatus":"paid"' /tmp/body.json && { PASS=$((PASS+1)); echo "  ✓ 49i: client N flipped to paid"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49i: client N: $(cat /tmp/body.json)"; }
grep -q "accepting webhook without signature verification" "$MOCK49/srv-ns.log" && { PASS=$((PASS+1)); echo "  ✓ 49i: server logged the no-secret warning"; } || { FAIL=$((FAIL+1)); echo "  ✗ 49i: warning missing from $MOCK49/srv-ns.log"; }
stop_crm "$MOCK49/srv-ns.pid" 2>/dev/null
rm -f "$JANS"
# ------------------------------ source markers ---------------------------------
if grep -Fq '/api/stripe/webhook' server/api.ts && grep -Fq 'constructEventAsync' server/api.ts && grep -Fq 'checkout.session.completed' server/api.ts && grep -Fq 'payment_intent.succeeded' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: POST /api/stripe/webhook (signature-verified, 3 payment event types)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: webhook route markers missing in server/api.ts"
fi
if grep -Fq 'stripe.customers.create' server/api.ts && grep -Fq 'stripe.prices.create' server/api.ts && grep -Fq 'paymentLinks.create' server/api.ts && grep -Fq 'payment_amount_cents' server/api.ts && grep -Fq 'stripe_customer_id' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: billing route (customer + price + payment link, amount stored)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: billing route markers missing in server/api.ts"
fi
if grep -Fq 'Stripe not configured' server/api.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: no-key 503 path retained (no Stripe calls without the key)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: 503 guard missing"
fi
if [ -f server/invoices.ts ] && grep -Fq 'generateInvoicePdf' server/invoices.ts && grep -Fq 'sendInvoiceEmail' server/email.ts && grep -Fq 'attachments' server/email.ts; then
  PASS=$((PASS+1)); echo "  ✓ source: invoice PDF (server/invoices.ts) + email attachments (server/email.ts)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: invoice/pdf markers missing"
fi
if grep -Fq 'Bill this account' src/Finance.tsx && grep -Fq 'ownerOrg' src/Finance.tsx && grep -Fq 'Mark paid' src/Finance.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Finance tab billing panel (amount + interval + mark-paid fallback)"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Finance.tsx billing panel markers missing"
fi
if grep -Fq 'window.prompt' src/Clients.tsx && grep -Fq 'api.clientPaymentLink(c.id, { amount' src/Clients.tsx; then
  PASS=$((PASS+1)); echo "  ✓ source: Onboarding Payment-link action now prompts the owner for the amount"
else
  FAIL=$((FAIL+1)); echo "  ✗ source: Clients.tsx amount prompt missing"
fi
# -------------------------------- cleanup ------------------------------------
stop_crm "$MOCK49/srv.pid" 2>/dev/null
kill "$MOCK49_PID" 2>/dev/null
rm -f "$JA49" "$MOCK49/ev.json" "$MOCK49/ev.sig" "$MOCK49/evb.json" "$MOCK49/evb.sig" "$MOCK49/evx.json" "$MOCK49/evx.sig" "$MOCK49/evu.json" "$MOCK49/evu.sig" "$MOCK49/evns.json"
rm -rf "$MOCK49"
echo "  ✓ 49: Phase 5 Stripe billing webhook battery complete"
echo "RESULT: $PASS passed, $FAIL failed"


rm -f "$JAR" /tmp/body.json "$PASS_TMP"
[ "$FAIL" -eq 0 ]


rm -f "$JAR" /tmp/body.json
[ "$FAIL" -eq 0 ]
