// Integration test cho convert lead → đơn nháp trên Postgres THẬT (testcontainers,
// pipeline test mục 3 — không mock DB). Kiểm REQ-LEAD-005:
//   - order nháp tạo (status='new', total 0, channel map, note gộp lead),
//   - lead.order_id gắn + status='converted' (atomic),
//   - customers count KHÔNG đổi (convert không tự tạo customer).
package store_test

import (
	"context"
	"errors"
	"sync"
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

// TestConvertLeadRaceOnlyOneOrder chứng minh guard atomic chống race convert-2-lần:
// 2 goroutine cùng convert 1 lead song song → CHỈ 1 đơn được tạo (không đơn mồ côi),
// đúng 1 lần thành công, lần còn lại trả ErrLeadAlreadyConverted. Test này FAIL với
// SetLeadOrder cũ (UPDATE không điều kiện → 2 order, lead trỏ 1, order kia mồ côi),
// PASS sau fix (WHERE order_id IS NULL + FOR UPDATE + rollback khi 0 dòng) (REQ-LEAD-005).
func TestConvertLeadRaceOnlyOneOrder(t *testing.T) {
	pool := newTestDB(t)
	ctx := context.Background()

	var leadID pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO leads (name, phone, source, status)
		 VALUES ('Race Test', '0900000099', 'website', 'new')
		 RETURNING id`).Scan(&leadID); err != nil {
		t.Fatalf("seed lead: %v", err)
	}

	var (
		wg          sync.WaitGroup
		mu          sync.Mutex
		successes   int
		conflicts   int
		otherErrs   []error
		successCode string
	)
	// 2 mã đơn KHÁC nhau để nếu cả 2 cùng tạo order (bug) thì không bị UNIQUE(code)
	// che giấu — số order còn lại mới là bằng chứng.
	codes := []string{"MC-20260717-RACE1", "MC-20260717-RACE2"}
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(code string) {
			defer wg.Done()
			<-start // đồng bộ để 2 goroutine chạy càng gần nhau càng tốt
			order, err := store.ConvertLead(ctx, pool, store.ConvertLeadParams{
				LeadID:  leadID,
				Code:    code,
				Channel: "website",
				Note:    "race",
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				successes++
				successCode = order.Code
			case errors.Is(err, store.ErrLeadAlreadyConverted):
				conflicts++
			default:
				otherErrs = append(otherErrs, err)
			}
		}(codes[i])
	}
	close(start)
	wg.Wait()

	if len(otherErrs) != 0 {
		t.Fatalf("lỗi ngoài dự kiến: %v", otherErrs)
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("successes=%d conflicts=%d, want 1 và 1", successes, conflicts)
	}

	// Bằng chứng KHÔNG có đơn mồ côi: đúng 1 order tồn tại và lead trỏ đúng nó.
	var orderCount int64
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orders`).Scan(&orderCount); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if orderCount != 1 {
		t.Errorf("orders count = %d, want 1 (không đơn mồ côi)", orderCount)
	}

	got, err := store.New(pool).GetLead(ctx, leadID)
	if err != nil {
		t.Fatalf("GetLead: %v", err)
	}
	if got.Status != "converted" || !got.OrderID.Valid {
		t.Errorf("lead sau race: status=%q order_id.valid=%v, want converted + gắn order", got.Status, got.OrderID.Valid)
	}
	var linkedCode string
	if err := pool.QueryRow(ctx, `SELECT code FROM orders WHERE id=$1`, got.OrderID).Scan(&linkedCode); err != nil {
		t.Fatalf("order lead trỏ tới không tồn tại (mồ côi ngược?): %v", err)
	}
	if linkedCode != successCode {
		t.Errorf("lead trỏ order %q, nhưng lần thành công tạo %q", linkedCode, successCode)
	}
}
