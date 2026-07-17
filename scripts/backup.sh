#!/usr/bin/env bash
# backup.sh — Sao lưu PostgreSQL Mooni Cake (custom format -Fc) + xoay vòng.
# =============================================================================
# Chạy pg_dump BÊN TRONG container postgres (khớp chính xác server version,
# không phụ thuộc pg client trên host). Ghi ra file .dump có timestamp, rồi xoá
# các bản cũ hơn RETENTION_DAYS ngày.
#
# Biến môi trường (đều có default cho stack compose mặc định):
#   PG_CONTAINER    tên container postgres đang chạy   (default: moonie-postgres-1)
#   PGUSER          user DB                             (default: mooni)
#   PGDATABASE      tên DB                              (default: mooni)
#   PGPASSWORD      mật khẩu DB                         (default: giá trị POSTGRES_PASSWORD nếu export)
#   BACKUP_DIR      thư mục lưu backup                  (default: ./backups)
#   RETENTION_DAYS  số ngày giữ backup                 (default: 14)
#
# Ví dụ:
#   PG_CONTAINER=moonie-postgres-1 PGPASSWORD=... ./scripts/backup.sh
# =============================================================================
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-moonie-postgres-1}"
PGUSER="${PGUSER:-mooni}"
PGDATABASE="${PGDATABASE:-mooni}"
PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-mooni}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

timestamp="$(date +%Y%m%d-%H%M%S)"
outfile="${BACKUP_DIR}/mooni-${PGDATABASE}-${timestamp}.dump"

mkdir -p "$BACKUP_DIR"

# Kiểm container tồn tại + đang chạy trước khi dump.
if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
	echo "backup: container postgres '$PG_CONTAINER' không chạy — set PG_CONTAINER cho đúng" >&2
	exit 1
fi

echo "backup: pg_dump ${PGDATABASE} (user=${PGUSER}) trong container ${PG_CONTAINER} → ${outfile}"

# -Fc: custom format (nén, phục hồi chọn lọc được). Dump ra stdout của container
# rồi redirect vào file trên host. -e PGPASSWORD để pg_dump xác thực không hỏi.
docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CONTAINER" \
	pg_dump -Fc -U "$PGUSER" -d "$PGDATABASE" >"$outfile"

size="$(wc -c <"$outfile" | tr -d ' ')"
if [ "$size" -eq 0 ]; then
	echo "backup: LỖI — file dump rỗng, xoá" >&2
	rm -f "$outfile"
	exit 1
fi
echo "backup: xong (${size} bytes)"

# Xoay vòng: xoá backup cũ hơn RETENTION_DAYS ngày.
echo "backup: xoá bản cũ > ${RETENTION_DAYS} ngày trong ${BACKUP_DIR}"
find "$BACKUP_DIR" -name 'mooni-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "backup: hoàn tất → ${outfile}"
