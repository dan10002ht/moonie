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
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/store"
)

// fakeLeadAdmin là leadAdminStore giả cho handler test (không cần DB).
type fakeLeadAdmin struct {
	list        []store.Lead
	total       int64
	listParams  store.ListLeadsAdminParams
	getLead     store.Lead
	getErr      error
	updated     store.Lead
	updateErr   error
	updateParam store.UpdateLeadStatusParams
}

func (f *fakeLeadAdmin) ListLeadsAdmin(_ context.Context, arg store.ListLeadsAdminParams) ([]store.Lead, error) {
	f.listParams = arg
	return f.list, nil
}
func (f *fakeLeadAdmin) CountLeads(context.Context) (int64, error) { return f.total, nil }
func (f *fakeLeadAdmin) GetLead(context.Context, pgtype.UUID) (store.Lead, error) {
	return f.getLead, f.getErr
}
func (f *fakeLeadAdmin) UpdateLeadStatus(_ context.Context, arg store.UpdateLeadStatusParams) (store.Lead, error) {
	f.updateParam = arg
	if f.updateErr != nil {
		return store.Lead{}, f.updateErr
	}
	f.updated = store.Lead{ID: arg.ID, Name: "X", Phone: "0900000000", Source: "website", Status: arg.Status}
	return f.updated, nil
}

// fakeLeadConverter là leadConverter giả: ghi lại params + trả order định sẵn/ lỗi.
type fakeLeadConverter struct {
	order  store.Order
	err    error
	params store.ConvertLeadParams
	calls  int
}

func (f *fakeLeadConverter) ConvertLead(_ context.Context, arg store.ConvertLeadParams) (store.Order, error) {
	f.calls++
	f.params = arg
	return f.order, f.err
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func sampleLead(name string, when time.Time) store.Lead {
	return store.Lead{
		ID:        pgtype.UUID{Bytes: uuid.New(), Valid: true},
		Name:      name,
		Phone:     "0912345678",
		Source:    "website",
		Status:    "new",
		CreatedAt: ts(when),
	}
}

// TestListAdminLeadsShape: trả {items,total}, giữ thứ tự store (mới nhất trước).
func TestListAdminLeadsShape(t *testing.T) {
	now := time.Now()
	f := &fakeLeadAdmin{
		list:  []store.Lead{sampleLead("Mới", now), sampleLead("Cũ", now.Add(-time.Hour))},
		total: 5,
	}
	srv := &Server{leadAdmin: f}
	rec := httptest.NewRecorder()
	srv.ListAdminLeads(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/leads", nil), api.ListAdminLeadsParams{})

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got api.LeadList
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Total != 5 {
		t.Errorf("total = %d, want 5", got.Total)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items len = %d, want 2", len(got.Items))
	}
	if got.Items[0].Name != "Mới" {
		t.Errorf("thứ tự đầu = %q, want %q (mới nhất trước)", got.Items[0].Name, "Mới")
	}
	// Không truyền limit/offset → default limit 20, offset 0.
	if f.listParams.Limit != leadsDefaultLimit || f.listParams.Offset != 0 {
		t.Errorf("params = %+v, want limit=%d offset=0", f.listParams, leadsDefaultLimit)
	}
}

// TestListAdminLeadsPaginationClamp: limit vượt trần bị kẹp 100; offset truyền đúng.
func TestListAdminLeadsPaginationClamp(t *testing.T) {
	tests := []struct {
		name       string
		limit      *int
		offset     *int
		wantLimit  int32
		wantOffset int32
	}{
		{"limit 2 offset 4", ptrInt(2), ptrInt(4), 2, 4},
		{"limit vượt trần → 100", ptrInt(9999), nil, leadsMaxLimit, 0},
		{"limit <1 → default", ptrInt(0), nil, leadsDefaultLimit, 0},
		{"offset âm → 0", nil, ptrInt(-5), leadsDefaultLimit, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeLeadAdmin{}
			srv := &Server{leadAdmin: f}
			rec := httptest.NewRecorder()
			srv.ListAdminLeads(rec, httptest.NewRequest(http.MethodGet, "/x", nil),
				api.ListAdminLeadsParams{Limit: tc.limit, Offset: tc.offset})
			if rec.Code != http.StatusOK {
				t.Fatalf("code = %d, want 200", rec.Code)
			}
			if f.listParams.Limit != tc.wantLimit || f.listParams.Offset != tc.wantOffset {
				t.Errorf("params = %+v, want limit=%d offset=%d", f.listParams, tc.wantLimit, tc.wantOffset)
			}
		})
	}
}

// TestUpdateLeadStatusValid: PATCH status hợp lệ → 200 + gọi store đúng status.
func TestUpdateLeadStatusValid(t *testing.T) {
	f := &fakeLeadAdmin{}
	srv := &Server{leadAdmin: f}
	id := openapi_types.UUID(uuid.New())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"status":"contacted"}`))
	srv.UpdateLeadStatus(rec, req, id)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if f.updateParam.Status != "contacted" {
		t.Errorf("store status = %q, want contacted", f.updateParam.Status)
	}
	var got api.Lead
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Status != api.LeadStatus("contacted") {
		t.Errorf("resp status = %q, want contacted", got.Status)
	}
}

// TestUpdateLeadStatusInvalid: status lạ → 400, KHÔNG gọi store.
func TestUpdateLeadStatusInvalid(t *testing.T) {
	f := &fakeLeadAdmin{}
	srv := &Server{leadAdmin: f}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"status":"banana"}`))
	srv.UpdateLeadStatus(rec, req, openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	if f.updateParam.Status != "" {
		t.Errorf("store không được gọi khi status lạ, đã gọi với %q", f.updateParam.Status)
	}
}

