# syntax=docker/dockerfile:1

# ── Deps stage ───────────────────────────────────────────────────────────────
# alpine → base nhỏ hơn slim ~60-70MB. libc6-compat cho các prebuilt (swc) cần glibc.
# Cài dependencies theo lockfile (npm ci) tách riêng để cache khi chỉ code đổi.
# Cache mount /root/.npm → rebuild không tải lại package đã có.
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ── Build stage ──────────────────────────────────────────────────────────────
# next.config bật output:"standalone" → sinh .next/standalone (server tối giản).
# types/api.d.ts đã commit sẵn (sinh từ openapi bằng `npm run gen:api`); build ở
# đây KHÔNG chạy gen:api vì context chỉ có ./web (không thấy ../api/openapi.yaml).
FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
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
