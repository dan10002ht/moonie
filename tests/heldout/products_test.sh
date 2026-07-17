#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 1 (Giai đoạn 2): GET /api/v1/products
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#
# Black-box test. Derived ONLY from:
#   - plan Task 1 Held-out criteria (2026-07-17-giai-doan-2-api-public.md)
#   - SRS REQ-PROD-001 (public GET, hide status='hidden')
#   - api/openapi.yaml contract (schema Product)
# It does NOT read any implementation (handlers/store/main). Boot per run-moonie.
#
# What it verifies (all must pass; any failure => exit != 0):
#   1. HTTP 200 on GET /api/v1/products
#   2. Body is a JSON array
#   3. Product with status='hidden' is NOT present
#   4. Both the seeded 'available' AND 'sold_out' test products ARE present (2)
#   5. Visible products are ordered by display_order ascending
#      (our sold_out(order 10) appears before our available(order 20))
#   6. Every returned item has fields: slug, name, price, type, status,
#      image_url, display_order
#   7. price is a JSON number (integer)
#
# Seeds 3 test rows (slug prefix 'heldout-test-') and cleans them up on exit.
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SLUG_PREFIX="heldout-test-"

FAILS=0
STARTED_SERVER_PID=""

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

psql_do() { psql "$DB_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }

cleanup() {
  info "cleanup: xóa seed test (slug LIKE '${SLUG_PREFIX}%')"
  psql "$DB_URL" -tA -c "DELETE FROM products WHERE slug LIKE '${SLUG_PREFIX}%';" >/dev/null 2>&1 || true
  if [[ -n "$STARTED_SERVER_PID" ]]; then
    info "stop API server (pid $STARTED_SERVER_PID) mà test đã khởi động"
    kill "$STARTED_SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Boot infra (per run-moonie): postgres + migrate. Idempotent.
# ---------------------------------------------------------------------------
echo "== Boot infra =="
( cd "$REPO_ROOT" && make up >/dev/null 2>&1 ) || true
# wait postgres reachable
for i in $(seq 1 30); do
  if psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true

# Bảng products phải tồn tại (Task 1 tạo migration 0002). Nếu chưa => FAIL rõ ràng.
if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.products')" | grep -q products; then
  echo "FATAL: bảng 'products' chưa tồn tại — migration 0002_products chưa được apply."
  exit 2
fi

# ---------------------------------------------------------------------------
# 1. Seed 3 test products directly (bypass API — black-box on the read path).
#    display_order khác nhau để kiểm ordering. hidden có order NHỎ NHẤT để
#    chứng minh nó bị loại vì status chứ không phải vì order.
#      sold_out  -> display_order 10  (kỳ vọng đứng TRƯỚC)
#      available -> display_order 20  (kỳ vọng đứng SAU)
#      hidden    -> display_order  5  (KHÔNG được xuất hiện dù order nhỏ nhất)
# ---------------------------------------------------------------------------
echo "== Seed 3 test products =="
psql_do "
INSERT INTO products (id, slug, name, description, price, type, status, image_url, display_order)
VALUES
 (gen_random_uuid(), '${SLUG_PREFIX}soldout',   'Held Sold Out',  'seed', 250000, 'single_cake', 'sold_out',  'https://img.example/soldout.jpg',   10),
 (gen_random_uuid(), '${SLUG_PREFIX}available', 'Held Available', 'seed', 500000, 'gift_box',    'available', 'https://img.example/available.jpg', 20),
 (gen_random_uuid(), '${SLUG_PREFIX}hidden',    'Held Hidden',    'seed', 100000, 'single_cake', 'hidden',    'https://img.example/hidden.jpg',     5);
" >/dev/null || { echo "FATAL: seed thất bại (schema products không khớp plan?)"; exit 2; }

# ---------------------------------------------------------------------------
# 2. Ensure API is up (per run-moonie). If not, start it in background.
# ---------------------------------------------------------------------------
echo "== Ensure API running =="
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  info "API chưa chạy — khởi động 'go run ./cmd/server'"
  ( cd "$REPO_ROOT/api" && set -a && . "$REPO_ROOT/.env" && set +a \
      && GOTOOLCHAIN=local go run ./cmd/server >/tmp/heldout-products-server.log 2>&1 ) &
  STARTED_SERVER_PID=$!
  for i in $(seq 1 60); do
    if curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  echo "FATAL: API không sống tại $API_BASE (xem /tmp/heldout-products-server.log)"; exit 2
fi

# ---------------------------------------------------------------------------
# 3. GET /products and assert.
# ---------------------------------------------------------------------------
echo "== GET $API_BASE/products =="
RESP_FILE="$(mktemp)"
HTTP_CODE="$(curl -s -o "$RESP_FILE" -w '%{http_code}' "$API_BASE/products")"
BODY="$(cat "$RESP_FILE")"
rm -f "$RESP_FILE"

# Assert 1: HTTP 200
if [[ "$HTTP_CODE" == "200" ]]; then pass "HTTP 200 (nhận $HTTP_CODE)"; else fail "HTTP status = $HTTP_CODE (kỳ vọng 200). Body: $BODY"; fi

# Assert 2: JSON array
if echo "$BODY" | jq -e 'type == "array"' >/dev/null 2>&1; then
  pass "body là JSON array"
else
  fail "body KHÔNG phải JSON array. Body: $BODY"
  echo ">>> Dừng: không parse tiếp được."; exit 1
fi

# Assert 3: hidden test product NOT present
if echo "$BODY" | jq -e --arg s "${SLUG_PREFIX}hidden" 'any(.[]; .slug == $s)' >/dev/null 2>&1; then
  fail "sản phẩm hidden '${SLUG_PREFIX}hidden' XUẤT HIỆN trong kết quả (phải bị ẩn)"
else
  pass "sản phẩm hidden bị loại khỏi kết quả"
fi
# Đồng thời: không có bất kỳ item nào status='hidden'
if echo "$BODY" | jq -e 'any(.[]; .status == "hidden")' >/dev/null 2>&1; then
  fail "có item với status='hidden' trong kết quả (không được phép)"
else
  pass "không có item nào status='hidden'"
fi

# Assert 4: available + sold_out test products present (đúng 2 từ seed test)
CNT_TEST="$(echo "$BODY" | jq --arg p "$SLUG_PREFIX" '[.[] | select(.slug | startswith($p))] | length')"
if [[ "$CNT_TEST" == "2" ]]; then
  pass "đúng 2 sản phẩm test hiển thị (available + sold_out)"
else
  fail "số sản phẩm test hiển thị = $CNT_TEST (kỳ vọng 2)"
fi
HAS_AVAIL="$(echo "$BODY" | jq --arg s "${SLUG_PREFIX}available" 'any(.[]; .slug == $s)')"
HAS_SOLD="$(echo "$BODY" | jq --arg s "${SLUG_PREFIX}soldout" 'any(.[]; .slug == $s)')"
[[ "$HAS_AVAIL" == "true" ]] && pass "có sản phẩm 'available'" || fail "thiếu sản phẩm 'available'"
[[ "$HAS_SOLD"  == "true" ]] && pass "có sản phẩm 'sold_out'"  || fail "thiếu sản phẩm 'sold_out'"

# Assert 5: ordering by display_order asc — sold_out(10) trước available(20)
POS_SOLD="$(echo "$BODY" | jq --arg s "${SLUG_PREFIX}soldout"   'map(.slug) | index($s)')"
POS_AVAIL="$(echo "$BODY" | jq --arg s "${SLUG_PREFIX}available" 'map(.slug) | index($s)')"
if [[ "$POS_SOLD" != "null" && "$POS_AVAIL" != "null" && "$POS_SOLD" -lt "$POS_AVAIL" ]]; then
  pass "ordering: sold_out(order 10) đứng trước available(order 20) [pos $POS_SOLD < $POS_AVAIL]"
else
  fail "ordering sai: pos(sold_out)=$POS_SOLD, pos(available)=$POS_AVAIL (kỳ vọng sold_out trước)"
fi
# Kiểm ordering tổng thể: toàn bộ mảng phải display_order không giảm dần
if echo "$BODY" | jq -e '[.[].display_order] as $d | $d == ($d | sort)' >/dev/null 2>&1; then
  pass "toàn bộ mảng sắp theo display_order tăng dần (không giảm)"
else
  fail "mảng KHÔNG sắp theo display_order tăng dần: $(echo "$BODY" | jq -c '[.[].display_order]')"
fi

# Assert 6: mỗi item có đủ field bắt buộc
REQUIRED_FIELDS='["slug","name","price","type","status","image_url","display_order"]'
MISSING="$(echo "$BODY" | jq -c --argjson req "$REQUIRED_FIELDS" '
  [ .[] | . as $item | ($req - ($item | keys)) | select(length>0) ]')"
if [[ "$MISSING" == "[]" ]]; then
  pass "mọi item có đủ field: slug,name,price,type,status,image_url,display_order"
else
  fail "có item thiếu field bắt buộc. Field thiếu (theo item): $MISSING"
fi

# Assert 7: price là số (number)
if echo "$BODY" | jq -e 'all(.[]; (.price | type) == "number")' >/dev/null 2>&1; then
  pass "price là kiểu số ở mọi item"
else
  fail "price KHÔNG phải số ở ít nhất 1 item: $(echo "$BODY" | jq -c '[.[] | {slug, price, price_type: (.price|type)}]')"
fi
# Kiểm giá seed đúng giá trị số nguyên (available price = 500000)
AVAIL_PRICE="$(echo "$BODY" | jq --arg s "${SLUG_PREFIX}available" '.[] | select(.slug==$s) | .price')"
if [[ "$AVAIL_PRICE" == "500000" ]]; then
  pass "price của 'available' = 500000 (đúng số nguyên VND đã seed)"
else
  fail "price của 'available' = '$AVAIL_PRICE' (kỳ vọng 500000)"
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
