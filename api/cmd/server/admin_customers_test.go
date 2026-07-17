package main

import (
	"context"
	"encoding/json"
	"math"
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

// fakeCustomerAdmin là customerAdminStore giả cho handler test (không cần DB).
type fakeCustomerAdmin struct {
	list        []store.Customer
	total       int64
	listParams  store.ListCustomersParams
	getCustomer store.Customer
	getErr      error
	createParam store.CreateCustomerParams
	createErr   error
	updateParam store.UpdateCustomerParams
	updateErr   error
	created     bool
	updated     bool
}

func (f *fakeCustomerAdmin) ListCustomers(_ context.Context, arg store.ListCustomersParams) ([]store.Customer, error) {
	f.listParams = arg
	return f.list, nil
}
func (f *fakeCustomerAdmin) CountCustomers(context.Context) (int64, error) { return f.total, nil }
func (f *fakeCustomerAdmin) GetCustomer(context.Context, pgtype.UUID) (store.Customer, error) {
	return f.getCustomer, f.getErr
}
func (f *fakeCustomerAdmin) CreateCustomer(_ context.Context, arg store.CreateCustomerParams) (store.Customer, error) {
	f.createParam = arg
	f.created = true
	if f.createErr != nil {
		return store.Customer{}, f.createErr
	}
	return store.Customer{
		ID:      pgtype.UUID{Bytes: uuid.New(), Valid: true},
		Name:    arg.Name,
		Phone:   arg.Phone,
		Email:   arg.Email,
		Company: arg.Company,
		Address: arg.Address,
		Type:    arg.Type,
		Note:    arg.Note,
	}, nil
}
func (f *fakeCustomerAdmin) UpdateCustomer(_ context.Context, arg store.UpdateCustomerParams) (store.Customer, error) {
	f.updateParam = arg
	f.updated = true
	if f.updateErr != nil {
		return store.Customer{}, f.updateErr
	}
	return store.Customer{ID: arg.ID, Name: arg.Name, Type: arg.Type, Phone: arg.Phone, Email: arg.Email}, nil
}

func sampleCustomer(name, typ string, when time.Time) store.Customer {
	return store.Customer{
		ID:        pgtype.UUID{Bytes: uuid.New(), Valid: true},
		Name:      name,
		Type:      typ,
		CreatedAt: ts(when),
	}
}

// TestListAdminCustomersShape: trả {items,total}, giữ thứ tự store (mới nhất trước).
func TestListAdminCustomersShape(t *testing.T) {
	now := time.Now()
	f := &fakeCustomerAdmin{
		list:  []store.Customer{sampleCustomer("Mới", "business", now), sampleCustomer("Cũ", "personal", now.Add(-time.Hour))},
		total: 7,
	}
	srv := &Server{customerAdmin: f}
	rec := httptest.NewRecorder()
	srv.ListAdminCustomers(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/customers", nil), api.ListAdminCustomersParams{})

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got api.CustomerList
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Total != 7 {
		t.Errorf("total = %d, want 7", got.Total)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items len = %d, want 2", len(got.Items))
	}
	if got.Items[0].Name != "Mới" {
		t.Errorf("thứ tự đầu = %q, want %q (mới nhất trước)", got.Items[0].Name, "Mới")
	}
	if f.listParams.Limit != customersDefaultLimit || f.listParams.Offset != 0 {
		t.Errorf("params = %+v, want limit=%d offset=0", f.listParams, customersDefaultLimit)
	}
}

// TestListAdminCustomersPaginationClamp: limit vượt trần bị kẹp 100; offset truyền đúng.
func TestListAdminCustomersPaginationClamp(t *testing.T) {
	tests := []struct {
		name       string
		limit      *int
		offset     *int
		wantLimit  int32
		wantOffset int32
	}{
		{"limit 2 offset 4", ptrInt(2), ptrInt(4), 2, 4},
		{"limit vượt trần → 100", ptrInt(9999), nil, customersMaxLimit, 0},
		{"limit <1 → default", ptrInt(0), nil, customersDefaultLimit, 0},
		{"offset âm → 0", nil, ptrInt(-5), customersDefaultLimit, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeCustomerAdmin{}
			srv := &Server{customerAdmin: f}
			rec := httptest.NewRecorder()
			srv.ListAdminCustomers(rec, httptest.NewRequest(http.MethodGet, "/x", nil),
				api.ListAdminCustomersParams{Limit: tc.limit, Offset: tc.offset})
			if rec.Code != http.StatusOK {
				t.Fatalf("code = %d, want 200", rec.Code)
			}
			if f.listParams.Limit != tc.wantLimit || f.listParams.Offset != tc.wantOffset {
				t.Errorf("params = %+v, want limit=%d offset=%d", f.listParams, tc.wantLimit, tc.wantOffset)
			}
		})
	}
}

// TestListAdminCustomersOffsetOverflow: offset > MaxInt32 → 400, KHÔNG gọi store.
func TestListAdminCustomersOffsetOverflow(t *testing.T) {
	f := &fakeCustomerAdmin{}
	srv := &Server{customerAdmin: f}
	rec := httptest.NewRecorder()
	over := math.MaxInt32 + 1
	srv.ListAdminCustomers(rec, httptest.NewRequest(http.MethodGet, "/x", nil),
		api.ListAdminCustomersParams{Offset: &over})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	if f.listParams.Limit != 0 {
		t.Errorf("store không được gọi khi offset tràn, đã gọi với %+v", f.listParams)
	}
}

// TestCreateCustomerValid: body hợp lệ (type business) → 201 {id}; store nhận field
// đã chuẩn hoá (chuỗi optional rỗng → nil).
func TestCreateCustomerValid(t *testing.T) {
	f := &fakeCustomerAdmin{}
	srv := &Server{customerAdmin: f}
	rec := httptest.NewRecorder()
	body := `{"name":"  Công ty ABC  ","type":"business","phone":"0912345678","email":"abc@example.com","company":"ABC JSC","address":"","note":"  "}`
	srv.CreateCustomer(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))

	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var got api.CustomerCreated
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Id == (openapi_types.UUID{}) {
		t.Errorf("id rỗng, want uuid")
	}
	// name trim, type giữ, phone/email/company có giá trị, address/note rỗng → nil.
	if f.createParam.Name != "Công ty ABC" {
		t.Errorf("name = %q, want trim 'Công ty ABC'", f.createParam.Name)
	}
	if f.createParam.Type != "business" {
		t.Errorf("type = %q, want business", f.createParam.Type)
	}
	if f.createParam.Phone == nil || *f.createParam.Phone != "0912345678" {
		t.Errorf("phone = %v, want 0912345678", f.createParam.Phone)
	}
	if f.createParam.Address != nil {
		t.Errorf("address = %v, want nil (rỗng sau trim)", f.createParam.Address)
	}
	if f.createParam.Note != nil {
		t.Errorf("note = %v, want nil (chỉ khoảng trắng)", f.createParam.Note)
	}
}

