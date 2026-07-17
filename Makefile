.PHONY: up gen migrate test lint check

# Lưu ý môi trường máy dev này:
# - CGO_ENABLED=0 bắt buộc cho test/lint: shim `cc` của Claude Code (~/.local/bin/cc)
#   shadow compiler thật → build cgo (gopsutil của testcontainers) fail. Pure-Go thì OK.
# - Go floor = 1.25 (testcontainers-go v0.43 yêu cầu). GOTOOLCHAIN=local dùng toolchain sẵn.
# - testcontainers trên Colima: cần DOCKER_HOST=colima socket + SOCKET_OVERRIDE=/var/run/docker.sock
#   (path bên trong Colima VM) để Ryuk reaper mount được socket. CI GitHub dùng socket chuẩn, KHÔNG cần.
COLIMA_DOCKER_HOST := unix://$(HOME)/.colima/default/docker.sock
TC_ENV := DOCKER_HOST=$(COLIMA_DOCKER_HOST) TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock

up:
	docker compose up -d postgres

gen:
	cd api && GOTOOLCHAIN=local go generate ./...
	cd api && sqlc generate

migrate:
	cd api && set -a && . ../.env && set +a && GOTOOLCHAIN=local go run ./cmd/migrate up

test:
	cd api && $(TC_ENV) GOTOOLCHAIN=local CGO_ENABLED=0 go test ./... -count=1

lint:
	cd api && CGO_ENABLED=0 golangci-lint run

check: lint test
