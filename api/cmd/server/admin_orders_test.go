package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/store"
)

// fakeOrderAdmin là orderAdminStore giả cho handler test (không cần DB).
type fakeOrderAdmin struct {
	list         []store.Order
	total        int64
	listParams   store.ListOrdersParams
	getOrder     store.Order
	getErr       error
	items        []store.OrderItem
	updated      store.Order
	updateErr    error
	updateParams store.UpdateOrderStatusParams
	updateCalls  int
}

func (f *fakeOrderAdmin) ListOrders(_ context.Context, arg store.ListOrdersParams) ([]store.Order, error) {
	f.listParams = arg
	return f.list, nil
}
func (f *fakeOrderAdmin) CountOrders(context.Context) (int64, error) { return f.total, nil }
func (f *fakeOrderAdmin) GetOrder(context.Context, pgtype.UUID) (store.Order, error) {
	return f.getOrder, f.getErr
}
func (f *fakeOrderAdmin) ListOrderItemsByOrder(context.Context, pgtype.UUID) ([]store.OrderItem, error) {
	return f.items, nil
}
func (f *fakeOrderAdmin) UpdateOrderStatus(_ context.Context, arg store.UpdateOrderStatusParams) (store.Order, error) {
	f.updateCalls++
	f.updateParams = arg
	if f.updateErr != nil {
		return store.Order{}, f.updateErr
	}
	f.updated = store.Order{ID: arg.ID, Code: "MC-X", Channel: "phone", Status: arg.Status}
	return f.updated, nil
}

// fakeOrderCreator là orderCreator giả: ghi lại params + trả kết quả/lỗi định sẵn.
type fakeOrderCreator struct {
	result store.OrderWithItems
	err    error
	params store.CreateOrderWithItemsParams
	calls  int
}

func (f *fakeOrderCreator) CreateOrderWithItems(_ context.Context, arg store.CreateOrderWithItemsParams) (store.OrderWithItems, error) {
	f.calls++
	f.params = arg
	return f.result, f.err
}

func sampleOrder(code string, when time.Time) store.Order {
	return store.Order{
		ID:        pgtype.UUID{Bytes: uuid.New(), Valid: true},
		Code:      code,
		Channel:   "website",
		Status:    "new",
		Subtotal:  100000,
		Total:     100000,
		CreatedAt: ts(when),
	}
}

// TestListAdminOrdersShape: trả {items,total}, giữ thứ tự store (mới nhất trước),
// default limit/offset.
func TestListAdminOrdersShape(t *testing.T) {
	now := time.Now()
	f := &fakeOrderAdmin{
		list:  []store.Order{sampleOrder("MC-NEW", now), sampleOrder("MC-OLD", now.Add(-time.Hour))},
		total: 7,
	}
	srv := &Server{orderAdmin: f}
	rec := httptest.NewRecorder()
	srv.ListAdminOrders(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders", nil), api.ListAdminOrdersParams{})

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got api.OrderList
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Total != 7 {
		t.Errorf("total = %d, want 7", got.Total)
	}
	if len(got.Items) != 2 || got.Items[0].Code != "MC-NEW" {
		t.Errorf("items = %+v, want first MC-NEW", got.Items)
	}
	if f.listParams.Limit != ordersDefaultLimit || f.listParams.Offset != 0 {
		t.Errorf("params = %+v, want limit=%d offset=0", f.listParams, ordersDefaultLimit)
	}
}

// TestListAdminOrdersPaginationClamp: limit vượt trần bị kẹp 100; offset truyền đúng.
func TestListAdminOrdersPaginationClamp(t *testing.T) {
	tests := []struct {
		name       string
		limit      *int
		offset     *int
		wantLimit  int32
		wantOffset int32
	}{
		{"limit 2 offset 4", ptrInt(2), ptrInt(4), 2, 4},
		{"limit vượt trần → 100", ptrInt(9999), nil, ordersMaxLimit, 0},
		{"limit <1 → default", ptrInt(0), nil, ordersDefaultLimit, 0},
		{"offset âm → 0", nil, ptrInt(-5), ordersDefaultLimit, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeOrderAdmin{}
			srv := &Server{orderAdmin: f}
			rec := httptest.NewRecorder()
			srv.ListAdminOrders(rec, httptest.NewRequest(http.MethodGet, "/x", nil),
				api.ListAdminOrdersParams{Limit: tc.limit, Offset: tc.offset})
			if rec.Code != http.StatusOK {
				t.Fatalf("code = %d, want 200", rec.Code)
			}
			if f.listParams.Limit != tc.wantLimit || f.listParams.Offset != tc.wantOffset {
				t.Errorf("params = %+v, want limit=%d offset=%d", f.listParams, tc.wantLimit, tc.wantOffset)
			}
		})
	}
}

