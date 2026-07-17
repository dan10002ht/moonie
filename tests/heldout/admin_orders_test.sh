#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 5 (Giai đoạn 4): Admin orders
#   POST   /api/v1/admin/orders            (tạo nhập tay: transaction + snapshot)
#   GET    /api/v1/admin/orders?limit&offset  (paginate {items,total}, mới nhất trước)
#   GET    /api/v1/admin/orders/{id}        (chi tiết + items)
#   PATCH  /api/v1/admin/orders/{id}        (đổi status theo chuỗi hợp lệ)
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#
# Black-box test. Derived ONLY from:
#   - plan Task 5 Held-out + Global Constraints (transaction order+items atomic;
#     snapshot product_name+unit_price; status new→confirmed→delivering→done|cancelled;
#     phân trang {items,total} mới nhất trước; Telegram notify đơn mới fail-safe;
#     mọi /api/v1/admin/* qua middleware auth → 401; error JSON {error})
#   - SRS REQ-ORD-001/002/003/004, REQ-NOTI-002
#   - schema live: orders(code,customer_id?,channel,status,subtotal,discount,total,
#     delivery_date,delivery_address,note); order_items(order_id,product_id?,
#     product_name,unit_price,quantity) — order_items FK ON DELETE CASCADE.
#   - run-moonie SKILL (boot; admin admin@mooni.local / mooni-admin)
# It does NOT read any implementation (api/internal/*, handlers, main).
#
# GHI CHÚ KỸ THUẬT (cách các assert khó được kiểm):
#  * Product thật: query 1 product status='available' từ DB (seed), lấy id + price
#    (PRICE_ORIG). Đơn dùng product seed thật → KHÔNG bao giờ xóa product seed.
#  * Snapshot giá (assert 3): sau khi tạo đơn → UPDATE products.price (psql) sang
#    giá KHÁC → GET /admin/orders/{id}: unit_price của item PHẢI vẫn = PRICE_ORIG.
#    Đối chứng thêm bằng order_items trong DB. Cleanup KHÔI PHỤC price = PRICE_ORIG.
#  * Transaction rollback (assert 4): POST items = [1 product hợp lệ + 1 uuid random
#    KHÔNG tồn tại]. Đếm COUNT(*) orders trước/sau → PHẢI bằng nhau (rollback toàn bộ,
#    không tạo order một phần). Response 400/404.
#  * Marker cô lập + cleanup: mọi đơn test đặt note = 'heldout-order-<SUF>'. Cleanup:
#    DELETE FROM orders WHERE note LIKE 'heldout-order-%' (order_items cascade) —
#    dọn sạch kể cả đơn lỡ không lấy được id.
#  * Telegram (assert 7): best-effort — chỉ grep server log tìm dấu hiệu notify đơn
#    mới; KHÔNG fail nếu không quan sát được (fail-safe).
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
API_HOST="${API_BASE%/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUF="$(date +%s)$$"
NOTE_PREFIX="heldout-order-"
NOTE_MARK="${NOTE_PREFIX}${SUF}"
SERVER_LOG="/tmp/heldout-adminorders-server.log"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@mooni.local}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-mooni-admin}"

FAILS=0
STARTED_SERVER_PID=""
WORKDIR="$(mktemp -d)"
COOKIE_JAR="$WORKDIR/cookies.txt"
PROD_ID=""; PRICE_ORIG=""; PROD_NAME=""; PRICE_RESTORE_NEEDED="no"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

