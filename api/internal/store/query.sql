-- name: CreateAdminUser :one
INSERT INTO admin_users (email, password_hash, name, role)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, name, role, created_at;

-- name: GetAdminUserByEmail :one
SELECT id, email, password_hash, name, role, created_at
FROM admin_users
WHERE email = $1;

-- name: ListVisibleProducts :many
-- Sản phẩm public: ẩn status='hidden', sắp theo thứ tự hiển thị rồi thời gian tạo
-- (REQ-PROD-001).
SELECT id, slug, name, description, price, type, status, image_url, display_order, created_at, updated_at
FROM products
WHERE status != 'hidden'
ORDER BY display_order, created_at, id;

-- name: CreateLead :one
-- Tạo lead mới từ form liên hệ public. source mặc định 'website', status mặc định
-- 'new' (REQ-LEAD-002/003). Trả id + status để handler xác nhận.
INSERT INTO leads (name, phone, message, product_interest)
VALUES ($1, $2, $3, $4)
RETURNING id, status;
