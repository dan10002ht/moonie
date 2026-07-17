#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Giai đoạn 6 · Task 0b: Security deploy-gate
#   A. Header bảo mật toàn cục trên API (L6)
#   B. Chống CSRF defense-in-depth cho mutation admin (L4)
#   C. Seed chặn mật khẩu mặc định ở production (L?)
# Owner: qa-evaluator. GENERATOR MUST NOT READ, MODIFY OR RUN THIS FILE.
#   (CẤM generator đọc/sửa/chạy — file mã hóa hành vi DỰ ĐỊNH, không phản chiếu
#    implementation. Chỉ gọi qua HTTP surface + CLI binary public.)
#
# BLACK-BOX. Derived ONLY from:
#   - Task 0b Definition-of-Done (3 nhóm A/B/C).
#   - api/openapi.yaml: GET /products, GET /healthz, POST /auth/login,
#     GET /admin/me, POST /admin/products (mutation admin cần auth).
#   - Global constraints (CLAUDE.md): admin seed admin@mooni.local / mooni-admin,
#     cookie JWT httpOnly `mc_admin`, PORT env, CGO_ENABLED=0, Postgres 5440.
# KHÔNG đọc api/internal, cmd/server, cmd/seed impl (chỉ openapi + env + CLI).
#
# ---------------------------------------------------------------------------
# CONTRACT ASSUMPTIONS (nếu fail vì assumption, feedback rõ ở đây):
#   * Server đọc cổng lắng nghe từ env `PORT` (như docker-compose.yml).
#   * Header bảo mật là GLOBAL middleware → có mặt trên MỌI response
#     (success/error/404/uploads), value nằm trong whitelist an toàn phổ biến:
#       - X-Content-Type-Options: nosniff
#       - X-Frame-Options ∈ {DENY, SAMEORIGIN}   (DoD nêu DENY; chấp cả SAMEORIGIN)
#       - Referrer-Policy ∈ {no-referrer, strict-origin, same-origin,
#                            strict-origin-when-cross-origin,
#                            no-referrer-when-downgrade}
#   * CSRF Origin/Referer-check là defense-in-depth, BẬT không phụ thuộc APP_ENV.
#     Mutation admin (POST/PUT/PATCH/DELETE /api/v1/admin/*) đã xác thực hợp lệ
#     (cookie mc_admin thật) NHƯNG kèm `Origin: https://evil.example` → BỊ TỪ
#     CHỐI (mã 403). CÙNG request KHÔNG kèm Origin lạ → KHÔNG bị chặn bởi lớp
#     CSRF (đi tới handler → 400 do body sai, KHÔNG phải 403).
#     >> Nếu generator chọn SameSite-only (không Origin-check server-side) thì
#        nhóm B fail dù có thể an toàn ở tầng cookie — đây là điều DoD 0b YÊU CẦU
#        ("Origin/Referer check HOẶC double-submit CSRF cho mutation admin").
#        Có thể bỏ qua nhóm B CÓ KIỂM SOÁT bằng env HELDOUT_0B_CSRF_SKIP=1
#        (mặc định VẪN assert Origin-check).
#   * Seed binary `./cmd/seed`: guard đọc env `APP_ENV`. Khi APP_ENV=production
#     MÀ password vẫn default ('mooni-admin' — env SEED_ADMIN_PASSWORD unset HOẶC
#     bằng đúng 'mooni-admin') → seed TỪ CHỐI chạy (exit != 0, KHÔNG tạo admin).
#     APP_ENV=production + SEED_ADMIN_PASSWORD mạnh → exit 0, tạo admin.
#     Non-production (APP_ENV unset) → chạy bình thường.
#     Seed dùng email cố định admin@mooni.local + ON CONFLICT DO NOTHING → nhóm C
#     tự quản admin_users: xoá row trước từng ca, và KHÔI PHỤC admin mặc định
#     (mooni-admin) ở cuối để không phá các held-out test khác.
#
# ---------------------------------------------------------------------------
# MAP NHÓM → ASSERTIONS:
#   A (header bảo mật):  A1 GET /products, A2 GET /healthz, A3 404 route,
#                        A4 400 (POST /leads body sai), A5 /uploads/* — mỗi cái
#                        assert đủ 3 header trong whitelist.
#   B (CSRF):            B0 login default admin lấy cookie + /admin/me==200 (tiền
#                        đề), B1 mutation + evil Origin → 403, B2 mutation không
#                        Origin lạ → KHÔNG 403 (tới handler).
#   C (seed prod guard): C1 prod + no pass → exit!=0 & KHÔNG tạo, C2 prod +
#                        pass=mooni-admin → exit!=0 & KHÔNG tạo, C3 prod + pass
#                        mạnh → exit 0 & tạo, C4 dev(default) → exit 0 & tạo
#                        (đồng thời khôi phục admin mặc định).
#
# EXIT: 0 = tất cả PASS. 1 = có assertion FAIL. 2 = không test được (infra).
# Chạy: bash tests/heldout/giai-doan-6-task-0b-security_test.sh
# =============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PORT_API=18094
ADMIN_EMAIL="admin@mooni.local"
DEFAULT_PASS="mooni-admin"
STRONG_PASS="H3ldOut-0b-Str0ng!pw-7Q"

