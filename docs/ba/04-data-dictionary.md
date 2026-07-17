# 04 — Data Dictionary — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `3946927`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> ⚠️ **Sinh từ mục Database (spec §3).** Sau GĐ2 (API Public) đã có 3 migration đối chiếu code thật: `0001_init` (`admin_users`, §6), `0002_products` (`products`, §1), `0003_leads` (`leads`, §2). GĐ3 (Landing) bổ sung 2 migration mở rộng `products`: `0004_product_badge`, `0005_product_compare_subtitle` (§1). Ba bảng nghiệp vụ còn lại (`customers`, `orders`, `order_items`) CHƯA có migration — vẫn là spec; kiểu dữ liệu cụ thể chưa được spec định nghĩa nên KHÔNG ghi ở đây, chỉ ghi thuộc tính nghiệp vụ và ràng buộc spec nêu, chờ migration đối chiếu.

> **Ghi nhận thực tại GĐ1** (không sửa yêu cầu nghiệp vụ, chỉ ghi để chủ dự án nắm):
> - `admin_users.role`: migration đặt `DEFAULT 'admin'` và KHÔNG có ràng buộc CHECK liệt kê giá trị. Thực tại GĐ1 chỉ dùng 1 role `'admin'`; spec vẫn chưa chốt danh sách role. Nếu sau này cần phân quyền nhiều role, cần migration bổ sung.
> - `admin_users.password_hash` kiểu `text`; seed (`api/cmd/seed`) sinh hash **bcrypt** (`$2a$…`), khớp yêu cầu "không lưu plaintext" của spec.

> **Ghi nhận thực tại GĐ2** (không sửa yêu cầu, chỉ ghi để chủ dự án nắm):
> - `products.price` kiểu **`bigint`** (VND số nguyên) — không dùng float/numeric cho tiền. `type` và `status` có ràng buộc **CHECK** liệt kê giá trị; `display_order int DEFAULT 0` để sắp landing. Ảnh lưu ở cột `image_url text` (URL/đường dẫn), không lưu blob.
> - `leads.source` kiểu `text` **DEFAULT `'website'` nhưng KHÔNG có CHECK** — nguồn là chuỗi tự do, hiện thực tại chỉ có `'website'`. `status` có CHECK `new|contacted|converted|closed`.
> - ⚠️ **`leads` KHÔNG có cột FK sang `orders`** trong migration `0003` (dòng "FK order" ở §2 trước đây là dự đoán từ spec). Việc liên kết lead→đơn khi `converted` chưa hiện diện ở schema — sẽ do migration GĐ4 quyết định (cột FK trên `leads` hay tra ngược từ `orders`). Không phải mâu thuẫn, chỉ là phần chưa tới.
> - `leads` KHÔNG có `updated_at` (chỉ `created_at`); vòng đời hiện chỉ đổi `status`. `products` có cả `created_at` và `updated_at`.

> **Ghi nhận thực tại GĐ3** (không sửa yêu cầu, chỉ ghi để chủ dự án nắm):
> - **`products` thêm 3 cột nullable** (quyết định chủ dự án để card landing khớp mockup): `badge` (migration `0004`), `compare_at_price` + `subtitle` (migration `0005`). Cả ba đều nullable — không phá đơn/sản phẩm cũ. Đã đưa vào `Product` schema `api/openapi.yaml`, xuất qua `GET /products`.
> - **`compare_at_price` là giá "compare-at" kiểu Shopify**, KHÔNG phải giá bán. Landing chỉ hiện giá gạch + % giảm khi `compare_at_price > price`; NULL hoặc ≤ `price` thì không hiện KM. Migration KHÔNG cưỡng chế ràng buộc `> price` ở DB — logic hiển thị nằm ở web (card), là chủ đích.
> - **`low_stock` status HOÃN sang GĐ admin (GĐ4).** GĐ3 không thêm giá trị `low_stock` vào CHECK của `products.status` — vẫn là `available|sold_out|hidden`. Cần migration bổ sung khi làm quản lý tồn kho admin.

DB: PostgreSQL 16. 6 bảng. Truy vấn chỉ qua sqlc; migration chỉ thêm file mới (CLAUDE.md).

## 1. `products` — sản phẩm

> ✅ **Đã khớp migration `0002_products.up.sql`** (GĐ2, task 1) **+ `0004_product_badge.up.sql` + `0005_product_compare_subtitle.up.sql`** (GĐ3). Cột/kiểu/ràng buộc lấy trực tiếp từ migration thật, không còn suy diễn từ spec.

