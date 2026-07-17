#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Giai đoạn 6 · Task 0: Rate-limit theo IP CLIENT
#   thật sau reverse proxy (real client IP extraction từ X-Forwarded-For).
# Owner: qa-evaluator. GENERATOR MUST NOT READ, MODIFY OR RUN THIS FILE.
#   (CẤM generator đọc/sửa/chạy — file mã hóa hành vi DỰ ĐỊNH, không phản chiếu
#    implementation. Nó chỉ gọi qua HTTP surface public của server binary.)
#
# BLACK-BOX. Boot server THẬT (go build ./cmd/server → binary) trên các cổng
# cô lập với các cấu hình TRUSTED_PROXIES khác nhau, rồi giả lập reverse proxy
# bằng cách gắn header `X-Forwarded-For`. RemoteAddr của mọi request = loopback
# (127.0.0.1) vì test là client TCP thật tới 127.0.0.1 — ta điều khiển "server
# có coi loopback là trusted proxy hay không" bằng env TRUSTED_PROXIES.
#
# Derived ONLY from:
#   - Task 0 Definition-of-Done (real client IP behind proxy) — 4 hành vi.
#   - REQ NFR-006 (rate-limit /leads chống spam), M1 (rate-limit login
#     chống brute-force).
#   - api/openapi.yaml: POST /leads (201/400/429), POST /auth/login (200/401).
# KHÔNG đọc bất kỳ file trong api/internal, cmd/server (chỉ dùng openapi + env).
#
# ---------------------------------------------------------------------------
# CONTRACT ASSUMPTIONS (nếu fail vì assumption, feedback rõ ở đây):
#   * Env cấu hình trusted proxy tên `TRUSTED_PROXIES`, là DANH SÁCH phân tách
#     bằng dấu phẩy các dải CIDR (chuẩn set_real_ip_from của Caddy/nginx).
#     Test dùng "127.0.0.1/32,::1/128" để coi loopback là trusted.
#   * Header client-IP chuẩn là `X-Forwarded-For` (danh sách "ip1, ip2, ...").
#     IP client thật = IP KHÔNG-trusted NGOÀI CÙNG BÊN PHẢI (rightmost non-trusted).
#   * Server đọc cổng lắng nghe từ env `PORT` (đúng như docker-compose.yml).
#   * Ngưỡng rate-limit ≤ ~50 request/phút cho cả /leads và /auth/login
#     (NFR-006 nêu 20/phút). Test bùng nổ 60 request → phải chạm ngưỡng.
#   * Rate-limit là middleware chạy TRƯỚC handler (đếm cả request lỗi 400/401).
#
# ---------------------------------------------------------------------------
# MAP HÀNH VI (DoD 1-4) → ASSERTIONS:
#   Hành vi 1 (CÓ trusted proxy → dùng XFF, tách client, gộp cùng client):
#       CONFIG-LB: A1 (gộp cùng XFF → chạm 429), A2 (client khác KHÔNG bị chặn),
#                  A3 (client A vẫn bị chặn), D1 (rightmost-non-trusted: đổi phần
#                  XFF bịa bên trái KHÔNG tạo bucket mới → vẫn 429),
#                  D2 (đổi hop bịa, giữ client thật → vẫn 429),
#                  D3 (đổi client thật → KHÔNG bị chặn),
#                  A4a/A4b (áp cho /leads: gộp→429 & tách client).
#   Hành vi 2 (KHÔNG từ trusted proxy → BỎ QUA XFF, khoá RemoteAddr):
#       CONFIG-NLB (trusted = dải KHÔNG chứa loopback):
#                  B1 (login xoay XFF mỗi request → VẪN chạm 429 vì XFF bị bỏ),
#                  B2 (leads xoay XFF → VẪN 429).
#   Hành vi 3 (KHÔNG cấu hình trusted → mặc định khoá RemoteAddr, bỏ XFF):
#       CONFIG-EMPTY (TRUSTED_PROXIES unset):
#                  C1 (login xoay XFF → VẪN 429), C2 (leads xoay XFF → VẪN 429).
#   Hành vi 4 (áp CẢ /leads VÀ /auth/login):
#       login 429 chứng minh ở A1/B1/C1; leads 429 ở A4a/B2/C2.
#
# EXIT: 0 = tất cả PASS. 1 = có assertion FAIL. 2 = không test được (infra).
# Chạy: bash tests/heldout/giai-doan-6-task-0-real-ip_test.sh
# =============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME_PREFIX="heldout-t0-"

