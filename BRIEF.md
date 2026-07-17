# BRIEF — Hàng đợi task Mooni Cake

> Định dạng: `[ ]` chưa làm · `[⏳]` đang làm · `[✅]` xong (kèm tóm tắt indent bên dưới).
> Quy tắc vận hành: xem CLAUDE.md mục "Vòng lặp task". Evaluator PASS mới được mark ✅.
> Chủ dự án thêm task mới = thêm dòng `[ ]`. Task cần mô tả đủ để làm không phải hỏi lại; thiếu thông tin thì agent ghi chú blocker thay vì đoán.

## Giai đoạn 1 — Scaffold

Plan chi tiết: `docs/superpowers/plans/2026-07-17-giai-doan-1-scaffold.md` (mỗi task có DoD + step + trace REQ).

1. [✅] Task 1 — Docker Compose + Postgres + khung env (NFR-008, NFR-005)
   - Files: docker-compose.yml (postgres:16, port 5440:5432, healthcheck pg_isready), .env.example (port 5440), Makefile (up + placeholder gen/migrate/test). Commit bfff066.
   - Evaluator gate PASS (verify độc lập main agent): postgres healthy trên 5440, .env ignored đúng, .env.example trong git, working tree sạch.
2. [✅] Task 2 — Go API skeleton: config, chi router, /healthz, error helper (NFR-006, NFR-005)
   - Files: api/ (go.mod pin pgx v5.7.5/Go 1.23, httpx errors, config, db pool, cmd/server + newRouter, main_test, .golangci.yml). Commit e9b516c → fix 8696c89.
   - go-reviewer FAIL vòng 1 (5 finding: RealIP IP-spoofing lint-block, thiếu timeout pool, thiếu graceful shutdown, 404/405 không JSON, thiếu test router) → generator sửa hết → re-verify độc lập PASS: golangci-lint exit 0, 15 test pass, healthz/404 JSON đúng, shutdown graceful exit 0.
3. [✅] Task 3 — OpenAPI spec-first + oapi-codegen contract gate phía Go (SRS §5, NFR-006)
   - Files: api/openapi.yaml, tools.go, internal/api/gen.go + zz_generated.go (oapi-codegen v2.4.1), main.go wire HandlerFromMuxWithBaseURL + assertion `var _ api.ServerInterface`, Makefile gen. Commit c659470.
   - Gate PASS (verify độc lập): build/15 test/lint xanh; assertion tồn tại main.go:25; /api/v1/healthz→200 qua handler sinh từ spec; gate đã chứng minh (đổi method→build FAIL→khôi phục).
   - PATTERN cho task sau: method name KHÔNG kèm /api/v1 (path /healthz → GetHealthz); prefix /api/v1 gắn lúc mount qua baseURL. Đặt operationId rõ ràng để kiểm soát tên method.
4. [✅] Task 4 — sqlc + golang-migrate + integration test testcontainers-go (NFR-004)
   - Files: api/migrations/0001_init (admin_users), cmd/migrate, sqlc.yaml + internal/store (New/CreateAdminUser/GetAdminUserByEmail + generated), store_test.go (testcontainers postgres:16). Commit ed1e6ea; fixup 0e74f8b (make lint + docs).
   - Gate: generator BÁO SAI "lint exit 0" → verify độc lập ra lint FAIL (typecheck testcontainers). Root cause: shim `cc` phá CGO → cần CGO_ENABLED=0. Đã thêm make lint/test với CGO_ENABLED=0 → PASS thật (make lint 0 issues, make test gồm integration pass). Ghi ràng buộc vào CLAUDE.md + memory.
   - DEVIATION: Go floor 1.23→1.25 (testcontainers v0.43), pgx→v5.9.2. Task 7 CI phải setup-go ≥1.25.
