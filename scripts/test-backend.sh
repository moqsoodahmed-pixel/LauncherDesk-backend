#!/usr/bin/env bash
# ============================================================================
#  LauncherDesk backend — end-to-end test (curl)
#
#  Usage:
#    chmod +x test-backend.sh
#    BASE_URL=https://launcherdesk-backend-production.up.railway.app \
#    ADMIN_EMAIL=you@launcherdesk.com ADMIN_PASSWORD='...' \
#    TEST_EMAIL_BASE=yourname@gmail.com \
#    ./test-backend.sh
#
#  Optional (simulates a full PAID order without charging anything — the
#  script signs a fake Razorpay webhook with your webhook secret):
#    RUN_PAYMENT_SIM=1 RAZORPAY_WEBHOOK_SECRET='...' ./test-backend.sh
#
#  ⚠ RUN_PAYMENT_SIM creates a test order, invoice and emails in whatever
#    database BASE_URL points to. Test data uses "+ldtest" emails so you can
#    find and delete it later in MongoDB.
#
#  Requires: curl, jq, openssl   (Mac: brew install jq)
# ============================================================================

BASE_URL="${BASE_URL:-https://launcherdesk-backend-production.up.railway.app}"
API="$BASE_URL/api"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
TEST_EMAIL_BASE="${TEST_EMAIL_BASE:-}"          # inbox on YOUR domain, e.g. contact@launcherdesk.com
# NOTE: the backend normalises Gmail/Outlook/Yahoo/iCloud addresses (removes "+tag" and dots),
# so a "+ldtest" address on those providers collapses into the real account and registration
# fails with 409. Use an address on your own domain (plus-addressing is kept there).
RUN_PAYMENT_SIM="${RUN_PAYMENT_SIM:-0}"
RAZORPAY_WEBHOOK_SECRET="${RAZORPAY_WEBHOOK_SECRET:-}"
TEST_AMOUNT="${TEST_AMOUNT:-1}"                  # rupees, used for create-order

for bin in curl jq openssl; do
  command -v "$bin" >/dev/null || { echo "❌ '$bin' is required (Mac: brew install $bin)"; exit 1; }
done

PASS=0; FAIL=0; SKIP=0; FAILED=()
G='\033[32m'; R='\033[31m'; Y='\033[33m'; B='\033[1m'; N='\033[0m'
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

section() { printf "\n${B}━━ %s ━━${N}\n" "$1"; }
pass()    { PASS=$((PASS+1)); printf "  ${G}✔${N} %s\n" "$1"; }
fail()    { FAIL=$((FAIL+1)); FAILED+=("$1"); printf "  ${R}✘ %s${N}\n" "$1"; [ -n "$2" ] && printf "      ${R}%s${N}\n" "$(echo "$2" | head -c 400)"; }
skip()    { SKIP=$((SKIP+1)); printf "  ${Y}○ %s (skipped: %s)${N}\n" "$1" "$2"; }

# req METHOD PATH [JSON_BODY] [TOKEN]  → sets $CODE and $BODY
req() {
  local method="$1" path="$2" data="$3" token="$4"
  local args=(-s -o "$TMP/body" -w '%{http_code}' -X "$method" "$API$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ]  && args+=(--data "$data")
  CODE="$(curl "${args[@]}" 2>/dev/null)"; BODY="$(cat "$TMP/body" 2>/dev/null)"
}
# expect NAME EXPECTED_CODE(S, e.g. "200|201")
expect() { if [[ "$CODE" =~ ^($2)$ ]]; then pass "$1 [$CODE]"; return 0; else fail "$1 — expected $2, got $CODE" "$BODY"; return 1; fi; }
j() { echo "$BODY" | jq -r "$1" 2>/dev/null; }

STAMP="$(date +%s)"
case "${TEST_EMAIL_BASE#*@}" in
  gmail.com|googlemail.com|outlook.com|hotmail.com|live.com|yahoo.com|icloud.com|me.com)
    echo "❌ TEST_EMAIL_BASE=$TEST_EMAIL_BASE won't work: the backend removes '+tags' from ${TEST_EMAIL_BASE#*@} addresses,"
    echo "   so every test user collapses into your real account. Use an address on your own domain,"
    echo "   e.g. TEST_EMAIL_BASE='contact@launcherdesk.com', or leave it empty to skip inbox checks."
    exit 1;;
esac
if [ -n "$TEST_EMAIL_BASE" ]; then
  USER_EMAIL="${TEST_EMAIL_BASE%@*}+ldtest$STAMP@${TEST_EMAIL_BASE#*@}"
