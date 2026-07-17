package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/notify"
	"github.com/moonie/api/internal/store"
)

// Phân trang đơn hàng (REQ-ORD-001): mặc định 20, tối đa 100 (quy ước GĐ4). Vượt trần
// bị kẹp về 100 để một request không kéo cả bảng.
const (
	ordersDefaultLimit = 20
	ordersMaxLimit     = 100
)

// Trần chống lạm dụng số/tài chính (đơn hàng đụng tiền — phải chặt):
//   - maxOrderItems: số dòng tối đa mỗi đơn. Chặn body ~1000+ item, mỗi item 1
//     GetProductByID tuần tự trong tx mở (DoS).
//   - maxOrderItemQuantity: số lượng tối đa mỗi dòng. Validate TRƯỚC khi ép int32 —
//     client gửi quantity > MaxInt32 (Go int 64-bit) sẽ bị int32() cắt âm thầm thành
//     số nhỏ nếu không chặn ở đây → đơn sai số lượng.
const (
	maxOrderItems        = 100
	maxOrderItemQuantity = 10000
)

// pgForeignKeyViolation là mã lỗi Postgres cho vi phạm khóa ngoại (customer_id trỏ
// tới customer không tồn tại).
const pgForeignKeyViolation = "23503"

// validOrderStatuses khớp CHECK constraint orders.status (0007_orders). Validate ở
// handler để trả 400 thân thiện thay vì 500 từ DB (REQ-ORD-002).
var validOrderStatuses = map[string]bool{
	"new": true, "confirmed": true, "delivering": true, "done": true, "cancelled": true,
}

// terminalOrderStatuses là các trạng thái kết thúc: đơn đã 'done'/'cancelled' KHÔNG
// được đổi sang trạng thái khác nữa (REQ-ORD-002).
var terminalOrderStatuses = map[string]bool{
	"done": true, "cancelled": true,
}

// orderAdminStore là phần store handler đơn hàng cần (đọc/cập nhật, không tx). Tách
// qua interface để inject fake trong handler test (không cần Postgres).
type orderAdminStore interface {
	ListOrders(ctx context.Context, arg store.ListOrdersParams) ([]store.Order, error)
	CountOrders(ctx context.Context) (int64, error)
	GetOrder(ctx context.Context, id pgtype.UUID) (store.Order, error)
	ListOrderItemsByOrder(ctx context.Context, orderID pgtype.UUID) ([]store.OrderItem, error)
	UpdateOrderStatus(ctx context.Context, arg store.UpdateOrderStatusParams) (store.Order, error)
}

// orderCreator tạo đơn + order_items TRONG transaction. Tách qua interface để handler
// test bằng fake (transaction thật kiểm ở integration test).
type orderCreator interface {
	CreateOrderWithItems(ctx context.Context, arg store.CreateOrderWithItemsParams) (store.OrderWithItems, error)
}

// poolOrderCreator là orderCreator thật: chạy store.CreateOrderWithItems trên pool DB.
type poolOrderCreator struct{ pool store.Beginner }

func (c poolOrderCreator) CreateOrderWithItems(ctx context.Context, arg store.CreateOrderWithItemsParams) (store.OrderWithItems, error) {
	return store.CreateOrderWithItems(ctx, c.pool, arg)
}