PORT_LB=18091      # CONFIG-LB   : loopback IS trusted proxy
PORT_NLB=18092     # CONFIG-NLB  : trusted = non-loopback range only
PORT_EMPTY=18093   # CONFIG-EMPTY: no trusted proxy configured

LOGIN_BURST=60
LEADS_BURST=60

BIN="$(mktemp -u /tmp/heldout-t0-server.XXXX)"
WORKDIR="$(mktemp -d)"
LOG_LB="$WORKDIR/lb.log"; LOG_NLB="$WORKDIR/nlb.log"; LOG_EMPTY="$WORKDIR/empty.log"

FAILS=0
BOOT_PID=""

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

cleanup() {
  [[ -n "$BOOT_PID" ]] && kill "$BOOT_PID" >/dev/null 2>&1 || true
  info "cleanup: xóa lead test (name LIKE '${NAME_PREFIX}%')"
  psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true
  rm -f "$BIN" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Infra: postgres + migrate (per run-moonie). Idempotent.
# ---------------------------------------------------------------------------
echo "== Boot infra (postgres + migrate) =="
( cd "$REPO_ROOT" && make up >/dev/null 2>&1 ) || true
for i in $(seq 1 30); do psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && break; sleep 1; done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true
if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.leads')" | grep -q leads; then
  echo "FATAL: bảng 'leads' chưa tồn tại — migration leads chưa áp."; exit 2
fi
psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 1. Build server binary MỘT lần (black-box: chỉ dùng cmd/server public entry).
# ---------------------------------------------------------------------------
echo "== Build server binary =="
if ! ( cd "$REPO_ROOT/api" && GOTOOLCHAIN=local CGO_ENABLED=0 go build -o "$BIN" ./cmd/server ) 2>"$WORKDIR/build.log"; then
  echo "FATAL: server KHÔNG build được — feature không giao được."; cat "$WORKDIR/build.log"; exit 1
fi

# boot <port> <log> <trusted-proxies-or-empty>
# Nếu trusted rỗng => UNSET env TRUSTED_PROXIES (kịch bản mặc định/dev).
boot() {
  local port="$1" log="$2" trusted="$3"
  [[ -n "$BOOT_PID" ]] && { kill "$BOOT_PID" >/dev/null 2>&1 || true; wait "$BOOT_PID" 2>/dev/null || true; BOOT_PID=""; }
  : > "$log"
  (
    cd "$REPO_ROOT/api"
    set -a; . "$REPO_ROOT/.env"; set +a
    export PORT="$port"
    if [[ -n "$trusted" ]]; then export TRUSTED_PROXIES="$trusted"; else unset TRUSTED_PROXIES; fi
    exec "$BIN" >"$log" 2>&1
  ) &
  BOOT_PID=$!
  for i in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$port/api/v1/healthz" >/dev/null 2>&1 && return 0
    kill -0 "$BOOT_PID" >/dev/null 2>&1 || { echo "FATAL: server chết khi boot (port $port). Log:"; cat "$log"; return 1; }
    sleep 0.5
  done
  echo "FATAL: server không sống tại port $port. Log:"; cat "$log"; return 1
}

# req_code <port> <path> <method> <body|""> <xff|"">  -> echo http_code
req_code() {
  local port="$1" path="$2" method="$3" body="$4" xff="$5"
  local a=(-s -o /dev/null -w '%{http_code}' --ipv4 -X "$method" "http://127.0.0.1:$port$path")
  [[ -n "$body" ]] && a+=(-H 'Content-Type: application/json' --data "$body")
  [[ -n "$xff" ]] && a+=(-H "X-Forwarded-For: $xff")
  curl "${a[@]}"
}

login_body() { printf '{"email":"heldout-t0@nobody.local","password":"wrong-password-000000"}'; }
leads_body() { jq -nc --arg n "${NAME_PREFIX}$1" '{name:$n, phone:"0912345678", message:"heldout-t0 rate-limit probe", product_interest:"Nguyệt Quang Kim"}'; }

# xff_for <mode> <i> : sinh giá trị X-Forwarded-For cho iteration i.
#   fixed:IP            -> luôn IP
#   rotate              -> IP duy nhất mỗi request (client khác nhau)
#   spoofrot:REAL       -> "10.i.i.i, REAL, 127.0.0.1" (đổi hop BỊA bên trái,
#                          giữ nguyên client thật rightmost-non-trusted = REAL)
xff_for() {
  local mode="$1" i="$2" b
  b=$(( (i % 250) + 1 ))
  case "$mode" in
    fixed:*)    printf '%s' "${mode#fixed:}";;
    rotate)     printf '203.0.113.%s' "$b";;
    spoofrot:*) printf '10.%s.%s.%s, %s, 127.0.0.1' "$b" "$b" "$b" "${mode#spoofrot:}";;
  esac
}

