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
// Giai đoạn 1 mới có bảng admin_users nên seed chỉ tạo 1 admin. Sản phẩm/lead...
// thuộc giai đoạn sau (cần migration bảng tương ứng trước) — không seed ở đây.
package main

import (
	"context"
	"log"
	"os"

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
	return nil
}
