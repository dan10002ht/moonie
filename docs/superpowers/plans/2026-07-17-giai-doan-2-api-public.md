# Giai đoạn 2 — API Public (products + leads + Telegram) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps dùng checkbox. Mỗi feature task: qa-evaluator viết held-out test TRƯỚC (tests/heldout/), generator KHÔNG đọc held-out.

**Goal:** Hai endpoint public mà landing sẽ dùng — `GET /api/v1/products` (chỉ sản phẩm hiển thị) và `POST /api/v1/leads` (validate + rate limit + lưu DB + bắn Telegram) — đầy đủ migration, sqlc, contract OpenAPI 2 phía, test tích hợp.

**Architecture:** Tiếp nối giai đoạn 1. Spec-first: thêm path/schema vào `api/openapi.yaml` → regenerate oapi-codegen (Go) + openapi-typescript (web). Handler mỏng gọi service/store. Telegram là 1 package `notify` gọi Bot API, inject qua interface để test bằng fake (không cần token thật). Validation ở boundary. Rate limit in-memory (đủ cho 1 VPS).

**Tech Stack:** Kế thừa GĐ1 (Go chi/pgx/sqlc, oapi-codegen, testcontainers). Thêm: rate limiter (vd `golang.org/x/time/rate` hoặc httprate cho chi), Telegram Bot API (net/http, không cần SDK).

## Global Constraints

- Kế thừa TOÀN BỘ Global Constraints giai đoạn 1 (`docs/superpowers/plans/2026-07-17-giai-doan-1-scaffold.md`): Colima port 5440, CGO_ENABLED=0, Go 1.25, `make lint`/`make test`, spec-first OpenAPI, error JSON `{error}`, SQL qua sqlc, migration mới không sửa cũ, không log SĐT quá 4 số cuối.
- **Held-out tests**: qa-evaluator viết `tests/heldout/` từ definition-of-done + spec TRƯỚC khi generator code; generator BỊ CẤM đọc thư mục đó.
- Telegram: build/test bằng **fake client** (interface). Token thật (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) chỉ cần lúc deploy — thiếu token thì notify no-op + log cảnh báo, KHÔNG làm POST /leads fail (đặt hàng phải luôn thành công dù Telegram lỗi).
- Quyết định nghiệp vụ đã chốt (SRS): tồn kho = trạng thái (`available|sold_out|hidden`), không số lượng. `products` có: slug, tên, mô tả, giá, loại (`gift_box|single_cake`), trạng thái, ảnh (url), thứ tự hiển thị.
- `leads`: tên, SĐT, lời nhắn, sản phẩm quan tâm (nullable, có thể FK product hoặc text), nguồn, trạng thái (`new|contacted|converted|closed`), created_at.

## File Structure

```
api/migrations/0002_products.up.sql / .down.sql
api/migrations/0003_leads.up.sql / .down.sql
api/internal/store/query.sql          # thêm query products + leads
api/internal/store/*.go               # sqlc regenerate
api/openapi.yaml                      # thêm GET /products, POST /leads, schemas
api/internal/api/zz_generated.go      # regenerate
api/internal/validate/validate.go     # validate phone VN, email, độ dài
api/internal/notify/notify.go         # interface Notifier + TelegramNotifier + NoopNotifier
api/internal/notify/telegram.go
api/internal/handlers/products.go     # GetProducts handler
api/internal/handlers/leads.go        # PostLeads handler (validate → store → notify async)
api/cmd/server/main.go                # wire handlers, rate limit middleware cho /leads
web/types/api.d.ts                    # regenerate
web/lib/api.ts                        # thêm getProducts(), createLead()
tests/heldout/                        # qa-evaluator sở hữu
```

---

### Task 1: products — migration + sqlc + GET /api/v1/products (public)

**Trace:** REQ-PROD-001 (GET public, ẩn hidden). Nền cho REQ-LAND-002.

