# Runbook vận hành — Mooni Cake (production)

> Hạ tầng: VPS + Docker Compose + Caddy (auto HTTPS). File liên quan:
> `docker-compose.prod.yml`, `Caddyfile`, `api/Dockerfile.migrate`, `scripts/backup.sh`, `scripts/restore.sh`.
>
> **Chú thích mức verify:**
> - ✅ **VERIFIED-LOCAL** — đã chạy thật trên máy dev (Colima/Postgres), có output.
> - 🌐 **NEEDS-VPS** — chỉ kiểm chứng được khi có VPS + domain thật (cấp phát TLS, DNS, hairpin).

---

## 0. Kiến trúc production (tóm tắt)

```
Internet ──443/80──> Caddy ──┬── /api/*     ─> api:8080   (Go, /api/v1/*)
  (auto HTTPS)               ├── /uploads/* ─> api:8080   (ảnh sản phẩm tĩnh)
                             └── /*          ─> web:3000   (Next.js: landing + /admin)
                                                  │
                        postgres:5432 (nội bộ) <──┘  (api + web + migrate/seed)
```

- **Chỉ Caddy** publish port ra host (80, 443, 443/udp). postgres/api/web KHÔNG map port ra ngoài — chỉ nói chuyện trong mạng compose `moonie` (subnet cố định `172.28.0.0/16`).
- **same-origin**: browser chỉ thấy `https://<domain>`. `/api/*` và `/uploads/*` do Caddy proxy về api; còn lại về web. Không CORS, không lộ endpoint admin ra origin khác.
- **migrate + seed**: 2 one-shot service tự chạy khi `up` (ảnh `Dockerfile.migrate`). `api` phụ thuộc `migrate` hoàn tất (schema là điều kiện cứng); `seed` chạy độc lập (không chặn site nếu lỗi).

---

## 1. Deploy lần đầu lên VPS 🌐 NEEDS-VPS

### 1.1. Chuẩn bị VPS

```bash
# Cài Docker Engine + compose plugin (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # đăng nhập lại để nhóm docker có hiệu lực
docker compose version            # xác nhận compose v2

# Mở firewall cho 80 + 443 (ví dụ ufw)
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

### 1.2. DNS

Trỏ bản ghi **A** (và AAAA nếu có IPv6) của domain (vd `mooni.vn` + `www.mooni.vn`) về IP công khai của VPS. Caddy cần domain resolve đúng để Let's Encrypt cấp cert (HTTP-01 challenge qua cổng 80).

### 1.3. Clone + tạo `.env` production (KHÔNG commit)

```bash
git clone https://github.com/dan10002ht/moonie.git
cd moonie
# Tạo .env — xem .env.example (mục PRODUCTION) để biết đủ biến. Sinh secret mạnh:
openssl rand -base64 48   # dùng cho JWT_SECRET
openssl rand -base64 24   # dùng cho POSTGRES_PASSWORD / SEED_ADMIN_PASSWORD
```

`.env` production BẮT BUỘC có (thiếu bất kỳ biến `${VAR:?}` nào → `up`/`config` dừng ngay):

| Biến | Ý nghĩa | Ràng buộc |
|---|---|---|
| `DOMAIN` | domain chính | vd `mooni.vn` (không kèm scheme) |
| `ACME_EMAIL` | email nhận cảnh báo cert | email thật |
| `POSTGRES_PASSWORD` | mật khẩu Postgres | mạnh, không mặc định |
| `JWT_SECRET` | khoá ký JWT admin | **≥32 ký tự**, không placeholder (`openssl rand -base64 48`) |
| `ALLOWED_ORIGIN` | CSRF allowlist | `https://<domain>` (nhiều origin phân tách dấu phẩy) |
| `SEED_ADMIN_PASSWORD` | mật khẩu admin khởi tạo | **≥12 ký tự**, không phải `mooni-admin` (prod guard từ chối) |
| `TRUSTED_PROXIES` | *(tuỳ chọn)* dải proxy tin cậy | default `172.28.0.0/16` = subnet compose. **Chỉ đổi nếu đổi subnet mạng.** |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | *(tuỳ chọn)* Telegram notify | rỗng = tắt notify (site vẫn chạy) |

> ⚠️ **TRUSTED_PROXIES footgun (BRIEF GĐ6 Task 0):** để trống ở prod → api không tin `X-Forwarded-For` từ Caddy/Next → toàn site bị rate-limit chung theo IP proxy (mất bảo vệ per-IP + chặn oan). Compose đã đặt default = subnet compose; **đừng ghi đè thành rỗng**.