# burst <port> <path> <bodyfn> <mode> <n>  -> echo số lần nhận 429
burst() {
  local port="$1" path="$2" bodyfn="$3" mode="$4" n="$5" i code xff got=0
  for ((i=1;i<=n;i++)); do
    xff="$(xff_for "$mode" "$i")"
    code="$(req_code "$port" "$path" POST "$($bodyfn "$i")" "$xff")"
    [[ "$code" == "429" ]] && got=$((got+1))
  done
  echo "$got"
}

LOGIN_PATH="/api/v1/auth/login"
LEADS_PATH="/api/v1/leads"

# ===========================================================================
# CONFIG-LB — loopback LÀ trusted proxy → server phải dùng XFF làm client IP.
# ===========================================================================
echo
echo "== CONFIG-LB (TRUSTED_PROXIES=127.0.0.1/32,::1/128) =="
if ! boot "$PORT_LB" "$LOG_LB" "127.0.0.1/32,::1/128"; then exit 2; fi

# --- A1: gộp cùng một client (cùng XFF) → chạm 429 (login) [Hành vi 1 & 4] ---
A1_429="$(burst "$PORT_LB" "$LOGIN_PATH" login_body "fixed:203.0.113.100" "$LOGIN_BURST")"
if [[ "$A1_429" -ge 1 ]]; then
  pass "A1 login: cùng XFF client 203.0.113.100 vượt ngưỡng → có $A1_429 lần 429"
else
  fail "A1 login: bùng nổ $LOGIN_BURST req cùng XFF nhưng KHÔNG có 429 (rate-limit không khoá theo client IP từ XFF, hoặc ngưỡng > $LOGIN_BURST)"
fi

# --- A2: client KHÁC (XFF khác) KHÔNG bị chặn [Hành vi 1: tách client] ---
A2_CODE="$(req_code "$PORT_LB" "$LOGIN_PATH" POST "$(login_body)" "203.0.113.200")"
if [[ "$A2_CODE" != "429" ]]; then
  pass "A2 login: client mới 203.0.113.200 KHÔNG bị 429 (code=$A2_CODE) → bucket tách theo client"
else
  fail "A2 login: client mới 203.0.113.200 bị 429 → rate-limit KHÔNG tách theo IP client (đang khoá chung RemoteAddr loopback, XFF bị bỏ)"