**Held-out (qa-evaluator viết trước):** GET /api/v1/products trả 200 JSON array; sản phẩm `hidden` KHÔNG xuất hiện; `available` và `sold_out` CÓ; sắp theo thứ tự hiển thị; mỗi item có đủ field (slug, name, price, type, status, image_url, display_order); giá đúng kiểu số.

**Files:** migrations 0002, query.sql (+products), openapi.yaml (GET /products + schema Product), handlers/products.go, main.go wire.

- [ ] **Step 1: Migration 0002_products** — bảng products (id uuid pk, slug text unique not null, name text not null, description text, price bigint not null (VND, số nguyên), type text not null check in ('gift_box','single_cake'), status text not null default 'available' check in ('available','sold_out','hidden'), image_url text, display_order int not null default 0, created_at, updated_at). `.down` drop.
- [ ] **Step 2: `make migrate`**, verify `\d products`.
- [ ] **Step 3: query.sql** — `ListVisibleProducts :many` (WHERE status != 'hidden' ORDER BY display_order, created_at). `make gen` (sqlc).
- [ ] **Step 4: openapi.yaml** — `GET /products` operationId `listProducts`, 200 → array of `Product` schema (đủ field, price integer int64, type/status enum). Regenerate: `make gen` (oapi-codegen), `cd web && npm run gen:api`.
- [ ] **Step 5: Test trước** (handler test httptest + integration): seed 3 product (available, sold_out, hidden) → GET /products trả 2 (không hidden), đúng thứ tự.
- [ ] **Step 6: Implement** handlers/products.go (`GetProducts` implement ServerInterface method), map store row → API Product. Wire vào Server. Run test → PASS.
- [ ] **Step 7: `make check`** xanh; chạy server thật + curl /api/v1/products.
- [ ] **Step 8: Commit** `feat(api): GET /products public endpoint`.

---

### Task 2: leads — migration + sqlc + POST /api/v1/leads (validate + rate limit)

**Trace:** REQ-LEAD-001 (validate + rate limit), REQ-LEAD-002 (lưu DB), REQ-LEAD-003 (trạng thái new). Nền REQ-LAND-003. NFR-004 (validate boundary), NFR-009 (không log SĐT đầy đủ).

**Held-out (qa-evaluator viết trước):** POST /leads body hợp lệ → 201 + lead lưu DB trạng thái `new`; thiếu tên → 400 JSON {error}; thiếu/sai định dạng SĐT VN → 400; lời nhắn quá dài → 400; SĐT có dấu/chữ → 400; rate limit: gọi vượt ngưỡng từ 1 IP → 429; SĐT chỉ log 4 số cuối (grep log không thấy full SĐT).

**Files:** migrations 0003, query.sql (+leads), validate/validate.go, openapi.yaml (POST /leads + schemas LeadInput/LeadCreated), handlers/leads.go, main.go (rate limit middleware cho /leads).

- [ ] **Step 1: Migration 0003_leads** — bảng leads (id uuid pk, name text not null, phone text not null, message text, product_interest text, source text not null default 'website', status text not null default 'new' check in ('new','contacted','converted','closed'), created_at). `.down`.
- [ ] **Step 2: `make migrate`** + verify.
- [ ] **Step 3: validate/validate.go** — `Phone(s) error` (SĐT VN: 10 số bắt đầu 0, hoặc +84; chỉ số/khoảng trắng/+), `RequiredName`, `MaxLen`. Test table-driven.
- [ ] **Step 4: query.sql** `CreateLead :one`; `make gen`.
- [ ] **Step 5: openapi.yaml** `POST /leads` operationId `createLead`, requestBody `LeadInput` (name required, phone required, message, product_interest), 201 → `LeadCreated {id}`, 400/429 → Error. Regenerate 2 phía.
- [ ] **Step 6: rate limit** — middleware (vd httprate) giới hạn theo IP (vd 5 req / phút / IP cho /leads). Áp riêng route /leads, không toàn cục.
- [ ] **Step 7: Test trước** — happy 201, các case 400 (thiếu tên, SĐT sai), 429 (vượt rate). Kiểm log không lộ full SĐT.
- [ ] **Step 8: Implement** handlers/leads.go: parse → validate → store.CreateLead → 201. Wire + rate limit. Run test → PASS.
- [ ] **Step 9: `make check`** + curl thật (201 + 400 + 429).
- [ ] **Step 10: Commit** `feat(api): POST /leads với validate + rate limit`.

