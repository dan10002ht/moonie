#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 6 (Giai đoạn 4): Admin customers CRUD paginated
#   GET  /api/v1/admin/customers?limit&offset   (paginate, auth) -> {items,total}
#   POST /api/v1/admin/customers                (tạo)            -> 201 + id
#   GET  /api/v1/admin/customers/{id}           (chi tiết, nếu có)
#   PUT  /api/v1/admin/customers/{id}           (sửa)            -> 200
#
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#   (CẤM generator đọc/sửa file này — nó mã hóa hành vi DỰ ĐỊNH của Task 6,
#    KHÔNG phải hành vi hiện tại của implementation.)
#
# Black-box test. Derived ONLY from:
#   - plan Task 6 Held-out + Global Constraints
#     (docs/superpowers/plans/2026-07-17-giai-doan-4-admin-api.md):
#     * mọi /api/v1/admin/* qua middleware auth → thiếu/sai cookie = 401 JSON {error}
#     * Phân trang: {items:[...], total:n}; limit default 20 max 100; +offset;
#       sắp MỚI NHẤT TRƯỚC; total = tổng toàn bộ (KHÔNG phải theo trang)
#     * Validate phone/email/type
#   - SRS REQ-CUST-001: customer có tên, SĐT, email, công ty, địa chỉ,
#       loại (personal|business), ghi chú.
#   - migration 0006 (schema đã chốt): customers(name NOT NULL, phone, email,
#       company, address, type text NOT NULL check in ('personal','business'), note)
#   - tests/heldout/{auth,admin_products,admin_leads}_test.sh (login cookie mc_admin,
#       pattern boot + admin CRUD + phân trang + cleanup).
#   - run-moonie SKILL: admin seed admin@mooni.local / mooni-admin, cookie mc_admin.
# KHÔNG đọc bất kỳ implementation nào (api/internal/*, cmd/server/*, handlers).
#
# Assertions (all must pass; any failure => exit != 0):
#   1. GET /admin/customers KHÔNG cookie → 401 JSON {error}.
#   2. Phân trang: tạo ≥3 customer qua POST (name prefix 'heldout-cust-').
#      - GET ?limit=2&offset=0 (cookie) → 200, shape {items,total}; items ≤ 2;
#        total ≥ 3 (đếm TỔNG, không theo trang).
#      - MỚI NHẤT TRƯỚC: customer tạo sau đứng trước customer tạo trước.
#      - GET ?limit=2&offset=2 → trang khác, KHÔNG trùng item trang 1.
#   3. Tạo: POST {name,phone,email,company,address,type:'business',note} → 201 + id;
#      DB có bản ghi đúng field (name/phone/email/type).
#   4. Sửa: PUT /admin/customers/{id} đổi vài field → 200; DB cập nhật.
#   5. Validate: POST thiếu name → 400; type sai ('vip') → 400 (BẮT BUỘC cả hai).
#      email sai ('abc') → 400 và phone sai (chữ) → 400 = kiểm tra "mềm"
#      (chỉ FAIL nếu impl trả 201/5xx; nếu impl chưa validate → info, không fail).
#   6. POST /admin/customers KHÔNG cookie → 401.
#   7. Cleanup: DELETE customers name LIKE 'heldout-cust-%'.
#
# Nếu endpoint admin/customers chưa tồn tại (Task 6 chưa code) → exit 3 (báo rõ).
# Nếu schema Task 1 (customers) chưa có → exit 2.
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@mooni.local}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-mooni-admin}"

NAME_PREFIX="heldout-cust-"
LOG_FILE="/tmp/heldout-admin-customers-server.log"

FAILS=0
STARTED_SERVER_PID=""
WORKDIR="$(mktemp -d)"
COOKIE_JAR="$WORKDIR/cookies.txt"
RESP="$WORKDIR/resp.body"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

psql1() { psql "$DB_URL" -tA -c "$1" 2>/dev/null; }

