# 02 — SRS: Software Requirements Specification — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `51d60a1`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> Nguồn: spec `2026-07-17-mooni-website-design.md` (viết tắt "spec §n"), `CLAUDE.md`, `docs/PROGRESS.md`.
> Ưu tiên theo MoSCoW: M (Must) / S (Should) / C (Could) / W (Won't — giai đoạn này).

## ⚠️ Mâu thuẫn / lỗ hổng cần chủ dự án quyết

1. **Telegram cho đơn mới:** spec §1 (phạm vi) chỉ nói *lead mới* bắn Telegram; spec §2 (bảng kiến trúc, dòng Notify) nói "Gọi từ Go khi có **lead/đơn mới**". Cần xác nhận: đơn tạo trong admin (nhập tay/convert) có bắn Telegram không? REQ-NOTI-002 ghi theo §2 nhưng treo xác nhận.
2. **"Tồn kho" là gì:** spec §1 nói admin quản lý "sản phẩm & tồn kho", nhưng bảng `products` (spec §3) chỉ có trạng thái `available | sold_out | hidden`, không có cột số lượng tồn. Cần xác nhận: tồn kho = trạng thái còn/hết hàng, hay cần theo dõi số lượng?
3. **Định nghĩa "doanh thu tháng"** trong dashboard (spec §4): tính theo đơn ở trạng thái nào (`done`? từ `confirmed` trở lên?) — spec chưa định nghĩa.
4. **Hành vi convert lead → order:** spec §3-4 nói lead có FK order khi convert, nhưng chưa nói khi convert có tự tạo bản ghi `customers` từ thông tin lead hay không.
5. **Path prefix admin API:** spec §4 ghi `POST /auth/login`, `/admin/...` trong khi public ghi đủ `/api/v1/...` — mặc định hiểu tất cả nằm dưới `/api/v1`; OpenAPI spec (`api/openapi.yaml`) sẽ là nơi chốt chính thức.

## 1. Yêu cầu chức năng (REQ)

### Landing (LAND)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-LAND-001 | Hệ thống phải hiển thị trang public dựng 1:1 từ `design/mooni-landing.html` với đầy đủ section: announcement bar, header, hero, trust strip, collection (3 hộp quà: Nguyệt Quang Kim, Vọng Nguyệt, Thỏ Ngọc), corporate gifting, craft/story, bánh lẻ, testimonials, contact/order, footer. | spec §1, §5; mockup | M |
| REQ-LAND-002 | Hệ thống phải hiển thị sản phẩm trên landing bằng dữ liệu đọc từ API public (thay đổi sản phẩm/tồn kho trong admin phản ánh ra landing). | spec §2 (luồng chính) | M |
| REQ-LAND-003 | Hệ thống phải gửi dữ liệu form liên hệ trên landing tới `POST /api/v1/leads`. | spec §2 (luồng chính) | M |
| REQ-LAND-004 | Hệ thống phải responsive theo breakpoints của mockup (920px, 720px), có sticky CTA mobile và bottom sheet liên hệ toàn cục. | spec §5 | M |

### Products (PROD)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-PROD-001 | Hệ thống phải cung cấp `GET /api/v1/products` (public) chỉ trả sản phẩm có trạng thái ≠ `hidden`. | spec §4 | M |
| REQ-PROD-002 | Hệ thống phải cho admin CRUD sản phẩm (`/admin/products`) với các thuộc tính: slug, tên, mô tả, giá, loại (`gift_box` \| `single_cake`), trạng thái (`available` \| `sold_out` \| `hidden`), ảnh, thứ tự hiển thị. | spec §3, §4 | M |
| REQ-PROD-003 | Hệ thống phải cho upload ảnh sản phẩm qua admin; ảnh lưu tại thư mục `uploads/` trên VPS (mount volume), Go API serve tĩnh, nằm trong phạm vi backup. | spec §5 | M |

### Leads (LEAD)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-LEAD-001 | Hệ thống phải cung cấp `POST /api/v1/leads` (public) có validate dữ liệu vào và rate limit. | spec §4 | M |
| REQ-LEAD-002 | Hệ thống phải lưu lead vào DB với các thuộc tính: tên, SĐT, lời nhắn, sản phẩm quan tâm, nguồn, trạng thái. | spec §1, §3 | M |
| REQ-LEAD-003 | Hệ thống phải quản lý vòng đời lead theo trạng thái `new` → `contacted` → `converted` \| `closed`. | spec §3 | M |
| REQ-LEAD-004 | Hệ thống phải cho admin xem/quản lý leads qua `/admin/leads`. | spec §4 | M |
| REQ-LEAD-005 | Hệ thống phải cho admin convert lead thành order qua `POST /admin/leads/{id}/convert`; lead giữ FK tới order sau khi convert. | spec §3, §4 | M |

### Orders (ORD)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-ORD-001 | Hệ thống phải cho admin tạo và quản lý đơn hàng (nhập tay + convert từ lead) qua `/admin/orders`, với: mã đơn, khách hàng (FK), kênh (`website` \| `phone` \| `zalo` \| `fb`), tổng tiền, giảm giá, ngày giao, địa chỉ giao, ghi chú. | spec §1, §3, §4 | M |
| REQ-ORD-002 | Hệ thống phải quản lý trạng thái đơn theo chuỗi `new` → `confirmed` → `delivering` → `done` \| `cancelled`, và cung cấp API cập nhật trạng thái. | spec §3, §4 | M |
| REQ-ORD-003 | Hệ thống phải tạo order + order_items trong cùng một transaction. | spec §3 | M |
| REQ-ORD-004 | Hệ thống phải snapshot tên + đơn giá sản phẩm vào order_items tại thời điểm đặt — đổi giá sản phẩm không ảnh hưởng đơn cũ. | spec §3 | M |

### Customers (CUST)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-CUST-001 | Hệ thống phải cho admin CRUD khách hàng (`/admin/customers`) với: tên, SĐT, email, công ty, địa chỉ, loại (`personal` \| `business`), ghi chú. | spec §3, §4 | M |

### Auth (AUTH)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-AUTH-001 | Hệ thống phải cung cấp `POST /auth/login` cho admin bằng email + password; password lưu dạng bcrypt hash. | spec §3, §4, §6 | M |
| REQ-AUTH-002 | Hệ thống phải quản lý phiên admin bằng JWT trong httpOnly cookie (SameSite=Lax, Secure ở production); mọi endpoint `/admin` được bảo vệ bởi middleware auth. | spec §4, §6 | M |
| REQ-AUTH-003 | Hệ thống phải KHÔNG có đăng ký tài khoản public — admin tạo bằng CLI seed. | spec §6 | M |
| REQ-AUTH-004 | Hệ thống phải chặn truy cập `/admin` phía web bằng auth guard qua `proxy.ts` (Next.js 16 — `middleware.ts` đã deprecate). | spec §2; CLAUDE.md (Kiến trúc) | M |

### Notify (NOTI)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-NOTI-001 | Hệ thống phải gửi thông báo Telegram Bot tức thì từ Go API khi có lead mới. | spec §1, §2 | M |
| REQ-NOTI-002 | Hệ thống phải gửi thông báo Telegram khi có đơn mới. **⚠️ Treo xác nhận** — xem mục Mâu thuẫn #1. | spec §2 (bảng Notify) | S |

### Dashboard & Admin UI (DASH / ADM)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-DASH-001 | Hệ thống phải cung cấp `GET /admin/dashboard` trả: số leads mới, số đơn đang xử lý, doanh thu tháng. | spec §1, §4 | M |
| REQ-ADM-001 | Giao diện admin phải dùng shadcn/ui theo design tokens Mooni (navy/gold/cream, font Playfair Display + Be Vietnam Pro) — không giữ theme mặc định đen trắng. | spec §5; CLAUDE.md (tokens) | M |

## 2. Yêu cầu phi chức năng (NFR)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| NFR-001 | Khách submit form trên mobile → chủ nhận Telegram trong **< 5 giây**. | spec §9 | M |
| NFR-002 | Toàn site chạy HTTPS (Caddy auto HTTPS) ở production. | spec §2, §9 | M |
| NFR-003 | Backup Postgres hàng ngày (cron + `pg_dump` vào volume/offsite). | spec §6, §9 | M |
| NFR-004 | Validation tại API boundary (SĐT, email, độ dài, số dương); truy vấn SQL chỉ qua sqlc (chống SQL injection). | spec §6 | M |
| NFR-005 | Secrets chỉ qua biến môi trường: `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; không commit vào repo. | spec §6; CLAUDE.md | M |
| NFR-006 | Lỗi API trả JSON `{error: string}` với status code đúng ngữ nghĩa; không leak thông tin internal. | spec §4 | M |
| NFR-007 | CI GitHub Actions: lint → test → build cho cả web lẫn api. | spec §6 | M |
| NFR-008 | Toàn hệ thống chạy trên 1 VPS bằng Docker Compose. | spec §2, §9 | M |
| NFR-009 | Không log dữ liệu nhạy cảm — SĐT khách chỉ log 4 số cuối. | CLAUDE.md (Quy tắc Go) | M |
| NFR-010 | Landing đạt design-evaluator ≥ 8/10 ở cả 4 tiêu chí (design quality, originality, craft, functionality) so với mockup. | spec §9 | M |
| NFR-011 | Chủ dự án tự vận hành admin (nhập đơn, đổi trạng thái hết hàng, xem doanh thu) không cần developer. | spec §9 | M |
