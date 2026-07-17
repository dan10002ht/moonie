import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth guard cho khu vực /admin (REQ-AUTH-004).
 * Next 16: dùng `proxy.ts` (middleware.ts đã deprecate).
 *
 * Skeleton giai đoạn 1: hiện cho mọi request đi qua.
 * TODO(auth giai đoạn 4): đọc JWT trong httpOnly cookie từ `request`,
 * chưa đăng nhập thì redirect về /admin/login.
 */
export function proxy(request: NextRequest): NextResponse {
  void request;
  return NextResponse.next();
}

export const config = {
  matcher: "/admin/:path*",
};
