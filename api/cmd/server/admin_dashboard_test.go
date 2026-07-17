package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/notify"
)

// fakeDashboardStore là dashboardStore giả cho handler test (không cần DB). Ghi lại
// việc đã gọi từng truy vấn và trả giá trị/lỗi cấu hình sẵn.
type fakeDashboardStore struct {
	newLeads     int64
	processing   int64
	revenue      int64
	newLeadsErr  error
	processErr   error
	revenueErr   error
	calledLeads  bool
	calledProc   bool
	calledRev    bool
}

func (f *fakeDashboardStore) CountNewLeads(context.Context) (int64, error) {
	f.calledLeads = true
	return f.newLeads, f.newLeadsErr
}
func (f *fakeDashboardStore) CountProcessingOrders(context.Context) (int64, error) {
	f.calledProc = true
	return f.processing, f.processErr
}
func (f *fakeDashboardStore) SumRevenueThisMonth(context.Context) (int64, error) {
	f.calledRev = true
	return f.revenue, f.revenueErr
}

// TestGetAdminDashboardShape: handler trả 3 con số đúng theo snake_case
// {new_leads, processing_orders, revenue_this_month} và gọi cả 3 truy vấn.
func TestGetAdminDashboardShape(t *testing.T) {
	f := &fakeDashboardStore{newLeads: 3, processing: 2, revenue: 1_500_000}
	srv := &Server{dashboard: f}
	rec := httptest.NewRecorder()
	srv.GetAdminDashboard(rec, httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q, want application/json", ct)
	}

	var got api.Dashboard
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.NewLeads != 3 {
		t.Errorf("new_leads = %d, want 3", got.NewLeads)
	}
	if got.ProcessingOrders != 2 {
		t.Errorf("processing_orders = %d, want 2", got.ProcessingOrders)
	}
	if got.RevenueThisMonth != 1_500_000 {
		t.Errorf("revenue_this_month = %d, want 1500000", got.RevenueThisMonth)
	}
	if !f.calledLeads || !f.calledProc || !f.calledRev {
		t.Errorf("chưa gọi đủ 3 truy vấn: leads=%v proc=%v rev=%v", f.calledLeads, f.calledProc, f.calledRev)
	}

	// Field name phải là snake_case (nhất quán với API) — kiểm tra JSON thô.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("unmarshal raw: %v", err)
	}
	for _, key := range []string{"new_leads", "processing_orders", "revenue_this_month"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("thiếu field %q trong JSON: %s", key, rec.Body.String())
		}
	}
}

// TestGetAdminDashboardZero: DB trống → cả 3 con số = 0 (không nil/thiếu field).
func TestGetAdminDashboardZero(t *testing.T) {
	f := &fakeDashboardStore{}
	srv := &Server{dashboard: f}
	rec := httptest.NewRecorder()
	srv.GetAdminDashboard(rec, httptest.NewRequest(http.MethodGet, "/x", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got api.Dashboard
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.NewLeads != 0 || got.ProcessingOrders != 0 || got.RevenueThisMonth != 0 {
		t.Errorf("got = %+v, want tất cả 0", got)
	}
}

// TestGetAdminDashboardQueryError: bất kỳ truy vấn nào lỗi → 500 JSON {error}, không
// lộ chi tiết nội bộ.
func TestGetAdminDashboardQueryError(t *testing.T) {
	tests := []struct {
		name  string
		store *fakeDashboardStore
	}{
		{"leads lỗi", &fakeDashboardStore{newLeadsErr: errors.New("boom")}},
		{"orders lỗi", &fakeDashboardStore{processErr: errors.New("boom")}},
		{"revenue lỗi", &fakeDashboardStore{revenueErr: errors.New("boom")}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := &Server{dashboard: tc.store}
			rec := httptest.NewRecorder()
			srv.GetAdminDashboard(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("code = %d, want 500", rec.Code)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body không phải JSON: %v", err)
			}
			if body["error"] == "" {
				t.Errorf("thiếu message error, body=%s", rec.Body.String())
			}
		})
	}
}

// TestGetAdminDashboardRequiresAuth: gọi /admin/dashboard KHÔNG cookie → 401 (middleware
// auth gác /admin/*). Đi qua router thật để bao gồm cả tầng middleware (REQ-DASH-001,
// REQ-AUTH-002).
func TestGetAdminDashboardRequiresAuth(t *testing.T) {
	handler := newRouter(nil, notify.NoopNotifier{}, []byte("test-secret-32-bytes-minimum-000"), false, t.TempDir())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401 (không cookie)", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q, want application/json", ct)
	}
}