5. [✅] Task 5 — Next.js 16 scaffold + Tailwind design tokens + api client (REQ-ADM-001, REQ-AUTH-004)
   - Next 16.2.10 + Tailwind v4 (@theme trong globals.css), React 19.2.4. Files: web/ (layout font Playfair+Be Vietnam, page placeholder tokens, lib/api.ts apiFetch generic, proxy.ts skeleton /admin). Commit dc40754.
   - Gate PASS (verify độc lập): tsc sạch, lint sạch, build Turbopack xanh, tokens render thật (bg-navy/gold/font-serif), tiếng Việt OK. Placeholder — design-evaluator vs mockup để dành landing thật (giai đoạn 3).
   - Node 20.19 thỏa (Next 16 cần ≥20.9). web/CLAUDE.md+AGENTS.md do scaffold tạo, giữ (note Next 16, không xung đột).
6. [✅] Task 6 — openapi-typescript contract gate phía web (SRS §5, NFR-006)
   - Files: web/types/api.d.ts (sinh, committed), lib/api.ts getHealth dùng components["schemas"]["Health"], script gen:api (openapi-typescript 7.13.0). Commit 1ecc8f3.
   - Gate PASS (verify độc lập): tsc sạch, không any, regenerate không drift (types khớp spec), gate chứng minh (getHealth sai type→tsc FAIL TS2322→khôi phục). Vòng contract web↔api khép kín.
7. [✅] Task 7 — CI GitHub Actions lint+test+build + full compose (NFR-007)
   - Files: api/Dockerfile (distroless 17.7MB), web/Dockerfile (standalone 388MB), .dockerignore x2, next.config output standalone, docker-compose.yml (+api +web), .github/workflows/ci.yml (2 job, go-version-file go.mod=1.25, CGO_ENABLED=0). Commit 7bda1f8; fix Colima 97589ae.
   - Gate PASS (verify độc lập): compose config OK, full stack up (api healthz 200 + web 200), CI api job local xanh (vet/lint/test), CI web job local xanh, YAML hợp lệ.
   - Generator bắt+fix bug package-lock không portable (darwin→linux npm ci fail, sẽ hỏng CI+docker); phục hồi Colima sau I/O error không mất data.
   - MAIN AGENT FIX: testcontainers fail trên Colima (Task 4 vô tình pass nhờ Docker Desktop) → thêm DOCKER_HOST+SOCKET_OVERRIDE vào make test. CI GitHub không cần.
   - LƯU Ý: CI chưa chạy trên GitHub thật (chưa có remote) — verified commands local.
8. [✅] Task 8 — Project skill `run-moonie` + seed data mẫu (CLAUDE.md; làm CUỐI khi app đã tồn tại)
   - Files: api/cmd/seed (idempotent ON CONFLICT, bcrypt), Makefile seed target, .claude/skills/run-moonie/SKILL.md (boot runbook + env pitfalls). Commit b2a5914.
   - Gate PASS (verify độc lập): frontmatter hợp lệ, seed idempotent (1 admin, bcrypt $2a$), làm theo skill ra app chạy (healthz 200), make check xanh.
   - Admin mặc định sau seed: admin@mooni.local / mooni-admin (đổi qua SEED_ADMIN_PASSWORD).

### ✅ GIAI ĐOẠN 1 HOÀN THÀNH (8/8) — 2026-07-17
Toàn stack chạy được: docker compose up → Postgres(:5440 Colima) + Go API(:8080) + Next.js(:3000), contract OpenAPI cưỡng chế 2 phía, CI viết xong (chưa chạy GitHub thật — chưa có remote).

## Giai đoạn 2 — API Public (products + leads + Telegram)

Plan: `docs/superpowers/plans/2026-07-17-giai-doan-2-api-public.md`. Feature task → qa-evaluator viết held-out TRƯỚC, generator không đọc held-out.

1. [✅] Task 1 — products: migration + sqlc + GET /api/v1/products public (REQ-PROD-001)
   - Files: migration 0002_products, store ListVisibleProducts, cmd/server/products.go (ListProducts + toAPIProduct + interface productLister), openapi Product schema, products_test.go (4 test). Commit 3aedd62 → fix 207ed4b.
   - Gate: HELD-OUT PASS 12/12 (generator không đọc held-out, commit 0 file heldout). go-reviewer PASS → 2 finding (ORDER BY không tất định + thiếu test mapping) → sửa → re-verify PASS (make check xanh, held-out vẫn PASS).
