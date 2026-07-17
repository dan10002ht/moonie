# Giai đoạn 4 — Auth Admin + API Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Feature task API → qa-evaluator viết held-out TRƯỚC (tests/heldout/), generator không đọc; gate = held-out + go-reviewer. security-review ở CUỐI giai đoạn (auth).

**Goal:** Backend đầy đủ cho admin — đăng nhập (JWT httpOnly), và API quản lý sản phẩm / leads / đơn hàng / khách hàng / dashboard, có phân trang và bảo vệ auth. UI admin là giai đoạn 5.

**Architecture:** Tiếp nối GĐ1-3 (Go chi/pgx/sqlc, spec-first OpenAPI, testcontainers). Auth: bcrypt verify + JWT trong httpOnly cookie (SameSite=Lax), middleware bảo vệ mọi route `/admin/*`. Web `proxy.ts` chặn `/admin` khi chưa đăng nhập. Đơn hàng tạo trong transaction (order + order_items) với snapshot giá. Telegram notify khi có đơn mới.

**Tech Stack:** Kế thừa. Thêm: `golang.org/x/crypto/bcrypt` (đã có), JWT lib (`github.com/golang-jwt/jwt/v5`).

## Global Constraints

- Kế thừa TOÀN BỘ Global Constraints GĐ1-3 (Colima port 5440, CGO_ENABLED=0, Go 1.25, make lint/test, spec-first OpenAPI, error JSON {error}, SQL qua sqlc, migration mới không sửa cũ, không log SĐT >4 số cuối).
- **Auth**: password bcrypt (đã seed admin@mooni.local). Login trả JWT trong httpOnly cookie (Secure ở production, SameSite=Lax). Mọi `/api/v1/admin/*` qua middleware auth (thiếu/sai token → 401 JSON). KHÔNG đăng ký public (REQ-AUTH-003).
- **Phân trang** (quy ước đã chốt): mọi list admin `leads`/`orders`/`customers` PHẢI paginate — query `?limit=` (default 20, max 100) + `?offset=`, trả `{items: [...], total: n}`, sắp mới nhất trước. Products list admin có thể không paginate (tập nhỏ) nhưng trả cả hidden.
- **Transaction**: tạo order + order_items atomic (REQ-ORD-003). order_items snapshot `product_name` + `unit_price` tại thời điểm tạo (REQ-ORD-004) — đổi giá sản phẩm sau không ảnh hưởng đơn cũ.
- **Lead→order** (REQ-LEAD-005): thêm `leads.order_id` nullable FK → orders. Convert: tạo order từ tên/SĐT lead, set lead.status='converted' + lead.order_id. KHÔNG tự tạo customer (đã chốt) — order.customer_id nullable.
- **Telegram notify đơn mới** (REQ-NOTI-002): khi tạo order (manual hoặc convert), bắn Telegram (fail-safe như GĐ2, dùng Notifier đã có).

## File Structure

```
api/migrations/0006_customers.up/.down.sql
api/migrations/0007_orders.up/.down.sql        # orders + order_items + leads.order_id
api/internal/auth/                             # jwt.go (sign/verify), password.go, middleware.go
api/internal/store/query.sql                   # + customers, orders, order_items, leads admin, dashboard queries
api/internal/handlers/ (hoặc cmd/server/*.go)  # auth.go, admin_products.go, admin_leads.go,
                                               #   admin_orders.go, admin_customers.go, admin_dashboard.go
api/internal/uploads/                          # lưu ảnh sản phẩm (REQ-PROD-003)
api/openapi.yaml                               # + auth + admin endpoints
web/proxy.ts                                   # hoàn thiện auth guard /admin
web/lib/api.ts                                 # + admin client calls (cho GĐ5)
```

---

### Task 1: Migrations customers + orders + order_items + leads.order_id + sqlc

**Trace:** REQ-CUST-001, REQ-ORD-001/003/004, REQ-LEAD-005 (schema). Không UI/feature logic — không held-out; verify = migrate + sqlc + integration test round-trip.

