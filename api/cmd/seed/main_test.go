package main

import (
	"strings"
	"testing"
)

// TestResolveSeedPassword: guard chặn mật khẩu mặc định/yếu khi seed production,
// giữ nguyên hành vi cho dev. Table-driven, KHÔNG cần DB.
func TestResolveSeedPassword(t *testing.T) {
	tests := []struct {
		name        string
		appEnv      string
		envPassword string
		want        string
		wantErr     bool
	}{
		{"dev, no env -> default", "development", "", defaultAdminPassword, false},
		{"dev, custom -> custom", "development", "abc", "abc", false},
		{"empty appenv, default allowed", "", "", defaultAdminPassword, false},
		{"prod, default password -> refuse", "production", "", "", true},
		{"prod, explicit default -> refuse", "production", defaultAdminPassword, "", true},
		{"prod, too short -> refuse", "production", "short", "", true},
		{"prod, strong password -> ok", "production", "a-very-strong-secret-123", "a-very-strong-secret-123", false},
		{"prod, exactly 12 chars -> ok", "production", "123456789012", "123456789012", false},
		{"prod, 11 chars -> refuse", "production", "12345678901", "", true},
		// Case-fold + trim: lệch hoa/thường hoặc khoảng trắng vẫn kích guard (không để
		// mật khẩu mặc định lọt lên prod vì APP_ENV="Production").
		{"Production (case) default -> refuse", "Production", "", "", true},
		{"PRODUCTION default -> refuse", "PRODUCTION", "", "", true},
		{"  production  (spaces) default -> refuse", "  production  ", "", "", true},
		{"Production strong -> ok", "Production", "a-very-strong-secret-123", "a-very-strong-secret-123", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveSeedPassword(tt.appEnv, tt.envPassword)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (password=%q)", got)
				}
				if got != "" {
					t.Errorf("password on error = %q, want empty", got)
				}
				// Error message KHÔNG được chứa mật khẩu (không log nhạy cảm).
				if tt.envPassword != "" && strings.Contains(err.Error(), tt.envPassword) {
					t.Errorf("error message rò rỉ mật khẩu: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("password = %q, want %q", got, tt.want)
			}
		})
	}
}
