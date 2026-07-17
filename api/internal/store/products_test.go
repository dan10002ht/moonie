// Integration test cho ListVisibleProducts trên Postgres THẬT (testcontainers).
// Seed 3 sản phẩm (available, sold_out, hidden) → chỉ 2 sản phẩm không-hidden
// được trả, đúng thứ tự display_order (REQ-PROD-001).
package store_test

import (
	"context"
	"testing"

	"github.com/moonie/api/internal/store"
)

func TestListVisibleProducts(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	// Seed qua SQL thô: display_order cố tình đảo để kiểm thứ tự trả về.
	// 'available' order=2, 'sold_out' order=1, 'hidden' order=0.
	seed := []struct {
		slug         string
		name         string
		status       string
		typ          string
		displayOrder int
	}{
		{"hop-qua-thuong-hang", "Hộp quà thượng hạng", "available", "gift_box", 2},
		{"banh-don-le", "Bánh đơn lẻ", "sold_out", "single_cake", 1},
		{"hang-an", "Hàng ẩn", "hidden", "gift_box", 0},
	}
	for _, s := range seed {
		_, err := pool.Exec(ctx,
			`INSERT INTO products (slug, name, price, type, status, display_order)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			s.slug, s.name, int64(250000), s.typ, s.status, s.displayOrder)
		if err != nil {
			t.Fatalf("seed %s: %v", s.slug, err)
		}
	}

	got, err := q.ListVisibleProducts(ctx)
	if err != nil {
		t.Fatalf("ListVisibleProducts: %v", err)
	}

	// Ẩn 'hidden' → còn 2 sản phẩm.
	if len(got) != 2 {
		t.Fatalf("số sản phẩm = %d, mong đợi 2 (ẩn hidden)", len(got))
	}

	// Không được lẫn sản phẩm hidden.
	for _, p := range got {
		if p.Status == "hidden" {
			t.Errorf("sản phẩm hidden %q lọt vào kết quả", p.Slug)
		}
	}

	// Thứ tự theo display_order tăng dần: sold_out (order=1) trước available (order=2).
	wantOrder := []string{"banh-don-le", "hop-qua-thuong-hang"}
	for i, want := range wantOrder {
		if got[i].Slug != want {
			t.Errorf("vị trí %d = %q, mong đợi %q (sắp theo display_order)", i, got[i].Slug, want)
		}
	}

	// Kiểm price giữ đúng kiểu số nguyên.
	if got[0].Price != 250000 {
		t.Errorf("price = %d, mong đợi 250000", got[0].Price)
	}
}

// TestAdminProductCRUD round-trip các query admin trên Postgres THẬT: tạo → list
// (gồm hidden) → get → cập nhật → set ảnh → xóa mềm (REQ-PROD-002/003).
func TestAdminProductCRUD(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	// Tạo 1 sản phẩm available + 1 sản phẩm hidden.
	created, err := q.CreateProduct(ctx, store.CreateProductParams{
		Slug: "admin-hop-vang", Name: "Hộp Vàng", Price: 890000,
		Type: "gift_box", Status: "available", DisplayOrder: 1,
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	if _, err := q.CreateProduct(ctx, store.CreateProductParams{
		Slug: "admin-hang-an", Name: "Hàng ẩn", Price: 100000,
		Type: "single_cake", Status: "hidden", DisplayOrder: 2,
	}); err != nil {
		t.Fatalf("CreateProduct hidden: %v", err)
	}

	// ListAllProducts phải trả CẢ sản phẩm hidden.
	all, err := q.ListAllProducts(ctx)
	if err != nil {
		t.Fatalf("ListAllProducts: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("ListAllProducts len = %d, want 2 (gồm hidden)", len(all))
	}
	var sawHidden bool
	for _, p := range all {
		if p.Status == "hidden" {
			sawHidden = true
		}
	}
	if !sawHidden {
		t.Error("ListAllProducts phải chứa sản phẩm hidden")
	}

	// GetProductByID.
	got, err := q.GetProductByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetProductByID: %v", err)
	}
	if got.Slug != "admin-hop-vang" {
		t.Errorf("GetProductByID slug = %q", got.Slug)
	}

	// Slug trùng → lỗi unique (23505).
	if _, err := q.CreateProduct(ctx, store.CreateProductParams{
		Slug: "admin-hop-vang", Name: "Trùng", Price: 1, Type: "gift_box", Status: "available",
	}); err == nil {
		t.Error("CreateProduct slug trùng phải lỗi unique")
	}

	// UpdateProduct đổi tên + status.
	upd, err := q.UpdateProduct(ctx, store.UpdateProductParams{
		ID: created.ID, Slug: "admin-hop-vang", Name: "Hộp Vàng V2", Price: 950000,
		Type: "gift_box", Status: "sold_out", DisplayOrder: 5,
	})
	if err != nil {
		t.Fatalf("UpdateProduct: %v", err)
	}
	if upd.Name != "Hộp Vàng V2" || upd.Status != "sold_out" || upd.DisplayOrder != 5 {
		t.Errorf("UpdateProduct = %+v không khớp", upd)
	}

	// UpdateProductImage.
	img := "/uploads/test.png"
	if err := q.UpdateProductImage(ctx, store.UpdateProductImageParams{ID: created.ID, ImageUrl: &img}); err != nil {
		t.Fatalf("UpdateProductImage: %v", err)
	}
	got2, _ := q.GetProductByID(ctx, created.ID)
	if got2.ImageUrl == nil || *got2.ImageUrl != img {
		t.Errorf("image_url = %v, want %q", got2.ImageUrl, img)
	}

	// DeleteProduct = xóa MỀM (status='hidden').
	if err := q.DeleteProduct(ctx, created.ID); err != nil {
		t.Fatalf("DeleteProduct: %v", err)
	}
	got3, err := q.GetProductByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetProductByID sau delete: %v (bản ghi phải còn, chỉ ẩn)", err)
	}
	if got3.Status != "hidden" {
		t.Errorf("sau DeleteProduct status = %q, want hidden (xóa mềm)", got3.Status)
	}
}
