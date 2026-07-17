package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/store"
)

// maxUploadBytes giới hạn kích thước ảnh sản phẩm upload (5MB) — chống payload rác
// và DoS bộ nhớ (REQ-PROD-003).
const maxUploadBytes = 5 << 20

// pgUniqueViolation là mã lỗi Postgres cho vi phạm ràng buộc UNIQUE (slug trùng).
const pgUniqueViolation = "23505"

// productAdminStore là phần store mà handler admin sản phẩm cần. Tách qua interface
// để inject fake trong test (không cần Postgres cho handler test).
type productAdminStore interface {
	ListAllProducts(ctx context.Context) ([]store.Product, error)
	GetProductByID(ctx context.Context, id pgtype.UUID) (store.Product, error)
	CreateProduct(ctx context.Context, arg store.CreateProductParams) (store.Product, error)
	UpdateProduct(ctx context.Context, arg store.UpdateProductParams) (store.Product, error)
	DeleteProduct(ctx context.Context, id pgtype.UUID) error
	UpdateProductImage(ctx context.Context, arg store.UpdateProductImageParams) error
}

// validProductTypes/validProductStatuses khớp ràng buộc CHECK trong DB
// (0002_products). Validate ở handler để trả 400 thân thiện thay vì 500 từ DB.
var validProductTypes = map[string]bool{"gift_box": true, "single_cake": true}
var validProductStatuses = map[string]bool{"available": true, "sold_out": true, "hidden": true}

// ListAdminProducts phục vụ GET /api/v1/admin/products → 200 JSON array TẤT CẢ sản
// phẩm kể cả hidden, thứ tự tất định (REQ-PROD-002). Cần auth (middleware gác).
func (s *Server) ListAdminProducts(w http.ResponseWriter, r *http.Request) {
	rows, err := s.productAdmin.ListAllProducts(r.Context())
	if err != nil {
		log.Printf("list admin products: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách sản phẩm")
		return
	}
	products := make([]api.Product, 0, len(rows))
	for _, row := range rows {
		products = append(products, toAPIProduct(row))
	}
	httpx.WriteJSON(w, http.StatusOK, products)
}

// CreateProduct phục vụ POST /api/v1/admin/products: validate + tạo sản phẩm; slug
// trùng → 409 (REQ-PROD-002).
func (s *Server) CreateProduct(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeProductInput(w, r)
	if !ok {
		return
	}
	if msg, ok := validateProductInput(in); !ok {
		httpx.WriteError(w, http.StatusBadRequest, msg)
		return
	}

	row, err := s.productAdmin.CreateProduct(r.Context(), store.CreateProductParams{
		Slug:           strings.TrimSpace(in.Slug),
		Name:           strings.TrimSpace(in.Name),
		Description:    in.Description,
		Price:          in.Price,
		Type:           in.Type,
		Status:         in.Status,
		ImageUrl:       in.ImageUrl,
		DisplayOrder:   displayOrderOrZero(in.DisplayOrder),
		Badge:          in.Badge,
		CompareAtPrice: in.CompareAtPrice,
		Subtitle:       in.Subtitle,
	})
	if err != nil {
		if isUniqueViolation(err) {
			httpx.WriteError(w, http.StatusConflict, "slug đã tồn tại, vui lòng chọn slug khác")
			return
		}
		log.Printf("create product: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không tạo được sản phẩm, vui lòng thử lại")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toAPIProduct(row))
}

// UpdateProduct phục vụ PUT /api/v1/admin/products/{id}: validate + cập nhật; không
// tìm thấy → 404, slug trùng → 409 (REQ-PROD-002).
func (s *Server) UpdateProduct(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	in, ok := decodeProductInput(w, r)
	if !ok {
		return
	}
	if msg, ok := validateProductInput(in); !ok {
		httpx.WriteError(w, http.StatusBadRequest, msg)
		return
	}

	row, err := s.productAdmin.UpdateProduct(r.Context(), store.UpdateProductParams{
		ID:             pgUUID(id),
		Slug:           strings.TrimSpace(in.Slug),
		Name:           strings.TrimSpace(in.Name),
		Description:    in.Description,
		Price:          in.Price,
		Type:           in.Type,
		Status:         in.Status,
		ImageUrl:       in.ImageUrl,
		DisplayOrder:   displayOrderOrZero(in.DisplayOrder),
		Badge:          in.Badge,
		CompareAtPrice: in.CompareAtPrice,
		Subtitle:       in.Subtitle,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy sản phẩm")
			return
		}
		if isUniqueViolation(err) {
			httpx.WriteError(w, http.StatusConflict, "slug đã tồn tại, vui lòng chọn slug khác")
			return
		}
		log.Printf("update product: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không cập nhật được sản phẩm, vui lòng thử lại")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAPIProduct(row))
}

