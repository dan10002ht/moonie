// Command server là entrypoint HTTP API của Mooni Cake.
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/config"
	"github.com/moonie/api/internal/db"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/notify"
	"github.com/moonie/api/internal/store"
)

// Server implement api.ServerInterface (sinh từ openapi.yaml). Dòng assertion
// dưới đây cưỡng chế mọi handler khớp hợp đồng lúc compile — lệch spec = fail build.
var _ api.ServerInterface = (*Server)(nil)

// Server gom các phụ thuộc handler cần (pool DB…) và implement ServerInterface.
// pool có thể nil trong test không cần DB (healthz không chạm DB). products là
// querier sản phẩm, tách qua interface để handler test được bằng fake (không DB).
type Server struct {
	pool     *pgxpool.Pool
	products productLister
	leads    leadCreator
	notifier notify.Notifier
}

// GetHealthz phục vụ GET /api/v1/healthz → 200 {"status":"ok"} (NFR-006).
func (*Server) GetHealthz(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, api.Health{Status: "ok"})
}

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
		Handler:           newRouter(pool, newNotifier(cfg)),
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
func newRouter(pool *pgxpool.Pool, notifier notify.Notifier) http.Handler {
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

	// Rate limit CHỈ cho POST /api/v1/leads (chống spam form) — không đụng
	// /healthz, /products (REQ-LEAD-001). Ngưỡng: leadsRateLimit req/phút/IP.
	r.Use(rateLimitPath(http.MethodPost, "/api/v1/leads", newLeadsRateLimiter()))

	// Mọi route đi qua handler sinh từ spec (HandlerFromMuxWithBaseURL) để lệch
	// spec = fail compile. Server url trong openapi.yaml là /api/v1 nên baseURL
	// khớp: path /healthz trong spec → phục vụ tại /api/v1/healthz.
	q := store.New(pool)
	srv := &Server{pool: pool, products: q, leads: q, notifier: notifier}
	api.HandlerFromMuxWithBaseURL(srv, r, "/api/v1")

	return r
}

// newNotifier chọn notifier theo env: có TELEGRAM_BOT_TOKEN → TelegramNotifier;
// thiếu token → NoopNotifier + cảnh báo. Thiếu token KHÔNG làm POST /leads fail
// (đặt hàng phải luôn thành công dù Telegram chưa cấu hình).
func newNotifier(cfg *config.Config) notify.Notifier {
	if cfg.TelegramBotToken == "" {
		log.Print("notify: thiếu TELEGRAM_BOT_TOKEN → dùng NoopNotifier (không gửi Telegram)")
		return notify.NoopNotifier{}
	}
	log.Print("notify: đã cấu hình Telegram Bot")
	return notify.NewTelegramNotifier(cfg.TelegramBotToken, cfg.TelegramChatID, cfg.TelegramAPIBase)
}

// leadsRateLimit là ngưỡng rate limit cho POST /leads: số request tối đa mỗi IP
// trong mỗi cửa sổ leadsRateWindow.
const (
	// 20/phút/IP: đủ cho khách doanh nghiệp sau 1 IP NAT chung (nhiều nhân viên
	// cùng hỏi hàng) mà vẫn chặn bot/abuse (20/phút rất thấp với bot).
	leadsRateLimit  = 20
	leadsRateWindow = time.Minute
)

// newLeadsRateLimiter tạo middleware httprate giới hạn theo IP, trả 429 JSON
// {error} khi vượt ngưỡng (NFR-006).
func newLeadsRateLimiter() func(http.Handler) http.Handler {
	return httprate.LimitBy(
		leadsRateLimit,
		leadsRateWindow,
		keyByRemoteIP,
		httprate.WithLimitHandler(func(w http.ResponseWriter, _ *http.Request) {
			httpx.WriteError(w, http.StatusTooManyRequests, "bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút")
		}),
	)
}

// keyByRemoteIP khoá rate limit theo IP peer TCP (r.RemoteAddr) — không giả mạo
// được qua header. Hợp mô hình 1 VPS hiện tại; khi đặt sau reverse proxy (Caddy)
// ở production cần chuyển sang IP giải mã bởi middleware.ClientIPFrom* (deploy).
func keyByRemoteIP(r *http.Request) (string, error) {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	return httprate.CanonicalizeIP(ip), nil
}

// rateLimitPath áp middleware mw CHỈ khi request khớp method + path chỉ định; các
// route khác đi thẳng. Cho phép rate limit riêng POST /leads mà không ảnh hưởng
// /healthz hay /products.
func rateLimitPath(method, path string, mw func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		limited := mw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == method && r.URL.Path == path {
				limited.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
