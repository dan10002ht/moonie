package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestSignVerifyRoundTrip(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-minimum")
	const adminID = "11111111-2222-3333-4444-555555555555"

	token, err := Sign(adminID, secret, time.Hour)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	got, err := Verify(token, secret)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if got != adminID {
		t.Fatalf("adminID = %q, want %q", got, adminID)
	}
}

func TestSignErrors(t *testing.T) {
	secret := []byte("secret")
	if _, err := Sign("", secret, time.Hour); err == nil {
		t.Error("Sign với adminID rỗng phải lỗi")
	}
	if _, err := Sign("id", nil, time.Hour); err == nil {
		t.Error("Sign với secret rỗng phải lỗi")
	}
}

func TestVerifyRejects(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-minimum")
	const adminID = "abc"

	valid, err := Sign(adminID, secret, time.Hour)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	// Token hết hạn: ký với ttl âm → exp trong quá khứ.
	expired, err := Sign(adminID, secret, -time.Hour)
	if err != nil {
		t.Fatalf("Sign expired: %v", err)
	}

	// Token ký bằng alg "none" (unsigned) — tấn công alg confusion kinh điển.
	noneToken, err := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.RegisteredClaims{
		Subject:   adminID,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none: %v", err)
	}

	// Token thiếu subject.
	noSub, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}).SignedString(secret)
	if err != nil {
		t.Fatalf("sign no-sub: %v", err)
	}

	tests := []struct {
		name   string
		token  string
		secret []byte
	}{
		{name: "chữ ký sai (secret khác)", token: valid, secret: []byte("wrong-secret-key-completely-diff")},
		{name: "token hết hạn", token: expired, secret: secret},
		{name: "alg none (alg confusion)", token: noneToken, secret: secret},
		{name: "chuỗi rác", token: "not.a.jwt", secret: secret},
		{name: "rỗng", token: "", secret: secret},
		{name: "thiếu subject", token: noSub, secret: secret},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := Verify(tt.token, tt.secret); err == nil {
				t.Errorf("Verify(%s) phải lỗi, nhưng nil", tt.name)
			}
		})
	}
}

func TestVerifyEmptySecret(t *testing.T) {
	if _, err := Verify("whatever", nil); err == nil {
		t.Error("Verify với secret rỗng phải lỗi")
	}
}
