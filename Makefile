.PHONY: up gen migrate test

up:
	docker compose up -d postgres

gen:
	cd api && GOTOOLCHAIN=local go generate ./...
	cd api && sqlc generate

migrate:
	cd api && set -a && . ../.env && set +a && GOTOOLCHAIN=local go run ./cmd/migrate up

test:
	cd api && GOTOOLCHAIN=local CGO_ENABLED=0 go test ./... -count=1