- [ ] **0006_customers**: id uuid pk, name text not null, phone text, email text, company text, address text, type text not null default 'personal' check in ('personal','business'), note text, created_at, updated_at.
- [ ] **0007_orders**: 
  - `orders`: id uuid pk, code text unique not null (mã đơn sinh tự động vd MC-YYYYMMDD-xxxx), customer_id uuid null references customers, channel text not null default 'website' check in ('website','phone','zalo','fb'), status text not null default 'new' check in ('new','confirmed','delivering','done','cancelled'), subtotal bigint not null default 0, discount bigint not null default 0, total bigint not null default 0, delivery_date date, delivery_address text, note text, created_at, updated_at.
  - `order_items`: id uuid pk, order_id uuid not null references orders on delete cascade, product_id uuid null references products, product_name text not null (snapshot), unit_price bigint not null (snapshot), quantity int not null check (quantity > 0), created_at.
  - `leads`: ADD COLUMN order_id uuid null references orders.
- [ ] **make migrate** + verify \d cả 3 bảng.
- [ ] **sqlc queries** (query.sql): CreateCustomer/GetCustomer/ListCustomers(limit,offset)/CountCustomers/UpdateCustomer; CreateOrder/GetOrder/ListOrders(limit,offset)/CountOrders/UpdateOrderStatus; CreateOrderItem/ListOrderItemsByOrder; ListLeadsAdmin(limit,offset)/CountLeads/UpdateLeadStatus/SetLeadOrder; dashboard: CountNewLeads/CountProcessingOrders/SumRevenueThisMonth (đơn status='done' trong tháng). make gen.
- [ ] **Integration test** (store): round-trip customer + order với transaction (order + 2 items) + snapshot price. make check xanh.
- [ ] **Commit** `feat(api): schema customers/orders/order_items + leads.order_id + sqlc`.

---

### Task 2: Auth — login + JWT + middleware + proxy guard

**Trace:** REQ-AUTH-001/002/003/004. security-relevant.

**Held-out (qa-evaluator):** POST /auth/login đúng email+password → 200 + Set-Cookie httpOnly JWT; sai password → 401; gọi 1 endpoint /admin bất kỳ KHÔNG cookie → 401; CÓ cookie hợp lệ → không 401; cookie giả/hết hạn → 401; không có route đăng ký public.