CSRF_SKIP="${HELDOUT_0B_CSRF_SKIP:-0}"

FAILS=0
BOOT_PID=""
WORKDIR="$(mktemp -d)"
SRV_BIN="$(mktemp -u /tmp/heldout-0b-server.XXXX)"
SEED_BIN="$(mktemp -u /tmp/heldout-0b-seed.XXXX)"
COOKIE_JAR="$WORKDIR/cookies.txt"

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

restore_default_admin() {
  # Xoá admin (dù password gì) rồi re-seed dev default (mooni-admin) để môi trường
  # trở lại trạng thái các held-out test khác kỳ vọng.
  psql "$DB_URL" -tA -c "DELETE FROM admin_users WHERE email='${ADMIN_EMAIL}';" >/dev/null 2>&1 || true
  ( cd "$REPO_ROOT/api"
    set -a; . "$REPO_ROOT/.env"; set +a
    unset APP_ENV; unset SEED_ADMIN_PASSWORD
    "$SEED_BIN" >/dev/null 2>&1 || true ) || true
}

cleanup() {
  [[ -n "$BOOT_PID" ]] && kill "$BOOT_PID" >/dev/null 2>&1 || true
  restore_default_admin
  rm -f "$SRV_BIN" "$SEED_BIN" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# whitelist helpers ---------------------------------------------------------
header_val() { # <headers_file> <header_name>  -> giá trị (lowercase, trimmed)
  grep -i "^$2:" "$1" 2>/dev/null | tail -1 | cut -d: -f2- | tr -d '\r' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]'
}
in_list() { # <needle> <space-separated list>
  local n="$1"; shift
  local x; for x in $1; do [[ "$n" == "$x" ]] && return 0; done; return 1
}

# ---------------------------------------------------------------------------
# 0. Infra: postgres + migrate + dev seed (admin mặc định cho nhóm B). Idempotent.
# ---------------------------------------------------------------------------
echo "== Boot infra (postgres + migrate + seed) =="
( cd "$REPO_ROOT" && make up >/dev/null 2>&1 ) || true
for i in $(seq 1 30); do psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && break; sleep 1; done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true
( cd "$REPO_ROOT" && make seed >/dev/null 2>&1 ) || true
if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.admin_users')" | grep -q admin_users; then
  echo "FATAL: bảng 'admin_users' chưa tồn tại — migration/seed chưa áp."; exit 2
fi