else
  USER_EMAIL="ldtest$STAMP@example.com"
fi
USER2_EMAIL="ldtest2_$STAMP@example.com"
PASSWORD="Test@$STAMP"

printf "${B}LauncherDesk backend test${N}\n  API:        %s\n  Test user:  %s\n  Payment sim: %s\n" "$API" "$USER_EMAIL" "$([ "$RUN_PAYMENT_SIM" = 1 ] && echo ON || echo off)"

# ─────────────────────────────────────────────────────────────────────────────
section "1. Server"
req GET /health;            expect "Health check" 200
req GET /payments/config;   expect "Payment config" 200 && [ "$(j .enabled)" = "true" ] && pass "Razorpay enabled" || fail "Razorpay not enabled (RAZORPAY_KEY_ID/SECRET missing?)"
req GET /does-not-exist;    expect "Unknown route returns 404" 404

# ─────────────────────────────────────────────────────────────────────────────
section "2. Registration + Email OTP"
req POST /auth/register "{\"name\":\"LD Test User\",\"email\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\",\"phone\":\"9876543210\"}"
if expect "Register new user" "200|201"; then
  TOKEN="$(j .token)"; USER_ID="$(j .user._id)"
  [ "$(j .user.emailVerified)" = "false" ] && pass "New user starts unverified" || fail "emailVerified should be false" "$BODY"
else
  printf "\n  ${R}Cannot continue without a test user — every later step needs its login.${N}\n"
  printf "  If this says 'Email already registered', use a TEST_EMAIL_BASE on your own domain.\n"
  exit 1
fi
req POST /auth/register "{\"name\":\"LD Test User\",\"email\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\"}"
expect "Duplicate registration rejected" "409|400"

req POST /auth/login "{\"email\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\"}"
expect "Login" 200 && TOKEN="$(j .token)"
req POST /auth/login "{\"email\":\"$USER_EMAIL\",\"password\":\"wrong-password\"}"
expect "Wrong password rejected" 401
req GET /auth/me "" "$TOKEN";   expect "GET /auth/me with token" 200
req GET /auth/me;               expect "GET /auth/me without token → 401" 401

req POST /auth/otp/send "" "$TOKEN"
expect "OTP resend inside cooldown is rate-limited" 429
req POST /auth/otp/verify '{"otp":"000000"}' "$TOKEN"
expect "Wrong OTP rejected" "400|429" && echo "      → $(j .message)"

if [ -t 0 ] && [ -n "$TEST_EMAIL_BASE" ]; then
  printf "  ${Y}?${N} Check %s for the 6-digit code (press Enter to skip): " "$USER_EMAIL"
  read -r OTP
  if [ -n "$OTP" ]; then
    req POST /auth/otp/verify "{\"otp\":\"$OTP\"}" "$TOKEN"
    expect "Correct OTP verifies email (welcome email should arrive)" 200
    req GET /auth/me "" "$TOKEN"
    [ "$(j '.user.emailVerified // .data.emailVerified')" = "true" ] && pass "User now verified" || skip "Verified flag in /me" "depends on /me response shape"
  else skip "Correct OTP" "no code entered"; fi
else
  skip "Correct OTP" "set TEST_EMAIL_BASE to a real inbox and run in a terminal"
fi

# Second user for permission tests
req POST /auth/register "{\"name\":\"LD Test Two\",\"email\":\"$USER2_EMAIL\",\"password\":\"$PASSWORD\"}"
TOKEN2="$(j .token)"

# ─────────────────────────────────────────────────────────────────────────────
section "3. Checkout (create order)"
req POST /payments/create-order "{\"amount\":$TEST_AMOUNT,\"serviceSlug\":\"msme-registration\",\"serviceTitle\":\"MSME / Udyam Registration (TEST)\"}" "$TOKEN"
if expect "Create Razorpay + LD order" 200; then
  RZP_ORDER="$(j .orderId)"; LD_ORDER="$(j .ldOrderId)"; ORDER_NO="$(j .orderNumber)"
  [[ "$ORDER_NO" =~ ^LD-[0-9]{4}-[0-9]{6}$ ]] && pass "Order ID format $ORDER_NO" || fail "Order number missing/invalid: $ORDER_NO" "$BODY"
fi
req POST /payments/create-order '{"amount":1}' "$TOKEN";              expect "create-order without serviceSlug rejected" 400
req POST /payments/create-order '{"amount":1,"serviceSlug":"x"}';     expect "create-order without login → 401" 401

