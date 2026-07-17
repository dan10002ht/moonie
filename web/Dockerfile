# syntax=docker/dockerfile:1

# ── Deps stage ───────────────────────────────────────────────────────────────
# alpine → base nhỏ hơn slim ~60-70MB. libc6-compat cho các prebuilt (swc) cần glibc.
# Cài dependencies tách riêng để cache khi chỉ code đổi.
# Cache mount /root/.npm → rebuild không tải lại package đã có.
# npm install (không npm ci): lock sinh trên darwin thiếu native binary
# @tailwindcss/oxide-linux-x64-musl (alpine) — optionalDependencies theo os/cpu.
# npm install vẫn theo lock cho dep nhất quán, chỉ reconcile native binary theo platform.
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund

# ── Build stage ──────────────────────────────────────────────────────────────
# next.config bật output:"standalone" → sinh .next/standalone (server tối giản).
# types/api.d.ts đã commit sẵn (sinh từ openapi bằng `npm run gen:api`); build ở
# đây KHÔNG chạy gen:api vì context chỉ có ./web (không thấy ../api/openapi.yaml).
FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
# NEXT_PUBLIC_API_BASE được Next INLINE lúc build (biến NEXT_PUBLIC_* nhúng vào cả
# client bundle lẫn CSP trong next.config.ts — img-src/connect-src suy từ origin này).
# Vì vậy KHÔNG thể set lúc runtime; phải truyền qua build ARG. Production truyền
# origin công khai qua Caddy (https://<domain>/api/v1) để ảnh /uploads + CSP đúng.
# Default giữ hành vi dev (localhost) khi build không truyền arg (vd docker-compose.yml).
ARG NEXT_PUBLIC_API_BASE=http://localhost:8080/api/v1
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone gồm server.js + node_modules tối thiểu; static/ và public/ copy kèm.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000
USER node
CMD ["node", "server.js"]
