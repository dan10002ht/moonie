"use server";

import { cookies } from "next/headers";
import type { components } from "@/types/api";
import { API_BASE, ApiError } from "@/lib/api";
import { ADMIN_COOKIE, adminFetch } from "@/lib/admin-api";

/** 3 chỉ số tổng quan dashboard (schema `Dashboard` sinh từ OpenAPI). */
export type Dashboard = components["schemas"]["Dashboard"];

/** Kết quả đăng nhập trả về client (LoginForm) để hiện lỗi khi thất bại. */
export type LoginResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Đọc giá trị cookie `mc_admin` từ (các) header Set-Cookie mà API trả về khi
 * đăng nhập thành công. `getSetCookie()` (undici) trả mảng từng Set-Cookie riêng.
 * Trả `{ value, maxAge }` — maxAge để mirror tuổi phiên của API vào cookie Next.
 */
function parseSessionCookie(
  headers: Headers,
): { value: string; maxAge?: number } | null {
  const setCookies = headers.getSetCookie();
  for (const raw of setCookies) {
    const parts = raw.split(";");
    const first = parts[0]?.trim() ?? "";
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    if (name !== ADMIN_COOKIE) continue;

    const value = first.slice(eq + 1).trim();
    let maxAge: number | undefined;
    for (const attr of parts.slice(1)) {
      const [k, v] = attr.split("=");
      if (k?.trim().toLowerCase() === "max-age" && v) {
        const n = Number.parseInt(v.trim(), 10);
        if (Number.isFinite(n)) maxAge = n;
      }
    }
    return { value, maxAge };
  }
  return null;
}

/**
 * Đăng nhập admin. Gọi POST {API}/auth/login server-to-server; nếu 200 → LẤY
 * cookie `mc_admin` từ Set-Cookie của API rồi SET vào cookie của Next (httpOnly,
 * path /) để browser giữ phiên. 401 → trả lỗi. Browser không gọi trực tiếp API
 * nên Server Action phải chuyển tiếp cookie API set sang response Next.
 */
export async function loginAction(
  email: string,
  password: string,
): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "Không kết nối được máy chủ, vui lòng thử lại." };
  }

  if (response.status === 200) {
    const session = parseSessionCookie(response.headers);
    if (!session) {
      return {
        ok: false,
        message: "Đăng nhập thất bại: máy chủ không trả phiên. Thử lại sau.",
      };
    }
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_COOKIE, session.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      ...(session.maxAge !== undefined ? { maxAge: session.maxAge } : {}),
    });
    return { ok: true };
  }

  if (response.status === 401) {
    return { ok: false, message: "Email hoặc mật khẩu không đúng." };
  }

  // Lỗi khác (400/500…): lấy message từ body {error} nếu có.
  let message = "Đăng nhập thất bại, vui lòng thử lại.";
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
    // giữ message mặc định
  }
  return { ok: false, message };
}

/**
 * Đăng xuất admin. Báo API xóa phiên (best-effort) rồi xóa cookie `mc_admin`
 * phía Next để proxy.ts chặn lại /admin.
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: token ? { Cookie: `${ADMIN_COOKIE}=${token}` } : undefined,
      cache: "no-store",
    });
  } catch {
    // Kể cả API lỗi vẫn xóa cookie local để đăng xuất chắc chắn.
  }
  cookieStore.delete(ADMIN_COOKIE);
}

/**
 * Lấy 3 chỉ số dashboard. Gọi GET {API}/admin/dashboard kèm cookie `mc_admin`
 * (adminFetch tự forward). Ném `ApiError` (401 = phiên hỏng) để caller xử lý.
 */
export async function getDashboard(): Promise<Dashboard> {
  return adminFetch<Dashboard>("/admin/dashboard");
}

/** Re-export cho caller phân biệt lỗi theo status khi cần. */
export { ApiError };
