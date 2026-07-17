package config_test

import (
	"testing"

	"github.com/moonie/api/internal/config"
)

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr bool
		check   func(t *testing.T, c *config.Config)
	}{
		{
			name: "full config",
			env: map[string]string{
				"DATABASE_URL":       "postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable",
				"JWT_SECRET":         "secret",
				"TELEGRAM_BOT_TOKEN": "bot-token",
				"TELEGRAM_CHAT_ID":   "chat-id",
				"PORT":               "9090",
			},
			check: func(t *testing.T, c *config.Config) {
				if c.DatabaseURL != "postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable" {
					t.Errorf("DatabaseURL = %q", c.DatabaseURL)
				}
				if c.JWTSecret != "secret" {
					t.Errorf("JWTSecret = %q", c.JWTSecret)
				}
				if c.TelegramBotToken != "bot-token" {
					t.Errorf("TelegramBotToken = %q", c.TelegramBotToken)
				}
				if c.TelegramChatID != "chat-id" {
					t.Errorf("TelegramChatID = %q", c.TelegramChatID)
				}
				if c.Port != "9090" {
					t.Errorf("Port = %q", c.Port)
				}
			},
		},
		{
			name: "default port",
			env: map[string]string{
				"DATABASE_URL": "postgres://x",
			},
			check: func(t *testing.T, c *config.Config) {
				if c.Port != "8080" {
					t.Errorf("Port = %q, want default 8080", c.Port)
				}
			},
		},
		{
			name:    "missing database url",
			env:     map[string]string{},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clear all relevant env then set test env.
			for _, k := range []string{"DATABASE_URL", "JWT_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "PORT"} {
				t.Setenv(k, "")
			}
			for k, v := range tt.env {
				t.Setenv(k, v)
			}

			c, err := config.Load()
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.check != nil {
				tt.check(t, c)
			}
		})
	}
}
