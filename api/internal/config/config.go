// Package config đọc cấu hình ứng dụng từ biến môi trường (NFR-005).
package config

import (
	"fmt"
	"os"
	"strings"
)

// Config chứa toàn bộ cấu hình runtime của API, nạp từ env.
type Config struct {
	DatabaseURL      string
	JWTSecret        string
	TelegramBotToken string
	TelegramChatID   string
	TelegramAPIBase  string
	Port             string
	// AppEnv là môi trường chạy ("production" | "development" | ...). Quyết định
	// cờ Secure của cookie phiên admin (Secure=true ở production).
	AppEnv string
	// UploadsDir là thư mục lưu ảnh sản phẩm upload (REQ-PROD-003). Mặc định
	// "./uploads". Production mount volume vào đường dẫn này (nằm trong backup).
	UploadsDir string
	// TrustedProxies là danh sách IP/CIDR của reverse proxy tin cậy (Caddy/Next),
	// tách từ TRUSTED_PROXIES (phân tách bằng dấu phẩy). Chỉ khi peer TCP nằm trong
	// danh sách này thì API mới đọc X-Forwarded-For để lấy IP client thật cho rate
	// limit (NFR-006, M1). Rỗng = không tin proxy nào → rate limit theo RemoteAddr
	// (default an toàn cho dev, chống spoof header).
	TrustedProxies []string
	// AllowedOrigins là danh sách origin (scheme://host[:port]) được phép gửi
	// request GHI tới route admin/auth, tách từ ALLOWED_ORIGIN (phân tách dấu phẩy).
	// Dùng cho CSRF defense-in-depth (L4): nếu header Origin CÓ mặt mà không khớp
	// danh sách này → 403. Rỗng = fallback same-origin theo Host header (vẫn chặn
	// cross-site); set giá trị để dùng allowlist tường minh ở production, ví dụ
	// ALLOWED_ORIGIN=https://mooni.vn.
	AllowedOrigins []string
}

// IsProduction cho biết có đang chạy ở môi trường production hay không. So khớp
// KHÔNG phân biệt hoa/thường + trim khoảng trắng ("Production", " PRODUCTION " …
// đều tính là production) để tránh footgun: lệch case sẽ vô tình TẮT cờ Secure
// cookie. Dùng để bật cờ Secure trên cookie auth.
func (c *Config) IsProduction() bool {
	return strings.EqualFold(strings.TrimSpace(c.AppEnv), "production")
}

// defaultTelegramAPIBase là host Telegram Bot API mặc định. Override qua
// TELEGRAM_API_BASE (chủ yếu để test trỏ vào mock server).
const defaultTelegramAPIBase = "https://api.telegram.org"

// minJWTSecretLen là độ dài tối thiểu (byte) của JWT_SECRET. HMAC-SHA256 an toàn
// khi khoá ≥ 256 bit; 32 ký tự là ngưỡng thực dụng chống brute-force/đoán.
const minJWTSecretLen = 32

// placeholderJWTSecret là giá trị placeholder ship kèm .env.example. Từ chối đúng
// giá trị này để tránh footgun deploy quên đổi (attacker đoán được secret → tự ký
// JWT hợp lệ → bypass toàn bộ admin).
const placeholderJWTSecret = "change-me-in-production"

// ValidateJWTSecret kiểm tra JWT_SECRET đủ mạnh: không rỗng, ≥ minJWTSecretLen ký
// tự, và KHÔNG phải giá trị placeholder. Trả error mô tả (KHÔNG chứa secret) kèm
// hướng dẫn sinh khoá mạnh. Gọi lúc khởi động để fail-fast trước khi serve.
func ValidateJWTSecret(secret string) error {
	const hint = "sinh bằng: openssl rand -base64 48"
	switch {
	case secret == "":
		return fmt.Errorf("JWT_SECRET bắt buộc và phải ≥%d ký tự — %s", minJWTSecretLen, hint)
	case secret == placeholderJWTSecret:
		return fmt.Errorf("JWT_SECRET đang dùng giá trị placeholder không an toàn — %s", hint)
	case len(secret) < minJWTSecretLen:
		return fmt.Errorf("JWT_SECRET phải ≥%d ký tự và không dùng giá trị placeholder — %s", minJWTSecretLen, hint)
	default:
		return nil
	}
}

// Load đọc cấu hình từ biến môi trường. DATABASE_URL là bắt buộc; thiếu sẽ trả
// error. Port mặc định "8080" khi không set.
func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("load config: thiếu biến môi trường DATABASE_URL")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	tgAPIBase := os.Getenv("TELEGRAM_API_BASE")
	if tgAPIBase == "" {
		tgAPIBase = defaultTelegramAPIBase
	}

	uploadsDir := os.Getenv("UPLOADS_DIR")
	if uploadsDir == "" {
		uploadsDir = "./uploads"
	}

	return &Config{
		DatabaseURL:      dbURL,
		JWTSecret:        os.Getenv("JWT_SECRET"),
		TelegramBotToken: os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramChatID:   os.Getenv("TELEGRAM_CHAT_ID"),
		TelegramAPIBase:  tgAPIBase,
		Port:             port,
		AppEnv:           os.Getenv("APP_ENV"),
		UploadsDir:       uploadsDir,
		TrustedProxies:   parseCSVList(os.Getenv("TRUSTED_PROXIES")),
		AllowedOrigins:   parseCSVList(os.Getenv("ALLOWED_ORIGIN")),
	}, nil
}

// parseCSVList tách chuỗi phân tách bằng dấu phẩy thành slice đã trim, bỏ phần tử
// rỗng. Chuỗi rỗng → slice nil. Dùng cho TRUSTED_PROXIES.
func parseCSVList(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}