psql_do() { psql "$DB_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }
psql_q()  { psql "$DB_URL" -tAc "$1" 2>/dev/null | tr -d ' '; }

cleanup() {
  # KHÔI PHỤC giá product seed nếu đã đổi ở assert 3 (BẮT BUỘC).
  if [[ "$PRICE_RESTORE_NEEDED" == "yes" && -n "$PROD_ID" && -n "$PRICE_ORIG" ]]; then
    info "cleanup: KHÔI PHỤC product ${PROD_ID} price → ${PRICE_ORIG}"
    psql "$DB_URL" -tAc "UPDATE products SET price=${PRICE_ORIG} WHERE id='${PROD_ID}';" >/dev/null 2>&1 || true
  fi
  # Xóa mọi đơn test theo marker note (order_items cascade). KHÔNG đụng product seed.
  info "cleanup: xóa orders note LIKE '${NOTE_PREFIX}%'"
  psql "$DB_URL" -tAc "DELETE FROM orders WHERE note LIKE '${NOTE_PREFIX}%';" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" >/dev/null 2>&1 || true
  if [[ -n "$STARTED_SERVER_PID" ]]; then
    info "stop API server (pid $STARTED_SERVER_PID) mà test đã khởi động"
    kill "$STARTED_SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Boot infra (per run-moonie): postgres + migrate + seed. Idempotent.
# ---------------------------------------------------------------------------
echo "== Boot infra =="
( cd "$REPO_ROOT" && make up >/dev/null 2>&1 ) || true
for i in $(seq 1 30); do
  psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && break; sleep 1
done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true
( cd "$REPO_ROOT" && make seed >/dev/null 2>&1 ) || true

for t in orders order_items products admin_users; do
  if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"; then
    echo "FATAL: bảng '$t' chưa tồn tại — migration chưa apply."; exit 2
  fi
done
if ! psql "$DB_URL" -tAc "SELECT 1 FROM admin_users WHERE email='${ADMIN_EMAIL}'" | grep -q 1; then
  echo "FATAL: admin seed '${ADMIN_EMAIL}' không có trong DB — chạy 'make seed'."; exit 2
fi

# Lấy 1 product THẬT status='available' (deterministic theo slug) làm nguồn snapshot.
PROD_ROW="$(psql "$DB_URL" -tAc "SELECT id||'|'||price||'|'||name FROM products WHERE status='available' ORDER BY slug LIMIT 1")"
PROD_ID="$(echo "$PROD_ROW" | awk -F'|' '{print $1}' | tr -d ' ')"
PRICE_ORIG="$(echo "$PROD_ROW" | awk -F'|' '{print $2}' | tr -d ' ')"
PROD_NAME="$(echo "$PROD_ROW" | awk -F'|' '{print $3}')"
if [[ -z "$PROD_ID" || -z "$PRICE_ORIG" ]]; then
  echo "FATAL: không tìm được product 'available' trong seed để tạo đơn."; exit 2
fi
info "product seed dùng cho test: id=$PROD_ID price=$PRICE_ORIG name='$PROD_NAME'"

# ---------------------------------------------------------------------------
# 1. Ensure API running.
# ---------------------------------------------------------------------------
echo "== Ensure API running =="
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  info "API chưa chạy — khởi động 'go run ./cmd/server'"
  ( cd "$REPO_ROOT/api" && set -a && . "$REPO_ROOT/.env" && set +a \
      && GOTOOLCHAIN=local go run ./cmd/server >"$SERVER_LOG" 2>&1 ) &
  STARTED_SERVER_PID=$!
  for i in $(seq 1 60); do
    curl -fsS "$API_BASE/healthz" >/dev/null 2>&1 && break; sleep 1
  done
fi
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  echo "FATAL: API không sống tại $API_BASE (xem $SERVER_LOG)"; exit 2
fi

# ---------------------------------------------------------------------------
# Login → cookie mc_admin.
# ---------------------------------------------------------------------------
echo "== Login admin (cookie mc_admin) =="
LOGIN_CODE="$(curl -s -o "$WORKDIR/login.b" -w '%{http_code}' -c "$COOKIE_JAR" \
  -X POST -H 'Content-Type: application/json' \
  --data "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\"}" \
  "$API_BASE/auth/login")"
if [[ "$LOGIN_CODE" == "404" ]]; then
  echo "STOP: POST /auth/login → 404 — auth (Task 2) chưa dựng."; exit 3
fi
if [[ "$LOGIN_CODE" != "200" ]] || ! grep -q 'mc_admin' "$COOKIE_JAR" 2>/dev/null; then
  echo "FATAL: login admin thất bại (HTTP $LOGIN_CODE). Body: $(cat "$WORKDIR/login.b")"; exit 2
fi
info "login OK, có cookie mc_admin"

# Pre-flight: /admin/orders phải tồn tại (có cookie mà 404 => Task 5 chưa dựng route).
PROBE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/orders")"
if [[ "$PROBE" == "404" ]]; then
  echo "STOP: GET /admin/orders (có cookie) → 404 — admin orders chưa dựng (Task 5 chưa code)."
  exit 3
fi

# helper POST tạo đơn 1 item; in ra "HTTP|body_file"
create_order() { # qty discount extra_json_fields note
  local qty="$1" disc="$2" bf="$3"
  local body
  body=$(cat <<JSON
{"channel":"phone","discount":${disc},"note":"${NOTE_MARK}","items":[{"product_id":"${PROD_ID}","quantity":${qty}}]}
JSON
)
  curl -s -o "$bf" -w '%{http_code}' -b "$COOKIE_JAR" \
    -X POST -H 'Content-Type: application/json' --data "$body" \
    "$API_BASE/admin/orders"
}

# ===========================================================================
# Assert 1: Không auth → 401 cho cả GET và POST.
# ===========================================================================
echo "== [1] Không auth → 401 =="
B1="$WORKDIR/a1g.b"
C1="$(curl -s -o "$B1" -w '%{http_code}' "$API_BASE/admin/orders")"
[[ "$C1" == "401" ]] && pass "GET /admin/orders không cookie → 401" \
  || fail "GET /admin/orders không cookie → HTTP $C1 (kỳ vọng 401). Body: $(cat "$B1")"
jq -e '.error' "$B1" >/dev/null 2>&1 && pass "401 body có {error}" \
  || fail "401 body thiếu {error}. Body: $(cat "$B1")"

B1P="$WORKDIR/a1p.b"
C1P="$(curl -s -o "$B1P" -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  --data "{\"channel\":\"phone\",\"items\":[{\"product_id\":\"${PROD_ID}\",\"quantity\":1}]}" \
  "$API_BASE/admin/orders")"
[[ "$C1P" == "401" ]] && pass "POST /admin/orders không cookie → 401" \
  || fail "POST /admin/orders không cookie → HTTP $C1P (kỳ vọng 401). Body: $(cat "$B1P")"
# Không auth KHÔNG được tạo đơn nào
NA_CNT="$(psql_q "SELECT count(*) FROM orders WHERE note='${NOTE_MARK}'")"
[[ "$NA_CNT" == "0" ]] && pass "POST không auth KHÔNG tạo đơn trong DB" \
  || fail "POST không auth vẫn tạo $NA_CNT đơn trong DB (không được phép)"

# ===========================================================================
# Assert 2: Tạo đơn → 201 {id,code}; DB order status='new' code MC-*;
#   order_items snapshot đúng; subtotal=unit_price*2; total=subtotal-discount.
# ===========================================================================
echo "== [2] Tạo đơn (transaction + snapshot + tính tiền) =="
DISCOUNT=50000
B2="$WORKDIR/a2.b"
C2="$(create_order 2 "$DISCOUNT" "$B2")"
[[ "$C2" == "201" ]] && pass "POST tạo đơn → 201" \
  || fail "POST tạo đơn → HTTP $C2 (kỳ vọng 201). Body: $(cat "$B2")"
ORDER_ID="$(jq -r '.id // empty' "$B2" 2>/dev/null)"
ORDER_CODE="$(jq -r '.code // empty' "$B2" 2>/dev/null)"
[[ -n "$ORDER_ID" ]] && pass "response trả id ($ORDER_ID)" \
  || fail "response thiếu id. Body: $(cat "$B2")"
if [[ -z "$ORDER_ID" ]]; then
  ORDER_ID="$(psql_q "SELECT id FROM orders WHERE note='${NOTE_MARK}' ORDER BY created_at DESC LIMIT 1")"
fi
[[ -n "$ORDER_CODE" ]] && pass "response trả code ($ORDER_CODE)" \
  || fail "response thiếu code. Body: $(cat "$B2")"

# DB: status='new', code LIKE 'MC-%'
DB_ORD="$(psql_q "SELECT status||'|'||code FROM orders WHERE id='${ORDER_ID}'")"
DB_STATUS="$(echo "$DB_ORD" | awk -F'|' '{print $1}')"
DB_CODE="$(echo "$DB_ORD" | awk -F'|' '{print $2}')"
[[ "$DB_STATUS" == "new" ]] && pass "order.status='new' trong DB" \
  || fail "order.status='$DB_STATUS' (kỳ vọng 'new')"
case "$DB_CODE" in
  MC-*) pass "order.code khớp MC-* ($DB_CODE)";;
  *)    fail "order.code='$DB_CODE' KHÔNG khớp MC-*";;
