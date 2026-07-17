package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/store"
)

func strptr(s string) *string { return &s }

// fakeProductLister là productLister giả cho handler test (không cần DB).
type fakeProductLister struct {
	rows []store.Product
	err  error
}

func (f fakeProductLister) ListVisibleProducts(context.Context) ([]store.Product, error) {
	return f.rows, f.err
}

// TestToAPIProduct kiểm mapping store.Product → api.Product thuần (không DB):
// xử lý null (nil) cho description/image_url, chuỗi rỗng, price int64, enum
// type/status, và UUID sao chép đúng 16 byte.
func TestToAPIProduct(t *testing.T) {
	rawID := [16]byte{0x2d, 0xe8, 0x5a, 0xe8, 0xb1, 0xa8, 0x4d, 0xd7, 0xb8, 0xc3, 0x20, 0xdc, 0xf8, 0xb0, 0x4d, 0xeb}

	empty := ""
	desc := "Bánh nướng thập cẩm cao cấp"
	img := "https://cdn.mooni.test/banh.jpg"

	tests := []struct {
		name string
		in   store.Product
		want api.Product
	}{
		{
			name: "null description và image_url",
			in: store.Product{
				ID:           pgtype.UUID{Bytes: rawID, Valid: true},
				Slug:         "hop-qua",
				Name:         "Hộp quà",
				Description:  nil,
				Price:        int64(890000),
				Type:         "gift_box",
				Status:       "sold_out",
				ImageUrl:     nil,
				DisplayOrder: int32(1),
			},
			want: api.Product{
				Id:           rawID,
				Slug:         "hop-qua",
				Name:         "Hộp quà",
				Description:  nil,
				Price:        int64(890000),
				Type:         api.GiftBox,
				Status:       api.SoldOut,
				ImageUrl:     nil,
				DisplayOrder: 1,
			},
		},
		{
			name: "có description và image_url",
			in: store.Product{
				ID:           pgtype.UUID{Bytes: rawID, Valid: true},
				Slug:         "banh-le",
				Name:         "Bánh đơn lẻ",
				Description:  strptr(desc),
				Price:        int64(320000),
				Type:         "single_cake",
				Status:       "available",
				ImageUrl:     strptr(img),
				Badge:        strptr("Bán chạy"),
				DisplayOrder: int32(2),
			},
			want: api.Product{
				Id:           rawID,
				Slug:         "banh-le",
				Name:         "Bánh đơn lẻ",
				Description:  strptr(desc),
				Price:        int64(320000),
				Type:         api.SingleCake,
				Status:       api.Available,
				ImageUrl:     strptr(img),
				Badge:        strptr("Bán chạy"),
				DisplayOrder: 2,
			},
		},
		{
			name: "description chuỗi rỗng giữ nguyên (không thành nil)",
			in: store.Product{
				ID:           pgtype.UUID{Bytes: rawID, Valid: true},
				Slug:         "rong",
				Name:         "Rỗng",
				Description:  strptr(empty),
				Price:        int64(0),
				Type:         "gift_box",
				Status:       "available",
				ImageUrl:     strptr(empty),
				DisplayOrder: int32(0),
			},
			want: api.Product{
				Id:           rawID,
				Slug:         "rong",
				Name:         "Rỗng",
				Description:  strptr(empty),
				Price:        int64(0),
				Type:         api.GiftBox,
				Status:       api.Available,
				ImageUrl:     strptr(empty),
				DisplayOrder: 0,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := toAPIProduct(tt.in)

			if got.Id != tt.want.Id {
				t.Errorf("Id = %v, want %v", got.Id, tt.want.Id)
			}
			if got.Slug != tt.want.Slug {
				t.Errorf("Slug = %q, want %q", got.Slug, tt.want.Slug)
			}
			if got.Name != tt.want.Name {
				t.Errorf("Name = %q, want %q", got.Name, tt.want.Name)
			}
			// Price phải giữ nguyên kiểu int64.
			if got.Price != tt.want.Price {
				t.Errorf("Price = %d, want %d", got.Price, tt.want.Price)
			}
			if got.Type != tt.want.Type {
				t.Errorf("Type = %q, want %q", got.Type, tt.want.Type)
			}
			if got.Status != tt.want.Status {
				t.Errorf("Status = %q, want %q", got.Status, tt.want.Status)
			}
			if got.DisplayOrder != tt.want.DisplayOrder {
				t.Errorf("DisplayOrder = %d, want %d", got.DisplayOrder, tt.want.DisplayOrder)
			}
			// Null (nil) vs con trỏ có giá trị phải phân biệt đúng.
			if !ptrEq(got.Description, tt.want.Description) {
				t.Errorf("Description = %v, want %v", derefStr(got.Description), derefStr(tt.want.Description))
			}
			if !ptrEq(got.ImageUrl, tt.want.ImageUrl) {
				t.Errorf("ImageUrl = %v, want %v", derefStr(got.ImageUrl), derefStr(tt.want.ImageUrl))
			}
			// Badge (nhãn marketing nullable) map đúng: nil giữ nil, có giá trị giữ nguyên.
			if !ptrEq(got.Badge, tt.want.Badge) {
				t.Errorf("Badge = %v, want %v", derefStr(got.Badge), derefStr(tt.want.Badge))
			}
		})
	}
}