---

### Task 3: Telegram notify — service + wire vào POST /leads

**Trace:** REQ-NOTI-001 (notify lead mới), NFR-001 (< 5s). (REQ-NOTI-002 order — hoãn tới GĐ4 khi có orders.)

**Held-out (qa-evaluator viết trước):** khi POST /leads thành công, Notifier được gọi đúng 1 lần với nội dung chứa tên + SĐT + sản phẩm quan tâm; nếu Notifier lỗi/timeout, POST /leads VẪN trả 201 (không chặn); thiếu token → NoopNotifier, không crash.

**Files:** notify/notify.go (interface `Notifier` + `NoopNotifier`), notify/telegram.go (`TelegramNotifier` gọi Bot API sendMessage), handlers/leads.go (inject Notifier, gọi async sau khi lưu), main.go (chọn Telegram vs Noop theo env), config (đã có token fields).

- [ ] **Step 1: interface** `Notifier { NotifyNewLead(ctx, lead) error }`; `NoopNotifier` (log, no-op).
- [ ] **Step 2: Test fake** — `fakeNotifier` ghi lại call. Test: PostLeads gọi NotifyNewLead 1 lần đúng nội dung; fake trả error → PostLeads vẫn 201.
- [ ] **Step 3: Implement** wiring trong handlers/leads.go — gọi notify SAU khi store thành công, trong goroutine hoặc với timeout riêng, KHÔNG để lỗi notify ảnh hưởng response.
- [ ] **Step 4: TelegramNotifier** — POST tới `https://api.telegram.org/bot<token>/sendMessage` với chat_id + text; timeout 5s; test bằng httptest server giả lập Telegram API (không gọi thật). Nội dung không log full SĐT.
- [ ] **Step 5: main.go** — token có → TelegramNotifier, không → NoopNotifier + log cảnh báo.
- [ ] **Step 6: `make check`** + chạy server với token rỗng, POST /leads → 201 + log "notify skipped (no token)".
- [ ] **Step 7: Commit** `feat(api): Telegram notify khi có lead mới (fail-safe)`.

---

### Task 4: web api client cho products + leads

**Trace:** nền REQ-LAND-002, REQ-LAND-003 (landing GĐ3 sẽ gọi).

**Files:** web/types/api.d.ts (regenerate), web/lib/api.ts (getProducts, createLead).

- [ ] **Step 1: Regenerate** `cd web && npm run gen:api` (đã có path mới từ Task 1-2).
- [ ] **Step 2: lib/api.ts** — `getProducts(): Promise<Product[]>`, `createLead(input): Promise<LeadCreated>` dùng apiFetch + types sinh. Không any.
- [ ] **Step 3: tsc --noEmit + lint + build** xanh. Gate: sửa sai type → tsc fail → khôi phục.
- [ ] **Step 4: Commit** `feat(web): api client products + leads`.

---

## Self-Review

**Trace:** REQ-PROD-001→T1, REQ-LEAD-001/002/003→T2, REQ-NOTI-001→T3, nền REQ-LAND-002/003→T4. NFR-004→T2, NFR-009→T2/T3.
**Ngoài phạm vi GĐ2 (không scope-creep):** admin CRUD products (REQ-PROD-002/003), upload ảnh, admin leads view (REQ-LEAD-004), convert lead (REQ-LEAD-005), orders/notify order (REQ-NOTI-002), landing UI thật (GĐ3), auth (GĐ4).
**Placeholder scan:** không có TBD.
**Type consistency:** Product/LeadInput/LeadCreated schema đặt trong openapi.yaml, dùng nhất quán Go↔web qua codegen.