esac

# order_items: đúng 1 dòng, product_id đúng, quantity=2, unit_price snapshot = PRICE_ORIG, product_name snapshot
OI_CNT="$(psql_q "SELECT count(*) FROM order_items WHERE order_id='${ORDER_ID}'")"
[[ "$OI_CNT" == "1" ]] && pass "order_items có đúng 1 dòng" \
  || fail "order_items có $OI_CNT dòng (kỳ vọng 1)"
OI_ROW="$(psql "$DB_URL" -tAc "SELECT product_id||'~'||quantity||'~'||unit_price||'~'||product_name FROM order_items WHERE order_id='${ORDER_ID}' LIMIT 1" 2>/dev/null)"
OI_PID="$(echo "$OI_ROW" | awk -F'~' '{print $1}' | tr -d ' ')"
OI_QTY="$(echo "$OI_ROW" | awk -F'~' '{print $2}' | tr -d ' ')"
OI_PRICE="$(echo "$OI_ROW" | awk -F'~' '{print $3}' | tr -d ' ')"
OI_NAME="$(echo "$OI_ROW" | awk -F'~' '{print $4}')"
[[ "$OI_PID" == "$PROD_ID" ]] && pass "order_items.product_id = product seed" \
  || fail "order_items.product_id='$OI_PID' (kỳ vọng '$PROD_ID')"
