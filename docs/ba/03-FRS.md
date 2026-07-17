# 03 — FRS: Functional Requirements Specification — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `51d60a1`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> Nguồn: spec `2026-07-17-mooni-website-design.md`, `design/mooni-landing.html`, `design/mooni-design-system.html`, `CLAUDE.md`.
> ⚠️ Dự án chưa có code (`api/`, `web/` chưa tồn tại). Mọi luồng dưới đây phái sinh từ spec đã duyệt; khi có `api/openapi.yaml` + migrations, tài liệu sẽ đối chiếu lại. Các mâu thuẫn/lỗ hổng: xem 02-SRS.md mục đầu.

## 1. Module Landing (REQ-LAND-001..004)

### 1.1 Cấu trúc trang (theo mockup `design/mooni-landing.html`)

Thứ tự section, phải dựng 1:1: Announcement bar → Header → Hero → Trust strip → Collection (3 hộp quà: Nguyệt Quang Kim, Vọng Nguyệt, Thỏ Ngọc) → Corporate gifting → Craft/Story → Flavors (bánh lẻ) → Testimonials → Contact/Order (form) → Footer. Ngoài luồng: Sticky mobile CTA + Global contact bottom sheet.

### 1.2 Quy tắc

- Dữ liệu sản phẩm đọc từ `GET /api/v1/products` — chỉ hiển thị sản phẩm ≠ `hidden`; trạng thái `sold_out` do admin đặt phải phản ánh ra landing.
- Responsive breakpoints: 920px, 720px (theo mockup). Sticky CTA chỉ hiện trên mobile.
- UI theo design tokens (navy `#041E4F`, gold `#C6A867`, cream `#F7F6F4`; Playfair Display + Be Vietnam Pro, subset `vietnamese,latin`). Mâu thuẫn token vs mockup → mockup thắng (CLAUDE.md).
- Text tiếng Việt có dấu chuẩn, giọng thương hiệu sang trọng theo mockup.
- Ảnh sản phẩm: hiện là placeholder; ảnh thật upload qua admin (xem module Products).

## 2. Module Leads (REQ-LEAD-001..005, REQ-LAND-003)

### 2.1 Luồng thu lead (luồng chính của toàn hệ thống — spec §2)

1. Khách điền form (landing form hoặc bottom sheet) → web gọi `POST /api/v1/leads`.
2. API validate (xem 2.3) + rate limit; hợp lệ → lưu bản ghi lead trạng thái `new`.
3. API bắn thông báo Telegram Bot ngay (mục 7).
4. Admin thấy lead trong `/admin/leads`, liên hệ khách, cập nhật trạng thái.

### 2.2 Vòng đời trạng thái lead (spec §3)

```
new → contacted → converted (kèm FK order)
                → closed
```

- `converted`: qua `POST /admin/leads/{id}/convert` — tạo order và lead lưu FK tới order đó.
- Điều kiện chuyển chi tiết (được phép chuyển từ trạng thái nào, có được quay lui không) **chưa định nghĩa trong spec** — chốt ở bước plan/OpenAPI.

### 2.3 Validation (spec §4, §6)

- Tại API boundary: SĐT đúng định dạng, độ dài các trường trong giới hạn.
- Rate limit trên `POST /api/v1/leads` (chống spam form public). Ngưỡng cụ thể chưa định nghĩa trong spec.

### 2.4 Dữ liệu lead

Tên, SĐT, lời nhắn, sản phẩm quan tâm, nguồn, trạng thái, FK order (khi convert) — xem 04-data-dictionary.md.

## 3. Module Orders (REQ-ORD-001..004)

### 3.1 Hai cách tạo đơn (spec §1)

