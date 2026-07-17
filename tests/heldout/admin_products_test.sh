#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 3 (Giai đoạn 4): Admin products CRUD + upload
#   GET/POST/PUT/PATCH/DELETE /api/v1/admin/products[/{id}]
#   POST /api/v1/admin/products/{id}/image (multipart) + GET /uploads/*
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#
# Black-box test. Derived ONLY from:
#   - plan Task 3 Held-out criteria (2026-07-17-giai-doan-4-admin-api.md)
#   - Global Constraints GĐ4 (mọi /api/v1/admin/* qua middleware auth → 401;
#     product có badge/compare_at_price/subtitle từ GĐ3; error JSON {error})
#   - SRS REQ-PROD-002 (CRUD: slug,name,description,price,type,status,ảnh,order)
#           REQ-PROD-003 (upload ảnh → uploads/, API serve tĩnh)
#   - api/openapi.yaml schema Product (public GET /products chỉ trả status≠hidden)
#   - run-moonie SKILL (boot; admin admin@mooni.local / mooni-admin)
# It does NOT read any implementation (api/internal/*, handlers, main, uploads).
#
# Cách test upload multipart: tạo 1 PNG hợp lệ tối thiểu (1x1) bằng base64 →
#   curl -F "<field>=@file;type=image/png". Field name không rõ trong spec nên
#   thử lần lượt: file → image → thất bại rõ ràng nếu cả hai đều không 200.
# Phân biệt admin-list vs public-list: seed 1 product status='hidden' trực tiếp
#   vào DB (black-box trên read path). Nó PHẢI xuất hiện ở GET /admin/products
#   (auth) nhưng TUYỆT ĐỐI không ở GET /products (public).
#
# Assertions (tất cả phải đạt; bất kỳ fail => exit != 0):
#   1. GET /admin/products KHÔNG cookie → 401 JSON {error}
#   2. GET /admin/products (cookie) → 200; list gồm cả product hidden;
#      product hidden đó KHÔNG có ở public GET /products
#   3. POST /admin/products (cookie) tạo mới → 201 + id; product vào DB;
#      slug trùng → 409 hoặc 400
#   4. PUT/PATCH sửa product (price+status+badge) → 200; DB cập nhật
#   5. DELETE product → sau đó không còn ở public GET /products (hidden|xóa)
#   6. Upload ảnh multipart (cookie) → 200 + image_url; GET ảnh → 200 image/*;
#      upload KHÔNG cookie → 401
#   7. Validate: POST thiếu name / price âm / type sai enum → 400 (JSON {error})
#   8. Cleanup: xóa products 'heldout-admin-%' + file ảnh test
#
# Slug prefix cô lập: 'heldout-admin-'. Cleanup dọn sạch mọi row prefix này.
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
API_HOST="${API_BASE%/api/v1}"                       # http://localhost:8080
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SLUG_PREFIX="heldout-admin-"
SUF="$(date +%s)$$"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@mooni.local}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-mooni-admin}"

FAILS=0
STARTED_SERVER_PID=""
WORKDIR="$(mktemp -d)"
COOKIE_JAR="$WORKDIR/cookies.txt"
UPLOADED_BASENAMES=()

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

