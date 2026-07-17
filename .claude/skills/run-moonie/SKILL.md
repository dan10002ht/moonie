---
name: run-moonie
description: Use when you need to boot, run, or start the Mooni Cake app locally — bring up Postgres, migrate, seed, and launch the Go API and Next.js web — or when verifying a change against the running app (generator or evaluator). Covers Colima/testcontainers/CGO env pitfalls specific to this dev machine.
---

# Boot Mooni Cake locally

## Overview

The ONE canonical way to bring the Mooni Cake stack up. Every agent (generator, qa-evaluator, design-evaluator) uses this — do not improvise a boot sequence. Run from repo root `/Users/dantt1002/projects/moonie`.

Stack: Postgres (Docker/Colima, host port **5440**) · Go API (**:8080**, `/api/v1`) · Next.js web (**:3000**).

## Services & URLs

| Service | URL / port | Start command |
|---|---|---|
| Postgres | `localhost:5440` db `mooni` user/pass `mooni` | `make up` |
| Go API | http://localhost:8080/api/v1 | `cd api && GOTOOLCHAIN=local go run ./cmd/server` |
| Next.js web | http://localhost:3000 | `cd web && npm run dev` |
| Health check | http://localhost:8080/api/v1/healthz | `curl -s .../healthz` → `{"status":"ok"}` |

## Boot sequence (run in order, from repo root)

1. **Ensure Colima is up** (Docker runs on Colima, NOT Docker Desktop):
   ```bash
   colima status || colima start
   docker context show   # must print: colima
   ```
2. **Postgres**: `make up` — then wait until healthy:
   ```bash
   docker compose ps     # wait for moonie-postgres-1 ... (healthy)
   ```
3. **Migrate schema**: `make migrate`
4. **Seed sample data**: `make seed` (idempotent — safe to re-run; creates the admin below)
5. **Run the API** (loads `.env`, binds `:8080`):
   ```bash
   cd api && set -a && . ../.env && set +a && GOTOOLCHAIN=local go run ./cmd/server
   ```
6. **Run the web** (once `web/` exists — Task 5+):
   ```bash
   cd web && npm run dev
   ```
7. **Verify** the API is live:
   ```bash
   curl -s http://localhost:8080/api/v1/healthz   # → {"status":"ok"}
   ```

To restart just the app without wiping data: `docker compose stop api web` (or kill the `go run`/`npm` processes). **Never `docker compose down -v`** unless you intend to destroy `pgdata` — that forces a full migrate + seed again.

## Default admin credential (after `make seed`)

- **Email:** `admin@mooni.local`
- **Password:** `mooni-admin` (override by exporting `SEED_ADMIN_PASSWORD` before `make seed`)

Password is stored bcrypt-hashed. Giai đoạn 1 only has the `admin_users` table, so seed creates only this admin — sample products/leads come in later phases (their tables don't exist yet).

## Environment pitfalls (this dev machine — read before debugging)

- **`CGO_ENABLED=0` is mandatory** for `go test` / `golangci-lint`. A `cc` shim (`~/.local/bin/cc`) shadows the real compiler and breaks cgo builds (testcontainers' gopsutil) with `unknown option '-E'`. Always use `make test` / `make lint` / `make check` — never bare `go test ./...` or `golangci-lint run`, they fail with fake typecheck errors.
- **Go floor 1.25**; use `GOTOOLCHAIN=local` to run with the installed toolchain (1.26.x).
- **testcontainers on Colima** needs `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` + `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` — already baked into `make test`. Run integration tests only via `make`.
- **`/var/run/docker.sock` points at Docker Desktop** on this machine, not Colima. So bare `go test` (bypassing `make`) hits the wrong runtime or fails. When in doubt, `docker context show` must say `colima`.
- **Port 5440**, not 5432 — 5432/5433 are taken by other dev containers.
- **Port 8080 already in use** on server start → a stale server is running. Clear it: `lsof -ti tcp:8080 | xargs kill -9`.

## Common mistakes

- Running the API before `make up`/`make migrate` → DB connect/`relation does not exist` errors. Follow the order.
- Forgetting `set -a && . ../.env` when launching the server manually → `thiếu biến môi trường DATABASE_URL`.
- Using `go test`/`golangci-lint` directly instead of `make test`/`make lint` → spurious cgo/typecheck failures.
- `docker compose down -v` to "restart" → wipes DB; use `docker compose stop` instead.