[[ "$OI_QTY" == "2" ]] && pass "order_items.quantity=2" \
  || fail "order_items.quantity='$OI_QTY' (kỳ vọng 2)"
[[ "$OI_PRICE" == "$PRICE_ORIG" ]] && pass "order_items.unit_price snapshot = giá product tại tạo đơn ($PRICE_ORIG)" \
  || fail "order_items.unit_price='$OI_PRICE' (kỳ vọng snapshot=$PRICE_ORIG)"
[[ -n "$OI_NAME" && "$OI_NAME" != "null" ]] && pass "order_items.product_name snapshot có ('$OI_NAME')" \
  || fail "order_items.product_name snapshot rỗng (kỳ vọng '$PROD_NAME')"

# Tính tiền: subtotal = unit_price*2 ; total = subtotal - discount
EXP_SUB=$((PRICE_ORIG * 2))
EXP_TOT=$((EXP_SUB - DISCOUNT))
DB_MONEY="$(psql_q "SELECT subtotal||'|'||discount||'|'||total FROM orders WHERE id='${ORDER_ID}'")"
DB_SUB="$(echo "$DB_MONEY" | awk -F'|' '{print $1}')"
DB_DISC="$(echo "$DB_MONEY" | awk -F'|' '{print $2}')"
DB_TOT="$(echo "$DB_MONEY" | awk -F'|' '{print $3}')"
[[ "$DB_SUB" == "$EXP_SUB" ]] && pass "subtotal = unit_price*2 = $EXP_SUB" \
  || fail "subtotal=$DB_SUB (kỳ vọng $EXP_SUB)"
