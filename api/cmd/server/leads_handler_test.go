package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/store"
)

// fakeLeadCreator là leadCreator giả cho handler test (không cần DB).
type fakeLeadCreator struct {
	got store.CreateLeadParams
	row store.CreateLeadRow
	err error
}

func (f *fakeLeadCreator) CreateLead(_ context.Context, arg store.CreateLeadParams) (store.CreateLeadRow, error) {
	f.got = arg
	return f.row, f.err
}

func postLead(srv *Server, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/leads", strings.NewReader(body))
	srv.CreateLead(rec, req)
	return rec
}

// TestCreateLeadHappy: body hợp lệ → 201 + id; store nhận đúng tham số (trim tên).
func TestCreateLeadHappy(t *testing.T) {
	rawID := [16]byte{0x2d, 0xe8, 0x5a, 0xe8, 0xb1, 0xa8, 0x4d, 0xd7, 0xb8, 0xc3, 0x20, 0xdc, 0xf8, 0xb0, 0x4d, 0xeb}
	fake := &fakeLeadCreator{row: store.CreateLeadRow{ID: pgtype.UUID{Bytes: rawID, Valid: true}, Status: "new"}}
	srv := &Server{leads: fake}

	rec := postLead(srv, `{"name":"  Nguyễn An  ","phone":"0912345678","message":"Cho tôi hỏi giá","product_interest":"vong-nguyet"}`)

	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	var out api.LeadCreated
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Id != rawID {
		t.Errorf("id = %v, want %v", out.Id, rawID)
	}
	if fake.got.Name != "Nguyễn An" {
		t.Errorf("store Name = %q, want trimmed %q", fake.got.Name, "Nguyễn An")
	}
	if fake.got.Phone != "0912345678" {
		t.Errorf("store Phone = %q", fake.got.Phone)
	}
	if fake.got.ProductInterest == nil || *fake.got.ProductInterest != "vong-nguyet" {
		t.Errorf("store ProductInterest = %v", fake.got.ProductInterest)
	}
}

// TestCreateLeadValidation: các case 400. Không được gọi store khi validate fail.
func TestCreateLeadValidation(t *testing.T) {
	longMsg := strings.Repeat("a", messageMaxLen+1)
	tests := []struct {
		name string
		body string
	}{
		{"thiếu tên", `{"phone":"0912345678"}`},
		{"tên rỗng", `{"name":"   ","phone":"0912345678"}`},
		{"thiếu SĐT", `{"name":"An"}`},
		{"SĐT sai định dạng", `{"name":"An","phone":"12345"}`},
		{"SĐT có chữ", `{"name":"An","phone":"09123abc78"}`},
		{"lời nhắn quá dài", `{"name":"An","phone":"0912345678","message":"` + longMsg + `"}`},
		{"JSON hỏng", `{not json`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeLeadCreator{}
			srv := &Server{leads: fake}
			rec := postLead(srv, tt.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400", rec.Code)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if body["error"] == "" {
				t.Errorf("thiếu field error trong JSON lỗi")
			}
			if fake.got.Name != "" || fake.got.Phone != "" {
				t.Errorf("store KHÔNG được gọi khi validate fail, nhưng got=%+v", fake.got)
			}
		})
	}
}

// TestCreateLeadStoreError: store lỗi → 500 JSON {error} không leak internal.
func TestCreateLeadStoreError(t *testing.T) {
	fake := &fakeLeadCreator{err: errors.New("db down: 10.0.0.1")}
	srv := &Server{leads: fake}
	rec := postLead(srv, `{"name":"An","phone":"0912345678"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "10.0.0.1") {
		t.Errorf("response leak internal: %s", rec.Body.String())
	}
}

// TestMaskPhone: NFR-009 — chỉ lộ 4 số cuối.
func TestMaskPhone(t *testing.T) {
	tests := []struct{ in, want string }{
		{"0912345678", "******5678"},
		{"+84912345678", "********5678"},
		{"1234", "****"},
		{"12", "**"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := maskPhone(tt.in); got != tt.want {
			t.Errorf("maskPhone(%q) = %q, want %q", tt.in, got, tt.want)
		}
		// Không bao giờ lộ trọn số > 4 chữ số.
		if len(tt.in) > 4 && strings.Contains(maskPhone(tt.in), strings.TrimPrefix(tt.in, "+")) {
			t.Errorf("maskPhone(%q) lộ full SĐT", tt.in)
		}
	}
}

// TestLeadsRateLimit: middleware chặn khi vượt ngưỡng, trả 429 JSON {error}; các
// route khác (path khác) không bị ảnh hưởng.
func TestLeadsRateLimit(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
	h := rateLimitPath(http.MethodPost, "/api/v1/leads", newLeadsRateLimiter(testClientIP().RateLimitKey))(next)

	fire := func(path string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.RemoteAddr = "203.0.113.9:5555"
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	// leadsRateLimit request đầu tiên phải qua.
	for i := 0; i < leadsRateLimit; i++ {
		if code := fire("/api/v1/leads"); code != http.StatusCreated {
			t.Fatalf("request %d: code = %d, want 201", i+1, code)
		}
	}
	// Request kế tiếp vượt ngưỡng → 429 JSON {error}.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/leads", nil)
	req.RemoteAddr = "203.0.113.9:5555"
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("vượt ngưỡng: code = %d, want 429", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["error"] == "" {
		t.Errorf("429 phải là JSON {error}, got %s", rec.Body.String())
	}

	// Path khác không bị rate limit (dù cùng IP đã vượt ngưỡng ở /leads).
	if code := fire("/api/v1/products"); code != http.StatusCreated {
		t.Errorf("route khác bị rate limit oan: code = %d", code)
	}
}
