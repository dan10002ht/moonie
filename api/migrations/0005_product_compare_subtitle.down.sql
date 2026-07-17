-- 0005_product_compare_subtitle.down.sql — gỡ 2 cột compare_at_price + subtitle.
ALTER TABLE products DROP COLUMN subtitle;
ALTER TABLE products DROP COLUMN compare_at_price;
