package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/notify"
	"github.com/moonie/api/internal/store"
	"github.com/moonie/api/internal/validate"
)

// messageMaxLen giới hạn độ dài lời nhắn để chống payload rác (NFR-004).
const messageMaxLen = 1000

// nameMaxLen giới hạn độ dài tên.
const nameMaxLen = 200

// leadCreator là phần store mà handler lead cần. Tách qua interface để inject fake
// trong test (không cần Postgres cho handler test).
type leadCreator interface {
	CreateLead(ctx context.Context, arg store.CreateLeadParams) (store.CreateLeadRow, error)
}

// CreateLead phục vụ POST /api/v1/leads → nhận form liên hệ public, validate và lưu
// lead trạng thái 'new' (REQ-LEAD-001/002/003). Rate limit áp ở tầng router. Public.
func (s *Server) CreateLead(w http.ResponseWriter, r *http.Request) {
	var in api.LeadInput
	// Giới hạn body để tránh đọc payload khổng lồ.
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024))
	if err := dec.Decode(&in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "dữ liệu gửi lên không hợp lệ")
		return
	}

	name := strings.TrimSpace(in.Name)
	if err := validate.RequiredName(name); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "vui lòng nhập tên")
		return
	}
	if err := validate.MaxLen(name, nameMaxLen); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "tên quá dài")
		return
	}

	phone := strings.TrimSpace(in.Phone)
	if err := validate.Phone(phone); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "số điện thoại không hợp lệ")
		return
	}

	if in.Message != nil {
		if err := validate.MaxLen(*in.Message, messageMaxLen); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "lời nhắn quá dài")
			return
		}
	}

	row, err := s.leads.CreateLead(r.Context(), store.CreateLeadParams{
		Name:            name,
		Phone:           phone,
		Message:         in.Message,
		ProductInterest: in.ProductInterest,
	})
	if err != nil {
		log.Printf("create lead: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không tạo được lead, vui lòng thử lại")
		return
	}

	// NFR-009: chỉ log 4 số cuối SĐT, không bao giờ log đầy đủ.
	log.Printf("lead mới: id=%s sđt=%s", openapi_types.UUID(row.ID.Bytes), maskPhone(phone))

	// FAIL-SAFE (REQ-NOTI-001, NFR-001): bắn Telegram SAU khi lưu lead thành công,
	// trong goroutine với context.Background + timeout riêng — KHÔNG dùng r.Context()
	// (request kết thúc ngay khi trả 201). Lỗi/treo notify không ảnh hưởng response:
	// POST /leads trả 201 ngay, không chờ Telegram.
	s.notifyNewLead(notify.LeadInfo{
		Name:            name,
		Phone:           phone,
		Message:         derefString(in.Message),
		ProductInterest: derefString(in.ProductInterest),
	})

	httpx.WriteJSON(w, http.StatusCreated, api.LeadCreated{Id: openapi_types.UUID(row.ID.Bytes)})
}

// notifyNewLead gửi thông báo lead mới bất đồng bộ. Guard nil để Server dựng trong
// test (không set notifier) không panic. Timeout riêng để notify treo không rò
// goroutine vô hạn. Lỗi chỉ log (mask SĐT theo NFR-009), không lan ra response.
func (s *Server) notifyNewLead(lead notify.LeadInfo) {
	if s.notifier == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), notify.Timeout)
		defer cancel()
		if err := s.notifier.NotifyNewLead(ctx, lead); err != nil {
			log.Printf("notify lead mới thất bại (bỏ qua, lead đã lưu): sđt=%s: %v", maskPhone(lead.Phone), err)
		}
	}()
}

// derefString trả giá trị con trỏ string, hoặc "" nếu nil.
func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// maskPhone che toàn bộ SĐT trừ 4 chữ số cuối (NFR-009). Dùng khi log.
func maskPhone(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 4 {
		return strings.Repeat("*", len(s))
	}
	return strings.Repeat("*", len(s)-4) + s[len(s)-4:]
}
