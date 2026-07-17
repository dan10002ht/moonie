package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/moonie/api/internal/auth"
	"github.com/moonie/api/internal/notify"
)

// testSecret32 là khoá JWT hợp lệ (≥32 ký tự) dùng chung cho test router.
const testSecret32 = "test-secret-32-bytes-minimum-000"

// TestSecurityHeadersGlobal: MỌI response — JSON success, error 404, 405 — đều mang
// header bảo mật toàn cục (nosniff + X-Frame-Options DENY + Referrer-Policy) (L6).
func TestSecurityHeadersGlobal(t *testing.T) {
	handler := newRouter(nil, notify.NoopNotifier{}, []byte(testSecret32), false, t.TempDir(), testClientIP(), nil)

	tests := []struct {
		name   string
		method string
		path   string
	}{
		{"healthz 200", http.MethodGet, "/api/v1/healthz"},
		{"not found 404", http.MethodGet, "/api/v1/khong-ton-tai"},
		{"method not allowed 405", http.MethodPost, "/api/v1/healthz"},
	}
	wantHeaders := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			handler.ServeHTTP(rec, req)

			for k, want := range wantHeaders {
				if got := rec.Header().Get(k); got != want {
					t.Errorf("header %s = %q, want %q", k, got, want)
				}
			}
		})
	}
}

// TestUploadsCORP: response /uploads/* mang Cross-Origin-Resource-Policy: same-site
// (ngoài nosniff toàn cục). Dùng path không tồn tại → 404 nhưng wrapper vẫn set header.
func TestUploadsCORP(t *testing.T) {
	handler := newRouter(nil, notify.NoopNotifier{}, []byte(testSecret32), false, t.TempDir(), testClientIP(), nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/uploads/khong-co.png", nil)
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("Cross-Origin-Resource-Policy"); got != "same-site" {
		t.Errorf("CORP = %q, want same-site", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("nosniff = %q, want nosniff", got)
	}
}

// TestOriginCheck: CSRF defense-in-depth (L4). Với ALLOWED_ORIGIN đã cấu hình, request
// GHI tới route admin/auth có Origin lạ → 403; Origin khớp hoặc vắng → qua middleware
// (không 403). Với allowedOrigins RỖNG (dev) → luôn qua, kể cả Origin lạ.
func TestOriginCheck(t *testing.T) {
	secret := []byte(testSecret32)
	token, err := auth.Sign("00000000-0000-0000-0000-000000000001", secret, time.Hour)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	allowed := []string{"https://mooni.vn"}

	tests := []struct {
		name           string
		allowedOrigins []string
		method         string
		path           string
		origin         string
		// host override r.Host (rỗng = giữ mặc định httptest "example.com"). Dùng cho
		// nhánh same-origin fallback khi allowedOrigins rỗng.
		host string
		// wantForbidden true nếu kỳ vọng 403 (bị chặn origin); false nếu KHÔNG bị
		// chặn bởi originCheck (có thể là mã khác do route xử lý, nhưng KHÔNG 403).
		wantForbidden bool
	}{
		// Nhánh allowlist cấu hình.
		{"admin write, evil origin -> 403", allowed, http.MethodPost, "/api/v1/admin/products", "https://evil.example", "", true},
		{"admin PUT, evil origin -> 403", allowed, http.MethodPut, "/api/v1/admin/products/00000000-0000-0000-0000-000000000001", "https://evil.example", "", true},
		{"admin DELETE, evil origin -> 403", allowed, http.MethodDelete, "/api/v1/admin/products/00000000-0000-0000-0000-000000000001", "https://evil.example", "", true},
		{"admin write, matching origin -> pass", allowed, http.MethodPost, "/api/v1/admin/products", "https://mooni.vn", "", false},
		{"admin write, no origin -> pass", allowed, http.MethodPost, "/api/v1/admin/products", "", "", false},
		{"login, evil origin -> 403", allowed, http.MethodPost, "/api/v1/auth/login", "https://evil.example", "", true},
		{"logout, evil origin -> 403", allowed, http.MethodPost, "/api/v1/auth/logout", "https://evil.example", "", true},
		{"admin GET read, evil origin -> pass (chỉ chặn GHI)", allowed, http.MethodGet, "/api/v1/admin/products", "https://evil.example", "", false},
		{"public products write path evil -> pass (không phải admin/auth)", allowed, http.MethodPost, "/api/v1/leads", "https://evil.example", "", false},
		// Nhánh same-origin fallback: allowedOrigins RỖNG (dev/không cấu hình).
		{"empty allowed, foreign origin -> 403", nil, http.MethodPost, "/api/v1/admin/products", "https://evil.example", "127.0.0.1:3000", true},
		{"empty allowed, same-origin (host khớp) -> pass", nil, http.MethodPost, "/api/v1/admin/products", "http://127.0.0.1:3000", "127.0.0.1:3000", false},
		{"empty allowed, no origin -> pass", nil, http.MethodPost, "/api/v1/admin/products", "", "127.0.0.1:3000", false},
		{"empty allowed, foreign origin login -> 403", nil, http.MethodPost, "/api/v1/auth/login", "https://evil.example", "127.0.0.1:3000", true},
		{"empty allowed, malformed origin -> 403", nil, http.MethodPost, "/api/v1/admin/products", "://bad", "127.0.0.1:3000", true},
		{"empty allowed, Origin null -> 403", nil, http.MethodPost, "/api/v1/admin/products", "null", "127.0.0.1:3000", true},
		{"allowlist set, Origin null -> 403", allowed, http.MethodPost, "/api/v1/admin/products", "null", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := newRouter(nil, notify.NoopNotifier{}, secret, false, t.TempDir(), testClientIP(), tt.allowedOrigins)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.host != "" {
				req.Host = tt.host
			}
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			// Cookie hợp lệ để request qua được middleware auth (originCheck đứng trước
			// nhưng ta cần xác nhận KHÔNG bị chặn bởi originCheck cho case pass).
			req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: token})
			handler.ServeHTTP(rec, req)

			gotForbidden := rec.Code == http.StatusForbidden
			if gotForbidden != tt.wantForbidden {
				t.Fatalf("code = %d, wantForbidden = %v (body=%s)", rec.Code, tt.wantForbidden, rec.Body.String())
			}
		})
	}
}

// TestRequiresOriginCheck kiểm bảng path nhạy cảm cần kiểm Origin.
func TestRequiresOriginCheck(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/api/v1/admin/products", true},
		{"/api/v1/admin/orders/123", true},
		{"/api/v1/auth/login", true},
		{"/api/v1/auth/logout", true},
		{"/api/v1/leads", false},
		{"/api/v1/products", false},
		{"/api/v1/healthz", false},
		// /api/v1/adminx KHÔNG được coi là admin (prefix phải là segment /admin/…),
		// tránh khớp nhầm route lạ bắt đầu bằng "adminx".
		{"/api/v1/adminx/products", false},
	}
	for _, tt := range tests {
		if got := requiresOriginCheck(tt.path); got != tt.want {
			t.Errorf("requiresOriginCheck(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}
