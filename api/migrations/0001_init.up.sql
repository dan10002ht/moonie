-- 0001_init.up.sql — bảng admin_users tối thiểu để dựng đường ống DB (NFR-004).
-- gen_random_uuid() có sẵn trong Postgres 13+ (Mooni dùng Postgres 16) nên không
-- cần extension pgcrypto.
CREATE TABLE admin_users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        UNIQUE NOT NULL,
    password_hash text        NOT NULL,
    name          text,
    role          text        NOT NULL DEFAULT 'admin',
    created_at    timestamptz NOT NULL DEFAULT now()
);
