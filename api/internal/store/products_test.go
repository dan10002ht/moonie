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