// TestCreateOrderSuccess: body hợp lệ → 201 {id, code}; store nhận đúng channel/
// discount/items; sinh mã MC-YYYYMMDD-xxxx.
func TestCreateOrderSuccess(t *testing.T) {
	pid := openapi_types.UUID(uuid.New())
	orderID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	f := &fakeOrderCreator{result: store.OrderWithItems{Order: store.Order{ID: orderID, Code: "MC-20260717-AB23", Channel: "phone", Total: 350000}}}
	srv := &Server{orderCreate: f}

	body := `{"channel":"phone","discount":50000,"items":[{"product_id":"` + pid.String() + `","quantity":2}]}`
	rec := httptest.NewRecorder()
	srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))

	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var got api.OrderCreated
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Code != "MC-20260717-AB23" {
		t.Errorf("code = %q, want MC-20260717-AB23", got.Code)
	}
	if got.Id != openapi_types.UUID(orderID.Bytes) {
		t.Errorf("id = %v, want %v", got.Id, orderID)
	}
	if f.params.Channel != "phone" || f.params.Discount != 50000 {
		t.Errorf("params = %+v, want channel=phone discount=50000", f.params)
	}
	if len(f.params.Items) != 1 || f.params.Items[0].Quantity != 2 {
		t.Errorf("items = %+v, want 1 dòng qty 2", f.params.Items)
	}
	if !strings.HasPrefix(f.params.Code, "MC-") || len(f.params.Code) != len("MC-20060102-XXXX") {
		t.Errorf("code sinh = %q, sai định dạng MC-YYYYMMDD-xxxx", f.params.Code)
	}
}

// TestCreateOrderValidation: các body sai → 400, KHÔNG gọi store.
func TestCreateOrderValidation(t *testing.T) {
	pid := openapi_types.UUID(uuid.New()).String()
	tests := []struct {
		name string
		body string
	}{
		{"channel sai", `{"channel":"tiktok","items":[{"product_id":"` + pid + `","quantity":1}]}`},
		{"items rỗng", `{"channel":"website","items":[]}`},
		{"quantity <= 0", `{"channel":"website","items":[{"product_id":"` + pid + `","quantity":0}]}`},
		{"discount âm", `{"channel":"website","discount":-1,"items":[{"product_id":"` + pid + `","quantity":1}]}`},
		{"json hỏng", `{`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeOrderCreator{}
			srv := &Server{orderCreate: f}
			rec := httptest.NewRecorder()
			srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(tc.body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if f.calls != 0 {
				t.Errorf("store được gọi %d lần, want 0 (validate trước tx)", f.calls)
			}
		})
	}
}

// TestCreateOrderQuantityOverflow: quantity > MaxInt32 (Go int 64-bit) → 400, KHÔNG
// gọi store, KHÔNG bị int32() cắt âm thầm thành số nhỏ (chống corruption tiền).
func TestCreateOrderQuantityOverflow(t *testing.T) {
	pid := openapi_types.UUID(uuid.New()).String()
	// 2^32 + 5 = 4294967301: qua check >0 nhưng int32() sẽ cắt còn 5 nếu không chặn.
	f := &fakeOrderCreator{}
	srv := &Server{orderCreate: f}
	body := `{"channel":"website","items":[{"product_id":"` + pid + `","quantity":4294967301}]}`
	rec := httptest.NewRecorder()
	srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if f.calls != 0 {
		t.Errorf("store gọi %d lần, want 0 (chặn trước khi ép int32)", f.calls)
	}
}

// TestCreateOrderTooManyItems: > maxOrderItems dòng → 400, KHÔNG gọi store.
func TestCreateOrderTooManyItems(t *testing.T) {
	pid := openapi_types.UUID(uuid.New()).String()
	var b strings.Builder
	b.WriteString(`{"channel":"website","items":[`)
	for i := 0; i < maxOrderItems+1; i++ {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`{"product_id":"` + pid + `","quantity":1}`)
	}
	b.WriteString(`]}`)
	f := &fakeOrderCreator{}
	srv := &Server{orderCreate: f}
	rec := httptest.NewRecorder()
	srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(b.String())))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if f.calls != 0 {
		t.Errorf("store gọi %d lần, want 0 (chặn > %d dòng)", f.calls, maxOrderItems)
	}
}

