# 04 — Data Dictionary — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `67435fb`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> ✅ **GĐ4 (Admin API) đã xong 7/7.** TẤT CẢ 6 bảng spec giờ đã có migration đối chiếu code thật — KHÔNG còn bảng nào "chờ migration". `0001_init` (`admin_users`, §6), `0002_products` + `0004_product_badge` + `0005_product_compare_subtitle` (`products`, §1), `0003_leads` (`leads`, §2), **`0006_customers` (`customers`, §3), `0007_orders` (`orders` §4 + `order_items` §5 + cột `leads.order_id`)**. Cột/kiểu/ràng buộc dưới đây lấy trực tiếp từ migration, không còn suy diễn từ spec.

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

> **Ghi nhận thực tại GĐ4** (không sửa yêu cầu, chỉ ghi để chủ dự án nắm):
> - **`orders.customer_id` nullable** (`REFERENCES customers(id)`, không NOT NULL): convert lead→đơn KHÔNG tự tạo customer — thông tin liên hệ của lead được giữ trong `orders.note`; gắn customer là bước thủ công tùy chọn (chốt 2026-07-17, spec §1). Không có ON DELETE trên FK này (mặc định NO ACTION).
> - **Tiền là `bigint` (VND số nguyên) ở cả `orders` và `order_items`** — không float/numeric. `orders` có CHECK `orders_amounts_non_negative` (`subtotal >= 0 AND discount >= 0 AND total >= 0`); `order_items.quantity` có CHECK `> 0`. Trần quantity/tiền/số item chống overflow int64 do handler cưỡng chế (go-reviewer Task 5), không phải ở DB.
> - **`order_items.product_id` nullable** (`REFERENCES products(id)`, không cascade): giữ được dòng đơn cả khi sản phẩm bị xóa. Ngược lại `order_items.order_id` là NOT NULL + `ON DELETE CASCADE` — xóa đơn thì xóa dòng đơn theo.
> - **Snapshot giá** (REQ-ORD-004): `order_items.product_name` + `unit_price` chụp tại thời điểm tạo đơn, đổi tên/giá sản phẩm sau không ảnh hưởng đơn cũ. Đã có test transaction/snapshot ở `orders_test.go`.
> - **`orders.status` cho nhảy bậc** (vd `confirmed → done` không qua `delivering`): CHECK chỉ liệt kê tập giá trị `new|confirmed|delivering|done|cancelled`, KHÔNG cưỡng chế thứ tự chuyển. Nhảy bậc là chủ đích nghiệp vụ (giao tận tay), do handler cho phép — không phải lỗ hổng.
> - **`leads.order_id` FK đã hiện diện** (`ALTER TABLE leads ADD COLUMN order_id uuid REFERENCES orders(id)`, migration `0007`): giải quyết dấu ⚠️ ghi ở GĐ2 — liên kết lead→đơn khi convert nằm ở cột FK trên `leads` (nullable), không phải tra ngược từ `orders`.
> - **`customers.phone` / `customers.email` KHÔNG unique** (chủ đích spec): một khách có thể có nhiều bản ghi; validate định dạng ở API boundary, không ràng buộc trùng ở DB.
> - **Doanh thu tháng neo giờ VN** (`Asia/Ho_Chi_Minh`): query dashboard `revenue_this_month` tính biên tháng theo múi giờ VN, không UTC (go-reviewer bắt bug lệch múi giờ Task 1, đã sửa + test).

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
| `order_id` | `uuid` | nullable, `REFERENCES orders(id)` (migration `0007`) | Đơn được tạo khi convert lead. NULL = chưa convert. Giải quyết dấu ⚠️ ghi ở GĐ2 |

## 3. `customers` — khách hàng

> ✅ **Đã khớp migration `0006_customers.up.sql`** (GĐ4, task 1). Cột/kiểu/ràng buộc lấy trực tiếp từ migration thật.

