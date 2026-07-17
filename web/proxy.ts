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
  const hasSession = Boolean(request.cookies.get(COOKIE_NAME)?.value);
  const isLogin =
    pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);

  // Trang đăng nhập: đã có phiên → vào thẳng /admin (khỏi đăng nhập lại);
  // chưa có phiên → cho qua (nếu chặn sẽ lặp redirect vô hạn).
  if (isLogin) {
    if (hasSession) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  // Mọi /admin/* khác: thiếu cookie → về trang đăng nhập.
  if (!hasSession) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
