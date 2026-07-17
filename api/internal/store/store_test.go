// Integration test cho package store: chạy Postgres THẬT qua testcontainers-go
// (NFR-004, pipeline test mục 3 — không mock DB). Test spin container postgres:16-alpine,
// áp migration, rồi round-trip CreateAdminUser → GetAdminUserByEmail.
package store_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/moonie/api/internal/store"
)

// newTestDB spin một Postgres:16-alpine ephemeral, áp migration trong ../../migrations,
// và trả về pool sẵn sàng dùng. Container tự hủy qua t.Cleanup.
func newTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()

	container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("mooni"),
		tcpostgres.WithUsername("mooni"),
		tcpostgres.WithPassword("mooni"),
		// Chờ ROBUST: Postgres init mở port RỒI restart trong lúc khởi tạo, nên
		// ForListeningPort báo sẵn sàng quá sớm → migrate dính "connection refused"
		// khi spin nhiều container dưới tải Colima. Postgres log dòng "ready to accept
		// connections" 2 lần (init tạm + ready thật) — chờ occurrence 2 mới chắc chắn
		// nhận được kết nối SQL.
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("spin postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Logf("terminate container: %v", err)
		}
	})

	url, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	// golang-migrate cần scheme pgx5:// cho driver pgx v5.
	migrateURL := strings.Replace(url, "postgres://", "pgx5://", 1)
	m, err := migrate.New("file://../../migrations", migrateURL)
	if err != nil {
		t.Fatalf("khởi tạo migrate: %v", err)
	}
	if err := m.Up(); err != nil {
		t.Fatalf("chạy migration: %v", err)
	}
	srcErr, dbErr := m.Close()
	if srcErr != nil || dbErr != nil {
		t.Fatalf("đóng migrate: src=%v db=%v", srcErr, dbErr)
	}

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("tạo pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestAdminUserRoundTrip(t *testing.T) {
	pool := newTestDB(t)
	q := store.New(pool)
	ctx := context.Background()

	name := "Quản trị viên"
	tests := []struct {
		name string
		arg  store.CreateAdminUserParams
	}{
		{
			name: "có name và role mặc định",
			arg: store.CreateAdminUserParams{
				Email:        "admin@mooni.test",
				PasswordHash: "$2a$10$hashgiadinh",
				Name:         &name,
				Role:         "admin",
			},
		},
		{
			name: "không có name",
			arg: store.CreateAdminUserParams{
				Email:        "owner@mooni.test",
				PasswordHash: "$2a$10$hashkhac",
				Name:         nil,
				Role:         "owner",
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			created, err := q.CreateAdminUser(ctx, tc.arg)
			if err != nil {
				t.Fatalf("CreateAdminUser: %v", err)
			}
			if created.Email != tc.arg.Email {
				t.Errorf("created email = %q, want %q", created.Email, tc.arg.Email)
			}
			if !created.ID.Valid {
				t.Error("created ID không hợp lệ (mong đợi uuid sinh tự động)")
			}

			got, err := q.GetAdminUserByEmail(ctx, tc.arg.Email)
			if err != nil {
				t.Fatalf("GetAdminUserByEmail: %v", err)
			}
			if got.Email != tc.arg.Email {
				t.Errorf("got email = %q, want %q", got.Email, tc.arg.Email)
			}
			if got.PasswordHash != tc.arg.PasswordHash {
				t.Errorf("got password_hash = %q, want %q", got.PasswordHash, tc.arg.PasswordHash)
			}
			if got.Role != tc.arg.Role {
				t.Errorf("got role = %q, want %q", got.Role, tc.arg.Role)
			}
			if got.ID != created.ID {
				t.Errorf("got ID = %v, want %v", got.ID, created.ID)
			}
		})
	}
}
