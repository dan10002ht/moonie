// Package httpx chứa helper viết response JSON chuẩn cho API.
package httpx

import (
	"encoding/json"
	"net/http"
)

// WriteJSON ghi v dưới dạng JSON kèm status code và header Content-Type.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	// Lỗi encode chỉ có thể xảy ra với kiểu không serialize được; header đã gửi
	// nên không thể đổi status. Bỏ qua có chủ đích để tránh double-write.
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError ghi lỗi API dạng JSON {"error": msg} kèm status code.
// msg là thông điệp an toàn hiển thị cho client, không leak internal (NFR-006).
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}