[[ "$DB_DISC" == "$DISCOUNT" ]] && pass "discount lưu đúng = $DISCOUNT" \
  || fail "discount=$DB_DISC (kỳ vọng $DISCOUNT)"
[[ "$DB_TOT" == "$EXP_TOT" ]] && pass "total = subtotal - discount = $EXP_TOT" \
  || fail "total=$DB_TOT (kỳ vọng $EXP_TOT)"

# ===========================================================================
# Assert 3: SNAPSHOT — đổi giá product sau khi tạo đơn → GET /{id} unit_price
#   VẪN giữ giá cũ. Khôi phục giá ở cleanup.
# ===========================================================================
echo "== [3] Snapshot giá bền vững khi đổi giá product =="
NEW_PRICE=$((PRICE_ORIG + 111000))
PRICE_RESTORE_NEEDED="yes"
psql_do "UPDATE products SET price=${NEW_PRICE} WHERE id='${PROD_ID}';" >/dev/null \
  || { echo "FATAL: không update được product price"; exit 2; }
info "đã đổi product price $PRICE_ORIG → $NEW_PRICE (tạm thời)"

B3="$WORKDIR/a3.b"
C3="$(curl -s -o "$B3" -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/orders/${ORDER_ID}")"
[[ "$C3" == "200" ]] && pass "GET /admin/orders/{id} → 200" \
  || fail "GET /admin/orders/{id} → HTTP $C3 (kỳ vọng 200). Body: $(cat "$B3")"
# chi tiết phải có items[] — chấp nhận .items hoặc .order_items
API_UNIT="$(jq -r '((.items // .order_items) // [])[0].unit_price // empty' "$B3" 2>/dev/null)"
if [[ -n "$API_UNIT" ]]; then
  [[ "$API_UNIT" == "$PRICE_ORIG" ]] && pass "GET detail: item.unit_price VẪN = giá cũ ($PRICE_ORIG), không đổi theo giá mới" \
    || fail "GET detail: item.unit_price=$API_UNIT (kỳ vọng snapshot cũ $PRICE_ORIG; giá product hiện là $NEW_PRICE)"
else
  fail "GET detail KHÔNG có items[].unit_price (kỳ vọng chi tiết + items). Body: $(cat "$B3")"
fi
# Đối chứng DB (nguồn sự thật): order_items.unit_price không đổi
DB_UNIT_AFTER="$(psql_q "SELECT unit_price FROM order_items WHERE order_id='${ORDER_ID}' LIMIT 1")"
[[ "$DB_UNIT_AFTER" == "$PRICE_ORIG" ]] && pass "DB order_items.unit_price vẫn = $PRICE_ORIG sau đổi giá product" \
  || fail "DB order_items.unit_price=$DB_UNIT_AFTER sau đổi giá (kỳ vọng snapshot $PRICE_ORIG)"

# Khôi phục ngay (cleanup cũng khôi phục lần nữa để chắc)
psql_do "UPDATE products SET price=${PRICE_ORIG} WHERE id='${PROD_ID}';" >/dev/null && PRICE_RESTORE_NEEDED="no"
info "đã khôi phục product price → $PRICE_ORIG"

