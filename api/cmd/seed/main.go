// Command seed nạp dữ liệu mẫu tối thiểu vào database (trỏ bởi DATABASE_URL) để
// mọi agent (generator + evaluator) có tài khoản admin đăng nhập khi chạy app.
//
// Idempotent: dùng INSERT ... ON CONFLICT (email) DO NOTHING nên chạy nhiều lần
// không tạo bản ghi trùng và không lỗi. Chạy SAU khi `make migrate`.
//
// Cách dùng:
//
//	make seed                                  # dùng .env, password mặc định
//	SEED_ADMIN_PASSWORD=xxx make seed          # đặt password admin khác
//
// Ngoài admin, seed còn nạp 6 sản phẩm mẫu khớp mockup landing (design/mooni-landing.html):
// 3 gift_box + 3 single_cake. Tên/mô tả lấy nguyên văn từ mockup; giá chỉ lưu nội bộ
// (landing KHÔNG hiển thị giá). Idempotent: ON CONFLICT (slug) DO NOTHING.
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/moonie/api/internal/config"
	"github.com/moonie/api/internal/db"
)

const (
	// seedAdminEmail là email tài khoản admin mặc định sau khi seed.
	seedAdminEmail = "admin@mooni.local"
	// seedAdminName hiển thị trong admin UI.
	seedAdminName = "Mooni Admin"
	// defaultAdminPassword dùng khi không set env SEED_ADMIN_PASSWORD.
	defaultAdminPassword = "mooni-admin"
)

// seedProduct là 1 sản phẩm mẫu. price là VND (bigint) — chỉ lưu nội bộ, landing
// không hiển thị. imageURL để rỗng (mockup dùng placeholder, ảnh thật thêm sau qua admin).
type seedProduct struct {
	slug         string
	name         string
	description  string
	price        int64
	productType  string
	status       string
	displayOrder int
}

// seedProducts: 3 gift_box + 3 single_cake, tên + mô tả lấy nguyên văn từ mockup
// design/mooni-landing.html (section collection + flavors). tra-xanh-hat-sen để sold_out
// theo mockup ("hết hàng").
var seedProducts = []seedProduct{
	{
		slug:         "nguyet-quang-kim",
		name:         "Nguyệt Quang Kim",
		description:  "Hộp 6 bánh · Sen nhuyễn trứng muối, trà xanh, thập cẩm gà quay",
		price:        890000,
		productType:  "gift_box",
		status:       "available",
		displayOrder: 1,
	},
	{
		slug:         "vong-nguyet",
		name:         "Vọng Nguyệt",
		description:  "Hộp 4 bánh · Trà xanh hạt sen, sen nhuyễn trứng muối",
		price:        620000,
		productType:  "gift_box",
		status:       "available",
		displayOrder: 2,
	},
	{
		slug:         "tho-ngoc",
		name:         "Thỏ Ngọc",
		description:  "Hộp 2 bánh · Sen nhuyễn trứng muối — món quà nhỏ ấm áp",
		price:        360000,
		productType:  "gift_box",
		status:       "available",
		displayOrder: 3,
	},
	{
		slug:         "thap-cam-ga-quay",
		name:         "Thập cẩm gà quay",
		description:  "Bánh nướng · 180g · Vị truyền thống, đậm đà",
		price:        95000,
		productType:  "single_cake",
		status:       "available",
		displayOrder: 4,
	},
	{
		slug:         "sen-nhuyen-trung",
		name:         "Sen nhuyễn trứng muối",
		description:  "Bánh dẻo · 150g · Dẻo mịn, ngọt thanh",
		price:        80000,
		productType:  "single_cake",
		status:       "available",
		displayOrder: 5,
	},
	{
		slug:         "tra-xanh-hat-sen",
		name:         "Trà xanh hạt sen",
		description:  "Bánh nướng · 180g · Thơm trà, bùi hạt sen",
		price:        90000,
		productType:  "single_cake",
		status:       "sold_out",
		displayOrder: 6,
	},
}

func main() {
	if err := run(); err != nil {
		log.Fatalf("seed: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	password := defaultAdminPassword
	if env := os.Getenv("SEED_ADMIN_PASSWORD"); env != "" {
		password = env
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	// ON CONFLICT (email) DO NOTHING làm lệnh idempotent: chạy lại không tạo trùng,
	// không lỗi. email có UNIQUE constraint (xem migrations/0001_init.up.sql).
	tag, err := pool.Exec(ctx,
		`INSERT INTO admin_users (email, password_hash, name, role)
		 VALUES ($1, $2, $3, 'admin')
		 ON CONFLICT (email) DO NOTHING`,
		seedAdminEmail, string(hash), seedAdminName,
	)
	if err != nil {
		return err
	}

	if tag.RowsAffected() == 0 {
		log.Printf("seed: admin %q đã tồn tại, bỏ qua (idempotent)", seedAdminEmail)
	} else {
		log.Printf("seed: tạo admin %q (password lấy từ SEED_ADMIN_PASSWORD hoặc mặc định)", seedAdminEmail)
	}

	if err := seedProductRows(ctx, pool); err != nil {
		return err
	}
	return nil
}

// seedProductRows nạp seedProducts vào bảng products. ON CONFLICT (slug) DO NOTHING
// làm lệnh idempotent — chạy lại không tạo trùng, không lỗi (slug có UNIQUE, xem
// migrations/0002_products.up.sql).
func seedProductRows(ctx context.Context, pool *pgxpool.Pool) error {
	for _, p := range seedProducts {
		tag, err := pool.Exec(ctx,
			`INSERT INTO products (slug, name, description, price, type, status, image_url, display_order)
			 VALUES ($1, $2, $3, $4, $5, $6, '', $7)
			 ON CONFLICT (slug) DO NOTHING`,
			p.slug, p.name, p.description, p.price, p.productType, p.status, p.displayOrder,
		)
		if err != nil {
			return fmt.Errorf("seed product %q: %w", p.slug, err)
		}
		if tag.RowsAffected() == 0 {
			log.Printf("seed: sản phẩm %q đã tồn tại, bỏ qua (idempotent)", p.slug)
		} else {
			log.Printf("seed: tạo sản phẩm %q (%s, %s)", p.slug, p.productType, p.status)
		}
	}
	return nil
}
