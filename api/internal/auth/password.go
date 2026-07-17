// Package auth chứa xác thực admin: kiểm tra mật khẩu bcrypt, ký/kiểm JWT và
// middleware bảo vệ các route /admin (REQ-AUTH-001/002).
package auth

import "golang.org/x/crypto/bcrypt"

// VerifyPassword so khớp mật khẩu người dùng nhập (plain) với hash bcrypt lưu
// trong DB. Trả nil khi khớp, error khi sai (hoặc hash không hợp lệ). Không log
// mật khẩu/hash — caller chỉ nên phân biệt nil vs non-nil (NFR-009).
func VerifyPassword(hash, plain string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain))
}