psql_do() { psql "$DB_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }

cleanup() {
  info "cleanup: xóa products slug LIKE '${SLUG_PREFIX}%'"
  psql "$DB_URL" -tA -c "DELETE FROM products WHERE slug LIKE '${SLUG_PREFIX}%';" >/dev/null 2>&1 || true
  # best-effort xóa file ảnh test đã upload
  for bn in "${UPLOADED_BASENAMES[@]:-}"; do
    [[ -z "$bn" ]] && continue
    find "$REPO_ROOT" -type f -name "$bn" -not -path "*/.git/*" -exec rm -f {} \; >/dev/null 2>&1 || true
  done
  rm -rf "$WORKDIR" >/dev/null 2>&1 || true
  if [[ -n "$STARTED_SERVER_PID" ]]; then
    info "stop API server (pid $STARTED_SERVER_PID) mà test đã khởi động"
    kill "$STARTED_SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Boot infra (per run-moonie): postgres + migrate + seed admin. Idempotent.
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
( cd "$REPO_ROOT" && make seed >/dev/null 2>&1 ) || true

if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.products')" | grep -q products; then
  echo "FATAL: bảng 'products' chưa tồn tại — migration 0002_products chưa apply."; exit 2
fi
if ! psql "$DB_URL" -tAc "SELECT 1 FROM admin_users WHERE email='${ADMIN_EMAIL}'" | grep -q 1; then
  echo "FATAL: admin seed '${ADMIN_EMAIL}' không có trong DB — chạy 'make seed'."; exit 2
fi

# ---------------------------------------------------------------------------
# 1. Ensure API running (per run-moonie). If not, start it.
# ---------------------------------------------------------------------------
echo "== Ensure API running =="
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  info "API chưa chạy — khởi động 'go run ./cmd/server'"
  ( cd "$REPO_ROOT/api" && set -a && . "$REPO_ROOT/.env" && set +a \
      && GOTOOLCHAIN=local go run ./cmd/server >/tmp/heldout-adminprod-server.log 2>&1 ) &
  STARTED_SERVER_PID=$!
  for i in $(seq 1 60); do
    if curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  echo "FATAL: API không sống tại $API_BASE (xem /tmp/heldout-adminprod-server.log)"; exit 2
fi

# ---------------------------------------------------------------------------
# Login → lưu cookie mc_admin (dùng -b cho mọi call admin).
# ---------------------------------------------------------------------------
echo "== Login admin (lấy cookie mc_admin) =="
LOGIN_CODE="$(curl -s -o "$WORKDIR/login.b" -w '%{http_code}' -c "$COOKIE_JAR" \
  -X POST -H 'Content-Type: application/json' \
  --data "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\"}" \
  "$API_BASE/auth/login")"
if [[ "$LOGIN_CODE" == "404" ]]; then
  echo "STOP: POST /auth/login trả 404 — auth (Task 2) chưa dựng. Không chấm được Task 3."; exit 3
fi
if [[ "$LOGIN_CODE" != "200" ]] || ! grep -q 'mc_admin' "$COOKIE_JAR" 2>/dev/null; then
  echo "FATAL: login admin thất bại (HTTP $LOGIN_CODE) — không lấy được cookie mc_admin."
  echo "Body: $(cat "$WORKDIR/login.b")"; exit 2
fi
info "login OK, có cookie mc_admin"

# ---------------------------------------------------------------------------
# Pre-flight: /admin/products phải tồn tại. Với cookie hợp lệ mà vẫn 404 =>
# Task 3 chưa dựng route. Báo rõ, không fail mù.
# ---------------------------------------------------------------------------
PROBE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/products")"
if [[ "$PROBE" == "404" ]]; then
  echo "STOP: GET /admin/products (có cookie) → 404 — admin products chưa dựng (Task 3 chưa code)."
  exit 3
fi

# jq helper: chuẩn hóa response admin-list về mảng (chấp nhận array hoặc {items:[]})
norm_arr() { jq -c 'if type=="array" then . elif has("items") then .items else . end'; }

# ===========================================================================
# Assert 1: GET /admin/products KHÔNG cookie → 401 JSON {error}
# ===========================================================================
echo "== [1] GET /admin/products (không cookie) → 401 =="
B1="$WORKDIR/a1.b"
C1="$(curl -s -o "$B1" -w '%{http_code}' "$API_BASE/admin/products")"
if [[ "$C1" == "401" ]]; then pass "không cookie → 401"; else
  fail "không cookie → HTTP $C1 (kỳ vọng 401). Body: $(cat "$B1")"
fi
if jq -e '.error' "$B1" >/dev/null 2>&1; then pass "body có {error}"; else
  fail "body không có {error}. Body: $(cat "$B1")"
fi

# ===========================================================================
# Assert 2: admin-list gồm cả hidden; public-list KHÔNG có hidden.
#   Seed 1 product hidden trực tiếp vào DB (black-box read path).
# ===========================================================================
echo "== [2] admin list gồm hidden; public list loại hidden =="
HIDDEN_SLUG="${SLUG_PREFIX}hidden-${SUF}"
psql_do "INSERT INTO products (id,slug,name,description,price,type,status,display_order)
         VALUES (gen_random_uuid(),'${HIDDEN_SLUG}','Held Admin Hidden','seed',123000,'single_cake','hidden',999);" \
  >/dev/null || { echo "FATAL: seed hidden thất bại (schema products lệch?)"; exit 2; }

B2="$WORKDIR/a2_admin.b"
C2="$(curl -s -o "$B2" -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/products")"
if [[ "$C2" == "200" ]]; then pass "GET /admin/products (cookie) → 200"; else
  fail "GET /admin/products (cookie) → HTTP $C2 (kỳ vọng 200). Body: $(cat "$B2")"
