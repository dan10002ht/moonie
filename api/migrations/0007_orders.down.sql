-- 0007_orders.down.sql — rollback theo thứ tự ngược: bỏ leads.order_id trước (FK →
-- orders), rồi order_items, rồi orders.
ALTER TABLE leads DROP COLUMN IF EXISTS order_id;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
