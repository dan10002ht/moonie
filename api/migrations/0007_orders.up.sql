-- 0007_orders.up.sql — đơn hàng (REQ-ORD-001/003/004) + leads.order_id (REQ-LEAD-005).
--   orders: đầu đơn. code = mã đơn sinh tự động (vd MC-YYYYMMDD-xxxx), unique.
--     customer_id nullable (đơn có thể không gắn khách; convert từ lead KHÔNG tự tạo
--     customer). Tiền VND là số nguyên (bigint) — không dùng float.
--   order_items: dòng đơn, snapshot product_name + unit_price tại thời điểm tạo
--     (REQ-ORD-004) → đổi giá sản phẩm sau không ảnh hưởng đơn cũ. product_id nullable
--     (giữ được dòng dù sản phẩm bị xóa). on delete cascade theo order.
--   leads.order_id: FK nullable → orders, dùng khi convert lead thành đơn (REQ-LEAD-005).
-- gen_random_uuid() có sẵn Postgres 16.
CREATE TABLE orders (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    code             text        UNIQUE NOT NULL,
    customer_id      uuid        REFERENCES customers(id),
    channel          text        NOT NULL DEFAULT 'website' CHECK (channel IN ('website', 'phone', 'zalo', 'fb')),
    status           text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'delivering', 'done', 'cancelled')),
    subtotal         bigint      NOT NULL DEFAULT 0,
    discount         bigint      NOT NULL DEFAULT 0,
    total            bigint      NOT NULL DEFAULT 0,
    delivery_date    date,
    delivery_address text,
    note             text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_amounts_non_negative CHECK (subtotal >= 0 AND discount >= 0 AND total >= 0)
);

CREATE TABLE order_items (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id   uuid        REFERENCES products(id),
    product_name text        NOT NULL,
    unit_price   bigint      NOT NULL,
    quantity     int         NOT NULL CHECK (quantity > 0),
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE leads ADD COLUMN order_id uuid REFERENCES orders(id);
