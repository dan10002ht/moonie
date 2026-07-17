// Integration test cho convert lead → đơn nháp trên Postgres THẬT (testcontainers,
// pipeline test mục 3 — không mock DB). Kiểm REQ-LEAD-005:
//   - order nháp tạo (status='new', total 0, channel map, note gộp lead),
//   - lead.order_id gắn + status='converted' (atomic),
//   - customers count KHÔNG đổi (convert không tự tạo customer).
package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/moonie/api/internal/store"
)

func TestConvertLeadTransaction(t *testing.T) {
	pool := newTestDB(t)
	ctx := context.Background()

	// Seed 1 lead 'new'.
	var leadID pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO leads (name, phone, message, product_interest, source, status)
		 VALUES ('Trần Bình', '0987654321', 'đặt 2 hộp', 'hop-thap-cam', 'zalo', 'new')
		 RETURNING id`).Scan(&leadID); err != nil {
		t.Fatalf("seed lead: %v", err)
	}

	// Đếm customers TRƯỚC để chứng minh convert không tự tạo customer.
	var custBefore int64
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customers`).Scan(&custBefore); err != nil {
		t.Fatalf("count customers before: %v", err)
	}

	order, err := store.ConvertLead(ctx, pool, store.ConvertLeadParams{
		LeadID:  leadID,
		Code:    "MC-20260717-TST1",
		Channel: "zalo",
		Note:    "Từ lead: Trần Bình · SĐT: 0987654321 · Quan tâm: hop-thap-cam · đặt 2 hộp",
	})
	if err != nil {
		t.Fatalf("ConvertLead: %v", err)
	}

	// Order nháp đúng: status 'new', tổng tiền 0, channel + note giữ nguyên, customer NULL.
	if order.Status != "new" {
		t.Errorf("order.Status = %q, want new", order.Status)
	}
	if order.Total != 0 || order.Subtotal != 0 || order.Discount != 0 {
		t.Errorf("order tiền = (sub=%d disc=%d total=%d), want 0/0/0", order.Subtotal, order.Discount, order.Total)
	}
	if order.Channel != "zalo" {
		t.Errorf("order.Channel = %q, want zalo", order.Channel)
	}
	if order.CustomerID.Valid {
		t.Error("order.customer_id phải NULL (convert không tạo/gắn customer)")
	}
	if order.Note == nil || *order.Note == "" {
		t.Error("order.note phải chứa thông tin lead")
	}

	// Lead đã 'converted' + order_id trỏ đúng order.
	got, err := store.New(pool).GetLead(ctx, leadID)
	if err != nil {
		t.Fatalf("GetLead: %v", err)
	}
	if got.Status != "converted" {
		t.Errorf("lead.status = %q, want converted", got.Status)
	}
	if !got.OrderID.Valid || got.OrderID != order.ID {
		t.Errorf("lead.order_id = %v, want %v", got.OrderID, order.ID)
	}

	// Customers count KHÔNG đổi.
	var custAfter int64
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM customers`).Scan(&custAfter); err != nil {
		t.Fatalf("count customers after: %v", err)
	}
	if custAfter != custBefore {
		t.Errorf("customers count = %d, want %d (convert KHÔNG tạo customer)", custAfter, custBefore)
	}
}