// DeleteProduct phục vụ DELETE /api/v1/admin/products/{id}: xóa MỀM (status='hidden')
// để bảo toàn tham chiếu order_items (REQ-PROD-002). Không tìm thấy → 404.
func (s *Server) DeleteProduct(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	pid := pgUUID(id)
	if _, err := s.productAdmin.GetProductByID(r.Context(), pid); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy sản phẩm")
			return
		}
		log.Printf("delete product (get): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không xóa được sản phẩm, vui lòng thử lại")
		return
	}
	if err := s.productAdmin.DeleteProduct(r.Context(), pid); err != nil {
		log.Printf("delete product: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không xóa được sản phẩm, vui lòng thử lại")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UploadProductImage phục vụ POST /api/v1/admin/products/{id}/image: nhận file ảnh
// (multipart, field "file"), validate loại + kích thước, lưu vào uploads/ với tên
// <uuid>.<ext>, đặt image_url = "/uploads/<file>" (REQ-PROD-003).
func (s *Server) UploadProductImage(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	pid := pgUUID(id)
	if _, err := s.productAdmin.GetProductByID(r.Context(), pid); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy sản phẩm")
			return
		}
		log.Printf("upload image (get product): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không tải ảnh lên được, vui lòng thử lại")
		return
	}

	// Giới hạn body trước khi parse để chặn payload khổng lồ (thêm 1MB đệm cho
	// phần bao multipart ngoài file).
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "không đọc được dữ liệu upload (có thể ảnh quá lớn, tối đa 5MB)")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "thiếu file ảnh (field 'file')")
		return
	}
	defer func() { _ = file.Close() }()

	// Đọc tối đa maxUploadBytes+1 để phát hiện file vượt ngưỡng.
	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "không đọc được file ảnh")
		return
	}
	if len(data) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "file ảnh rỗng")
		return
	}
	if len(data) > maxUploadBytes {
		httpx.WriteError(w, http.StatusBadRequest, "ảnh quá lớn, tối đa 5MB")
		return
	}

	// Nhận diện loại thật qua nội dung (không tin extension/Content-Type client
	// gửi) — chỉ chấp nhận png/jpeg/webp.
	ext := imageExtFor(http.DetectContentType(data))
	if ext == "" {
		httpx.WriteError(w, http.StatusBadRequest, "chỉ chấp nhận ảnh PNG, JPEG hoặc WebP")
		return
	}

	if err := os.MkdirAll(s.uploadsDir, 0o755); err != nil {
		log.Printf("upload image (mkdir): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lưu được ảnh, vui lòng thử lại")
		return
	}
	filename := uuid.NewString() + ext
	dst := filepath.Join(s.uploadsDir, filename)
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		log.Printf("upload image (write): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lưu được ảnh, vui lòng thử lại")
		return
	}

	imageURL := "/uploads/" + filename
	if err := s.productAdmin.UpdateProductImage(r.Context(), store.UpdateProductImageParams{
		ID:       pid,
		ImageUrl: &imageURL,
	}); err != nil {
		// Ảnh đã ghi nhưng cập nhật DB lỗi → dọn file để không rác.
		_ = os.Remove(dst)
		log.Printf("upload image (update db): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không cập nhật được ảnh sản phẩm, vui lòng thử lại")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, api.ImageUploadResult{ImageUrl: imageURL})
}

// decodeProductInput giải mã body JSON thành api.ProductInput; lỗi → ghi 400 và trả
// ok=false (caller dừng).
func decodeProductInput(w http.ResponseWriter, r *http.Request) (api.ProductInput, bool) {
	var in api.ProductInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	if err := dec.Decode(&in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "dữ liệu gửi lên không hợp lệ")
		return api.ProductInput{}, false
	}
	return in, true
}

// validateProductInput kiểm tra các ràng buộc nghiệp vụ (REQ-PROD-002, NFR-004).
// Trả (thông điệp, false) khi không hợp lệ.
func validateProductInput(in api.ProductInput) (string, bool) {
	if strings.TrimSpace(in.Name) == "" {
		return "vui lòng nhập tên sản phẩm", false
	}
	if strings.TrimSpace(in.Slug) == "" {
		return "vui lòng nhập slug", false
	}
	if in.Price < 0 {
		return "giá không được âm", false
	}
	if !validProductTypes[in.Type] {
		return "loại sản phẩm không hợp lệ (gift_box hoặc single_cake)", false
	}
	if !validProductStatuses[in.Status] {
		return "trạng thái không hợp lệ (available, sold_out hoặc hidden)", false
	}
	if in.CompareAtPrice != nil && *in.CompareAtPrice < 0 {
		return "giá so sánh không được âm", false
	}
	return "", true
}

// imageExtFor map content-type ảnh được phép → đuôi file. "" nếu loại không hỗ trợ.
func imageExtFor(contentType string) string {
	switch contentType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

// displayOrderOrZero trả *int (nullable từ API) về int32 cho DB; nil → 0.
func displayOrderOrZero(p *int) int32 {
	if p == nil {
		return 0
	}
	return int32(*p)
}

// pgUUID chuyển openapi_types.UUID (google/uuid) → pgtype.UUID hợp lệ.
func pgUUID(id openapi_types.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte(id), Valid: true}
}

// isUniqueViolation cho biết err là vi phạm ràng buộc UNIQUE của Postgres (slug trùng).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation
}
