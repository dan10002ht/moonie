package store

// Hand-written (KHÔNG sinh bởi sqlc): logic transaction tạo đơn nhập tay + các dòng
// đơn (REQ-ORD-003). Với mỗi dòng lấy sản phẩm hiện tại để SNAPSHOT tên + đơn giá
// (REQ-ORD-004) — đổi giá sản phẩm sau KHÔNG ảnh hưởng đơn cũ. Tất cả (order + mọi
// order_items) atomic: 1 product_id sai → rollback toàn bộ, không tạo đơn một phần.
// Đặt trong package store để integration test (store_test) chạy trực tiếp trên
// Postgres thật.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrProductNotFound báo một product_id trong đơn không tồn tại. Handler map → 400
// (rollback toàn bộ, không tạo đơn một phần).
var ErrProductNotFound = errors.New("sản phẩm không tồn tại")

// ErrEmptyItems báo đơn không có dòng nào. Handler map → 400.
var ErrEmptyItems = errors.New("đơn phải có ít nhất 1 dòng")

// ErrInvalidQuantity báo một dòng có số lượng ≤ 0. Handler map → 400.
var ErrInvalidQuantity = errors.New("số lượng phải lớn hơn 0")

// ErrDiscountExceedsSubtotal báo giảm giá lớn hơn tổng tiền hàng (total sẽ âm).
// Handler map → 400.
var ErrDiscountExceedsSubtotal = errors.New("giảm giá vượt quá tổng tiền hàng")

// ErrOrderAmountTooLarge báo tổng tiền hàng vượt trần cho phép — chặn TRÀN int64
// (bigint) khi giá × số lượng dồn lại quá lớn, tránh subtotal/total sai hoặc âm.
// Handler map → 400.
var ErrOrderAmountTooLarge = errors.New("giá trị đơn hàng quá lớn")

// MaxOrderAmount là trần tổng tiền hàng một đơn (VND). 10 tỷ VND đủ rộng cho mọi
// đơn bánh trung thu thực tế nhưng cách xa MaxInt64 → mọi phép cộng dồn subtotal
// không thể tràn. Vượt trần → ErrOrderAmountTooLarge.
const MaxOrderAmount int64 = 10_000_000_000

// OrderItemInput là một dòng đơn admin gửi lên: sản phẩm + số lượng. Giá KHÔNG lấy
// từ client — snapshot từ product tại thời điểm tạo (REQ-ORD-004).
type OrderItemInput struct {
	ProductID pgtype.UUID
	Quantity  int32
}

// CreateOrderWithItemsParams gom tham số tạo đơn nhập tay. Subtotal/Total tính TRONG
// transaction từ giá sản phẩm snapshot — client không truyền tiền. Code do handler
// sinh (MC-YYYYMMDD-xxxx) và retry khi trùng.
type CreateOrderWithItemsParams struct {
	Code            string
	CustomerID      pgtype.UUID
	Channel         string
	Discount        int64
	DeliveryDate    pgtype.Date
	DeliveryAddress *string
	Note            *string
	Items           []OrderItemInput
}

// OrderWithItems gói đơn vừa tạo cùng các dòng đơn (đã snapshot).
type OrderWithItems struct {
	Order Order
	Items []OrderItem
}

// CreateOrderWithItems tạo order + tất cả order_items trong MỘT transaction
// (REQ-ORD-003). Mỗi dòng: lấy product theo id để snapshot product_name + unit_price
// (giá HIỆN TẠI của product) (REQ-ORD-004). product_id không tồn tại → ErrProductNotFound
// → rollback toàn bộ (không đơn một phần). subtotal = Σ(unit_price×quantity),
// total = subtotal − discount; discount > subtotal → ErrDiscountExceedsSubtotal.
// Unique violation trên code nổi lên nguyên trạng để handler retry.
func CreateOrderWithItems(ctx context.Context, db Beginner, arg CreateOrderWithItemsParams) (OrderWithItems, error) {
	if len(arg.Items) == 0 {
		return OrderWithItems{}, ErrEmptyItems
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return OrderWithItems{}, fmt.Errorf("create order: begin tx: %w", err)
	}
	// Rollback an toàn: no-op nếu đã Commit.
	defer func() { _ = tx.Rollback(ctx) }()

	q := New(tx)

	// snap giữ product_name + unit_price snapshot cho từng dòng, tính subtotal trước
	// khi ghi bất cứ gì (fail sớm nếu 1 product sai → rollback không tạo order).
	type snap struct {
		productID pgtype.UUID
		name      string
		unitPrice int64
		quantity  int32
	}
	snaps := make([]snap, 0, len(arg.Items))
	var subtotal int64
	for _, it := range arg.Items {
		if it.Quantity <= 0 {
			return OrderWithItems{}, ErrInvalidQuantity
		}
		p, err := q.GetProductByID(ctx, it.ProductID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return OrderWithItems{}, ErrProductNotFound
			}
			return OrderWithItems{}, fmt.Errorf("create order: get product: %w", err)
		}
		snaps = append(snaps, snap{productID: it.ProductID, name: p.Name, unitPrice: p.Price, quantity: it.Quantity})

		// Chặn TRÀN int64: kiểm trước khi nhân/cộng. Quantity đã được handler chặn
		// theo trần (>0, ≤ maxOrderItemQuantity) nên int64(it.Quantity) an toàn; ở đây
		// so sánh với MaxOrderAmount còn lại để một giá/số lượng lớn không kéo subtotal
		// tràn thành số âm (qua CHECK >= 0) hoặc sai lệch tiền.
		if p.Price < 0 {
			return OrderWithItems{}, ErrOrderAmountTooLarge
		}
		if it.Quantity > 0 && p.Price > MaxOrderAmount/int64(it.Quantity) {
			return OrderWithItems{}, ErrOrderAmountTooLarge
		}
		lineTotal := p.Price * int64(it.Quantity)
		if subtotal > MaxOrderAmount-lineTotal {
			return OrderWithItems{}, ErrOrderAmountTooLarge
		}
		subtotal += lineTotal
	}

	if arg.Discount < 0 {
		return OrderWithItems{}, ErrDiscountExceedsSubtotal
	}
	if arg.Discount > subtotal {
		return OrderWithItems{}, ErrDiscountExceedsSubtotal
	}
	total := subtotal - arg.Discount

	order, err := q.CreateOrder(ctx, CreateOrderParams{
		Code:            arg.Code,
		CustomerID:      arg.CustomerID,
		Channel:         arg.Channel,
		Status:          "new",
		Subtotal:        subtotal,
		Discount:        arg.Discount,
		Total:           total,
		DeliveryDate:    arg.DeliveryDate,
		DeliveryAddress: arg.DeliveryAddress,
		Note:            arg.Note,
	})
	if err != nil {
		return OrderWithItems{}, fmt.Errorf("create order: %w", err)
	}

	items := make([]OrderItem, 0, len(snaps))
	for _, s := range snaps {
		oi, err := q.CreateOrderItem(ctx, CreateOrderItemParams{
			OrderID:     order.ID,
			ProductID:   s.productID,
			ProductName: s.name,
			UnitPrice:   s.unitPrice,
			Quantity:    s.quantity,
		})
		if err != nil {
			return OrderWithItems{}, fmt.Errorf("create order item: %w", err)
		}
		items = append(items, oi)
	}

	if err := tx.Commit(ctx); err != nil {
		return OrderWithItems{}, fmt.Errorf("create order: commit: %w", err)
	}
	return OrderWithItems{Order: order, Items: items}, nil
}
