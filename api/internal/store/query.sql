-- name: CreateAdminUser :one
INSERT INTO admin_users (email, password_hash, name, role)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, name, role, created_at;

-- name: GetAdminUserByEmail :one
SELECT id, email, password_hash, name, role, created_at
FROM admin_users
WHERE email = $1;

-- name: GetAdminUserByID :one
-- Lấy admin theo id (dùng cho GET /admin/me sau khi middleware xác thực JWT).
SELECT id, email, password_hash, name, role, created_at
FROM admin_users
WHERE id = $1;

-- name: ListVisibleProducts :many
-- Sản phẩm public: ẩn status='hidden', sắp theo thứ tự hiển thị rồi thời gian tạo
-- (REQ-PROD-001).
SELECT id, slug, name, description, price, type, status, image_url, display_order, created_at, updated_at, badge, compare_at_price, subtitle
FROM products
WHERE status != 'hidden'
ORDER BY display_order, created_at, id;

-- name: ListAllProducts :many
-- Sản phẩm cho admin: GỒM cả status='hidden'. Thứ tự TẤT ĐỊNH (display_order,
-- created_at, id) để list ổn định giữa các lần gọi (REQ-PROD-002).
SELECT id, slug, name, description, price, type, status, image_url, display_order, created_at, updated_at, badge, compare_at_price, subtitle
FROM products
ORDER BY display_order, created_at, id;

-- name: GetProductByID :one
SELECT id, slug, name, description, price, type, status, image_url, display_order, created_at, updated_at, badge, compare_at_price, subtitle
FROM products
WHERE id = $1;

-- name: CreateProduct :one
-- Tạo sản phẩm (REQ-PROD-002). Validate (name/price/type/status/slug) ở tầng
-- handler; ràng buộc CHECK + UNIQUE(slug) ở DB là lớp phòng thủ cuối.
INSERT INTO products (slug, name, description, price, type, status, image_url, display_order, badge, compare_at_price, subtitle)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, slug, name, description, price, type, status, image_url, display_order, created_at, updated_at, badge, compare_at_price, subtitle;

-- name: UpdateProduct :one
-- Cập nhật toàn bộ thuộc tính sản phẩm theo id (REQ-PROD-002).
UPDATE products
SET slug = $2, name = $3, description = $4, price = $5, type = $6, status = $7,
    image_url = $8, display_order = $9, badge = $10, compare_at_price = $11,
    subtitle = $12, updated_at = now()
WHERE id = $1
RETURNING id, slug, name, description, price, type, status, image_url, display_order, created_at, updated_at, badge, compare_at_price, subtitle;

-- name: DeleteProduct :exec
-- Xóa MỀM: đặt status='hidden'. An toàn hơn xóa cứng vì order_items tham chiếu
-- product_id (giữ toàn vẹn lịch sử đơn hàng) (REQ-PROD-002).
UPDATE products
SET status = 'hidden', updated_at = now()
WHERE id = $1;

-- name: UpdateProductImage :exec
-- Cập nhật ảnh sản phẩm sau khi upload thành công (REQ-PROD-003).
UPDATE products
SET image_url = $2, updated_at = now()
WHERE id = $1;

-- name: CreateLead :one
-- Tạo lead mới từ form liên hệ public. source mặc định 'website', status mặc định
-- 'new' (REQ-LEAD-002/003). Trả id + status để handler xác nhận.
INSERT INTO leads (name, phone, message, product_interest)
VALUES ($1, $2, $3, $4)
RETURNING id, status;

-- =====================================================================
-- Customers (REQ-CUST-001)
-- =====================================================================

-- name: CreateCustomer :one
INSERT INTO customers (name, phone, email, company, address, type, note)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, name, phone, email, company, address, type, note, created_at, updated_at;

-- name: GetCustomer :one
SELECT id, name, phone, email, company, address, type, note, created_at, updated_at
FROM customers
WHERE id = $1;

-- name: ListCustomers :many
-- Danh sách khách hàng cho admin, phân trang (mới nhất trước).
SELECT id, name, phone, email, company, address, type, note, created_at, updated_at
FROM customers
ORDER BY created_at DESC, id
LIMIT $1 OFFSET $2;

-- name: CountCustomers :one
SELECT count(*) FROM customers;

-- name: UpdateCustomer :one
UPDATE customers
SET name = $2, phone = $3, email = $4, company = $5, address = $6, type = $7, note = $8, updated_at = now()
WHERE id = $1
RETURNING id, name, phone, email, company, address, type, note, created_at, updated_at;

-- =====================================================================
-- Orders + order_items (REQ-ORD-001/003/004)
-- =====================================================================