- [ ] **auth/password.go**: VerifyPassword(hash, plain) bcrypt.
- [ ] **auth/jwt.go**: Sign(adminID, exp) + Verify(token) dùng JWT_SECRET từ config; HS256; claim sub=adminID, exp hợp lý (vd 7 ngày).
- [ ] **auth/middleware.go**: đọc cookie `mc_admin`, verify JWT, gắn adminID vào context; thiếu/sai → 401 JSON {error}.
- [ ] **openapi + handler** POST /api/v1/auth/login (body {email,password} → 200 {ok:true} + Set-Cookie httpOnly Secure(prod) SameSite=Lax; sai → 401). POST /api/v1/auth/logout (xóa cookie). Optional GET /api/v1/admin/me trả admin hiện tại (để web biết đã login).
- [ ] **Mount** middleware auth cho nhóm route /api/v1/admin/*.
- [ ] **web/proxy.ts**: hoàn thiện — request tới /admin không có cookie mc_admin hợp lệ → redirect /admin/login. (Verify chữ ký ở web chỉ cần check cookie tồn tại; xác thực thật ở API.)
- [ ] **Test** (auth unit + handler httptest) + held-out. make check.
- [ ] **Commit** `feat(api): auth login JWT httpOnly + middleware admin + proxy guard`.

---

### Task 3: Admin products API (CRUD + upload ảnh)

**Trace:** REQ-PROD-002/003.

**Held-out:** GET /admin/products (có auth) trả cả hidden; POST tạo product; PUT sửa; DELETE/hide; POST upload ảnh → product.image_url cập nhật, ảnh serve được. Không auth → 401.

- [ ] CRUD `/api/v1/admin/products` (list trả cả hidden; create/update đủ field gồm badge/compare_at_price/subtitle; delete = set hidden hoặc xóa mềm). Validate (giá ≥ 0, type/status enum, slug unique).
- [ ] Upload ảnh: POST /api/v1/admin/products/{id}/image (multipart) → lưu vào `uploads/` (volume), set image_url; GET /uploads/* serve tĩnh. Validate loại/kích thước file.
- [ ] Test + held-out. make check.
- [ ] **Commit** `feat(api): admin products CRUD + upload ảnh`.

---

### Task 4: Admin leads API (list paginated + update status + convert→order)

**Trace:** REQ-LEAD-004/005.

**Held-out:** GET /admin/leads?limit&offset trả {items,total} mới nhất trước, có auth; PATCH status new→contacted; POST /admin/leads/{id}/convert → tạo order từ lead (lấy tên/SĐT), set lead.status=converted + order_id, KHÔNG tạo customer; không auth → 401.

- [ ] GET /api/v1/admin/leads (paginate) + PATCH status + POST convert (transaction: tạo order rỗng/1 dòng từ lead + cập nhật lead). Bắn Telegram khi convert tạo đơn (REQ-NOTI-002).
- [ ] Test + held-out. make check.
- [ ] **Commit** `feat(api): admin leads list + status + convert to order`.

---

### Task 5: Admin orders API (create transaction + list + status + Telegram)

**Trace:** REQ-ORD-001/002/003/004, REQ-NOTI-002.

**Held-out:** POST /admin/orders (nhập tay: customer optional, items[] product+qty) → tạo order + order_items TRONG transaction, snapshot product_name+unit_price, tính subtotal/total, sinh code; đơn mới → Telegram bắn (fail-safe); GET /admin/orders?limit&offset {items,total} mới nhất trước; PATCH status theo chuỗi hợp lệ (new→confirmed→delivering→done|cancelled), chuyển sai bậc → 400; không auth → 401.

- [ ] POST create (transaction, snapshot, code gen, total tính từ items - discount) + Telegram notify đơn mới. GET list paginate. GET /{id} chi tiết + items. PATCH status (validate transition).
- [ ] Test (gồm transaction rollback khi 1 item lỗi) + held-out. make check.
- [ ] **Commit** `feat(api): admin orders create(transaction+snapshot) + list + status + Telegram`.

---

### Task 6: Admin customers API (CRUD paginated)

**Trace:** REQ-CUST-001.

**Held-out:** GET /admin/customers?limit&offset {items,total} có auth; POST tạo; PUT sửa; validate phone/email/type; không auth → 401.

- [ ] CRUD /api/v1/admin/customers (list paginate). Validate.
- [ ] Test + held-out. make check.
- [ ] **Commit** `feat(api): admin customers CRUD paginated`.

---

### Task 7: Admin dashboard API + security-review

**Trace:** REQ-DASH-001, và security-review mốc 1 (cuối auth admin).

**Held-out:** GET /admin/dashboard (auth) trả {new_leads, processing_orders, revenue_this_month} — revenue = tổng total đơn status='done' trong tháng hiện tại; không auth → 401.

- [ ] GET /api/v1/admin/dashboard: đếm leads status='new', đơn status in (confirmed,delivering), sum total đơn 'done' tháng này. (Dòng phụ "đang xử lý" tùy chọn.)
- [ ] Test + held-out. make check.
- [ ] **security-review**: chạy skill security-review trên toàn bộ code admin+auth GĐ4 (JWT, cookie, bcrypt, upload file, SQL injection, authz mọi endpoint admin). Finding cao chưa xử lý = chưa xong giai đoạn.
- [ ] **Commit** `feat(api): admin dashboard + security-review GĐ4`.

---

## Self-Review

**Trace:** REQ-AUTH-001/002/003/004→T2, REQ-PROD-002/003→T3, REQ-LEAD-004/005→T4, REQ-ORD-001/002/003/004→T5 (+T1 schema), REQ-CUST-001→T6, REQ-DASH-001→T7, REQ-NOTI-002→T4+T5. Pagination áp T4/T5/T6. security-review T7.
**Ngoài phạm vi GĐ4:** admin UI (GĐ5), deploy/backup/HTTPS + rate-limit-behind-proxy fix (GĐ6), low_stock status (cân nhắc thêm ở T3 nếu rẻ, hoặc GĐ5).
**Placeholder scan:** không TBD.
**Type consistency:** JWT claim sub=adminID, cookie name `mc_admin`, pagination shape {items,total} dùng nhất quán mọi list admin.
