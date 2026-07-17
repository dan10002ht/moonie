package httpx_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moonie/api/internal/httpx"
)

// newReq dựng request với RemoteAddr và (tuỳ chọn) header X-Forwarded-For.
func newReq(t *testing.T, remoteAddr, xff string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/leads", nil)
	r.RemoteAddr = remoteAddr
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	return r
}

func TestClientIPResolver_ClientIP(t *testing.T) {
	tests := []struct {
		name    string
		proxies []string
		remote  string
		xff     string
		want    string
	}{
		{
			name:    "trusted rỗng → luôn dùng RemoteAddr (bỏ qua XFF)",
			proxies: nil,
			remote:  "10.0.0.5:5555",
			xff:     "203.0.113.9",
			want:    "10.0.0.5",
		},
		{
			name:    "peer trusted (IP đơn) → lấy client từ XFF",
			proxies: []string{"10.0.0.5"},
			remote:  "10.0.0.5:5555",
			xff:     "203.0.113.9",
			want:    "203.0.113.9",
		},
		{
			name:    "peer trusted (CIDR) → lấy client từ XFF",
			proxies: []string{"10.0.0.0/8"},
			remote:  "10.9.9.9:4444",
			xff:     "203.0.113.9",
			want:    "203.0.113.9",
		},
		{
			name:    "peer KHÔNG trusted → bỏ qua XFF (chống spoof)",
			proxies: []string{"10.0.0.0/8"},
			remote:  "198.51.100.7:5555",
			xff:     "203.0.113.9",
			want:    "198.51.100.7",
		},
		{
			name:    "nhiều hop: bỏ các trusted proxy phải→trái, lấy client thật",
			proxies: []string{"10.0.0.0/8", "172.16.0.0/12"},
			remote:  "10.0.0.5:5555",
			// client → Caddy(172.16.0.1) → Next(10.0.0.6) → API
			xff:  "203.0.113.9, 172.16.0.1, 10.0.0.6",
			want: "203.0.113.9",
		},
		{
			name:    "spoof: client tự bơm IP giả ở đầu XFF, sau proxy tin cậy vẫn ra IP thật",
			proxies: []string{"10.0.0.0/8"},
			remote:  "10.0.0.5:5555",
			// "1.2.3.4" là client thật; "9.9.9.9" do client tự thêm để giả mạo thì nằm
			// bên trái 1.2.3.4 → không được chọn.
			xff:  "9.9.9.9, 1.2.3.4",
			want: "1.2.3.4",
		},
		{
			name:    "XFF rỗng khi peer trusted → fallback RemoteAddr",
			proxies: []string{"10.0.0.0/8"},
			remote:  "10.0.0.5:5555",
			xff:     "",
			want:    "10.0.0.5",
		},
		{
			name:    "XFF toàn trusted → fallback RemoteAddr",
			proxies: []string{"10.0.0.0/8"},
			remote:  "10.0.0.5:5555",
			xff:     "10.0.0.6, 10.0.0.7",
			want:    "10.0.0.5",
		},
		{
			name:    "XFF có entry hỏng ở vị trí client → fallback RemoteAddr (an toàn)",
			proxies: []string{"10.0.0.0/8"},
			remote:  "10.0.0.5:5555",
			xff:     "not-an-ip, 10.0.0.6",
			want:    "10.0.0.5",
		},
		{
			name:    "khoảng trắng quanh hop được trim",
			proxies: []string{"10.0.0.0/8"},
			remote:  "10.0.0.5:5555",
			xff:     "  203.0.113.9 ,  10.0.0.6  ",
			want:    "203.0.113.9",
		},
		{
			name:    "IPv6 peer trusted → lấy client IPv4 từ XFF",
			proxies: []string{"::1/128"},
			remote:  "[::1]:5555",
			xff:     "203.0.113.9",
			want:    "203.0.113.9",
		},
		{
			name:    "RemoteAddr không port → vẫn khớp trusted",
			proxies: []string{"10.0.0.5"},
			remote:  "10.0.0.5",
			xff:     "203.0.113.9",
			want:    "203.0.113.9",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolver, err := httpx.NewClientIPResolver(tt.proxies)
			if err != nil {
				t.Fatalf("NewClientIPResolver(%v) lỗi: %v", tt.proxies, err)
			}
			got := resolver.ClientIP(newReq(t, tt.remote, tt.xff))
			if got != tt.want {
				t.Errorf("ClientIP() = %q, want %q", got, tt.want)
			}

			// RateLimitKey phải khớp ClientIP và không bao giờ trả error.
			key, kerr := resolver.RateLimitKey(newReq(t, tt.remote, tt.xff))
			if kerr != nil {
				t.Errorf("RateLimitKey() error = %v, want nil", kerr)
			}
			if key != tt.want {
				t.Errorf("RateLimitKey() = %q, want %q", key, tt.want)
			}
		})
	}
}

func TestNewClientIPResolver_ParseErrors(t *testing.T) {
	tests := []struct {
		name    string
		proxies []string
		wantErr bool
	}{
		{name: "IP đơn hợp lệ", proxies: []string{"10.0.0.5"}, wantErr: false},
		{name: "CIDR hợp lệ", proxies: []string{"10.0.0.0/8"}, wantErr: false},
		{name: "bỏ qua phần tử rỗng/khoảng trắng", proxies: []string{"", "  ", "10.0.0.5"}, wantErr: false},
		{name: "IP sai định dạng", proxies: []string{"not-an-ip"}, wantErr: true},
		{name: "CIDR sai định dạng", proxies: []string{"10.0.0.0/999"}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := httpx.NewClientIPResolver(tt.proxies)
			if tt.wantErr && err == nil {
				t.Fatalf("mong đợi lỗi, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("mong đợi nil, got %v", err)
			}
		})
	}
}