2. [✅] Task 2 — leads: migration + sqlc + POST /api/v1/leads validate + rate limit (REQ-LEAD-001/002/003, NFR-004/009)
   - Files: migration 0003_leads, internal/validate (Phone VN/RequiredName/MaxLen), store CreateLead, cmd/server/leads.go (CreateLead + maskPhone), rate limit httprate 20/phút/IP route riêng, openapi LeadInput/LeadCreated. Commit 357eba7 → 1b4020d.
   - Gate: HELD-OUT PASS 7/7 (generator không đọc held-out). Held-out phơi vấn đề thiết kế thật: rate limit 5/phút chặn oan IP NAT doanh nghiệp → bump 20/phút. go-reviewer PASS, xác nhận rate-limit KHÔNG bypass được qua header giả (keyByRemoteIP dùng RemoteAddr).
   - Minor follow-up (không chặn): product_interest chưa có MaxLen (bounded 64KB body). Xử lý sau nếu cần.
3. [✅] Task 3 — Telegram notify khi lead mới, fail-safe (REQ-NOTI-001, NFR-001)
   - Files: internal/notify (Notifier interface, NoopNotifier, TelegramNotifier + TELEGRAM_API_BASE override, maskPhone), config TelegramAPIBase, leads.go gọi notify async fire-and-forget goroutine + timeout, main.go newNotifier. Commit 4fb4a0d → 7b59e92.
   - Gate: HELD-OUT PASS 3/3 (notify mock <5s, FAIL-SAFE Telegram treo→POST vẫn 201 0.007s + lead lưu, no-token no-op). go-reviewer PASS → fix rò token bot ở log (bảo mật) + drain body. Race test sạch.
   - Fire-and-forget goroutine không chờ shutdown (chấp nhận theo thiết kế, notify best-effort, lead luôn lưu).
4. [✅] Task 4 — web api client getProducts + createLead (nền REQ-LAND-002/003)
   - web/lib/api.ts: getProducts(): Promise<Product[]>, createLead(input): Promise<LeadCreated>, re-export types. ApiError mang status (UI phân biệt 400/429). Commit 54a31d1.
   - Gate PASS (verify độc lập): tsc sạch (gate chứng minh sai type→TS2322), lint sạch, build xanh, không any.

### ✅ GIAI ĐOẠN 2 HOÀN THÀNH (4/4) — 2026-07-17
API public đầy đủ: GET /products, POST /leads (validate + rate limit), Telegram notify fail-safe, web client. Mọi feature qua held-out gate + go-reviewer. Landing GĐ3 có đủ API để gọi.

## Giai đoạn 3 — Landing page (từ mockup)

Plan: `docs/superpowers/plans/2026-07-17-giai-doan-3-landing.md`. Mỗi task UI: screenshot loop (2 viewport so mockup) + design-evaluator ≥8/10. Task 4 thêm qa-evaluator (held-out interaction).

1. [✅] Task 1 — seed products khớp mockup + cài Playwright (nền REQ-LAND-002)
   - Seed 7 sản phẩm khớp mockup (3 gift_box + 4 single_cake, tất cả available). Thêm field `badge` (migration 0004, nullable) cho badge marketing: Thập cẩm="Bán chạy", Trà xanh="Mới". Seed chuyển upsert (sửa được data cũ). Playwright 1.61.1 cài. Commit bd6b935 → bc41529.
   - Sửa sai lệch mockup: mockup có 4 bánh lẻ (không 3), không cái nào sold_out (plan ghi sai) → đã khớp. Held-out products vẫn PASS 12/12 sau thêm badge (contract cũ nguyên).
