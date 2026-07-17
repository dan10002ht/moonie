#!/usr/bin/env bash
# =============================================================================
# HELD-OUT ACCEPTANCE TEST — Task 3 (Giai đoạn 2): Telegram notify khi có lead
# Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
#   (CẤM generator đọc/sửa file này — nó mã hóa hành vi DỰ ĐỊNH, không phải
#    hành vi hiện tại của implementation.)
#
# Black-box test. Derived ONLY from:
#   - plan Task 3 Held-out + Global Constraints
#     (docs/superpowers/plans/2026-07-17-giai-doan-2-api-public.md):
#       * notify gọi 1 lần với tên + SĐT + sản phẩm quan tâm khi POST /leads OK
#       * Telegram lỗi/timeout -> POST /leads VẪN 201 (fail-safe, không chặn)
#       * thiếu token -> NoopNotifier, không crash, log "notify skipped (no token)"
#       * token qua ENV: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
#   - SRS REQ-NOTI-001 (notify lead mới), NFR-001 (< 5 giây)
#   - api/openapi.yaml contract POST /leads (LeadInput -> 201 LeadCreated{id})
#   - .claude/skills/run-moonie/SKILL.md (boot: make up/migrate, API :8080)
# It reads NO implementation (notify/telegram/handlers/main/config).
#
# TESTABILITY CONTRACT (generator PHẢI hỗ trợ để test đo được từ ngoài):
#   TelegramNotifier phải cho override base URL của Telegram API qua ENV
#   `TELEGRAM_API_BASE` (mặc định https://api.telegram.org). Notifier gọi
#   `<TELEGRAM_API_BASE>/bot<token>/sendMessage`. Test trỏ base này vào 1 mock
#   HTTP server local để quan sát request thay vì gọi Telegram thật.
#   Nếu generator KHÔNG hỗ trợ TELEGRAM_API_BASE, notify sẽ đi ra
#   api.telegram.org (fake-token -> 404) và mock KHÔNG nhận được gì => Assert 1
#   FAIL kèm chẩn đoán rõ ràng.
#
# Assertions (tất cả phải PASS; rớt bất kỳ => exit 1):
#   1. Có token: POST /leads hợp lệ -> 201; trong < 5s (NFR-001) mock Telegram
#      nhận ĐÚNG 1 request /sendMessage chứa TÊN + SĐT(hoặc 4 số cuối) +
#      product_interest.
#   2. Fail-safe: mock Telegram TREO (hang) -> POST /leads VẪN 201, lead VẪN
#      lưu DB, và phản hồi KHÔNG bị treo theo (thời gian < 10s nhờ timeout/async).
#   3. Không token (TELEGRAM_BOT_TOKEN rỗng): POST /leads -> 201, lead lưu DB,
#      server KHÔNG crash, log có dấu hiệu skip notify, KHÔNG gọi ra mock.
#
# ENV/PORT dùng: API :8080 (test tự start/stop, override token qua env);
#   mock Telegram: cổng tự do do python cấp; TELEGRAM_API_BASE=http://127.0.0.1:<port>.
# Mọi lead test có name bắt đầu 'heldout-test-tele' và bị xóa (EXIT trap).
# Nếu bảng 'leads' hoặc endpoint POST /leads chưa có => exit 2 (Task 2 chưa xong).
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:8080/api/v1}"
DB_URL="${DATABASE_URL:-postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME_PREFIX="heldout-test-tele"

WORKDIR="$(mktemp -d)"
MOCK_PY="$WORKDIR/mock_telegram.py"
MOCK_LOG="$WORKDIR/mock_requests.log"
API_LOG="$WORKDIR/api-server.log"
RESP_FILE="$WORKDIR/resp.json"

HAPPY_PHONE="0912345678"
PHONE_LAST4="${HAPPY_PHONE: -4}"
PRODUCT="TeleProbeCake"

FAILS=0
MOCK_PID=""
API_PID=""

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILS=$((FAILS+1)); }
info() { printf '  ---- %s\n' "$1"; }