| Cột | Kiểu | Ràng buộc | Ý nghĩa nghiệp vụ |
|---|---|---|---|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Khóa chính |
| `name` | `text` | NOT NULL | Tên khách; validate độ dài tại API boundary |
| `phone` | `text` | nullable | SĐT; validate định dạng tại boundary; **KHÔNG unique** (một khách có thể nhiều bản ghi) |
| `email` | `text` | nullable | Email; validate định dạng tại boundary; **KHÔNG unique** |
| `company` | `text` | nullable | Tên công ty — dành cho khách doanh nghiệp |
| `address` | `text` | nullable | Địa chỉ |
| `type` | `text` | NOT NULL, DEFAULT `'personal'`, CHECK IN (`personal`, `business`) | Phân nhóm cá nhân / doanh nghiệp |
| `note` | `text` | nullable | Ghi chú nội bộ của admin |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm tạo |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm cập nhật |

> Không lưu số lượng đơn ở đây — quan hệ với đơn qua `orders.customer_id` (nullable).

## 4. `orders` — đơn hàng

> ✅ **Đã khớp migration `0007_orders.up.sql`** (GĐ4, task 1). Cột/kiểu/ràng buộc lấy trực tiếp từ migration thật.

| Cột | Kiểu | Ràng buộc | Ý nghĩa nghiệp vụ |
|---|---|---|---|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Khóa chính |
| `code` | `text` | UNIQUE, NOT NULL | Mã đơn sinh tự động (vd `MC-YYYYMMDD-xxxx`), duy nhất |
| `customer_id` | `uuid` | nullable, `REFERENCES customers(id)` | Khách của đơn. **Nullable** vì convert từ lead không tự tạo customer — contact giữ ở `note`, gắn customer là bước thủ công tùy chọn (chốt 2026-07-17, spec §1) |
| `channel` | `text` | NOT NULL, DEFAULT `'website'`, CHECK IN (`website`, `phone`, `zalo`, `fb`) | Nguồn đơn |
| `status` | `text` | NOT NULL, DEFAULT `'new'`, CHECK IN (`new`, `confirmed`, `delivering`, `done`, `cancelled`) | Vòng đời đơn. CHECK chỉ liệt kê tập giá trị, KHÔNG cưỡng chế thứ tự — cho phép nhảy bậc (giao tận tay) |
| `subtotal` | `bigint` | NOT NULL, DEFAULT `0` | Tổng tiền hàng VND (số nguyên); ≥ 0 (CHECK) |
| `discount` | `bigint` | NOT NULL, DEFAULT `0` | Giảm giá VND; ≥ 0 (CHECK) |
| `total` | `bigint` | NOT NULL, DEFAULT `0` | Thành tiền VND; ≥ 0 (CHECK) |
| `delivery_date` | `date` | nullable | Ngày giao |
| `delivery_address` | `text` | nullable | Địa chỉ giao |
| `note` | `text` | nullable | Ghi chú; convert lead lưu contact (tên/SĐT) vào đây |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm tạo |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm cập nhật |

> CHECK `orders_amounts_non_negative`: `subtotal >= 0 AND discount >= 0 AND total >= 0`. Order tạo cùng `order_items` trong 1 transaction (spec §3); tính `subtotal`/`total` do handler.

## 5. `order_items` — dòng hàng của đơn

> ✅ **Đã khớp migration `0007_orders.up.sql`** (GĐ4, task 1). Cột/kiểu/ràng buộc lấy trực tiếp từ migration thật.

| Cột | Kiểu | Ràng buộc | Ý nghĩa nghiệp vụ |
|---|---|---|---|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Khóa chính |
| `order_id` | `uuid` | NOT NULL, `REFERENCES orders(id)` **ON DELETE CASCADE** | Đơn chứa dòng này; xóa đơn thì xóa dòng theo |
| `product_id` | `uuid` | nullable, `REFERENCES products(id)` | Sản phẩm nguồn. **Nullable** để giữ dòng đơn cả khi sản phẩm bị xóa |
| `product_name` | `text` | NOT NULL | **Snapshot** tên tại thời điểm tạo — bất biến, đổi tên sản phẩm không ảnh hưởng đơn cũ (REQ-ORD-004) |
| `unit_price` | `bigint` | NOT NULL | **Snapshot** đơn giá VND tại thời điểm tạo — bất biến, đổi giá không ảnh hưởng đơn cũ (REQ-ORD-004) |
| `quantity` | `int` | NOT NULL, CHECK `> 0` | Số lượng; handler áp trần chống overflow int64 |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Thời điểm tạo |

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
