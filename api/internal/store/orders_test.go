// Integration test cho customers + orders + order_items trên Postgres THẬT
// (testcontainers, pipeline test mục 3 — không mock DB). Kiểm:
//   - round-trip customer (Create → Get),
//   - tạo order + 2 order_items TRONG transaction (order + items atomic, REQ-ORD-003),
//   - snapshot product_name + unit_price giữ nguyên dù đổi giá sản phẩm (REQ-ORD-004),
//   - ListOrders phân trang + CountOrders đúng,
//   - SumRevenueThisMonth chỉ tính đơn 'done' trong tháng.
package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/moonie/api/internal/store"
)

func strptr(s string) *string { return &s }

func TestCustomerRoundTrip(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	tests := []struct {
		name string
		arg  store.CreateCustomerParams
	}{
		{
			name: "khách cá nhân",
			arg: store.CreateCustomerParams{
				Name: "Nguyễn Văn A",
				Type: "personal",
			},
		},
		{
			name: "khách doanh nghiệp đủ trường",
			arg: store.CreateCustomerParams{
				Name:    "Công ty Bánh Ngọt",
				Phone:   strptr("0900000000"),
				Email:   strptr("kh@congty.test"),
				Company: strptr("Bánh Ngọt JSC"),
				Address: strptr("12 Lê Lợi, Q1"),
				Type:    "business",
				Note:    strptr("khách VIP"),
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			created, err := q.CreateCustomer(ctx, tc.arg)
			if err != nil {
				t.Fatalf("CreateCustomer: %v", err)
			}
			if !created.ID.Valid {
				t.Fatal("created ID không hợp lệ (mong đợi uuid sinh tự động)")
			}
			if created.Name != tc.arg.Name || created.Type != tc.arg.Type {
				t.Errorf("created = %+v, mong đợi name=%q type=%q", created, tc.arg.Name, tc.arg.Type)
			}

			got, err := q.GetCustomer(ctx, created.ID)
			if err != nil {
				t.Fatalf("GetCustomer: %v", err)
			}
			if got.ID != created.ID {
				t.Errorf("got ID = %v, want %v", got.ID, created.ID)
			}
			if got.Name != tc.arg.Name {
				t.Errorf("got name = %q, want %q", got.Name, tc.arg.Name)
			}
		})
	}
}