# ---------------------------------------------------------------------------
# 1. Build binaries (black-box: chỉ dùng cmd/* public entry).
# ---------------------------------------------------------------------------
echo "== Build server + seed binary =="
if ! ( cd "$REPO_ROOT/api" && GOTOOLCHAIN=local CGO_ENABLED=0 go build -o "$SRV_BIN" ./cmd/server ) 2>"$WORKDIR/build-srv.log"; then
  echo "FATAL: server KHÔNG build được."; cat "$WORKDIR/build-srv.log"; exit 1
fi
if ! ( cd "$REPO_ROOT/api" && GOTOOLCHAIN=local CGO_ENABLED=0 go build -o "$SEED_BIN" ./cmd/seed ) 2>"$WORKDIR/build-seed.log"; then
  echo "FATAL: seed KHÔNG build được."; cat "$WORKDIR/build-seed.log"; exit 1
fi

# boot server (dev env, PORT=$PORT_API)
boot_api() {
  [[ -n "$BOOT_PID" ]] && { kill "$BOOT_PID" >/dev/null 2>&1 || true; wait "$BOOT_PID" 2>/dev/null || true; BOOT_PID=""; }
  ( cd "$REPO_ROOT/api"
    set -a; . "$REPO_ROOT/.env"; set +a
    export PORT="$PORT_API"; unset APP_ENV
    exec "$SRV_BIN" >"$WORKDIR/api.log" 2>&1 ) &
  BOOT_PID=$!
  for i in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$PORT_API/api/v1/healthz" >/dev/null 2>&1 && return 0
    kill -0 "$BOOT_PID" >/dev/null 2>&1 || { echo "FATAL: server chết khi boot. Log:"; cat "$WORKDIR/api.log"; return 1; }
    sleep 0.5
  done
  echo "FATAL: server không sống tại port $PORT_API. Log:"; cat "$WORKDIR/api.log"; return 1
}

echo "== Boot API server =="
if ! boot_api; then exit 2; fi
BASE="http://127.0.0.1:$PORT_API/api/v1"

# ===========================================================================
# NHÓM A — Header bảo mật toàn cục.
# ===========================================================================
echo
echo "== A. Header bảo mật toàn cục =="
XFO_OK="deny sameorigin"
RP_OK="no-referrer strict-origin same-origin strict-origin-when-cross-origin no-referrer-when-downgrade"

check_headers() { # <label> <expect-code|any> <method> <path> <body|"">
  local label="$1" want="$2" method="$3" path="$4" body="$5"
  local hf="$WORKDIR/h.$RANDOM"
  local a=(-s -D "$hf" -o /dev/null -w '%{http_code}' --ipv4 -X "$method" "http://127.0.0.1:$PORT_API$path")
  [[ -n "$body" ]] && a+=(-H 'Content-Type: application/json' --data "$body")
  local code; code="$(curl "${a[@]}")"
  if [[ "$want" != "any" && "$code" != "$want" ]]; then
    info "$label: code=$code (kỳ vọng $want) — vẫn kiểm header"
  fi
  local xcto xfo rp ok=1
  xcto="$(header_val "$hf" X-Content-Type-Options)"
  xfo="$(header_val "$hf" X-Frame-Options)"
  rp="$(header_val "$hf" Referrer-Policy)"
  [[ "$xcto" == "nosniff" ]] || { fail "$label [$path code=$code]: X-Content-Type-Options='$xcto' (cần 'nosniff')"; ok=0; }
  if [[ -z "$xfo" ]] || ! in_list "$xfo" "$XFO_OK"; then
    fail "$label [$path code=$code]: X-Frame-Options='$xfo' (cần ∈ {DENY,SAMEORIGIN})"; ok=0
  fi
  if [[ -z "$rp" ]] || ! in_list "$rp" "$RP_OK"; then
    fail "$label [$path code=$code]: Referrer-Policy='$rp' (cần ∈ whitelist an toàn)"; ok=0
  fi
  [[ "$ok" == 1 ]] && pass "$label [$path code=$code]: đủ 3 header (nosniff / $xfo / $rp)"
}

