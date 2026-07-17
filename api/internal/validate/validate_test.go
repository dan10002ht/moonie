package validate

import (
	"strings"
	"testing"
)

func TestPhone(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"10 số bắt đầu 0", "0912345678", false},
		{"landline 0 đầu", "0281234567", false},
		{"quốc tế +84", "+84912345678", false},
		{"có khoảng trắng", "0912 345 678", false},
		{"có dấu gạch", "091-234-5678", false},
		{"+84 có khoảng trắng", "+84 912 345 678", false},
		{"rỗng", "", true},
		{"chỉ khoảng trắng", "   ", true},
		{"chứa chữ cái", "091234567a", true},
		{"chứa ký tự lạ", "0912#45678", true},
		{"quá ngắn", "091234", true},
		{"quá dài", "09123456789", true},
		{"không bắt đầu 0", "1912345678", true},
		{"+ nhưng không phải +84", "+1912345678", true},
		{"+84 sai độ dài", "+8491234567", true},
		{"chỉ dấu +", "+", true},
		{"+ ở giữa", "091+345678", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Phone(tt.in)
			if (err != nil) != tt.wantErr {
				t.Errorf("Phone(%q) err = %v, wantErr = %v", tt.in, err, tt.wantErr)
			}
		})
	}
}

func TestRequiredName(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"tên bình thường", "Nguyễn Văn A", false},
		{"tên có khoảng trắng bao quanh", "  Anh  ", false},
		{"rỗng", "", true},
		{"chỉ khoảng trắng", "   ", true},
		{"chỉ tab/xuống dòng", "\t\n", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := RequiredName(tt.in)
			if (err != nil) != tt.wantErr {
				t.Errorf("RequiredName(%q) err = %v, wantErr = %v", tt.in, err, tt.wantErr)
			}
		})
	}
}

func TestMaxLen(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		max     int
		wantErr bool
	}{
		{"trong giới hạn", "abc", 5, false},
		{"đúng bằng giới hạn", "abcde", 5, false},
		{"vượt giới hạn", "abcdef", 5, true},
		{"tiếng Việt đếm theo rune", strings.Repeat("ố", 5), 5, false},
		{"tiếng Việt vượt rune", strings.Repeat("ố", 6), 5, true},
		{"rỗng luôn hợp lệ", "", 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := MaxLen(tt.in, tt.max)
			if (err != nil) != tt.wantErr {
				t.Errorf("MaxLen(%q,%d) err = %v, wantErr = %v", tt.in, tt.max, err, tt.wantErr)
			}
		})
	}
}