# ---------------------------------------------------------------------------
# Mock Telegram API server: ghi lại mỗi request (method path?query + body) vào
# MOCK_LOG. Hành vi theo env MOCK_MODE: ok=200, hang=sleep dài, 500=lỗi server.
# ---------------------------------------------------------------------------
write_mock() {
  cat > "$MOCK_PY" <<'PYEOF'
import os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOGF = os.environ["MOCK_LOG"]
MODE = os.environ.get("MOCK_MODE", "ok")

def record(method, path, body):
    with open(LOGF, "a") as f:
        f.write("=== %s %s\n" % (method, path))
        f.write(body if isinstance(body, str) else body.decode("utf-8", "replace"))
        f.write("\n=== END\n")
        f.flush()

class H(BaseHTTPRequestHandler):
    def _handle(self, method):
        n = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(n) if n else b""
        record(method, self.path, body)
        if MODE == "hang":
            time.sleep(25)
        if MODE == "500":
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'{"ok":false}')
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true,"result":{"message_id":1}}')
    def do_POST(self): self._handle("POST")
    def do_GET(self):  self._handle("GET")
    def log_message(self, *a): pass

port = int(sys.argv[1])
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
PYEOF
}

free_port() {
  python3 - <<'PYEOF'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PYEOF
}

start_mock() {
  # $1 = mode (ok|hang|500) ; $2 = port
  : > "$MOCK_LOG"
  MOCK_LOG="$MOCK_LOG" MOCK_MODE="$1" python3 "$MOCK_PY" "$2" >/dev/null 2>&1 &
  MOCK_PID=$!
  # chờ mock nghe cổng
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "http://127.0.0.1:$2/ping" ; then break; fi
    sleep 0.2
  done
}

stop_mock() {
  [[ -n "$MOCK_PID" ]] && kill "$MOCK_PID" >/dev/null 2>&1 || true
  MOCK_PID=""
}

# start_api <token> <chat_id> <api_base> : khởi động API với env override.
start_api() {
  local token="$1" chat="$2" base="$3"
  : > "$API_LOG"
  (
    cd "$REPO_ROOT/api" || exit 1
    set -a
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"
    TELEGRAM_BOT_TOKEN="$token"
    TELEGRAM_CHAT_ID="$chat"
    TELEGRAM_API_BASE="$base"
    set +a
    exec env TELEGRAM_BOT_TOKEN="$token" TELEGRAM_CHAT_ID="$chat" TELEGRAM_API_BASE="$base" \
      GOTOOLCHAIN=local go run ./cmd/server
  ) >"$API_LOG" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 60); do
    if curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$API_PID" >/dev/null 2>&1; then
      echo "FATAL: API server chết khi khởi động. Log:"; tail -30 "$API_LOG"; return 1
    fi
    sleep 1
  done
  echo "FATAL: API không lên sau 60s. Log:"; tail -30 "$API_LOG"; return 1
}

stop_api() {
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
    pkill -P "$API_PID" >/dev/null 2>&1 || true
    wait "$API_PID" 2>/dev/null || true
  fi
  API_PID=""
  # dọn tiến trình server còn giữ cổng 8080 mà test này tạo ra
  lsof -ti tcp:8080 >/dev/null 2>&1 && lsof -ti tcp:8080 | xargs kill -9 >/dev/null 2>&1 || true
}

cleanup() {
  info "cleanup: dừng api + mock, xóa lead test '${NAME_PREFIX}%'"
  stop_api
  stop_mock
  psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" 2>/dev/null || true
}
trap cleanup EXIT

# post_leads <name> <phone> <product> : output "<http_code> <time_total>"; body -> RESP_FILE
post_leads() {
  local name="$1" phone="$2" product="$3" body
  body="$(jq -nc --arg n "$name" --arg p "$phone" --arg pi "$product" \
    '{name:$n, phone:$p, message:"heldout telegram probe", product_interest:$pi}')"
  curl -s -o "$RESP_FILE" -w '%{http_code} %{time_total}' \
    -H 'Content-Type: application/json' -X POST "$API_BASE/leads" --data "$body"
}

