package store

// Hand-written (KHÔNG sinh bởi sqlc): logic transaction cho convert lead → đơn nháp
// (REQ-LEAD-005). Tạo order + đánh dấu lead 'converted' + gắn order_id PHẢI atomic —
// đặt trong package store để integration test (store_test) chạy trực tiếp trên
// Postgres thật.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrLeadAlreadyConverted báo lead đã được convert trước đó (order_id đã set). Handler
// map lỗi này → 409. Là guard THẬT chống race: xác định trong transaction bằng
// điều kiện WHERE order_id IS NULL, không phải check-then-act ngoài tx.
var ErrLeadAlreadyConverted = errors.New("lead đã được convert")

// ErrLeadNotFound báo lead không tồn tại (khóa dòng đầu tx không thấy). Handler → 404.
var ErrLeadNotFound = errors.New("lead không tồn tại")

// Beginner trừu tượng hóa pool.Begin để mở transaction. *pgxpool.Pool thỏa mãn.
type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// ConvertLeadParams gom tham số dựng đơn nháp từ lead. Code/Channel/Note do tầng
// handler tính (sinh mã đơn, map kênh từ source, gộp thông tin liên hệ lead).
type ConvertLeadParams struct {
	LeadID  pgtype.UUID
	Code    string
	Channel string
	Note    string
}

// ConvertLead tạo đơn NHÁP (status='new', tổng tiền 0, customer_id NULL) từ lead và
// đánh dấu lead 'converted' + gắn order_id, TẤT CẢ trong một transaction (REQ-LEAD-005).
// Rollback nếu bất kỳ bước nào lỗi. Trả về order vừa tạo.
func ConvertLead(ctx context.Context, db Beginner, arg ConvertLeadParams) (Order, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return Order{}, fmt.Errorf("convert lead: begin tx: %w", err)
	}
	// Rollback an toàn: no-op nếu đã Commit.
	defer func() { _ = tx.Rollback(ctx) }()

	q := New(tx)

	// Khóa dòng lead (FOR UPDATE) đầu tx: 2 request convert song song cùng lead phải
	// xếp hàng. Request thứ 2 block tới khi request 1 commit rồi mới đọc được order_id
	// đã set → SetLeadOrder guard loại nó (0 dòng) → rollback → chỉ 1 đơn tồn tại.
	if _, err := q.LockLead(ctx, arg.LeadID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrLeadNotFound
		}
		return Order{}, fmt.Errorf("convert lead: lock lead: %w", err)
	}

	note := arg.Note
	order, err := q.CreateOrder(ctx, CreateOrderParams{
		Code:     arg.Code,
		Channel:  arg.Channel,
		Status:   "new",
		Subtotal: 0,
		Discount: 0,
		Total:    0,
		Note:     &note,
	})
	if err != nil {
		return Order{}, fmt.Errorf("convert lead: create order: %w", err)
	}

	// Guard THẬT (atomic): chỉ set khi order_id IS NULL. 0 dòng ⇒ lead đã convert →
	// rollback tx (order vừa tạo cũng bị hủy → KHÔNG còn đơn mồ côi) → sentinel error.
	affected, err := q.SetLeadOrder(ctx, SetLeadOrderParams{ID: arg.LeadID, OrderID: order.ID})
	if err != nil {
		return Order{}, fmt.Errorf("convert lead: set lead order: %w", err)
	}
	if affected == 0 {
		// Rollback qua defer (không commit) → order vừa tạo bị hủy.
		return Order{}, ErrLeadAlreadyConverted
	}

	if err := tx.Commit(ctx); err != nil {
		return Order{}, fmt.Errorf("convert lead: commit: %w", err)
	}
	return order, nil
}
