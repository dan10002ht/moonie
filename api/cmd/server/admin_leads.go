package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/moonie/api/internal/api"
	"github.com/moonie/api/internal/httpx"
	"github.com/moonie/api/internal/notify"
	"github.com/moonie/api/internal/store"
)

// Phân trang leads (REQ-LEAD-004): mặc định 20, tối đa 100 (quy ước GĐ4). Vượt trần
// bị kẹp về 100 để một request không kéo cả bảng.
const (
	leadsDefaultLimit = 20
	leadsMaxLimit     = 100
)

// validLeadStatuses khớp CHECK constraint trong DB (0003_leads). Validate ở handler
// để trả 400 thân thiện thay vì 500 từ DB (REQ-LEAD-004).
var validLeadStatuses = map[string]bool{
	"new": true, "contacted": true, "converted": true, "closed": true,
}

// validOrderChannels khớp CHECK constraint orders.channel (0007_orders). Dùng để map
// lead.source → kênh đơn khi convert.
var validOrderChannels = map[string]bool{
	"website": true, "phone": true, "zalo": true, "fb": true,
}

// leadAdminStore là phần store handler leads admin cần (đọc/cập nhật, không tx).
// Tách qua interface để inject fake trong handler test (không cần Postgres).
type leadAdminStore interface {
	ListLeadsAdmin(ctx context.Context, arg store.ListLeadsAdminParams) ([]store.Lead, error)
	CountLeads(ctx context.Context) (int64, error)
	GetLead(ctx context.Context, id pgtype.UUID) (store.Lead, error)
	UpdateLeadStatus(ctx context.Context, arg store.UpdateLeadStatusParams) (store.Lead, error)
}

// leadConverter thực hiện convert lead → đơn nháp TRONG transaction. Tách qua
// interface để handler test bằng fake (transaction thật kiểm ở integration test).
type leadConverter interface {
	ConvertLead(ctx context.Context, arg store.ConvertLeadParams) (store.Order, error)
}

// poolLeadConverter là leadConverter thật: chạy store.ConvertLead trên pool DB.
type poolLeadConverter struct{ pool store.Beginner }

func (c poolLeadConverter) ConvertLead(ctx context.Context, arg store.ConvertLeadParams) (store.Order, error) {
	return store.ConvertLead(ctx, c.pool, arg)
}

// ListAdminLeads phục vụ GET /api/v1/admin/leads: leads phân trang, mới nhất trước,
// trả {items, total}. Cần auth (middleware gác) (REQ-LEAD-004).
func (s *Server) ListAdminLeads(w http.ResponseWriter, r *http.Request, params api.ListAdminLeadsParams) {
	limit := leadsDefaultLimit
	if params.Limit != nil {
		limit = *params.Limit
	}
	if limit < 1 {
		limit = leadsDefaultLimit
	}
	if limit > leadsMaxLimit {
		limit = leadsMaxLimit
	}
	offset := 0
	if params.Offset != nil && *params.Offset > 0 {
		offset = *params.Offset
	}

	rows, err := s.leadAdmin.ListLeadsAdmin(r.Context(), store.ListLeadsAdminParams{
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		log.Printf("list admin leads: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách leads")
		return
	}
	total, err := s.leadAdmin.CountLeads(r.Context())
	if err != nil {
		log.Printf("count leads: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không lấy được danh sách leads")
		return
	}

	items := make([]api.Lead, 0, len(rows))
	for _, row := range rows {
		items = append(items, toAPILead(row))
	}
	httpx.WriteJSON(w, http.StatusOK, api.LeadList{Items: items, Total: total})
}

// UpdateLeadStatus phục vụ PATCH /api/v1/admin/leads/{id}: đổi trạng thái lead sau
// khi validate enum. Trạng thái lạ → 400, không tìm thấy → 404 (REQ-LEAD-004).
func (s *Server) UpdateLeadStatus(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	var in api.LeadStatusInput
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	if err := dec.Decode(&in); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "dữ liệu gửi lên không hợp lệ")
		return
	}
	status := strings.TrimSpace(in.Status)
	if !validLeadStatuses[status] {
		httpx.WriteError(w, http.StatusBadRequest, "trạng thái không hợp lệ (new, contacted, converted hoặc closed)")
		return
	}

	row, err := s.leadAdmin.UpdateLeadStatus(r.Context(), store.UpdateLeadStatusParams{
		ID:     pgUUID(id),
		Status: status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy lead")
			return
		}
		log.Printf("update lead status: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không cập nhật được trạng thái, vui lòng thử lại")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAPILead(row))
}

// convertMaxRetries giới hạn số lần sinh lại mã đơn khi trùng UNIQUE(code) — cực hiếm
// (4 ký tự ngẫu nhiên), nhưng retry vài lần để convert không fail vì đụng mã.
const convertMaxRetries = 5

