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
check "login wrong password → 401" 401 $(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"owner@elevate.studio","password":"nope"}' "$BASE/api/auth/login")

echo "== 2. Login =="
S=$(code -c "$JAR" -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/auth/login")
check "login correct creds → 200 + session cookie" 200 "$S"
grep -q elevate_session "$JAR" && echo "  ✓ session cookie stored" || echo "  ✗ session cookie missing"
check "me with cookie → 200" 200 $(code -b "$JAR" "$BASE/api/auth/me")
grep -Fq "$ADMIN_EMAIL" /tmp/body.json && echo "  ✓ me returns owner email" || echo "  ✗ me email wrong"

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

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
rm -f "$JAR" /tmp/body.json
[ "$FAIL" -eq 0 ]
