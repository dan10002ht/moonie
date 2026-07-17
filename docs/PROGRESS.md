# Mooni Cake — Tiến độ dự án

> Handoff artifact: file này là điểm vào cho bất kỳ session/agent mới nào.
> Cập nhật sau MỖI milestone (quy trình trong CLAUDE.md, bước 8).

## Trạng thái hiện tại

**Giai đoạn: Chuẩn bị (harness setup) — HOÀN THÀNH 2026-07-17**

- [x] Brainstorm + chốt thiết kế với chủ dự án
- [x] Spec: `docs/superpowers/specs/2026-07-17-mooni-website-design.md`
- [x] Harness: CLAUDE.md, 3 agents (qa-evaluator, design-evaluator, go-reviewer), settings, git
- [x] Harness v2 (2026-07-17): BRIEF.md task loop + evaluator gate; pipeline test 6 bước (research verified: `docs/research/2026-07-17-per-task-testing.md`); held-out tests trong `tests/heldout/` do qa-evaluator sở hữu (generator bị cấm đọc); vòng lặp screenshot bắt buộc cho task UI (2 viewport, so với mockup, lưu `docs/reports/screenshots/`)
- [x] Agent `ba-writer` (2026-07-17): duy trì tài liệu BA chính thống trong `docs/ba/` (BRD, SRS, FRS, data dictionary, traceability) — phái sinh từ spec/code, cập nhật cuối mỗi giai đoạn, phát hiện mâu thuẫn thì báo không tự xử
- [x] Plan giai đoạn 1: `docs/superpowers/plans/2026-07-17-giai-doan-1-scaffold.md`
- [x] **Giai đoạn 1 — Scaffold (8/8 task) HOÀN THÀNH 2026-07-17**: monorepo web/ (Next.js 16 + Tailwind v4 tokens) + api/ (Go chi/pgx/sqlc, healthz, graceful shutdown) + docker-compose (Postgres:5440 Colima) + OpenAPI contract 2 phía (oapi-codegen + openapi-typescript) + migrations/sqlc + testcontainers + CI GitHub Actions + Dockerfile + skill run-moonie + seed admin. App chạy đầu-cuối thật.
- [x] **Giai đoạn 2 — API Public HOÀN THÀNH (4/4) 2026-07-17**: GET /products (ẩn hidden, ORDER BY tất định), POST /leads (validate SĐT VN + rate limit 20/phút chống spoof + log che SĐT), Telegram notify fail-safe (TELEGRAM_API_BASE override), web client getProducts/createLead. Mọi feature qua held-out gate + go-reviewer.
- [x] **Giai đoạn 3 — Landing HOÀN THÀNH (4/4) 2026-07-17**: trang chủ khớp mockup 1:1 (header/hero/trust/collection/corporate/craft/flavors/testimonials/footer + bottom sheet form). Đọc GET /products, form → POST /leads → admin + Telegram. design-evaluator ≥8/10 mọi task. Product model mở rộng: badge, compare_at_price, subtitle (migration 0005). Playwright + screenshot loop.
- [x] **Giai đoạn 4 — Auth admin + API admin HOÀN THÀNH (7/7) 2026-07-17**: JWT httpOnly + middleware; admin products(CRUD+upload ảnh), leads(list/status/convert→đơn), orders(nhập tay transaction+snapshot giá), customers(CRUD), dashboard(doanh thu giờ VN). Phân trang {items,total} leads/orders/customers. Security-review tổng: không HIGH/CRITICAL; rate-limit login. Deploy-gate GĐ6 ghi ở BRIEF task 0/0b.
- [x] **Giai đoạn 5 — Admin UI HOÀN THÀNH (5/5) 2026-07-17**: đăng nhập /admin/login + shell + dashboard + quản lý sản phẩm(upload ảnh)/leads(convert)/đơn hàng(nhập tay)/khách hàng, shadcn/ui theo tokens Mooni. Mọi task qua held-out Playwright + design-evaluator ≥8/10.
- [ ] **Giai đoạn 6 — Deploy VPS — BƯỚC CUỐI** (Docker Compose production + Caddy HTTPS + backup Postgres; security deploy-gate BRIEF task 0/0b: đổi mật khẩu admin, real-IP sau proxy, headers; cần VPS+domain+Telegram token+ảnh thật của chủ dự án)
- [ ] Giai đoạn 4 — Auth admin + API admin (orders, leads, products, customers)
- [ ] Giai đoạn 5 — Admin UI
- [ ] Giai đoạn 6 — Deploy VPS (Docker Compose + Caddy + backup) + security-review

## Ghi chú kỹ thuật phát sinh (giai đoạn 1)

- Docker: **Colima** (không Docker Desktop), Postgres host port **5440**. Dùng `make up/migrate/seed/gen/lint/test/check`.
- **Go floor 1.25** (testcontainers-go v0.43 nâng từ 1.23), pgx v5.9.2.
- **CGO_ENABLED=0 bắt buộc** local (shim `cc` phá cgo) — đã trong make. **testcontainers trên Colima** cần DOCKER_HOST+SOCKET_OVERRIDE — đã trong make test.
- Admin seed mặc định: `admin@mooni.local` / `mooni-admin`.
- CI chưa chạy GitHub thật (chưa có remote) — verified commands local. Cần tạo remote khi sẵn sàng.
- Còn treo: migrate ticket-mcrsv sang Colima + tắt Docker Desktop (side-quest, chờ sau).
- **Phân trang (chốt 2026-07-17)**: `GET /products` list-all (tập nhỏ, cố ý). Admin lists `leads`/`orders`/`customers` BẮT BUỘC paginate (limit/offset mặc định 20, max 100, mới nhất trước) — bake vào plan GĐ4/5.
- GitHub remote: https://github.com/dan10002ht/moonie.git (push 2026-07-17, CI chạy thật).
- **Docker nhẹ hóa (2026-07-17)**: dọn ~1.9GB (images 3.0GB→1.1GB). Chuẩn hóa `postgres:16-alpine` (musl) ở docker-compose + testcontainers (store_test) thay postgres:16 (debian 657MB). Deploy GĐ6 cũng dùng alpine để nhất quán collation. Dev volume tạo lại fresh (data chỉ là seed).

## Quyết định đã chốt (không mở lại nếu không có lý do mới)

- Không giỏ hàng/thanh toán online (tránh đăng ký TMĐT với Bộ Công Thương). Đặt hàng qua lead form.
- Stack: Next.js 16 (quyết định 2026-07-17: bản stable hiện hành, Turbopack mặc định, dự án mới không có lý do dùng 15) + Go (chi, pgx, sqlc) + PostgreSQL, monorepo, VPS + Docker.
- Lead mới VÀ đơn mới → lưu DB **và** bắn Telegram Bot (chốt 2026-07-17 sau khi ba-writer phát hiện spec mâu thuẫn).
- Tồn kho = trạng thái còn/hết, không đếm số lượng. Doanh thu tháng = đơn `done`. Convert lead KHÔNG tự tạo customer (`orders.customer_id` nullable).
- Admin quản lý: đơn hàng, leads, sản phẩm & tồn kho, khách hàng.
- Mockup trong `design/` là nguồn chân lý UI, không sửa.

## Ghi chú cho session sau

- Mockup dùng placeholder ảnh (`image-slot`) — cần ảnh sản phẩm thật từ chủ dự án trước khi launch.
- Telegram bot token + chat id sẽ cấu hình qua env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) — chưa có, hỏi chủ dự án khi làm tính năng notify.
- Trung thu 2026 ≈ cuối tháng 9 — website nên sẵn sàng trước tháng 8 để kịp mùa bán.
