# 05 — Traceability Matrix — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `3946927`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> ⚠️ **GĐ1 (Scaffold) 8/8 + GĐ2 (API Public) 4/4 + GĐ3 (Landing) 4/4 đã xong** (BRIEF.md, CHANGELOG 2026-07-17). Các dòng đã chạm được điền Task + commit + test/gate. `tests/heldout/` do qa-evaluator sở hữu; GĐ2 đã có test nghiệp vụ cho products/leads/notify; GĐ3 form đặt hàng qua qa-evaluator held-out + mọi task UI qua design-evaluator (≥8/10).
> Cột "GĐ": bước triển khai dự kiến theo spec §8 (1 Scaffold · 2 API nền · 3 Landing · 4 Auth+API admin · 5 Admin UI · 6 Deploy). Một số hạ tầng (sqlc, error JSON) spec xếp GĐ2 nhưng đã làm sẵn ở GĐ1 để dựng đường ống — cột GĐ giữ giá trị dự kiến, cột Trạng thái phản ánh thực tại.

> **Ghi nhận thực tại GĐ1** (không sửa yêu cầu, chỉ ghi để chủ dự án nắm):
> - Go floor **1.23 → 1.25** (testcontainers-go v0.43 yêu cầu), pgx → v5.9.2. CI setup-go đọc `go.mod` = 1.25.
> - Local build/test/lint bắt buộc `CGO_ENABLED=0` (shim `cc` phá cgo); testcontainers trên Colima cần `DOCKER_HOST`+`SOCKET_OVERRIDE`. Chi tiết: `Makefile`, PROGRESS §"Ghi chú kỹ thuật".
> - CI chưa chạy trên GitHub thật (chưa có remote) — mới verify bằng lệnh local. **Cập nhật GĐ2:** remote đã có (`github.com/dan10002ht/moonie`), CI GitHub xanh thật.

> **Ghi nhận thực tại GĐ2** (không sửa yêu cầu, chỉ ghi để chủ dự án nắm):
> - **Rate limit `POST /leads` = 20/phút/IP** (không phải 5/phút): held-out phơi ra 5/phút chặn oan khi nhiều nhân viên một doanh nghiệp NAT chung một IP công cộng. Chốt bump lên 20 (đã ghi spec). IP lấy từ `RemoteAddr` (không tin header `X-Forwarded-For`) để chống spoof — nhất quán với NFR-004/quyết định IP-spoofing GĐ1.
> - **Phân trang (chốt 2026-07-17):** `GET /products` cố ý **list-all** (tập sản phẩm nhỏ, không phân trang). Ngược lại các list admin `leads`/`orders`/`customers` GĐ4–5 BẮT BUỘC paginate (limit/offset mặc định 20, max 100, mới nhất trước). Chênh lệch này là chủ đích, không phải thiếu sót.
> - **Telegram notify fail-safe:** `POST /leads` luôn trả `201` dù Telegram lỗi/treo/thiếu token (goroutine + timeout); `TELEGRAM_API_BASE` override phục vụ test; không rò token bot ra log. Khớp NFR-001 (< 5 giây, không chặn khách).

> **Ghi nhận thực tại GĐ3** (không sửa yêu cầu, chỉ ghi để chủ dự án nắm):
> - **`products` thêm 3 field theo quyết định chủ dự án** để card landing khớp mockup: `badge` (migration `0004`), `compare_at_price`, `subtitle` (migration `0005`). Tất cả nullable, đã vào `Product` schema OpenAPI → xuất qua `GET /products`. Không phá đơn/sản phẩm cũ. Chi tiết ở data dictionary §1.
> - **Form đặt hàng nằm TRONG bottom sheet** (`web/components/landing/ContactSheet.tsx`) — khác cấu trúc mockup gốc (mockup có nhiều điểm CTA rời), là **quyết định chủ dự án**: mọi CTA đều mở bottom sheet bắt lead → admin + Telegram; kèm kênh nhanh Zalo/Messenger/Gọi. Không phải sai lệch mockup ngoài ý muốn.
> - **⚠️ Submit qua Next Server Action** (`web/app/actions/lead.ts`, `submitLead()`) gọi `createLead()` server-to-server. Hệ quả: rate limit `POST /leads` (theo `RemoteAddr`) thấy IP của web server, KHÔNG phải IP thật của khách → rate limit per-IP mất tác dụng phân biệt khách. Cần forward IP thật (trusted proxy header) khi deploy sau Caddy. **Đã ghi backlog GĐ6** (§3).
> - **`low_stock` status HOÃN sang GĐ admin (GĐ4).** GĐ3 giữ CHECK `status` = `available|sold_out|hidden`, chưa thêm `low_stock`.

