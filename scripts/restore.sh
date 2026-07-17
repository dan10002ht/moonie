#!/usr/bin/env bash
# restore.sh — Phục hồi PostgreSQL Mooni Cake từ file dump (-Fc).
# =============================================================================
# ⚠️ PHÁ DỮ LIỆU: pg_restore --clean --if-exists DROP rồi tạo lại object trong DB
# đích trước khi nạp. Script HỎI XÁC NHẬN (gõ 'yes') trừ khi FORCE=1.
#
# Chạy pg_restore BÊN TRONG container postgres (khớp server version). Nhận file
# dump trên host qua stdin.
#
# Cách dùng:
#   ./scripts/restore.sh <đường-dẫn-file.dump>
#   FORCE=1 ./scripts/restore.sh backups/mooni-mooni-20260718-120000.dump   # không hỏi
#
# Biến môi trường (default cho stack compose mặc định):
#   PG_CONTAINER  tên container postgres  (default: moonie-postgres-1)
#   PGUSER        user DB                 (default: mooni)
#   PGDATABASE    tên DB đích             (default: mooni)
#   PGPASSWORD    mật khẩu DB             (default: POSTGRES_PASSWORD nếu export, else mooni)
#   FORCE         =1 để bỏ qua xác nhận
# =============================================================================
set -euo pipefail

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ]; then
	echo "restore: thiếu tham số — dùng: $0 <file.dump>" >&2
	exit 2
fi
if [ ! -f "$DUMP_FILE" ]; then
	echo "restore: không tìm thấy file dump '$DUMP_FILE'" >&2
	exit 2
fi

PG_CONTAINER="${PG_CONTAINER:-moonie-postgres-1}"
PGUSER="${PGUSER:-mooni}"
PGDATABASE="${PGDATABASE:-mooni}"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-mooni}}"

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
	echo "restore: container postgres '$PG_CONTAINER' không chạy — set PG_CONTAINER cho đúng" >&2
	exit 1
fi

echo "restore: SẼ GHI ĐÈ database '${PGDATABASE}' trong container '${PG_CONTAINER}'"
echo "restore: từ file '${DUMP_FILE}'"

if [ "${FORCE:-0}" != "1" ]; then
	printf "restore: thao tác này PHÁ DỮ LIỆU hiện tại. Gõ 'yes' để tiếp tục: "
	read -r answer
	if [ "$answer" != "yes" ]; then
		echo "restore: đã huỷ." >&2
		exit 1
	fi
fi

echo "restore: pg_restore đang chạy..."

# --clean --if-exists: drop object cũ trước khi tạo lại (không lỗi nếu chưa có).
# --no-owner: bỏ qua gán owner (user restore có thể khác).
docker exec -i -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" \
	pg_restore --clean --if-exists --no-owner -U "$PGUSER" -d "$PGDATABASE" <"$DUMP_FILE"

echo "restore: hoàn tất phục hồi '${PGDATABASE}' từ '${DUMP_FILE}'"
