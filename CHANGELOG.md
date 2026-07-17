# Changelog

## 2026-07-17

### Giai đoạn 1 — Scaffold
- **Task 1** — Docker Compose + Postgres (port 5440 trên Colima) + khung env (.env.example, Makefile). Commit `bfff066`.
- **Task 2** — Go API skeleton: chi router, config từ env, error helper JSON, db pool, `GET /api/v1/healthz`, graceful shutdown, `.golangci.yml`. go-reviewer bắt lỗ hổng IP-spoofing (RealIP) + thiếu timeout/graceful shutdown → đã sửa. Commit `e9b516c` → `8696c89`.
- **Task 3** — OpenAPI spec-first (`api/openapi.yaml`) + oapi-codegen v2.4.1: sinh `ServerInterface`, wire router qua `HandlerFromMuxWithBaseURL(/api/v1)`, contract gate cưỡng chế lúc compile. Commit `c659470`.
- **Task 4** — sqlc + golang-migrate (bảng `admin_users`) + integration test testcontainers-go (Postgres:16 thật). Phát hiện shim `cc` phá CGO → chuẩn hóa `make lint`/`make test` với `CGO_ENABLED=0`. Go floor lên 1.25 (testcontainers). Commit `ed1e6ea`, `0e74f8b`.
- **Task 5** — Next.js 16.2.10 scaffold (Turbopack) + Tailwind v4 design tokens (`@theme`), font Playfair Display + Be Vietnam Pro, `lib/api.ts` client, `proxy.ts` skeleton auth guard `/admin`. Commit `dc40754`.
- **Task 6** — openapi-typescript: sinh `web/types/api.d.ts` từ spec, `getHealth()` typed, `tsc --noEmit` thành contract gate compile-time phía web. Vòng contract web↔api khép kín. Commit `1ecc8f3`.
- **Task 7** — CI GitHub Actions (`.github/workflows/ci.yml`, 2 job lint+test+build) + Dockerfile api (distroless 17.7MB) & web (standalone 388MB) + full `docker compose` cả stack. Fix package-lock portability (darwin→linux) và testcontainers trên Colima (socket override). Commit `7bda1f8`, `97589ae`.
- **Task 8** — Project skill `run-moonie` (boot runbook cho mọi agent) + `api/cmd/seed` (admin mẫu idempotent, bcrypt). Commit `b2a5914`.
- **🎉 Giai đoạn 1 (Scaffold) hoàn thành 8/8** — monorepo Next.js 16 + Go + Postgres chạy được đầu-cuối, contract OpenAPI 2 phía, CI + Docker sẵn sàng.

### Giai đoạn 2 — API Public
- **Task 1** — `GET /api/v1/products` public (bảng products, chỉ trả status != hidden, ORDER BY tất định). Held-out acceptance test 12/12 + go-reviewer PASS. Commit `3aedd62`, `207ed4b`.
- **Task 2** — `POST /api/v1/leads` public (bảng leads, validate SĐT VN/tên/độ dài, rate limit 20/phút/IP theo RemoteAddr chống spoof, log che SĐT NFR-009, lưu status `new`). Held-out 7/7 (phơi vấn đề rate limit 5/phút chặn oan IP NAT doanh nghiệp → bump 20) + go-reviewer PASS. Commit `357eba7`, `1b4020d`.
- **Task 3** — Telegram notify lead mới, fail-safe (goroutine + timeout, POST /leads luôn 201 dù Telegram lỗi/treo/không token; `TELEGRAM_API_BASE` override để test; log che SĐT; không rò token bot). Held-out 3/3 + go-reviewer PASS. Commit `4fb4a0d`, `7b59e92`.
