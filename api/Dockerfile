# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
# golang:1.25 ships Go 1.25.x, thỏa `go 1.25.0` trong go.mod. GOTOOLCHAIN=local
# tránh tải toolchain khác. CGO_ENABLED=0 → binary tĩnh, chạy được trên distroless
# static (không libc). Chỉ build cmd/server (server HTTP); migrate chạy riêng.
FROM golang:1.25-bookworm AS build
WORKDIR /src

ENV GOTOOLCHAIN=local \
    CGO_ENABLED=0 \
    GOOS=linux

# Tải deps trước để tận dụng layer cache khi chỉ code đổi.
# Cache mount /go/pkg/mod + /root/.cache/go-build → rebuild nhanh hơn nhiều.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ── Runtime stage ────────────────────────────────────────────────────────────
# distroless/static: image tối thiểu, không shell/package manager, chỉ CA certs.
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /app/server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/server"]
