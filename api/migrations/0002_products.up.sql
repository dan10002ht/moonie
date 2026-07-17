-- 0002_products.up.sql — bảng products (REQ-PROD-001). Tồn kho = trạng thái
-- (available|sold_out|hidden), không số lượng (SRS Quyết định). Giá VND là số
-- nguyên (bigint) — không dùng float cho tiền. gen_random_uuid() có sẵn Postgres 16.
CREATE TABLE products (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          text        UNIQUE NOT NULL,
    name          text        NOT NULL,
    description   text,
    price         bigint      NOT NULL,
    type          text        NOT NULL CHECK (type IN ('gift_box', 'single_cake')),
    status        text        NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold_out', 'hidden')),
    image_url     text,
    display_order int         NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
