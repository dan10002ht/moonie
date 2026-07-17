package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// signingMethod là thuật toán ký DUY NHẤT được chấp nhận. Cố định HS256 để
// Verify từ chối mọi token dùng alg khác (RS256, none...) — chống alg confusion.
var signingMethod = jwt.SigningMethodHS256

// ErrInvalidToken là lỗi chung khi token không hợp lệ (sai chữ ký, hết hạn, sai
// alg, thiếu subject...). Trả lỗi mờ để không leak lý do cụ thể cho client.
var ErrInvalidToken = errors.New("token không hợp lệ")

// Sign tạo JWT HS256 với claim sub=adminID và exp = now + ttl. secret là khoá bí
// mật HMAC lấy từ env (JWT_SECRET), không hardcode. Trả chuỗi token đã ký.
func Sign(adminID string, secret []byte, ttl time.Duration) (string, error) {
	if adminID == "" {
		return "", errors.New("sign token: adminID rỗng")
	}
	if len(secret) == 0 {
		return "", errors.New("sign token: secret rỗng")
	}

	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   adminID,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
	}

	token := jwt.NewWithClaims(signingMethod, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}

// Verify kiểm tra chữ ký + hạn của token và trả adminID (claim sub). CHỈ chấp
// nhận alg HS256 (chống alg confusion — token 'none' hoặc RS256 bị từ chối ngay ở
// keyfunc). exp quá hạn → lỗi. Mọi thất bại trả ErrInvalidToken (không leak lý do).
func Verify(token string, secret []byte) (string, error) {
	if len(secret) == 0 {
		return "", errors.New("verify token: secret rỗng")
	}

	var claims jwt.RegisteredClaims
	parsed, err := jwt.ParseWithClaims(token, &claims, func(t *jwt.Token) (any, error) {
		// Ràng buộc alg: chỉ HMAC-SHA256. Bất kỳ method nào khác (gồm "none") →
		// từ chối trước khi verify, ngăn kẻ tấn công ép alg yếu/none.
		if t.Method != signingMethod {
			return nil, fmt.Errorf("%w: alg không mong đợi", ErrInvalidToken)
		}
		return secret, nil
	}, jwt.WithValidMethods([]string{signingMethod.Alg()}))
	if err != nil || !parsed.Valid {
		return "", ErrInvalidToken
	}

	if claims.Subject == "" {
		return "", ErrInvalidToken
	}
	return claims.Subject, nil
}
