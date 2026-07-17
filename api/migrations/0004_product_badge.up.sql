-- 0004_product_badge.up.sql — thêm cột badge (nhãn marketing như "Bán chạy" /
-- "Mới") vào products. Nullable: không phải sản phẩm nào cũng có badge. Khớp mockup
-- landing (design/mooni-landing.html) — section collection + flavors.
ALTER TABLE products ADD COLUMN badge text;