## 1. Yêu cầu chức năng

| REQ | Nguồn (spec) | GĐ | Task (BRIEF.md) | Test (kể cả held-out) | Trạng thái |
|---|---|---|---|---|---|
| REQ-LAND-001 | §1, §5 | 3 | GĐ3/Task 2+3 (`bfbbc00`, `1c5a81b`, `8297aaf`) | design-evaluator ≥8/10 mọi task (Task 2: 9/9/8/9; Task 3: 9/9/9/9) — port 1:1 mockup, screenshot loop 2 viewport | Đã triển khai (GĐ3): landing đủ section (announcement/header/hero/trust/collection/corporate/craft/flavors/testimonials/footer) — `web/components/landing/` |
| REQ-LAND-002 | §2 | 3 | GĐ2/Task 4 (`54a31d1`); GĐ3/Task 1+3 (`bd6b935`, `1c5a81b`) | design-evaluator 9/9/9/9 | Đã triển khai (GĐ3): collection 3 hộp + 4 bánh lẻ render từ `GET /products` (7 seed); model mở rộng `badge`/`compare_at_price`/`subtitle` |
| REQ-LAND-003 | §2 | 3 | GĐ2/Task 4 (`54a31d1`); GĐ3/Task 4 (`c99b4ea`) | qa-evaluator held-out 9/9 (xử lý 400/429) + design-evaluator 9/9/9/9 | Đã triển khai (GĐ3): form trong bottom sheet → `POST /leads` qua Next Server Action (`submitLead`); kênh nhanh Zalo/Messenger/Gọi |
| REQ-LAND-004 | §5 | 3 | GĐ3/Task 2+4 (`bfbbc00`, `c99b4ea`) | design-evaluator ≥8/10 (2 viewport) | Đã triển khai (GĐ3): responsive breakpoints mockup + sticky CTA mobile + bottom sheet liên hệ toàn cục (mở/đóng X/backdrop/Escape) |
| REQ-PROD-001 | §4 | 2 | GĐ2/Task 1 (`3aedd62`, `207ed4b`) | Held-out acceptance 12/12 (ẩn `hidden`, ORDER BY tất định) + go-reviewer PASS | Đã triển khai (GĐ2): `GET /api/v1/products` public |
| REQ-PROD-002 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-PROD-003 | §5 | 4–5 | — | — | Chưa triển khai |
| REQ-LEAD-001 | §4 | 2 | GĐ2/Task 2 (`357eba7`, `1b4020d`) | Held-out 7/7 (validate SĐT VN/tên/độ dài + rate limit) + go-reviewer PASS | Đã triển khai (GĐ2): `POST /api/v1/leads` public |
| REQ-LEAD-002 | §1, §3 | 2 | GĐ2/Task 2 (`357eba7`, `1b4020d`) | Held-out 7/7 (lưu lead status `new`) + go-reviewer PASS | Đã triển khai (GĐ2): lưu bảng `leads` migration `0003` |
| REQ-LEAD-003 | §3 | 2, 4 | GĐ2/Task 2 (`357eba7`) | Held-out 7/7 (khởi tạo status `new`) + go-reviewer PASS | Trạng thái `new` đã đặt (GĐ2); chuyển tiếp `contacted/converted/closed` chờ admin GĐ4 |
| REQ-LEAD-004 | §4 | 4–5 | — | — | Chưa triển khai |
| REQ-LEAD-005 | §1, §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-001 | §1, §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-002 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-003 | §3 | 4 | — | — | Chưa triển khai |
| REQ-ORD-004 | §3 | 4 | — | — | Chưa triển khai |
| REQ-CUST-001 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-AUTH-001 | §3, §4, §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-002 | §4, §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-003 | §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-004 | §2; CLAUDE.md | 4–5 | GĐ1/Task 5 (`dc40754`) | tsc/lint/build xanh (gate độc lập) | Khung xong GĐ1 (`web/proxy.ts` skeleton guard `/admin`), hoàn thiện GĐ4–5 |
| REQ-NOTI-001 | §1, §2 | 2 | GĐ2/Task 3 (`4fb4a0d`, `7b59e92`) | Held-out 3/3 (fail-safe: 201 dù Telegram lỗi/treo/không token, `TELEGRAM_API_BASE` override) + go-reviewer PASS | Đã triển khai (GĐ2): notify lead mới (`internal/notify`) |
| REQ-NOTI-002 | §1, §2 | 2 | — | — | Chưa triển khai (hết treo — chốt 2026-07-17) |
| REQ-DASH-001 | §1, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ADM-001 | §5; CLAUDE.md | 5 | GĐ1/Task 5 (`dc40754`) | tsc/lint/build xanh; tokens render thật (gate độc lập) | Khung xong GĐ1 (Tailwind v4 `@theme` design tokens, font Playfair+Be Vietnam), hoàn thiện GĐ5 |