fi
ADMIN_ARR="$(norm_arr < "$B2" 2>/dev/null || echo 'null')"
if echo "$ADMIN_ARR" | jq -e 'type=="array"' >/dev/null 2>&1; then
  pass "admin list là array (đã chuẩn hóa)"
else
  fail "admin list không phải array/{items}. Body: $(cat "$B2")"; ADMIN_ARR='[]'
fi
if echo "$ADMIN_ARR" | jq -e --arg s "$HIDDEN_SLUG" 'any(.[]; .slug==$s)' >/dev/null 2>&1; then
  pass "admin list CÓ product hidden '${HIDDEN_SLUG}'"
else
  fail "admin list THIẾU product hidden — admin phải trả cả hidden. List slugs: $(echo "$ADMIN_ARR" | jq -c '[.[].slug]')"
fi

B2P="$WORKDIR/a2_public.b"
curl -s -o "$B2P" "$API_BASE/products" >/dev/null
if jq -e --arg s "$HIDDEN_SLUG" 'any(.[]; .slug==$s)' "$B2P" >/dev/null 2>&1; then
  fail "public GET /products LỘ product hidden '${HIDDEN_SLUG}' (không được phép)"
else
  pass "public GET /products KHÔNG có product hidden"
fi

# ===========================================================================
# Assert 3: POST tạo mới → 201 + id; vào DB; slug trùng → 409/400.
# ===========================================================================
echo "== [3] POST /admin/products tạo mới =="
NEW_SLUG="${SLUG_PREFIX}create-${SUF}"
CREATE_BODY=$(cat <<JSON
{"slug":"${NEW_SLUG}","name":"Bánh Held Tạo Mới","description":"mô tả có dấu tiếng Việt","price":350000,"type":"gift_box","status":"available","display_order":42,"badge":"Mới","compare_at_price":500000,"subtitle":"Hộp thiếc cao cấp"}
JSON
)
B3="$WORKDIR/a3.b"
C3="$(curl -s -o "$B3" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X POST -H 'Content-Type: application/json' --data "$CREATE_BODY" \
  "$API_BASE/admin/products")"
if [[ "$C3" == "201" ]]; then pass "POST create → 201"; else
  fail "POST create → HTTP $C3 (kỳ vọng 201). Body: $(cat "$B3")"
fi
NEW_ID="$(jq -r '.id // empty' "$B3" 2>/dev/null)"
if [[ -n "$NEW_ID" ]]; then pass "response trả id ($NEW_ID)"; else
  fail "response không có id. Body: $(cat "$B3")"
fi
# Vào DB thật với đúng giá + slug
DB_ROW="$(psql "$DB_URL" -tAc "SELECT price||'|'||type||'|'||status FROM products WHERE slug='${NEW_SLUG}'" 2>/dev/null | tr -d ' ')"
if [[ "$DB_ROW" == "350000|gift_box|available" ]]; then
  pass "product ghi vào DB đúng (price=350000,type=gift_box,status=available)"
else
  fail "product trong DB sai/không có: '$DB_ROW' (kỳ vọng '350000|gift_box|available')"
