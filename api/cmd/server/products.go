package main

import (
	"context"
	"log"
	"net/http"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/store"
)

// productLister là phần store mà handler sản phẩm cần. Tách qua interface để
// inject fake trong test (không cần Postgres cho handler test).
type productLister interface {
	ListVisibleProducts(ctx context.Context) ([]store.Product, error)
}

// ListProducts phục vụ GET /api/v1/products → 200 JSON array các sản phẩm đang
// hiển thị (ẩn status='hidden'), sắp theo display_order (REQ-PROD-001). Public.
func (s *Server) ListProducts(w http.ResponseWriter, r *http.Request) {
	rows, err := s.products.ListVisibleProducts(r.Context())
	if err != nil {
		log.Printf("list products: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách sản phẩm")
		return
	}

	// Luôn trả mảng (không null) kể cả khi rỗng để client web dễ xử lý.
	products := make([]api.Product, 0, len(rows))
	for _, row := range rows {
		products = append(products, toAPIProduct(row))
	}

	httpx.WriteJSON(w, http.StatusOK, products)
}

// toAPIProduct map một hàng store.Product → api.Product (hợp đồng OpenAPI).
func toAPIProduct(row store.Product) api.Product {
	return api.Product{
		Id:           openapi_types.UUID(row.ID.Bytes),
		Slug:         row.Slug,
		Name:         row.Name,
		Description:  row.Description,
		Price:        row.Price,
		Type:         api.ProductType(row.Type),
		Status:       api.ProductStatus(row.Status),
		ImageUrl:     row.ImageUrl,
		DisplayOrder: int(row.DisplayOrder),
	}
}