# ===========================================================================
# Assert 4: Transaction atomic — 1 product hợp lệ + 1 uuid không tồn tại →
#   FAIL (400/404) và KHÔNG tạo order một phần (count trước=sau).
# ===========================================================================
echo "== [4] Transaction rollback khi 1 item lỗi =="
CNT_BEFORE="$(psql_q "SELECT count(*) FROM orders")"
FAKE_PID="$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')"
[[ -z "$FAKE_PID" ]] && FAKE_PID="00000000-0000-0000-0000-0000deadbeef"
B4="$WORKDIR/a4.b"
BODY4=$(cat <<JSON
{"channel":"phone","note":"${NOTE_MARK}","items":[{"product_id":"${PROD_ID}","quantity":1},{"product_id":"${FAKE_PID}","quantity":1}]}
JSON
)
C4="$(curl -s -o "$B4" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X POST -H 'Content-Type: application/json' --data "$BODY4" "$API_BASE/admin/orders")"
if [[ "$C4" == "400" || "$C4" == "404" ]]; then
  pass "POST đơn có product không tồn tại → $C4 (từ chối)"
else
  fail "POST đơn có product không tồn tại → HTTP $C4 (kỳ vọng 400/404). Body: $(cat "$B4")"
fi
CNT_AFTER="$(psql_q "SELECT count(*) FROM orders")"
[[ "$CNT_BEFORE" == "$CNT_AFTER" ]] && pass "rollback toàn bộ: COUNT orders không đổi ($CNT_BEFORE)" \
  || fail "COUNT orders đổi $CNT_BEFORE→$CNT_AFTER — đã tạo order một phần (KHÔNG atomic)"

# ===========================================================================
# Assert 5: Phân trang — tạo thêm đơn để có ≥3 → GET ?limit=2 {items,total}
#   items≤2, total≥3, mới nhất trước.
# ===========================================================================
echo "== [5] Phân trang {items,total} mới nhất trước =="
sleep 1; create_order 1 0 "$WORKDIR/a5c1.b" >/dev/null
sleep 1; B5C2="$WORKDIR/a5c2.b"; create_order 1 0 "$B5C2" >/dev/null
NEWEST_ID="$(jq -r '.id // empty' "$B5C2" 2>/dev/null)"
[[ -z "$NEWEST_ID" ]] && NEWEST_ID="$(psql_q "SELECT id FROM orders WHERE note='${NOTE_MARK}' ORDER BY created_at DESC LIMIT 1")"

B5="$WORKDIR/a5.b"
C5="$(curl -s -o "$B5" -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/orders?limit=2&offset=0")"
[[ "$C5" == "200" ]] && pass "GET ?limit=2&offset=0 → 200" \
  || fail "GET ?limit=2 → HTTP $C5. Body: $(cat "$B5")"
if jq -e '(.items|type=="array") and (.total|type=="number")' "$B5" >/dev/null 2>&1; then
  pass "shape {items:[...], total:number}"
else
  fail "shape sai (kỳ vọng {items,total}). Body: $(cat "$B5")"
fi
ITEMS_LEN="$(jq -r '(.items // []) | length' "$B5" 2>/dev/null)"
TOTAL_N="$(jq -r '.total // 0' "$B5" 2>/dev/null)"
[[ "${ITEMS_LEN:-0}" -le 2 ]] && pass "items ≤ 2 (=$ITEMS_LEN)" \
  || fail "items=$ITEMS_LEN (kỳ vọng ≤ 2 theo limit)"
[[ "${TOTAL_N:-0}" -ge 3 ]] && pass "total ≥ 3 (=$TOTAL_N)" \
  || fail "total=$TOTAL_N (kỳ vọng ≥ 3 — đã tạo ≥3 đơn)"
FIRST_ID="$(jq -r '(.items // [])[0].id // empty' "$B5" 2>/dev/null)"
if [[ -n "$NEWEST_ID" && -n "$FIRST_ID" ]]; then
  [[ "$FIRST_ID" == "$NEWEST_ID" ]] && pass "mới nhất trước: items[0].id = đơn tạo cuối cùng" \
    || fail "items[0].id='$FIRST_ID' ≠ đơn mới nhất '$NEWEST_ID' (kỳ vọng sắp mới nhất trước)"
