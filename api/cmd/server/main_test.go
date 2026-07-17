package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouter(t *testing.T) {
	handler := newRouter(nil)

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantKey    string
		wantVal    string
	}{
		{name: "healthz ok", method: http.MethodGet, path: "/api/v1/healthz", wantStatus: http.StatusOK, wantKey: "status", wantVal: "ok"},
		{name: "unknown path 404", method: http.MethodGet, path: "/api/v1/khong-ton-tai", wantStatus: http.StatusNotFound, wantKey: "error", wantVal: "không tìm thấy"},
		{name: "wrong method 405", method: http.MethodPost, path: "/api/v1/healthz", wantStatus: http.StatusMethodNotAllowed, wantKey: "error", wantVal: "phương thức không được hỗ trợ"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			handler.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("code = %d, want %d", rec.Code, tt.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content-type = %q, want application/json", ct)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if body[tt.wantKey] != tt.wantVal {
				t.Fatalf("body[%q] = %q, want %q", tt.wantKey, body[tt.wantKey], tt.wantVal)
			}
		})
	}
}
