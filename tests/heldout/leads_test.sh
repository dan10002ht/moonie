#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 2 (Giai đoạn 2): POST /api/v1/leads
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#   (CẤM generator đọc/sửa file này — nó mã hóa hành vi DỰ ĐỊNH, không phải
#    hành vi hiện tại của implementation.)
#
# Black-box test. Derived ONLY from:
#   - plan Task 2 Held-out criteria (2026-07-17-giai-doan-2-api-public.md)
#   - SRS REQ-LEAD-001 (validate + rate limit), REQ-LEAD-002 (lưu DB),
#     REQ-LEAD-003 (status='new'), NFR-004 (validate boundary),
#     NFR-006 (error JSON {error}), NFR-009 (không log SĐT quá 4 số cuối)
#   - api/openapi.yaml contract dự kiến (POST /leads → LeadInput/LeadCreated{id})
# It reads NO implementation (handlers/store/main/validate). Boot per run-moonie.
#
# Assertions (tất cả phải PASS; rớt bất kỳ => exit != 0):
#   1. POST body hợp lệ (name + phone VN hợp lệ + message + product_interest)
#      -> HTTP 201, response có id (uuid), DB có bản ghi status='new',
#         name & phone khớp.
#   2. Thiếu name (chỉ phone) -> 400 JSON {error}.
#   3. Thiếu phone -> 400 JSON {error}.
#   4. Phone sai định dạng (chữ "abc123" / quá ngắn "0912") -> 400.
#   5. Message quá dài (>1000 ký tự) -> 400.
#   6. Rate limit: bắn nhiều POST liên tiếp cùng 1 IP -> có >=1 lần 429.
#   7. NFR-009: log server KHÔNG chứa full SĐT (10 số), chỉ tối đa 4 số cuối
#      (best-effort — chỉ kiểm được khi test tự khởi động server).
#
# Mọi lead test tạo ra đều có name bắt đầu 'heldout-test-' và được xóa (EXIT trap).
# Nếu bảng 'leads' chưa tồn tại (migration 0003 chưa áp) => exit 2.
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME_PREFIX="heldout-test-"
LOG_FILE="/tmp/heldout-leads-server.log"

# SĐT VN hợp lệ dùng cho happy-path + kiểm log (091x = Vinaphone).
HAPPY_PHONE="0912345678"
HAPPY_NAME="${NAME_PREFIX}happy-$$-$(date +%s)"

FAILS=0
STARTED_SERVER_PID=""
RESP_BODY_FILE="$(mktemp)"
COOLDOWNS_USED=0
MAX_COOLDOWNS=3

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

