import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth guard cho khu vực /admin (REQ-AUTH-004).
 * Next 16: dùng `proxy.ts` (middleware.ts đã deprecate).
 *
 * Chỉ kiểm tra SỰ TỒN TẠI của cookie phiên `mc_admin` để chặn sớm ở tầng web —
 * xác thực chữ ký/hết hạn THẬT do API Go làm (mọi /api/v1/admin/* qua middleware
 * JWT). Không đăng nhập (thiếu cookie) mà vào /admin (trừ /admin/login) → redirect
 * về /admin/login.
 */
const COOKIE_NAME = "mc_admin";
const LOGIN_PATH = "/admin/login";

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Trang đăng nhập luôn cho qua (nếu không sẽ lặp redirect vô hạn).
  if (pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`)) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.get(COOKIE_NAME)?.value;
  if (!hasSession) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
