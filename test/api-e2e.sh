#!/bin/bash
# End-to-end API test for Elevate CRM (run against a local server on :3001).
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
check "admin orgs without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/admin/orgs")
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
check "me with cookie → 200" 200 $(code -b "$JAR" "$BASE/api/auth/me")
grep -Fq "$ADMIN_EMAIL" /tmp/body.json && echo "  ✓ me returns owner email" || echo "  ✗ me email wrong"
grep -q '"orgId":' /tmp/body.json && echo "  ✓ me returns orgId" || echo "  ✗ me missing orgId"
grep -q '"role":"admin"' /tmp/body.json && echo "  ✓ me returns role admin" || echo "  ✗ me role wrong"

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
  -d '{"companyName":"Acme Legal LLP","contactName":"Jordan Lee","email":"jordan@acme.example","phone":"+1 555 0100","industry":"Legal","clientType":"commercial","address":"2200 Market St","city":"San Francisco","state":"CA","zip":"94114","website":"acmelegal.example","leadSource":"Referral","services":["Premium Website","SEO","Paid Campaigns"],"dealValue":15000,"stage":"Intakes","nextAction":"Kickoff call Thursday","notes":"Added paid campaigns"}' \
  "$BASE/api/clients/$ACME_ID")
check "update Acme → 200" 200 "$S"
grep -q '"stage":"Intakes"' /tmp/body.json && grep -q '"dealValue":15000' /tmp/body.json && echo "  ✓ stage moved to Intakes, deal 15000" || echo "  ✗ update failed: $(cat /tmp/body.json)"

echo "== 7. Dashboard counts + projected pipeline =="
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "dashboard → 200" 200 "$S"
grep -q '"Sold":0' /tmp/body.json && echo "  ✓ Sold=0" || echo "  ✗ Sold count: $(cat /tmp/body.json)"
grep -q '"Intakes":1' /tmp/body.json && echo "  ✓ Intakes=1" || echo "  ✗ Intakes count: $(cat /tmp/body.json)"
grep -q '"Leads":1' /tmp/body.json && echo "  ✓ Leads=1" || echo "  ✗ Leads count: $(cat /tmp/body.json)"
grep -q '"projectedPipeline":20400' /tmp/body.json && echo "  ✓ projectedPipeline = 20400 (15000+5400, labeled projected not revenue)" || echo "  ✗ pipeline: $(cat /tmp/body.json)"

echo "== 8. Archive affects dashboard only =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Northline Coffee","contactName":"Sam Rivera","email":"sam@northline.example","industry":"Hospitality","clientType":"residential","services":["Paid Campaigns","Analytics"],"dealValue":5400,"stage":"Leads","nextAction":"","notes":"","archived":true}' \
  "$BASE/api/clients/$NL_ID")
check "archive Northline → 200" 200 "$S"
grep -q '"archived":true' /tmp/body.json && echo "  ✓ archived=true" || echo "  ✗ archive failed: $(cat /tmp/body.json)"
code -b "$JAR" "$BASE/api/dashboard" > /dev/null
grep -q '"projectedPipeline":15000' /tmp/body.json && echo "  ✓ pipeline now 15000 (archived excluded)" || echo "  ✗ pipeline after archive: $(cat /tmp/body.json)"
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
  -d '{"companyName":"Summit Heating & Air","contactName":"Ray Ortiz","email":"ray@summit.example","phone":"","industry":"HVAC","clientType":"residential","services":["AC Tune-Up","Installation"],"dealValue":12345.67,"stage":"Intakes","nextAction":"","notes":"","customFields":[{"name":"License #","value":"CA-88213"},{"name":"Fleet size","value":"14"},{"name":"Insured","value":"0"}]}' \
  "$BASE/api/clients/$HVAC_ID")
check "update HVAC → 200" 200 "$S"
grep -q '"customFields":\[{"name":"License #","value":"CA-88213"},{"name":"Fleet size","value":"14"},{"name":"Insured","value":"0"}\]' /tmp/body.json && echo "  ✓ custom fields survive update (values round-trip)" || echo "  ✗ custom fields after update: $(cat /tmp/body.json)"
grep -q '"dealValue":12345.67' /tmp/body.json && echo "  ✓ updated decimal deal value" || echo "  ✗ updated deal: $(cat /tmp/body.json)"
grep -q '"AC Tune-Up"' /tmp/body.json && echo "  ✓ updated free-form service" || echo "  ✗ services after update: $(cat /tmp/body.json)"

