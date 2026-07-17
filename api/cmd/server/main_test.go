package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/moonie/api/internal/auth"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/notify"
)

// testClientIP dựng resolver KHÔNG tin proxy nào → khoá rate limit theo RemoteAddr
// (hành vi mặc định cho test, giống trước khi có TRUSTED_PROXIES).
func testClientIP() *httpx.ClientIPResolver {
	r, err := httpx.NewClientIPResolver(nil)
	if err != nil {
		panic(err)
	}
	return r
}

func TestRouter(t *testing.T) {
	handler := newRouter(nil, notify.NoopNotifier{}, []byte("test-secret-32-bytes-minimum-000"), false, t.TempDir(), testClientIP())

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantKey    string
		wantVal    string
	}{
		{name: "healthz ok", method: http.MethodGet, path: "/api/v1/healthz", wantStatus: http.StatusOK, wantKey: "status", wantVal: "ok"},
		{name: "unknown path 404", method: http.MethodGet, path: "/api/v1/khong-ton-tai", wantStatus: http.StatusNotFound, wantKey: "error", wantVal: "không tìm thấy"},
		{name: "wrong method 405", method: http.MethodPost, path: "/api/v1/healthz", wantStatus: http.StatusMethodNotAllowed, wantKey: "error", wantVal: "phương thức không được hỗ trợ"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("code = %d, want %d", rec.Code, tt.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content-type = %q, want application/json", ct)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if body[tt.wantKey] != tt.wantVal {
				t.Fatalf("body[%q] = %q, want %q", tt.wantKey, body[tt.wantKey], tt.wantVal)
			}
		})
	}
}

// TestParamBindErrorJSON: khi oapi-codegen không bind được param (query sai kiểu,
// path id không phải uuid), router trả 400 JSON {error} "tham số không hợp lệ" —
// KHÔNG phải text thô lộ lỗi stdlib Go. Dùng cookie hợp lệ để qua middleware auth
// (lỗi bind param xảy ra SAU auth, trong wrapper oapi).
func TestParamBindErrorJSON(t *testing.T) {
	secret := []byte("test-secret-32-bytes-minimum-000")
	handler := newRouter(nil, notify.NoopNotifier{}, secret, false, t.TempDir(), testClientIP())

	token, err := auth.Sign("00000000-0000-0000-0000-000000000001", secret, time.Hour)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	cookie := &http.Cookie{Name: auth.CookieName, Value: token}

	tests := []struct {
		name string
		path string
	}{
		{"offset tràn int (sai kiểu)", "/api/v1/admin/customers?offset=99999999999999999999"},
		{"limit không phải số", "/api/v1/admin/customers?limit=abc"},
		{"path id không phải uuid", "/api/v1/admin/customers/not-a-uuid"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			req.AddCookie(cookie)
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content-type = %q, want application/json (không phải text thô)", ct)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body không phải JSON: %v; raw=%s", err, rec.Body.String())
			}
			if body["error"] != "tham số không hợp lệ" {
				t.Fatalf("body[error] = %q, want %q", body["error"], "tham số không hợp lệ")
			}
		})
	}
}
