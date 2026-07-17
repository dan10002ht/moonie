-- 0003_leads.up.sql — bảng leads (REQ-LEAD-001/002/003). Lưu form liên hệ public:
-- tên, SĐT, lời nhắn, sản phẩm quan tâm, nguồn, trạng thái vòng đời. Không lưu số
-- lượng/giá — lead chỉ là yêu cầu liên hệ. Vòng đời: new → contacted → converted|closed.
-- gen_random_uuid() có sẵn Postgres 16.
CREATE TABLE leads (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text        NOT NULL,
    phone            text        NOT NULL,
    message          text,
    product_interest text,
    source           text        NOT NULL DEFAULT 'website',
    status           text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
    created_at       timestamptz NOT NULL DEFAULT now()
);
