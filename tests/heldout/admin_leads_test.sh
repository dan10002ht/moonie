#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 4 (Giai đoạn 4): Admin leads API
#   GET  /api/v1/admin/leads?limit&offset      (paginate, auth)
#   PATCH /api/v1/admin/leads/{id}             (đổi status)
#   POST /api/v1/admin/leads/{id}/convert      (lead → order)
#
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#   (CẤM generator đọc/sửa file này — nó mã hóa hành vi DỰ ĐỊNH của Task 4,
#    KHÔNG phải hành vi hiện tại của implementation.)
#
# Black-box test. Derived ONLY from:
#   - plan Task 4 Held-out + Global Constraints
#     (docs/superpowers/plans/2026-07-17-giai-doan-4-admin-api.md)
#   - SRS REQ-LEAD-003/004/005, spec §1 (convert KHÔNG tự tạo customer;
#     orders.customer_id nullable), spec §4 quản lý leads.
#   - api/openapi.yaml (contract) + tests/heldout/{auth,leads}_test.sh (login,
#     POST /leads public tạo lead).
#   - run-moonie SKILL: admin seed admin@mooni.local / mooni-admin, cookie mc_admin
# KHÔNG đọc bất kỳ implementation nào (api/internal/*, cmd/server/*).
#
# Ràng buộc đã chốt (Global Constraints + spec):
#   - Phân trang: {items:[...], total:n}; limit default 20 max 100; sắp MỚI NHẤT
#     TRƯỚC; total = tổng toàn bộ (không phải theo trang).
#   - Convert: tạo order từ tên/SĐT lead; set lead.status='converted' +
#     lead.order_id (FK trỏ order vừa tạo); KHÔNG tạo customer (customers không
#     tăng); order.customer_id nullable (gắn customer là bước thủ công tùy chọn).
#   - Lead status enum: new → contacted → converted | closed.
#
# Assertions (all must pass; any failure => exit != 0):
#   1. GET /admin/leads KHÔNG cookie → 401.
#   2. Phân trang: tạo ≥3 lead qua POST /api/v1/leads (public).
#      - GET ?limit=2&offset=0 (cookie) → 200, có {items,total}; items ≤ 2;
#        total ≥ số lead heldout đã tạo (đếm tổng).
#      - MỚI NHẤT TRƯỚC: lead tạo sau đứng trước lead tạo trước trong danh sách.
#      - GET ?limit=2&offset=2 → trang 2 KHÔNG trùng item với trang 1.
#   3. PATCH /admin/leads/{id} status 'contacted' → 200; DB lead.status='contacted'.
#   4. Convert: tạo 1 lead (heldout-lead-conv), POST convert → 200/201; kiểm DB:
#      (a) lead.status='converted';
#      (b) lead.order_id NOT NULL (trỏ order vừa tạo);
#      (c) tồn tại đúng order được lead trỏ tới (bản ghi liên kết trong orders);
#          [best-effort] SĐT lead xuất hiện đâu đó trong order row (impl-dependent);
#      (d) KHÔNG tạo customer mới (COUNT(customers) trước == sau).
#   5. POST convert KHÔNG cookie → 401.
#   6. PATCH status không hợp lệ ('xyz') → 400.
#
# Mọi lead test tạo ra đều có name bắt đầu 'heldout-lead-' và được dọn (EXIT trap):
#   xử lý FK leads.order_id ↔ orders: null order_id → xóa orders liên kết → xóa leads.
# Nếu endpoint admin/leads chưa tồn tại (Task 4 chưa code) → exit 3 (báo rõ).
# Nếu schema Task 1 (leads.order_id/orders/customers) chưa có → exit 2.
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@mooni.local}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-mooni-admin}"

NAME_PREFIX="heldout-lead-"
HAPPY_PHONE="0912345678"
CONV_PHONE="0987654321"
LOG_FILE="/tmp/heldout-admin-leads-server.log"

FAILS=0
STARTED_SERVER_PID=""
WORKDIR="$(mktemp -d)"
COOKIE_JAR="$WORKDIR/cookies.txt"
RESP="$WORKDIR/resp.body"
COOLDOWNS_USED=0
MAX_COOLDOWNS=3

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

psql1() { psql "$DB_URL" -tA -c "$1" 2>/dev/null; }