else
  fail "không lấy được items[0].id để kiểm thứ tự. Body: $(cat "$B5")"
fi

# ===========================================================================
# Assert 6: Đổi status. new→confirmed hợp lệ → 200. 'xyz' → 400 (bắt buộc).
#   new→done nhảy bậc → nên 400 (best-effort: cảnh báo nếu impl cho phép).
# ===========================================================================
echo "== [6] Đổi status (validate transition) =="
B6="$WORKDIR/a6.b"
C6="$(curl -s -o "$B6" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X PATCH -H 'Content-Type: application/json' --data '{"status":"confirmed"}' \
  "$API_BASE/admin/orders/${ORDER_ID}")"
[[ "$C6" == "200" ]] && pass "PATCH status new→confirmed → 200" \
  || fail "PATCH new→confirmed → HTTP $C6 (kỳ vọng 200). Body: $(cat "$B6")"
DB_ST6="$(psql_q "SELECT status FROM orders WHERE id='${ORDER_ID}'")"
[[ "$DB_ST6" == "confirmed" ]] && pass "DB status = 'confirmed' sau PATCH" \
  || fail "DB status='$DB_ST6' (kỳ vọng 'confirmed')"

# status không hợp lệ 'xyz' → 400 (BẮT BUỘC)
B6X="$WORKDIR/a6x.b"
C6X="$(curl -s -o "$B6X" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X PATCH -H 'Content-Type: application/json' --data '{"status":"xyz"}' \
  "$API_BASE/admin/orders/${ORDER_ID}")"
[[ "$C6X" == "400" || "$C6X" == "422" ]] && pass "status không hợp lệ 'xyz' → $C6X" \
  || fail "status 'xyz' → HTTP $C6X (kỳ vọng 400). Body: $(cat "$B6X")"
# 'xyz' KHÔNG được ghi vào DB
DB_ST6X="$(psql_q "SELECT status FROM orders WHERE id='${ORDER_ID}'")"
[[ "$DB_ST6X" == "confirmed" ]] && pass "status DB vẫn 'confirmed' (không nhận 'xyz')" \
  || fail "status DB='$DB_ST6X' — đã nhận giá trị không hợp lệ"

# nhảy bậc confirmed→done (bỏ delivering) — best-effort (plan: sai bậc → 400)
B6J="$WORKDIR/a6j.b"
C6J="$(curl -s -o "$B6J" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X PATCH -H 'Content-Type: application/json' --data '{"status":"done"}' \
  "$API_BASE/admin/orders/${ORDER_ID}")"
if [[ "$C6J" == "400" || "$C6J" == "422" ]]; then
  pass "nhảy bậc confirmed→done → $C6J (đúng plan: chặn sai bậc)"
else
  info "CẢNH BÁO (best-effort): confirmed→done → HTTP $C6J — plan kỳ vọng 400 chặn nhảy bậc, impl cho phép mọi transition. Không tính fail."
fi

# ===========================================================================
# Assert 7: Telegram (best-effort) — grep server log dấu hiệu notify đơn mới.
#   KHÔNG fail nếu không quan sát được (fail-safe).
# ===========================================================================
echo "== [7] Telegram notify đơn mới (best-effort) =="
if [[ -f "$SERVER_LOG" ]] && grep -Eiq 'order|đơn|telegram|notif' "$SERVER_LOG" 2>/dev/null; then
  info "server log có dấu hiệu xử lý notify đơn (best-effort OK)"
else
  info "không quan sát được notify trong log (server có thể do compose quản lý / Telegram tắt) — best-effort, KHÔNG fail"
fi

# ---------------------------------------------------------------------------
echo ""
if [[ "$FAILS" -eq 0 ]]; then
  echo "RESULT: PASS (tất cả assert bắt buộc đạt)"; exit 0
else
  echo "RESULT: FAIL ($FAILS assert rớt)"; exit 1
fi
