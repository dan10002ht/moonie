# Giai đoạn 1 — Scaffold Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng bộ khung monorepo chạy được đầu-cuối: `docker compose up` lên Postgres + Go API (health check xanh) + Next.js 16, với contract OpenAPI spec-first nối 2 phía và CI GitHub Actions gác cổng — chưa có feature nghiệp vụ, nhưng mọi task nghiệp vụ giai đoạn sau cắm vào là chạy.

**Architecture:** Monorepo `web/` (Next.js 16 App Router, Turbopack) + `api/` (Go, chi router, pgx + sqlc, golang-migrate). PostgreSQL trong Docker. API là spec-first: `api/openapi.yaml` là hợp đồng, `oapi-codegen` sinh `ServerInterface` cho Go (lệch spec = fail compile), `openapi-typescript` sinh types cho web. Integration test Go chạy Postgres thật qua testcontainers-go.

**Tech Stack:** Go 1.23+, chi v5, pgx v5, sqlc, golang-migrate, oapi-codegen v2, testcontainers-go · Next.js 16, TypeScript strict, Tailwind CSS, openapi-typescript · Docker Compose, GitHub Actions.

## Global Constraints

- **Trace bắt buộc:** mỗi task trace về REQ/NFR trong `docs/ba/02-SRS.md`. Task không trace được = không hợp lệ.
- **Next.js 16:** `params`/`searchParams` truy cập async; auth guard dùng `proxy.ts` (không `middleware.ts`). (REQ-AUTH-004)
- **Secrets chỉ qua env** (NFR-005): `DATABASE_URL`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Không commit. Có `.env.example` (đã gitignore `.env`).
- **API path:** mọi endpoint dưới `/api/v1` (REQ, SRS mục Quyết định §5).
- **Lỗi API:** JSON `{"error": string}` + status code đúng ngữ nghĩa, không leak internal (NFR-006).
- **SQL chỉ qua sqlc** (NFR-004). Migration mới không sửa migration đã chạy.
- **TypeScript strict, cấm `any`** (CLAUDE.md). Go: wrap error kèm ngữ cảnh, table-driven tests.
- **Design tokens** (REQ-ADM-001): navy `#041E4F`, navy-light `#0B2A64`, gold `#C6A867`, gold-deep `#B0925A`, cream `#F7F6F4`, ink `#22201B`, border `#E6E4DE`. Font Playfair Display + Be Vietnam Pro.
- **Commit:** conventional commits. Mỗi task pass evaluator mới mark ✅ trong BRIEF.md.

## File Structure

```
docker-compose.yml            # postgres (+ api, web ở task cuối)
.env.example                  # mẫu env, không secret thật
api/
  go.mod, go.sum
  cmd/server/main.go          # entrypoint: load config, chi router, /healthz
  cmd/migrate/main.go         # chạy golang-migrate
  internal/config/config.go   # đọc env → struct Config
  internal/httpx/errors.go    # writeError(w, status, msg) → JSON {error}
  internal/db/db.go           # pgxpool khởi tạo từ DATABASE_URL
  openapi.yaml                # hợp đồng API (spec-first)
  internal/api/gen.go         # //go:generate oapi-codegen; code sinh ra
  sqlc.yaml
  internal/store/query.sql    # SQL cho sqlc
  internal/store/*.go         # code sqlc sinh
  migrations/0001_init.up.sql, 0001_init.down.sql
  internal/store/store_test.go # integration test testcontainers-go
  Dockerfile
web/
  package.json, tsconfig.json (strict)
  next.config.ts
  tailwind.config.ts          # design tokens
  app/layout.tsx, app/page.tsx (placeholder)
  lib/api.ts                  # client gọi Go API (1 nơi duy nhất)
  types/api.d.ts              # openapi-typescript sinh
  proxy.ts                    # skeleton auth guard /admin
  Dockerfile
.github/workflows/ci.yml      # lint+test+build api & web, Postgres service container
Makefile                      # lệnh tiện: gen, migrate, test, up
```

---

### Task 1: Docker Compose + Postgres + khung env

**Trace:** NFR-008 (1 VPS Docker Compose), NFR-005 (secrets qua env).

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `Makefile`

**Interfaces:**
- Produces: service `postgres` (port 5432, db `mooni`, user `mooni`), biến `DATABASE_URL` chuẩn cho các task sau.

