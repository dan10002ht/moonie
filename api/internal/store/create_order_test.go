// Integration test cho store.CreateOrderWithItems trên Postgres THẬT (testcontainers,
// pipeline test mục 3 — không mock DB). Kiểm:
//   - tạo đơn 2 dòng → snapshot product_name + unit_price đúng, subtotal/total đúng,
//   - đổi giá sản phẩm SAU khi tạo → order_items giữ giá cũ (REQ-ORD-004),
//   - 1 product_id sai → rollback toàn bộ, CountOrders không đổi (REQ-ORD-003),
//   - discount > subtotal → lỗi, không tạo đơn.
package store_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/moonie/api/internal/store"
)

func TestCreateOrderWithItemsSnapshot(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	var p1, p2 pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO products (slug, name, price, type, status)
		 VALUES ('banh-thap-cam', 'Bánh thập cẩm', 200000, 'single_cake', 'available') RETURNING id`).Scan(&p1); err != nil {
		t.Fatalf("seed p1: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO products (slug, name, price, type, status)
		 VALUES ('banh-sen', 'Bánh hạt sen', 150000, 'single_cake', 'available') RETURNING id`).Scan(&p2); err != nil {
		t.Fatalf("seed p2: %v", err)
	}

	// subtotal = 200000*2 + 150000*1 = 550000; discount 50000 → total 500000.
	res, err := store.CreateOrderWithItems(ctx, pool, store.CreateOrderWithItemsParams{
		Code:     "MC-20260717-SNP1",
		Channel:  "phone",
		Discount: 50000,
		Items: []store.OrderItemInput{
			{ProductID: p1, Quantity: 2},
			{ProductID: p2, Quantity: 1},
		},
	})
	if err != nil {
		t.Fatalf("CreateOrderWithItems: %v", err)
	}
	if res.Order.Subtotal != 550000 {
		t.Errorf("subtotal = %d, want 550000", res.Order.Subtotal)
	}
	if res.Order.Total != 500000 {
		t.Errorf("total = %d, want 500000", res.Order.Total)
	}
	if res.Order.Status != "new" {
		t.Errorf("status = %q, want new", res.Order.Status)
	}
	if len(res.Items) != 2 {
		t.Fatalf("items len = %d, want 2", len(res.Items))
	}

	// Đổi giá sản phẩm sau khi tạo đơn — order_items phải giữ giá cũ (REQ-ORD-004).
	if _, err := pool.Exec(ctx, `UPDATE products SET price = 999000, name = 'Đổi tên' WHERE id = $1`, p1); err != nil {
		t.Fatalf("update product: %v", err)
	}
	got, err := q.ListOrderItemsByOrder(ctx, res.Order.ID)
	if err != nil {
		t.Fatalf("ListOrderItemsByOrder: %v", err)
	}
	var found *store.OrderItem
	for i := range got {
		if got[i].ProductID == p1 {
			found = &got[i]
		}
	}
	if found == nil {
		t.Fatal("không thấy dòng của p1")
	}
	if found.UnitPrice != 200000 {
		t.Errorf("snapshot unit_price = %d, want giữ 200000", found.UnitPrice)
	}
	if found.ProductName != "Bánh thập cẩm" {
		t.Errorf("snapshot product_name = %q, want Bánh thập cẩm", found.ProductName)
	}
}

func TestCreateOrderWithItemsRollbackOnBadProduct(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	var good pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO products (slug, name, price, type, status)
		 VALUES ('banh-ok', 'Bánh OK', 100000, 'single_cake', 'available') RETURNING id`).Scan(&good); err != nil {
		t.Fatalf("seed: %v", err)
	}

	before, err := q.CountOrders(ctx)
	if err != nil {
		t.Fatalf("CountOrders before: %v", err)
	}

	// Dòng 2 có product_id không tồn tại → ErrProductNotFound → rollback toàn bộ.
	bad := pgtype.UUID{Bytes: [16]byte{9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9}, Valid: true}
	_, err = store.CreateOrderWithItems(ctx, pool, store.CreateOrderWithItemsParams{
		Code:    "MC-20260717-BAD1",
		Channel: "website",
		Items: []store.OrderItemInput{
			{ProductID: good, Quantity: 1},
			{ProductID: bad, Quantity: 1},
		},
	})
	if !errors.Is(err, store.ErrProductNotFound) {
		t.Fatalf("err = %v, want ErrProductNotFound", err)
	}

	after, err := q.CountOrders(ctx)
	if err != nil {
		t.Fatalf("CountOrders after: %v", err)
	}
	if after != before {
		t.Errorf("CountOrders = %d, want %d (rollback, không tạo đơn một phần)", after, before)
	}
}

func TestCreateOrderWithItemsDiscountExceeds(t *testing.T) {
	pool := newTestDB(t)
	ctx := context.Background()

	var p pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO products (slug, name, price, type, status)
		 VALUES ('banh-x', 'Bánh X', 100000, 'single_cake', 'available') RETURNING id`).Scan(&p); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err := store.CreateOrderWithItems(ctx, pool, store.CreateOrderWithItemsParams{
		Code:     "MC-20260717-DSC1",
		Channel:  "website",
		Discount: 200000, // > subtotal 100000
		Items:    []store.OrderItemInput{{ProductID: p, Quantity: 1}},
	})
	if !errors.Is(err, store.ErrDiscountExceedsSubtotal) {
		t.Fatalf("err = %v, want ErrDiscountExceedsSubtotal", err)
	}
}

func TestCreateOrderWithItemsEmpty(t *testing.T) {
	pool := newTestDB(t)
	ctx := context.Background()
	_, err := store.CreateOrderWithItems(ctx, pool, store.CreateOrderWithItemsParams{
		Code:    "MC-20260717-EMP1",
		Channel: "website",
		Items:   nil,
	})
	if !errors.Is(err, store.ErrEmptyItems) {
		t.Fatalf("err = %v, want ErrEmptyItems", err)
	}
}
