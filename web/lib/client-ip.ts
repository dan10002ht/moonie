import { headers } from "next/headers";

/**
 * Đọc IP client thật của request đến Next từ header do Caddy set (Next đứng sau
 * Caddy ở production). Ưu tiên `x-forwarded-for` (lấy hop TRÁI nhất = client thật
 * do Caddy ghi), fallback `x-real-ip`. Trả `null` khi không có (dev/local).
 *
 * Server Action gọi Go API server-to-server nên Go chỉ thấy IP Next; giá trị này
 * được forward qua header `X-Forwarded-For` để Go rate-limit theo IP khách thật.
 */
export async function clientIpFromRequest(): Promise<string | null> {
  const h = await headers();

  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = h.get("x-real-ip")?.trim();
  return real ? real : null;
}