// ListAdminOrders phục vụ GET /api/v1/admin/orders: đơn hàng phân trang, mới nhất
// trước, trả {items, total}. Cần auth (middleware gác) (REQ-ORD-001).
func (s *Server) ListAdminOrders(w http.ResponseWriter, r *http.Request, params api.ListAdminOrdersParams) {
	limit := ordersDefaultLimit
	if params.Limit != nil {
		limit = *params.Limit
	}
	if limit < 1 {
		limit = ordersDefaultLimit
	}
	if limit > ordersMaxLimit {
		limit = ordersMaxLimit
	}
	offset := 0
	if params.Offset != nil && *params.Offset > 0 {
		offset = *params.Offset
	}
	// offset PHẢI vừa int32 (kiểu tham số DB). >MaxInt32 sẽ tràn thành âm → Postgres
	// lỗi → 500. Chặn sớm ở boundary bằng 400 (NFR-004/006).
	if offset > math.MaxInt32 {
		httpx.WriteError(w, http.StatusBadRequest, "offset quá lớn")
		return
	}

	rows, err := s.orderAdmin.ListOrders(r.Context(), store.ListOrdersParams{
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		log.Printf("list admin orders: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách đơn hàng")
		return
	}
	total, err := s.orderAdmin.CountOrders(r.Context())
	if err != nil {
		log.Printf("count orders: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách đơn hàng")
		return
	}

	items := make([]api.Order, 0, len(rows))
	for _, row := range rows {
		items = append(items, toAPIOrder(row))
	}
	httpx.WriteJSON(w, http.StatusOK, api.OrderList{Items: items, Total: total})
}

// orderCreateMaxRetries giới hạn số lần sinh lại mã đơn khi trùng UNIQUE(code) — cực
// hiếm (4 ký tự ngẫu nhiên), nhưng retry vài lần để tạo đơn không fail vì đụng mã.
const orderCreateMaxRetries = 5

// CreateOrder phục vụ POST /api/v1/admin/orders: tạo đơn nhập tay + order_items trong
// transaction, snapshot giá, tính tiền, sinh mã. Sau commit bắn Telegram (fail-safe).
// Validate: channel enum, ≥ 1 dòng, quantity > 0, discount ≥ 0; product không tồn tại
// → 400 (rollback) (REQ-ORD-001/003/004, REQ-NOTI-002).
func (s *Server) CreateOrder(w http.ResponseWriter, r *http.Request) {
	var in api.OrderInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	if err := dec.Decode(&in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "dữ liệu gửi lên không hợp lệ")
		return
	}

	channel := strings.TrimSpace(string(in.Channel))
	if !validOrderChannels[channel] {
		httpx.WriteError(w, http.StatusBadRequest, "kênh không hợp lệ (website, phone, zalo hoặc fb)")
		return
	}
	if len(in.Items) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "đơn phải có ít nhất 1 sản phẩm")
		return
	}
	if len(in.Items) > maxOrderItems {
		httpx.WriteError(w, http.StatusBadRequest, "đơn có quá nhiều dòng (tối đa 100)")
		return
	}
	items := make([]store.OrderItemInput, 0, len(in.Items))
	for _, it := range in.Items {
		// Chặn TRƯỚC khi ép int32: quantity là Go int (64-bit). Không chặn trần thì
		// client gửi quantity > MaxInt32 (vd 2^32+5) qua check >0 nhưng int32() cắt
		// còn số nhỏ → đơn tạo SAI số lượng âm thầm (data corruption tiền).
		if it.Quantity <= 0 || it.Quantity > maxOrderItemQuantity {
			httpx.WriteError(w, http.StatusBadRequest, "số lượng mỗi dòng phải từ 1 đến 10000")
			return
		}
		items = append(items, store.OrderItemInput{
			ProductID: pgUUID(it.ProductId),
			Quantity:  int32(it.Quantity),
		})
	}

	var discount int64
	if in.Discount != nil {
		discount = *in.Discount
	}
	if discount < 0 {
		httpx.WriteError(w, http.StatusBadRequest, "giảm giá không được âm")
		return
	}

	var customerID pgtype.UUID
	if in.CustomerId != nil {
		customerID = pgUUID(*in.CustomerId)
	}

	arg := store.CreateOrderWithItemsParams{
		CustomerID:      customerID,
		Channel:         channel,
		Discount:        discount,
		DeliveryDate:    optDate(in.DeliveryDate),
		DeliveryAddress: in.DeliveryAddress,
		Note:            in.Note,
		Items:           items,
	}

	// Retry sinh mã đơn khi đụng UNIQUE(code). Mỗi lần gọi mở transaction mới —
	// unique violation làm abort tx nên phải chạy lại toàn bộ với mã khác.
	var result store.OrderWithItems
	for attempt := 0; ; attempt++ {
		arg.Code = generateOrderCode(time.Now())
		var err error
		result, err = s.orderCreate.CreateOrderWithItems(r.Context(), arg)
		if err == nil {
			break
		}
		switch {
		case errors.Is(err, store.ErrEmptyItems):
			httpx.WriteError(w, http.StatusBadRequest, "đơn phải có ít nhất 1 sản phẩm")
			return
		case errors.Is(err, store.ErrInvalidQuantity):
			httpx.WriteError(w, http.StatusBadRequest, "số lượng phải lớn hơn 0")
			return
		case errors.Is(err, store.ErrProductNotFound):
			httpx.WriteError(w, http.StatusBadRequest, "sản phẩm trong đơn không tồn tại")
			return
		case errors.Is(err, store.ErrDiscountExceedsSubtotal):
			httpx.WriteError(w, http.StatusBadRequest, "giảm giá vượt quá tổng tiền hàng")
			return
		case errors.Is(err, store.ErrOrderAmountTooLarge):
			httpx.WriteError(w, http.StatusBadRequest, "giá trị đơn hàng quá lớn")
			return
		case isForeignKeyViolation(err):
			// customer_id là uuid hợp lệ nhưng không có trong customers → FK 23503.
			// Trả 400 (lỗi dữ liệu client) thay vì 500.
			httpx.WriteError(w, http.StatusBadRequest, "khách hàng không tồn tại")
			return
		case isUniqueViolation(err) && attempt < orderCreateMaxRetries:
			continue
		default:
			log.Printf("create order: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "không tạo được đơn, vui lòng thử lại")
			return
		}
	}

	order := result.Order

	// FAIL-SAFE (REQ-NOTI-002): bắn Telegram đơn mới SAU khi commit, bất đồng bộ với
	// context riêng — lỗi/treo notify KHÔNG ảnh hưởng response.
	s.notifyNewOrder(notify.OrderInfo{
		Code:    order.Code,
		Total:   order.Total,
		Channel: order.Channel,
	})

	httpx.WriteJSON(w, http.StatusCreated, api.OrderCreated{
		Id:   openapi_types.UUID(order.ID.Bytes),
		Code: order.Code,
	})
}