-- name: CreateOrder :one
INSERT INTO orders (code, customer_id, channel, status, subtotal, discount, total, delivery_date, delivery_address, note)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, code, customer_id, channel, status, subtotal, discount, total, delivery_date, delivery_address, note, created_at, updated_at;

-- name: GetOrder :one
SELECT id, code, customer_id, channel, status, subtotal, discount, total, delivery_date, delivery_address, note, created_at, updated_at
FROM orders
WHERE id = $1;

-- name: ListOrders :many
-- Danh sách đơn hàng cho admin, phân trang (mới nhất trước).
SELECT id, code, customer_id, channel, status, subtotal, discount, total, delivery_date, delivery_address, note, created_at, updated_at
FROM orders
ORDER BY created_at DESC, id
LIMIT $1 OFFSET $2;

-- name: CountOrders :one
SELECT count(*) FROM orders;

-- name: UpdateOrderStatus :one
UPDATE orders
SET status = $2, updated_at = now()
WHERE id = $1
RETURNING id, code, customer_id, channel, status, subtotal, discount, total, delivery_date, delivery_address, note, created_at, updated_at;

-- name: CreateOrderItem :one
-- Dòng đơn với snapshot product_name + unit_price (REQ-ORD-004).
INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, order_id, product_id, product_name, unit_price, quantity, created_at;

-- name: ListOrderItemsByOrder :many
SELECT id, order_id, product_id, product_name, unit_price, quantity, created_at
FROM order_items
WHERE order_id = $1
ORDER BY created_at, id;

-- =====================================================================
-- Leads admin (REQ-LEAD-004/005)
-- =====================================================================

-- name: ListLeadsAdmin :many
-- Danh sách lead cho admin, phân trang (mới nhất trước).
SELECT id, name, phone, message, product_interest, source, status, created_at, order_id
FROM leads
ORDER BY created_at DESC, id
LIMIT $1 OFFSET $2;

-- name: CountLeads :one
SELECT count(*) FROM leads;

-- name: GetLead :one
-- Lấy 1 lead theo id (dùng cho convert lead → đơn: cần tên/SĐT/lời nhắn/nguồn/
-- trạng thái để dựng đơn nháp và chặn convert 2 lần) (REQ-LEAD-005).
SELECT id, name, phone, message, product_interest, source, status, created_at, order_id
FROM leads
WHERE id = $1;

-- name: UpdateLeadStatus :one
UPDATE leads
SET status = $2
WHERE id = $1
RETURNING id, name, phone, message, product_interest, source, status, created_at, order_id;

-- name: LockLead :one
-- Khóa dòng lead (FOR UPDATE) ở đầu transaction convert để request convert song
-- song cùng lead phải xếp hàng: request thứ 2 block tới khi request 1 commit rồi
-- mới đọc được order_id đã set → guard WHERE order_id IS NULL loại nó (REQ-LEAD-005).
SELECT id, name, phone, message, product_interest, source, status, created_at, order_id
FROM leads
WHERE id = $1
FOR UPDATE;

-- name: SetLeadOrder :execrows
-- Convert lead → đơn: gắn order_id + đánh dấu 'converted' CHỈ khi lead chưa convert
-- (order_id IS NULL). Guard nằm trong điều kiện WHERE (atomic trong tx) — chống race
-- convert-2-lần tạo đơn mồ côi. Trả số dòng ảnh hưởng: 0 = đã convert trước đó
-- (REQ-LEAD-005).
UPDATE leads
SET status = 'converted', order_id = $2
WHERE id = $1 AND order_id IS NULL;

-- =====================================================================
-- Dashboard (REQ-DASH-001)
-- =====================================================================

-- name: CountNewLeads :one
SELECT count(*) FROM leads WHERE status = 'new';

-- name: CountProcessingOrders :one
SELECT count(*) FROM orders WHERE status IN ('confirmed', 'delivering');

-- name: SumRevenueThisMonth :one
-- Doanh thu tháng hiện tại = tổng total các đơn đã 'done' tạo trong tháng, tính theo
-- MÚI GIỜ VIỆT NAM (Asia/Ho_Chi_Minh). date_trunc trần chạy theo TZ server (UTC) →
-- đơn done đặt sát nửa đêm đầu/cuối tháng giờ VN bị tính nhầm tháng. Đổi now() sang
-- giờ VN, cắt về đầu tháng, rồi đổi ngược về timestamptz để so với created_at.
SELECT coalesce(sum(total), 0)::bigint
FROM orders
WHERE status = 'done'
  AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                     AT TIME ZONE 'Asia/Ho_Chi_Minh';
