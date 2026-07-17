// Command server là entrypoint HTTP API của Mooni Cake.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moonie/api/internal/config"
	"github.com/moonie/api/internal/db"
	"github.com/moonie/api/internal/httpx"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Bắt tín hiệu dừng để graceful shutdown; ctx này sống suốt vòng đời server.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Khởi tạo pool có timeout để không treo vô hạn khi Postgres chậm/không có.
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	pool, err := db.NewPool(dialCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newRouter(pool),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Chạy server trong goroutine để main có thể chờ tín hiệu dừng.
	errCh := make(chan error, 1)
	go func() {
		log.Printf("server: nghe tại :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Print("server: nhận tín hiệu dừng, đang shutdown")
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return nil
	}
}

// newRouter dựng chi router với middleware và các route. Tách riêng để test được.
// pool có thể nil trong test không cần DB (healthz không chạm DB).
func newRouter(_ *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Lỗi mặc định của chi là text/plain; ép về JSON {error} chuẩn (NFR-006).
	r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteError(w, http.StatusNotFound, "không tìm thấy")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "phương thức không được hỗ trợ")
	})

	r.Get("/api/v1/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	return r
}
