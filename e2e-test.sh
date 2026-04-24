#!/bin/bash
# E2E Test Suite for Workforce0
set -e

API="http://127.0.0.1:3000"
FRONTEND="http://localhost:3001"
PASS=0
FAIL=0

test_result() {
  if [ "$1" = "PASS" ]; then
    echo "  ✓ PASS: $2"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL: $2 -- $3"
    FAIL=$((FAIL + 1))
  fi
}

echo "========================================="
echo "  WORKFORCE0 E2E TEST SUITE"
echo "========================================="
echo ""

# 1. Health Check
echo "--- Test 1: Health Check ---"
HEALTH=$(curl -s --max-time 5 "$API/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  test_result "PASS" "Health endpoint returns OK"
else
  test_result "FAIL" "Health endpoint" "$HEALTH"
fi

# 2. Signup (accepts success OR duplicate rejection - both valid)
echo "--- Test 2: Signup ---"
SIGNUP=$(curl -s --max-time 5 -X POST "$API/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E Tester","email":"e2e@workforce0.com","password":"SecurePass9","organizationName":"E2E Corp"}')
if echo "$SIGNUP" | grep -q '"success":true'; then
  test_result "PASS" "Signup successful (new user)"
elif echo "$SIGNUP" | grep -qi 'exist\|duplicate\|already'; then
  test_result "PASS" "Signup correctly rejected duplicate"
else
  test_result "FAIL" "Signup" "$SIGNUP"
fi

# 3. Login
echo "--- Test 3: Login ---"
LOGIN=$(curl -s --max-time 5 -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e@workforce0.com","password":"SecurePass9"}')
if echo "$LOGIN" | grep -q '"success":true'; then
  test_result "PASS" "Login successful"
  TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null || echo "")
  if [ -z "$TOKEN" ]; then
    TOKEN=$(echo "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  fi
  echo "  Token: ${TOKEN:0:30}..."
else
  test_result "FAIL" "Login" "$LOGIN"
  TOKEN=""
fi

if [ -z "$TOKEN" ]; then
  echo "FATAL: No token, cannot continue"
  exit 1
fi

AUTH="Authorization: Bearer $TOKEN"

# 4. Get Current User
echo "--- Test 4: Get Current User (/me) ---"
ME=$(curl -s --max-time 5 "$API/api/auth/me" -H "$AUTH")
if echo "$ME" | grep -q '"success":true'; then
  test_result "PASS" "Get current user"
else
  test_result "FAIL" "Get current user" "$ME"
fi

# 5. Dashboard Stats
echo "--- Test 5: Dashboard Stats ---"
STATS=$(curl -s --max-time 5 "$API/api/dashboard/stats" -H "$AUTH")
if echo "$STATS" | grep -q '"success":true'; then
  test_result "PASS" "Dashboard stats"
  echo "  Stats: $STATS"
else
  test_result "FAIL" "Dashboard stats" "$STATS"
fi

# 6. Dashboard Activity
echo "--- Test 6: Dashboard Activity ---"
ACTIVITY=$(curl -s --max-time 5 "$API/api/dashboard/activity" -H "$AUTH")
if echo "$ACTIVITY" | grep -q '"success":true'; then
  test_result "PASS" "Dashboard activity"
else
  test_result "FAIL" "Dashboard activity" "$ACTIVITY"
fi

# 7. List Meetings
echo "--- Test 7: List Meetings ---"
MEETINGS=$(curl -s --max-time 5 "$API/api/meetings?limit=10" -H "$AUTH")
if echo "$MEETINGS" | grep -q '"success":true'; then
  test_result "PASS" "List meetings"
else
  test_result "FAIL" "List meetings" "$MEETINGS"
fi

# 8. Get Settings
echo "--- Test 8: Get Settings ---"
SETTINGS=$(curl -s --max-time 5 "$API/api/settings" -H "$AUTH")
if echo "$SETTINGS" | grep -q '"success":true'; then
  test_result "PASS" "Get settings"
else
  test_result "FAIL" "Get settings" "$SETTINGS"
fi

# 9. Update Integrations
echo "--- Test 9: Update Integration Settings ---"
UPD_INT=$(curl -s --max-time 5 -X PUT "$API/api/settings/integrations" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"recall_api_key":"test-key-e2e","recall_webhook_url":"https://test.example.com/webhooks/recall"}')
if echo "$UPD_INT" | grep -q '"success":true'; then
  test_result "PASS" "Update integrations"
else
  test_result "FAIL" "Update integrations" "$UPD_INT"
fi

# 10. Test Integration
echo "--- Test 10: Test Integration Connection ---"
TEST_INT=$(curl -s --max-time 10 -X POST "$API/api/settings/integrations/test" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"integration":"recall"}')
# This may fail since key is invalid, but endpoint should respond
if echo "$TEST_INT" | grep -q '"success"'; then
  test_result "PASS" "Test integration endpoint responds"
else
  test_result "FAIL" "Test integration" "$TEST_INT"
fi

# 11. Update Notifications
echo "--- Test 11: Update Notification Preferences ---"
UPD_NOTIF=$(curl -s --max-time 5 -X PUT "$API/api/settings/notifications" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"meetingCompleted":true,"prdGenerated":true,"prdNeedsReview":true,"ticketsCreated":false,"weeklyDigest":false}')
if echo "$UPD_NOTIF" | grep -q '"success":true'; then
  test_result "PASS" "Update notifications"
else
  test_result "FAIL" "Update notifications" "$UPD_NOTIF"
fi

# 12. Update Account
echo "--- Test 12: Update Account Settings ---"
UPD_ACC=$(curl -s --max-time 5 -X PUT "$API/api/settings/account" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"E2E Updated","organizationName":"E2E Updated Corp"}')
if echo "$UPD_ACC" | grep -q '"success":true'; then
  test_result "PASS" "Update account"
else
  test_result "FAIL" "Update account" "$UPD_ACC"
fi

# 13. List PRDs
echo "--- Test 13: List PRDs ---"
PRDS=$(curl -s --max-time 5 "$API/api/agents/prds?limit=10" -H "$AUTH")
if echo "$PRDS" | grep -q '"success":true'; then
  test_result "PASS" "List PRDs"
else
  test_result "FAIL" "List PRDs" "$PRDS"
fi

# 14. List Tasks
echo "--- Test 14: List Tasks ---"
TASKS=$(curl -s --max-time 5 "$API/api/agents/tasks?limit=10" -H "$AUTH")
if echo "$TASKS" | grep -q '"success":true'; then
  test_result "PASS" "List tasks"
else
  test_result "FAIL" "List tasks" "$TASKS"
fi

# 15. Auth Required (no token)
echo "--- Test 15: Auth Required (401 without token) ---"
NO_AUTH=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$API/api/dashboard/stats")
if [ "$NO_AUTH" = "401" ]; then
  test_result "PASS" "Returns 401 without token"
else
  test_result "FAIL" "Auth required" "Got HTTP $NO_AUTH, expected 401"
fi

# 16. Duplicate Signup Prevention
echo "--- Test 16: Duplicate Signup Prevention ---"
DUP=$(curl -s --max-time 5 -X POST "$API/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"name":"Duplicate","email":"e2e@workforce0.com","password":"SecurePass9","organizationName":"Dup Corp"}')
if echo "$DUP" | grep -qi 'exist\|duplicate\|already\|error\|conflict'; then
  test_result "PASS" "Duplicate signup rejected"
else
  test_result "FAIL" "Duplicate signup" "$DUP"
fi

# 17. Frontend Loads
echo "--- Test 17: Frontend Loads ---"
FE_STATUS=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$FRONTEND")
if [ "$FE_STATUS" = "200" ]; then
  test_result "PASS" "Frontend returns 200"
else
  test_result "FAIL" "Frontend" "Got HTTP $FE_STATUS"
fi

# 18. Frontend Has Proper HTML Structure
echo "--- Test 18: Frontend HTML Structure ---"
FE_HTML=$(curl -s --max-time 5 "$FRONTEND")
if echo "$FE_HTML" | grep -q '<html'; then
  test_result "PASS" "Frontend returns valid HTML"
else
  test_result "FAIL" "Frontend HTML" "No <html> tag found"
fi

echo ""
echo "========================================="
echo "  RESULTS: $PASS PASS / $FAIL FAIL"
echo "  Total: $((PASS + FAIL)) tests"
echo "========================================="