req POST /payments/verify "{\"razorpay_order_id\":\"$RZP_ORDER\",\"razorpay_payment_id\":\"pay_fake\",\"razorpay_signature\":\"bad\"}" "$TOKEN"
expect "Verify with forged signature rejected" 400
req POST /payments/verify "{\"razorpay_order_id\":\"$RZP_ORDER\",\"razorpay_payment_id\":\"pay_fake\",\"razorpay_signature\":\"bad\"}" "$TOKEN2"
expect "Other user cannot verify this order" "403|400"

# ─────────────────────────────────────────────────────────────────────────────
section "4. Razorpay webhook"
WH_URL="$API/payments/webhook"
code="$(curl -s -o "$TMP/wh" -w '%{http_code}' -X POST "$WH_URL" -H 'Content-Type: application/json' -H 'x-razorpay-signature: invalid' --data '{"event":"payment.captured"}')"
CODE="$code"; BODY="$(cat "$TMP/wh")"; expect "Webhook with invalid signature rejected" 400

send_webhook() {  # $1 payload  $2 event id  → sets CODE BODY
  local sig; sig="$(printf '%s' "$1" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" | sed 's/^.* //')"
  CODE="$(curl -s -o "$TMP/wh" -w '%{http_code}' -X POST "$WH_URL" -H 'Content-Type: application/json' \
          -H "x-razorpay-signature: $sig" -H "x-razorpay-event-id: $2" --data "$1")"
  BODY="$(cat "$TMP/wh")"
}

PAID=0
if [ "$RUN_PAYMENT_SIM" = 1 ] && [ -n "$RAZORPAY_WEBHOOK_SECRET" ] && [ -n "$RZP_ORDER" ]; then
  PAY_ID="pay_LDTEST$STAMP"; EVT="evt_ldtest_$STAMP"
  PAYLOAD="{\"event\":\"payment.captured\",\"created_at\":$STAMP,\"payload\":{\"payment\":{\"entity\":{\"id\":\"$PAY_ID\",\"order_id\":\"$RZP_ORDER\",\"method\":\"upi\",\"amount\":$((TEST_AMOUNT*100))}}}}"
  send_webhook "$PAYLOAD" "$EVT";  expect "Signed payment.captured webhook accepted" 200 && PAID=1
  send_webhook "$PAYLOAD" "$EVT";  expect "Same webhook again (duplicate)" 200
  [ "$(j .duplicate)" = "true" ] && pass "Duplicate delivery detected — no second email" || fail "Duplicate webhook not detected" "$BODY"
  send_webhook "$PAYLOAD" "${EVT}_b"; expect "Same payment, new event id (idempotent processing)" 200
  sleep 4   # emails are queued asynchronously
else
  skip "Paid-order simulation" "set RUN_PAYMENT_SIM=1 and RAZORPAY_WEBHOOK_SECRET"
fi

# ─────────────────────────────────────────────────────────────────────────────
section "5. Customer dashboard"
req GET /user/dashboard "" "$TOKEN";        expect "Dashboard" 200
req GET /user/orders "" "$TOKEN";           expect "Orders list" 200
if [ -n "$LD_ORDER" ]; then
  req GET "/user/orders/$LD_ORDER" "" "$TOKEN"; expect "Order detail" 200
  [ $PAID = 1 ] && { [ "$(j .data.paymentStatus)" = "PAYMENT_SUCCESSFUL" ] && pass "Order marked PAYMENT_SUCCESSFUL" || fail "Order paymentStatus is $(j .data.paymentStatus)"; }
  req GET "/user/orders/$LD_ORDER" "" "$TOKEN2"; expect "Other user cannot see this order" 404
  req GET "/user/orders/$LD_ORDER/timeline" "" "$TOKEN"; expect "Order timeline" 200 && echo "      → $(j '[.timeline[].newStatus] | join(" → ")')"
  req GET "/user/orders/$LD_ORDER/documents" "" "$TOKEN"; expect "Order documents" 200
  DOC_ID="$(j '.required[0]._id // empty')"; DOC_COUNT="$(j '.required | length')"
  [ $PAID = 1 ] && { [ "${DOC_COUNT:-0}" -gt 0 ] && pass "Document checklist created ($DOC_COUNT docs)" || fail "No documents requested after payment"; }
fi

req GET /user/invoices "" "$TOKEN"; expect "Invoices list" 200
INV_ID="$(j '.data[0]._id // empty')"
if [ $PAID = 1 ]; then
  [ -n "$INV_ID" ] && pass "Invoice generated: $(j '.data[0].invoiceNumber') (taxable $(j '.data[0].taxableAmount') + GST $(j '.data[0].gstAmount'))" || fail "No invoice after payment"