- [ ] **Step 1: Viết `.env.example`**

```
# Host port 5440 (5432/5433 đã bị container dev khác chiếm trên máy này)
DATABASE_URL=postgres://mooni:mooni@localhost:5440/mooni?sslmode=disable
JWT_SECRET=change-me-in-production
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

- [ ] **Step 2: Viết `docker-compose.yml` (chỉ Postgres ở task này)**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: mooni
      POSTGRES_PASSWORD: mooni
      POSTGRES_DB: mooni
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mooni"]
      interval: 5s
      timeout: 5s
      retries: 5
volumes:
  pgdata:
```

- [ ] **Step 3: Viết `Makefile`** với target `up` (`docker compose up -d postgres`), placeholder cho `gen`/`migrate`/`test` (điền dần).

- [ ] **Step 4: Verify** — `docker compose up -d postgres`, đợi `docker compose ps` thấy `healthy`. `psql "$DATABASE_URL" -c '\l'` liệt kê được db `mooni`.

- [ ] **Step 5: Commit** — `chore: docker compose postgres + khung env`

---

### Task 2: Go API skeleton — config, chi router, /healthz, error helper

**Trace:** NFR-006 (error JSON chuẩn), NFR-005 (config qua env). Nền cho mọi REQ API.

**Files:**
- Create: `api/go.mod`, `api/cmd/server/main.go`, `api/internal/config/config.go`, `api/internal/httpx/errors.go`, `api/internal/db/db.go`
- Test: `api/internal/httpx/errors_test.go`, `api/internal/config/config_test.go`

**Interfaces:**
- Produces:
  - `config.Load() (*config.Config, error)` — struct có `DatabaseURL, JWTSecret, TelegramBotToken, TelegramChatID string`, `Port string` (mặc định `8080`).
  - `httpx.WriteError(w http.ResponseWriter, status int, msg string)` — ghi JSON `{"error": msg}` + header.
  - `httpx.WriteJSON(w http.ResponseWriter, status int, v any)`.
  - `db.NewPool(ctx, url) (*pgxpool.Pool, error)`.
  - Server phục vụ `GET /api/v1/healthz` → 200 `{"status":"ok"}`.

- [ ] **Step 1: Init module** — `cd api && go mod init github.com/moonie/api`, thêm chi v5, pgx v5.

- [ ] **Step 2: Test cho `httpx.WriteError`**

```go
func TestWriteError(t *testing.T) {
	rec := httptest.NewRecorder()
	httpx.WriteError(rec, http.StatusBadRequest, "phone không hợp lệ")
	if rec.Code != 400 { t.Fatalf("code = %d, want 400", rec.Code) }
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q", ct)
	}
	var body map[string]string
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body["error"] != "phone không hợp lệ" { t.Fatalf("body = %v", body) }
}
```

- [ ] **Step 3: Run test → FAIL** (`go test ./internal/httpx/` — undefined: WriteError).

- [ ] **Step 4: Implement `httpx/errors.go`** (`WriteError`, `WriteJSON` set Content-Type, encode, WriteHeader theo status).

- [ ] **Step 5: Run test → PASS.**

- [ ] **Step 6: Test `config.Load`** — set env `DATABASE_URL`, gọi `Load()`, assert field khớp; thiếu `DATABASE_URL` → trả error.

- [ ] **Step 7: Implement `config.Load`** (đọc `os.Getenv`, default `Port=8080`, error nếu thiếu `DATABASE_URL`).

- [ ] **Step 8: Run config test → PASS.**

- [ ] **Step 9: `main.go`** — `config.Load` → `db.NewPool` → chi router mount `/api/v1/healthz` → `http.ListenAndServe(":"+cfg.Port, r)`.

- [ ] **Step 10: Verify chạy thật** — `go run ./cmd/server` (với Postgres đang lên), `curl localhost:8080/api/v1/healthz` → `{"status":"ok"}`.

- [ ] **Step 11: Commit** — `feat(api): skeleton chi router, config, error helper, healthz`

---

### Task 3: OpenAPI spec-first + oapi-codegen (contract gate phía Go)

**Trace:** SRS Quyết định §5 (openapi.yaml là hợp đồng chính thức), NFR-006. Nền contract cho toàn bộ REQ API.

**Files:**
- Create: `api/openapi.yaml`, `api/internal/api/gen.go`, `api/tools.go`
- Modify: `api/cmd/server/main.go` (gắn assertion conformance)