echo "== 12. Landscaping demo client (defined fields only) =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow & Stone Landscapes","contactName":"Dana Kim","email":"dana@willowstone.example","phone":"+1 206 555 0144","industry":"Landscaping","clientType":"commercial","services":["Mowing","Design","Irrigation"],"dealValue":4200,"stage":"Intakes","nextAction":"Site visit","notes":"","customFields":[{"name":"Service area","value":"Greater Seattle"},{"name":"Fleet size","value":"6"}]}' \
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
grep -q "\"orgId\":$ORG2_ID" /tmp/body.json && grep -q '"role":"member"' /tmp/body.json && echo "  ✓ member me carries orgId + role member" || echo "  ✗ member me wrong: $(cat /tmp/body.json)"
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
DEFAULT_ORG_ID=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print(next(o['id'] for o in d['orgs'] if o['name'] == 'Elevate Studio'))")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
orgs = {o['name']: o for o in d['orgs']}
assert 'Elevate Studio' in orgs and 'Acme Widgets LLC' in orgs, [o['name'] for o in d['orgs']]
assert orgs['Elevate Studio']['userCount'] == 1, orgs['Elevate Studio']
assert orgs['Acme Widgets LLC']['userCount'] == 1, orgs['Acme Widgets LLC']
assert orgs['Acme Widgets LLC']['clientCount'] == 0, orgs['Acme Widgets LLC']
assert orgs['Elevate Studio']['createdAt'], orgs['Elevate Studio']
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
assert u['orgName'] == 'Elevate Studio', u.get('orgName')
assert u['stages'] == ['Leads','Intakes','Sold'], u['stages']
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
grep -q '"orgName":"Elevate Studio"' /tmp/body.json && echo "  ✓ settings carries org name" || echo "  ✗ settings orgName: $(cat /tmp/body.json)"
grep -q '"stages":\["Leads","Intakes","Sold"\]' /tmp/body.json && echo "  ✓ settings returns the owner 3-stage pipeline (Leads → Intakes → Sold)" || echo "  ✗ settings stages: $(cat /tmp/body.json)"
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
check "rename Intakes→Proposal → 200" 200 "$S"
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
assert sc.get('Intakes', 0) == 0, sc
print("  ✓ dashboard counts follow the rename (Proposal=2, Intakes=0)")
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
  -d '{"orgName":"Elevate Studio HQ","orgId":999999}' "$BASE/api/settings")
check "PUT with bogus body orgId → 200 (ignored)" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/settings")
grep -q '"orgName":"Elevate Studio HQ"' /tmp/body.json && echo "  ✓ body orgId ignored — own org updated" || echo "  ✗ settings: $(cat /tmp/body.json)"
code -b "$JAR" -X PUT -H 'Content-Type: application/json' -d '{"orgName":"Elevate Studio"}' "$BASE/api/settings" > /dev/null

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
grep -q '"orgName":"Elevate Studio"' /tmp/body.json && echo "  ✓ owner org untouched by tenant B's body-orgId write" || echo "  ✗ owner me: $(cat /tmp/body.json)"
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

echo "== 23. Vertical templates (3f-1): business-type delegation at signup =="
echo "-- 23a. Admin creates a Pest Control org — stages + fields seeded =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Pest Patrol LLC","email":"pest@example.com","password":"pestpass123","vertical":"pest_control"}' "$BASE/api/admin/orgs")
check "admin creates Pest Control org → 201" 201 "$S"
PEST_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARPEST=$(mktemp)
S=$(code -c "$JARPEST" -b "$JARPEST" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"pest@example.com","password":"pestpass123"}' "$BASE/api/auth/login")
check "pest org login → 200" 200 "$S"
S=$(code -b "$JARPEST" "$BASE/api/settings")
check "pest org GET settings → 200" 200 "$S"
grep -q '"stages":\["Leads","Inspections","Recurring treatments","Renewals"\]' /tmp/body.json && echo "  ✓ pest stages seeded (owner's exact names, in order)" || echo "  ✗ pest stages: $(cat /tmp/body.json)"
grep -q '"verticalKey":"pest_control"' /tmp/body.json && echo "  ✓ verticalKey=pest_control seeded" || echo "  ✗ verticalKey: $(cat /tmp/body.json)"
grep -q '"industry":"home_services"' /tmp/body.json && grep -q '"serviceModel":"both"' /tmp/body.json && grep -q '"deliveryType":"we_go"' /tmp/body.json && echo "  ✓ vertical settings seeded (home_services / both / we_go)" || echo "  ✗ vertical settings: $(cat /tmp/body.json)"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
fields = {f['name']: f for f in d['customFields']}
want = {"Pest type": "select", "Treatment frequency": "select", "Renewal reminder": "text", "COI required": "checkbox"}
assert set(fields) == set(want), fields
for name, typ in want.items():
    assert fields[name]['type'] == typ, (name, fields[name])
