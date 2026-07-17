# Changelog

## 2026-07-18

### CI
- **fix(web)** — CI web `npm ci` fail trên runner linux: lock sinh trên darwin thiếu native binary theo platform của Tailwind v4 (`@tailwindcss/oxide-linux-x64-gnu/musl`, optionalDependencies os/cpu). Chuyển web install (CI + Dockerfile) sang `npm install --no-audit --no-fund` (vẫn theo lock cho dep nhất quán, chỉ reconcile native binary). CI xanh trở lại. Commit `46cedca`.

### Giai đoạn 6 — Deploy (hardening)
- **Task 0** — Rate-limit theo IP client THẬT sau reverse proxy: `ClientIPResolver` (`api/internal/httpx/clientip.go`) — RemoteAddr không-trusted → bỏ qua X-Forwarded-For (chống spoof); trusted → lấy rightmost-non-trusted của XFF. Config `TRUSTED_PROXIES` (CSV IP/CIDR, fail-fast lúc boot). 2 rate limiter (leads 20/phút + login 10/phút) dùng chung resolver. Next forward XFF cho `/leads` + `/auth/login` (`web/lib/client-ip.ts`, `web/lib/api.ts`, `web/app/actions/{lead,admin}.ts`). Held-out 13/13 + go-reviewer PASS. ⚠️ prod BẮT BUỘC set TRUSTED_PROXIES. Commit chờ.

## 2026-07-17

### Giai đoạn 1 — Scaffold
- **Task 1** — Docker Compose + Postgres (port 5440 trên Colima) + khung env (.env.example, Makefile). Commit `bfff066`.
- **Task 2** — Go API skeleton: chi router, config từ env, error helper JSON, db pool, `GET /api/v1/healthz`, graceful shutdown, `.golangci.yml`. go-reviewer bắt lỗ hổng IP-spoofing (RealIP) + thiếu timeout/graceful shutdown → đã sửa. Commit `e9b516c` → `8696c89`.
- **Task 3** — OpenAPI spec-first (`api/openapi.yaml`) + oapi-codegen v2.4.1: sinh `ServerInterface`, wire router qua `HandlerFromMuxWithBaseURL(/api/v1)`, contract gate cưỡng chế lúc compile. Commit `c659470`.
- **Task 4** — sqlc + golang-migrate (bảng `admin_users`) + integration test testcontainers-go (Postgres:16 thật). Phát hiện shim `cc` phá CGO → chuẩn hóa `make lint`/`make test` với `CGO_ENABLED=0`. Go floor lên 1.25 (testcontainers). Commit `ed1e6ea`, `0e74f8b`.
- **Task 5** — Next.js 16.2.10 scaffold (Turbopack) + Tailwind v4 design tokens (`@theme`), font Playfair Display + Be Vietnam Pro, `lib/api.ts` client, `proxy.ts` skeleton auth guard `/admin`. Commit `dc40754`.
- **Task 6** — openapi-typescript: sinh `web/types/api.d.ts` từ spec, `getHealth()` typed, `tsc --noEmit` thành contract gate compile-time phía web. Vòng contract web↔api khép kín. Commit `1ecc8f3`.
- **Task 7** — CI GitHub Actions (`.github/workflows/ci.yml`, 2 job lint+test+build) + Dockerfile api (distroless 17.7MB) & web (standalone 388MB) + full `docker compose` cả stack. Fix package-lock portability (darwin→linux) và testcontainers trên Colima (socket override). Commit `7bda1f8`, `97589ae`.
- **Task 8** — Project skill `run-moonie` (boot runbook cho mọi agent) + `api/cmd/seed` (admin mẫu idempotent, bcrypt). Commit `b2a5914`.
- **🎉 Giai đoạn 1 (Scaffold) hoàn thành 8/8** — monorepo Next.js 16 + Go + Postgres chạy được đầu-cuối, contract OpenAPI 2 phía, CI + Docker sẵn sàng.

### Giai đoạn 2 — API Public
- **Task 1** — `GET /api/v1/products` public (bảng products, chỉ trả status != hidden, ORDER BY tất định). Held-out acceptance test 12/12 + go-reviewer PASS. Commit `3aedd62`, `207ed4b`.
- **Task 2** — `POST /api/v1/leads` public (bảng leads, validate SĐT VN/tên/độ dài, rate limit 20/phút/IP theo RemoteAddr chống spoof, log che SĐT NFR-009, lưu status `new`). Held-out 7/7 (phơi vấn đề rate limit 5/phút chặn oan IP NAT doanh nghiệp → bump 20) + go-reviewer PASS. Commit `357eba7`, `1b4020d`.
- **Task 3** — Telegram notify lead mới, fail-safe (goroutine + timeout, POST /leads luôn 201 dù Telegram lỗi/treo/không token; `TELEGRAM_API_BASE` override để test; log che SĐT; không rò token bot). Held-out 3/3 + go-reviewer PASS. Commit `4fb4a0d`, `7b59e92`.
- **Task 4** — web api client `getProducts()` + `createLead()` (typed từ OpenAPI, ApiError mang status cho UI phân biệt 400/429). tsc contract gate. Commit `54a31d1`.
- **🎉 Giai đoạn 2 (API Public) hoàn thành 4/4** — GET /products, POST /leads, Telegram notify, web client. Landing (GĐ3) đã đủ API.
- **Hạ tầng**: Docker nhẹ hóa ~1.9GB (postgres:16-alpine chuẩn hóa dev/test/CI). CI GitHub xanh thật.