fi
# slug trùng → 409 hoặc 400
B3D="$WORKDIR/a3dup.b"
C3D="$(curl -s -o "$B3D" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X POST -H 'Content-Type: application/json' --data "$CREATE_BODY" \
  "$API_BASE/admin/products")"
if [[ "$C3D" == "409" || "$C3D" == "400" ]]; then
  pass "slug trùng → $C3D (từ chối)"
else
  fail "slug trùng → HTTP $C3D (kỳ vọng 409 hoặc 400). Body: $(cat "$B3D")"
fi
# Không tạo bản ghi trùng slug thứ 2
DUP_CNT="$(psql "$DB_URL" -tAc "SELECT count(*) FROM products WHERE slug='${NEW_SLUG}'" | tr -d ' ')"
if [[ "$DUP_CNT" == "1" ]]; then pass "DB vẫn chỉ 1 bản ghi slug '${NEW_SLUG}'"; else
  fail "DB có $DUP_CNT bản ghi slug '${NEW_SLUG}' (kỳ vọng 1 — slug UNIQUE)"
fi

# Xác định id để update/delete (dùng id từ response, fallback query DB)
if [[ -z "$NEW_ID" ]]; then
  NEW_ID="$(psql "$DB_URL" -tAc "SELECT id FROM products WHERE slug='${NEW_SLUG}'" | tr -d ' ')"
fi

# ===========================================================================
# Assert 4: PUT/PATCH sửa (price+status+badge) → 200; DB cập nhật.
#   Thử PUT trước; nếu 404/405 → thử PATCH (spec chưa chốt method).
# ===========================================================================
echo "== [4] Update product (price+status+badge) =="
UPD_BODY=$(cat <<JSON
{"slug":"${NEW_SLUG}","name":"Bánh Held Đã Sửa","description":"mô tả mới","price":420000,"type":"gift_box","status":"sold_out","display_order":7,"badge":"Bán chạy","compare_at_price":600000,"subtitle":"Hộp thiếc"}
JSON
)
B4="$WORKDIR/a4.b"
C4="$(curl -s -o "$B4" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X PUT -H 'Content-Type: application/json' --data "$UPD_BODY" \
  "$API_BASE/admin/products/${NEW_ID}")"
if [[ "$C4" == "404" || "$C4" == "405" ]]; then
  info "PUT → $C4, thử PATCH"
  C4="$(curl -s -o "$B4" -w '%{http_code}' -b "$COOKIE_JAR" \
    -X PATCH -H 'Content-Type: application/json' \
    --data '{"price":420000,"status":"sold_out","badge":"Bán chạy"}' \
    "$API_BASE/admin/products/${NEW_ID}")"
fi
if [[ "$C4" == "200" ]]; then pass "update → 200"; else
  fail "update → HTTP $C4 (kỳ vọng 200). Body: $(cat "$B4")"
fi
DB_UPD="$(psql "$DB_URL" -tAc "SELECT price||'|'||status||'|'||coalesce(badge,'<null>') FROM products WHERE id='${NEW_ID}'" 2>/dev/null | tr -d ' ')"
if [[ "$DB_UPD" == "420000|sold_out|Bánchạy" ]]; then
  pass "DB cập nhật đúng (price=420000,status=sold_out,badge='Bán chạy')"
else
  fail "DB sau update = '$DB_UPD' (kỳ vọng '420000|sold_out|Bánchạy')"
fi

# ===========================================================================
# Assert 5: DELETE → sau đó không còn ở public GET /products.
#   Tạo 1 product available riêng để xóa (đảm bảo ban đầu nó ở public).
# ===========================================================================
echo "== [5] DELETE → biến mất khỏi public =="
DEL_SLUG="${SLUG_PREFIX}del-${SUF}"
DEL_BODY=$(cat <<JSON
{"slug":"${DEL_SLUG}","name":"Bánh Held Sẽ Xóa","price":200000,"type":"single_cake","status":"available","display_order":50}
JSON
)
B5C="$WORKDIR/a5c.b"
C5C="$(curl -s -o "$B5C" -w '%{http_code}' -b "$COOKIE_JAR" \
  -X POST -H 'Content-Type: application/json' --data "$DEL_BODY" \
  "$API_BASE/admin/products")"