check_headers "A1 products(200)" 200 GET  "/api/v1/products"            ""
check_headers "A2 healthz(200)"  200 GET  "/api/v1/healthz"             ""
check_headers "A3 notfound(404)" 404 GET  "/api/v1/khong-ton-tai-xyz"  ""
check_headers "A4 leads(400)"    400 POST "/api/v1/leads"              '{}'
check_headers "A5 uploads(*)"    any GET  "/uploads/heldout-0b-none.jpg" ""

# ===========================================================================
# NHÓM B — CSRF defense-in-depth cho mutation admin.
# ===========================================================================
echo
echo "== B. CSRF Origin-check cho mutation admin =="
if [[ "$CSRF_SKIP" == "1" ]]; then
  info "HELDOUT_0B_CSRF_SKIP=1 → BỎ QUA nhóm B (generator dùng SameSite-only?)."
else
  # B0: login default admin → cookie; /admin/me == 200 (tiền đề).
  LOGIN_CODE="$(curl -s -o "$WORKDIR/login.json" -w '%{http_code}' -c "$COOKIE_JAR" \
      -X POST -H 'Content-Type: application/json' \
      --data "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${DEFAULT_PASS}\"}" \
      "$BASE/auth/login")"
  ME_CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" "$BASE/admin/me")"
  if [[ "$LOGIN_CODE" == "200" && "$ME_CODE" == "200" ]]; then
    pass "B0 tiền đề: login default admin 200 + /admin/me 200 (cookie hợp lệ)"

    MUT_PATH="$BASE/admin/products"
    BAD_BODY='{"name":"","slug":"","price":-1,"type":"bad","status":"bad"}'

    # B1: mutation + evil Origin → 403 (bị lớp CSRF chặn TRƯỚC handler).
    B1_CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" \
        -X POST -H 'Content-Type: application/json' \
        -H 'Origin: https://evil.example' \
        --data "$BAD_BODY" "$MUT_PATH")"
    if [[ "$B1_CODE" == "403" ]]; then
      pass "B1: mutation admin + Origin evil.example → 403 (CSRF Origin-check chặn)"
    else
      fail "B1: mutation admin + Origin evil.example → code=$B1_CODE (kỳ vọng 403). Thiếu Origin/Referer-check server-side cho mutation admin (defense-in-depth). Nếu chủ đích SameSite-only, chạy lại với HELDOUT_0B_CSRF_SKIP=1."
    fi

    # B2: cùng mutation KHÔNG Origin lạ → KHÔNG bị lớp CSRF chặn (tới handler → 400).
    B2_CODE="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_JAR" \
        -X POST -H 'Content-Type: application/json' \
        --data "$BAD_BODY" "$MUT_PATH")"
    if [[ "$B2_CODE" != "403" && "$B2_CODE" != "401" ]]; then
      pass "B2: mutation admin KHÔNG Origin lạ → code=$B2_CODE (qua lớp CSRF, tới handler; không 403/401)"
    else
      fail "B2: mutation admin KHÔNG Origin lạ → code=$B2_CODE (KHÔNG được là 403/401). Lớp CSRF chặn nhầm request hợp lệ same-site."
    fi
  else
    fail "B0 tiền đề THẤT BẠI: login=$LOGIN_CODE, /admin/me=$ME_CODE (cần 200/200). Không chấm được nhóm B — kiểm tra admin seed default + auth."
  fi
fi

# tắt server trước nhóm C (nhóm C chỉ cần DB + seed binary).
[[ -n "$BOOT_PID" ]] && { kill "$BOOT_PID" >/dev/null 2>&1 || true; wait "$BOOT_PID" 2>/dev/null || true; BOOT_PID=""; }

# ===========================================================================
# NHÓM C — Seed chặn mật khẩu mặc định ở production.
# ===========================================================================
echo
echo "== C. Seed production guard (đổi mật khẩu admin bắt buộc) =="