### 1.4. Khởi động

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Thứ tự tự động: `postgres` (healthy) → `migrate` (up) → `seed` + `api` → `web` → `caddy`.

### 1.5. Kiểm sau khởi động

```bash
# migrate + seed đã chạy xong chưa
docker compose -f docker-compose.prod.yml logs migrate seed

# Caddy đã cấp cert chưa (chờ vài chục giây lần đầu)
docker compose -f docker-compose.prod.yml logs caddy | grep -i "certificate obtained\|serving"

# Health API qua domain (same-origin)
curl -fsS https://<domain>/api/v1/healthz    # → {"status":"ok"}
# Trang chủ
curl -fsSI https://<domain>/ | head -1        # → HTTP/2 200
```

### 1.6. Đăng nhập admin + ĐỔI MẬT KHẨU

Vào `https://<domain>/admin/login` với `admin@mooni.local` + `SEED_ADMIN_PASSWORD`.
> Mật khẩu admin đã đặt qua `SEED_ADMIN_PASSWORD` lúc seed (không còn `mooni-admin` mặc định). Nếu cần đổi thêm: hiện chưa có UI đổi mật khẩu → đổi bằng cách chạy lại seed với `SEED_ADMIN_PASSWORD` mới **sau khi** xoá row admin cũ, hoặc `UPDATE admin_users SET password_hash=...` (bcrypt). (Backlog: UI đổi mật khẩu.)

---

## 2. Cập nhật / deploy phiên bản mới 🌐 NEEDS-VPS

```bash
cd moonie
git pull                                              # hoặc: git checkout <tag>
docker compose -f docker-compose.prod.yml up -d --build
# migrate tự chạy nếu có migration mới (idempotent). Kiểm:
docker compose -f docker-compose.prod.yml logs migrate
```

Rebuild chỉ dựng lại image có đổi; `--build` đảm bảo `web` bake lại `NEXT_PUBLIC_API_BASE` từ `DOMAIN` hiện tại.

---

## 3. Rollback về bản trước 🌐 NEEDS-VPS

```bash
cd moonie
git log --oneline -n 10                # tìm commit/tag ổn định trước đó
git checkout <commit-hoặc-tag>
docker compose -f docker-compose.prod.yml up -d --build
```

> ⚠️ **Migration KHÔNG tự rollback** khi checkout code cũ (migrate chỉ `up`). Nếu bản mới đã thêm migration phá tương thích ngược, rollback code có thể lệch schema. Xử lý:
> - Ưu tiên forward-fix (deploy bản vá) hơn rollback.
> - Nếu buộc rollback qua ranh giới migration: khôi phục DB từ backup gần nhất (mục 4) tương ứng bản code đó.
> - `docker compose -f docker-compose.prod.yml run --rm migrate /app/migrate down` chỉ lùi **1 bước** (dùng thận trọng, có thể mất dữ liệu cột bị drop).

---

## 4. Backup + Restore PostgreSQL ✅ VERIFIED-LOCAL

Script: `scripts/backup.sh`, `scripts/restore.sh` — chạy `pg_dump/pg_restore` **bên trong container postgres** (khớp server version, không cần pg client trên host). Custom format `-Fc`.

### 4.1. Backup thủ công

```bash
# Trên VPS (container postgres của prod compose tên: moonie-postgres-1)
PG_CONTAINER=moonie-postgres-1 \
  PGUSER=mooni PGDATABASE=mooni PGPASSWORD="$POSTGRES_PASSWORD" \
  BACKUP_DIR=/var/backups/mooni RETENTION_DAYS=14 \
  ./scripts/backup.sh
# → /var/backups/mooni/mooni-mooni-<timestamp>.dump ; tự xoá bản > RETENTION_DAYS ngày
```

### 4.2. Backup định kỳ (cron) 🌐 NEEDS-VPS

```cron
# /etc/cron.d/mooni-backup — 02:15 hằng ngày
15 2 * * * root cd /root/moonie && PG_CONTAINER=moonie-postgres-1 PGUSER=mooni PGDATABASE=mooni PGPASSWORD='<db-pass>' BACKUP_DIR=/var/backups/mooni RETENTION_DAYS=14 ./scripts/backup.sh >> /var/log/mooni-backup.log 2>&1
```

### 4.3. Restore ✅ VERIFIED-LOCAL

```bash
# PHÁ DỮ LIỆU hiện tại — script hỏi 'yes' trừ khi FORCE=1.
PG_CONTAINER=moonie-postgres-1 \
  PGUSER=mooni PGDATABASE=mooni PGPASSWORD="$POSTGRES_PASSWORD" \
  ./scripts/restore.sh /var/backups/mooni/mooni-mooni-<timestamp>.dump
```