2. [✅] Task 2 — landing frame: header/hero/trust/footer/sticky CTA (REQ-LAND-001/004)
   - Files: web/components/landing/ (AnnouncementBar, Header, MobileMenu, Hero, TrustStrip, Footer, StickyMobileCTA, icons), globals.css +20 token, app/page.tsx compose. Commit bfbbc00.
   - Gate: design-evaluator PASS — Design 9/Originality 9/Craft 8/Functionality 9 (NFR-010 ≥8 đạt). Khớp mockup cao, giữ cá tính navy-gold-serif, không AI-slop. Minor không chặn: menu mobile overlay vs in-flow (thị giác tương đương).
   - Screenshots: docs/reports/screenshots/2026-07-17-ld-frame-eval/.
3. [✅] Task 3 — product & content sections, wire GET /products (REQ-LAND-001/002)
   - Files: web/components/landing/{Collection,Flavors,product-card,CorporateGifting,Craft,Testimonials}.tsx, lib/format.ts. + migration 0005 (compare_at_price + subtitle), openapi/seed/handler cho 2 field mới. Commit 1c5a81b → 8297aaf.
   - Product model bổ sung theo quyết định chủ dự án: badge (Bán chạy/Mới/Quà biếu), compare_at_price (giá KM gạch + %), subtitle (nhãn loại). Seed khớp mockup.
   - Gate: design-evaluator PASS 9/9/9/9 (NFR-010). Held-out products vẫn PASS sau thêm field.
4. [✅] Task 4 — contact bottom sheet + form → POST /leads (REQ-LAND-003/004)
   - Files: web/components/landing/ContactSheet.tsx (client, form + kênh Zalo/Messenger/Gọi), web/app/actions/lead.ts (Server Action submitLead → createLead, tránh CORS). Commit c99b4ea.
   - Quyết định chủ dự án: sheet CHỨA form → POST /leads + kênh nhanh bên dưới (mọi CTA bắt lead). Submit qua Next Server Action (server-to-server).
   - Gate: qa-evaluator held-out 9/9 (mở/đóng X/Escape/backdrop, 4 field, submit 201+lead DB new, SĐT sai→lỗi giữ data, 429). design-evaluator 9/9/9/9 (NFR-010). Generator không đụng held-out.
   - Minor (backlog): vài hex one-off trong ContactSheet nên tokenize.

### ✅ GIAI ĐOẠN 3 HOÀN THÀNH (4/4) — 2026-07-17
Landing hoàn chỉnh khớp mockup: header/hero/trust/collection(3 hộp)/corporate/craft/flavors(4 bánh)/testimonials/footer + bottom sheet form đặt hàng → POST /leads → admin + Telegram. Website có trang chủ chạy được, khách đặt hàng được. design-evaluator ≥8/10 mọi task UI.

## Giai đoạn 4 — Auth Admin + API Admin

Plan: `docs/superpowers/plans/2026-07-17-giai-doan-4-admin-api.md`. Feature API → qa-evaluator held-out trước, generator không đọc. security-review cuối GĐ.

1. [✅] Task 1 — Migrations customers/orders/order_items + leads.order_id + sqlc (REQ-CUST/ORD/LEAD schema)
   - Files: migration 0006_customers, 0007_orders (orders+order_items+leads.order_id, CHECK tiền≥0), query.sql (+16 method: CRUD + pagination tie-break + dashboard), orders_test.go (transaction/snapshot/timezone). Commit 4f0eb84 → 7de3515 → 2f0b771.
   - Gate: go-reviewer PASS. Verify độc lập bắt: (a) test flaky wait-strategy + ordering không xác định → sửa; (b) bug doanh thu lệch UTC vs giờ VN → sửa neo Asia/Ho_Chi_Minh + test fail-trước-sửa. Pagination tie-break (created_at DESC, id) đúng. Snapshot giá đạt REQ-ORD-004.