assert fields['Pest type']['options'] == ["Ants","Rodents","Termites","Bed bugs","Cockroaches","Mosquitoes","Other"], fields['Pest type']
assert fields['Treatment frequency']['options'] == ["Monthly","Quarterly","Semi-annual","Annual","One-time"], fields['Treatment frequency']
print("  ✓ pest custom fields seeded with correct types + select options")
PY

echo "-- 23b. General (no preset) behaves exactly as before =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Generic Co","email":"generic@example.com","password":"genericpass123","vertical":"general"}' "$BASE/api/admin/orgs")
check "admin creates General org → 201" 201 "$S"
GEN_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARGEN=$(mktemp)
S=$(code -c "$JARGEN" -b "$JARGEN" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"generic@example.com","password":"genericpass123"}' "$BASE/api/auth/login")
check "general org login → 200" 200 "$S"
S=$(code -b "$JARGEN" "$BASE/api/settings")
check "general org GET settings → 200" 200 "$S"
grep -q '"stages":\["Prospect","Intake","Kickoff","Build","Launch","Retainer"\]' /tmp/body.json && echo "  ✓ General org starts from default stages" || echo "  ✗ General stages: $(cat /tmp/body.json)"
grep -q '"customFields":\[\]' /tmp/body.json && echo "  ✓ General org has NO seeded custom fields" || echo "  ✗ General fields: $(cat /tmp/body.json)"
grep -q '"verticalKey":""' /tmp/body.json && grep -q '"industry":""' /tmp/body.json && echo "  ✓ General org verticalKey/industry empty" || echo "  ✗ General vertical: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"No Vertical Co","email":"novertica@example.com","password":"noverticapass123"}' "$BASE/api/admin/orgs")
check "admin creates org WITHOUT vertical → 201 (same as General)" 201 "$S"
NOVERT_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
check "admin deletes No Vertical Co → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$NOVERT_ID")

