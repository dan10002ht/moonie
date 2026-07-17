# Changelog

## 2026-07-17

### Giai đoạn 1 — Scaffold
- **Task 1** — Docker Compose + Postgres (port 5440 trên Colima) + khung env (.env.example, Makefile). Commit `bfff066`.
- **Task 2** — Go API skeleton: chi router, config từ env, error helper JSON, db pool, `GET /api/v1/healthz`, graceful shutdown, `.golangci.yml`. go-reviewer bắt lỗ hổng IP-spoofing (RealIP) + thiếu timeout/graceful shutdown → đã sửa. Commit `e9b516c` → `8696c89`.