1. **Nhập tay** trong admin (kênh `phone` | `zalo` | `fb` | `website`).
2. **Convert từ lead** (`POST /admin/leads/{id}/convert`). ⚠️ Spec chưa nói convert có tự tạo bản ghi customer từ lead không (SRS, mâu thuẫn #4).

### 3.2 Vòng đời trạng thái đơn (spec §3)

```
new → confirmed → delivering → done
                             → cancelled
```

- API cung cấp cập nhật trạng thái (spec §4). Điều kiện chuyển chi tiết (vd. `cancelled` được phép từ trạng thái nào) **chưa định nghĩa trong spec** — chốt ở bước plan/OpenAPI.

### 3.3 Quy tắc nghiệp vụ

- **Transaction:** tạo order + order_items trong cùng một transaction — không có đơn thiếu items (spec §3).
- **Snapshot giá:** order_items lưu snapshot tên + đơn giá tại thời điểm đặt; admin đổi giá sản phẩm sau đó không ảnh hưởng đơn cũ (spec §3).
- Đơn có: mã đơn, FK customer, kênh, tổng tiền, giảm giá, ngày giao, địa chỉ giao, ghi chú.
- Validation: số dương cho các trường số (spec §6).

## 4. Module Products (REQ-PROD-001..003)

- Public: `GET /api/v1/products` chỉ trả sản phẩm ≠ `hidden`.
- Admin CRUD `/admin/products`: slug, tên, mô tả, giá, loại (`gift_box` | `single_cake`), trạng thái (`available` | `sold_out` | `hidden`), ảnh, thứ tự hiển thị.
- Trạng thái sản phẩm là cơ chế "tồn kho" duy nhất được spec định nghĩa (⚠️ SRS mâu thuẫn #2 — chưa có số lượng tồn).
- Ảnh: upload qua admin → lưu `uploads/` trên VPS (mount volume), Go API serve tĩnh, nằm trong backup. Không dùng S3.

## 5. Module Customers (REQ-CUST-001)

- Admin CRUD `/admin/customers`: tên, SĐT, email, công ty, địa chỉ, loại (`personal` | `business`), ghi chú.
- Phục vụ định vị quà biếu 2 nhóm khách: cá nhân và doanh nghiệp (spec §1).

## 6. Module Auth (REQ-AUTH-001..004)

### 6.1 Luồng đăng nhập admin

1. Admin mở `/admin` → chưa có phiên hợp lệ → auth guard (`proxy.ts` phía Next.js) chặn, đưa về trang login.
2. `POST /auth/login` với email + password → API so bcrypt hash trong `admin_users`.
3. Thành công → JWT đặt trong httpOnly cookie (SameSite=Lax; Secure ở production).
4. Mọi request `/admin/*` phía API đi qua middleware auth kiểm tra JWT.

### 6.2 Quy tắc

- Không có đăng ký public. Tài khoản admin tạo bằng CLI seed (spec §6).
- Lỗi auth trả JSON `{error}` đúng status, không leak internal (spec §4).

## 7. Module Notify (REQ-NOTI-001..002)

- Kênh: Telegram Bot API, gọi trực tiếp từ Go API (spec §2).
- Sự kiện: **lead mới** (chắc chắn — spec §1); **đơn mới** (⚠️ treo xác nhận — SRS mâu thuẫn #1).
- Cấu hình qua env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — giá trị thật chưa có, hỏi chủ dự án khi làm tính năng (PROGRESS.md).
- SLA: chủ nhận thông báo < 5 giây kể từ khi khách submit (NFR-001).
- Nội dung tin nhắn: spec chưa định nghĩa — chốt ở bước plan. Lưu ý NFR-009: không log SĐT đầy đủ (chỉ 4 số cuối) trong log hệ thống.

## 8. Module Dashboard & Admin UI (REQ-DASH-001, REQ-ADM-001)

- `GET /admin/dashboard` trả 3 chỉ số: số leads mới, số đơn đang xử lý, doanh thu tháng (⚠️ định nghĩa "doanh thu tháng" chưa chốt — SRS mâu thuẫn #3).
- Admin UI dùng shadcn/ui nhưng theo tokens Mooni — không giữ theme mặc định đen trắng (spec §5).