// TestCreateCustomerValidation: các trường hợp 400 — validate ở handler TRƯỚC khi
// chạm DB (không để CHECK constraint bung 500). Store KHÔNG được gọi.
func TestCreateCustomerValidation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"thiếu name", `{"type":"personal"}`},
		{"name rỗng sau trim", `{"name":"   ","type":"personal"}`},
		{"type sai enum (vip)", `{"name":"A","type":"vip"}`},
		{"type rỗng", `{"name":"A","type":""}`},
		{"phone sai định dạng VN", `{"name":"A","type":"personal","phone":"123"}`},
		{"email không có @", `{"name":"A","type":"personal","email":"abc.example.com"}`},
		{"email không có domain dot", `{"name":"A","type":"personal","email":"abc@example"}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeCustomerAdmin{}
			srv := &Server{customerAdmin: f}
			rec := httptest.NewRecorder()
			srv.CreateCustomer(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(tc.body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if f.created {
				t.Errorf("store CreateCustomer bị gọi khi dữ liệu không hợp lệ (%s)", tc.name)
			}
		})
	}
}

// TestGetAdminCustomerNotFound: store trả ErrNoRows → 404.
func TestGetAdminCustomerNotFound(t *testing.T) {
	f := &fakeCustomerAdmin{getErr: pgx.ErrNoRows}
	srv := &Server{customerAdmin: f}
	rec := httptest.NewRecorder()
	srv.GetAdminCustomer(rec, httptest.NewRequest(http.MethodGet, "/x", nil), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

// TestGetAdminCustomerOK: trả chi tiết khách hàng.
func TestGetAdminCustomerOK(t *testing.T) {
	c := sampleCustomer("Khách", "personal", time.Now())
	f := &fakeCustomerAdmin{getCustomer: c}
	srv := &Server{customerAdmin: f}
	rec := httptest.NewRecorder()
	srv.GetAdminCustomer(rec, httptest.NewRequest(http.MethodGet, "/x", nil), openapi_types.UUID(c.ID.Bytes))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got api.Customer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Name != "Khách" || got.Type != api.CustomerType("personal") {
		t.Errorf("got = %+v, want name=Khách type=personal", got)
	}
}

// TestUpdateCustomerValid: PUT hợp lệ → 200 + gọi store với id + field chuẩn hoá.
func TestUpdateCustomerValid(t *testing.T) {
	f := &fakeCustomerAdmin{}
	srv := &Server{customerAdmin: f}
	id := openapi_types.UUID(uuid.New())
	rec := httptest.NewRecorder()
	body := `{"name":"Sửa Tên","type":"personal","phone":"+84912345678"}`
	srv.UpdateCustomer(rec, httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(body)), id)

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if f.updateParam.ID != pgUUID(id) {
		t.Errorf("update id = %v, want %v", f.updateParam.ID, pgUUID(id))
	}
	if f.updateParam.Name != "Sửa Tên" || f.updateParam.Type != "personal" {
		t.Errorf("update param = %+v, want name='Sửa Tên' type=personal", f.updateParam)
	}
}

// TestUpdateCustomerNotFound: store trả ErrNoRows → 404.
func TestUpdateCustomerNotFound(t *testing.T) {
	f := &fakeCustomerAdmin{updateErr: pgx.ErrNoRows}
	srv := &Server{customerAdmin: f}
	rec := httptest.NewRecorder()
	body := `{"name":"X","type":"personal"}`
	srv.UpdateCustomer(rec, httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(body)), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

// TestUpdateCustomerValidation: type sai → 400, KHÔNG gọi store.
func TestUpdateCustomerValidation(t *testing.T) {
	f := &fakeCustomerAdmin{}
	srv := &Server{customerAdmin: f}
	rec := httptest.NewRecorder()
	body := `{"name":"X","type":"vip"}`
	srv.UpdateCustomer(rec, httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(body)), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	if f.updated {
		t.Errorf("store UpdateCustomer bị gọi khi type sai enum")
	}
}

// TestValidEmail: kiểm tra định dạng email cơ bản.
func TestValidEmail(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"a@b.com", true},
		{"nguyen.an@mail.example.vn", true},
		{"abc.example.com", false},
		{"abc@example", false},
		{"@example.com", false},
		{"abc@", false},
		{"a@@b.com", false},
		{"a b@c.com", false},
		{"abc@example.", false},
	}
	for _, tc := range tests {
		if got := validEmail(tc.in); got != tc.want {
			t.Errorf("validEmail(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
