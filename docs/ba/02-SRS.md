# 02 — SRS: Software Requirements Specification — Website Mooni Cake

> **Cập nhật:** 2026-07-18 · **Commit nguồn:** `525f222`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> Nguồn: spec `2026-07-17-mooni-website-design.md` (viết tắt "spec §n"), `CLAUDE.md`, `docs/PROGRESS.md`.
> Ưu tiên theo MoSCoW: M (Must) / S (Should) / C (Could) / W (Won't — giai đoạn này).

## ⚠️ Mâu thuẫn cần chủ dự án quyết

- **Đánh số NFR của rate-limit lệch giữa code và BA.** Comment trong `api/internal/httpx/clientip.go` gọi rate-limit per-IP là "NFR-006", nhưng trong tài liệu này NFR-006 = "lỗi API trả JSON `{error}`". BA map rate-limit vào **NFR-004** (validation/rate-limit tại API boundary) + **NFR-013** (brute-force login). Đây là mã hoá lệch trong comment code, không phải sai khác hành vi — đề nghị chủ dự án cho phép sửa comment code về `NFR-004`. Trước khi được duyệt, BA giữ nguyên đánh số hiện tại.

## Ghi nhận thực tại GĐ6 (Deploy — hardening; không sửa yêu cầu, chỉ ghi để chủ dự án nắm)

- **Hạ tầng deploy + hardening bảo mật HOÀN THÀNH & verify LOCAL** (BRIEF GĐ6 Task 0/0b/1, CHANGELOG 2026-07-18): rate-limit theo IP client thật sau proxy, security headers toàn cục, CSRF Origin-check, seed prod-guard, `docker-compose.prod.yml` + `Caddyfile` (auto HTTPS + HSTS) + backup/restore (round-trip PASS) + `docs/runbook.md`. Security-review milestone #2 (trước deploy): **0 finding ≥8 confidence**.
- **Deploy VPS thật + cấp TLS Let's Encrypt CHỜ tài nguyên chủ dự án**: VPS + domain + Telegram bot token/chat id + ảnh sản phẩm thật + `.env` production. Các mục cần môi trường thật (redirect 80→443, HSTS trên trình duyệt, SSR fetch qua https, `caddy validate`) chưa verify được ở máy dev.
- GĐ6 **KHÔNG thêm migration** — schema DB giữ nguyên tới `0007` (xem 04-data-dictionary).

## Quyết định đã chốt 2026-07-17 (chủ dự án quyết, spec đã cập nhật tại `3af21d0`)

Năm lỗ hổng ba-writer phát hiện ở bản đầu đã được chủ dự án quyết và ghi vào spec §1, §4:

1. **Telegram cho đơn mới:** bắn Telegram cho CẢ lead mới lẫn đơn mới, kể cả đơn tạo trong admin (spec §1). REQ-NOTI-002 hết treo, ưu tiên M.
2. **Tồn kho:** CHỈ là trạng thái còn/hết hàng (`available | sold_out | hidden`), không đếm số lượng — bánh làm theo mẻ/đơn đặt (spec §1).
3. **Doanh thu tháng (dashboard):** tổng đơn trạng thái `done` trong tháng (tiền thực đã về); có thể hiển thị dòng phụ "đang xử lý" để tham khảo (spec §1).
4. **Convert lead → đơn:** KHÔNG tự tạo customer — bản ghi `customers` luôn tạo thủ công; đơn convert lấy tên/SĐT từ lead, gắn customer là bước thủ công tùy chọn → `orders.customer_id` nullable (spec §1).
5. **Path prefix:** mọi endpoint (kể cả auth/admin) đều dưới `/api/v1`; `api/openapi.yaml` là nơi chốt chính thức (spec §4). Các đường dẫn `/admin/...` trong tài liệu này hiểu là `/api/v1/admin/...`.

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
| REQ-LEAD-005 | Hệ thống phải cho admin convert lead thành order qua `POST /admin/leads/{id}/convert`; lead giữ FK tới order sau khi convert. Convert KHÔNG tự tạo customer — đơn convert lấy tên/SĐT từ lead, gắn customer là bước thủ công tùy chọn. | spec §1, §3, §4 | M |

### Orders (ORD)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-ORD-001 | Hệ thống phải cho admin tạo và quản lý đơn hàng (nhập tay + convert từ lead) qua `/admin/orders`, với: mã đơn, khách hàng (FK, **nullable** — gắn thủ công tùy chọn), kênh (`website` \| `phone` \| `zalo` \| `fb`), tổng tiền, giảm giá, ngày giao, địa chỉ giao, ghi chú. | spec §1, §3, §4 | M |
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
| REQ-AUTH-001 | Hệ thống phải cung cấp `POST /api/v1/auth/login` cho admin bằng email + password; password lưu dạng bcrypt hash. | spec §3, §4, §6 | M |
| REQ-AUTH-002 | Hệ thống phải quản lý phiên admin bằng JWT trong httpOnly cookie (SameSite=Lax, Secure ở production); mọi endpoint `/admin` được bảo vệ bởi middleware auth. | spec §4, §6 | M |
| REQ-AUTH-003 | Hệ thống phải KHÔNG có đăng ký tài khoản public — admin tạo bằng CLI seed. | spec §6 | M |
| REQ-AUTH-004 | Hệ thống phải chặn truy cập `/admin` phía web bằng auth guard qua `proxy.ts` (Next.js 16 — `middleware.ts` đã deprecate). | spec §2; CLAUDE.md (Kiến trúc) | M |

### Notify (NOTI)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-NOTI-001 | Hệ thống phải gửi thông báo Telegram Bot tức thì từ Go API khi có lead mới. | spec §1, §2 | M |
| REQ-NOTI-002 | Hệ thống phải gửi thông báo Telegram tức thì khi có đơn mới, kể cả đơn tạo trong admin (nhập tay/convert). | spec §1, §2 | M |

### Dashboard & Admin UI (DASH / ADM)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| REQ-DASH-001 | Hệ thống phải cung cấp `GET /admin/dashboard` trả: số leads mới, số đơn đang xử lý, doanh thu tháng (tổng đơn trạng thái `done` trong tháng; có thể kèm dòng phụ "đang xử lý" để tham khảo). | spec §1, §4 | M |
| REQ-ADM-001 | Giao diện admin phải dùng shadcn/ui theo design tokens Mooni (navy/gold/cream, font Playfair Display + Be Vietnam Pro) — không giữ theme mặc định đen trắng. | spec §5; CLAUDE.md (tokens) | M |

## 2. Yêu cầu phi chức năng (NFR)

| Mã | Yêu cầu | Nguồn | Ưu tiên |
|---|---|---|---|
| NFR-001 | Khách submit form trên mobile → chủ nhận Telegram trong **< 5 giây**. | spec §9 | M |
| NFR-002 | Toàn site chạy HTTPS (Caddy auto HTTPS, Let's Encrypt) ở production, kèm HSTS `max-age=31536000; includeSubDomains; preload` (set tại Caddy — tầng transport, app không tự set). Redirect 80→443. | spec §2, §9 | M |
| NFR-003 | Backup Postgres hàng ngày (cron + `pg_dump` vào volume/offsite). | spec §6, §9 | M |
| NFR-004 | Validation tại API boundary (SĐT, email, độ dài, số dương); truy vấn SQL chỉ qua sqlc (chống SQL injection). | spec §6 | M |
| NFR-005 | Secrets chỉ qua biến môi trường: `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; không commit vào repo. | spec §6; CLAUDE.md | M |
| NFR-006 | Lỗi API trả JSON `{error: string}` với status code đúng ngữ nghĩa; không leak thông tin internal. | spec §4 | M |
| NFR-007 | CI GitHub Actions: lint → test → build cho cả web lẫn api. | spec §6 | M |
| NFR-008 | Toàn hệ thống chạy trên 1 VPS bằng Docker Compose. | spec §2, §9 | M |
| NFR-009 | Không log dữ liệu nhạy cảm — SĐT khách chỉ log 4 số cuối. | CLAUDE.md (Quy tắc Go) | M |
| NFR-010 | Landing đạt design-evaluator ≥ 8/10 ở cả 4 tiêu chí (design quality, originality, craft, functionality) so với mockup. | spec §9 | M |
| NFR-011 | Chủ dự án tự vận hành admin (nhập đơn, đổi trạng thái hết hàng, xem doanh thu) không cần developer. | spec §9 | M |
| NFR-012 | Rate-limit per-IP phải định danh theo **IP client THẬT** khi API đứng sau reverse proxy: chỉ tin `X-Forwarded-For` khi peer TCP nằm trong `TRUSTED_PROXIES` (IP/CIDR, fail-fast lúc boot), lấy rightmost-non-trusted; peer không tin cậy → bỏ qua XFF (chống spoof). Bổ trợ NFR-004. | security-review GĐ4; BRIEF GĐ6 Task 0 | M |
| NFR-013 | Chống brute-force: rate-limit `POST /api/v1/auth/login` (10/phút/IP). | security-review GĐ4 (finding M1) | M |
| NFR-014 | Header bảo mật toàn cục: API set `X-Content-Type-Options: nosniff` + `X-Frame-Options: DENY` + `Referrer-Policy: no-referrer` cho MỌI response (kèm `Cross-Origin-Resource-Policy: same-site` cho `/uploads`); web (`next.config.ts`) set CSP + `frame-ancestors none` + nosniff + Referrer-Policy (prod không `unsafe-eval`/`ws`). | security-review GĐ4 (finding L6); BRIEF GĐ6 Task 0b | M |
| NFR-015 | CSRF defense-in-depth: cookie phiên `SameSite=Lax` + `Secure` ở production (`IsProduction()` case-fold, hết footgun lệch case); middleware `originCheck` chặn (403) request GHI có `Origin` lạ trên `/api/v1/admin/*` + `/auth/login` + `/auth/logout` (allowlist `ALLOWED_ORIGIN`, rỗng → fallback same-origin theo Host). | security-review GĐ4 (finding L4); BRIEF GĐ6 Task 0b | M |
| NFR-016 | Deploy-gate: khi `APP_ENV=production`, seed admin **từ chối** mật khẩu mặc định (`mooni-admin`) hoặc <12 ký tự (exit≠0, không ghi DB) — bắt buộc đặt `SEED_ADMIN_PASSWORD` mạnh. | security-review GĐ4 (BẮT BUỘC); BRIEF GĐ6 Task 0b | M |