// GetAdminOrder phục vụ GET /api/v1/admin/orders/{id}: chi tiết đơn + các dòng
// (snapshot). Không tìm thấy → 404. Cần auth (REQ-ORD-001/004).
func (s *Server) GetAdminOrder(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	order, err := s.orderAdmin.GetOrder(r.Context(), pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy đơn hàng")
			return
		}
		log.Printf("get order: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được đơn hàng")
		return
	}
	rows, err := s.orderAdmin.ListOrderItemsByOrder(r.Context(), order.ID)
	if err != nil {
		log.Printf("list order items: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được đơn hàng")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAPIOrderDetail(order, rows))
}

// UpdateOrderStatus phục vụ PATCH /api/v1/admin/orders/{id}: đổi trạng thái đơn sau
// khi validate enum (REQ-ORD-002). Trạng thái lạ → 400; đơn đã kết thúc
// (done/cancelled) đổi sang trạng thái KHÁC → 400; không tìm thấy → 404.
func (s *Server) UpdateOrderStatus(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	var in api.OrderStatusInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	if err := dec.Decode(&in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "dữ liệu gửi lên không hợp lệ")
		return
	}
	status := strings.TrimSpace(in.Status)
	if !validOrderStatuses[status] {
		httpx.WriteError(w, http.StatusBadRequest, "trạng thái không hợp lệ (new, confirmed, delivering, done hoặc cancelled)")
		return
	}

	// Lấy trạng thái hiện tại để chặn chuyển từ trạng thái kết thúc (done/cancelled)
	// sang trạng thái khác — đơn đã xong/hủy không đổi nữa (REQ-ORD-002).
	current, err := s.orderAdmin.GetOrder(r.Context(), pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy đơn hàng")
			return
		}
		log.Printf("update order status (get): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không cập nhật được trạng thái, vui lòng thử lại")
		return
	}
	if terminalOrderStatuses[current.Status] && current.Status != status {
		httpx.WriteError(w, http.StatusBadRequest, "đơn đã hoàn tất hoặc đã hủy, không thể đổi trạng thái")
		return
	}

	row, err := s.orderAdmin.UpdateOrderStatus(r.Context(), store.UpdateOrderStatusParams{
		ID:     pgUUID(id),
		Status: status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy đơn hàng")
			return
		}
		log.Printf("update order status: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không cập nhật được trạng thái, vui lòng thử lại")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAPIOrder(row))
}

