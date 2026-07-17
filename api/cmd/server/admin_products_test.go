package main

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/notify"
	"github.com/moonie/api/internal/store"
)

// fakeProductAdmin là productAdminStore giả cho handler test (không cần DB).
type fakeProductAdmin struct {
	all        []store.Product
	getErr     error
	getProduct store.Product
	createErr  error
	created    store.CreateProductParams
	updateErr  error
	updated    store.UpdateProductParams
	deleteErr  error
	deletedID  pgtype.UUID
	deleteCall bool
	imgErr     error
	imgParams  store.UpdateProductImageParams
	imgCall    bool
}

func (f *fakeProductAdmin) ListAllProducts(context.Context) ([]store.Product, error) {
	return f.all, nil
}

func (f *fakeProductAdmin) GetProductByID(context.Context, pgtype.UUID) (store.Product, error) {
	return f.getProduct, f.getErr
}

func (f *fakeProductAdmin) CreateProduct(_ context.Context, arg store.CreateProductParams) (store.Product, error) {
	f.created = arg
	if f.createErr != nil {
		return store.Product{}, f.createErr
	}
	return store.Product{
		ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Slug: arg.Slug, Name: arg.Name,
		Price: arg.Price, Type: arg.Type, Status: arg.Status, DisplayOrder: arg.DisplayOrder,
	}, nil
}

func (f *fakeProductAdmin) UpdateProduct(_ context.Context, arg store.UpdateProductParams) (store.Product, error) {
	f.updated = arg
	if f.updateErr != nil {
		return store.Product{}, f.updateErr
	}
	return store.Product{ID: arg.ID, Slug: arg.Slug, Name: arg.Name, Price: arg.Price, Type: arg.Type, Status: arg.Status}, nil
}

func (f *fakeProductAdmin) DeleteProduct(_ context.Context, id pgtype.UUID) error {
	f.deleteCall = true
	f.deletedID = id
	return f.deleteErr
}

func (f *fakeProductAdmin) UpdateProductImage(_ context.Context, arg store.UpdateProductImageParams) error {
	f.imgCall = true
	f.imgParams = arg
	return f.imgErr
}

func uniqueViolationErr() error {
	return &pgconn.PgError{Code: pgUniqueViolation, Message: "duplicate key"}
}

// TestListAdminProductsIncludesHidden: list admin trả CẢ sản phẩm hidden.
func TestListAdminProductsIncludesHidden(t *testing.T) {
	f := &fakeProductAdmin{all: []store.Product{
		{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Slug: "a", Name: "A", Type: "gift_box", Status: "available", DisplayOrder: 1},
		{ID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, Slug: "b", Name: "B", Type: "single_cake", Status: "hidden", DisplayOrder: 2},
	}}
	srv := &Server{productAdmin: f}
	rec := httptest.NewRecorder()
	srv.ListAdminProducts(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/products", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got []api.Product
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2 (gồm hidden)", len(got))
	}
	var hasHidden bool
	for _, p := range got {
		if p.Status == api.Hidden {
			hasHidden = true
		}
	}
	if !hasHidden {
		t.Error("list admin phải chứa sản phẩm status=hidden")
	}
}

// TestCreateProductValid: body hợp lệ → 201 + gọi CreateProduct đúng field.
func TestCreateProductValid(t *testing.T) {
	f := &fakeProductAdmin{}
	srv := &Server{productAdmin: f}
	body := `{"slug":"hop-vang","name":"Hộp Vàng","price":890000,"type":"gift_box","status":"available","display_order":3}`
	rec := httptest.NewRecorder()
	srv.CreateProduct(rec, httptest.NewRequest(http.MethodPost, "/api/v1/admin/products", strings.NewReader(body)))

	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	if f.created.Slug != "hop-vang" || f.created.Price != 890000 || f.created.DisplayOrder != 3 {
		t.Errorf("created = %+v, không khớp input", f.created)
	}
}

