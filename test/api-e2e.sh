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

echo "== 1. Auth guards =="
check "me without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/auth/me")
check "clients without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/clients")
check "tasks without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/tasks")
check "invoices without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/invoices")
check "admin orgs without cookie → 401" 401 $(code -b "$JAR" "$BASE/api/admin/orgs")
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
  -d '{"companyName":"Acme Legal LLP","contactName":"Jordan Lee","email":"jordan@acme.example","phone":"+1 555 0100","industry":"Legal","services":["Premium Website","SEO"],"dealValue":12500,"stage":"Prospect","nextAction":"Send proposal","notes":"Referred by owner"}' \
  "$BASE/api/clients")
ACME_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$ACME_ID)"
check "create Northline → 201" 201 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Northline Coffee","contactName":"Sam Rivera","email":"sam@northline.example","industry":"Hospitality","services":["Paid Campaigns","Analytics"],"dealValue":5400,"stage":"Intake","nextAction":"Collect access","notes":""}' \
  "$BASE/api/clients")
NL_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$NL_ID)"
check "create without company name → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"contactName":"No Co"}' "$BASE/api/clients")
check "create bad stage → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad Stage Co","stage":"Won"}' "$BASE/api/clients")
check "create negative deal → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Neg Co","dealValue":-5}' "$BASE/api/clients")

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
  -d '{"companyName":"Acme Legal LLP","contactName":"Jordan Lee","email":"jordan@acme.example","phone":"+1 555 0100","industry":"Legal","services":["Premium Website","SEO","Paid Campaigns"],"dealValue":15000,"stage":"Kickoff","nextAction":"Kickoff call Thursday","notes":"Added paid campaigns"}' \
  "$BASE/api/clients/$ACME_ID")
check "update Acme → 200" 200 "$S"
grep -q '"stage":"Kickoff"' /tmp/body.json && grep -q '"dealValue":15000' /tmp/body.json && echo "  ✓ stage moved to Kickoff, deal 15000" || echo "  ✗ update failed: $(cat /tmp/body.json)"

echo "== 7. Dashboard counts + projected pipeline =="
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "dashboard → 200" 200 "$S"
grep -q '"Prospect":0' /tmp/body.json && echo "  ✓ Prospect=0" || echo "  ✗ Prospect count: $(cat /tmp/body.json)"
grep -q '"Kickoff":1' /tmp/body.json && echo "  ✓ Kickoff=1" || echo "  ✗ Kickoff count: $(cat /tmp/body.json)"
grep -q '"Intake":1' /tmp/body.json && echo "  ✓ Intake=1" || echo "  ✗ Intake count: $(cat /tmp/body.json)"
grep -q '"projectedPipeline":20400' /tmp/body.json && echo "  ✓ projectedPipeline = 20400 (15000+5400, labeled projected not revenue)" || echo "  ✗ pipeline: $(cat /tmp/body.json)"

echo "== 8. Archive affects dashboard only =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Northline Coffee","contactName":"Sam Rivera","email":"sam@northline.example","industry":"Hospitality","services":["Paid Campaigns","Analytics"],"dealValue":5400,"stage":"Intake","nextAction":"","notes":"","archived":true}' \
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

echo "== 10. Custom fields + free-form services + decimal deal value =="
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Summit Heating & Air","contactName":"Ray Ortiz","email":"ray@summit.example","phone":"+1 415 555 0131","industry":"HVAC","services":["Installation","Repair","Maintenance"],"dealValue":9500.50,"stage":"Prospect","nextAction":"Send quote","notes":"","customFields":[{"label":"License #","value":"CA-88213"},{"label":"Service area","value":"Greater Bay Area"},{"label":"Fleet size","value":"12"}]}' \
  "$BASE/api/clients")
check "create HVAC client with 2+ custom fields → 201" 201 "$S"
HVAC_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
echo "    (created client id=$HVAC_ID)"
grep -q '"customFields":\[{"label":"License #","value":"CA-88213"}' /tmp/body.json && echo "  ✓ create returns custom fields" || echo "  ✗ custom fields missing on create: $(cat /tmp/body.json)"
grep -q '"dealValue":9500.5' /tmp/body.json && echo "  ✓ decimal deal value returned" || echo "  ✗ deal value mismatch: $(cat /tmp/body.json)"
grep -q '"services":\["Installation","Repair","Maintenance"\]' /tmp/body.json && echo "  ✓ free-form services returned" || echo "  ✗ services mismatch: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$HVAC_ID")
check "GET HVAC client → 200" 200 "$S"
grep -q '"Fleet size"' /tmp/body.json && echo "  ✓ GET returns all custom fields" || echo "  ✗ custom fields missing on GET: $(cat /tmp/body.json)"