**Interfaces:**
- Produces: package `api` sinh từ spec chứa `ServerInterface` + `HandlerFromMux`. Ban đầu spec chỉ khai báo `GET /api/v1/healthz` và schema `Error {error: string}` — các path nghiệp vụ thêm ở giai đoạn sau.

- [ ] **Step 1: Viết `api/openapi.yaml`** — OpenAPI 3.0, `servers: [{url: /api/v1}]`, path `/healthz` (200 → schema `Health {status: string}`), component schema `Error {type: object, required: [error], properties: {error: {type: string}}}`.

- [ ] **Step 2: `tools.go`** (build tag `tools`) import `oapi-codegen/v2/cmd/oapi-codegen` để pin version; `go mod tidy`.

- [ ] **Step 3: `gen.go`** với directive:

```go
//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen -generate types,chi-server -package api -o zz_generated.go ../../openapi.yaml
package api
```

- [ ] **Step 4: Sinh code** — `cd api && go generate ./...`. Xác nhận `internal/api/zz_generated.go` xuất hiện, có `type ServerInterface interface`.

- [ ] **Step 5: Conformance assertion** — trong `main.go` thêm `var _ api.ServerInterface = (*Server)(nil)` với `Server` implement `GetApiV1Healthz`. `go build ./...` phải xanh; thử đổi tên method → build FAIL (chứng minh gate hoạt động), rồi khôi phục.

- [ ] **Step 6: Makefile `gen` target** = `cd api && go generate ./...`.

- [ ] **Step 7: Verify** — `go build ./...` xanh, `curl localhost:8080/api/v1/healthz` vẫn `{"status":"ok"}` (giờ đi qua handler sinh từ spec).

- [ ] **Step 8: Commit** — `feat(api): openapi spec-first + oapi-codegen contract gate`

---

### Task 4: sqlc + migration đầu + integration test testcontainers-go

**Trace:** NFR-004 (SQL chỉ qua sqlc), REQ-ORD-003/004 (nền transaction — bảng thật ở giai đoạn sau). Task này chỉ dựng cơ chế + 1 bảng `admin_users` tối thiểu để chứng minh đường ống DB.

**Files:**
- Create: `api/sqlc.yaml`, `api/migrations/0001_init.up.sql`, `api/migrations/0001_init.down.sql`, `api/internal/store/query.sql`, `api/cmd/migrate/main.go`, `api/internal/store/store_test.go`

**Interfaces:**
- Produces: package `store` (sqlc sinh) với `New(db) *Queries`, `Queries.CreateAdminUser`, `Queries.GetAdminUserByEmail`. Migration runner `cmd/migrate`.

- [ ] **Step 1: `migrations/0001_init.up.sql`** — bảng `admin_users` (id uuid pk default gen_random_uuid(), email text unique not null, password_hash text not null, name text, role text not null default 'admin', created_at timestamptz default now()). `.down.sql` drop bảng.

- [ ] **Step 2: `cmd/migrate/main.go`** dùng golang-migrate chạy các file trong `migrations/` thep `DATABASE_URL`; Makefile `migrate` target.

- [ ] **Step 3: Verify migrate** — `make migrate`, `psql "$DATABASE_URL" -c '\d admin_users'` thấy bảng.

- [ ] **Step 4: `sqlc.yaml` + `query.sql`** — 2 query name/annotation `:one`: `CreateAdminUser`, `GetAdminUserByEmail`. `sqlc generate` (thêm vào Makefile `gen`).

- [ ] **Step 5: Integration test (testcontainers-go)** — test spin Postgres:16 container, chạy migration, `CreateAdminUser` rồi `GetAdminUserByEmail` assert khớp email:

```go
func TestAdminUserRoundTrip(t *testing.T) {
	ctx := context.Background()
	pg, _ := postgres.Run(ctx, "postgres:16",
		postgres.WithDatabase("mooni"), postgres.WithUsername("mooni"), postgres.WithPassword("mooni"),
		testcontainers.WithWaitStrategy(wait.ForListeningPort("5432/tcp")))
	t.Cleanup(func() { pg.Terminate(ctx) })
	url, _ := pg.ConnectionString(ctx, "sslmode=disable")
	// migrate + New(pool); CreateAdminUser; GetAdminUserByEmail; assert
}
```

