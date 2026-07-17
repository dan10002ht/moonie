// Package validate chứa các kiểm tra dữ liệu vào tại boundary API (NFR-004):
// SĐT Việt Nam, tên bắt buộc, độ dài tối đa. Trả error tiếng Việt an toàn để hiển
// thị cho client — không leak internal.
package validate

import (
	"errors"
	"strings"
	"unicode/utf8"
)

// Các lỗi validate được export để handler/test so khớp bằng errors.Is nếu cần.
var (
	ErrNameRequired = errors.New("tên không được để trống")
	ErrPhoneEmpty   = errors.New("số điện thoại không được để trống")
	ErrPhoneChars   = errors.New("số điện thoại chỉ được chứa chữ số, khoảng trắng, dấu + hoặc -")
	ErrPhoneFormat  = errors.New("số điện thoại không đúng định dạng Việt Nam")
	ErrTooLong      = errors.New("nội dung vượt quá độ dài cho phép")
)

// RequiredName kiểm tra tên không rỗng sau khi trim khoảng trắng.
func RequiredName(s string) error {
	if strings.TrimSpace(s) == "" {
		return ErrNameRequired
	}
	return nil
}

// MaxLen kiểm tra chuỗi không vượt quá n ký tự (đếm rune để đúng với tiếng Việt).
func MaxLen(s string, n int) error {
	if utf8.RuneCountInString(s) > n {
		return ErrTooLong
	}
	return nil
}

// Phone kiểm tra số điện thoại Việt Nam. Chấp nhận:
//   - 10 chữ số bắt đầu bằng '0' (vd 0912345678),
//   - dạng quốc tế +84 (vd +84912345678, tương đương 0912345678).
//
// Cho phép khoảng trắng và dấu '-' làm dấu phân cách (vd "0912 345 678"). Từ chối
// chữ cái, ký tự lạ, hoặc độ dài sai. Chỉ '+' ở đầu dạng '+84' mới hợp lệ.
func Phone(s string) error {
	t := strings.TrimSpace(s)
	if t == "" {
		return ErrPhoneEmpty
	}

	// Chỉ cho phép chữ số, khoảng trắng, dấu '+' và '-'.
	for _, r := range t {
		if (r < '0' || r > '9') && r != ' ' && r != '+' && r != '-' {
			return ErrPhoneChars
		}
	}

	// Bỏ khoảng trắng và dấu '-' (chỉ là dấu phân cách).
	compact := strings.NewReplacer(" ", "", "-", "").Replace(t)

	// Chuẩn hoá dạng quốc tế +84... → 0...
	switch {
	case strings.HasPrefix(compact, "+84"):
		compact = "0" + compact[len("+84"):]
	case strings.HasPrefix(compact, "+"):
		// '+' chỉ hợp lệ trong tiền tố +84.
		return ErrPhoneFormat
	}

	// Sau chuẩn hoá không được còn dấu '+' lẫn trong số.
	if strings.ContainsRune(compact, '+') {
		return ErrPhoneFormat
	}

	// Phải là đúng 10 chữ số bắt đầu bằng '0'.
	if len(compact) != 10 || compact[0] != '0' {
		return ErrPhoneFormat
	}
	for i := 0; i < len(compact); i++ {
		if compact[i] < '0' || compact[i] > '9' {
			return ErrPhoneFormat
		}
	}
	return nil
}
