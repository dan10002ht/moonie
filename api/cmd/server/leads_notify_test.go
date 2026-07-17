package main

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/moonie/api/internal/notify"
	"github.com/moonie/api/internal/store"
)

// fakeNotifier ghi lại lần gọi NotifyNewLead qua channel để test đồng bộ với
// goroutine notify bất đồng bộ trong handler.
type fakeNotifier struct {
	calls chan notify.LeadInfo
	err   error
}

func newFakeNotifier(err error) *fakeNotifier {
	return &fakeNotifier{calls: make(chan notify.LeadInfo, 1), err: err}
}

func (f *fakeNotifier) NotifyNewLead(_ context.Context, lead notify.LeadInfo) error {
	f.calls <- lead
	return f.err
}

// NotifyNewOrder thỏa interface notify.Notifier; test lead không dùng tới nên no-op.
func (f *fakeNotifier) NotifyNewOrder(_ context.Context, _ notify.OrderInfo) error {
	return nil
}

func validLeadRow() store.CreateLeadRow {
	rawID := [16]byte{0x2d, 0xe8, 0x5a, 0xe8, 0xb1, 0xa8, 0x4d, 0xd7, 0xb8, 0xc3, 0x20, 0xdc, 0xf8, 0xb0, 0x4d, 0xeb}
	return store.CreateLeadRow{ID: pgtype.UUID{Bytes: rawID, Valid: true}, Status: "new"}
}

// TestCreateLeadNotifiesOnce: POST /leads thành công → NotifyNewLead được gọi
// đúng 1 lần với nội dung tên + SĐT + sản phẩm quan tâm.
func TestCreateLeadNotifiesOnce(t *testing.T) {
	fake := &fakeLeadCreator{row: validLeadRow()}
	notifier := newFakeNotifier(nil)
	srv := &Server{leads: fake, notifier: notifier}

	rec := postLead(srv, `{"name":"Nguyễn An","phone":"0912345678","message":"hỏi giá","product_interest":"vong-nguyet"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}

	select {
	case got := <-notifier.calls:
		if got.Name != "Nguyễn An" {
			t.Errorf("notify Name = %q", got.Name)
		}
		if got.Phone != "0912345678" {
			t.Errorf("notify Phone = %q", got.Phone)
		}
		if got.ProductInterest != "vong-nguyet" {
			t.Errorf("notify ProductInterest = %q", got.ProductInterest)
		}
		if got.Message != "hỏi giá" {
			t.Errorf("notify Message = %q", got.Message)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("NotifyNewLead không được gọi trong 2s")
	}

	// Không được gọi lần thứ hai.
	select {
	case <-notifier.calls:
		t.Error("NotifyNewLead bị gọi nhiều hơn 1 lần")
	case <-time.After(100 * time.Millisecond):
	}
}

// TestCreateLeadNotifyErrorStill201: notifier trả error → POST /leads VẪN 201
// (fail-safe, lead đã lưu).
func TestCreateLeadNotifyErrorStill201(t *testing.T) {
	fake := &fakeLeadCreator{row: validLeadRow()}
	notifier := newFakeNotifier(errors.New("telegram down"))
	srv := &Server{leads: fake, notifier: notifier}

	rec := postLead(srv, `{"name":"An","phone":"0912345678"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("notify lỗi vẫn phải 201; code = %d, body=%s", rec.Code, rec.Body.String())
	}
	select {
	case <-notifier.calls:
	case <-time.After(2 * time.Second):
		t.Fatal("NotifyNewLead không được gọi")
	}
}

// TestCreateLeadNilNotifier: Server không set notifier → không panic, vẫn 201.
func TestCreateLeadNilNotifier(t *testing.T) {
	fake := &fakeLeadCreator{row: validLeadRow()}
	srv := &Server{leads: fake}
	rec := postLead(srv, `{"name":"An","phone":"0912345678"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, want 201", rec.Code)
	}
}

// TestCreateLeadNoNotifyOnValidationError: validate fail (thiếu tên) → không gọi
// notifier (chỉ notify khi lead đã lưu).
func TestCreateLeadNoNotifyOnValidationError(t *testing.T) {
	fake := &fakeLeadCreator{row: validLeadRow()}
	notifier := newFakeNotifier(nil)
	srv := &Server{leads: fake, notifier: notifier}

	rec := postLead(srv, `{"phone":"0912345678"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
	select {
	case <-notifier.calls:
		t.Error("KHÔNG được notify khi validate fail")
	case <-time.After(200 * time.Millisecond):
	}
}
