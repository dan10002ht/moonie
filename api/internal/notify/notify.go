// Package notify gửi thông báo khi có lead mới (REQ-NOTI-001). Được inject qua
// interface Notifier để handler test bằng fake, không cần token/HTTP thật.
package notify

import (
	"context"
	"log"
	"strings"
	"time"
)

// Timeout là thời gian tối đa cho một lần gửi thông báo. Đủ để thoả NFR-001
// (< 5s) mà không bao giờ để notify treo request quá lâu.
const Timeout = 5 * time.Second

// LeadInfo là dữ liệu lead cần cho nội dung thông báo. Tách khỏi model store để
// package notify không phụ thuộc tầng DB.
type LeadInfo struct {
	Name            string
	Phone           string
	Message         string
	ProductInterest string
}

// OrderInfo là dữ liệu đơn cần cho nội dung thông báo đơn mới (REQ-NOTI-002).
// Tách khỏi model store để package notify không phụ thuộc tầng DB. Total tính bằng
// VND (số nguyên); với đơn nháp convert-từ-lead Total = 0.
type OrderInfo struct {
	Code    string
	Name    string
	Phone   string
	Total   int64
	Channel string
}

// Notifier gửi thông báo lead mới hoặc đơn mới. Trả error để caller log; caller
// PHẢI coi lỗi notify là non-fatal (nghiệp vụ vẫn thành công dù notify lỗi).
type Notifier interface {
	NotifyNewLead(ctx context.Context, lead LeadInfo) error
	NotifyNewOrder(ctx context.Context, order OrderInfo) error
}

// NoopNotifier không gửi gì — dùng khi thiếu TELEGRAM_BOT_TOKEN. Log cảnh báo
// (chỉ 4 số cuối SĐT theo NFR-009) rồi trả nil để không chặn luồng tạo lead.
type NoopNotifier struct{}

// NotifyNewLead log "skip" và trả nil (no-op).
func (NoopNotifier) NotifyNewLead(_ context.Context, lead LeadInfo) error {
	log.Printf("notify skipped (no token): lead mới sđt=%s", maskPhone(lead.Phone))
	return nil
}

// NotifyNewOrder log "skip" và trả nil (no-op).
func (NoopNotifier) NotifyNewOrder(_ context.Context, order OrderInfo) error {
	log.Printf("notify skipped (no token): đơn mới %s sđt=%s", order.Code, maskPhone(order.Phone))
	return nil
}

// maskPhone che toàn bộ SĐT trừ 4 chữ số cuối (NFR-009). Dùng khi LOG phía server;
// KHÁC với text gửi cho chủ shop qua Telegram (được phép chứa SĐT đầy đủ).
func maskPhone(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 4 {
		return strings.Repeat("*", len(s))
	}
	return strings.Repeat("*", len(s)-4) + s[len(s)-4:]
}