psql_do() { psql "$DB_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }

cleanup() {
  info "cleanup: xóa lead test (name LIKE '${NAME_PREFIX}%')"
  psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true
  rm -f "$RESP_BODY_FILE" 2>/dev/null || true
  if [[ -n "$STARTED_SERVER_PID" ]]; then
    info "stop API server (pid $STARTED_SERVER_PID) mà test đã khởi động"
    kill "$STARTED_SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# POST /leads với body $1 (raw JSON). Ghi body -> $RESP_BODY_FILE, echo HTTP code.
post_leads() {
  curl -s -o "$RESP_BODY_FILE" -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -X POST "$API_BASE/leads" --data "$1"
}

# Như post_leads nhưng dành cho test CHỨC NĂNG (không kỳ vọng 429). Nếu dính
# 429 do rate-limit window, chờ 61s reset rồi thử lại (bounded MAX_COOLDOWNS)
# để test chức năng không bị nhiễu bởi ngưỡng rate limit generator chọn.
post_leads_nolimit() {
  local body="$1" code
  code="$(post_leads "$body")"
  if [[ "$code" == "429" && "$COOLDOWNS_USED" -lt "$MAX_COOLDOWNS" ]]; then
    info "gặp 429 giữa test chức năng — chờ 61s reset cửa sổ rate-limit rồi thử lại"
    COOLDOWNS_USED=$((COOLDOWNS_USED+1))
    sleep 61
    code="$(post_leads "$body")"
  fi
  echo "$code"
}

# ---------------------------------------------------------------------------
# 0. Boot infra (per run-moonie): postgres + migrate. Idempotent.
# ---------------------------------------------------------------------------
echo "== Boot infra =="
( cd "$REPO_ROOT" && make up >/dev/null 2>&1 ) || true
for i in $(seq 1 30); do
  if psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true

# Bảng leads phải tồn tại (Task 2 tạo migration 0003_leads). Nếu chưa => exit 2.
if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.leads')" | grep -q leads; then
  echo "FATAL: bảng 'leads' chưa tồn tại — migration 0003 chưa áp."
  exit 2
fi

# Dọn tàn dư test cũ trước khi chạy để đếm chính xác.
psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 1. Ensure API is up (per run-moonie). If not, start it in background so we
#    OWN its log file (needed for NFR-009 log assertion).
# ---------------------------------------------------------------------------
echo "== Ensure API running =="
OWN_LOG=false
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  info "API chưa chạy — khởi động 'go run ./cmd/server' (log -> $LOG_FILE)"
  : > "$LOG_FILE"
  ( cd "$REPO_ROOT/api" && set -a && . "$REPO_ROOT/.env" && set +a \
      && GOTOOLCHAIN=local go run ./cmd/server >"$LOG_FILE" 2>&1 ) &
  STARTED_SERVER_PID=$!
  OWN_LOG=true
  for i in $(seq 1 60); do
    if curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  echo "FATAL: API không sống tại $API_BASE (xem $LOG_FILE)"; exit 2
fi

# ===========================================================================
# ASSERT 1 — happy path 201 + DB status='new'
# ===========================================================================
echo "== Assert 1: POST /leads hợp lệ -> 201 + lưu DB =="
BODY1="$(jq -nc \
  --arg name "$HAPPY_NAME" \
  --arg phone "$HAPPY_PHONE" \
  --arg msg "Cho mình hỏi hộp quà Trung thu — tiếng Việt có dấu ăn được không?" \
  --arg pi "Nguyệt Quang Kim" \
  '{name:$name, phone:$phone, message:$msg, product_interest:$pi}')"
CODE1="$(post_leads_nolimit "$BODY1")"
BODY1_RESP="$(cat "$RESP_BODY_FILE")"

if [[ "$CODE1" == "201" ]]; then
  pass "HTTP 201 cho body hợp lệ"
else
  fail "HTTP = $CODE1 (kỳ vọng 201). Resp: $BODY1_RESP"
fi

# response có id (uuid)
LEAD_ID="$(echo "$BODY1_RESP" | jq -r '.id // empty' 2>/dev/null)"
if [[ -n "$LEAD_ID" ]] && echo "$LEAD_ID" | grep -Eiq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
  pass "response có id dạng uuid: $LEAD_ID"
else
  fail "response KHÔNG có id uuid hợp lệ. Resp: $BODY1_RESP"
fi

# DB: bản ghi thật, status='new', name & phone khớp
DBROW="$(psql "$DB_URL" -tA -F '|' -c \
  "SELECT status, name, phone FROM leads WHERE name = '$HAPPY_NAME' ORDER BY created_at DESC LIMIT 1;" 2>/dev/null)"
if [[ -n "$DBROW" ]]; then
  DB_STATUS="${DBROW%%|*}"
  DB_REST="${DBROW#*|}"
  DB_NAME="${DB_REST%%|*}"
  DB_PHONE="${DB_REST#*|}"
  pass "tìm thấy bản ghi lead trong DB (status=$DB_STATUS, phone=****${DB_PHONE: -4})"
  [[ "$DB_STATUS" == "new" ]] && pass "DB status = 'new'" || fail "DB status = '$DB_STATUS' (kỳ vọng 'new')"
  [[ "$DB_NAME" == "$HAPPY_NAME" ]] && pass "DB name khớp" || fail "DB name = '$DB_NAME' (kỳ vọng '$HAPPY_NAME')"
  [[ "$DB_PHONE" == "$HAPPY_PHONE" ]] && pass "DB phone khớp" || fail "DB phone không khớp (được ****${DB_PHONE: -4})"
else
  fail "KHÔNG tìm thấy bản ghi lead name='$HAPPY_NAME' trong DB (lead không được lưu)"
fi

# ===========================================================================
# ASSERT 2 — thiếu name -> 400 {error}
# ===========================================================================
echo "== Assert 2: thiếu name -> 400 =="
BODY2="$(jq -nc --arg phone "$HAPPY_PHONE" '{phone:$phone}')"
CODE2="$(post_leads_nolimit "$BODY2")"
RESP2="$(cat "$RESP_BODY_FILE")"
if [[ "$CODE2" == "400" ]]; then
  pass "HTTP 400 khi thiếu name"
else
  fail "HTTP = $CODE2 (kỳ vọng 400) khi thiếu name. Resp: $RESP2"
fi
if echo "$RESP2" | jq -e '.error | type == "string"' >/dev/null 2>&1; then
  pass "body lỗi có JSON {error} (thiếu name)"
else
  fail "body lỗi KHÔNG có {error} string. Resp: $RESP2"
fi

# ===========================================================================
# ASSERT 3 — thiếu phone -> 400 {error}
# ===========================================================================
echo "== Assert 3: thiếu phone -> 400 =="
BODY3="$(jq -nc --arg name "${NAME_PREFIX}nophone" '{name:$name}')"
CODE3="$(post_leads_nolimit "$BODY3")"
RESP3="$(cat "$RESP_BODY_FILE")"
if [[ "$CODE3" == "400" ]]; then
  pass "HTTP 400 khi thiếu phone"
else
  fail "HTTP = $CODE3 (kỳ vọng 400) khi thiếu phone. Resp: $RESP3"
fi
echo "$RESP3" | jq -e '.error | type == "string"' >/dev/null 2>&1 \
  && pass "body lỗi có {error} (thiếu phone)" \
  || fail "body lỗi KHÔNG có {error}. Resp: $RESP3"

# ===========================================================================
# ASSERT 4 — phone sai định dạng -> 400
# ===========================================================================
echo "== Assert 4: phone sai định dạng -> 400 =="
# 4a: có chữ
BODY4A="$(jq -nc --arg name "${NAME_PREFIX}badphone-a" --arg phone "abc123" '{name:$name, phone:$phone}')"
CODE4A="$(post_leads_nolimit "$BODY4A")"
RESP4A="$(cat "$RESP_BODY_FILE")"
[[ "$CODE4A" == "400" ]] \
  && pass "HTTP 400 khi phone chứa chữ ('abc123')" \
  || fail "HTTP = $CODE4A (kỳ vọng 400) khi phone='abc123'. Resp: $RESP4A"

# 4b: quá ngắn
BODY4B="$(jq -nc --arg name "${NAME_PREFIX}badphone-b" --arg phone "0912" '{name:$name, phone:$phone}')"
CODE4B="$(post_leads_nolimit "$BODY4B")"
RESP4B="$(cat "$RESP_BODY_FILE")"
[[ "$CODE4B" == "400" ]] \
  && pass "HTTP 400 khi phone quá ngắn ('0912')" \
  || fail "HTTP = $CODE4B (kỳ vọng 400) khi phone='0912'. Resp: $RESP4B"

# ===========================================================================
# ASSERT 5 — message quá dài (>1000) -> 400
# ===========================================================================
echo "== Assert 5: message > 1000 ký tự -> 400 =="
LONGMSG="$(head -c 1001 </dev/zero | tr '\0' 'a')"
BODY5="$(jq -nc --arg name "${NAME_PREFIX}longmsg" --arg phone "$HAPPY_PHONE" --arg msg "$LONGMSG" \
  '{name:$name, phone:$phone, message:$msg}')"
CODE5="$(post_leads_nolimit "$BODY5")"
RESP5="$(cat "$RESP_BODY_FILE")"
[[ "$CODE5" == "400" ]] \
  && pass "HTTP 400 khi message 1001 ký tự" \
  || fail "HTTP = $CODE5 (kỳ vọng 400) khi message quá dài. Resp: $RESP5"

# ===========================================================================
# ASSERT 6 — rate limit: bắn nhiều POST liên tiếp -> có >=1 lần 429
# (ngưỡng cụ thể do generator chọn; bắn đủ nhiều để vượt ngưỡng hợp lý)
# ===========================================================================
echo "== Assert 6: rate limit -> có 429 =="
BURST=60
GOT_429=0
BURST_BODY="$(jq -nc --arg name "${NAME_PREFIX}rl" --arg phone "$HAPPY_PHONE" \
  '{name:$name, phone:$phone, message:"rate limit probe", product_interest:"probe"}')"
for i in $(seq 1 "$BURST"); do
  c="$(post_leads "$BURST_BODY")"
  if [[ "$c" == "429" ]]; then GOT_429=$((GOT_429+1)); fi
done
info "trong $BURST request liên tiếp: số lần 429 = $GOT_429"
if [[ "$GOT_429" -ge 1 ]]; then
  pass "rate limit tồn tại: có $GOT_429 lần 429 trong $BURST request"
else
  fail "KHÔNG có 429 nào trong $BURST request liên tiếp — rate limit không hoạt động"
fi

# ===========================================================================
# ASSERT 7 — NFR-009: log KHÔNG chứa full SĐT (best-effort)
# ===========================================================================
echo "== Assert 7: NFR-009 log không lộ full SĐT (best-effort) =="
if [[ "$OWN_LOG" == "true" && -f "$LOG_FILE" ]]; then
  if grep -Fq "$HAPPY_PHONE" "$LOG_FILE"; then
    fail "log server CHỨA full SĐT '$HAPPY_PHONE' — vi phạm NFR-009 (chỉ được 4 số cuối). Dòng: $(grep -Fn "$HAPPY_PHONE" "$LOG_FILE" | head -3)"
  else
    pass "log server KHÔNG chứa full SĐT (10 số) — chỉ tối đa 4 số cuối"
  fi
else
  info "SKIP (best-effort): API do tiến trình khác khởi động, không truy cập được log của nó."
  info "  Để kiểm NFR-009, chạy test này khi API CHƯA chạy (test sẽ tự start + bắt log)."
fi

# ---------------------------------------------------------------------------
echo ""
if [[ "$FAILS" -eq 0 ]]; then
  echo "RESULT: PASS (tất cả assert đạt)"
  exit 0
else
  echo "RESULT: FAIL ($FAILS assert rớt)"
  exit 1
fi
