-- 0005_product_compare_subtitle.up.sql — thêm 2 cột nullable vào products để card
-- landing khớp mockup (design/mooni-landing.html):
--   compare_at_price: giá gốc kiểu "compare at price" (Shopify). Nếu > price thì
--     landing hiện giá gạch + % giảm. NULL = không có khuyến mãi.
--   subtitle: nhãn phân loại nhỏ IN HOA phía trên tên (vd "Hộp thiếc cao cấp",
--     "Bánh nướng · 180g"). NULL = không hiện.
ALTER TABLE products ADD COLUMN compare_at_price bigint;
ALTER TABLE products ADD COLUMN subtitle text;
