.PHONY: up gen migrate test

up:
	docker compose up -d postgres

gen:
	cd api && GOTOOLCHAIN=local go generate ./...

migrate:
	# điền ở task sau

test:
	# điền ở task sau