// isForeignKeyViolation cho biết err là vi phạm ràng buộc FOREIGN KEY của Postgres
// (customer_id trỏ tới customer không tồn tại).
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation
}

// optDate map *openapi_types.Date (nullable) → pgtype.Date.
func optDate(d *openapi_types.Date) pgtype.Date {
	if d == nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: d.Time, Valid: true}
}

// toAPIOrder map store.Order → api.Order (kiểu sinh từ openapi).
func toAPIOrder(o store.Order) api.Order {
	out := api.Order{
		Id:              openapi_types.UUID(o.ID.Bytes),
		Code:            o.Code,
		Channel:         api.OrderChannel(o.Channel),
		Status:          api.OrderStatus(o.Status),
		Subtotal:        o.Subtotal,
		Discount:        o.Discount,
		Total:           o.Total,
		DeliveryAddress: o.DeliveryAddress,
		Note:            o.Note,
		CreatedAt:       o.CreatedAt.Time,
	}
	if o.CustomerID.Valid {
		cid := openapi_types.UUID(o.CustomerID.Bytes)
		out.CustomerId = &cid
	}
	if o.DeliveryDate.Valid {
		d := openapi_types.Date{Time: o.DeliveryDate.Time}
		out.DeliveryDate = &d
	}
	return out
}

// toAPIOrderItem map store.OrderItem → api.OrderItem (giữ snapshot).
func toAPIOrderItem(it store.OrderItem) api.OrderItem {
	out := api.OrderItem{
		Id:          openapi_types.UUID(it.ID.Bytes),
		ProductName: it.ProductName,
		UnitPrice:   it.UnitPrice,
		Quantity:    int(it.Quantity),
	}
	if it.ProductID.Valid {
		pid := openapi_types.UUID(it.ProductID.Bytes)
		out.ProductId = &pid
	}
	return out
}

// toAPIOrderDetail map order + items → api.OrderDetail.
func toAPIOrderDetail(o store.Order, items []store.OrderItem) api.OrderDetail {
	apiItems := make([]api.OrderItem, 0, len(items))
	for _, it := range items {
		apiItems = append(apiItems, toAPIOrderItem(it))
	}
	detail := api.OrderDetail{
		Id:              openapi_types.UUID(o.ID.Bytes),
		Code:            o.Code,
		Channel:         api.OrderDetailChannel(o.Channel),
		Status:          api.OrderDetailStatus(o.Status),
		Subtotal:        o.Subtotal,
		Discount:        o.Discount,
		Total:           o.Total,
		DeliveryAddress: o.DeliveryAddress,
		Note:            o.Note,
		CreatedAt:       o.CreatedAt.Time,
		Items:           apiItems,
	}
	if o.CustomerID.Valid {
		cid := openapi_types.UUID(o.CustomerID.Bytes)
		detail.CustomerId = &cid
	}
	if o.DeliveryDate.Valid {
		d := openapi_types.Date{Time: o.DeliveryDate.Time}
		detail.DeliveryDate = &d
	}
	return detail
}
