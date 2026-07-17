# Spec: Website Mooni Cake

**Ngày:** 2026-07-17 · **Trạng thái:** Đã duyệt thiết kế tổng thể; giai đoạn 1 (harness setup) hoàn thành cùng ngày.

## 1. Mục tiêu & phạm vi

Website cho Mooni Cake — thương hiệu bánh trung thu cao cấp, định vị quà biếu (cá nhân + doanh nghiệp).

**Trong phạm vi:**
- Trang public dựng 1:1 từ mockup (`design/mooni-landing.html`): hero, trust strip, bộ sưu tập hộp quà (Nguyệt Quang Kim, Vọng Nguyệt, Thỏ Ngọc), quà doanh nghiệp, câu chuyện, bánh lẻ, testimonials, form liên hệ, bottom sheet, sticky CTA mobile.
- Đặt hàng qua **lead form** (không giỏ hàng, không thanh toán online — quyết định chủ đích để không phải đăng ký sàn TMĐT với Bộ Công Thương).
- **Admin** tại `/admin`: đơn hàng (nhập tay + convert từ lead), leads, sản phẩm & tồn kho, khách hàng, dashboard doanh thu.
- Lead mới: lưu DB + thông báo **Telegram Bot** tức thì.

**Ngoài phạm vi:** giỏ hàng, cổng thanh toán, đa ngôn ngữ, blog (có thể thêm sau).

## 2. Kiến trúc

Monorepo, VPS + Docker Compose:

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| `web/` | Next.js 15 App Router, Tailwind CSS, shadcn/ui (admin) | Public site + admin UI. Server Components mặc định. |
| `api/` | Go: chi router, pgx + sqlc, golang-migrate | REST JSON `/api/v1`. |
| DB | PostgreSQL 16 (Docker volume + backup script) | |
| Reverse proxy | Caddy (auto HTTPS) | Production. |
| Notify | Telegram Bot API | Gọi từ Go khi có lead/đơn mới. |

Luồng chính: khách điền form → `POST /api/v1/leads` → lưu DB + bắn Telegram → admin xử lý lead → convert thành order. Sản phẩm/tồn kho sửa trong admin → landing đọc từ API.

## 3. Database (6 bảng)

- `products` — slug, tên, mô tả, giá, loại (`gift_box` | `single_cake`), trạng thái (`available` | `sold_out` | `hidden`), ảnh, thứ tự hiển thị.
- `leads` — tên, SĐT, lời nhắn, sản phẩm quan tâm, nguồn, trạng thái (`new` → `contacted` → `converted` | `closed`), FK order khi convert.
- `customers` — tên, SĐT, email, công ty, địa chỉ, loại (`personal` | `business`), ghi chú.
- `orders` — mã đơn, FK customer, trạng thái (`new` → `confirmed` → `delivering` → `done` | `cancelled`), kênh (`website` | `phone` | `zalo` | `fb`), tổng tiền, giảm giá, ngày giao, địa chỉ giao, ghi chú.
- `order_items` — FK order, FK product, snapshot tên + đơn giá tại thời điểm đặt, số lượng.
- `admin_users` — email, password hash (bcrypt), tên, role.

Tạo order + order_items trong transaction. Giá trong `order_items` là snapshot — đổi giá sản phẩm không ảnh hưởng đơn cũ.

## 4. API surface

**Public:** `GET /api/v1/products` (chỉ trạng thái ≠ hidden), `POST /api/v1/leads` (validate + rate limit).

**Admin (JWT httpOnly cookie, middleware auth):** `POST /auth/login`, CRUD `/admin/products`, `/admin/leads` (+ `POST /admin/leads/{id}/convert`), `/admin/orders` (+ cập nhật trạng thái), `/admin/customers`, `GET /admin/dashboard` (đếm leads mới, đơn đang xử lý, doanh thu tháng).

Lỗi trả JSON `{error: string}` với status code đúng ngữ nghĩa; không leak internal.

## 5. UI

- Nguồn chân lý: `design/mooni-design-system.html` (tokens, components) + `design/mooni-landing.html` (layout). Design tokens đã trích vào CLAUDE.md (navy `#041E4F`, gold `#C6A867`, cream `#F7F6F4`, font Playfair Display + Be Vietnam Pro).
- Admin: shadcn/ui nhưng theo tokens Mooni (không giữ theme mặc định đen trắng).
- Responsive theo breakpoints của mockup (920px, 720px), sticky mobile CTA, bottom sheet liên hệ toàn cục.
- Ảnh sản phẩm: mockup dùng placeholder — chờ ảnh thật từ chủ dự án, upload qua admin. Ảnh lưu trên VPS (thư mục `uploads/` mount volume, Go API serve tĩnh, nằm trong backup) — không cần S3 ở quy mô này.

## 6. Bảo mật & vận hành

- Auth: bcrypt + JWT httpOnly (SameSite=Lax, Secure ở production). Không đăng ký public — admin tạo bằng CLI seed.
- Validation ở API boundary (SĐT, email, độ dài, số dương). SQL chỉ qua sqlc.
- Secrets qua env: `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Backup Postgres hàng ngày (cron + `pg_dump` vào volume/offsite).
- CI GitHub Actions: lint → test → build cho cả web lẫn api.

## 7. Harness phát triển (giai đoạn chuẩn bị — đã xong)

Áp dụng bài học từ "Harness Design for Long-Running Application Development" (Anthropic Engineering, 03/2026):

- **Tách generator khỏi evaluator** — 3 agent độc lập trong `.claude/agents/`: `qa-evaluator` (chạy app thật, threshold cứng, rớt 1 tiêu chí = fail), `design-evaluator` (chấm vs mockup theo 4 tiêu chí: design quality, originality, craft, functionality), `go-reviewer` (correctness, security, tests).
- **Hợp đồng trước khi code** — mỗi task trong plan có definition of done + tiêu chí test viết trước.
- **Handoff artifacts** — spec này + `docs/PROGRESS.md` + plans, để session mới tiếp tục không phụ thuộc context cũ.
- **Chủ đích KHÔNG bê vào:** context reset máy móc, sprint construct, planner tự nở spec — theo chính bài viết, các scaffold này hết load-bearing với model đời mới; giữ harness tối giản.

Quy trình 8 bước bắt buộc cho mỗi feature: xem CLAUDE.md.

## 8. Thứ tự triển khai (input cho writing-plans)

1. Scaffold monorepo: web/ + api/ + docker-compose (Postgres) + CI.
2. API nền: migrations, sqlc, health check; endpoints public (products, leads) + Telegram notify.
3. Landing page từ mockup (đọc products từ API, form đẩy leads).
4. Auth admin + API admin.
5. Admin UI (dashboard, leads, orders, products, customers).
6. Deploy VPS: compose production + Caddy + backup + GitHub Actions deploy.

Mỗi bước = 1 plan riêng, kết thúc bằng evaluator pass + PROGRESS.md cập nhật.

## 9. Tiêu chí thành công của toàn dự án

- Landing giống mockup đến mức design-evaluator chấm ≥ 8/10 cả 4 tiêu chí.
- Khách điền form trên mobile → chủ nhận Telegram trong < 5 giây, lead xuất hiện trong admin.
- Chủ tự nhập đơn, đổi trạng thái hết hàng, xem doanh thu — không cần developer.
- Toàn bộ chạy trên 1 VPS, HTTPS, backup tự động.