| Cột | Kiểu | Ràng buộc | Ý nghĩa nghiệp vụ |
|---|---|---|---|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Khóa chính; UUID sinh phía DB |
| `slug` | `text` | UNIQUE, NOT NULL | Định danh thân thiện URL |
| `name` | `text` | NOT NULL | Tên hiển thị (vd. Nguyệt Quang Kim) |
| `subtitle` | `text` | nullable (migration `0005`) | Nhãn phân loại nhỏ IN HOA phía trên tên trên card landing (vd "Hộp thiếc cao cấp", "Bánh nướng · 180g"). NULL = không hiện |
| `description` | `text` | nullable | Mô tả sản phẩm trên landing |
| `price` | `bigint` | NOT NULL | Giá bán VND, **số nguyên**; đơn cũ không bị ảnh hưởng khi đổi (snapshot ở `order_items`) |
| `compare_at_price` | `bigint` | nullable (migration `0005`) | Giá gốc kiểu "compare-at" (Shopify) để hiện khuyến mãi. Nếu `> price` → landing hiện giá gạch + % giảm; NULL hoặc ≤ `price` = không có KM. Không phải giá bán; ràng buộc `> price` do web kiểm, DB không cưỡng chế |
| `badge` | `text` | nullable (migration `0004`) | Nhãn marketing hiển thị trên card (vd "Bán chạy", "Mới", "Quà biếu"). NULL = không có badge |
| `type` | `text` | NOT NULL, CHECK IN (`gift_box`, `single_cake`) | Hộp quà hay bánh lẻ |
| `status` | `text` | NOT NULL, DEFAULT `'available'`, CHECK IN (`available`, `sold_out`, `hidden`) | `hidden` không xuất hiện trên API public. Tồn kho = trạng thái còn/hết hàng, KHÔNG đếm số lượng (chốt 2026-07-17, spec §1). `low_stock` hoãn sang GĐ admin — chưa có trong CHECK |
| `image_url` | `text` | nullable | URL/đường dẫn ảnh; upload qua admin (GĐ4–5) |
| `display_order` | `int` | NOT NULL, DEFAULT `0` | Sắp xếp trên landing |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm tạo |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm cập nhật |

## 2. `leads` — khách để lại thông tin

> ✅ **Đã khớp migration `0003_leads.up.sql`** (GĐ2, task 2). Cột/kiểu/ràng buộc lấy trực tiếp từ migration thật.

| Cột | Kiểu | Ràng buộc | Ý nghĩa nghiệp vụ |
|---|---|---|---|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Khóa chính |
| `name` | `text` | NOT NULL | Tên khách; validate độ dài tại API boundary (NFR-004) |
| `phone` | `text` | NOT NULL | Kênh liên hệ chính; validate SĐT VN tại API boundary; log chỉ 4 số cuối (NFR-009) |
| `message` | `text` | nullable | Nội dung khách nhập ở form |
| `product_interest` | `text` | nullable | Sản phẩm khách chọn/quan tâm khi điền form |
| `source` | `text` | NOT NULL, DEFAULT `'website'` | Nguồn lead; chuỗi tự do (KHÔNG có CHECK) |
| `status` | `text` | NOT NULL, DEFAULT `'new'`, CHECK IN (`new`, `contacted`, `converted`, `closed`) | Vòng đời xử lý lead |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm tạo (không có `updated_at`) |

> ⚠️ Migration `0003` **chưa có** cột FK sang `orders` — liên kết lead→đơn khi `converted` sẽ do migration GĐ4 quyết định (xem "Ghi nhận thực tại GĐ2").

## 3. `customers` — khách hàng

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| tên | — | |
| SĐT | validate định dạng | |
| email | validate định dạng | |
| công ty | — | Dành cho khách doanh nghiệp |
| địa chỉ | — | |
| loại | `personal` \| `business` | Phân nhóm cá nhân / doanh nghiệp |
| ghi chú | — | Ghi chú nội bộ của admin |

## 4. `orders` — đơn hàng

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| mã đơn | — | Mã tham chiếu đơn |
| FK customer | tham chiếu `customers`, **nullable** | Khách của đơn. Nullable vì convert từ lead không tự tạo customer — đơn convert lấy tên/SĐT từ lead, gắn customer là bước thủ công tùy chọn (chốt 2026-07-17, spec §1) |
| trạng thái | `new` → `confirmed` → `delivering` → `done` \| `cancelled` | Vòng đời đơn |
| kênh | `website` \| `phone` \| `zalo` \| `fb` | Nguồn đơn |
| tổng tiền | số dương | |
| giảm giá | số dương | |
| ngày giao | — | |
| địa chỉ giao | — | |
| ghi chú | — | |

Ràng buộc nghiệp vụ: order tạo cùng `order_items` trong 1 transaction (spec §3).

## 5. `order_items` — dòng hàng của đơn

| Thuộc tính | Ràng buộc/giá trị | Ý nghĩa nghiệp vụ |
|---|---|---|
| FK order | tham chiếu `orders` | |
| FK product | tham chiếu `products` | |
| tên (snapshot) | chụp tại thời điểm đặt | Bất biến sau khi tạo — đổi tên sản phẩm không ảnh hưởng đơn cũ |
| đơn giá (snapshot) | chụp tại thời điểm đặt; số dương | Bất biến sau khi tạo — đổi giá sản phẩm không ảnh hưởng đơn cũ |
| số lượng | số dương | |

## 6. `admin_users` — tài khoản quản trị

> ✅ **Đã khớp migration `0001_init.up.sql`** (GĐ1, task 4). Cột/kiểu/ràng buộc dưới đây lấy trực tiếp từ migration thật, không còn là suy diễn từ spec.

| Cột | Kiểu | Ràng buộc | Ý nghĩa nghiệp vụ |
|---|---|---|---|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Khóa chính; UUID sinh phía DB (Postgres 13+ có sẵn, không cần pgcrypto) |
| `email` | `text` | UNIQUE, NOT NULL | Định danh đăng nhập; duy nhất |
| `password_hash` | `text` | NOT NULL | Hash bcrypt (`$2a$…`) — không lưu plaintext |
| `name` | `text` | nullable | Tên hiển thị admin |
| `role` | `text` | NOT NULL, DEFAULT `'admin'` | Vai trò; hiện chỉ dùng `'admin'`, không có CHECK liệt kê giá trị (xem "Ghi nhận thực tại GĐ1") |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm tạo bản ghi |

Ràng buộc nghiệp vụ: không có đăng ký public — bản ghi tạo bằng CLI seed (`api/cmd/seed`, idempotent `ON CONFLICT`), spec §6.