cleanup() {
  info "cleanup: xóa customers name LIKE '${NAME_PREFIX}%'"
  # Customer heldout tạo mới KHÔNG gắn order (orders.customer_id nullable, không set)
  # nên không vướng FK. Best-effort: gỡ tham chiếu order nếu có rồi xóa.
  psql "$DB_URL" -tA -c "UPDATE orders SET customer_id=NULL WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '${NAME_PREFIX}%');" >/dev/null 2>&1 || true
  psql "$DB_URL" -tA -c "DELETE FROM customers WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" >/dev/null 2>&1 || true
  if [[ -n "$STARTED_SERVER_PID" ]]; then
    info "stop API server (pid $STARTED_SERVER_PID) mà test đã khởi động"
    kill "$STARTED_SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# POST /admin/customers với JSON body -> $RESP; echo HTTP code. (arg1 = body)
post_customer() {
  curl -s -o "$RESP" -w '%{http_code}' -b "$COOKIE_JAR" \
    -X POST -H 'Content-Type: application/json' --data "$1" \
    "$API_BASE/admin/customers"
}

# Tạo 1 customer heldout. arg1=suffix arg2=type. echo id (uuid) ra stdout.
create_customer() {
  local suffix="$1" ctype="${2:-personal}" name body code cid
  name="${NAME_PREFIX}${suffix}-$$-$(date +%s%N)"
  body="$(jq -nc --arg n "$name" --arg t "$ctype" \
    '{name:$n, phone:"0912345678", email:"held@mooni.local", company:"Cty Nguyệt Quang", address:"12 Đường Có Dấu, Quận 1", type:$t, note:"ghi chú tiếng Việt có dấu"}')"
  code="$(post_customer "$body")"
  if [[ "$code" != "201" ]]; then
    echo "ERR:$code:$(cat "$RESP")"
    return 1
  fi
  cid="$(jq -r '.id // empty' "$RESP" 2>/dev/null)"
  [[ -z "$cid" ]] && cid="$(psql1 "SELECT id FROM customers WHERE name='${name}';")"
  echo "$cid"
}

# ---------------------------------------------------------------------------
# 0. Boot infra (per run-moonie): postgres + migrate + seed. Idempotent.
# ---------------------------------------------------------------------------
echo "== Boot infra =="
( cd "$REPO_ROOT" && make up >/dev/null 2>&1 ) || true
for i in $(seq 1 30); do
  psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true
( cd "$REPO_ROOT" && make seed >/dev/null 2>&1 ) || true

# Schema customers (Task 1 / migration 0006) phải sẵn sàng.
if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.customers')" | grep -q customers; then
  echo "FATAL: bảng 'customers' chưa tồn tại — migration 0006 (Task 1 GĐ4) chưa áp."; exit 2
fi
for col in name phone email company address type note; do
  if ! psql "$DB_URL" -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='$col'" | grep -q 1; then
    echo "FATAL: cột 'customers.$col' chưa tồn tại — schema 0006 lệch với REQ-CUST-001."; exit 2
  fi
done
if ! psql "$DB_URL" -tAc "SELECT 1 FROM admin_users WHERE email='${ADMIN_EMAIL}'" | grep -q 1; then
  echo "FATAL: admin seed '${ADMIN_EMAIL}' không có — chạy 'make seed'."; exit 2
fi

# Dọn tàn dư test cũ.
psql "$DB_URL" -tA -c "UPDATE orders SET customer_id=NULL WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE '${NAME_PREFIX}%');" >/dev/null 2>&1 || true
psql "$DB_URL" -tA -c "DELETE FROM customers WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 1. Ensure API running (per run-moonie).
# ---------------------------------------------------------------------------
echo "== Ensure API running =="
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  info "API chưa chạy — khởi động 'go run ./cmd/server' (log -> $LOG_FILE)"
  : > "$LOG_FILE"
  ( cd "$REPO_ROOT/api" && set -a && . "$REPO_ROOT/.env" && set +a \
      && GOTOOLCHAIN=local go run ./cmd/server >"$LOG_FILE" 2>&1 ) &
  STARTED_SERVER_PID=$!
  for i in $(seq 1 60); do curl -fsS "$API_BASE/healthz" >/dev/null 2>&1 && break; sleep 1; done
fi
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  echo "FATAL: API không sống tại $API_BASE (xem $LOG_FILE)"; exit 2
fi

# ---------------------------------------------------------------------------
# Login lấy cookie mc_admin.
# ---------------------------------------------------------------------------
echo "== Login admin (lấy cookie mc_admin) =="
LOGIN_CODE="$(curl -s -o "$WORKDIR/login.b" -w '%{http_code}' -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' -X POST \
  --data "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\"}" \
  "$API_BASE/auth/login")"