DEL_ID="$(jq -r '.id // empty' "$B5C" 2>/dev/null)"
[[ -z "$DEL_ID" ]] && DEL_ID="$(psql "$DB_URL" -tAc "SELECT id FROM products WHERE slug='${DEL_SLUG}'" | tr -d ' ')"
# ban đầu phải ở public
curl -s -o "$WORKDIR/a5_pub_before.b" "$API_BASE/products" >/dev/null
if jq -e --arg s "$DEL_SLUG" 'any(.[]; .slug==$s)' "$WORKDIR/a5_pub_before.b" >/dev/null 2>&1; then
  pass "trước khi xóa: product available có ở public"
else
  fail "product available KHÔNG ở public trước khi xóa (bất thường). slugs: $(jq -c '[.[].slug]' "$WORKDIR/a5_pub_before.b")"
fi
B5="$WORKDIR/a5.b"
C5="$(curl -s -o "$B5" -w '%{http_code}' -b "$COOKIE_JAR" -X DELETE "$API_BASE/admin/products/${DEL_ID}")"
if [[ "$C5" == "200" || "$C5" == "204" ]]; then pass "DELETE → $C5"; else
  fail "DELETE → HTTP $C5 (kỳ vọng 200/204). Body: $(cat "$B5")"
fi
curl -s -o "$WORKDIR/a5_pub_after.b" "$API_BASE/products" >/dev/null
if jq -e --arg s "$DEL_SLUG" 'any(.[]; .slug==$s)' "$WORKDIR/a5_pub_after.b" >/dev/null 2>&1; then
  fail "sau DELETE product VẪN ở public GET /products (phải hidden hoặc xóa)"
else
  pass "sau DELETE product biến mất khỏi public"
fi

# ===========================================================================
# Assert 6: Upload ảnh multipart → 200 + image_url; GET ảnh → 200 image/*;
#           upload KHÔNG cookie → 401.
# ===========================================================================
echo "== [6] Upload ảnh sản phẩm =="
PNG="$WORKDIR/pixel.png"
# PNG 1x1 hợp lệ (base64)
base64 -d > "$PNG" <<'B64' 2>/dev/null || printf '' > "$PNG"
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==
B64
if [[ ! -s "$PNG" ]]; then echo "FATAL: không tạo được PNG test (base64 lỗi)"; exit 2; fi

# 6a: upload KHÔNG cookie → 401
C6NA="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST -F "file=@${PNG};type=image/png" \
  "$API_BASE/admin/products/${NEW_ID}/image")"
if [[ "$C6NA" == "401" ]]; then pass "upload không cookie → 401"; else
  fail "upload không cookie → HTTP $C6NA (kỳ vọng 401)"
fi

# 6b: upload CÓ cookie → 200 + image_url. Field name chưa rõ → thử 'file' rồi 'image'.
B6="$WORKDIR/a6.b"; C6=""
for FIELD in file image; do
  C6="$(curl -s -o "$B6" -w '%{http_code}' -b "$COOKIE_JAR" \
    -X POST -F "${FIELD}=@${PNG};type=image/png" \
    "$API_BASE/admin/products/${NEW_ID}/image")"
  [[ "$C6" == "200" ]] && { info "upload field='${FIELD}' → 200"; break; }
done
if [[ "$C6" == "200" ]]; then pass "upload có cookie → 200"; else
  fail "upload có cookie → HTTP $C6 (thử field file+image). Body: $(cat "$B6")"
fi
# image_url: từ response hoặc từ DB
IMG_URL="$(jq -r '.image_url // empty' "$B6" 2>/dev/null)"
[[ -z "$IMG_URL" ]] && IMG_URL="$(psql "$DB_URL" -tAc "SELECT image_url FROM products WHERE id='${NEW_ID}'" | tr -d ' ')"
if [[ -n "$IMG_URL" && "$IMG_URL" != "null" ]]; then
  pass "image_url được set: $IMG_URL"