echo "== 11. Custom field update round-trip =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"companyName":"Summit Heating & Air","contactName":"Ray Ortiz","email":"ray@summit.example","phone":"","industry":"HVAC","services":["AC Tune-Up","Installation"],"dealValue":12345.67,"stage":"Kickoff","nextAction":"","notes":"","customFields":[{"label":"License #","value":"CA-88213"}]}' \
  "$BASE/api/clients/$HVAC_ID")
check "update HVAC → 200" 200 "$S"
grep -q '"customFields":\[{"label":"License #","value":"CA-88213"}\]' /tmp/body.json && echo "  ✓ update removed a custom field" || echo "  ✗ custom fields after update: $(cat /tmp/body.json)"
grep -q '"dealValue":12345.67' /tmp/body.json && echo "  ✓ updated decimal deal value" || echo "  ✗ updated deal: $(cat /tmp/body.json)"
grep -q '"AC Tune-Up"' /tmp/body.json && echo "  ✓ updated free-form service" || echo "  ✗ services after update: $(cat /tmp/body.json)"

echo "== 12. Custom field validation + landscaping demo =="
check "empty custom field label → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":[{"label":"","value":"x"}]}' "$BASE/api/clients")
check "non-object custom field → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":["License"]}' "$BASE/api/clients")
check "custom fields not a list → 400" 400 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Bad CF Co","customFields":{"label":"x","value":"y"}}' "$BASE/api/clients")
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Willow & Stone Landscapes","contactName":"Dana Kim","email":"dana@willowstone.example","phone":"+1 206 555 0144","industry":"Landscaping","services":["Mowing","Design","Irrigation"],"dealValue":4200,"stage":"Build","nextAction":"Site visit","notes":"","customFields":[{"label":"Crew size","value":"6"},{"label":"Seasonal contract","value":"Yes — Apr to Oct"},{"label":"Service radius","value":"40 mi"}]}' \
  "$BASE/api/clients")
check "create landscaping client → 201" 201 "$S"
LS_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
grep -q '"Crew size"' /tmp/body.json && echo "  ✓ landscaping custom fields returned" || echo "  ✗ missing: $(cat /tmp/body.json)"

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
  -d '{"companyName":"Temp Co For Tasks","contactName":"T","industry":"Testing","dealValue":0,"stage":"Prospect"}' \
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
  -d '{"companyName":"Temp Co For Invoices","contactName":"T","industry":"Testing","dealValue":0,"stage":"Prospect"}' \
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
  -d '{"companyName":"Hacked","dealValue":1}' "$BASE/api/clients/$HVAC_ID")
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
  -d '{"companyName":"Member Corp","contactName":"M","industry":"Testing","dealValue":5000,"stage":"Prospect"}' \
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
grep -q 'Member Corp' /tmp/body.json && echo "  ✓ member sees their own client" || echo "  ✗ member missing own client: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/tasks")
check "member tasks list has own task → 200" 200 "$S"
grep -q 'Member follow-up' /tmp/body.json && echo "  ✓ member sees their own task" || echo "  ✗ member missing own task: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/invoices")
check "member invoices list has own invoice → 200" 200 "$S"
grep -q '"amount":777.77' /tmp/body.json && echo "  ✓ member sees their own invoice" || echo "  ✗ member missing own invoice: $(cat /tmp/body.json)"
S=$(code -b "$JAR2" "$BASE/api/dashboard")
check "member dashboard counts own data → 200" 200 "$S"
grep -q '"projectedPipeline":5000' /tmp/body.json && grep -q '"totalClients":1' /tmp/body.json && echo "  ✓ member dashboard counts only their own data" || echo "  ✗ member dashboard: $(cat /tmp/body.json)"