// TestCreateOrderAmountTooLarge: store trả ErrOrderAmountTooLarge → 400.
func TestCreateOrderAmountTooLarge(t *testing.T) {
	pid := openapi_types.UUID(uuid.New()).String()
	f := &fakeOrderCreator{err: store.ErrOrderAmountTooLarge}
	srv := &Server{orderCreate: f}
	body := `{"channel":"website","items":[{"product_id":"` + pid + `","quantity":9999}]}`
	rec := httptest.NewRecorder()
	srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestCreateOrderCustomerFKViolation: customer_id uuid hợp lệ nhưng không tồn tại →
// store trả FK violation (23503) → handler map 400 (KHÔNG 500).
func TestCreateOrderCustomerFKViolation(t *testing.T) {
	pid := openapi_types.UUID(uuid.New()).String()
	cid := openapi_types.UUID(uuid.New()).String()
	f := &fakeOrderCreator{err: &pgconn.PgError{Code: pgForeignKeyViolation}}
	srv := &Server{orderCreate: f}
	body := `{"channel":"website","customer_id":"` + cid + `","items":[{"product_id":"` + pid + `","quantity":1}]}`
	rec := httptest.NewRecorder()
	srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestCreateOrderProductNotFound: store trả ErrProductNotFound → 400 (rollback).
func TestCreateOrderProductNotFound(t *testing.T) {
	pid := openapi_types.UUID(uuid.New()).String()
	f := &fakeOrderCreator{err: store.ErrProductNotFound}
	srv := &Server{orderCreate: f}
	body := `{"channel":"website","items":[{"product_id":"` + pid + `","quantity":1}]}`
	rec := httptest.NewRecorder()
	srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestCreateOrderDiscountExceeds: store trả ErrDiscountExceedsSubtotal → 400.
func TestCreateOrderDiscountExceeds(t *testing.T) {
	pid := openapi_types.UUID(uuid.New()).String()
	f := &fakeOrderCreator{err: store.ErrDiscountExceedsSubtotal}
	srv := &Server{orderCreate: f}
	body := `{"channel":"website","discount":999999999,"items":[{"product_id":"` + pid + `","quantity":1}]}`
	rec := httptest.NewRecorder()
	srv.CreateOrder(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestGetAdminOrderDetail: trả chi tiết + items snapshot.
func TestGetAdminOrderDetail(t *testing.T) {
	order := sampleOrder("MC-DET", time.Now())
	f := &fakeOrderAdmin{
		getOrder: order,
		items: []store.OrderItem{
			{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, ProductName: "Bánh thập cẩm", UnitPrice: 200000, Quantity: 2},
		},
	}
	srv := &Server{orderAdmin: f}
	rec := httptest.NewRecorder()
	srv.GetAdminOrder(rec, httptest.NewRequest(http.MethodGet, "/x", nil), openapi_types.UUID(order.ID.Bytes))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got api.OrderDetail
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Code != "MC-DET" {
		t.Errorf("code = %q, want MC-DET", got.Code)
	}
	if len(got.Items) != 1 || got.Items[0].ProductName != "Bánh thập cẩm" || got.Items[0].UnitPrice != 200000 {
		t.Errorf("items = %+v, want 1 dòng snapshot Bánh thập cẩm 200000", got.Items)
	}
}

// TestGetAdminOrderNotFound: không có đơn → 404.
func TestGetAdminOrderNotFound(t *testing.T) {
	f := &fakeOrderAdmin{getErr: pgx.ErrNoRows}
	srv := &Server{orderAdmin: f}
	rec := httptest.NewRecorder()
	srv.GetAdminOrder(rec, httptest.NewRequest(http.MethodGet, "/x", nil), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

// TestUpdateOrderStatusValid: new→confirmed → 200, gọi store đúng status.
func TestUpdateOrderStatusValid(t *testing.T) {
	order := sampleOrder("MC-ST", time.Now())
	order.Status = "new"
	f := &fakeOrderAdmin{getOrder: order}
	srv := &Server{orderAdmin: f}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"status":"confirmed"}`))
	srv.UpdateOrderStatus(rec, req, openapi_types.UUID(order.ID.Bytes))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if f.updateParams.Status != "confirmed" {
		t.Errorf("store status = %q, want confirmed", f.updateParams.Status)
	}
}

// TestUpdateOrderStatusInvalidEnum: status lạ → 400, KHÔNG gọi update.
func TestUpdateOrderStatusInvalidEnum(t *testing.T) {
	f := &fakeOrderAdmin{getOrder: sampleOrder("MC-ST", time.Now())}
	srv := &Server{orderAdmin: f}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"status":"xyz"}`))
	srv.UpdateOrderStatus(rec, req, openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	if f.updateCalls != 0 {
		t.Errorf("update gọi %d lần, want 0", f.updateCalls)
	}
}

// TestUpdateOrderStatusTerminalBlocked: đơn 'done' đổi sang 'confirmed' → 400.
func TestUpdateOrderStatusTerminalBlocked(t *testing.T) {
	order := sampleOrder("MC-DONE", time.Now())
	order.Status = "done"
	f := &fakeOrderAdmin{getOrder: order}
	srv := &Server{orderAdmin: f}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"status":"confirmed"}`))
	srv.UpdateOrderStatus(rec, req, openapi_types.UUID(order.ID.Bytes))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if f.updateCalls != 0 {
		t.Errorf("update gọi %d lần, want 0 (đơn kết thúc không đổi)", f.updateCalls)
	}
}

// TestUpdateOrderStatusNotFound: đơn không tồn tại → 404.
func TestUpdateOrderStatusNotFound(t *testing.T) {
	f := &fakeOrderAdmin{getErr: pgx.ErrNoRows}
	srv := &Server{orderAdmin: f}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"status":"confirmed"}`))
	srv.UpdateOrderStatus(rec, req, openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}
