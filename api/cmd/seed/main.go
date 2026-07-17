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
	"strings"

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
	// minProdPasswordLen là độ dài tối thiểu của SEED_ADMIN_PASSWORD khi seed
	// production — chặn mật khẩu quá yếu cho tài khoản admin trên môi trường thật.
	minProdPasswordLen = 12
)

// resolveSeedPassword tính password admin hiệu dụng và CHẶN mật khẩu không an toàn
// khi seed production (APP_ENV == "production"):
//   - password hiệu dụng == default ("mooni-admin") → từ chối (buộc đặt SEED_ADMIN_PASSWORD mạnh).
//   - password ngắn hơn minProdPasswordLen → từ chối.
//
// APP_ENV khác production → giữ nguyên hành vi cũ (cho phép default cho dev/test).
// Trả error mô tả rõ (KHÔNG in password) để caller exit non-zero TRƯỚC khi chạm DB.
func resolveSeedPassword(appEnv, envPassword string) (string, error) {
	password := defaultAdminPassword
	if envPassword != "" {
		password = envPassword
	}
	// So khớp production KHÔNG phân biệt hoa/thường + trim: "Production"/" PRODUCTION "
	// vẫn kích guard, tránh footgun lệch case khiến mật khẩu mặc định lọt lên prod.
	if strings.EqualFold(strings.TrimSpace(appEnv), "production") {
		switch {
		case password == defaultAdminPassword:
			return "", fmt.Errorf("từ chối seed: đặt SEED_ADMIN_PASSWORD mạnh (≥%d ký tự) trước khi seed production — không dùng mật khẩu mặc định", minProdPasswordLen)
		case len(password) < minProdPasswordLen:
			return "", fmt.Errorf("từ chối seed: SEED_ADMIN_PASSWORD phải ≥%d ký tự khi seed production", minProdPasswordLen)
		}
	}
	return password, nil
}

// seedProduct là 1 sản phẩm mẫu. price là VND (bigint) — chỉ lưu nội bộ, landing
// không hiển thị. imageURL để rỗng (mockup dùng placeholder, ảnh thật thêm sau qua admin).
// badge là nhãn marketing ("Bán chạy" / "Mới") — rỗng nghĩa là không có (lưu NULL).
type seedProduct struct {
	slug        string
	name        string
	description string
	price       int64
	productType string
	status      string
	badge       string
	// subtitle: nhãn phân loại IN HOA trên tên (mockup). Rỗng = NULL.
	subtitle string
	// compareAtPrice: giá gốc để hiện giá gạch + % giảm. 0 = NULL (không KM).
	compareAtPrice int64
	displayOrder   int
}