func ptrEq(a, b *string) bool {
	if (a == nil) != (b == nil) {
		return false
	}
	if a == nil {
		return true
	}
	return *a == *b
}

func derefStr(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

// TestListProductsHappy kiểm happy path qua httptest với fake store: 200 JSON
// array, map đúng field, luôn là mảng (không null).
func TestListProductsHappy(t *testing.T) {
	rawID := [16]byte{0x2d, 0xe8, 0x5a, 0xe8, 0xb1, 0xa8, 0x4d, 0xd7, 0xb8, 0xc3, 0x20, 0xdc, 0xf8, 0xb0, 0x4d, 0xeb}
	srv := &Server{products: fakeProductLister{rows: []store.Product{
		{ID: pgtype.UUID{Bytes: rawID, Valid: true}, Slug: "a", Name: "A", Price: 100000, Type: "gift_box", Status: "available", DisplayOrder: 1},
		{ID: pgtype.UUID{Bytes: rawID, Valid: true}, Slug: "b", Name: "B", Price: 200000, Type: "single_cake", Status: "sold_out", DisplayOrder: 2},
	}}}

	rec := httptest.NewRecorder()
	srv.ListProducts(rec, httptest.NewRequest(http.MethodGet, "/api/v1/products", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q, want application/json", ct)
	}
	var got []api.Product
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].Slug != "a" || got[1].Slug != "b" {
		t.Errorf("slugs = %q,%q, want a,b", got[0].Slug, got[1].Slug)
	}
	if got[0].Price != 100000 {
		t.Errorf("price = %d, want 100000", got[0].Price)
	}
}

// TestListProductsEmpty: store rỗng → 200 với mảng JSON rỗng "[]", không "null".
func TestListProductsEmpty(t *testing.T) {
	srv := &Server{products: fakeProductLister{rows: nil}}
	rec := httptest.NewRecorder()
	srv.ListProducts(rec, httptest.NewRequest(http.MethodGet, "/api/v1/products", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "[]\n" {
		t.Errorf("body = %q, want %q (mảng rỗng, không null)", body, "[]\n")
	}
}

// TestListProductsStoreError: store trả lỗi → 500 JSON {error} không leak internal.
func TestListProductsStoreError(t *testing.T) {
	srv := &Server{products: fakeProductLister{err: errors.New("db down: connection refused at 10.0.0.1")}}
	rec := httptest.NewRecorder()
	srv.ListProducts(rec, httptest.NewRequest(http.MethodGet, "/api/v1/products", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q, want application/json", ct)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if body["error"] != "không lấy được danh sách sản phẩm" {
		t.Fatalf("error = %q, want thông điệp an toàn không leak", body["error"])
	}
}