fi

# --- A3: client A vẫn bị chặn (bucket per-client bền) [Hành vi 1] ---
A3_CODE="$(req_code "$PORT_LB" "$LOGIN_PATH" POST "$(login_body)" "203.0.113.100")"
if [[ "$A3_CODE" == "429" ]]; then
  pass "A3 login: client 203.0.113.100 vẫn bị 429 → bucket đúng theo client IP"
else
  fail "A3 login: client 203.0.113.100 lẽ ra vẫn bị chặn nhưng code=$A3_CODE"
fi

# --- D1: rightmost-non-trusted — đổi hop BỊA bên trái KHÔNG lách được limit ---
# spoofrot: leftmost 10.i.i.i xoay liên tục, client thật (rightmost non-trusted)
# cố định = 203.0.113.55. Nếu impl lấy leftmost → 60 IP khác nhau → 0 lần 429.
# Nếu impl lấy rightmost-non-trusted đúng → tất cả khoá 203.0.113.55 → chạm 429.
D1_429="$(burst "$PORT_LB" "$LOGIN_PATH" login_body "spoofrot:203.0.113.55" "$LOGIN_BURST")"
if [[ "$D1_429" -ge 1 ]]; then
  pass "D1 login: đổi hop bịa bên trái XFF KHÔNG tạo bucket mới → $D1_429 lần 429 (rightmost-non-trusted đúng)"
else
  fail "D1 login: xoay phần XFF bịa (kẻ tấn công prepend IP) lách được rate-limit → impl lấy SAI IP client (không phải rightmost-non-trusted)"
fi

# --- D2: giữ client thật, chỉ đổi hop bịa → VẪN bị chặn [Hành vi 1] ---
D2_CODE="$(req_code "$PORT_LB" "$LOGIN_PATH" POST "$(login_body)" "8.8.8.8, 203.0.113.55, 127.0.0.1")"
if [[ "$D2_CODE" == "429" ]]; then
  pass "D2 login: client thật 203.0.113.55 (đổi hop bịa) vẫn 429 → không lách được"
else
  fail "D2 login: đổi IP bịa bên trái mà thoát rate-limit (code=$D2_CODE) → lấy sai client IP"
fi

# --- D3: đổi CLIENT THẬT (rightmost-non-trusted) → KHÔNG bị chặn [control] ---
D3_CODE="$(req_code "$PORT_LB" "$LOGIN_PATH" POST "$(login_body)" "8.8.8.8, 203.0.113.66, 127.0.0.1")"
if [[ "$D3_CODE" != "429" ]]; then
  pass "D3 login: client thật khác 203.0.113.66 KHÔNG bị 429 (code=$D3_CODE) → tách đúng theo client thật"
else
  fail "D3 login: client thật khác lại bị 429 → impl không parse rightmost-non-trusted đúng"
fi

# --- A4a: áp cho /leads — gộp cùng client → 429 [Hành vi 1 & 4] ---
A4a_429="$(burst "$PORT_LB" "$LEADS_PATH" leads_body "fixed:45.77.1.10" "$LEADS_BURST")"
if [[ "$A4a_429" -ge 1 ]]; then
  pass "A4a leads: cùng client 45.77.1.10 vượt ngưỡng → $A4a_429 lần 429"
else
  fail "A4a leads: bùng nổ $LEADS_BURST req cùng XFF nhưng KHÔNG có 429 (leads không rate-limit theo client IP từ XFF, hoặc ngưỡng > $LEADS_BURST)"
fi

# --- A4b: /leads client khác KHÔNG bị chặn [Hành vi 1: tách client] ---
A4b_CODE="$(req_code "$PORT_LB" "$LEADS_PATH" POST "$(leads_body clientB)" "45.77.1.20")"
if [[ "$A4b_CODE" != "429" ]]; then
  pass "A4b leads: client mới 45.77.1.20 KHÔNG bị 429 (code=$A4b_CODE) → tách theo client"
