package notify_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/moonie/api/internal/notify"
)

// TestTelegramNotifierSendsMessage: NotifyNewLead POST đúng path
// /bot<token>/sendMessage, body JSON chứa chat_id + text (tên, SĐT đầy đủ, sản
// phẩm quan tâm, lời nhắn). Dùng httptest giả lập Telegram — KHÔNG gọi thật.
func TestTelegramNotifierSendsMessage(t *testing.T) {
	const token = "123456:ABC-FAKE"
	const chatID = "987654"

	var gotPath, gotChatID, gotText, gotContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		var payload struct {
			ChatID string `json:"chat_id"`
			Text   string `json:"text"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Errorf("mock telegram: body không phải JSON hợp lệ: %v", err)
		}
		gotChatID = payload.ChatID
		gotText = payload.Text
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	n := notify.NewTelegramNotifier(token, chatID, srv.URL)
	err := n.NotifyNewLead(context.Background(), notify.LeadInfo{
		Name:            "Nguyễn An",
		Phone:           "0912345678",
		ProductInterest: "vọng-nguyệt",
		Message:         "Cho tôi hỏi giá",
	})
	if err != nil {
		t.Fatalf("NotifyNewLead err = %v", err)
	}

	if want := "/bot" + token + "/sendMessage"; gotPath != want {
		t.Errorf("path = %q, want %q", gotPath, want)
	}
	if gotContentType != "application/json" {
		t.Errorf("content-type = %q, want application/json", gotContentType)
	}
	if gotChatID != chatID {
		t.Errorf("chat_id = %q, want %q", gotChatID, chatID)
	}
	for _, sub := range []string{"Nguyễn An", "0912345678", "vọng-nguyệt", "Cho tôi hỏi giá"} {
		if !strings.Contains(gotText, sub) {
			t.Errorf("text thiếu %q; text=%q", sub, gotText)
		}
	}
}

// TestTelegramNotifierNon200: Telegram trả != 200 → error (caller sẽ log, không
// chặn lead).
func TestTelegramNotifierNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	n := notify.NewTelegramNotifier("tok", "1", srv.URL)
	if err := n.NotifyNewLead(context.Background(), notify.LeadInfo{Name: "A", Phone: "0900000000"}); err == nil {
		t.Fatal("mong đợi error khi status != 200, got nil")
	}
}

// TestTelegramNotifierDeadEndpoint: endpoint chết → error nhanh, KHÔNG lộ bot
// token trong thông điệp lỗi (server không rò secret ra log).
func TestTelegramNotifierDeadEndpoint(t *testing.T) {
	// Port đóng: httptest server tạo rồi đóng ngay để lấy URL không ai nghe.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := srv.URL
	srv.Close()

	const token = "SECRET-TOKEN-123"
	n := notify.NewTelegramNotifier(token, "1", deadURL)

	done := make(chan error, 1)
	go func() {
		done <- n.NotifyNewLead(context.Background(), notify.LeadInfo{Name: "A", Phone: "0900000000"})
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("mong đợi error khi endpoint chết")
		}
		if strings.Contains(err.Error(), token) {
			t.Errorf("thông điệp lỗi lộ bot token: %v", err)
		}
	case <-time.After(notify.Timeout + 2*time.Second):
		t.Fatal("NotifyNewLead treo quá lâu — timeout không hoạt động")
	}
}

// TestNoopNotifier: luôn trả nil (không gửi gì).
func TestNoopNotifier(t *testing.T) {
	if err := (notify.NoopNotifier{}).NotifyNewLead(context.Background(), notify.LeadInfo{Phone: "0912345678"}); err != nil {
		t.Errorf("NoopNotifier err = %v, want nil", err)
	}
}
