# Changelog

## 2026-07-17

### Giai đoạn 1 — Scaffold
- **Task 1** — Docker Compose + Postgres (port 5440 trên Colima) + khung env (.env.example, Makefile). Commit `bfff066`.
- **Task 2** — Go API skeleton: chi router, config từ env, error helper JSON, db pool, `GET /api/v1/healthz`, graceful shutdown, `.golangci.yml`. go-reviewer bắt lỗ hổng IP-spoofing (RealIP) + thiếu timeout/graceful shutdown → đã sửa. Commit `e9b516c` → `8696c89`.
- **Task 3** — OpenAPI spec-first (`api/openapi.yaml`) + oapi-codegen v2.4.1: sinh `ServerInterface`, wire router qua `HandlerFromMuxWithBaseURL(/api/v1)`, contract gate cưỡng chế lúc compile. Commit `c659470`.
- **Task 4** — sqlc + golang-migrate (bảng `admin_users`) + integration test testcontainers-go (Postgres:16 thật). Phát hiện shim `cc` phá CGO → chuẩn hóa `make lint`/`make test` với `CGO_ENABLED=0`. Go floor lên 1.25 (testcontainers). Commit `ed1e6ea`, `0e74f8b`.
- **Task 5** — Next.js 16.2.10 scaffold (Turbopack) + Tailwind v4 design tokens (`@theme`), font Playfair Display + Be Vietnam Pro, `lib/api.ts` client, `proxy.ts` skeleton auth guard `/admin`. Commit `dc40754`.
- **Task 6** — openapi-typescript: sinh `web/types/api.d.ts` từ spec, `getHealth()` typed, `tsc --noEmit` thành contract gate compile-time phía web. Vòng contract web↔api khép kín. Commit `1ecc8f3`.