// ConvertLead phục vụ POST /api/v1/admin/leads/{id}/convert: tạo đơn NHÁP từ lead
// trong transaction (order + cập nhật lead atomic), rồi bắn Telegram thông báo đơn
// mới (fail-safe). Lead đã convert → 409, không tìm thấy → 404 (REQ-LEAD-005,
// REQ-NOTI-002).
func (s *Server) ConvertLead(w http.ResponseWriter, r *http.Request, id openapi_types.UUID) {
	lead, err := s.leadAdmin.GetLead(r.Context(), pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "không tìm thấy lead")
			return
		}
		log.Printf("convert lead (get): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không convert được lead, vui lòng thử lại")
		return
	}

	// Chặn convert 2 lần: lead đã 'converted' hoặc đã gắn order_id → 409.
	if lead.Status == "converted" || lead.OrderID.Valid {
		httpx.WriteError(w, http.StatusConflict, "lead này đã được convert thành đơn trước đó")
		return
	}

	channel := channelFromSource(lead.Source)
	note := leadNote(lead)

	// Retry sinh mã đơn khi đụng UNIQUE(code). Mỗi lần gọi mở transaction mới —
	// unique violation làm abort tx nên phải chạy lại toàn bộ với mã khác.
	var order store.Order
	for attempt := 0; ; attempt++ {
		order, err = s.leadConvert.ConvertLead(r.Context(), store.ConvertLeadParams{
			LeadID:  pgUUID(id),
			Code:    generateOrderCode(time.Now()),
			Channel: channel,
			Note:    note,
		})
		if err == nil {
			break
		}
		if isUniqueViolation(err) && attempt < convertMaxRetries {
			continue
		}
		log.Printf("convert lead (tx): %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "không convert được lead, vui lòng thử lại")
		return
	}

	// FAIL-SAFE (REQ-NOTI-002): bắn Telegram đơn mới SAU khi commit, bất đồng bộ với
	// context riêng — lỗi/treo notify KHÔNG ảnh hưởng response.
	s.notifyNewOrder(notify.OrderInfo{
		Code:    order.Code,
		Name:    lead.Name,
		Phone:   lead.Phone,
		Total:   order.Total,
		Channel: order.Channel,
	})

	httpx.WriteJSON(w, http.StatusCreated, api.ConvertLeadResult{
		OrderId:   openapi_types.UUID(order.ID.Bytes),
		OrderCode: order.Code,
	})
}

// notifyNewOrder gửi thông báo đơn mới bất đồng bộ (fail-safe như notifyNewLead).
// Guard nil để Server dựng trong test không panic.
func (s *Server) notifyNewOrder(order notify.OrderInfo) {
	if s.notifier == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), notify.Timeout)
		defer cancel()
		if err := s.notifier.NotifyNewOrder(ctx, order); err != nil {
			log.Printf("notify đơn mới thất bại (bỏ qua, đơn đã lưu): mã=%s: %v", order.Code, err)
		}
	}()
}

// channelFromSource map lead.source → kênh đơn hợp lệ (website/phone/zalo/fb).
// Không khớp → 'website' (mặc định an toàn) (REQ-LEAD-005).
func channelFromSource(source string) string {
	s := strings.ToLower(strings.TrimSpace(source))
	if validOrderChannels[s] {
		return s
	}
	return "website"
}

// leadNote gộp thông tin liên hệ lead vào order.note (vì convert KHÔNG tạo customer,
// order.customer_id NULL — thông tin khách lưu ở note để chủ shop liên hệ).
func leadNote(lead store.Lead) string {
	var b strings.Builder
	b.WriteString("Từ lead: " + lead.Name)
	b.WriteString(" · SĐT: " + lead.Phone)
	if lead.ProductInterest != nil && strings.TrimSpace(*lead.ProductInterest) != "" {
		b.WriteString(" · Quan tâm: " + *lead.ProductInterest)
	}
	if lead.Message != nil && strings.TrimSpace(*lead.Message) != "" {
		b.WriteString(" · " + *lead.Message)
	}
	return b.String()
}

// orderCodeAlphabet: ký tự hậu tố mã đơn — chữ HOA + số, bỏ ký tự dễ nhầm (0/O, 1/I)
// để chủ shop đọc/gõ tay không lẫn.
const orderCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// generateOrderCode sinh mã đơn dạng MC-YYYYMMDD-xxxx (4 ký tự ngẫu nhiên). Trùng thì
// caller retry. Dùng crypto/rand để không đoán được mã đơn từ bên ngoài.
func generateOrderCode(now time.Time) string {
	suffix := make([]byte, 4)
	buf := make([]byte, 4)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand fail là cực hiếm; fallback theo nano để không panic.
		nano := now.UnixNano()
		for i := range buf {
			buf[i] = byte(nano >> (8 * i))
		}
	}
	for i, b := range buf {
		suffix[i] = orderCodeAlphabet[int(b)%len(orderCodeAlphabet)]
	}
	return "MC-" + now.Format("20060102") + "-" + string(suffix)
}

// toAPILead map store.Lead → api.Lead (kiểu sinh từ openapi). pgtype → kiểu API.
func toAPILead(l store.Lead) api.Lead {
	out := api.Lead{
		Id:              openapi_types.UUID(l.ID.Bytes),
		Name:            l.Name,
		Phone:           l.Phone,
		Message:         l.Message,
		ProductInterest: l.ProductInterest,
		Source:          l.Source,
		Status:          api.LeadStatus(l.Status),
		CreatedAt:       l.CreatedAt.Time,
	}
	if l.OrderID.Valid {
		oid := openapi_types.UUID(l.OrderID.Bytes)
		out.OrderId = &oid
	}
	return out
}
