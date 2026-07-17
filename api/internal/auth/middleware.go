package auth

import (
	"context"
	"net/http"

	"github.com/moonie/api/internal/httpx"
)

// CookieName là tên cookie chứa JWT phiên admin (httpOnly). Dùng thống nhất giữa
// handler login/logout và middleware.
const CookieName = "mc_admin"

// contextKey là kiểu riêng cho key context — tránh va chạm với key của package
// khác (không dùng string thô).
type contextKey struct{ name string }

// adminIDKey là key lưu adminID (claim sub) vào request context sau khi xác thực.
var adminIDKey = contextKey{name: "adminID"}

// Middleware trả về middleware chi bảo vệ các route admin: đọc cookie mc_admin,
// Verify JWT bằng secret; thiếu/sai/hết hạn → 401 JSON {error} và KHÔNG gọi next.
// Hợp lệ → gắn adminID vào context rồi chuyển tiếp (REQ-AUTH-002).
func Middleware(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(CookieName)
			if err != nil || cookie.Value == "" {
				httpx.WriteError(w, http.StatusUnauthorized, "cần đăng nhập")
				return
			}

			adminID, err := Verify(cookie.Value, secret)
			if err != nil {
				httpx.WriteError(w, http.StatusUnauthorized, "phiên đăng nhập không hợp lệ hoặc đã hết hạn")
				return
			}

			ctx := context.WithValue(r.Context(), adminIDKey, adminID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AdminIDFromContext lấy adminID đã được Middleware gắn vào context. ok=false nếu
// request không đi qua middleware auth (không nên xảy ra với route đã bảo vệ).
func AdminIDFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(adminIDKey).(string)
	return id, ok
}