- [ ] **Step 6: Run → FAIL** (chưa có code store) → **implement** đến khi PASS: `go test ./internal/store/ -count=1`.

- [ ] **Step 7: Commit** — `feat(api): sqlc + golang-migrate + testcontainers integration test`

---

### Task 5: Next.js 16 scaffold + Tailwind design tokens

**Trace:** REQ-ADM-001 (design tokens), REQ-LAND-001 (nền landing), REQ-AUTH-004 (proxy.ts skeleton).

**Files:**
- Create: `web/` (next scaffold), `web/tailwind.config.ts`, `web/app/layout.tsx`, `web/app/page.tsx`, `web/lib/api.ts`, `web/proxy.ts`
- Modify: `web/tsconfig.json` (strict)

**Interfaces:**
- Produces: `lib/api.ts` export `apiFetch<T>(path: string, init?): Promise<T>` trỏ tới `process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080/api/v1"`. Tailwind theme có token màu + font.

- [ ] **Step 1: Scaffold** — `npx create-next-app@latest web --ts --tailwind --app --no-src-dir --turbopack` (điều chỉnh cho Next 16). Bật `strict: true`, `noUncheckedIndexedAccess: true` trong tsconfig.

- [ ] **Step 2: `tailwind.config.ts`** — thêm `theme.extend.colors` (navy `#041E4F`, navyLight `#0B2A64`, gold `#C6A867`, goldDeep `#B0925A`, cream `#F7F6F4`, ink `#22201B`, border `#E6E4DE`), `fontFamily` (serif Playfair Display, sans Be Vietnam Pro). Load 2 font qua `next/font/google` subset `vietnamese`.

- [ ] **Step 3: `app/layout.tsx`** — html lang="vi", body bg cream/ink, gắn font variables.

- [ ] **Step 4: `app/page.tsx`** placeholder — 1 màn dùng token (nền cream, heading serif navy, chữ gold) để chứng minh token hoạt động; đây KHÔNG phải landing thật (landing là giai đoạn sau).

- [ ] **Step 5: `lib/api.ts`** — `apiFetch` typed, throw kèm status khi !ok, parse JSON.

- [ ] **Step 6: `proxy.ts` skeleton** — match `/admin/:path*`, hiện tại cho qua kèm `TODO(auth giai đoạn 4)`, để đúng cơ chế Next 16.

- [ ] **Step 7: Verify** — `cd web && npm run build` xanh; `npm run dev` + `curl localhost:3000` trả HTML có font/màu token (grep thấy class dùng token).

- [ ] **Step 8: Commit** — `feat(web): next 16 scaffold + tailwind design tokens + api client`

---

### Task 6: openapi-typescript (contract gate phía web)

**Trace:** SRS Quyết định §5 (spec chốt 2 phía), NFR-006. Khép vòng contract web↔api.

**Files:**
- Create: `web/types/api.d.ts` (sinh), script trong `web/package.json`
- Modify: `web/lib/api.ts` (dùng types sinh)

**Interfaces:**
- Produces: script `npm run gen:api` = `openapi-typescript ../api/openapi.yaml -o types/api.d.ts`. `apiFetch` dùng type từ `types/api.d.ts`.

- [ ] **Step 1: Cài `openapi-typescript`** (devDep), thêm script `gen:api`.

- [ ] **Step 2: Sinh types** — `npm run gen:api`, xác nhận `types/api.d.ts` có `Health` và `Error` từ spec.

- [ ] **Step 3: Nối vào `lib/api.ts`** — ví dụ hàm `getHealth(): Promise<components["schemas"]["Health"]>` dùng `apiFetch`.

- [ ] **Step 4: Contract gate** — `npx tsc --noEmit` xanh; thử sửa `getHealth` trả field sai → `tsc --noEmit` FAIL (chứng minh gate), rồi khôi phục.

- [ ] **Step 5: Verify** — với api + web đang chạy, gọi `getHealth()` từ 1 test/route nhỏ trả đúng `{status:"ok"}`.

- [ ] **Step 6: Commit** — `feat(web): openapi-typescript contract gate`

---

### Task 7: CI GitHub Actions (gác cổng cả 2 phía)

**Trace:** NFR-007 (CI lint→test→build cả web lẫn api).

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `docker-compose.yml` (thêm service `api`, `web` build được), `api/Dockerfile`, `web/Dockerfile`