## 2. Yêu cầu phi chức năng

| NFR | Nguồn | GĐ | Task (BRIEF.md) | Kiểm chứng | Trạng thái |
|---|---|---|---|---|---|
| NFR-001 | spec §9 | 2 | GĐ2/Task 3 (`4fb4a0d`, `7b59e92`) | Held-out 3/3: notify không chặn `POST /leads` (goroutine + timeout) | Đã triển khai (GĐ2): Telegram fail-safe, khách không chờ |
| NFR-002 | spec §2, §9 | 6 | — | — | Chưa triển khai |
| NFR-003 | spec §6, §9 | 6 | — | — | Chưa triển khai |
| NFR-004 | spec §6 | 2 | GĐ1/Task 4 (`ed1e6ea`); GĐ2/Task 2 (`357eba7`, `1b4020d`) | GĐ1: `store_test.go` testcontainers Postgres 16 thật; GĐ2: held-out 7/7 validate SĐT VN/tên/độ dài tại API boundary + rate limit 20/phút chống spoof (RemoteAddr) | Đã triển khai (GĐ2): validation + rate limit tại API boundary; truy vấn chỉ qua sqlc |
| NFR-005 | spec §6; CLAUDE.md | 1 | GĐ1/Task 1–2 (`bfff066`, `e9b516c`) | `.env` ignored, `.env.example` trong git; config từ env (gate độc lập) | Hạ tầng xong (GĐ1): secrets qua env, không hardcode |
| NFR-006 | spec §4 | 2 | GĐ1/Task 2 (`8696c89`) | router test: 404/405 trả JSON (`api/cmd/server/main_test.go`) | Hạ tầng xong (GĐ1): error helper JSON (`internal/httpx`) |
| NFR-007 | spec §6 | 1 | GĐ1/Task 7 (`7bda1f8`, `97589ae`) | CI 2 job lint+test+build verify local xanh (chưa chạy GitHub thật — chưa có remote) | Hạ tầng xong (GĐ1): `.github/workflows/ci.yml` |
| NFR-008 | spec §2, §9 | 1, 6 | GĐ1/Task 1+7 (`bfff066`, `7bda1f8`) | `docker compose config` OK, full stack up (api healthz 200 + web 200) | Hạ tầng xong (GĐ1): Compose Postgres+api+web; deploy VPS còn ở GĐ6 |
| NFR-009 | CLAUDE.md | 2 | GĐ2/Task 2+3 (`357eba7`, `4fb4a0d`) | go-reviewer PASS: SĐT log 4 số cuối ở `POST /leads` và notify; không rò token bot | Đã triển khai (GĐ2): che SĐT khi log, không rò dữ liệu nhạy cảm |
| NFR-010 | spec §9 | 3 | GĐ3/Task 2+3+4 (`bfbbc00`, `1c5a81b`, `8297aaf`, `c99b4ea`) | design-evaluator ≥8/10 mọi task UI (9/9/8/9; 9/9/9/9; 9/9/9/9), screenshot loop 2 viewport so mockup | Đạt (GĐ3): mọi task UI qua ngưỡng design-evaluator |
| NFR-011 | spec §9 | 5 | — | — | Chưa triển khai |

## 3. Ngoài ma trận (backlog, chưa thành REQ)

- Thống kê doanh thu theo tháng (BRIEF.md backlog) — nếu chốt, sẽ mở rộng REQ-DASH.
- Xuất đơn ra Excel/CSV (BRIEF.md backlog) — nếu chốt, sẽ thêm REQ-ORD mới.
- **[GĐ6] Rate limit `POST /leads` sau Next Server Action / Caddy** — hiện `RemoteAddr` thấy IP web server, không phải IP khách thật (xem "Ghi nhận thực tại GĐ3"). Cần cấu hình trusted proxy để forward IP thật, khôi phục hiệu lực rate limit per-IP. Backlog GĐ6 (deploy), gắn NFR-004.
- **[GĐ4] `low_stock` product status** — bổ sung giá trị vào CHECK `products.status` khi làm quản lý tồn kho admin; cần migration mới.
