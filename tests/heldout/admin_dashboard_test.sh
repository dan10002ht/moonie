#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 7 (Giai đoạn 4): Admin dashboard
#   GET /api/v1/admin/dashboard   (auth) → {new_leads, processing_orders,
#                                           revenue_this_month}
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#
# Black-box test. Derived ONLY from:
#   - plan Task 7 Held-out + Global Constraints (mọi /api/v1/admin/* qua auth
#     → 401 khi thiếu cookie; error JSON {error}).
#   - SRS REQ-DASH-001: dashboard trả số leads mới (status='new'),
#     số đơn đang xử lý (status IN ('confirmed','delivering')),
#     doanh thu tháng = TỔNG total các đơn status='done' TRONG tháng hiện tại
#     tính theo GIỜ VN (Asia/Ho_Chi_Minh) — quyết định spec.
#   - schema live:
#       leads(name NOT NULL, phone NOT NULL, status IN
#             ('new','contacted','converted','closed'), source, order_id? FK→orders)
#       orders(code UNIQUE NOT NULL, channel, status IN
#             ('new','confirmed','delivering','done','cancelled'),
#             subtotal/discount/total bigint DEFAULT 0, note, created_at timestamptz)
#   - run-moonie SKILL (boot; admin admin@mooni.local / mooni-admin)
# It does NOT read any implementation (api/internal/*, handlers, main).
#
# GHI CHÚ KỸ THUẬT (cách các assert khó được kiểm):
#  * CHIẾN LƯỢC DELTA (không phụ thuộc baseline chính xác): mỗi metric được đo
#    2 lần — TRƯỚC và SAU khi SEED trực tiếp vào DB một lượng ĐÃ BIẾT bằng psql
#    INSERT. Assert: (sau - trước) = đúng lượng seed. Vì test XÓA đúng những
#    dòng đã seed ở cleanup, trạng thái baseline được KHÔI PHỤC.
#  * FIELD LINH HOẠT: 3 số lấy qua jq với nhiều biến thể key (new_leads/newLeads,
#    processing_orders/processingOrders, revenue_this_month/revenueThisMonth...).
#    Nếu không map được → in ra keys thực tế của JSON để generator biết.
#  * BIÊN THÁNG (revenue): đơn done 500000đ đặt created_at = GIỮA tháng hiện tại
#    theo GIỜ VN (unambiguous cả UTC lẫn VN) → PHẢI cộng. Đơn done 999000đ đặt
#    created_at = THÁNG TRƯỚC (now()-40 ngày) → KHÔNG được cộng. Đơn confirmed
#    777000đ tháng này (chưa done) → KHÔNG được cộng vào revenue.
#  * PROCESSING chỉ đếm confirmed+delivering: seed 2 confirmed + 1 delivering
#    (đếm) và 1 new + 1 done + 1 cancelled (KHÔNG đếm) → delta processing = 3.
#  * Cô lập + cleanup: leads seed name LIKE 'heldout-dash-%'; orders seed
#    code LIKE 'MC-DASH-%' và note='heldout-dash'. Cleanup null leads.order_id
#    của các dòng seed rồi DELETE leads + DELETE orders (order_items cascade).
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUF="$(date +%s)$$"
LEAD_PREFIX="heldout-dash-lead-${SUF}"
ORDER_NOTE="heldout-dash"
ORDER_CODE_PREFIX="MC-DASH-${SUF}"
SERVER_LOG="/tmp/heldout-admindash-server.log"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@mooni.local}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-mooni-admin}"

FAILS=0
STARTED_SERVER_PID=""
WORKDIR="$(mktemp -d)"
COOKIE_JAR="$WORKDIR/cookies.txt"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

psql_do() { psql "$DB_URL" -v ON_ERROR_STOP=1 -tA -c "$1"; }
psql_q()  { psql "$DB_URL" -tAc "$1" 2>/dev/null | tr -d ' '; }