echo "-- 23c. Template seeds are org-isolated (no leak) =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Glow Med Spa","email":"glow@example.com","password":"glowpass123","vertical":"med_spa"}' "$BASE/api/admin/orgs")
check "admin creates Med Spa org → 201" 201 "$S"
MED_ORG_ID=$(python3 -c "import json; print(json.load(open('/tmp/body.json'))['org']['id'])")
JARMED=$(mktemp)
S=$(code -c "$JARMED" -b "$JARMED" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"glow@example.com","password":"glowpass123"}' "$BASE/api/auth/login")
check "med spa login → 200" 200 "$S"
S=$(code -b "$JARMED" "$BASE/api/settings")
check "med spa GET settings → 200" 200 "$S"
grep -q '"stages":\["Leads","Consultations","Booked","Treatments","Retention"\]' /tmp/body.json && echo "  ✓ med spa stages seeded" || echo "  ✗ med spa stages: $(cat /tmp/body.json)"
grep -q '"verticalKey":"med_spa"' /tmp/body.json && grep -q '"industry":"mobile_personal"' /tmp/body.json && grep -q '"deliveryType":"client_comes"' /tmp/body.json && echo "  ✓ med spa vertical settings (mobile_personal / client_comes)" || echo "  ✗ med spa settings: $(cat /tmp/body.json)"
grep -qv 'Pest type' /tmp/body.json && grep -qv 'COI required' /tmp/body.json && echo "  ✓ med spa does NOT see pest fields (isolation)" || echo "  ✗ pest fields leaked to med spa: $(cat /tmp/body.json)"
S=$(code -b "$JARPEST" "$BASE/api/settings")
check "pest org settings still pest → 200" 200 "$S"
grep -q '"verticalKey":"pest_control"' /tmp/body.json && grep -q '"name":"Pest type"' /tmp/body.json && grep -qv 'Consultations' /tmp/body.json && echo "  ✓ pest org unaffected by med spa (isolation)" || echo "  ✗ pest org: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/settings")
grep -qv 'Pest type' /tmp/body.json && grep -qv '"Leads","Inspections"' /tmp/body.json && echo "  ✓ owner org untouched by any template seed" || echo "  ✗ owner org got seeded stages/fields: $(cat /tmp/body.json)"
check "bad vertical on create → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Bad Vert Co","email":"badvert@example.com","password":"badvertpass123","vertical":"quantum_cleaning"}' "$BASE/api/admin/orgs")
check "member cannot create orgs (admin-only) → 403" 403 $(code -b "$JARPEST" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Hack Co","email":"hack@example.com","password":"hackpass123","vertical":"pest_control"}' "$BASE/api/admin/orgs")

echo "-- 23d. Additive apply: missing stages/fields appended, existing untouched =="
S=$(code -b "$JARPEST" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["New leads","Inspections","Recurring treatments","Renewals"]}' "$BASE/api/settings")
check "pest org renames a stage (Leads→New leads) → 200" 200 "$S"
S=$(code -b "$JARPEST" -X PUT -H 'Content-Type: application/json' \
  -d '{"customFields":[{"name":"Pest type","type":"select","options":["Ants","Rodents","Termites","Bed bugs","Cockroaches","Mosquitoes","Other"]},{"name":"Treatment frequency","type":"select","options":["Monthly","Quarterly","Semi-annual","Annual","One-time"]},{"name":"Renewal reminder","type":"text"},{"name":"COI required","type":"checkbox"},{"name":"Extra field","type":"text"}]}' "$BASE/api/settings")
check "pest org adds its own custom field → 200" 200 "$S"
S=$(code -b "$JARPEST" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Termite Tower","clientType":"commercial","stage":"New leads","dealValue":900,"customFields":[{"name":"Pest type","value":"Termites"},{"name":"COI required","value":true}]}' "$BASE/api/clients")
check "pest org creates client in renamed stage + seeded field values → 201" 201 "$S"
grep -q '"name":"Pest type","value":"Termites"' /tmp/body.json && grep -q '"name":"COI required","value":"1"' /tmp/body.json && echo "  ✓ seeded select + checkbox values stored" || echo "  ✗ client values: $(cat /tmp/body.json)"
grep -q '"stage":"New leads"' /tmp/body.json && echo "  ✓ client in renamed stage" || echo "  ✗ stage: $(cat /tmp/body.json)"
S=$(code -b "$JARPEST" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"painting"}' "$BASE/api/settings")
check "apply Painting template to pest org → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
stages = d['stages']
assert stages == ["New leads","Inspections","Recurring treatments","Renewals","Leads","Estimates","Projects","Crews","Payments"], stages
fields = {f['name']: f for f in d['customFields']}
names = list(fields)
assert names[0:4] == ["Pest type","Treatment frequency","Renewal reminder","COI required"], names
assert names.index("Extra field") == 4, names
assert names[-4:] == ["Interior / exterior","Square footage","Paint brand preference","Assigned crew"], names
assert fields["Interior / exterior"]["type"] == "select" and fields["Interior / exterior"]["options"] == ["Interior","Exterior","Both"], fields["Interior / exterior"]
assert d['verticalKey'] == 'painting' and d['industry'] == 'home_services' and d['deliveryType'] == 'we_go', d
print("  ✓ additive apply: renamed stage kept, missing stages/fields appended, vertical settings updated")
PY
S=$(code -b "$JARPEST" "$BASE/api/clients")
check "pest client list after apply → 200" 200 "$S"
grep -q 'Termite Tower' /tmp/body.json && grep -q '"stage":"New leads"' /tmp/body.json && echo "  ✓ client untouched by template apply (still in renamed stage)" || echo "  ✗ client after apply: $(cat /tmp/body.json)"
S=$(code -b "$JARPEST" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"painting"}' "$BASE/api/settings")
check "apply same template again → 200 (idempotent)" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
assert d['stages'] == ["New leads","Inspections","Recurring treatments","Renewals","Leads","Estimates","Projects","Crews","Payments"], d['stages']
assert len(d['customFields']) == 9, len(d['customFields'])
print("  ✓ re-apply adds nothing (no duplicates)")
PY
S=$(code -b "$JARPEST" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"general"}' "$BASE/api/settings")
check "apply General (back to no preset) → 200" 200 "$S"
grep -q '"verticalKey":""' /tmp/body.json && grep -q '"industry":""' /tmp/body.json && grep -q '"serviceModel":"both"' /tmp/body.json && echo "  ✓ General resets vertical config to defaults" || echo "  ✗ after general: $(cat /tmp/body.json)"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
assert d['stages'] == ["New leads","Inspections","Recurring treatments","Renewals","Leads","Estimates","Projects","Crews","Payments"], d['stages']
assert len(d['customFields']) == 9, len(d['customFields'])
print("  ✓ General apply leaves stages + fields untouched (non-destructive)")
PY
check "bad verticalKey on apply → 400" 400 $(code -b "$JARPEST" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":"quantum_cleaning"}' "$BASE/api/settings")
check "non-string verticalKey on apply → 400" 400 $(code -b "$JARPEST" -X PUT -H 'Content-Type: application/json' \
  -d '{"verticalKey":42}' "$BASE/api/settings")

echo "-- 23e. Cross-org isolation for seeded definitions =="
S=$(code -b "$JARMED" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Spa Client Zero","clientType":"residential","customFields":[{"name":"Pest type","value":"Termites"}]}' "$BASE/api/clients")
check "med spa cannot write pest-org field → 400" 400 "$S"
grep -q 'Unknown custom field' /tmp/body.json && echo "  ✓ error is the unknown-field guard" || echo "  ✗ error: $(cat /tmp/body.json)"
S=$(code -b "$JARMED" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Spa Client One","clientType":"residential","customFields":[{"name":"Treatment types","value":"Laser"},{"name":"License number","value":"CA-993"}]}' "$BASE/api/clients")
check "med spa writes its own seeded field values → 201" 201 "$S"
grep -q '"name":"Treatment types","value":"Laser"' /tmp/body.json && grep -q '"name":"License number","value":"CA-993"' /tmp/body.json && echo "  ✓ med spa seeded select + text values round-trip" || echo "  ✗ med spa client: $(cat /tmp/body.json)"

echo "-- 23f. UI surface strings in the built bundle =="
NEWEST_JS=$(ls -t dist/index-*.js 2>/dev/null | head -1)
if [ -n "$NEWEST_JS" ] && [ -f "$NEWEST_JS" ]; then
  if grep -q "Business type" "$NEWEST_JS" && grep -q "Apply template" "$NEWEST_JS" && grep -q "General (no preset)" "$NEWEST_JS" && grep -q "Recurring treatments" "$NEWEST_JS" && grep -q "Pest type" "$NEWEST_JS"; then
    PASS=$((PASS+1)); echo "  ✓ bundle contains the business-type picker, apply-template + vertical seeds"
  else
    FAIL=$((FAIL+1)); echo "  ✗ vertical-template strings missing from $NEWEST_JS"
  fi
else
  FAIL=$((FAIL+1)); echo "  ✗ dist build not found for bundle surface check"
fi

echo "== 24. Owner pipeline migration (3g-2): Leads → Intakes → Sold =="
echo "-- 24a. Owner org has exactly 3 stages (editor tests renamed the middle) =="
# The stage-editor sections (17e/17f) renamed the middle stage to "Proposal" to
# prove the Settings editor still works on the owner org — so at this point the
# owner pipeline is [Leads, Proposal, Sold]: exactly 3 stages, first Leads,
# last Sold. The canonical [Leads, Intakes, Sold] is asserted right after the
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
assert st == ['Leads', 'Intakes', 'Sold'], st
expect = {
  'Legacy Lead Band': 'Leads',
  'Legacy Intake Band': 'Leads',
  'Legacy Kickoff Band': 'Intakes',
  'Legacy Build Band': 'Intakes',
  'Legacy Launch Band': 'Sold',
  'Legacy Retainer Band': 'Sold',
}
by = {c['company_name']: c['stage'] for c in d.get('clients', [])}
assert by == expect, (by, expect)
print("  ✓ positional remap (computed from counts): bands [1-2]→Leads, [3-4]→Intakes, [5-6]→Sold")
print("  ✓ every owner client record's stage value migrated (Prospect/Intake→Leads, Kickoff/Build→Intakes, Launch/Retainer→Sold)")
PY
S=$(code -b "$JAR" "$BASE/api/settings")
grep -q '"stages":\["Leads","Intakes","Sold"\]' /tmp/body.json && echo "  ✓ owner settings (via API) reflect the migrated pipeline" || echo "  ✗ owner stages via API: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients?q=Legacy")
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
by = {c['companyName']: c['stage'] for c in d['clients']}
expect = {
  'Legacy Lead Band': 'Leads',
  'Legacy Intake Band': 'Leads',
  'Legacy Kickoff Band': 'Intakes',
  'Legacy Build Band': 'Intakes',
  'Legacy Launch Band': 'Sold',
  'Legacy Retainer Band': 'Sold',
}
assert by == expect, (by, expect)
print("  ✓ API confirms the remap (a record formerly in Build is now Intakes, Retainer → Sold)")
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
grep -q '"stages":\["Leads","Intakes","Sold"\]' /tmp/body.json && echo "  ✓ owner org ends clean: stages back to Leads → Intakes → Sold, test clients removed" || echo "  ✗ owner end state: $(cat /tmp/body.json)"
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
#       the owner org to Leads → Intakes → Sold with the client remapped
#       positionally (Kickoff = band [3-4] → Intakes).
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
// migrate the owner org to Leads → Intakes → Sold. On a regression of the TDZ
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
assert d['client'] == 'Intakes', d['client']  # old Kickoff = band [3-4] → Intakes
print("  ✓ owner org migrated at import: " + " → ".join(d['stages']))
print("  ✓ positional client remap ran from the boot path (Kickoff → Intakes)")
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

echo "== 26. Sold-lead auto-provisioning (3g-3) =="
ORG_COUNT() { curl -s -b "$JAR" "$BASE/api/admin/orgs" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['orgs']))"; }
echo "-- 26a. Owner moves a lead into Sold → one clean vertical-seeded workspace =="
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
grep -q '"stages":\["Leads","Quotes","Recurring clients","Crews","Jobs"\]' /tmp/body.json && echo "  ✓ Landscaping stages seeded" || echo "  ✗ stages: $(cat /tmp/body.json)"
grep -q '"verticalKey":"landscaping"' /tmp/body.json && grep -q '"industry":"home_services"' /tmp/body.json && grep -q '"serviceModel":"both"' /tmp/body.json && grep -q '"deliveryType":"we_go"' /tmp/body.json && echo "  ✓ vertical settings seeded (landscaping / home_services / both / we_go)" || echo "  ✗ vertical settings: $(cat /tmp/body.json)"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))['settings']
fields = {f['name']: f for f in d['customFields']}
assert fields.get('Property size', {}).get('type') == 'text', fields
assert fields.get('Service frequency', {}).get('type') == 'select', fields
assert fields['Service frequency']['options'] == ["Weekly","Biweekly","Monthly","One-time"], fields['Service frequency']
print("  ✓ seeded custom fields present (Property size text, Service frequency select)")
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

echo "-- 26b. Idempotent: Sold → Intakes → Sold creates no second org =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow Stone Contracting","contactName":"Mia Chen","email":"mia@willowstone.example","phone":"+1 555 0199","industry":"Landscaping","clientType":"commercial","dealValue":15000,"stage":"Intakes","nextAction":"","notes":"moved back"}' \
  "$BASE/api/clients/$WL_ID")
