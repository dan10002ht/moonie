// Command server là entrypoint HTTP API của Mooni Cake.
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/auth"
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
	pool         *pgxpool.Pool
	products     productLister
	productAdmin productAdminStore
	leads        leadCreator
	leadAdmin    leadAdminStore
	leadConvert  leadConverter
	orderAdmin   orderAdminStore
	orderCreate  orderCreator
	auth         adminStore
	notifier     notify.Notifier
	// jwtSecret là khoá HMAC ký/kiểm JWT phiên admin (từ env JWT_SECRET).
	jwtSecret []byte
	// secureCookie bật cờ Secure trên cookie phiên (true ở production).
	secureCookie bool
	// uploadsDir là thư mục lưu ảnh sản phẩm upload (REQ-PROD-003).
	uploadsDir string
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

	// JWT_SECRET bắt buộc VÀ phải đủ mạnh: fail-fast lúc khởi động nếu rỗng, quá
	// ngắn (<32 ký tự), hoặc còn là placeholder — tránh footgun deploy khiến
	// attacker đoán được secret rồi tự ký JWT bypass admin (NFR-005, defense-in-depth).
	if err := config.ValidateJWTSecret(cfg.JWTSecret); err != nil {
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
		Handler:           newRouter(pool, newNotifier(cfg), []byte(cfg.JWTSecret), cfg.IsProduction(), cfg.UploadsDir),
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
func newRouter(pool *pgxpool.Pool, notifier notify.Notifier, jwtSecret []byte, secureCookie bool, uploadsDir string) http.Handler {
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

	// Auth: bảo vệ CHỈ nhóm /api/v1/admin/* bằng middleware JWT cookie. Các route
	// /auth/login, /auth/logout, /products, /leads, /healthz KHÔNG qua middleware
	// (REQ-AUTH-002). oapi mount mọi route trên cùng router nên ta gác theo prefix.
	r.Use(authPathPrefix(adminPathPrefix, auth.Middleware(jwtSecret)))

	// Mọi route đi qua handler sinh từ spec (HandlerFromMuxWithBaseURL) để lệch
	// spec = fail compile. Server url trong openapi.yaml là /api/v1 nên baseURL
	// khớp: path /healthz trong spec → phục vụ tại /api/v1/healthz.
	q := store.New(pool)
	srv := &Server{pool: pool, products: q, productAdmin: q, leads: q, leadAdmin: q, leadConvert: poolLeadConverter{pool: pool}, orderAdmin: q, orderCreate: poolOrderCreator{pool: pool}, auth: q, notifier: notifier, jwtSecret: jwtSecret, secureCookie: secureCookie, uploadsDir: uploadsDir}

	// Serve tĩnh ảnh sản phẩm tại GET /uploads/* — PUBLIC (không auth) để landing
	// hiển thị ảnh. Đặt NGOÀI prefix /api/v1/admin nên middleware auth không gác.
	// http.FileServer + http.Dir tự làm sạch path (chống traversal ../) (REQ-PROD-003).
	// noDirFS tắt directory listing (GET /uploads/ → 404, không lộ danh sách file);
	// nosniffUploads gắn X-Content-Type-Options: nosniff (chống MIME-sniff → stored-XSS).
	fileServer := http.StripPrefix("/uploads", http.FileServer(noDirFS{fs: http.Dir(uploadsDir)}))
	r.Handle("/uploads/*", nosniffUploads(fileServer))

	api.HandlerFromMuxWithBaseURL(srv, r, "/api/v1")

	return r
}

// noDirFS bọc một http.FileSystem để TẮT directory listing: Open trả lỗi
// os.ErrNotExist khi path là thư mục → http.FileServer phản hồi 404 thay vì liệt
// kê file. Chỉ cho phép GET file cụ thể (không lộ danh sách ảnh trong uploads/).
type noDirFS struct{ fs http.FileSystem }

// Open mở file; nếu là thư mục thì từ chối (404). Giữ nguyên chống-traversal của
// http.Dir bên dưới.
func (n noDirFS) Open(name string) (http.File, error) {
	f, err := n.fs.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	if info.IsDir() {
		_ = f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

// nosniffUploads gắn header X-Content-Type-Options: nosniff cho mọi phản hồi
// /uploads/* trước khi FileServer chạy — chặn trình duyệt MIME-sniff nội dung
// upload thành HTML/JS (defense-in-depth chống stored-XSS khi landing hiển thị ảnh).
func nosniffUploads(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// adminPathPrefix là tiền tố URL của mọi route admin cần auth (REQ-AUTH-002).
const adminPathPrefix = "/api/v1/admin"

// authPathPrefix áp middleware mw CHỈ khi path bắt đầu bằng prefix; route khác đi
// thẳng. Cho phép bảo vệ nhóm /admin/* mà không đụng route public — mw tự trả 401
// và KHÔNG gọi next khi token thiếu/sai.
func authPathPrefix(prefix string, mw func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		guarded := mw(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, prefix) {
				guarded.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
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
