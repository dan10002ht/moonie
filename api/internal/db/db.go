// Package db khởi tạo connection pool tới PostgreSQL qua pgxpool.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool tạo pgxpool.Pool từ connection URL và ping để xác nhận kết nối.
// Caller chịu trách nhiệm gọi pool.Close().
func NewPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("db: tạo pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}