// TestCreateProductValidation: các input sai → 400.
func TestCreateProductValidation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"tên rỗng", `{"slug":"s","name":"  ","price":1,"type":"gift_box","status":"available"}`},
		{"slug rỗng", `{"slug":"","name":"A","price":1,"type":"gift_box","status":"available"}`},
		{"giá âm", `{"slug":"s","name":"A","price":-5,"type":"gift_box","status":"available"}`},
		{"type sai", `{"slug":"s","name":"A","price":1,"type":"cookie","status":"available"}`},
		{"status sai", `{"slug":"s","name":"A","price":1,"type":"gift_box","status":"deleted"}`},
		{"slug có ký tự lạ", `{"slug":"bad/slug","name":"A","price":1,"type":"gift_box","status":"available"}`},
		{"slug hoa/khoảng trắng", `{"slug":"Bad Slug","name":"A","price":1,"type":"gift_box","status":"available"}`},
		{"slug traversal", `{"slug":"../x","name":"A","price":1,"type":"gift_box","status":"available"}`},
		{"display_order tràn int32", `{"slug":"s","name":"A","price":1,"type":"gift_box","status":"available","display_order":9999999999}`},
		{"display_order âm", `{"slug":"s","name":"A","price":1,"type":"gift_box","status":"available","display_order":-1}`},
		{"image_url javascript", `{"slug":"s","name":"A","price":1,"type":"gift_box","status":"available","image_url":"javascript:alert(1)"}`},
		{"image_url data uri", `{"slug":"s","name":"A","price":1,"type":"gift_box","status":"available","image_url":"data:text/html,<script>1</script>"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := &Server{productAdmin: &fakeProductAdmin{}}
			rec := httptest.NewRecorder()
			srv.CreateProduct(rec, httptest.NewRequest(http.MethodPost, "/api/v1/admin/products", strings.NewReader(tt.body)))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400", rec.Code)
			}
		})
	}
}

// TestCreateProductAcceptsValidImageURLs: image_url /uploads/... và http(s) hợp lệ → 201.
func TestCreateProductAcceptsValidImageURLs(t *testing.T) {
	for _, img := range []string{"/uploads/abc.png", "https://cdn.mooni.test/x.jpg", "http://example.com/y.webp"} {
		t.Run(img, func(t *testing.T) {
			srv := &Server{productAdmin: &fakeProductAdmin{}}
			body := `{"slug":"ok-slug","name":"A","price":1,"type":"gift_box","status":"available","image_url":"` + img + `"}`
			rec := httptest.NewRecorder()
			srv.CreateProduct(rec, httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body)))
			if rec.Code != http.StatusCreated {
				t.Fatalf("code = %d, want 201 (body=%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestUploadsStaticServe: qua router thật — GET file có → 200 + nosniff header;
// GET thư mục /uploads/ → 404 (directory listing bị tắt).
func TestUploadsStaticServe(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "img.png"), pngBytes(), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	handler := newRouter(nil, notify.NoopNotifier{}, []byte("test-secret-32-bytes-minimum-000"), false, dir)

	t.Run("file cụ thể → 200 + nosniff", func(t *testing.T) {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/uploads/img.png", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("code = %d, want 200", rec.Code)
		}
		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
		}
	})

	t.Run("thư mục /uploads/ → 404 (không listing)", func(t *testing.T) {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/uploads/", nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("code = %d, want 404 (directory listing phải bị tắt)", rec.Code)
		}
	})
}

// TestCreateProductSlugConflict: slug trùng (unique violation) → 409.
func TestCreateProductSlugConflict(t *testing.T) {
	f := &fakeProductAdmin{createErr: uniqueViolationErr()}
	srv := &Server{productAdmin: f}
	body := `{"slug":"trung","name":"A","price":1,"type":"gift_box","status":"available"}`
	rec := httptest.NewRecorder()
	srv.CreateProduct(rec, httptest.NewRequest(http.MethodPost, "/api/v1/admin/products", strings.NewReader(body)))
	if rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
}

// TestUpdateProductValid: cập nhật hợp lệ → 200.
func TestUpdateProductValid(t *testing.T) {
	f := &fakeProductAdmin{}
	srv := &Server{productAdmin: f}
	id := openapi_types.UUID(uuid.New())
	body := `{"slug":"moi","name":"Mới","price":100,"type":"single_cake","status":"sold_out"}`
	rec := httptest.NewRecorder()
	srv.UpdateProduct(rec, httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(body)), id)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if f.updated.Slug != "moi" || f.updated.Status != "sold_out" {
		t.Errorf("updated = %+v không khớp", f.updated)
	}
}

// TestUpdateProductNotFound: id không tồn tại → 404.
func TestUpdateProductNotFound(t *testing.T) {
	f := &fakeProductAdmin{updateErr: pgx.ErrNoRows}
	srv := &Server{productAdmin: f}
	body := `{"slug":"x","name":"X","price":1,"type":"gift_box","status":"available"}`
	rec := httptest.NewRecorder()
	srv.UpdateProduct(rec, httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(body)), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

// TestDeleteProductSoftHides: DELETE tồn tại → 204 + gọi DeleteProduct (xóa mềm).
func TestDeleteProductSoftHides(t *testing.T) {
	f := &fakeProductAdmin{getProduct: store.Product{Slug: "a", Status: "available"}}
	srv := &Server{productAdmin: f}
	rec := httptest.NewRecorder()
	srv.DeleteProduct(rec, httptest.NewRequest(http.MethodDelete, "/x", nil), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("code = %d, want 204", rec.Code)
	}
	if !f.deleteCall {
		t.Error("phải gọi DeleteProduct (xóa mềm → hidden)")
	}
}

// TestDeleteProductNotFound: id không tồn tại → 404.
func TestDeleteProductNotFound(t *testing.T) {
	f := &fakeProductAdmin{getErr: pgx.ErrNoRows}
	srv := &Server{productAdmin: f}
	rec := httptest.NewRecorder()
	srv.DeleteProduct(rec, httptest.NewRequest(http.MethodDelete, "/x", nil), openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	if f.deleteCall {
		t.Error("không được gọi DeleteProduct khi sản phẩm không tồn tại")
	}
}

// pngBytes trả một PNG hợp lệ tối thiểu (chữ ký + đủ để DetectContentType nhận diện).
func pngBytes() []byte {
	sig := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	return append(sig, bytes.Repeat([]byte{0x00, 0x01, 0x02, 0x03}, 16)...)
}

// multipartImage dựng body multipart với 1 field file mang data.
func multipartImage(t *testing.T, field, filename string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(data); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, mw.FormDataContentType()
}

// TestUploadProductImagePNG: upload PNG (field "file") → 200, lưu file, set image_url.
func TestUploadProductImagePNG(t *testing.T) {
	dir := t.TempDir()
	f := &fakeProductAdmin{getProduct: store.Product{Slug: "a"}}
	srv := &Server{productAdmin: f, uploadsDir: dir}

	body, ct := multipartImage(t, "file", "banh.png", pngBytes())
	req := httptest.NewRequest(http.MethodPost, "/x", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	srv.UploadProductImage(rec, req, openapi_types.UUID(uuid.New()))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var res api.ImageUploadResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !strings.HasPrefix(res.ImageUrl, "/uploads/") || !strings.HasSuffix(res.ImageUrl, ".png") {
		t.Errorf("image_url = %q, want /uploads/<uuid>.png", res.ImageUrl)
	}
	if !f.imgCall || f.imgParams.ImageUrl == nil || *f.imgParams.ImageUrl != res.ImageUrl {
		t.Errorf("UpdateProductImage không được gọi đúng: call=%v params=%+v", f.imgCall, f.imgParams)
	}
	// File thật phải tồn tại trên đĩa.
	saved := filepath.Join(dir, strings.TrimPrefix(res.ImageUrl, "/uploads/"))
	if _, err := os.Stat(saved); err != nil {
		t.Errorf("file ảnh không được lưu: %v", err)
	}
}

// TestUploadProductImageRejectNonImage: file không phải ảnh → 400, không lưu, không update.
func TestUploadProductImageRejectNonImage(t *testing.T) {
	dir := t.TempDir()
	f := &fakeProductAdmin{getProduct: store.Product{Slug: "a"}}
	srv := &Server{productAdmin: f, uploadsDir: dir}

	body, ct := multipartImage(t, "file", "evil.png", []byte("#!/bin/sh\necho pwned\n"))
	req := httptest.NewRequest(http.MethodPost, "/x", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	srv.UploadProductImage(rec, req, openapi_types.UUID(uuid.New()))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 (non-image)", rec.Code)
	}
	if f.imgCall {
		t.Error("không được cập nhật image_url khi file không hợp lệ")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("không được lưu file khi reject, thấy %d file", len(entries))
	}
}

// TestUploadProductImageMissingFile: thiếu field "file" → 400.
func TestUploadProductImageMissingFile(t *testing.T) {
	dir := t.TempDir()
	f := &fakeProductAdmin{getProduct: store.Product{Slug: "a"}}
	srv := &Server{productAdmin: f, uploadsDir: dir}

	body, ct := multipartImage(t, "wrongfield", "x.png", pngBytes())
	req := httptest.NewRequest(http.MethodPost, "/x", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	srv.UploadProductImage(rec, req, openapi_types.UUID(uuid.New()))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400 (thiếu file)", rec.Code)
	}
}

// TestUploadProductImageProductNotFound: id không tồn tại → 404.
func TestUploadProductImageProductNotFound(t *testing.T) {
	f := &fakeProductAdmin{getErr: pgx.ErrNoRows}
	srv := &Server{productAdmin: f, uploadsDir: t.TempDir()}
	body, ct := multipartImage(t, "file", "x.png", pngBytes())
	req := httptest.NewRequest(http.MethodPost, "/x", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	srv.UploadProductImage(rec, req, openapi_types.UUID(uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

// TestAdminProductsRequireAuth: mọi route /admin/products KHÔNG cookie → 401
// (middleware auth gác, chưa chạm handler/store).
func TestAdminProductsRequireAuth(t *testing.T) {
	handler := newRouter(nil, notify.NoopNotifier{}, []byte("test-secret-32-bytes-minimum-000"), false, t.TempDir())
	routes := []struct {
		method, path string
	}{
		{http.MethodGet, "/api/v1/admin/products"},
		{http.MethodPost, "/api/v1/admin/products"},
		{http.MethodPut, "/api/v1/admin/products/" + uuid.NewString()},
		{http.MethodDelete, "/api/v1/admin/products/" + uuid.NewString()},
		{http.MethodPost, "/api/v1/admin/products/" + uuid.NewString() + "/image"},
	}
	for _, rt := range routes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(rt.method, rt.path, nil))
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("code = %d, want 401 (không cookie)", rec.Code)
			}
		})
	}
}