func TestOrderTransactionSnapshot(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	// Seed 1 sản phẩm với giá ban đầu — snapshot phải giữ giá cũ sau khi đổi.
	var productID pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO products (slug, name, price, type, status)
		 VALUES ('banh-thap-cam', 'Bánh thập cẩm', 200000, 'single_cake', 'available')
		 RETURNING id`).Scan(&productID); err != nil {
		t.Fatalf("seed product: %v", err)
	}

	cust, err := q.CreateCustomer(ctx, store.CreateCustomerParams{Name: "Khách đặt đơn", Type: "personal"})
	if err != nil {
		t.Fatalf("CreateCustomer: %v", err)
	}

	// 2 dòng đơn, snapshot giá tại thời điểm tạo.
	items := []store.CreateOrderItemParams{
		{ProductID: productID, ProductName: "Bánh thập cẩm", UnitPrice: 200000, Quantity: 2},
		{ProductID: pgtype.UUID{}, ProductName: "Bánh tùy chỉnh (không có product)", UnitPrice: 150000, Quantity: 1},
	}
	var subtotal int64
	for _, it := range items {
		subtotal += it.UnitPrice * int64(it.Quantity)
	}
	discount := int64(50000)
	total := subtotal - discount

	// Tạo order + items TRONG transaction (atomic, REQ-ORD-003).
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	qtx := q.WithTx(tx)
	order, err := qtx.CreateOrder(ctx, store.CreateOrderParams{
		Code:       "MC-20260717-0001",
		CustomerID: cust.ID,
		Channel:    "phone",
		Status:     "new",
		Subtotal:   subtotal,
		Discount:   discount,
		Total:      total,
	})
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("CreateOrder: %v", err)
	}
	for i := range items {
		items[i].OrderID = order.ID
		if _, err := qtx.CreateOrderItem(ctx, items[i]); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("CreateOrderItem %d: %v", i, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit tx: %v", err)
	}

	if order.Total != total {
		t.Errorf("order.Total = %d, want %d", order.Total, total)
	}

	// Đổi giá sản phẩm sau khi tạo đơn — snapshot phải KHÔNG đổi (REQ-ORD-004).
	if _, err := pool.Exec(ctx, `UPDATE products SET price = 999000 WHERE id = $1`, productID); err != nil {
		t.Fatalf("update product price: %v", err)
	}

	got, err := q.ListOrderItemsByOrder(ctx, order.ID)
	if err != nil {
		t.Fatalf("ListOrderItemsByOrder: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("số order_items = %d, mong đợi 2", len(got))
	}

	// Hai dòng insert trong cùng transaction có created_at bằng nhau (now() = thời
	// điểm bắt đầu tx), nên thứ tự trả về không xác định — tra cứu theo có/không
	// gắn product thay vì giả định index.
	var withProduct, without *store.OrderItem
	for i := range got {
		if got[i].ProductID.Valid {
			withProduct = &got[i]
		} else {
			without = &got[i]
		}
	}
	if withProduct == nil || without == nil {
		t.Fatalf("mong đợi 1 dòng có product + 1 dòng không, có %+v", got)
	}
	if withProduct.UnitPrice != 200000 {
		t.Errorf("snapshot unit_price = %d, mong đợi giữ 200000 (không theo giá mới)", withProduct.UnitPrice)
	}
	if withProduct.ProductName != "Bánh thập cẩm" {
		t.Errorf("snapshot product_name = %q, mong đợi %q", withProduct.ProductName, "Bánh thập cẩm")
	}
	if without.ProductName != "Bánh tùy chỉnh (không có product)" {
		t.Errorf("dòng không gắn product có product_name = %q, mong đợi %q", without.ProductName, "Bánh tùy chỉnh (không có product)")
	}
}

func TestListOrdersPaginationAndRevenue(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	// 3 đơn: 2 'done' (tính doanh thu), 1 'new'.
	seed := []struct {
		code   string
		status string
		total  int64
	}{
		{"MC-20260717-0001", "done", 300000},
		{"MC-20260717-0002", "new", 500000},
		{"MC-20260717-0003", "done", 200000},
	}
	for _, s := range seed {
		if _, err := q.CreateOrder(ctx, store.CreateOrderParams{
			Code:     s.code,
			Channel:  "website",
			Status:   s.status,
			Subtotal: s.total,
			Total:    s.total,
		}); err != nil {
			t.Fatalf("CreateOrder %s: %v", s.code, err)
		}
	}

	count, err := q.CountOrders(ctx)
	if err != nil {
		t.Fatalf("CountOrders: %v", err)
	}
	if count != 3 {
		t.Errorf("CountOrders = %d, mong đợi 3", count)
	}

	// Phân trang: limit 2 → trả 2 đơn mới nhất trước.
	page1, err := q.ListOrders(ctx, store.ListOrdersParams{Limit: 2, Offset: 0})
	if err != nil {
		t.Fatalf("ListOrders page1: %v", err)
	}
	if len(page1) != 2 {
		t.Fatalf("page1 len = %d, mong đợi 2", len(page1))
	}
	page2, err := q.ListOrders(ctx, store.ListOrdersParams{Limit: 2, Offset: 2})
	if err != nil {
		t.Fatalf("ListOrders page2: %v", err)
	}
	if len(page2) != 1 {
		t.Fatalf("page2 len = %d, mong đợi 1", len(page2))
	}

	// Doanh thu tháng này = tổng total đơn 'done' = 300000 + 200000.
	revenue, err := q.SumRevenueThisMonth(ctx)
	if err != nil {
		t.Fatalf("SumRevenueThisMonth: %v", err)
	}
	if revenue != 500000 {
		t.Errorf("SumRevenueThisMonth = %d, mong đợi 500000 (chỉ đơn done)", revenue)
	}

	// Đơn 'confirmed'/'delivering' được đếm là đang xử lý.
	if _, err := q.CreateOrder(ctx, store.CreateOrderParams{Code: "MC-20260717-0004", Channel: "website", Status: "confirmed", Total: 1}); err != nil {
		t.Fatalf("CreateOrder confirmed: %v", err)
	}
	processing, err := q.CountProcessingOrders(ctx)
	if err != nil {
		t.Fatalf("CountProcessingOrders: %v", err)
	}
	if processing != 1 {
		t.Errorf("CountProcessingOrders = %d, mong đợi 1", processing)
	}
}

// TestSumRevenueThisMonthTimezone bắt bug timezone: doanh thu tháng phải tính theo
// giờ VN (Asia/Ho_Chi_Minh, UTC+7), không theo UTC. Mốc đầu tháng VN sớm hơn mốc
// UTC 7 tiếng — đơn done đặt sát nửa đêm đầu tháng giờ VN rơi vào khe đó. Query cũ
// dùng date_trunc theo UTC sẽ LOẠI nhầm đơn này → test fail; query đã sửa (đổi sang
// giờ VN) tính đúng → test pass. created_at seed tương đối theo mốc tháng VN nên test
// ổn định bất kể chạy ngày nào.
func TestSumRevenueThisMonthTimezone(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	seed := []struct {
		code    string
		status  string
		total   int64
		offset  string // interval cộng vào mốc đầu tháng giờ VN
		counted bool
	}{
		// done, 00:30 sáng 01/MM giờ VN → thuộc tháng VN hiện tại. Tương ứng 17:30 UTC
		// ngày cuối tháng trước → query UTC (sai) loại nhầm; query VN (đúng) tính.
		{"MC-TZ-0001", "done", 300000, "30 minutes", true},
		// done, 23:30 ngày cuối tháng TRƯỚC giờ VN → KHÔNG thuộc tháng này.
		{"MC-TZ-0002", "done", 700000, "-30 minutes", false},
		// done giữa tháng → luôn tính.
		{"MC-TZ-0003", "done", 100000, "10 days", true},
		// new giữa tháng → không tính doanh thu dù trong tháng.
		{"MC-TZ-0004", "new", 999000, "5 days", false},
	}
	var want int64
	for _, s := range seed {
		_, err := pool.Exec(ctx,
			`INSERT INTO orders (code, channel, status, subtotal, total, created_at)
			 VALUES ($1, 'website', $2, $3, $3,
			   date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' + ($4)::interval)`,
			s.code, s.status, s.total, s.offset)
		if err != nil {
			t.Fatalf("seed %s: %v", s.code, err)
		}
		if s.counted {
			want += s.total
		}
	}

	got, err := q.SumRevenueThisMonth(ctx)
	if err != nil {
		t.Fatalf("SumRevenueThisMonth: %v", err)
	}
	if got != want {
		t.Errorf("SumRevenueThisMonth = %d, mong đợi %d (chỉ đơn done trong tháng giờ VN — bắt bug timezone)", got, want)
	}
}
