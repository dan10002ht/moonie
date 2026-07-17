package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/auth"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/store"
)

// sessionTTL là thời gian sống của phiên admin (JWT + cookie). 7 ngày: đủ tiện
// cho chủ shop mà vẫn buộc đăng nhập lại định kỳ.
const sessionTTL = 7 * 24 * time.Hour

// dummyBcryptHash là hash bcrypt của một mật khẩu không dùng thật. Khi email
// không tồn tại, ta vẫn chạy bcrypt.CompareHashAndPassword với hash này để thời
// gian phản hồi tương đương trường hợp email tồn tại — chống dò tài khoản qua
// timing (user enumeration). Giá trị là hash cố định, KHÔNG phải bí mật.
const dummyBcryptHash = "$2a$10$jHla5mJI9VUn7L3nWjd6jObK6H3Tfi2ZECogR2H0Z6a5a9h9JqXrO"

// loginErrMsg là thông điệp DUY NHẤT trả về khi đăng nhập thất bại (sai email
// HOẶC sai mật khẩu) — không tiết lộ cái nào sai (chống user enumeration).
const loginErrMsg = "email hoặc mật khẩu không đúng"

// adminStore là phần store mà handler auth cần: tra admin theo email (login) và
// theo id (/admin/me). Tách interface để inject fake trong test (không cần DB).
type adminStore interface {
	GetAdminUserByEmail(ctx context.Context, email string) (store.AdminUser, error)
	GetAdminUserByID(ctx context.Context, id pgtype.UUID) (store.AdminUser, error)
}

// Login phục vụ POST /api/v1/auth/login: xác thực admin bằng email+password
// (bcrypt), đúng → đặt cookie httpOnly mc_admin chứa JWT + trả {ok:true}; sai →
// 401 với thông điệp trung lập (REQ-AUTH-001/002).
func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	var in api.LoginInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	if err := dec.Decode(&in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "dữ liệu gửi lên không hợp lệ")
		return
	}

	email := strings.TrimSpace(strings.ToLower(in.Email))
	password := in.Password
	if email == "" || password == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vui lòng nhập email và mật khẩu")
		return
	}

	admin, err := s.auth.GetAdminUserByEmail(r.Context(), email)
	if err != nil {
		// Email không tồn tại: vẫn chạy bcrypt với hash giả để thời gian phản hồi
		// tương đương (chống timing enumeration), rồi trả cùng lỗi trung lập.
		if errors.Is(err, pgx.ErrNoRows) {
			_ = auth.VerifyPassword(dummyBcryptHash, password)
			httpx.WriteError(w, http.StatusUnauthorized, loginErrMsg)
			return
		}
		log.Printf("login: tra admin lỗi: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không đăng nhập được, vui lòng thử lại")
		return
	}

	if err := auth.VerifyPassword(admin.PasswordHash, password); err != nil {
		// KHÔNG log password. Sai mật khẩu → cùng thông điệp trung lập.
		httpx.WriteError(w, http.StatusUnauthorized, loginErrMsg)
		return
	}

	adminID := openapi_types.UUID(admin.ID.Bytes).String()
	token, err := auth.Sign(adminID, s.jwtSecret, sessionTTL)
	if err != nil {
		log.Printf("login: ký JWT lỗi: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không đăng nhập được, vui lòng thử lại")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})

	log.Printf("login: admin %s đăng nhập thành công", adminID)
	httpx.WriteJSON(w, http.StatusOK, api.LoginResult{Ok: true})
}

// Logout phục vụ POST /api/v1/auth/logout: xóa cookie phiên (Max-Age=-1). Luôn
// trả 200 (idempotent, không cần đang đăng nhập).
func (s *Server) Logout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
	httpx.WriteJSON(w, http.StatusOK, api.LoginResult{Ok: true})
}

// GetAdminMe phục vụ GET /api/v1/admin/me: trả admin ứng với phiên hiện tại. Route
// này đi qua middleware auth (adminID đã có trong context) — chứng minh middleware
// bảo vệ hoạt động (REQ-AUTH-002).
func (s *Server) GetAdminMe(w http.ResponseWriter, r *http.Request) {
	adminID, ok := auth.AdminIDFromContext(r.Context())
	if !ok {
		// Không nên xảy ra: route đã sau middleware. Phòng thủ.
		httpx.WriteError(w, http.StatusUnauthorized, "cần đăng nhập")
		return
	}

	var id pgtype.UUID
	if err := id.Scan(adminID); err != nil {
		httpx.WriteError(w, http.StatusUnauthorized, "phiên đăng nhập không hợp lệ")
		return
	}

	admin, err := s.auth.GetAdminUserByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Token hợp lệ nhưng admin đã bị xóa → coi như chưa đăng nhập.
			httpx.WriteError(w, http.StatusUnauthorized, "tài khoản không còn tồn tại")
			return
		}
		log.Printf("admin/me: tra admin lỗi: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được thông tin tài khoản")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, api.AdminMe{
		Id:    openapi_types.UUID(admin.ID.Bytes),
		Email: admin.Email,
		Name:  admin.Name,
	})
}