else
  fail "A4b leads: client mới 45.77.1.20 bị 429 → leads rate-limit khoá chung RemoteAddr, bỏ XFF"
fi

# ===========================================================================
# CONFIG-NLB — trusted = dải KHÔNG chứa loopback. Request tới từ loopback là
# NGUỒN KHÔNG TRUSTED → XFF phải bị BỎ QUA (chống giả mạo). [Hành vi 2]
# ===========================================================================
echo
echo "== CONFIG-NLB (TRUSTED_PROXIES=198.51.100.0/24 — loopback KHÔNG trusted) =="
if ! boot "$PORT_NLB" "$LOG_NLB" "198.51.100.0/24"; then exit 2; fi

# --- B1: login xoay XFF mỗi request → VẪN chạm 429 (XFF bị bỏ, khoá RemoteAddr)
B1_429="$(burst "$PORT_NLB" "$LOGIN_PATH" login_body "rotate" "$LOGIN_BURST")"
if [[ "$B1_429" -ge 1 ]]; then
  pass "B1 login: nguồn không-trusted, xoay XFF mỗi request VẪN 429 ($B1_429 lần) → XFF bị bỏ đúng"
else
  fail "B1 login: nguồn không-trusted mà đổi XFF mỗi request lách được rate-limit → impl TIN XFF của nguồn không trusted (lỗ hổng giả mạo)"
fi

# --- B2: leads xoay XFF → VẪN 429 [Hành vi 2 & 4] ---
B2_429="$(burst "$PORT_NLB" "$LEADS_PATH" leads_body "rotate" "$LEADS_BURST")"
if [[ "$B2_429" -ge 1 ]]; then
  pass "B2 leads: nguồn không-trusted, xoay XFF VẪN 429 ($B2_429 lần) → XFF bị bỏ đúng"
else
  fail "B2 leads: đổi XFF mỗi request lách được leads rate-limit từ nguồn không-trusted → lỗ hổng giả mạo"
fi

# ===========================================================================
# CONFIG-EMPTY — KHÔNG cấu hình trusted proxy (dev/direct). Default an toàn:
# khoá RemoteAddr, BỎ QUA XFF. [Hành vi 3]
# ===========================================================================
echo
echo "== CONFIG-EMPTY (TRUSTED_PROXIES unset) =="
if ! boot "$PORT_EMPTY" "$LOG_EMPTY" ""; then exit 2; fi

# --- C1: login xoay XFF → VẪN 429 (mặc định bỏ XFF, khoá RemoteAddr) ---
C1_429="$(burst "$PORT_EMPTY" "$LOGIN_PATH" login_body "rotate" "$LOGIN_BURST")"
if [[ "$C1_429" -ge 1 ]]; then
  pass "C1 login: default không trusted-proxy, xoay XFF VẪN 429 ($C1_429 lần) → mặc định bỏ XFF đúng"
else
  fail "C1 login: default mà đổi XFF lách được rate-limit → default KHÔNG an toàn (đang tin XFF khi chưa cấu hình trusted)"
fi

# --- C2: leads xoay XFF → VẪN 429 [Hành vi 3 & 4] ---
C2_429="$(burst "$PORT_EMPTY" "$LEADS_PATH" leads_body "rotate" "$LEADS_BURST")"
if [[ "$C2_429" -ge 1 ]]; then
  pass "C2 leads: default, xoay XFF VẪN 429 ($C2_429 lần) → mặc định bỏ XFF đúng"
else
  fail "C2 leads: default mà đổi XFF lách được leads rate-limit → default không an toàn"
fi

# ===========================================================================
echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "== HELD-OUT TASK 0 (real client IP): TẤT CẢ PASS =="
  exit 0
else
  echo "== HELD-OUT TASK 0 (real client IP): $FAILS ASSERTION FAIL =="
  exit 1
fi
