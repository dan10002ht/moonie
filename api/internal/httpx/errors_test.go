package httpx_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moonie/api/internal/httpx"
)

func TestWriteError(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		msg     string
		wantMsg string
	}{
		{name: "bad request", status: http.StatusBadRequest, msg: "phone không hợp lệ", wantMsg: "phone không hợp lệ"},
		{name: "not found", status: http.StatusNotFound, msg: "không tìm thấy", wantMsg: "không tìm thấy"},
		{name: "internal", status: http.StatusInternalServerError, msg: "lỗi hệ thống", wantMsg: "lỗi hệ thống"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			httpx.WriteError(rec, tt.status, tt.msg)

			if rec.Code != tt.status {
				t.Fatalf("code = %d, want %d", rec.Code, tt.status)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content-type = %q, want application/json", ct)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if body["error"] != tt.wantMsg {
				t.Fatalf("body[error] = %q, want %q", body["error"], tt.wantMsg)
			}
		})
	}
}

func TestWriteJSON(t *testing.T) {
	tests := []struct {
		name   string
		status int
		v      any
		want   string
	}{
		{name: "health ok", status: http.StatusOK, v: map[string]string{"status": "ok"}, want: `{"status":"ok"}`},
		{name: "created", status: http.StatusCreated, v: map[string]int{"id": 1}, want: `{"id":1}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			httpx.WriteJSON(rec, tt.status, tt.v)

			if rec.Code != tt.status {
				t.Fatalf("code = %d, want %d", rec.Code, tt.status)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content-type = %q, want application/json", ct)
			}
			var got, want map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("unmarshal got: %v", err)
			}
			if err := json.Unmarshal([]byte(tt.want), &want); err != nil {
				t.Fatalf("unmarshal want: %v", err)
			}
			for k, v := range want {
				if got[k] != v {
					t.Fatalf("body[%q] = %v, want %v", k, got[k], v)
				}
			}
		})
	}
}