2. [✅] Task 2 — Auth: login JWT httpOnly + middleware + proxy guard (REQ-AUTH-001/002/003/004)
   - Files: internal/auth (jwt HS256 chống alg-confusion, password bcrypt, middleware cookie mc_admin), cmd/server/auth.go (Login/Logout/GetAdminMe, chống user-enumeration + timing), main.go mount /admin/* + reject JWT_SECRET yếu, proxy.ts guard. Commit 7b6b2ab → e8b7bb5.
   - Gate: HELD-OUT 16/16 (login→cookie httpOnly/SameSite, sai pass 401, /admin/me bảo vệ, cookie giả 401, không register). go-reviewer PASS + thử tấn công thật (alg=none/confusion/hết hạn/path-confusion/enumeration đều chặn) → fix reject JWT_SECRET placeholder/<32 (defense-in-depth deploy).
   - CSRF + prefix-guard convention: ghi scope security-review Task 7.
3. [✅] Task 3 — Admin products CRUD + upload ảnh (REQ-PROD-002/003)
   - Files: cmd/server/admin_products.go (CRUD + upload magic-byte sniff + uuid filename + MaxBytesReader), main.go /uploads static (noDirFS + nosniff), config UploadsDir, soft delete=hidden. Commit ad8e755 → c76679b.
   - Gate: HELD-OUT PASS. go-reviewer PASS + tấn công upload thật (file thực thi giả/traversal/DoS đều chặn) → hardening 5 finding (dir-listing, nosniff, slug regex, display_order bounds, image_url chống XSS).
4. [✅] Task 4 — Admin leads list paginated + status + convert→order (REQ-LEAD-004/005)
   - Files: cmd/server/admin_leads.go (list phân trang/status/convert), internal/store/convert.go (ConvertLead transaction + LockLead FOR UPDATE + guard), notify NotifyNewOrder. Commit fa305e8 → 8437554.
   - Gate: HELD-OUT PASS (phân trang {items,total} mới-nhất-trước, convert không tạo customer, 401). go-reviewer FAIL → bắt RACE THẬT (tự viết test 2 goroutine: 2 convert song song → 2 đơn, 1 mồ côi) → fix atomic (WHERE order_id IS NULL + FOR UPDATE + rollback) + clamp offset overflow → re-verify PASS (race test 2 goroutine → 1 đơn, 0 mồ côi).
5. [✅] Task 5 — Admin orders create(transaction+snapshot) + list + status + Telegram (REQ-ORD, REQ-NOTI-002)
   - Files: store/orders.go (CreateOrderWithItems transaction + snapshot + tính tiền + chặn overflow), cmd/server/admin_orders.go (4 handler), openapi Order*. Commit 75a0fde → 48a5de3.
   - Gate: HELD-OUT PASS (snapshot giá, rollback, tính tiền, phân trang, status). go-reviewer FAIL → bắt lỗi tài chính: cắt quantity int→int32 (data corruption âm thầm), tràn int64 tiền, customer FK→500, không giới hạn item → fix (trần quantity/tiền/item, map FK 23503→400) → re-verify PASS. Nhảy bậc status confirmed→done cho phép (chủ đích: giao tận tay).
6. [✅] Task 6 — Admin customers CRUD paginated (REQ-CUST-001)
   - Files: cmd/server/admin_customers.go (CRUD + validate name/type/phone/email/MaxLen), main.go ErrorHandlerFunc chuẩn hóa lỗi param JSON toàn API. Commit 498255d → 5d5497a.
   - Gate: HELD-OUT PASS (phân trang {items,total}, CRUD, validate 400 trước DB, không leak log). go-reviewer PASS → fix param bind error → JSON {error} toàn API (finding minor). phone/email không unique = chủ đích spec.
7. [✅] Task 7 — Admin dashboard + security-review (REQ-DASH-001)
   - Dashboard: GET /admin/dashboard (new_leads/processing_orders/revenue_this_month, doanh thu giờ VN). Held-out PASS (delta + biên tháng + lọc status). Commit f904bea.
   - Security-review TỔNG admin/auth: KHÔNG có HIGH/CRITICAL. Bảng endpoint xác nhận không sót auth; JWT/upload/overflow/injection/info-leak đều đạt. Fix M1: rate-limit POST /auth/login 10/phút chống brute-force. Commit 0499b98.
   - MEDIUM/LOW → deploy-gate GĐ6 (task 0b): đổi mật khẩu admin mặc định (bắt buộc), HTTPS/HSTS/Secure cookie, security headers, CSRF defense-in-depth, real-IP sau proxy.

### ✅ GIAI ĐOẠN 4 HOÀN THÀNH (7/7) — 2026-07-17
Backend admin đầy đủ: đăng nhập JWT + quản lý sản phẩm(upload ảnh)/leads(convert)/đơn hàng(transaction+snapshot)/khách hàng/dashboard doanh thu. Mọi task qua held-out + go-reviewer; security-review tổng không HIGH/CRITICAL. Verify độc lập cứu nhiều lỗi thật: race convert, data-corruption tiền, doanh thu lệch múi giờ, footgun JWT secret, brute-force login.
   - security-review scope thêm (từ go-reviewer Task 2): (a) CSRF cho admin mutations POST/PUT/DELETE (SameSite=Lax hiện đủ cho form cross-site nhưng cân nhắc double-submit/Origin check khi có mutation); (b) quy ước "mọi route cần auth phải dưới /api/v1/admin/*" — kiểm không route mutation nào đặt ngoài prefix mà quên bảo vệ.

## Giai đoạn 5 — Admin UI

Plan: `docs/superpowers/plans/2026-07-17-giai-doan-5-admin-ui.md`. Mỗi task UI: screenshot loop + design-evaluator (nhất quán tokens Mooni + usability, không pixel-match). Task form thêm qa-evaluator held-out.

1. [⏳] Task 1 — shadcn setup + admin shell + login + dashboard (REQ-ADM-001, REQ-AUTH-004, REQ-DASH-001 UI)
2. [ ] Task 2 — Quản lý sản phẩm: table + form + upload ảnh (REQ-PROD-002/003 UI)
3. [ ] Task 3 — Quản lý leads: table phân trang + status + convert (REQ-LEAD-004/005 UI)
4. [ ] Task 4 — Quản lý đơn hàng: table + tạo đơn + chi tiết + status (REQ-ORD UI)
5. [ ] Task 5 — Quản lý khách hàng: table + form (REQ-CUST-001 UI)

## Giai đoạn 6 — Deploy (task đã chốt trước)

0. [ ] **Rate-limit real client IP behind proxy** (phát hiện GĐ3 Task 4): form submit đi qua Next Server Action → Go API thấy RemoteAddr = IP Next server, không phải client → rate limit 20/phút bị chia CHUNG toàn site + mất bảo vệ per-IP. Fix khi deploy: Caddy same-origin proxy /api + Go tin X-Forwarded-For TỪ trusted proxy (Caddy/Next) để lấy client IP thật. Phải xong trước launch.
0b. [ ] **Security deploy-gate GĐ6** (từ security-review tổng GĐ4 — MEDIUM/LOW, không chặn đóng GĐ4):
   - BẮT BUỘC trước production: đổi mật khẩu admin mặc định (đặt SEED_ADMIN_PASSWORD, không dùng 'mooni-admin') — nếu bỏ qua, brute-force login thành CRITICAL.
   - APP_ENV=production để cookie Secure=true; reverse proxy ép HTTPS + HSTS (M2).
   - Header bảo mật toàn cục API (CSP/X-Frame-Options/Referrer-Policy — L6); nosniff mới chỉ ở /uploads.
   - (defense-in-depth) Origin/Referer check hoặc double-submit CSRF cho mutation admin, hoặc SameSite=Strict cookie admin (L4). JWT TTL ngắn hơn / token version thu hồi (L3).
1. [ ] Viết runbook vận hành `docs/runbook.md`: deploy lên VPS, rollback về bản trước, restore backup Postgres, xem log khi sự cố. DoD: từng mục có lệnh cụ thể đã chạy thử thật ít nhất 1 lần (kể cả restore). Kèm 2 mốc security-review bắt buộc theo CLAUDE.md.

## Backlog ý tưởng (chưa thành task)

- Trang admin cần thống kê doanh thu theo tháng
- Xuất danh sách đơn ra Excel/CSV cho kế toán
- Trạng thái sản phẩm "Sắp hết" (low_stock, amber) — mockup có, enum hiện chỉ available/sold_out/hidden. Thêm khi làm admin product management (GĐ4-5): mở rộng CHECK status + badge amber + landing render.