else
  fail "không có image_url sau upload (response+DB đều rỗng). Body: $(cat "$B6")"
fi
# nhớ basename để cleanup file
if [[ -n "$IMG_URL" && "$IMG_URL" != "null" ]]; then
  UPLOADED_BASENAMES+=("$(basename "$IMG_URL")")
fi
# GET ảnh → 200 + content-type image/*. Thử các URL ứng viên.
if [[ -n "$IMG_URL" && "$IMG_URL" != "null" ]]; then
  declare -a CANDS=()
  case "$IMG_URL" in
    http*)  CANDS+=("$IMG_URL") ;;
    /*)     CANDS+=("${API_HOST}${IMG_URL}" "${API_BASE}${IMG_URL}") ;;
    *)      CANDS+=("${API_HOST}/${IMG_URL}" "${API_HOST}/uploads/${IMG_URL}") ;;
  esac
  GOT_IMG="no"
  for U in "${CANDS[@]}"; do
    HDR="$WORKDIR/img.h"
    IC="$(curl -s -o /dev/null -D "$HDR" -w '%{http_code}' "$U")"
    CT="$(grep -i '^content-type:' "$HDR" | tail -1 | tr -d '\r')"
    if [[ "$IC" == "200" ]] && echo "$CT" | grep -iq 'image/'; then
      pass "GET ảnh ($U) → 200, Content-Type: $CT"
      GOT_IMG="yes"; break
    fi
  done
  [[ "$GOT_IMG" == "yes" ]] || fail "không GET được ảnh 200/image từ image_url '$IMG_URL' (thử: ${CANDS[*]})"
fi

# ===========================================================================
# Assert 7: Validate POST → 400 (JSON {error}) cho các input sai.
#   Chấp nhận 400 (mong đợi) hoặc 422; loại trừ 201/5xx.
# ===========================================================================
echo "== [7] Validate POST → 400 =="
check_reject() { # tên_case  json_body
  local name="$1" body="$2" bf="$WORKDIR/a7_$(echo "$name"|tr ' /' '__').b"
  local code
  code="$(curl -s -o "$bf" -w '%{http_code}' -b "$COOKIE_JAR" \
    -X POST -H 'Content-Type: application/json' --data "$body" \
    "$API_BASE/admin/products")"
  if [[ "$code" == "400" ]]; then
    pass "$name → 400"
  elif [[ "$code" == "422" ]]; then
    pass "$name → 422 (client validation; plan ghi 400 — chấp nhận)"
  else
    fail "$name → HTTP $code (kỳ vọng 400). Body: $(cat "$bf")"
  fi
  if [[ "$code" == "400" || "$code" == "422" ]]; then
    jq -e '.error' "$bf" >/dev/null 2>&1 && pass "$name → body có {error}" \
      || fail "$name → thiếu {error}. Body: $(cat "$bf")"
  fi
}
check_reject "thiếu name"   "{\"slug\":\"${SLUG_PREFIX}noname-${SUF}\",\"price\":100000,\"type\":\"gift_box\",\"status\":\"available\"}"
check_reject "price âm"     "{\"slug\":\"${SLUG_PREFIX}negprice-${SUF}\",\"name\":\"X\",\"price\":-5000,\"type\":\"gift_box\",\"status\":\"available\"}"
check_reject "type sai enum" "{\"slug\":\"${SLUG_PREFIX}badtype-${SUF}\",\"name\":\"X\",\"price\":100000,\"type\":\"pizza\",\"status\":\"available\"}"

# Không được tạo bản ghi nào từ input sai
BAD_CNT="$(psql "$DB_URL" -tAc "SELECT count(*) FROM products WHERE slug IN ('${SLUG_PREFIX}noname-${SUF}','${SLUG_PREFIX}negprice-${SUF}','${SLUG_PREFIX}badtype-${SUF}')" | tr -d ' ')"
if [[ "$BAD_CNT" == "0" ]]; then pass "input sai KHÔNG tạo bản ghi trong DB"; else
  fail "input sai tạo $BAD_CNT bản ghi trong DB (không được phép)"
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