echo "-- 16g. Default org cannot see member data =="
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "admin re-login → 200" 200 "$S"
S=$(code -b "$JAR" "$BASE/api/clients")
check "admin clients list → 200" 200 "$S"
grep -qv 'Member Corp' /tmp/body.json && echo "  ✓ admin does NOT see member client" || echo "  ✗ member client leaked: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/tasks")
check "admin tasks list → 200" 200 "$S"
grep -qv 'Member follow-up' /tmp/body.json && echo "  ✓ admin does NOT see member task" || echo "  ✗ member task leaked: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/invoices")
check "admin invoices list → 200" 200 "$S"
grep -qv '"amount":777.77' /tmp/body.json && echo "  ✓ admin does NOT see member invoice" || echo "  ✗ member invoice leaked: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "admin dashboard → 200" 200 "$S"
grep -qv 'Member Corp' /tmp/body.json && echo "  ✓ admin dashboard excludes member data" || echo "  ✗ member leaked into admin dashboard"

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
assert u['stages'] == ['Prospect','Intake','Kickoff','Build','Launch','Retainer'], u['stages']
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
grep -q '"stages":\["Prospect","Intake","Kickoff","Build","Launch","Retainer"\]' /tmp/body.json && echo "  ✓ settings returns default stages" || echo "  ✗ settings stages: $(cat /tmp/body.json)"
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
  -d '{"stages":"Prospect"}' "$BASE/api/settings")
check "bad accent → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"accentColor":"lime"}' "$BASE/api/settings")
check "blank org name → 400" 400 $(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"orgName":""}' "$BASE/api/settings")

echo "-- 17e. Rename a stage migrates its clients =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Prospect","Intake","Proposal","Build","Launch","Retainer"]}' "$BASE/api/settings")
check "rename Kickoff→Proposal → 200" 200 "$S"
grep -q '"stages":\["Prospect","Intake","Proposal"' /tmp/body.json && echo "  ✓ new stage list returned" || echo "  ✗ response: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/clients/$HVAC_ID")
check "get HVAC client → 200" 200 "$S"
grep -q '"stage":"Proposal"' /tmp/body.json && echo "  ✓ client in renamed stage migrated to Proposal" || echo "  ✗ client stage after rename: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/dashboard")
check "dashboard after rename → 200" 200 "$S"
python3 - <<'PY'
import json
d = json.load(open('/tmp/body.json'))
sc = d['stageCounts']
assert sc.get('Proposal') == 1, sc
assert sc.get('Kickoff', 0) == 0, sc
print("  ✓ dashboard counts follow the rename (Proposal=1, Kickoff=0)")
PY

echo "-- 17f. Add / remove stages =="
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Prospect","Intake","Proposal","Build","Launch","Retainer","Won"]}' "$BASE/api/settings")
check "add stage Won → 200" 200 "$S"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Prospect","Intake","Proposal","Build","Launch","Retainer"]}' "$BASE/api/settings")
check "remove empty stage Won → 200" 200 "$S"
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Prospect","Intake","Proposal","Build","Launch","Retainer","Won"]}' "$BASE/api/settings")
check "re-add Won → 200" 200 "$S"
S=$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"companyName":"Won Co","stage":"Won"}' "$BASE/api/clients")
check "create client in Won → 201" 201 "$S"
WON_ID=$(grep -o '"id":[0-9]*' /tmp/body.json | head -1 | cut -d: -f2)
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Prospect","Intake","Proposal","Build","Launch","Retainer"]}' "$BASE/api/settings")
check "remove Won with client → 400" 400 "$S"
grep -q 'reassign' /tmp/body.json && echo "  ✓ block message tells the user to reassign" || echo "  ✗ block message: $(cat /tmp/body.json)"
check "delete Won Co → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/clients/$WON_ID")
S=$(code -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  -d '{"stages":["Prospect","Intake","Proposal","Build","Launch","Retainer"]}' "$BASE/api/settings")
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
assert 'Lead' not in st and st[2] == 'Proposal', st
print("  ✓ owner stages unaffected by tenant B's rename (isolation)")
PY
S=$(code -b "$JARB" -X PUT -H 'Content-Type: application/json' \
  -d '{"orgName":"Tenant B Rebranded","orgId":1}' "$BASE/api/settings")
check "tenant B PUT with owner orgId in body → 200" 200 "$S"
S=$(code -b "$JARB" "$BASE/api/auth/me")
grep -q '"orgName":"Tenant B Rebranded"' /tmp/body.json && echo "  ✓ tenant B write landed on tenant B (session org wins)" || echo "  ✗ tenant B me: $(cat /tmp/body.json)"
S=$(code -b "$JAR" "$BASE/api/auth/me")
grep -q '"orgName":"Elevate Studio"' /tmp/body.json && echo "  ✓ owner org untouched by tenant B's body-orgId write" || echo "  ✗ owner me: $(cat /tmp/body.json)"
check "admin deletes tenant B → 200" 200 $(code -b "$JAR" -X DELETE "$BASE/api/admin/orgs/$TENANTB_ID")
rm -f "$JARB" "$JAR3"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
rm -f "$JAR" /tmp/body.json
[ "$FAIL" -eq 0 ]