if [[ "$LOGIN_CODE" == "404" ]]; then
  echo "STOP: POST /auth/login → 404 — auth (Task 2) chưa dựng. Không chấm được Task 6."; exit 3
fi
if [[ "$LOGIN_CODE" != "200" ]] || ! grep -q 'mc_admin' "$COOKIE_JAR" 2>/dev/null; then
  echo "FATAL: login admin thất bại (HTTP $LOGIN_CODE) — không lấy được cookie mc_admin. Body: $(cat "$WORKDIR/login.b")"; exit 2
fi
pass "login admin → 200 + cookie mc_admin"

# ---------------------------------------------------------------------------
# Pre-flight: endpoint admin/customers phải tồn tại. Với cookie hợp lệ mà 404
# => Task 6 chưa code route. (Không cookie luôn 401 do middleware → dùng cookie.)
# ---------------------------------------------------------------------------
PROBE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/customers?limit=1&offset=0")"
if [[ "$PROBE" == "404" ]]; then
  echo "STOP: GET /admin/customers (có cookie) → 404 — Task 6 chưa code endpoint. Không chấm được."; exit 3
fi

# ===========================================================================
# ASSERT 1 — GET /admin/customers KHÔNG cookie → 401 JSON {error}
# ===========================================================================
echo "== [1] GET /admin/customers (không cookie) → 401 =="
B1="$WORKDIR/a1.b"
C1="$(curl -s -o "$B1" -w '%{http_code}' "$API_BASE/admin/customers?limit=2&offset=0")"
if [[ "$C1" == "401" ]]; then pass "không cookie → 401"; else
  fail "không cookie → HTTP $C1 (kỳ vọng 401). Body: $(cat "$B1")"
fi
if jq -e '.error' "$B1" >/dev/null 2>&1; then pass "body có {error}"; else
  fail "body không có {error}. Body: $(cat "$B1")"
fi

# ===========================================================================
# Chuẩn bị data: tạo 3 customer để test phân trang (ghi nhận thứ tự tạo).
# ===========================================================================
echo "== Tạo 3 customer phân trang (POST /admin/customers) =="
declare -a CIDS=()
for k in 1 2 3; do
  cid="$(create_customer "pg${k}" "personal")"
  if [[ "$cid" == ERR:* || -z "$cid" ]]; then
    fail "tạo customer phân trang #$k thất bại: $cid"
  else
    CIDS+=("$cid")
    info "tạo customer #$k id=$cid"
  fi
  sleep 1
done
if [[ "${#CIDS[@]}" -lt 3 ]]; then
  echo "STOP: không tạo đủ 3 customer qua POST — không thể kiểm phân trang."
  echo "RESULT: FAIL"; exit 1
fi
# CIDS[0]=cũ nhất ... CIDS[2]=mới nhất
OLDEST="${CIDS[0]}"; MIDDLE="${CIDS[1]}"; NEWEST="${CIDS[2]}"

# ===========================================================================
# ASSERT 2 — phân trang {items,total}, mới nhất trước, trang 2 không trùng trang 1
# ===========================================================================
echo "== [2] Phân trang limit=2&offset=0 =="
C2="$(curl -s -o "$RESP" -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/customers?limit=2&offset=0")"
P1="$(cat "$RESP")"
if [[ "$C2" == "200" ]]; then pass "GET ?limit=2&offset=0 (cookie) → 200"; else
  fail "GET ?limit=2&offset=0 → HTTP $C2 (kỳ vọng 200). Body: $P1"
fi
if echo "$P1" | jq -e '(.items | type == "array") and (.total | type == "number")' >/dev/null 2>&1; then
  pass "response có shape {items:[...], total:number}"
else
  fail "response KHÔNG đúng shape {items,total}. Body: $P1"
