package main

import (
	"context"
	"log"
	"net/http"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/httpx"
)

// dashboardStore là phần store handler dashboard cần: 3 truy vấn tổng hợp đã có từ
// Task 1 (không tạo query mới). Tách qua interface để inject fake trong handler test
// (không cần Postgres).
type dashboardStore interface {
	CountNewLeads(ctx context.Context) (int64, error)
	CountProcessingOrders(ctx context.Context) (int64, error)
	SumRevenueThisMonth(ctx context.Context) (int64, error)
}

// GetAdminDashboard phục vụ GET /api/v1/admin/dashboard: trả 3 chỉ số tổng quan —
// leads mới (status='new'), đơn đang xử lý (status ∈ {confirmed, delivering}), và
// doanh thu tháng hiện tại (tổng total đơn 'done' trong tháng, neo giờ VN). Cần auth
// (middleware gác /admin/* → thiếu/sai cookie đã bị chặn 401 trước khi tới đây)
// (REQ-DASH-001).
func (s *Server) GetAdminDashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	newLeads, err := s.dashboard.CountNewLeads(ctx)
	if err != nil {
		log.Printf("dashboard count new leads: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được số liệu tổng quan")
		return
	}
	processingOrders, err := s.dashboard.CountProcessingOrders(ctx)
	if err != nil {
		log.Printf("dashboard count processing orders: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được số liệu tổng quan")
		return
	}
	revenue, err := s.dashboard.SumRevenueThisMonth(ctx)
	if err != nil {
		log.Printf("dashboard sum revenue this month: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được số liệu tổng quan")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, api.Dashboard{
		NewLeads:         newLeads,
		ProcessingOrders: processingOrders,
		RevenueThisMonth: revenue,
	})
}
