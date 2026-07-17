/**
 * Client gọi API admin (dưới /admin/*) — server-to-server, TỰ ĐÍNH cookie phiên.
 *
 * Vì sao cần riêng: `apiFetch` (lib/api.ts) không forward cookie. Các endpoint
 * admin yêu cầu JWT trong cookie httpOnly `mc_admin`. Khi Server Action / Server
 * Component gọi API, request server→server KHÔNG tự mang cookie của browser — ta
 * phải đọc `mc_admin` từ `next/headers` cookies() rồi gắn vào header `Cookie`.
 */

import { cookies } from "next/headers";
import { API_BASE, ApiError } from "./api";

/** Tên cookie phiên admin (khớp API Go + proxy.ts). */
export const ADMIN_COOKIE = "mc_admin";

/**
 * Gọi API admin và parse JSON về `T`. Đính cookie `mc_admin` (đọc từ request
 * hiện tại) vào header `Cookie`. Ném `ApiError` kèm status khi response không ok
 * (401 = chưa đăng nhập / phiên hỏng → caller xử lý).
 */
export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;

  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Cookie", `${ADMIN_COOKIE}=${token}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Request thất bại với status ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (
        typeof body === "object" &&
        body !== null &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
      ) {
        message = (body as { error: string }).error;
      }
    } catch {
      // Body không phải JSON — giữ message mặc định.
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}
