-- name: CreateAdminUser :one
INSERT INTO admin_users (email, password_hash, name, role)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, name, role, created_at;

-- name: GetAdminUserByEmail :one
SELECT id, email, password_hash, name, role, created_at
FROM admin_users
WHERE email = $1;