db_count() {
  psql "$DB_URL" -tAc "SELECT count(*) FROM leads WHERE name = '$1';" 2>/dev/null | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# 0. Boot infra + tiền điều kiện (Task 2 phải xong: bảng leads + endpoint).
# ---------------------------------------------------------------------------
echo "== Boot infra =="
( cd "$REPO_ROOT" && make up >/dev/null 2>&1 ) || true
for _ in $(seq 1 30); do
  psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
if ! psql "$DB_URL" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "FATAL: không kết nối được Postgres tại $DB_URL"; exit 2
fi
( cd "$REPO_ROOT" && make migrate >/dev/null 2>&1 ) || true
if ! psql "$DB_URL" -tAc "SELECT to_regclass('public.leads')" | grep -q leads; then
  echo "FATAL: bảng 'leads' chưa tồn tại — Task 2 (POST /leads) chưa hoàn tất."; exit 2
fi

# Cổng 8080 phải trống để test tự làm chủ server (cần đọc log + đặt env riêng).
if lsof -ti tcp:8080 >/dev/null 2>&1; then
  info "cổng 8080 đang bận — kill server cũ để test tự khởi động (cần env riêng)"
  lsof -ti tcp:8080 | xargs kill -9 >/dev/null 2>&1 || true
  sleep 1
fi

psql "$DB_URL" -tA -c "DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%';" >/dev/null 2>&1 || true
write_mock

# ===========================================================================
# ASSERT 1 — có token: notify được gửi tới mock trong < 5s, đúng nội dung
# ===========================================================================
echo "== Assert 1: có token -> mock Telegram nhận sendMessage < 5s (NFR-001) =="
PORT1="$(free_port)"
start_mock ok "$PORT1"
if ! start_api "fake-token-heldout" "123" "http://127.0.0.1:$PORT1"; then
  fail "không khởi động được API với token — không thể kiểm notify"
else
  NAME1="${NAME_PREFIX}-a-$$-$(date +%s)"
  read -r CODE1 T1 <<<"$(post_leads "$NAME1" "$HAPPY_PHONE" "$PRODUCT")"
  if [[ "$CODE1" == "201" ]]; then
    pass "POST /leads hợp lệ -> 201 (t=${T1}s)"
  else
    fail "POST /leads -> $CODE1 (kỳ vọng 201). Resp: $(cat "$RESP_FILE")"
  fi

  # chờ tối đa 5s (NFR-001) để mock nhận sendMessage
  RECV=""
  ELAPSED="?"
  START_MS="$(python3 -c 'import time;print(int(time.time()*1000))')"
  for _ in $(seq 1 25); do
    if grep -q "sendMessage" "$MOCK_LOG" 2>/dev/null; then
      NOW_MS="$(python3 -c 'import time;print(int(time.time()*1000))')"
      ELAPSED="$(python3 -c "print((${NOW_MS}-${START_MS})/1000.0)")"
      RECV="yes"; break
    fi
    sleep 0.2
  done

  if [[ "$RECV" == "yes" ]]; then
    pass "mock Telegram nhận request /sendMessage trong ~${ELAPSED}s (< 5s)"
  else
    fail "mock Telegram KHÔNG nhận request /sendMessage trong 5s. \
CHẨN ĐOÁN: rất có thể generator CHƯA hỗ trợ override TELEGRAM_API_BASE (notify \
vẫn gọi api.telegram.org thật), hoặc notify không được gọi. Nội dung mock log:"
    info "$(cat "$MOCK_LOG" 2>/dev/null | head -20)"
  fi

  # đếm số request /sendMessage (kỳ vọng đúng 1). best-effort: >=1 là gửi, ==1 là đúng.
  SENDCOUNT="$(grep -c "sendMessage" "$MOCK_LOG" 2>/dev/null || echo 0)"
  if [[ "$SENDCOUNT" == "1" ]]; then
    pass "gọi sendMessage đúng 1 lần"
  elif [[ "$SENDCOUNT" -ge 1 ]]; then
    fail "gọi sendMessage $SENDCOUNT lần (kỳ vọng đúng 1)"
  fi

  # nội dung: phải chứa tên + (SĐT full hoặc 4 số cuối) + product_interest
  if [[ "$RECV" == "yes" ]]; then
    MOCKTXT="$(cat "$MOCK_LOG")"
    grep -Fq "$NAME1" <<<"$MOCKTXT" \
      && pass "message chứa TÊN khách ('$NAME1')" \
      || fail "message KHÔNG chứa tên khách '$NAME1'"
    if grep -Fq "$HAPPY_PHONE" <<<"$MOCKTXT" || grep -Fq "$PHONE_LAST4" <<<"$MOCKTXT"; then
      pass "message chứa SĐT (full hoặc 4 số cuối '$PHONE_LAST4')"
    else
      fail "message KHÔNG chứa SĐT (cả full '$HAPPY_PHONE' lẫn 4 số cuối '$PHONE_LAST4')"
    fi
    grep -Fq "$PRODUCT" <<<"$MOCKTXT" \
      && pass "message chứa product_interest ('$PRODUCT')" \
      || fail "message KHÔNG chứa product_interest '$PRODUCT'"
  fi
fi
stop_api
stop_mock

# ===========================================================================
# ASSERT 2 — fail-safe: mock TREO -> POST /leads vẫn 201, lead vẫn lưu, không treo
# ===========================================================================
echo "== Assert 2: Telegram treo/timeout -> POST /leads VẪN 201 (fail-safe) =="
PORT2="$(free_port)"
start_mock hang "$PORT2"
if ! start_api "fake-token-heldout" "123" "http://127.0.0.1:$PORT2"; then
  fail "không khởi động được API cho kịch bản fail-safe"
else
  NAME2="${NAME_PREFIX}-b-$$-$(date +%s)"
  read -r CODE2 T2 <<<"$(post_leads "$NAME2" "$HAPPY_PHONE" "$PRODUCT")"
  if [[ "$CODE2" == "201" ]]; then
    pass "POST /leads -> 201 dù Telegram treo (fail-safe OK, t=${T2}s)"
  else
    fail "POST /leads -> $CODE2 khi Telegram treo (kỳ vọng 201 — đặt hàng KHÔNG được fail vì Telegram). Resp: $(cat "$RESP_FILE")"
  fi
  # phản hồi không được treo theo Telegram (timeout hoặc async). Ngưỡng nới rộng < 10s.
  UNDER10="$(python3 -c "print(1 if ${T2:-99} < 10 else 0)" 2>/dev/null)"
  if [[ "$UNDER10" == "1" ]]; then
    pass "phản hồi POST /leads = ${T2}s (< 10s) — không bị Telegram treo kéo theo"
  else
    fail "phản hồi POST /leads = ${T2}s (>= 10s) — có vẻ notify chặn response khi Telegram treo (thiếu timeout/async)"
  fi
  # lead vẫn phải lưu DB
  if [[ "$(db_count "$NAME2")" == "1" ]]; then
    pass "lead VẪN được lưu DB dù Telegram treo"
  else
    fail "lead KHÔNG được lưu DB (count=$(db_count "$NAME2")) — dữ liệu mất khi Telegram lỗi"
  fi
fi
stop_api
stop_mock

# ===========================================================================
# ASSERT 3 — không token -> NoopNotifier: 201, lưu DB, không crash, không gọi mock
# ===========================================================================
echo "== Assert 3: thiếu token -> no-op, không crash, không gọi ra ngoài =="
PORT3="$(free_port)"
start_mock ok "$PORT3"
if ! start_api "" "" "http://127.0.0.1:$PORT3"; then
  fail "API KHÔNG khởi động được khi token rỗng — server crash/không boot (vi phạm: thiếu token phải no-op)"
else
  pass "API khởi động được với token rỗng (không crash lúc boot)"
  NAME3="${NAME_PREFIX}-c-$$-$(date +%s)"
  read -r CODE3 T3 <<<"$(post_leads "$NAME3" "$HAPPY_PHONE" "$PRODUCT")"
  if [[ "$CODE3" == "201" ]]; then
    pass "POST /leads -> 201 khi không có token (t=${T3}s)"
  else
    fail "POST /leads -> $CODE3 khi không token (kỳ vọng 201). Resp: $(cat "$RESP_FILE")"
  fi
  if [[ "$(db_count "$NAME3")" == "1" ]]; then
    pass "lead lưu DB khi không token"
  else
    fail "lead KHÔNG lưu DB khi không token (count=$(db_count "$NAME3"))"
  fi
  # server còn sống sau request (không crash)
  if curl -fsS "$API_BASE/healthz" >/dev/null 2>&1; then
    pass "server còn sống sau POST /leads (không crash)"
  else
    fail "server CHẾT sau POST /leads khi không token"
  fi
  # KHÔNG được gọi ra mock (Noop = không outbound)
  sleep 1
  if grep -q "sendMessage" "$MOCK_LOG" 2>/dev/null; then
    fail "khi KHÔNG có token vẫn gọi ra Telegram (mock nhận sendMessage) — phải là NoopNotifier"
  else
    pass "không token -> KHÔNG gọi ra Telegram (mock trống)"
  fi
  # log có dấu hiệu skip notify (plan Step 6: 'notify skipped (no token)')
  if grep -Eiq 'skip|no.?token|noop|không có token|khong co token|bỏ qua|bo qua' "$API_LOG" 2>/dev/null; then
    pass "log có dấu hiệu skip notify (thiếu token)"
  else
    fail "log KHÔNG có dấu hiệu skip notify khi thiếu token (kỳ vọng vd 'notify skipped (no token)'). Log:"
    info "$(tail -20 "$API_LOG" 2>/dev/null)"
  fi
fi
stop_api
stop_mock

# ---------------------------------------------------------------------------
echo ""
if [[ "$FAILS" -eq 0 ]]; then
  echo "RESULT: PASS (tất cả assert đạt)"
  exit 0
else
  echo "RESULT: FAIL ($FAILS assert rớt)"
  exit 1
fi