fi
ITEMS1_LEN="$(echo "$P1" | jq -r '.items | length' 2>/dev/null || echo -1)"
TOTAL="$(echo "$P1" | jq -r '.total' 2>/dev/null || echo -1)"
if [[ "$ITEMS1_LEN" =~ ^[0-9]+$ && "$ITEMS1_LEN" -le 2 ]]; then
  pass "items ≤ limit (len=$ITEMS1_LEN ≤ 2)"
else
  fail "items vượt limit hoặc không đọc được (len=$ITEMS1_LEN, kỳ vọng ≤ 2)"
fi
if [[ "$TOTAL" =~ ^[0-9]+$ && "$TOTAL" -ge 3 ]]; then
  pass "total đếm tổng toàn bộ (total=$TOTAL ≥ 3 customer đã tạo)"
else
  fail "total sai — kỳ vọng ≥ 3 (đếm tổng, KHÔNG phải theo trang). total=$TOTAL"
fi
if ! echo "$P1" | jq -e '.items[0].id' >/dev/null 2>&1; then
  fail "items[].id không tồn tại — không kiểm được thứ tự. Body: $P1"
fi

# MỚI NHẤT TRƯỚC: lấy toàn bộ (limit=100) rồi so vị trí 3 customer heldout.
echo "== [2b] Mới nhất trước (so vị trí tương đối 3 customer heldout) =="
curl -s -b "$COOKIE_JAR" "$API_BASE/admin/customers?limit=100&offset=0" -o "$WORKDIR/all.b"
ORDERED_IDS="$(jq -r '.items[].id' "$WORKDIR/all.b" 2>/dev/null)"
idx_of() { echo "$ORDERED_IDS" | grep -nxF "$1" | head -1 | cut -d: -f1; }
IDX_NEW="$(idx_of "$NEWEST")"; IDX_MID="$(idx_of "$MIDDLE")"; IDX_OLD="$(idx_of "$OLDEST")"
if [[ -n "$IDX_NEW" && -n "$IDX_MID" && -n "$IDX_OLD" ]]; then
  if [[ "$IDX_NEW" -lt "$IDX_MID" && "$IDX_MID" -lt "$IDX_OLD" ]]; then
    pass "mới nhất trước: pos(newest=$IDX_NEW) < pos(middle=$IDX_MID) < pos(oldest=$IDX_OLD)"
  else
    fail "SAI thứ tự — kỳ vọng mới nhất trước. pos newest=$IDX_NEW middle=$IDX_MID oldest=$IDX_OLD"
  fi
else
  fail "không tìm thấy đủ 3 customer heldout trong list limit=100 (new=$IDX_NEW mid=$IDX_MID old=$IDX_OLD)"
fi

# Trang 2 (offset=2) không trùng trang 1.
echo "== [2c] Trang 2 (offset=2) không trùng trang 1 =="
curl -s -b "$COOKIE_JAR" "$API_BASE/admin/customers?limit=2&offset=2" -o "$WORKDIR/p2.b"
curl -s -b "$COOKIE_JAR" "$API_BASE/admin/customers?limit=2&offset=0" -o "$WORKDIR/p1.b"
IDS_P1="$(jq -r '.items[].id' "$WORKDIR/p1.b" 2>/dev/null | sort)"
IDS_P2="$(jq -r '.items[].id' "$WORKDIR/p2.b" 2>/dev/null | sort)"
OVERLAP="$(comm -12 <(echo "$IDS_P1") <(echo "$IDS_P2") 2>/dev/null | grep -c . || true)"
P2_LEN="$(jq -r '.items | length' "$WORKDIR/p2.b" 2>/dev/null || echo -1)"
if [[ "$P2_LEN" -ge 1 ]]; then
  if [[ "${OVERLAP:-0}" -eq 0 ]]; then
    pass "trang 2 (offset=2) không trùng item nào với trang 1 (offset hoạt động đúng)"
  else
    fail "trang 2 TRÙNG $OVERLAP item với trang 1 — offset phân trang sai."
  fi
else
  fail "trang 2 rỗng dù total≥3 — offset/limit phân trang sai (P2_LEN=$P2_LEN)"
fi

