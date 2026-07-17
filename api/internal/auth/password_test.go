package auth

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestVerifyPassword(t *testing.T) {
	const plain = "mooni-admin"
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("gen hash: %v", err)
	}

	if err := VerifyPassword(string(hash), plain); err != nil {
		t.Errorf("mật khẩu đúng phải nil, got %v", err)
	}
	if err := VerifyPassword(string(hash), "sai-mat-khau"); err == nil {
		t.Error("mật khẩu sai phải trả lỗi")
	}
	if err := VerifyPassword("không-phải-hash-bcrypt", plain); err == nil {
		t.Error("hash không hợp lệ phải trả lỗi")
	}
}
