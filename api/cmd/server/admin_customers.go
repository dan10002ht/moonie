package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/store"
	"github.com/moonie/api/internal/validate"
)

// Phân trang khách hàng (REQ-CUST-001): mặc định 20, tối đa 100 (quy ước GĐ4). Vượt
// trần bị kẹp về 100 để một request không kéo cả bảng.
const (
	customersDefaultLimit = 20
	customersMaxLimit     = 100
)

// Trần độ dài các trường khách hàng — chặn body khổng lồ ở boundary (NFR-004). Đếm
// theo rune để đúng với tiếng Việt.
const (
	customerNameMaxLen    = 200
	customerCompanyMaxLen = 200
	customerAddressMaxLen = 500
	customerNoteMaxLen    = 2000
	customerEmailMaxLen   = 254
	customerPhoneMaxLen   = 30
)

// validCustomerTypes khớp CHECK constraint customers.type (0006_customers). Validate ở
// handler để trả 400 thân thiện thay vì để CHECK bung 500 (REQ-CUST-001).
var validCustomerTypes = map[string]bool{
	"personal": true, "business": true,
}

// customerAdminStore là phần store handler khách hàng cần (CRUD, không tx). Tách qua
// interface để inject fake trong handler test (không cần Postgres).
type customerAdminStore interface {
	ListCustomers(ctx context.Context, arg store.ListCustomersParams) ([]store.Customer, error)
	CountCustomers(ctx context.Context) (int64, error)
	GetCustomer(ctx context.Context, id pgtype.UUID) (store.Customer, error)
	CreateCustomer(ctx context.Context, arg store.CreateCustomerParams) (store.Customer, error)
	UpdateCustomer(ctx context.Context, arg store.UpdateCustomerParams) (store.Customer, error)
}

// ListAdminCustomers phục vụ GET /api/v1/admin/customers: khách hàng phân trang, mới
// nhất trước, trả {items, total}. Cần auth (middleware gác) (REQ-CUST-001).
func (s *Server) ListAdminCustomers(w http.ResponseWriter, r *http.Request, params api.ListAdminCustomersParams) {
	limit := customersDefaultLimit
	if params.Limit != nil {
		limit = *params.Limit
	}
	if limit < 1 {
		limit = customersDefaultLimit
	}
	if limit > customersMaxLimit {
		limit = customersMaxLimit
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

	rows, err := s.customerAdmin.ListCustomers(r.Context(), store.ListCustomersParams{
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		log.Printf("list admin customers: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách khách hàng")
		return
	}
	total, err := s.customerAdmin.CountCustomers(r.Context())
	if err != nil {
		log.Printf("count customers: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách khách hàng")
		return
	}

	items := make([]api.Customer, 0, len(rows))
	for _, row := range rows {
		items = append(items, toAPICustomer(row))
	}
	httpx.WriteJSON(w, http.StatusOK, api.CustomerList{Items: items, Total: total})
}

// CreateCustomer phục vụ POST /api/v1/admin/customers: tạo khách hàng sau khi validate
// ở handler (name không rỗng, type enum, phone/email định dạng) — sai → 400 TRƯỚC khi
// chạm DB (không để CHECK constraint bung 500). → 201 {id} (REQ-CUST-001).
func (s *Server) CreateCustomer(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeCustomerInput(w, r)
	if !ok {
		return
	}
	name, phone, email, company, address, note, typ, msg, ok := normalizeCustomerInput(in)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, msg)
		return
	}

	row, err := s.customerAdmin.CreateCustomer(r.Context(), store.CreateCustomerParams{
		Name:    name,
		Phone:   phone,
		Email:   email,
		Company: company,
		Address: address,
		Type:    typ,
		Note:    note,
	})
	if err != nil {
		log.Printf("create customer: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không tạo được khách hàng, vui lòng thử lại")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, api.CustomerCreated{Id: openapi_types.UUID(row.ID.Bytes)})
}

// GetAdminCustomer phục vụ GET /api/v1/admin/customers/{id}: chi tiết khách hàng.
// Không tìm thấy → 404. Cần auth (REQ-CUST-001).
func (s *Server) GetAdminCustomer(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	row, err := s.customerAdmin.GetCustomer(r.Context(), pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy khách hàng")
			return
		}
		log.Printf("get customer: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được khách hàng")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAPICustomer(row))
}

// UpdateCustomer phục vụ PUT /api/v1/admin/customers/{id}: cập nhật toàn bộ thuộc tính
// sau khi validate như tạo mới. Không tìm thấy → 404 (REQ-CUST-001).
func (s *Server) UpdateCustomer(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	in, ok := decodeCustomerInput(w, r)
	if !ok {
		return
	}
	name, phone, email, company, address, note, typ, msg, ok := normalizeCustomerInput(in)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, msg)
		return
	}

	row, err := s.customerAdmin.UpdateCustomer(r.Context(), store.UpdateCustomerParams{
		ID:      pgUUID(id),
		Name:    name,
		Phone:   phone,
		Email:   email,
		Company: company,
		Address: address,
		Type:    typ,
		Note:    note,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy khách hàng")
			return
		}
		log.Printf("update customer: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không cập nhật được khách hàng, vui lòng thử lại")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAPICustomer(row))
}

