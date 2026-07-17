package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// DefaultAPIBase là host Telegram Bot API mặc định. Override qua TELEGRAM_API_BASE
// (config) để test trỏ vào mock server — không hardcode trong lời gọi.
const DefaultAPIBase = "https://api.telegram.org"

// TelegramNotifier gửi thông báo qua Telegram Bot API sendMessage. HTTP client có
// timeout riêng (notify.Timeout) để một Telegram chậm/treo không kéo dài request.
type TelegramNotifier struct {
	token   string
	chatID  string
	apiBase string
	client  *http.Client
}

// NewTelegramNotifier tạo notifier gửi tới <apiBase>/bot<token>/sendMessage.
// apiBase rỗng → dùng DefaultAPIBase.
func NewTelegramNotifier(token, chatID, apiBase string) *TelegramNotifier {
	if apiBase == "" {
		apiBase = DefaultAPIBase
	}
	return &TelegramNotifier{
		token:   token,
		chatID:  chatID,
		apiBase: strings.TrimRight(apiBase, "/"),
		client:  &http.Client{Timeout: Timeout},
	}
}

// NotifyNewLead POST chat_id + text tới sendMessage. Text chứa SĐT đầy đủ (mục
// đích: chủ shop gọi lại khách). Lỗi mạng được bóc *url.Error để KHÔNG log URL
// (chứa bot token) — server không lộ secret ra log.
func (t *TelegramNotifier) NotifyNewLead(ctx context.Context, lead LeadInfo) error {
	payload := map[string]string{
		"chat_id": t.chatID,
		"text":    formatLeadMessage(lead),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("notify telegram: marshal payload: %w", err)
	}

	endpoint := fmt.Sprintf("%s/bot%s/sendMessage", t.apiBase, t.token)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		// http.NewRequestWithContext trả *url.Error khi URL dị dạng (apiBase/token
		// chứa ký tự lạ); Error() của nó chứa NGUYÊN URL kèm token → phải bóc lấy
		// nguyên nhân gốc để không rò token ra log.
		return fmt.Errorf("notify telegram: build request: %w", stripURLError(err))
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		// *url.Error.Error() bao gồm URL (có token) → chỉ dùng nguyên nhân gốc.
		return fmt.Errorf("notify telegram: request failed: %w", stripURLError(err))
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		// Drain body để http keep-alive tái dùng được kết nối (không rò connection).
		_, _ = io.Copy(io.Discard, resp.Body)
		return fmt.Errorf("notify telegram: unexpected status %d", resp.StatusCode)
	}
	return nil
}

// stripURLError bóc *url.Error (Error() của nó chứa nguyên URL kèm bot token) và
// trả về nguyên nhân gốc, để thông điệp lỗi log ra KHÔNG bao giờ lộ token. Lỗi
// không phải *url.Error thì trả nguyên trạng.
func stripURLError(err error) error {
	var uerr *url.Error
	if errors.As(err, &uerr) {
		return uerr.Err
	}
	return err
}

// formatLeadMessage dựng nội dung tiếng Việt gửi cho chủ shop. Chứa SĐT đầy đủ
// theo mục đích nghiệp vụ (chủ cần gọi lại khách).
func formatLeadMessage(lead LeadInfo) string {
	var b strings.Builder
	b.WriteString("🌙 Lead mới — Mooni Cake\n")
	b.WriteString("Tên: " + lead.Name + "\n")
	b.WriteString("SĐT: " + lead.Phone)
	if lead.ProductInterest != "" {
		b.WriteString("\nQuan tâm: " + lead.ProductInterest)
	}
	if lead.Message != "" {
		b.WriteString("\nLời nhắn: " + lead.Message)
	}
	return b.String()
}