// seedProducts: 3 gift_box + 4 single_cake, tên + mô tả + badge lấy nguyên văn từ mockup
// design/mooni-landing.html (section collection dòng ~161-213 + flavors dòng ~289-350).
// Mockup KHÔNG có bánh lẻ nào "hết hàng" → tất cả single_cake status available.
var seedProducts = []seedProduct{
	{
		slug:           "nguyet-quang-kim",
		name:           "Nguyệt Quang Kim",
		description:    "Hộp 6 bánh · Sen nhuyễn trứng muối, trà xanh, thập cẩm gà quay",
		price:          890000,
		productType:    "gift_box",
		status:         "available",
		badge:          "Bán chạy",          // mockup card 1 badge trái
		subtitle:       "Hộp thiếc cao cấp", // mockup kicker trên tên
		compareAtPrice: 1050000,             // mockup: giá gạch 1.050.000đ → -15%
		displayOrder:   1,
	},
	{
		slug:         "vong-nguyet",
		name:         "Vọng Nguyệt",
		description:  "Hộp 4 bánh · Trà xanh hạt sen, sen nhuyễn trứng muối",
		price:        620000,
		productType:  "gift_box",
		status:       "available",
		badge:        "Mới",                // mockup card 2 badge trái
		subtitle:     "Hộp giấy đặc tuyển", // mockup kicker
		displayOrder: 2,
	},
	{
		slug:         "tho-ngoc",
		name:         "Thỏ Ngọc",
		description:  "Hộp 2 bánh · Sen nhuyễn trứng muối — món quà nhỏ ấm áp",
		price:        360000,
		productType:  "gift_box",
		status:       "available",
		badge:        "Quà biếu", // mockup card 3 badge trái
		subtitle:     "Hộp mini", // mockup kicker
		displayOrder: 3,
	},
	{
		slug:         "thap-cam-ga-quay",
		name:         "Thập cẩm gà quay",
		description:  "Bánh nướng · 180g · Vị truyền thống, đậm đà",
		price:        95000,
		productType:  "single_cake",
		status:       "available",
		badge:        "Bán chạy",
		subtitle:     "Bánh nướng · 180g", // mockup kicker flavor
		displayOrder: 4,
	},
	{
		slug:         "sen-nhuyen-trung",
		name:         "Sen nhuyễn trứng",
		description:  "Bánh dẻo · 150g · Dẻo mịn, ngọt thanh",
		price:        80000,
		productType:  "single_cake",
		status:       "available",
		badge:        "",
		subtitle:     "Bánh dẻo · 150g",
		displayOrder: 5,
	},
	{
		slug:         "tra-xanh-hat-sen",
		name:         "Trà xanh hạt sen",
		description:  "Bánh nướng · 180g · Thơm trà, bùi hạt sen",
		price:        90000,
		productType:  "single_cake",
		status:       "available",
		badge:        "Mới",
		subtitle:     "Bánh nướng · 180g",
		displayOrder: 6,
	},
	{
		slug:         "dau-xanh-lava",
		name:         "Đậu xanh lava",
		description:  "Bánh dẻo · 150g · Nhân chảy, béo nhẹ",
		price:        85000,
		productType:  "single_cake",
		status:       "available",
		badge:        "",
		subtitle:     "Bánh dẻo · 150g",
		displayOrder: 7,
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

	// Chặn mật khẩu mặc định/yếu khi seed production TRƯỚC khi kết nối DB — không
	// tạo/ghi admin nếu bị từ chối.
	password, err := resolveSeedPassword(cfg.AppEnv, os.Getenv("SEED_ADMIN_PASSWORD"))
	if err != nil {
		return err
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

// seedProductRows upsert seedProducts vào bảng products. ON CONFLICT (slug) DO UPDATE
// làm lệnh idempotent VÀ sửa được row cũ (badge/status...) cho khớp mockup — chạy lại
// hội tụ cùng một trạng thái, không tạo trùng (slug có UNIQUE, xem 0002_products.up.sql).
// image_url KHÔNG bị ghi đè khi update (giữ ảnh admin đã upload). badge rỗng lưu NULL.
func seedProductRows(ctx context.Context, pool *pgxpool.Pool) error {
	for _, p := range seedProducts {
		// RETURNING (xmax = 0): true nếu là INSERT mới, false nếu UPDATE row có sẵn.
		var inserted bool
		err := pool.QueryRow(ctx,
			`INSERT INTO products (slug, name, description, price, type, status, image_url, badge, subtitle, compare_at_price, display_order)
			 VALUES ($1, $2, $3, $4, $5, $6, '', NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, 0), $10)
			 ON CONFLICT (slug) DO UPDATE SET
			     name             = EXCLUDED.name,
			     description      = EXCLUDED.description,
			     price            = EXCLUDED.price,
			     type             = EXCLUDED.type,
			     status           = EXCLUDED.status,
			     badge            = EXCLUDED.badge,
			     subtitle         = EXCLUDED.subtitle,
			     compare_at_price = EXCLUDED.compare_at_price,
			     display_order    = EXCLUDED.display_order,
			     updated_at       = now()
			 RETURNING (xmax = 0)`,
			p.slug, p.name, p.description, p.price, p.productType, p.status, p.badge, p.subtitle, p.compareAtPrice, p.displayOrder,
		).Scan(&inserted)
		if err != nil {
			return fmt.Errorf("seed product %q: %w", p.slug, err)
		}
		if inserted {
			log.Printf("seed: tạo sản phẩm %q (%s, %s, badge=%q)", p.slug, p.productType, p.status, p.badge)
		} else {
			log.Printf("seed: cập nhật sản phẩm %q (%s, %s, badge=%q) — idempotent upsert", p.slug, p.productType, p.status, p.badge)
		}
	}
	return nil
}