# ===========================================================================
# ASSERT 3 — POST tạo customer đầy đủ field type='business' → 201 + id; DB đúng.
# ===========================================================================
echo "== [3] POST /admin/customers tạo mới (type=business) =="
CNAME="${NAME_PREFIX}create-$$-$(date +%s%N)"
CBODY="$(jq -nc --arg n "$CNAME" \
  '{name:$n, phone:"0987654321", email:"create@mooni.local", company:"Bánh Nguyệt Quang", address:"99 Lê Lợi, Quận 1", type:"business", note:"khách VIP có dấu"}')"
C3="$(post_customer "$CBODY")"
B3="$(cat "$RESP")"
if [[ "$C3" == "201" ]]; then pass "POST create → 201"; else
  fail "POST create → HTTP $C3 (kỳ vọng 201). Body: $B3"
fi
NEW_ID="$(echo "$B3" | jq -r '.id // empty' 2>/dev/null)"
if [[ -n "$NEW_ID" ]]; then pass "response trả id ($NEW_ID)"; else
  fail "response không có id. Body: $B3"
fi
[[ -z "$NEW_ID" ]] && NEW_ID="$(psql1 "SELECT id FROM customers WHERE name='${CNAME}';")"
DB_ROW="$(psql1 "SELECT name||'|'||coalesce(phone,'<null>')||'|'||coalesce(email,'<null>')||'|'||type FROM customers WHERE name='${CNAME}';" | tr -d ' ')"
EXPECT="${CNAME}|0987654321|create@mooni.local|business"
EXPECT_NOSP="$(echo "$EXPECT" | tr -d ' ')"
if [[ "$DB_ROW" == "$EXPECT_NOSP" ]]; then
  pass "customer ghi vào DB đúng (name/phone/email/type=business)"
else
  fail "customer trong DB sai/không có: '$DB_ROW' (kỳ vọng '$EXPECT_NOSP')"
fi

# ===========================================================================
# ASSERT 4 — PUT sửa customer → 200; DB cập nhật.
# ===========================================================================
echo "== [4] PUT /admin/customers/{id} sửa vài field =="
UNAME="${CNAME}-edited"
UBODY="$(jq -nc --arg n "$UNAME" \
  '{name:$n, phone:"0900000000", email:"edited@mooni.local", company:"Cty Đã Sửa", address:"1 Nguyễn Huệ", type:"personal", note:"đã cập nhật"}')"
B4="$WORKDIR/a4.b"
C4="$(curl -s -o "$B4" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X PUT -H 'Content-Type: application/json' --data "$UBODY" \
  "$API_BASE/admin/customers/${NEW_ID}")"
if [[ "$C4" == "200" ]]; then pass "PUT update → 200"; else
  fail "PUT update → HTTP $C4 (kỳ vọng 200). Body: $(cat "$B4")"
fi
DB_UPD="$(psql1 "SELECT name||'|'||coalesce(phone,'<null>')||'|'||coalesce(email,'<null>')||'|'||type FROM customers WHERE id='${NEW_ID}';")"
EXPECT_UPD="${UNAME}|0900000000|edited@mooni.local|personal"
if [[ "$DB_UPD" == "$EXPECT_UPD" ]]; then
  pass "DB cập nhật đúng (name/phone/email/type=personal)"
else
  fail "DB sau update = '$DB_UPD' (kỳ vọng '$EXPECT_UPD') — PUT không cập nhật DB."
fi

# ===========================================================================
# ASSERT 5 — Validate POST.
#   BẮT BUỘC 400: thiếu name; type sai ('vip' không thuộc personal|business).
#   MỀM (chỉ fail nếu 201/5xx): email sai ('abc'); phone sai (chữ 'abcxyz').
# ===========================================================================
echo "== [5] Validate POST → 400 =="

# 5a: thiếu name → 400 (BẮT BUỘC)
NONAME_BODY='{"phone":"0912345678","email":"x@mooni.local","type":"personal","note":"no name"}'
C5A="$(post_customer "$NONAME_BODY")"
if [[ "$C5A" == "400" ]]; then pass "thiếu name → 400"; else
  fail "thiếu name → HTTP $C5A (kỳ vọng 400). Body: $(cat "$RESP")"
fi