**Interfaces:**
- Produces: workflow chạy trên push/PR: job `api` (Postgres service container + go test bao gồm integration) và job `web` (tsc + build). Toàn stack `docker compose up` lên được.

- [ ] **Step 1: `api/Dockerfile`** (multi-stage build Go) + `web/Dockerfile` (Next standalone). Thêm `api`, `web` vào `docker-compose.yml` (api depends_on postgres healthy, env từ `.env`).

- [ ] **Step 2: Verify compose full** — `docker compose up -d`, cả 3 service healthy, `curl localhost:8080/api/v1/healthz` và `curl localhost:3000` đều 200.

- [ ] **Step 3: `ci.yml` job `api`** — service `postgres:16` với health-cmd `pg_isready` (interval 10s, retries 5); steps: setup-go (cache), `go vet`, `golangci-lint run`, `go test ./... -count=1` (integration dùng service container qua `DATABASE_URL` localhost:5432).

- [ ] **Step 4: `ci.yml` job `web`** — setup-node (cache npm), `npm ci`, `npm run gen:api`, `npx tsc --noEmit`, `npm run build`.

- [ ] **Step 5: Verify CI cục bộ** — chạy đúng chuỗi lệnh của cả 2 job trên máy, tất cả xanh (bằng chứng CI sẽ pass; không đoán).

- [ ] **Step 6: Commit** — `ci: github actions lint+test+build api & web + full compose`

---

### Task 8: Project skill `run-moonie` (boot chuẩn cho mọi agent)

**Trace:** CLAUDE.md (task đã chốt trong BRIEF.md giai đoạn 1). Làm CUỐI vì cần app đã tồn tại.

**Files:**
- Create: `.claude/skills/run-moonie/SKILL.md` (dùng skill `writing-skills`)

- [ ] **Step 1: Dùng skill superpowers:writing-skills** viết `run-moonie`: quy trình boot duy nhất — `docker compose up -d` → đợi healthcheck → `make migrate` → seed 1 admin + vài product mẫu → URL/port từng service (api 8080, web 3000, postgres 5432).

- [ ] **Step 2: Seed script** — `cmd/seed` hoặc SQL: tạo 1 admin_user (bcrypt) + 2-3 product mẫu để landing/admin có dữ liệu hiển thị khi test.

- [ ] **Step 3: Verify** — làm theo skill từ trạng thái `docker compose down -v` sạch → ra app chạy đầy đủ có dữ liệu mẫu. qa-evaluator/design-evaluator sẽ dùng skill này.

- [ ] **Step 4: Commit** — `chore: skill run-moonie + seed data mẫu`

---

## Self-Review

**Spec coverage (giai đoạn 1 = scaffold, các REQ nghiệp vụ đầy đủ ở giai đoạn sau):**
- NFR-008 (Docker Compose) → Task 1, 7 ✓
- NFR-005 (secrets env) → Task 1 ✓
- NFR-006 (error JSON) → Task 2 ✓
- NFR-004 (sqlc) → Task 4 ✓
- NFR-007 (CI) → Task 7 ✓
- SRS Quyết định §5 (openapi 2 phía) → Task 3, 6 ✓
- REQ-ADM-001 (tokens) → Task 5 ✓
- REQ-AUTH-004 (proxy.ts) → Task 5 (skeleton), hoàn thiện giai đoạn 4 ✓
- Nền cho REQ-PROD/LEAD/ORD/CUST/AUTH/NOTI → khung store+api+contract dựng ở Task 2-4-6, feature ở giai đoạn sau.

**Không thuộc giai đoạn 1 (ghi rõ để không scope-creep):** landing thật (REQ-LAND, giai đoạn 3), endpoints nghiệp vụ (giai đoạn 2+), auth thật (giai đoạn 4), Telegram (giai đoạn 2), admin UI (giai đoạn 5), deploy/backup/HTTPS (giai đoạn 6). NFR-001/002/003/009/010/011 kiểm ở các giai đoạn tương ứng.

**Placeholder scan:** không có TBD/TODO chưa định nghĩa (proxy.ts TODO là chủ đích, có task đóng ở giai đoạn 4).

**Type consistency:** `apiFetch`/`WriteError`/`WriteJSON`/`config.Load`/`db.NewPool`/`ServerInterface` dùng nhất quán across tasks.