admin_exists() { psql "$DB_URL" -tAc "SELECT 1 FROM admin_users WHERE email='${ADMIN_EMAIL}'" 2>/dev/null | grep -q 1; }
del_admin()   { psql "$DB_URL" -tA -c "DELETE FROM admin_users WHERE email='${ADMIN_EMAIL}';" >/dev/null 2>&1 || true; }

# run_seed <app_env|""> <seed_pass|"__UNSET__">  -> echo exit code
run_seed() {
  local appenv="$1" spass="$2"
  ( cd "$REPO_ROOT/api"
    set -a; . "$REPO_ROOT/.env"; set +a
    if [[ -n "$appenv" ]]; then export APP_ENV="$appenv"; else unset APP_ENV; fi
    if [[ "$spass" == "__UNSET__" ]]; then unset SEED_ADMIN_PASSWORD; else export SEED_ADMIN_PASSWORD="$spass"; fi
    "$SEED_BIN" >/dev/null 2>&1 )
  echo $?
}

# C1: production + password mặc định (unset) → phải TỪ CHỐI, KHÔNG tạo.
del_admin
C1_EXIT="$(run_seed production __UNSET__)"
if [[ "$C1_EXIT" != "0" ]] && ! admin_exists; then
  pass "C1: APP_ENV=production + SEED_ADMIN_PASSWORD unset → exit=$C1_EXIT (!=0) & KHÔNG tạo admin"
else
  fail "C1: APP_ENV=production + password mặc định → exit=$C1_EXIT, admin_exists=$(admin_exists && echo yes || echo no). Seed PHẢI từ chối (exit!=0) và KHÔNG tạo admin với mật khẩu mặc định."
fi

# C2: production + SEED_ADMIN_PASSWORD='mooni-admin' (đúng chuỗi default) → TỪ CHỐI.
del_admin
C2_EXIT="$(run_seed production "$DEFAULT_PASS")"
if [[ "$C2_EXIT" != "0" ]] && ! admin_exists; then
  pass "C2: APP_ENV=production + SEED_ADMIN_PASSWORD='mooni-admin' → exit=$C2_EXIT (!=0) & KHÔNG tạo admin"
else
  fail "C2: APP_ENV=production + password='mooni-admin' → exit=$C2_EXIT, admin_exists=$(admin_exists && echo yes || echo no). Guard PHẢI nhận diện đúng chuỗi 'mooni-admin' là mặc định và từ chối."
fi

# C3: production + password MẠNH → chạy bình thường (exit 0, tạo admin).
del_admin
C3_EXIT="$(run_seed production "$STRONG_PASS")"
if [[ "$C3_EXIT" == "0" ]] && admin_exists; then
  pass "C3: APP_ENV=production + SEED_ADMIN_PASSWORD mạnh → exit=0 & admin được tạo"
else
  fail "C3: APP_ENV=production + password mạnh → exit=$C3_EXIT, admin_exists=$(admin_exists && echo yes || echo no). Với mật khẩu mạnh, seed PHẢI chạy bình thường (exit 0, tạo admin)."
fi

# C4: non-production (APP_ENV unset) + password mặc định → KHÔNG bị chặn (exit 0)
#     ĐỒNG THỜI khôi phục admin mặc định (mooni-admin) cho môi trường.
del_admin
C4_EXIT="$(run_seed "" __UNSET__)"
if [[ "$C4_EXIT" == "0" ]] && admin_exists; then
  pass "C4: APP_ENV unset (dev) + password mặc định → exit=0 & admin tạo (guard KHÔNG chặn dev)"
else
  fail "C4: dev + password mặc định → exit=$C4_EXIT, admin_exists=$(admin_exists && echo yes || echo no). Guard chỉ được chặn ở production, KHÔNG được chặn dev."
fi

# ===========================================================================
echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "== HELD-OUT TASK 0b (security deploy-gate): TẤT CẢ PASS =="
  exit 0
else
  echo "== HELD-OUT TASK 0b (security deploy-gate): $FAILS ASSERTION FAIL =="
  exit 1
fi
