package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/auth"
	"github.com/moonie/api/internal/store"
)

// fakeAdminStore là adminStore giả cho handler test (không cần DB). Chỉ biết một
// admin theo email cố định.
type fakeAdminStore struct {
	admin   store.AdminUser
	byEmail string // email khớp; khác → ErrNoRows
}

func (f fakeAdminStore) GetAdminUserByEmail(_ context.Context, email string) (store.AdminUser, error) {
	if email == f.byEmail {
		return f.admin, nil
	}
	return store.AdminUser{}, pgx.ErrNoRows
}

func (f fakeAdminStore) GetAdminUserByID(_ context.Context, id pgtype.UUID) (store.AdminUser, error) {
	if id.Bytes == f.admin.ID.Bytes {
		return f.admin, nil
	}
	return store.AdminUser{}, pgx.ErrNoRows
}

const testSecret = "test-secret-key-32-bytes-minimum-000"

func newAuthTestServer(t *testing.T) *Server {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("mooni-admin"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("gen hash: %v", err)
	}
	name := "Mooni Admin"
	rawID := [16]byte{0x2d, 0xe8, 0x5a, 0xe8, 0xb1, 0xa8, 0x4d, 0xd7, 0xb8, 0xc3, 0x20, 0xdc, 0xf8, 0xb0, 0x4d, 0xeb}
	return &Server{
		auth: fakeAdminStore{
			byEmail: "admin@mooni.local",
			admin: store.AdminUser{
				ID:           pgtype.UUID{Bytes: rawID, Valid: true},
				Email:        "admin@mooni.local",
				PasswordHash: string(hash),
				Name:         &name,
			},
		},
		jwtSecret:    []byte(testSecret),
		secureCookie: false,
	}
}

func TestLoginSuccess(t *testing.T) {
	s := newAuthTestServer(t)
	body := `{"email":"admin@mooni.local","password":"mooni-admin"}`
	rec := httptest.NewRecorder()
	s.Login(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body)))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var res api.LoginResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !res.Ok {
		t.Error("ok phải true")
	}

	cookies := rec.Result().Cookies()
	var mc *http.Cookie
	for _, c := range cookies {
		if c.Name == auth.CookieName {
			mc = c
		}
	}
	if mc == nil {
		t.Fatal("thiếu cookie mc_admin")
	}
	if !mc.HttpOnly {
		t.Error("cookie phải HttpOnly")
	}
	if mc.SameSite != http.SameSiteLaxMode {
		t.Error("cookie phải SameSite=Lax")
	}
	if mc.Path != "/" {
		t.Errorf("cookie Path = %q, want /", mc.Path)
	}
	if mc.MaxAge <= 0 {
		t.Errorf("cookie MaxAge = %d, want > 0", mc.MaxAge)
	}
	// JWT trong cookie phải verify được.
	if _, err := auth.Verify(mc.Value, []byte(testSecret)); err != nil {
		t.Errorf("cookie JWT không verify được: %v", err)
	}
}

func TestLoginFailures(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{name: "sai mật khẩu", body: `{"email":"admin@mooni.local","password":"sai"}`, wantStatus: http.StatusUnauthorized},
		{name: "email không tồn tại", body: `{"email":"khong@ton.tai","password":"mooni-admin"}`, wantStatus: http.StatusUnauthorized},
		{name: "thiếu password", body: `{"email":"admin@mooni.local"}`, wantStatus: http.StatusBadRequest},
		{name: "body rác", body: `khong-phai-json`, wantStatus: http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newAuthTestServer(t)
			rec := httptest.NewRecorder()
			s.Login(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(tt.body)))

			if rec.Code != tt.wantStatus {
				t.Fatalf("code = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			// Không đặt cookie khi thất bại.
			for _, c := range rec.Result().Cookies() {
				if c.Name == auth.CookieName && c.Value != "" {
					t.Error("không được đặt cookie mc_admin khi login thất bại")
				}
			}
			// 401 sai email/password phải cùng thông điệp trung lập (chống enumeration).
			if tt.wantStatus == http.StatusUnauthorized {
				var body map[string]string
				_ = json.Unmarshal(rec.Body.Bytes(), &body)
				if body["error"] != loginErrMsg {
					t.Errorf("error = %q, want %q (trung lập)", body["error"], loginErrMsg)
				}
			}
		})
	}
}

func TestLogout(t *testing.T) {
	s := newAuthTestServer(t)
	rec := httptest.NewRecorder()
	s.Logout(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var mc *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.CookieName {
			mc = c
		}
	}
	if mc == nil {
		t.Fatal("logout phải đặt cookie mc_admin để xóa")
	}
	if mc.MaxAge >= 0 {
		t.Errorf("MaxAge = %d, want < 0 (xóa cookie)", mc.MaxAge)
	}
}

func TestGetAdminMe(t *testing.T) {
	s := newAuthTestServer(t)
	secret := []byte(testSecret)

	// Đăng nhập lấy cookie thật, rồi gọi /admin/me qua middleware auth.
	loginRec := httptest.NewRecorder()
	s.Login(loginRec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login",
		strings.NewReader(`{"email":"admin@mooni.local","password":"mooni-admin"}`)))
	var cookie *http.Cookie
	for _, c := range loginRec.Result().Cookies() {
		if c.Name == auth.CookieName {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("login không trả cookie")
	}

	handler := auth.Middleware(secret)(http.HandlerFunc(s.GetAdminMe))

	t.Run("có cookie hợp lệ → 200 trả email", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/me", nil)
		req.AddCookie(cookie)
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var me api.AdminMe
		if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if me.Email != "admin@mooni.local" {
			t.Errorf("email = %q, want admin@mooni.local", me.Email)
		}
	})

	t.Run("không cookie → 401", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/me", nil)
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("code = %d, want 401", rec.Code)
		}
	})

	t.Run("cookie giả → 401", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/me", nil)
		req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: "gia.mao.token"})
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("code = %d, want 401", rec.Code)
		}
	})
}

// TestAdminRouteGuarded xác minh router thật gác /api/v1/admin/* (401 khi không
// cookie) và KHÔNG gác /auth/login, /healthz, /products. Không cần DB: request bị
// chặn ở middleware trước khi chạm handler.
func TestAdminRouteGuarded(t *testing.T) {
	router := newRouter(nil, nil, []byte(testSecret), false)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/me", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("/admin/me không cookie: code = %d, want 401", rec.Code)
	}

	// /auth/login không bị middleware auth chặn (body rỗng → 400, KHÔNG 401).
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{}`)))
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("/auth/login bị chặn bởi middleware auth (code=401), không được")
	}

	// Không có route đăng ký public.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{}`)))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("/auth/register: code = %d, want 404 (không có đăng ký public)", rec.Code)
	}
}