cleanup() {
  info "cleanup: null leads.order_id + xóa leads/orders seed 'heldout-dash'"
  # Defensive: nếu lead seed có tham chiếu order (không dùng trong test) → null trước FK.
  psql "$DB_URL" -tAc "UPDATE leads SET order_id=NULL WHERE name LIKE 'heldout-dash-%';" >/dev/null 2>&1 || true
  psql "$DB_URL" -tAc "DELETE FROM leads  WHERE name LIKE 'heldout-dash-%';" >/dev/null 2>&1 || true
  # order_items cascade; xóa mọi order seed theo note hoặc code marker.
  psql "$DB_URL" -tAc "DELETE FROM orders WHERE note='heldout-dash' OR code LIKE 'MC-DASH-%';" >/dev/null 2>&1 || true
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

for t in leads orders admin_users; do
  if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.$t')" | grep -q "$t"; then
    echo "FATAL: bảng '$t' chưa tồn tại — migration chưa apply."; exit 2
  fi
done
if ! psql "$DB_URL" -tAc "SELECT 1 FROM admin_users WHERE email='${ADMIN_EMAIL}'" | grep -q 1; then
  echo "FATAL: admin seed '${ADMIN_EMAIL}' không có trong DB — chạy 'make seed'."; exit 2
fi

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

# Pre-flight: /admin/dashboard phải tồn tại (có cookie mà 404 => Task 7 chưa dựng route).
PROBE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/dashboard")"
if [[ "$PROBE" == "404" ]]; then
  echo "STOP: GET /admin/dashboard (có cookie) → 404 — admin dashboard chưa dựng (Task 7 chưa code)."
  exit 3
fi

# ---------------------------------------------------------------------------
# Helpers: gọi dashboard + trích 3 metric (map key linh hoạt).
# ---------------------------------------------------------------------------
JQ_NEW='.new_leads // .newLeads // .leads_new // .new_leads_count // .newLeadsCount // .newLeadCount'
JQ_PROC='.processing_orders // .processingOrders // .processing // .orders_processing // .processingOrdersCount // .processing_orders_count'
JQ_REV='.revenue_this_month // .revenueThisMonth // .revenue // .month_revenue // .revenueMonth // .monthlyRevenue // .revenue_month'

# Populates globals D_NEW D_PROC D_REV from a fresh dashboard call. Returns file path.
fetch_dash() { # outfile
  local bf="$1" code
  code="$(curl -s -o "$bf" -w '%{http_code}' -b "$COOKIE_JAR" "$API_BASE/admin/dashboard")"
  echo "$code"
}
extract_all() { # bodyfile -> sets D_NEW D_PROC D_REV (empty if unmappable)
  D_NEW="$(jq -r "($JQ_NEW) // empty"  "$1" 2>/dev/null | tr -d ' ')"
  D_PROC="$(jq -r "($JQ_PROC) // empty" "$1" 2>/dev/null | tr -d ' ')"
  D_REV="$(jq -r "($JQ_REV) // empty"  "$1" 2>/dev/null | tr -d ' ')"
}
is_int() { [[ "$1" =~ ^-?[0-9]+$ ]]; }

# ===========================================================================
# Assert 1: Không auth → 401 + {error}.
# ===========================================================================
echo "== [1] Không auth → 401 =="
B1="$WORKDIR/a1.b"
C1="$(curl -s -o "$B1" -w '%{http_code}' "$API_BASE/admin/dashboard")"
[[ "$C1" == "401" ]] && pass "GET /admin/dashboard không cookie → 401" \
  || fail "GET /admin/dashboard không cookie → HTTP $C1 (kỳ vọng 401). Body: $(cat "$B1")"
jq -e '.error' "$B1" >/dev/null 2>&1 && pass "401 body có {error}" \
  || fail "401 body thiếu {error}. Body: $(cat "$B1")"

# ===========================================================================
# Assert 2: Có auth → 200 + JSON có đủ 3 SỐ (map key linh hoạt).
# ===========================================================================
echo "== [2] Có auth → 200 + 3 số (new_leads, processing_orders, revenue_this_month) =="
B2="$WORKDIR/a2.b"
C2="$(fetch_dash "$B2")"
[[ "$C2" == "200" ]] && pass "GET /admin/dashboard (auth) → 200" \
  || fail "GET /admin/dashboard (auth) → HTTP $C2 (kỳ vọng 200). Body: $(cat "$B2")"
extract_all "$B2"
KEYS_SEEN="$(jq -rc 'keys' "$B2" 2>/dev/null || echo '?')"
if is_int "$D_NEW"; then pass "new_leads là số (=$D_NEW)"; else
  fail "new_leads KHÔNG map được sang số (keys thực tế: $KEYS_SEEN). Chấp nhận new_leads/newLeads. Body: $(cat "$B2")"; fi
if is_int "$D_PROC"; then pass "processing_orders là số (=$D_PROC)"; else
  fail "processing_orders KHÔNG map được sang số (keys thực tế: $KEYS_SEEN). Chấp nhận processing_orders/processingOrders. Body: $(cat "$B2")"; fi
if is_int "$D_REV"; then pass "revenue_this_month là số (=$D_REV)"; else
  fail "revenue_this_month KHÔNG map được sang số (keys thực tế: $KEYS_SEEN). Chấp nhận revenue_this_month/revenueThisMonth. Body: $(cat "$B2")"; fi

# Nếu không map được cả 3 → dừng sớm, các assert delta vô nghĩa.
if ! is_int "$D_NEW" || ! is_int "$D_PROC" || ! is_int "$D_REV"; then
  echo ""; echo "RESULT: FAIL (không trích được 3 số từ dashboard — xem keys thực tế ở trên)"; exit 1
fi

# ===========================================================================
# Assert 3: new_leads đúng — seed N=3 leads status='new' → delta = 3.
#   Đồng thời lead status khác ('contacted') KHÔNG được cộng vào new_leads.
# ===========================================================================
echo "== [3] new_leads = baseline + N leads mới =="
BA="$WORKDIR/a3_before.b"; fetch_dash "$BA" >/dev/null; extract_all "$BA"; BASE_NEW="$D_NEW"
N_LEADS=3
for i in $(seq 1 "$N_LEADS"); do
  psql_do "INSERT INTO leads (name, phone, status, source) VALUES ('${LEAD_PREFIX}-new-${i}', '0900000000', 'new', 'website');" >/dev/null \
    || { echo "FATAL: không INSERT được lead seed"; exit 2; }
done
# 1 lead status='contacted' — KHÔNG được tính vào new_leads (đối chứng)
psql_do "INSERT INTO leads (name, phone, status, source) VALUES ('${LEAD_PREFIX}-contacted', '0900000000', 'contacted', 'website');" >/dev/null || true

AA="$WORKDIR/a3_after.b"; fetch_dash "$AA" >/dev/null; extract_all "$AA"; AFT_NEW="$D_NEW"
EXP_NEW=$((BASE_NEW + N_LEADS))
[[ "$AFT_NEW" == "$EXP_NEW" ]] \
  && pass "new_leads: $BASE_NEW → $AFT_NEW (delta=+$N_LEADS, lead 'contacted' KHÔNG cộng)" \
  || fail "new_leads: baseline=$BASE_NEW, sau seed +$N_LEADS 'new' (và 1 'contacted' không tính) = $AFT_NEW (kỳ vọng $EXP_NEW). Đếm sai leads status='new'."

# ===========================================================================
# Assert 4: processing_orders — chỉ đếm confirmed + delivering.
#   Seed 2 confirmed + 1 delivering (đếm=3); 1 new + 1 done + 1 cancelled
#   (KHÔNG đếm). delta processing = 3.
# ===========================================================================
echo "== [4] processing_orders = baseline + (confirmed+delivering); new/done/cancelled KHÔNG tính =="
BB="$WORKDIR/a4_before.b"; fetch_dash "$BB" >/dev/null; extract_all "$BB"; BASE_PROC="$D_PROC"
seed_order() { # code_suffix status total created_at_sql
  psql_do "INSERT INTO orders (code, channel, status, subtotal, discount, total, note, created_at)
           VALUES ('${ORDER_CODE_PREFIX}-$1', 'phone', '$2', $3, 0, $3, '${ORDER_NOTE}', $4);" >/dev/null \
    || { echo "FATAL: không INSERT được order seed ($1/$2)"; exit 2; }
}
# created_at = tháng trước (an toàn, không ảnh hưởng revenue tháng này)
PREV_MONTH="(now() - interval '40 days')"
seed_order "proc-conf-1"  "confirmed"  100000 "now()"
seed_order "proc-conf-2"  "confirmed"  100000 "now()"
seed_order "proc-deliv-1" "delivering" 100000 "now()"
seed_order "proc-new-1"   "new"        100000 "now()"
seed_order "proc-done-1"  "done"       100000 "$PREV_MONTH"
seed_order "proc-canc-1"  "cancelled"  100000 "now()"

AB="$WORKDIR/a4_after.b"; fetch_dash "$AB" >/dev/null; extract_all "$AB"; AFT_PROC="$D_PROC"
EXP_PROC=$((BASE_PROC + 3))
[[ "$AFT_PROC" == "$EXP_PROC" ]] \
  && pass "processing_orders: $BASE_PROC → $AFT_PROC (delta=+3 = 2 confirmed + 1 delivering; new/done/cancelled KHÔNG cộng)" \
  || fail "processing_orders: baseline=$BASE_PROC, seed 2 confirmed+1 delivering(=+3) và new/done/cancelled(=0) → $AFT_PROC (kỳ vọng $EXP_PROC). Đếm sai: chỉ status IN ('confirmed','delivering') được tính."

# ===========================================================================
# Assert 5: revenue_this_month — chỉ TỔNG total đơn 'done' TRONG tháng VN.
#   done 500000 giữa-tháng-VN (cộng) + done 999000 tháng-trước (KHÔNG) +
#   confirmed 777000 tháng-này (KHÔNG, chưa done). delta revenue = 500000.
# ===========================================================================
echo "== [5] revenue_this_month = baseline + 500000 (chỉ đơn done trong tháng VN) =="
BC="$WORKDIR/a5_before.b"; fetch_dash "$BC" >/dev/null; extract_all "$BC"; BASE_REV="$D_REV"
# Giữa tháng hiện tại theo GIỜ VN → unambiguous thuộc tháng này ở cả UTC lẫn VN.
MID_MONTH_VN="((date_trunc('month', (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) + interval '14 days 12 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh')"
REV_ADD=500000
seed_order "rev-done-thismonth" "done"      "$REV_ADD" "$MID_MONTH_VN"   # PHẢI cộng
seed_order "rev-done-prevmonth" "done"      999000     "$PREV_MONTH"      # KHÔNG cộng (tháng trước)
seed_order "rev-conf-thismonth" "confirmed" 777000     "now()"           # KHÔNG cộng (chưa done)

AC="$WORKDIR/a5_after.b"; fetch_dash "$AC" >/dev/null; extract_all "$AC"; AFT_REV="$D_REV"
EXP_REV=$((BASE_REV + REV_ADD))
[[ "$AFT_REV" == "$EXP_REV" ]] \
  && pass "revenue_this_month: $BASE_REV → $AFT_REV (delta=+$REV_ADD; done-tháng-trước & confirmed KHÔNG cộng)" \
  || fail "revenue_this_month: baseline=$BASE_REV, seed done-500000(tháng này, +) + done-999000(tháng trước, 0) + confirmed-777000(0) → $AFT_REV (kỳ vọng $EXP_REV). Revenue phải = SUM(total) WHERE status='done' AND created_at trong tháng hiện tại (giờ VN)."

# Đối chứng: nếu delta = 500000+999000 → impl KHÔNG lọc tháng.
if [[ "$AFT_REV" != "$EXP_REV" ]]; then
  if [[ "$AFT_REV" == "$((BASE_REV + REV_ADD + 999000))" ]]; then
    info "CHẨN ĐOÁN: delta bao gồm cả 999000 → impl KHÔNG lọc theo tháng (cộng cả đơn done tháng trước)."
  fi
  if [[ "$AFT_REV" == "$((BASE_REV + REV_ADD + 777000))" ]]; then
    info "CHẨN ĐOÁN: delta bao gồm cả 777000 → impl KHÔNG lọc status='done' (cộng cả confirmed)."
  fi
fi

# ---------------------------------------------------------------------------
echo ""
if [[ "$FAILS" -eq 0 ]]; then
  echo "RESULT: PASS (tất cả assert bắt buộc đạt)"; exit 0
else
  echo "RESULT: FAIL ($FAILS assert rớt)"; exit 1
fi