### Giai đoạn 3 — Landing page
- **Task 1** — Seed 7 sản phẩm mẫu khớp mockup (3 hộp quà + 4 bánh lẻ) + field `badge` (migration 0004) cho nhãn "Bán chạy"/"Mới" + cài Playwright. Commit `bd6b935`, `bc41529`.
- **Task 2** — Landing frame (announcement bar, header + menu mobile, hero navy serif, trust strip, footer, sticky CTA mobile) port 1:1 từ mockup. design-evaluator PASS 9/9/8/9. Commit `bfbbc00`.
- **Task 3** — Landing product & content sections (bộ sưu tập 3 hộp + 4 bánh lẻ từ GET /products, quà DN, câu chuyện, testimonials). Thêm product model: `badge`, `compare_at_price` (giá KM), `subtitle` (nhãn loại) — migration 0005. design-evaluator PASS 9/9/9/9. Commit `1c5a81b`, `8297aaf`.
- **Task 4** — Contact bottom sheet + form đặt hàng → POST /leads (qua Next Server Action) + kênh nhanh Zalo/Messenger/Gọi. Mở/đóng X/backdrop/Escape, xử lý 400/429. qa-evaluator held-out 9/9 + design-evaluator 9/9/9/9. Commit `c99b4ea`.
- **🎉 Giai đoạn 3 (Landing) hoàn thành 4/4** — website có trang chủ hoàn chỉnh khớp mockup, khách đặt hàng qua form → admin + Telegram.

### Giai đoạn 4 — Admin API
- **Task 1** — Schema `customers`/`orders`/`order_items` + `leads.order_id` + sqlc (CRUD, phân trang tie-break, dashboard). Fix flaky testcontainers + bug doanh thu lệch múi giờ (neo giờ VN). Commit `4f0eb84`, `7de3515`, `2f0b771`.
- **Task 2** — Auth admin: login JWT httpOnly cookie (chống alg-confusion + user-enumeration + timing), middleware bảo vệ /admin/*, proxy.ts guard, reject JWT_SECRET yếu/placeholder. Held-out 16/16 + go-reviewer PASS (thử tấn công thật đều chặn). Commit `7b6b2ab`, `e8b7bb5`.
- **Task 3** — Admin products CRUD + upload ảnh (soft delete, magic-byte sniff, uuid filename, chống path-traversal/DoS). Held-out PASS + go-reviewer PASS (tấn công upload thật đều chặn) + hardening (slug regex, no dir-listing, nosniff). Commit `ad8e755`, `c76679b`.
- **Task 4** — Admin leads: list phân trang {items,total} + đổi status + convert lead→đơn nháp (transaction, note giữ contact, không tạo customer, Telegram notify). go-reviewer bắt race TOCTOU (2 convert→đơn mồ côi) → fix atomic guard + FOR UPDATE. Commit `fa305e8`, `8437554`.
- **Task 5** — Admin orders: nhập đơn tay (transaction order+items, snapshot giá REQ-ORD-004, tính subtotal/total), list phân trang, chi tiết, đổi status, Telegram đơn mới. go-reviewer bắt lỗi tài chính (cắt quantity int32 → data corruption, tràn int64, customer FK→500) → fix chặn overflow + trần quantity/tiền/item. Commit `75a0fde`, `48a5de3`.
- **Task 6** — Admin customers CRUD phân trang (validate name/type/phone/email ở boundary, không leak SĐT/email log). go-reviewer PASS → chuẩn hóa lỗi bind param → JSON {error} toàn API. Commit `498255d`, `5d5497a`.
- **Task 7** — Admin dashboard (leads mới/đơn xử lý/doanh thu tháng giờ VN) + security-review TỔNG (không HIGH/CRITICAL; xác nhận authz không sót, JWT/upload/overflow/injection đạt) → fix M1 rate-limit login chống brute-force. Commit `f904bea`, `0499b98`.
- **🎉 Giai đoạn 4 (Admin API) hoàn thành 7/7** — backend admin đầy đủ, security-review sạch. Còn admin UI (GĐ5) + deploy (GĐ6).

### Giai đoạn 5 — Admin UI
- **Task 1** — Admin shell + login + dashboard (shadcn/ui map tokens Mooni navy-gold, Server Action + cookie forward, proxy guard). qa-evaluator held-out 5/5 + design-evaluator 9/9/8/9. Commit `8b80095`, `f9e9345`.
- **Task 2** — Admin quản lý sản phẩm: bảng (gồm hidden) + dialog form tạo/sửa + upload ảnh (soft delete, preview). held-out 6/6 + design-evaluator 9/9/8/10. Commit `33fd088`, `32c5089`, `cc73efd`.
- **Task 3** — Admin quản lý leads: bảng phân trang + đổi status + convert→đơn (SĐT/lời nhắn hiện đủ, làm rõ nhãn convert vs trạng thái). held-out 6/6 + design-evaluator 9/9/8/10. Commit `1a145c7`, `cb74f38`.
- **Task 4** — Admin quản lý đơn hàng: bảng phân trang + form tạo đơn nhiều dòng món (tổng realtime) + chi tiết snapshot + đổi status (chặn terminal). held-out 7/7 + design-evaluator 9/8/8/9. Commit `6bf9c20`, `2136049`.
- **Task 5** — Admin quản lý khách hàng: bảng phân trang + form tạo/sửa (SĐT tel:/email mailto: đủ liên hệ). held-out 7/7 + design-evaluator 9/8/8/9. Commit `4028a66`.
- **🎉 Giai đoạn 5 (Admin UI) hoàn thành 5/5** — admin đầy đủ (login/dashboard/sản phẩm/leads/đơn/khách) theo tokens Mooni. Chỉ còn deploy (GĐ6).
