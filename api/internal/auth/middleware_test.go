package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMiddleware(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-minimum")
	const adminID = "99999999-8888-7777-6666-555555555555"

	valid, err := Sign(adminID, secret, time.Hour)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	// next ghi 200 + adminID lấy từ context để chứng minh middleware gắn đúng.
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := AdminIDFromContext(r.Context())
		if !ok {
			t.Error("adminID không có trong context")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(id))
	})
	handler := Middleware(secret)(next)

	t.Run("cookie hợp lệ → next chạy, có adminID", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/me", nil)
		req.AddCookie(&http.Cookie{Name: CookieName, Value: valid})
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("code = %d, want 200", rec.Code)
		}
		if rec.Body.String() != adminID {
			t.Fatalf("body = %q, want %q", rec.Body.String(), adminID)
		}
	})

	unauthorized := func(name, cookieVal string, setCookie bool) {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/me", nil)
			if setCookie {
				req.AddCookie(&http.Cookie{Name: CookieName, Value: cookieVal})
			}
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("code = %d, want 401", rec.Code)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content-type = %q, want application/json", ct)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if body["error"] == "" {
				t.Error("thiếu trường error trong 401 JSON")
			}
		})
	}

	unauthorized("không có cookie → 401", "", false)
	unauthorized("cookie rỗng → 401", "", true)
	unauthorized("cookie giả → 401", "gia.mao.token", true)

	// Token hết hạn → 401.
	expired, err := Sign(adminID, secret, -time.Hour)
	if err != nil {
		t.Fatalf("Sign expired: %v", err)
	}
	unauthorized("token hết hạn → 401", expired, true)
}