fi
if [ -n "$INV_ID" ]; then
  code="$(curl -s -o "$TMP/inv.pdf" -w '%{http_code}' "$API/user/invoices/$INV_ID/pdf" -H "Authorization: Bearer $TOKEN")"
  [ "$code" = 200 ] && head -c 4 "$TMP/inv.pdf" | grep -q '%PDF' && pass "Invoice PDF downloads" || fail "Invoice PDF download ($code)"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$API/user/invoices/$INV_ID/pdf" -H "Authorization: Bearer $TOKEN2")"
  [ "$code" = 404 ] && pass "Other user cannot download this invoice [404]" || fail "Invoice visible to another user ($code)"
fi

# Document upload + submit
if [ -n "$DOC_ID" ]; then
  printf '%%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%%%EOF\n' > "$TMP/test.pdf"
  code="$(curl -s -o "$TMP/up" -w '%{http_code}' -X POST "$API/user/orders/$LD_ORDER/documents/$DOC_ID/upload" -H "Authorization: Bearer $TOKEN" -F "file=@$TMP/test.pdf;type=application/pdf")"
  CODE="$code"; BODY="$(cat "$TMP/up")"; expect "Upload document (PDF)" 200
  printf 'hello' > "$TMP/bad.exe"
  code="$(curl -s -o "$TMP/up" -w '%{http_code}' -X POST "$API/user/orders/$LD_ORDER/documents/$DOC_ID/upload" -H "Authorization: Bearer $TOKEN" -F "file=@$TMP/bad.exe;type=application/x-msdownload")"
  [ "$code" != 200 ] && pass "Disallowed file type rejected [$code]" || fail "Executable upload was accepted"
  req POST "/user/orders/$LD_ORDER/documents/submit" "" "$TOKEN"; expect "Submit documents (DOCUMENTS_RECEIVED email)" 200
  code="$(curl -s -o "$TMP/dl" -w '%{http_code}' "$API/user/orders/$LD_ORDER/documents/$DOC_ID/download" -H "Authorization: Bearer $TOKEN")"
  [ "$code" = 200 ] && pass "Owner can download own document" || fail "Document download ($code)"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$API/user/orders/$LD_ORDER/documents/$DOC_ID/download" -H "Authorization: Bearer $TOKEN2")"
  [ "$code" = 404 ] && pass "Other user cannot download it [404]" || fail "Document visible to another user ($code)"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/private_uploads/")"
  [ "$code" != 200 ] && pass "Private documents not publicly served [$code]" || fail "private_uploads is publicly reachable!"
else
  skip "Document upload" "no document checklist (needs payment simulation)"
fi

# Support tickets
req POST /user/tickets '{"subject":"Test ticket from script","message":"Please ignore — automated test."}' "$TOKEN"
if expect "Create support ticket (SUPPORT_CREATED email)" 201; then
  TICKET="$(j .data.ticketId)"
  [[ "$TICKET" =~ ^LD-TKT-[0-9]+$ ]] && pass "Ticket ID format $TICKET" || fail "Bad ticket id $TICKET"
fi
req GET /user/tickets "" "$TOKEN"; expect "List tickets" 200
[ -n "$TICKET" ] && { req POST "/user/tickets/$TICKET/messages" '{"message":"Follow-up from test"}' "$TOKEN"; expect "Customer reply on ticket" 200; }
[ -n "$TICKET" ] && { req GET "/user/tickets/$TICKET" "" "$TOKEN2"; expect "Other user cannot read ticket" 404; }

# ─────────────────────────────────────────────────────────────────────────────
section "6. Admin"
req GET /admin/ops/orders "" "$TOKEN"; expect "Customer blocked from admin API" 403
if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
  skip "Admin tests" "set ADMIN_EMAIL and ADMIN_PASSWORD"