cleanup() {
  # --- Dọn dữ liệu test, xử lý FK leads.order_id -> orders ---
  info "cleanup: dọn lead + order heldout (xử lý FK leads.order_id ↔ orders)"
  # 1) Thu thập order id mà các lead heldout đang trỏ tới.
  local oids
  oids="$(psql "$DB_URL" -tA -c \
    "SELECT order_id FROM leads WHERE name LIKE '${NAME_PREFIX}%' AND order_id IS NOT NULL;" 2>/dev/null)"
  # 2) Gỡ FK: null order_id trên leads heldout để có thể xóa orders.
  psql "$DB_URL" -tA -c "UPDATE leads SET order_id=NULL WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true
  # 3) Xóa các order liên kết (order_items cascade theo schema). Chỉ xóa order do
  #    convert heldout tạo (đã thu ở bước 1) — KHÔNG đụng order khác.
  if [[ -n "$oids" ]]; then
    while IFS= read -r oid; do
      [[ -z "$oid" ]] && continue
      psql "$DB_URL" -tA -c "DELETE FROM orders WHERE id='${oid}';" >/dev/null 2>&1 || true
    done <<< "$oids"
  fi
  # 4) Xóa leads heldout.
  psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true

  rm -rf "$WORKDIR" >/dev/null 2>&1 || true
  if [[ -n "$STARTED_SERVER_PID" ]]; then
    info "stop API server (pid $STARTED_SERVER_PID) mà test đã khởi động"
    kill "$STARTED_SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# POST /leads public. body raw JSON -> $RESP; echo HTTP code. Tránh nhiễu rate
# limit khi tạo data chức năng: gặp 429 thì chờ 61s reset (bounded).
post_lead() {
  local body="$1" code
  code="$(curl -s -o "$RESP" -w '%{http_code}' -H 'Content-Type: application/json' \
    -X POST "$API_BASE/leads" --data "$body")"
  if [[ "$code" == "429" && "$COOLDOWNS_USED" -lt "$MAX_COOLDOWNS" ]]; then
    info "gặp 429 khi tạo lead — chờ 61s reset cửa sổ rate-limit rồi thử lại"
    COOLDOWNS_USED=$((COOLDOWNS_USED+1))
    sleep 61
    code="$(curl -s -o "$RESP" -w '%{http_code}' -H 'Content-Type: application/json' \
      -X POST "$API_BASE/leads" --data "$body")"
  fi
  echo "$code"
}

# Tạo 1 lead heldout với suffix $1, phone $2. echo lead id (uuid) ra stdout.
create_lead() {
  local suffix="$1" phone="$2" name body code lid
  name="${NAME_PREFIX}${suffix}-$$-$(date +%s%N)"
  body="$(jq -nc --arg n "$name" --arg p "$phone" \
    '{name:$n, phone:$p, message:"heldout convert probe — tiếng Việt có dấu", product_interest:"Nguyệt Quang"}')"
  code="$(post_lead "$body")"
  if [[ "$code" != "201" ]]; then
    echo "ERR:$code:$(cat "$RESP")"
    return 1
  fi
  lid="$(jq -r '.id // empty' "$RESP" 2>/dev/null)"
  echo "$lid"
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

# Schema Task 1 phải sẵn sàng.
for tbl in leads orders customers; do
  if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.$tbl')" | grep -q "$tbl"; then
    echo "FATAL: bảng '$tbl' chưa tồn tại — Task 1 (schema GĐ4) chưa áp."; exit 2
  fi
done
if ! psql "$DB_URL" -tAc \
  "SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='order_id'" | grep -q 1; then
  echo "FATAL: cột 'leads.order_id' chưa tồn tại — Task 1 chưa thêm FK lead→order."; exit 2
fi
if ! psql "$DB_URL" -tAc "SELECT 1 FROM admin_users WHERE email='${ADMIN_EMAIL}'" | grep -q 1; then
  echo "FATAL: admin seed '${ADMIN_EMAIL}' không có — chạy 'make seed'."; exit 2
fi

# Dọn tàn dư test cũ (an toàn FK).
OLD_OIDS="$(psql "$DB_URL" -tA -c "SELECT order_id FROM leads WHERE name LIKE '${NAME_PREFIX}%' AND order_id IS NOT NULL;" 2>/dev/null)"
psql "$DB_URL" -tA -c "UPDATE leads SET order_id=NULL WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true
while IFS= read -r oid; do [[ -n "$oid" ]] && psql "$DB_URL" -tA -c "DELETE FROM orders WHERE id='${oid}';" >/dev/null 2>&1; done <<< "$OLD_OIDS"
psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true

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
  echo "STOP: POST /auth/login → 404 — auth (Task 2) chưa dựng. Không chấm được Task 4."; exit 3
fi
if [[ "$LOGIN_CODE" != "200" ]] || ! grep -q 'mc_admin' "$COOKIE_JAR" 2>/dev/null; then
  echo "FATAL: login admin thất bại (HTTP $LOGIN_CODE) — không lấy được cookie mc_admin. Body: $(cat "$WORKDIR/login.b")"; exit 2
fi
pass "login admin → 200 + cookie mc_admin"

# ---------------------------------------------------------------------------
# Pre-flight: endpoint admin/leads phải tồn tại. Với cookie hợp lệ, route vắng
# → 404; route có → 200. (Không cookie luôn 401 do middleware, không phân biệt
# được route tồn tại hay không → dùng cookie để probe.)
# ---------------------------------------------------------------------------
PROBE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/leads?limit=1&offset=0")"
if [[ "$PROBE" == "404" ]]; then
  echo "STOP: GET /admin/leads (có cookie) → 404 — Task 4 chưa code endpoint. Không chấm được."; exit 3
fi

# ===========================================================================
# ASSERT 1 — GET /admin/leads KHÔNG cookie → 401
# ===========================================================================
echo "== [1] GET /admin/leads (không cookie) → 401 =="
C1="$(curl -s -o "$RESP" -w '%{http_code}' "$API_BASE/admin/leads?limit=2&offset=0")"
if [[ "$C1" == "401" ]]; then pass "GET /admin/leads không cookie → 401"; else
  fail "GET /admin/leads không cookie → HTTP $C1 (kỳ vọng 401). Body: $(cat "$RESP")"
fi

# ===========================================================================
# Chuẩn bị data: tạo 3 lead phân trang (ghi nhận thứ tự tạo), tách xa nhau chút
# để created_at khác nhau chắc chắn.
# ===========================================================================
echo "== Tạo 3 lead phân trang (POST /api/v1/leads public) =="
declare -a LIDS=()
for k in 1 2 3; do
  lid="$(create_lead "pg${k}" "$HAPPY_PHONE")"
  if [[ "$lid" == ERR:* || -z "$lid" ]]; then
    fail "tạo lead phân trang #$k thất bại: $lid"
  else
    LIDS+=("$lid")
    info "tạo lead #$k id=$lid"
  fi
  sleep 1
done
if [[ "${#LIDS[@]}" -lt 3 ]]; then
  echo "STOP: không tạo đủ 3 lead qua POST /leads — không thể kiểm phân trang."; 
  echo "RESULT: FAIL"; exit 1
fi
# LIDS[0]=cũ nhất ... LIDS[2]=mới nhất
OLDEST="${LIDS[0]}"; MIDDLE="${LIDS[1]}"; NEWEST="${LIDS[2]}"

# ===========================================================================
# ASSERT 2 — phân trang {items,total}, mới nhất trước, trang 2 không trùng trang 1
# ===========================================================================
echo "== [2] Phân trang limit=2&offset=0 =="
C2="$(curl -s -o "$RESP" -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/leads?limit=2&offset=0")"
P1="$(cat "$RESP")"
if [[ "$C2" == "200" ]]; then pass "GET ?limit=2&offset=0 (cookie) → 200"; else
  fail "GET ?limit=2&offset=0 → HTTP $C2 (kỳ vọng 200). Body: $P1"
fi
# shape {items:[...], total:n}
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
  pass "total đếm tổng toàn bộ (total=$TOTAL ≥ 3 lead đã tạo)"
else
  fail "total sai — kỳ vọng ≥ 3 (đếm tổng, KHÔNG phải theo trang). total=$TOTAL"
fi

# Items phải có id để so ordering.
if ! echo "$P1" | jq -e '.items[0].id' >/dev/null 2>&1; then
  fail "items[].id không tồn tại — không kiểm được thứ tự. Body: $P1"
fi

# MỚI NHẤT TRƯỚC: lấy danh sách id đã sắp của TẤT CẢ lead (limit=100) rồi so vị trí
# của 3 lead heldout: index(NEWEST) < index(MIDDLE) < index(OLDEST).
echo "== [2b] Mới nhất trước (so vị trí tương đối 3 lead heldout) =="
curl -s -b "$COOKIE_JAR" "$API_BASE/admin/leads?limit=100&offset=0" -o "$WORKDIR/all.b"
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
  fail "không tìm thấy đủ 3 lead heldout trong list limit=100 (new=$IDX_NEW mid=$IDX_MID old=$IDX_OLD)"
fi

# Trang 2 không trùng trang 1.
echo "== [2c] Trang 2 (offset=2) không trùng trang 1 =="
curl -s -b "$COOKIE_JAR" "$API_BASE/admin/leads?limit=2&offset=2" -o "$WORKDIR/p2.b"
# đọc lại trang 1 cho chắc
curl -s -b "$COOKIE_JAR" "$API_BASE/admin/leads?limit=2&offset=0" -o "$WORKDIR/p1.b"
IDS_P1="$(jq -r '.items[].id' "$WORKDIR/p1.b" 2>/dev/null | sort)"
IDS_P2="$(jq -r '.items[].id' "$WORKDIR/p2.b" 2>/dev/null | sort)"
OVERLAP="$(comm -12 <(echo "$IDS_P1") <(echo "$IDS_P2") 2>/dev/null | grep -c . || true)"
P2_LEN="$(jq -r '.items | length' "$WORKDIR/p2.b" 2>/dev/null || echo -1)"
if [[ "$P2_LEN" -ge 1 ]]; then
  if [[ "${OVERLAP:-0}" -eq 0 ]]; then
    pass "trang 2 (offset=2) không trùng item nào với trang 1 (offset không hoạt động sai)"
  else
    fail "trang 2 TRÙNG $OVERLAP item với trang 1 — offset phân trang sai."
  fi
else
  fail "trang 2 rỗng dù total≥3 — offset/limit phân trang sai (P2_LEN=$P2_LEN)"
fi

# ===========================================================================
# ASSERT 3 — PATCH status 'contacted' → 200 + DB
# ===========================================================================
echo "== [3] PATCH /admin/leads/{id} status='contacted' =="
C3="$(curl -s -o "$RESP" -w '%{http_code}' -b "$COOKIE_JAR" -X PATCH \
  -H 'Content-Type: application/json' --data '{"status":"contacted"}' \
  "$API_BASE/admin/leads/${OLDEST}")"
if [[ "$C3" == "200" ]]; then pass "PATCH status → 200"; else
  fail "PATCH status → HTTP $C3 (kỳ vọng 200). Body: $(cat "$RESP")"
fi
DB_ST="$(psql1 "SELECT status FROM leads WHERE id='${OLDEST}';")"
if [[ "$DB_ST" == "contacted" ]]; then
  pass "DB lead.status='contacted' (ghi thật vào DB)"
else
  fail "DB lead.status='$DB_ST' (kỳ vọng 'contacted') — PATCH không cập nhật DB."
fi

# ===========================================================================
# ASSERT 4 — Convert: tạo order, set converted + order_id, KHÔNG tạo customer
# ===========================================================================
echo "== [4] Convert lead → order =="
CUST_BEFORE="$(psql1 "SELECT count(*) FROM customers;")"
CONV_LID="$(create_lead "conv" "$CONV_PHONE")"
if [[ "$CONV_LID" == ERR:* || -z "$CONV_LID" ]]; then
  fail "tạo lead convert thất bại: $CONV_LID"
else
  C4="$(curl -s -o "$RESP" -w '%{http_code}' -b "$COOKIE_JAR" -X POST \
    "$API_BASE/admin/leads/${CONV_LID}/convert")"
  if [[ "$C4" == "200" || "$C4" == "201" ]]; then
    pass "POST convert → HTTP $C4 (200/201)"
  else
    fail "POST convert → HTTP $C4 (kỳ vọng 200/201). Body: $(cat "$RESP")"
  fi

  # (a) lead.status='converted'
  CONV_ST="$(psql1 "SELECT status FROM leads WHERE id='${CONV_LID}';")"
  if [[ "$CONV_ST" == "converted" ]]; then
    pass "(a) DB lead.status='converted'"
  else
    fail "(a) DB lead.status='$CONV_ST' (kỳ vọng 'converted')"
  fi

  # (b) lead.order_id NOT NULL
  CONV_OID="$(psql1 "SELECT order_id FROM leads WHERE id='${CONV_LID}';")"
  if [[ -n "$CONV_OID" ]]; then
    pass "(b) DB lead.order_id NOT NULL ($CONV_OID)"
  else
    fail "(b) DB lead.order_id NULL — convert không gắn FK order vào lead."
  fi

  # (c) order được trỏ tới thực sự tồn tại (bản ghi liên kết trong orders)
  if [[ -n "$CONV_OID" ]]; then
    ORD_ROW="$(psql "$DB_URL" -tA -c "SELECT row_to_json(o) FROM orders o WHERE o.id='${CONV_OID}';" 2>/dev/null)"
    if [[ -n "$ORD_ROW" ]]; then
      pass "(c) tồn tại order liên kết trong bảng orders (id=$CONV_OID)"
      # best-effort: SĐT lead xuất hiện đâu đó trong order row (impl-dependent
      # vì orders không có cột phone; có thể lưu ở note). KHÔNG tính FAIL.
      if echo "$ORD_ROW" | grep -Fq "$CONV_PHONE"; then
        info "(c+) [best-effort] SĐT lead có mặt trong order row (thông tin lead được mang sang)"
      else
        info "(c+) [best-effort] không thấy SĐT lead trong order row — impl có thể không snapshot contact vào order (không tính FAIL)"
      fi
    else
      fail "(c) lead.order_id trỏ tới order KHÔNG tồn tại (id=$CONV_OID) — FK/transaction hỏng."
    fi
  fi

  # (d) KHÔNG tạo customer mới
  CUST_AFTER="$(psql1 "SELECT count(*) FROM customers;")"
  if [[ "$CUST_BEFORE" == "$CUST_AFTER" ]]; then
    pass "(d) convert KHÔNG tạo customer (customers: $CUST_BEFORE == $CUST_AFTER)"
  else
    fail "(d) convert TẠO customer mới (customers: $CUST_BEFORE -> $CUST_AFTER) — vi phạm spec §1 (không tự tạo customer)."
  fi
  # order convert phải có customer_id NULL (không gắn customer)
  if [[ -n "$CONV_OID" ]]; then
    OCID="$(psql1 "SELECT COALESCE(customer_id::text,'') FROM orders WHERE id='${CONV_OID}';")"
    if [[ -z "$OCID" ]]; then
      pass "(d+) order convert có customer_id NULL (gắn customer là bước thủ công)"
    else
      fail "(d+) order convert có customer_id='$OCID' (kỳ vọng NULL — convert không gắn/tạo customer)"
    fi
  fi
fi

# ===========================================================================
# ASSERT 5 — POST convert KHÔNG cookie → 401
# ===========================================================================
echo "== [5] POST convert (không cookie) → 401 =="
TARGET_FOR_NOAUTH="${CONV_LID:-$OLDEST}"
C5="$(curl -s -o "$RESP" -w '%{http_code}' -X POST "$API_BASE/admin/leads/${TARGET_FOR_NOAUTH}/convert")"
if [[ "$C5" == "401" ]]; then pass "POST convert không cookie → 401"; else
  fail "POST convert không cookie → HTTP $C5 (kỳ vọng 401). Body: $(cat "$RESP")"
fi

# ===========================================================================
# ASSERT 6 — PATCH status không hợp lệ ('xyz') → 400
# ===========================================================================
echo "== [6] PATCH status không hợp lệ ('xyz') → 400 =="
C6="$(curl -s -o "$RESP" -w '%{http_code}' -b "$COOKIE_JAR" -X PATCH \
  -H 'Content-Type: application/json' --data '{"status":"xyz"}' \
  "$API_BASE/admin/leads/${MIDDLE}")"
if [[ "$C6" == "400" ]]; then
  pass "PATCH status='xyz' → 400 (validate enum lead status)"
else
  fail "PATCH status='xyz' → HTTP $C6 (kỳ vọng 400 — enum new/contacted/converted/closed). Body: $(cat "$RESP")"
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