# 5b: type sai 'vip' → 400 (BẮT BUỘC)
BADTYPE_NAME="${NAME_PREFIX}badtype-$$-$(date +%s%N)"
BADTYPE_BODY="$(jq -nc --arg n "$BADTYPE_NAME" '{name:$n, phone:"0912345678", email:"x@mooni.local", type:"vip", note:"bad type"}')"
C5B="$(post_customer "$BADTYPE_BODY")"
if [[ "$C5B" == "400" ]]; then pass "type='vip' (ngoài personal|business) → 400"; else
  fail "type='vip' → HTTP $C5B (kỳ vọng 400 — enum personal|business). Body: $(cat "$RESP")"
fi
BADTYPE_CNT="$(psql1 "SELECT count(*) FROM customers WHERE name='${BADTYPE_NAME}';")"
if [[ "$BADTYPE_CNT" == "0" ]]; then pass "type sai KHÔNG tạo bản ghi trong DB"; else
  fail "type sai tạo $BADTYPE_CNT bản ghi trong DB (không được phép)"
fi

# 5c: email sai 'abc' → 400 (MỀM: chỉ fail nếu impl trả 201/5xx)
BADEMAIL_NAME="${NAME_PREFIX}bademail-$$-$(date +%s%N)"
BADEMAIL_BODY="$(jq -nc --arg n "$BADEMAIL_NAME" '{name:$n, phone:"0912345678", email:"abc", type:"personal", note:"bad email"}')"
C5C="$(post_customer "$BADEMAIL_BODY")"
if [[ "$C5C" == "400" ]]; then
  pass "email='abc' sai định dạng → 400 (impl có validate email)"
elif [[ "$C5C" == "201" ]]; then
  info "email='abc' → 201 (impl KHÔNG validate email; plan yêu cầu validate email — khuyến nghị thêm, không tính FAIL cứng)"
  # dọn bản ghi lỡ tạo
  psql "$DB_URL" -tA -c "DELETE FROM customers WHERE name='${BADEMAIL_NAME}';" >/dev/null 2>&1 || true
else
  fail "email='abc' → HTTP $C5C (kỳ vọng 400 hoặc 201; 5xx/khác = lỗi xử lý). Body: $(cat "$RESP")"
fi

# 5d: phone sai (chữ) → 400 (MỀM: chỉ fail nếu impl trả 201/5xx)
BADPHONE_NAME="${NAME_PREFIX}badphone-$$-$(date +%s%N)"
BADPHONE_BODY="$(jq -nc --arg n "$BADPHONE_NAME" '{name:$n, phone:"abcxyz", email:"x@mooni.local", type:"personal", note:"bad phone"}')"
C5D="$(post_customer "$BADPHONE_BODY")"
if [[ "$C5D" == "400" ]]; then
  pass "phone='abcxyz' sai định dạng → 400 (impl có validate phone)"
elif [[ "$C5D" == "201" ]]; then
  info "phone='abcxyz' → 201 (impl KHÔNG validate phone; plan yêu cầu validate phone — khuyến nghị thêm, không tính FAIL cứng)"
  psql "$DB_URL" -tA -c "DELETE FROM customers WHERE name='${BADPHONE_NAME}';" >/dev/null 2>&1 || true
else
  fail "phone='abcxyz' → HTTP $C5D (kỳ vọng 400 hoặc 201; 5xx/khác = lỗi xử lý). Body: $(cat "$RESP")"
fi

# ===========================================================================
# ASSERT 6 — POST /admin/customers KHÔNG cookie → 401.
# ===========================================================================
echo "== [6] POST /admin/customers (không cookie) → 401 =="
NOAUTH_BODY="$(jq -nc '{name:"heldout-cust-noauth", phone:"0912345678", type:"personal"}')"
C6="$(curl -s -o "$RESP" -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' --data "$NOAUTH_BODY" \
  "$API_BASE/admin/customers")"
if [[ "$C6" == "401" ]]; then pass "POST không cookie → 401"; else
  fail "POST không cookie → HTTP $C6 (kỳ vọng 401). Body: $(cat "$RESP")"
fi
NOAUTH_CNT="$(psql1 "SELECT count(*) FROM customers WHERE name='heldout-cust-noauth';")"
if [[ "$NOAUTH_CNT" == "0" ]]; then pass "POST không cookie KHÔNG ghi DB"; else
  fail "POST không cookie VẪN ghi $NOAUTH_CNT bản ghi (middleware auth thủng)"
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
