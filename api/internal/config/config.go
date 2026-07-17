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
	TelegramAPIBase  string
	Port             string
	// AppEnv là môi trường chạy ("production" | "development" | ...). Quyết định
	// cờ Secure của cookie phiên admin (Secure=true ở production).
	AppEnv string
}

// IsProduction cho biết có đang chạy ở môi trường production hay không (AppEnv
// == "production"). Dùng để bật cờ Secure trên cookie auth.
func (c *Config) IsProduction() bool {
	return c.AppEnv == "production"
}

// defaultTelegramAPIBase là host Telegram Bot API mặc định. Override qua
// TELEGRAM_API_BASE (chủ yếu để test trỏ vào mock server).
const defaultTelegramAPIBase = "https://api.telegram.org"

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

	tgAPIBase := os.Getenv("TELEGRAM_API_BASE")
	if tgAPIBase == "" {
		tgAPIBase = defaultTelegramAPIBase
	}

	return &Config{
		DatabaseURL:      dbURL,
		JWTSecret:        os.Getenv("JWT_SECRET"),
		TelegramBotToken: os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramChatID:   os.Getenv("TELEGRAM_CHAT_ID"),
		TelegramAPIBase:  tgAPIBase,
		Port:             port,
		AppEnv:           os.Getenv("APP_ENV"),
	}, nil
}
