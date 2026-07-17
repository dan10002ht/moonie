// Command migrate chạy các file migration trong api/migrations/ lên database
// trỏ bởi DATABASE_URL, dùng golang-migrate (NFR-004: schema versioned).
//
// Cách dùng:
//
//	go run ./cmd/migrate up     # áp mọi migration còn thiếu (mặc định)
//	go run ./cmd/migrate down   # rollback 1 bước
package main

import (
	"errors"
	"log"
	"os"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"

	"github.com/moonie/api/internal/config"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("migrate: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	direction := "up"
	if len(os.Args) > 1 {
		direction = os.Args[1]
	}

	// golang-migrate dùng scheme "pgx5://" cho driver pgx v5; DATABASE_URL trong
	// .env là "postgres://" nên đổi scheme cho khớp driver.
	dbURL := cfg.DatabaseURL
	for _, prefix := range []string{"postgres://", "postgresql://"} {
		if len(dbURL) >= len(prefix) && dbURL[:len(prefix)] == prefix {
			dbURL = "pgx5://" + dbURL[len(prefix):]
			break
		}
	}

	m, err := migrate.New("file://migrations", dbURL)
	if err != nil {
		return err
	}
	defer func() {
		if srcErr, dbErr := m.Close(); srcErr != nil || dbErr != nil {
			log.Printf("migrate: đóng tài nguyên: src=%v db=%v", srcErr, dbErr)
		}
	}()

	switch direction {
	case "up":
		err = m.Up()
	case "down":
		err = m.Steps(-1)
	default:
		return errors.New("hướng migration không hợp lệ (dùng 'up' hoặc 'down')")
	}
	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	log.Printf("migrate: %s hoàn tất", direction)
	return nil
}
