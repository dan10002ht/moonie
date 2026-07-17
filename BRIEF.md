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
6. [⏳] Task 6 — openapi-typescript contract gate phía web (SRS §5, NFR-006)
7. [ ] Task 7 — CI GitHub Actions lint+test+build + full compose (NFR-007)
8. [ ] Task 8 — Project skill `run-moonie` + seed data mẫu (CLAUDE.md; làm CUỐI khi app đã tồn tại)

## Giai đoạn 6 — Deploy (task đã chốt trước)

1. [ ] Viết runbook vận hành `docs/runbook.md`: deploy lên VPS, rollback về bản trước, restore backup Postgres, xem log khi sự cố. DoD: từng mục có lệnh cụ thể đã chạy thử thật ít nhất 1 lần (kể cả restore). Kèm 2 mốc security-review bắt buộc theo CLAUDE.md.

## Backlog ý tưởng (chưa thành task)

- Trang admin cần thống kê doanh thu theo tháng
- Xuất danh sách đơn ra Excel/CSV cho kế toán