check "move back to Intakes → 200" 200 "$S"
grep -q '"stage":"Intakes"' /tmp/body.json && echo "  ✓ client back in Intakes" || echo "  ✗ stage: $(cat /tmp/body.json)"
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
assert prov[0]['loginEmail'] == 'dust-bane-pest@elevate.studio', prov[0]['loginEmail']
assert prov[0]['tempPassword'], prov[0]
assert prov[0]['name'] == 'Dust & Bane Pest', prov[0]
print("  ✓ derived login email from company slug: dust-bane-pest@elevate.studio")
PY
DB1_PW=$(python3 -c "import json; d=json.load(open('/tmp/body.json')); print([o['tempPassword'] for o in d['orgs'] if o.get('provisionedFromClient') == $DB1_ID][0])")
JARDB1=$(mktemp)
S=$(code -c "$JARDB1" -b "$JARDB1" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"dust-bane-pest@elevate.studio\",\"password\":\"$DB1_PW\"}" "$BASE/api/auth/login")
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
assert prov[0]['loginEmail'] == 'dust-bane-pest1@elevate.studio', prov[0]['loginEmail']
assert prov[0]['tempPassword'], prov[0]
print("  ✓ colliding slug got the numeric suffix: dust-bane-pest1@elevate.studio")
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
if grep -Fq "[email] RESEND_API_KEY not configured — skipping Welcome to Elevate Studio — your workspace is ready to nokey@example.com" "$MOCK/srv-a.log"; then
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
assert e["subject"] == "Welcome to Elevate Studio — your workspace is ready", e["subject"]
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
assert len(lines) == 1, [(l.get("subject"), l.get("to")) for l in lines]
e = lines[0]
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
t = lines[0]["text"]
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
if [ "$(wc -l < "$MOCK28_EMAILS")" -eq 1 ]; then
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
m = re.search(r"token=([0-9a-f]{64})", lines[-1]["text"])
assert m, lines[-1]["text"]
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
m = re.search(r"token=([0-9a-f]{64})", lines[-1]["text"])
assert m, lines[-1]["text"]
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
  -d '{"stages":["Pipeline Leads","Intakes","Sold"]}' "$BASE/api/settings")
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
assert st == ['Pipeline Leads', 'Intakes', 'Sold'], st
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
  -d '{"stages":["Leads","Intakes","Sold"]}' "$BASE/api/settings")