// decodeCustomerInput giải mã body JSON thành api.CustomerInput; lỗi → ghi 400 và trả
// ok=false (caller dừng).
func decodeCustomerInput(w http.ResponseWriter, r *http.Request) (api.CustomerInput, bool) {
	var in api.CustomerInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
	if err := dec.Decode(&in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "dữ liệu gửi lên không hợp lệ")
		return api.CustomerInput{}, false
	}
	return in, true
}

// normalizeCustomerInput validate + chuẩn hoá dữ liệu vào (REQ-CUST-001, NFR-004).
// Trả các trường đã chuẩn hoá (chuỗi rỗng optional → nil) và ok=false + thông điệp khi
// không hợp lệ. Validate ở handler để 400 thân thiện thay vì để CHECK/DB bung 500.
func normalizeCustomerInput(in api.CustomerInput) (name string, phone, email, company, address, note *string, typ, msg string, ok bool) {
	name = strings.TrimSpace(in.Name)
	if name == "" {
		return "", nil, nil, nil, nil, nil, "", "vui lòng nhập tên khách hàng", false
	}
	if utf8.RuneCountInString(name) > customerNameMaxLen {
		return "", nil, nil, nil, nil, nil, "", "tên khách hàng quá dài", false
	}

	typ = strings.TrimSpace(string(in.Type))
	if !validCustomerTypes[typ] {
		return "", nil, nil, nil, nil, nil, "", "loại khách hàng không hợp lệ (personal hoặc business)", false
	}

	// Phone optional: rỗng → bỏ qua (không lưu). Có giá trị → validate định dạng VN.
	phone = trimOptional(in.Phone)
	if phone != nil {
		if utf8.RuneCountInString(*phone) > customerPhoneMaxLen {
			return "", nil, nil, nil, nil, nil, "", "số điện thoại quá dài", false
		}
		if err := validate.Phone(*phone); err != nil {
			return "", nil, nil, nil, nil, nil, "", "số điện thoại không đúng định dạng Việt Nam", false
		}
	}

	// Email optional: rỗng → bỏ qua. Có giá trị → kiểm tra định dạng cơ bản.
	email = trimOptional(in.Email)
	if email != nil {
		if utf8.RuneCountInString(*email) > customerEmailMaxLen {
			return "", nil, nil, nil, nil, nil, "", "email quá dài", false
		}
		if !validEmail(*email) {
			return "", nil, nil, nil, nil, nil, "", "email không đúng định dạng", false
		}
	}

	company = trimOptional(in.Company)
	if company != nil && utf8.RuneCountInString(*company) > customerCompanyMaxLen {
		return "", nil, nil, nil, nil, nil, "", "tên công ty quá dài", false
	}
	address = trimOptional(in.Address)
	if address != nil && utf8.RuneCountInString(*address) > customerAddressMaxLen {
		return "", nil, nil, nil, nil, nil, "", "địa chỉ quá dài", false
	}
	note = trimOptional(in.Note)
	if note != nil && utf8.RuneCountInString(*note) > customerNoteMaxLen {
		return "", nil, nil, nil, nil, nil, "", "ghi chú quá dài", false
	}

	return name, phone, email, company, address, note, typ, "", true
}

// trimOptional trim khoảng trắng chuỗi optional; rỗng sau trim → nil (không lưu ""
// vào DB, giữ NULL đúng ngữ nghĩa "không có").
func trimOptional(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

// validEmail kiểm tra định dạng email cơ bản (REQ-CUST-001): đúng 1 dấu '@', phần
// local không rỗng, phần domain có ít nhất 1 dấu '.' với ký tự hai bên và không chứa
// khoảng trắng. Cố ý đơn giản (không RFC 5322 đầy đủ) — chỉ chặn nhập liệu rõ sai.
func validEmail(s string) bool {
	if strings.ContainsAny(s, " \t\r\n") {
		return false
	}
	at := strings.IndexByte(s, '@')
	if at <= 0 || at != strings.LastIndexByte(s, '@') {
		return false
	}
	local, domain := s[:at], s[at+1:]
	if local == "" || domain == "" {
		return false
	}
	dot := strings.LastIndexByte(domain, '.')
	if dot <= 0 || dot == len(domain)-1 {
		return false
	}
	return true
}

// toAPICustomer map store.Customer → api.Customer (kiểu sinh từ openapi).
func toAPICustomer(c store.Customer) api.Customer {
	return api.Customer{
		Id:        openapi_types.UUID(c.ID.Bytes),
		Name:      c.Name,
		Phone:     c.Phone,
		Email:     c.Email,
		Company:   c.Company,
		Address:   c.Address,
		Type:      api.CustomerType(c.Type),
		Note:      c.Note,
		CreatedAt: c.CreatedAt.Time,
	}
}