else
  req POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
  if ! expect "Admin login" 200; then
    printf "      ${Y}→ Check ADMIN_EMAIL / ADMIN_PASSWORD are the real admin-panel login.${N}\n"
  else
    AT="$(j .token)"; [ "$(j .user.role)" = "admin" ] && pass "Role is admin" || fail "Logged-in user is not admin (role: $(j .user.role))"
    req GET "/admin/ops/orders?limit=5" "" "$AT";     expect "Admin: orders list" 200
    req GET /admin/ops/email-templates "" "$AT";      expect "Admin: email templates" 200 && echo "      → $(j '.data | length') templates"
    req POST /admin/ops/email-templates/PAYMENT_SUCCESS/preview '{}' "$AT"; expect "Admin: template preview" 200
    req GET /admin/ops/notification-settings "" "$AT"; expect "Admin: notification settings" 200
    req GET "/admin/ops/notifications?status=FAILED&limit=10" "" "$AT"; expect "Admin: failed emails list" 200
    FAILED_COUNT="$(j .total)"; [ "${FAILED_COUNT:-0}" = 0 ] && pass "No failed emails" || fail "$FAILED_COUNT failed email(s) — check reasons below" "$(echo "$BODY" | jq -r '.data[] | "\(.templateId): \(.failureReason)"' 2>/dev/null)"

    if [ -n "$LD_ORDER" ]; then
      req GET "/admin/ops/orders/$LD_ORDER" "" "$AT";   expect "Admin: order detail" 200
      req GET "/admin/ops/orders/$LD_ORDER/communications" "" "$AT"; expect "Admin: communication history" 200
      echo "$BODY" | jq -r '.data[] | "      → \(.templateId)  \(.status)\(if .failureReason then "  (" + .failureReason + ")" else "" end)"' 2>/dev/null
      if [ $PAID = 1 ]; then
        for t in PAYMENT_SUCCESS INVOICE_GENERATED DOCUMENTS_REQUIRED; do
          n="$(echo "$BODY" | jq "[.data[] | select(.templateId==\"$t\")] | length")"
          [ "$n" = 1 ] && pass "$t sent exactly once" || fail "$t count is $n (expected 1)"
        done
      fi
      req GET "/admin/ops/orders/$LD_ORDER/events" "" "$AT"; expect "Admin: audit log" 200

      if [ -n "$DOC_ID" ]; then
        req PATCH "/admin/ops/documents/$DOC_ID/review" '{"decision":"reject","reason":"Test: image unclear","correction":"Upload a clearer copy"}' "$AT"
        expect "Admin: reject document (DOCUMENT_CORRECTION email)" 200
        req PATCH "/admin/ops/documents/$DOC_ID/review" '{"decision":"approve"}' "$AT"; expect "Admin: approve document" 200
      fi
      req PATCH "/admin/ops/orders/$LD_ORDER/status" '{"status":"PROCESSING","note":"Automated test"}' "$AT"; expect "Admin: status → PROCESSING" 200
      req PATCH "/admin/ops/orders/$LD_ORDER/status" '{"status":"PROCESSING"}' "$AT"
      [ "$(j .changed)" = "false" ] && pass "Same status twice is a no-op (no duplicate email)" || fail "Repeated status change not ignored" "$BODY"
      req PATCH "/admin/ops/orders/$LD_ORDER/status" '{"status":"NOT_A_STATUS"}' "$AT"; expect "Admin: invalid status rejected" 400
      req POST "/admin/ops/orders/$LD_ORDER/action-required" '{"what":"Sign the declaration","why":"Required by the authority","how":"Download, sign and upload it","deadline":"2030-01-01"}' "$AT"
      expect "Admin: action required (ACTION_REQUIRED email)" 200
      req POST "/admin/ops/orders/$LD_ORDER/cancel" '{"reason":"Automated test order"}' "$AT"; expect "Admin: cancel test order (ORDER_CANCELLED email)" 200
    fi

    if [ -n "$TICKET" ]; then
      req POST "/admin/ops/tickets/$TICKET/reply" '{"message":"Internal note","internal":true}' "$AT"; expect "Admin: internal ticket note" 200
      req GET "/user/tickets/$TICKET" "" "$TOKEN"
      [ "$(echo "$BODY" | jq '[.data.messages[] | select(.body=="Internal note")] | length')" = 0 ] && pass "Internal note hidden from customer" || fail "Internal note visible to customer!"
      req POST "/admin/ops/tickets/$TICKET/reply" '{"message":"Thanks, this was a test."}' "$AT"; expect "Admin: public reply (SUPPORT_UPDATED email)" 200
      req PATCH "/admin/ops/tickets/$TICKET/status" '{"status":"RESOLVED"}' "$AT"; expect "Admin: resolve ticket (SUPPORT_RESOLVED email)" 200
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
section "Summary"
printf "  ${G}%d passed${N}   ${R}%d failed${N}   ${Y}%d skipped${N}\n" "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf "\n  ${R}Failed checks:${N}\n"; for f in "${FAILED[@]}"; do printf "   • %s\n" "$f"; done
fi
printf "\n  Test user: %s   Order: %s   Ticket: %s\n" "$USER_EMAIL" "${ORDER_NO:-—}" "${TICKET:-—}"
printf "  Check that inbox for the emails, and Railway → Logs for any [Notify] FAILED lines.\n"
[ "$FAIL" -eq 0 ]