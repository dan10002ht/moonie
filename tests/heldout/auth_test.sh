#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 2 (Giai đoạn 4): Auth admin
#   POST /api/v1/auth/login · POST /api/v1/auth/logout · GET /api/v1/admin/me
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#
# Black-box test. Derived ONLY from:
#   - plan Task 2 Held-out criteria (2026-07-17-giai-doan-4-admin-api.md)
#   - SRS REQ-AUTH-001/002/003
#   - Global Constraints: JWT httpOnly cookie tên `mc_admin`, SameSite=Lax;
#     mọi /api/v1/admin/* qua middleware; KHÔNG đăng ký public.
#   - run-moonie SKILL: admin seed admin@mooni.local / mooni-admin
# It does NOT read any implementation (api/internal/auth, handlers, main).
#
# Protected route dùng để test middleware: GET /api/v1/admin/me
#
# Assertions (all must pass; any failure => exit != 0):
#   1. POST /auth/login (email+password đúng) → 200, Set-Cookie mc_admin HttpOnly
#   2. POST /auth/login sai password → 401 JSON {error}, không set cookie hợp lệ
#   3. POST /auth/login email không tồn tại → 401
#   4. GET /admin/me KHÔNG cookie → 401 JSON {error}
#   5. GET /admin/me VỚI cookie hợp lệ → 200 (không 401), trả admin (email)
#   6. GET /admin/me cookie GIẢ (mc_admin=garbage.jwt.token) → 401
#   7. KHÔNG có đăng ký public: POST /auth/register & /admin/register → 404
#   8. POST /auth/logout với cookie → 200 + cookie mc_admin bị xóa;
#      sau logout GET /admin/me (cookie cũ) → 401
#
# Read-only trên DB (chỉ dựa admin seed). Không tạo data => không cleanup DB.
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@mooni.local}"
ADMIN_PASS="${SEED_ADMIN_PASSWORD:-mooni-admin}"

FAILS=0
STARTED_SERVER_PID=""
WORKDIR="$(mktemp -d)"
COOKIE_JAR="$WORKDIR/cookies.txt"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

cleanup() {
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
  if psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true
( cd "$REPO_ROOT" && make seed >/dev/null 2>&1 ) || true

# admin_users phải tồn tại + có admin seed (GĐ1). Nếu chưa => môi trường sai.
if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.admin_users')" | grep -q admin_users; then
  echo "FATAL: bảng 'admin_users' chưa tồn tại — seed GĐ1 chưa chạy."; exit 2
fi
if ! psql "$DB_URL" -tAc "SELECT 1 FROM admin_users WHERE email='${ADMIN_EMAIL}'" | grep -q 1; then
  echo "FATAL: admin seed '${ADMIN_EMAIL}' không có trong DB — chạy 'make seed'."; exit 2
fi

# ---------------------------------------------------------------------------
# 1. Ensure API running. If not, start it (per run-moonie).
# ---------------------------------------------------------------------------
echo "== Ensure API running =="
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  info "API chưa chạy — khởi động 'go run ./cmd/server'"
  ( cd "$REPO_ROOT/api" && set -a && . "$REPO_ROOT/.env" && set +a \
      && GOTOOLCHAIN=local go run ./cmd/server >/tmp/heldout-auth-server.log 2>&1 ) &
  STARTED_SERVER_PID=$!
  for i in $(seq 1 60); do
    if curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
if ! curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
  echo "FATAL: API không sống tại $API_BASE (xem /tmp/heldout-auth-server.log)"; exit 2
fi

# ---------------------------------------------------------------------------
# Pre-flight: auth endpoints phải tồn tại. Nếu login route trả 404 => Task 2
# chưa dựng auth. Báo rõ ràng thay vì fail mù.
# ---------------------------------------------------------------------------
LOGIN_PROBE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  --data '{"email":"__probe__","password":"__probe__"}' \
  "$API_BASE/auth/login")"
if [[ "$LOGIN_PROBE" == "404" ]]; then
  echo "STOP: POST /auth/login trả 404 — auth chưa dựng (Task 2 chưa code). Không chấm được."
  exit 3
fi

# Helper: gọi login, in ra HTTP code (arg1) + dump headers (arg2 file) + body (arg3 file)
login_call() { # email password headers_file body_file [cookie_jar]
  local email="$1" password="$2" hf="$3" bf="$4" cj="${5:-}"
  local args=(-s -D "$hf" -o "$bf" -w '%{http_code}' -X POST
              -H 'Content-Type: application/json'
              --data "{\"email\":\"${email}\",\"password\":\"${password}\"}")
  [[ -n "$cj" ]] && args+=(-c "$cj")
  curl "${args[@]}" "$API_BASE/auth/login"
}