> **Đã verify round-trip thật trên Postgres local (Colima, 2026-07-18):** thêm sản phẩm sentinel → `backup.sh` (13KB dump) → xoá sentinel + 1 sản phẩm (8→6) → `restore.sh FORCE=1` → dữ liệu khớp lại (6→8, sentinel + sản phẩm đã xoá trở lại, admin nguyên vẹn). `--clean --if-exists` xử lý drop/recreate không lỗi.

---

## 5. Xem log khi sự cố ✅ VERIFIED-LOCAL (lệnh chuẩn compose)

```bash
docker compose -f docker-compose.prod.yml ps                 # trạng thái + health
docker compose -f docker-compose.prod.yml logs -f api        # log 1 service (theo dõi)
docker compose -f docker-compose.prod.yml logs --tail=200 caddy web api
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U mooni   # DB sống?
```

Triệu chứng thường gặp:
| Triệu chứng | Kiểm |
|---|---|
| 502 từ Caddy | `logs api` (api crash? DB chưa healthy?) — api fail-fast nếu `JWT_SECRET`/`DATABASE_URL` sai |
| Không có HTTPS / cert lỗi | `logs caddy` (DNS đã trỏ chưa? cổng 80 mở chưa? rate-limit Let's Encrypt?) |
| Rate-limit chặn oan toàn site | `TRUSTED_PROXIES` bị rỗng/sai (mục 1.3 footgun) |
| Đăng nhập admin fail | `logs seed` (seed có tạo admin không? mật khẩu?) |
| Landing trắng / lỗi fetch | `web` render server-side gọi API qua `https://<domain>` — cần cert đã cấp (mục 1.5) |

---

## 6. Checklist go-live security

- [ ] `APP_ENV=production` (compose hardcode → Secure cookie + seed guard bật).
- [ ] `JWT_SECRET` mạnh ≥32 ký tự, không placeholder (api fail-fast nếu vi phạm).
- [ ] Mật khẩu admin KHÔNG mặc định (`SEED_ADMIN_PASSWORD` ≥12 ký tự — seed prod từ chối `mooni-admin`).
- [ ] `POSTGRES_PASSWORD` mạnh; postgres KHÔNG expose port ra host (đã bảo đảm trong compose).
- [ ] `TRUSTED_PROXIES` = subnet compose (default) — không để rỗng ở prod.
- [ ] `ALLOWED_ORIGIN` = `https://<domain>` (CSRF allowlist).
- [ ] HTTPS + HSTS hoạt động (Caddy auto cert + header `Strict-Transport-Security`); 80→443 tự redirect.
- [ ] Security headers (nosniff, X-Frame-Options DENY, Referrer-Policy, CSP) — do app set, KHÔNG trùng ở Caddy.
- [ ] Backup định kỳ đã bật (cron mục 4.2) + đã thử restore ít nhất 1 lần.

### 6.1. Hai mốc security-review BẮT BUỘC (CLAUDE.md)

1. ✅ **Cuối giai đoạn auth admin (GĐ4)** — ĐÃ chạy: security-review tổng admin/auth, không HIGH/CRITICAL; fix M1 rate-limit login. (BRIEF GĐ4 Task 7.)
2. ⏳ **TRƯỚC deploy production** — CHƯA chạy: bắt buộc chạy skill `security-review` trên toàn bộ thay đổi GĐ6 (hạ tầng prod, Caddy, real-IP, headers) TRƯỚC khi `up` trên VPS thật.

> **Finding mức HIGH chưa xử lý = KHÔNG deploy.** (CLAUDE.md.)

---

## 7. Phần chỉ verify được khi có VPS/domain 🌐

Các mục dưới đây **chưa** kiểm chứng được trên máy dev (cần domain public + cấp phát TLS + DNS + NAT hairpin của VPS):

- Cấp phát cert Let's Encrypt thật cho `{$DOMAIN}` (Caddy auto HTTPS) + redirect 80→443 + HSTS trên trình duyệt thật.
- Server-side render của Next fetch API qua `https://<domain>/api/v1` (hairpin qua Caddy) — phụ thuộc DNS + cert của VPS.
- Rate-limit lấy IP khách thật qua chuỗi `X-Forwarded-For` (Caddy → api) với `TRUSTED_PROXIES` = subnet compose.
- Toàn stack prod chạy (`up -d --build`) end-to-end trên hạ tầng thật.

**Đã verify local:** `docker compose -f docker-compose.prod.yml config` (cú pháp + resolve biến), `caddy validate` Caddyfile, backup/restore round-trip trên Postgres Colima.