// TestUpdateLeadStatusNotFound: store trả ErrNoRows → 404.
func TestUpdateLeadStatusNotFound(t *testing.T) {
	f := &fakeLeadAdmin{updateErr: pgx.ErrNoRows}
	srv := &Server{leadAdmin: f}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/x", strings.NewReader(`{"status":"closed"}`))
	srv.UpdateLeadStatus(rec, req, openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

// TestConvertLeadCreatesDraft: lead 'new' → 201 {order_id, order_code}; note gộp lead.
func TestConvertLeadCreatesDraft(t *testing.T) {
	lead := sampleLead("Nguyễn An", time.Now())
	pi := "vong-nguyet"
	msg := "giao trước Trung thu"
	lead.ProductInterest = &pi
	lead.Message = &msg
	lead.Source = "zalo"

	orderID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	conv := &fakeLeadConverter{order: store.Order{ID: orderID, Code: "MC-20260717-AB23", Channel: "zalo"}}
	f := &fakeLeadAdmin{getLead: lead}
	srv := &Server{leadAdmin: f, leadConvert: conv}

	rec := httptest.NewRecorder()
	srv.ConvertLead(rec, httptest.NewRequest(http.MethodPost, "/x", nil), openapi_types.UUID(lead.ID.Bytes))

	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var got api.ConvertLeadResult
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.OrderCode != "MC-20260717-AB23" {
		t.Errorf("order_code = %q, want MC-20260717-AB23", got.OrderCode)
	}
	if got.OrderId != openapi_types.UUID(orderID.Bytes) {
		t.Errorf("order_id = %v, want %v", got.OrderId, orderID)
	}
	// Channel map từ source 'zalo'.
	if conv.params.Channel != "zalo" {
		t.Errorf("channel = %q, want zalo", conv.params.Channel)
	}
	// note gộp tên + SĐT + quan tâm + lời nhắn.
	for _, want := range []string{"Nguyễn An", "0912345678", "vong-nguyet", "giao trước Trung thu"} {
		if !strings.Contains(conv.params.Note, want) {
			t.Errorf("note = %q, thiếu %q", conv.params.Note, want)
		}
	}
	// Mã đơn đúng định dạng MC-YYYYMMDD-xxxx.
	if !strings.HasPrefix(conv.params.Code, "MC-") || len(conv.params.Code) != len("MC-20060102-XXXX") {
		t.Errorf("code = %q, sai định dạng MC-YYYYMMDD-xxxx", conv.params.Code)
	}
}

// TestConvertLeadAlreadyConverted: lead đã 'converted' → 409, KHÔNG gọi converter.
func TestConvertLeadAlreadyConverted(t *testing.T) {
	lead := sampleLead("Đã convert", time.Now())
	lead.Status = "converted"
	lead.OrderID = pgtype.UUID{Bytes: uuid.New(), Valid: true}
	conv := &fakeLeadConverter{}
	srv := &Server{leadAdmin: &fakeLeadAdmin{getLead: lead}, leadConvert: conv}

	rec := httptest.NewRecorder()
	srv.ConvertLead(rec, httptest.NewRequest(http.MethodPost, "/x", nil), openapi_types.UUID(lead.ID.Bytes))
	if rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
	if conv.calls != 0 {
		t.Errorf("converter được gọi %d lần, want 0 (không convert 2 lần)", conv.calls)
	}
}

// TestConvertLeadNotFound: lead không tồn tại → 404.
func TestConvertLeadNotFound(t *testing.T) {
	conv := &fakeLeadConverter{}
	srv := &Server{leadAdmin: &fakeLeadAdmin{getErr: pgx.ErrNoRows}, leadConvert: conv}
	rec := httptest.NewRecorder()
	srv.ConvertLead(rec, httptest.NewRequest(http.MethodPost, "/x", nil), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	if conv.calls != 0 {
		t.Errorf("converter không được gọi khi lead không tồn tại, đã gọi %d", conv.calls)
	}
}

func ptrInt(v int) *int { return &v }