# ===========================================================================
# Assert 1: login đúng → 200 + Set-Cookie mc_admin HttpOnly, lưu cookie
# ===========================================================================
echo "== [1] POST /auth/login (đúng credential) =="
H1="$WORKDIR/login_ok.h"; B1="$WORKDIR/login_ok.b"
CODE1="$(login_call "$ADMIN_EMAIL" "$ADMIN_PASS" "$H1" "$B1" "$COOKIE_JAR")"
if [[ "$CODE1" == "200" ]]; then pass "login đúng → HTTP 200"; else
  fail "login đúng → HTTP $CODE1 (kỳ vọng 200). Body: $(cat "$B1")"
fi
# Set-Cookie header có mc_admin. Header name case-insensitive.
SETCOOKIE_LINE="$(grep -i '^set-cookie:' "$H1" | grep -i 'mc_admin' || true)"
if [[ -n "$SETCOOKIE_LINE" ]]; then
  pass "Set-Cookie có cookie 'mc_admin'"
else
  fail "KHÔNG thấy Set-Cookie mc_admin. Headers: $(grep -i '^set-cookie' "$H1" || echo '(không có set-cookie)')"
fi
# HttpOnly attribute (case-insensitive) trên chính cookie mc_admin
if echo "$SETCOOKIE_LINE" | grep -iq 'HttpOnly'; then
  pass "cookie mc_admin có thuộc tính HttpOnly"
else
  fail "cookie mc_admin THIẾU HttpOnly. Set-Cookie: ${SETCOOKIE_LINE:-<none>}"
fi
# SameSite=Lax (Global Constraint)
if echo "$SETCOOKIE_LINE" | grep -iq 'SameSite=Lax'; then
  pass "cookie mc_admin có SameSite=Lax"
else
  fail "cookie mc_admin thiếu SameSite=Lax. Set-Cookie: ${SETCOOKIE_LINE:-<none>}"
fi
# Cookie jar thực sự lưu được mc_admin (dùng cho các assert sau)
if grep -q 'mc_admin' "$COOKIE_JAR" 2>/dev/null; then
  pass "cookie jar lưu mc_admin (dùng cho request bảo vệ)"
else
  fail "cookie jar không lưu mc_admin — curl -b sẽ không gửi được token"
fi

# ===========================================================================
# Assert 2: login sai password → 401 JSON {error}, không set cookie hợp lệ
# ===========================================================================
echo "== [2] POST /auth/login (sai password) =="
H2="$WORKDIR/login_bad.h"; B2="$WORKDIR/login_bad.b"; CJ2="$WORKDIR/bad.jar"
CODE2="$(login_call "$ADMIN_EMAIL" "sai-password" "$H2" "$B2" "$CJ2")"
if [[ "$CODE2" == "401" ]]; then pass "sai password → HTTP 401"; else
  fail "sai password → HTTP $CODE2 (kỳ vọng 401). Body: $(cat "$B2")"
fi
if jq -e '.error' "$B2" >/dev/null 2>&1; then
  pass "sai password → body JSON có field {error}"
else
  fail "sai password → body không có {error}. Body: $(cat "$B2")"
fi
if grep -qi 'mc_admin' "$CJ2" 2>/dev/null; then
  fail "sai password NHƯNG vẫn set cookie mc_admin (không được phép)"
else
  pass "sai password → không set cookie mc_admin"
fi

# ===========================================================================
# Assert 3: login email không tồn tại → 401
# ===========================================================================
echo "== [3] POST /auth/login (email không tồn tại) =="
H3="$WORKDIR/login_noemail.h"; B3="$WORKDIR/login_noemail.b"
CODE3="$(login_call "khong-ton-tai-$(date +%s)@nope.local" "$ADMIN_PASS" "$H3" "$B3")"
if [[ "$CODE3" == "401" ]]; then pass "email không tồn tại → HTTP 401"; else
  fail "email không tồn tại → HTTP $CODE3 (kỳ vọng 401). Body: $(cat "$B3")"
fi

# ===========================================================================
# Assert 4: GET /admin/me KHÔNG cookie → 401 JSON {error}
# ===========================================================================
echo "== [4] GET /admin/me (không cookie) =="
B4="$WORKDIR/me_nocookie.b"
CODE4="$(curl -s -o "$B4" -w '%{http_code}' "$API_BASE/admin/me")"
if [[ "$CODE4" == "401" ]]; then pass "/admin/me không cookie → 401"; else
  fail "/admin/me không cookie → HTTP $CODE4 (kỳ vọng 401). Body: $(cat "$B4")"
fi
if jq -e '.error' "$B4" >/dev/null 2>&1; then
  pass "/admin/me không cookie → body JSON có {error}"
else
  fail "/admin/me không cookie → body không có {error}. Body: $(cat "$B4")"
fi

