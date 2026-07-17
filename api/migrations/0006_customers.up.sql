-- 0006_customers.up.sql — bảng customers (REQ-CUST-001). Khách hàng quản lý trong
-- admin: cá nhân hoặc doanh nghiệp. Không lưu số lượng đơn ở đây — quan hệ với đơn
-- hàng qua orders.customer_id (nullable). gen_random_uuid() có sẵn Postgres 16.
CREATE TABLE customers (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text        NOT NULL,
    phone      text,
    email      text,
    company    text,
    address    text,
    type       text        NOT NULL DEFAULT 'personal' CHECK (type IN ('personal', 'business')),
    note       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