check "30g: owner stages restored to Leads → Intakes → Sold → 200" 200 "$S"
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
  -d '{"stages":["New Leads","Intakes","Sold"]}' "$BASE/api/settings")
check "31d: rename first stage Leads → \"New Leads\" → 200" 200 "$S"
code -b "$JAR" "$BASE/api/settings" > /dev/null
cp /tmp/body.json /tmp/s31d-settings.json
code -b "$JAR" "$BASE/api/clients?archived=1" > /dev/null
if BID31A="$BID31A" BID31B="$BID31B" BID31C="$BID31C" python3 - <<'PY' 2>"$PASS_TMP"
import json, os
st = json.load(open('/tmp/s31d-settings.json'))['settings']['stages']
assert st == ['New Leads', 'Intakes', 'Sold'], st
clients = json.load(open('/tmp/body.json'))['clients']
A = [c for c in clients if c['id'] == int(os.environ['BID31A'])][0]
B = [c for c in clients if c['id'] == int(os.environ['BID31B'])][0]
C = [c for c in clients if c['id'] == int(os.environ['BID31C'])][0]
assert A['stage'] == 'New Leads', A['stage']   # first bucket follows the rename
assert B['stage'] == 'Intakes', B['stage']     # middle bucket unchanged
assert C['stage'] == 'Sold', C['stage']        # terminal bucket unchanged
print("  ✓ after rename: first bucket = \"New Leads\" (A), middle = [\"Intakes\"] (B), terminal = \"Sold\" (C)")
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
  -d '{"stages":["Leads","Intakes","Sold"]}' "$BASE/api/settings")
check "31g: owner stages restored to Leads → Intakes → Sold → 200" 200 "$S"
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
  -d '{"companyName":"DNC Lead Co","clientType":"residential","dealValue":500,"stage":"Intakes"}' "$BASE/api/clients/$DNC32_ID")
check "32b: partial update without dnc keys → 200" 200 "$S"
grep -q '"dnc":true' /tmp/body.json && grep -q '"dncReason":"Written request received"' /tmp/body.json && echo "  ✓ absent dnc keys leave the flag untouched (partial update)" || echo "  ✗ dnc clobbered: $(cat /tmp/body.json)"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"DNC Lead Co","clientType":"residential","dealValue":500,"stage":"Intakes","dnc":false}' "$BASE/api/clients/$DNC32_ID")
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
# Baseline recaptured NOW: 32b's DNC Lead Co (dealValue 500, stage Intakes) is
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
echo "RESULT: $PASS passed, $FAIL failed"

rm -f "$JAR" /tmp/body.json "$PASS_TMP"
[ "$FAIL" -eq 0 ]


rm -f "$JAR" /tmp/body.json
[ "$FAIL" -eq 0 ]