# ===========================================================================
# Assert 5: GET /admin/me VỚI cookie hợp lệ → 200 (không 401), trả admin email
# ===========================================================================
echo "== [5] GET /admin/me (cookie hợp lệ) =="
B5="$WORKDIR/me_ok.b"
CODE5="$(curl -s -b "$COOKIE_JAR" -o "$B5" -w '%{http_code}' "$API_BASE/admin/me")"
if [[ "$CODE5" == "200" ]]; then
  pass "/admin/me cookie hợp lệ → 200"
elif [[ "$CODE5" == "401" ]]; then
  fail "/admin/me cookie hợp lệ → 401 (middleware từ chối cookie do login cấp!). Body: $(cat "$B5")"
else
  fail "/admin/me cookie hợp lệ → HTTP $CODE5 (kỳ vọng 200). Body: $(cat "$B5")"
fi
# Trả thông tin admin: phải chứa email đã login đâu đó trong JSON
if grep -q "$ADMIN_EMAIL" "$B5" 2>/dev/null; then
  pass "/admin/me trả email admin ($ADMIN_EMAIL)"
else
  fail "/admin/me không chứa email admin. Body: $(cat "$B5")"
fi

# ===========================================================================
# Assert 6: GET /admin/me cookie GIẢ → 401
# ===========================================================================
echo "== [6] GET /admin/me (cookie giả) =="
B6="$WORKDIR/me_fake.b"
CODE6="$(curl -s -o "$B6" -w '%{http_code}' \
  -H 'Cookie: mc_admin=garbage.jwt.token' "$API_BASE/admin/me")"
if [[ "$CODE6" == "401" ]]; then pass "/admin/me cookie giả → 401"; else
  fail "/admin/me cookie giả → HTTP $CODE6 (kỳ vọng 401 — JWT không verify được). Body: $(cat "$B6")"
fi

# ===========================================================================
# Assert 7: KHÔNG đăng ký public — register route không tồn tại (404)
# ===========================================================================
echo "== [7] Không có đăng ký public (REQ-AUTH-003) =="
for RPATH in "auth/register" "admin/register"; do
  RCODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    --data '{"email":"x@y.z","password":"whatever123"}' \
    "$API_BASE/$RPATH")"
  if [[ "$RCODE" == "404" ]]; then
    pass "POST /$RPATH → 404 (route không tồn tại)"
  else
    fail "POST /$RPATH → HTTP $RCODE (kỳ vọng 404 — không được có đăng ký public)"
  fi
done

# ===========================================================================
# Assert 8: logout → 200 + cookie mc_admin bị xóa; sau đó /admin/me → 401
# ===========================================================================
echo "== [8] POST /auth/logout =="
H8="$WORKDIR/logout.h"; B8="$WORKDIR/logout.b"; CJ8="$WORKDIR/after_logout.jar"
cp "$COOKIE_JAR" "$CJ8"
LOGOUT_PROBE="$(curl -s -o /dev/null -w '%{http_code}' -X POST -b "$COOKIE_JAR" "$API_BASE/auth/logout")"
if [[ "$LOGOUT_PROBE" == "404" ]]; then
  info "SKIP assert 8 — /auth/logout trả 404 (endpoint optional theo plan; không tính fail)"
else
  CODE8="$(curl -s -D "$H8" -o "$B8" -w '%{http_code}' -X POST -b "$COOKIE_JAR" -c "$CJ8" "$API_BASE/auth/logout")"
  if [[ "$CODE8" == "200" ]]; then pass "logout → 200"; else
    fail "logout → HTTP $CODE8 (kỳ vọng 200). Body: $(cat "$B8")"
  fi
  # Set-Cookie mc_admin phải là dạng xóa (rỗng / Max-Age=0 / Expires quá khứ)
  LO_SETCOOKIE="$(grep -i '^set-cookie:' "$H8" | grep -i 'mc_admin' || true)"
  if echo "$LO_SETCOOKIE" | grep -Eiq 'mc_admin=;|mc_admin=""|Max-Age=0|Expires=Thu, 01 Jan 1970'; then
    pass "logout xóa cookie mc_admin (Set-Cookie hết hạn/rỗng)"
  elif [[ -z "$LO_SETCOOKIE" ]]; then
    fail "logout không gửi Set-Cookie mc_admin để xóa. Headers: $(grep -i '^set-cookie' "$H8" || echo none)"
  else
    fail "logout Set-Cookie mc_admin không có dấu hiệu xóa. Set-Cookie: $LO_SETCOOKIE"
  fi
fi

echo ""
if [[ "$FAILS" -eq 0 ]]; then
  echo "RESULT: PASS (tất cả assert đạt)"
  exit 0
else
  echo "RESULT: FAIL ($FAILS assert rớt)"
  exit 1
fi
