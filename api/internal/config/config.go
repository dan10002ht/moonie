// Package config đọc cấu hình ứng dụng từ biến môi trường (NFR-005).
package config

import (
	"fmt"
	"os"
)

// Config chứa toàn bộ cấu hình runtime của API, nạp từ env.
type Config struct {
	DatabaseURL      string
	JWTSecret        string
	TelegramBotToken string
	TelegramChatID   string
	Port             string
}

// Load đọc cấu hình từ biến môi trường. DATABASE_URL là bắt buộc; thiếu sẽ trả
// error. Port mặc định "8080" khi không set.
func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("load config: thiếu biến môi trường DATABASE_URL")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		DatabaseURL:      dbURL,
		JWTSecret:        os.Getenv("JWT_SECRET"),
		TelegramBotToken: os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramChatID:   os.Getenv("TELEGRAM_CHAT_ID"),
		Port:             port,
	}, nil
}
