import type { NextConfig } from "next";

// deriveConnectOrigin suy ra origin (scheme://host[:port]) của API backend từ
// NEXT_PUBLIC_API_BASE để đưa vào connect-src của CSP — browser (client component)
// gọi thẳng API Go qua origin này. Mặc định dev: http://localhost:8080.
function deriveConnectOrigin(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080/api/v1";
  try {
    return new URL(base).origin;
  } catch {
    return "http://localhost:8080";
  }
}

// buildCsp dựng Content-Security-Policy thực dụng cho Next App Router:
//   - default-src 'self': mọi tài nguyên mặc định chỉ từ cùng origin.
//   - script-src 'self' 'unsafe-inline': Next chèn inline bootstrap/hydration script
//     KHÔNG nonce trong cấu hình static headers() này → cần 'unsafe-inline'. Dev thêm
//     'unsafe-eval' cho React Fast Refresh / webpack HMR (chỉ dev, không lên prod).
//   - style-src 'self' 'unsafe-inline': Next/next-font chèn inline <style> khi render.
//   - img-src 'self' data: blob: + API origin: ảnh sản phẩm phục vụ từ API (/uploads).
//   - font-src 'self': next/font/google self-host font (build-time), không cần host ngoài.
//   - connect-src 'self' + API origin: fetch client-side gọi API Go; dev thêm ws: cho HMR.
//   - frame-ancestors 'none': chống clickjacking (tương đương X-Frame-Options DENY).
//   - base-uri 'self' / form-action 'self' / object-src 'none': siết bề mặt tấn công.
function buildCsp(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const api = deriveConnectOrigin();

  const scriptSrc = ["'self'", "'unsafe-inline'"];
  const connectSrc = ["'self'", api];
  if (isDev) {
    scriptSrc.push("'unsafe-eval'");
    connectSrc.push("ws:");
  }

  const directives: string[] = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${api}`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(" ")}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ];
  return directives.join("; ");
}

const nextConfig: NextConfig = {
  // Xuất bản standalone: `next build` gói server + node_modules tối thiểu vào
  // `.next/standalone`, cho phép runtime image nhỏ (không cần cả node_modules).
  output: "standalone",

  // Header bảo mật cho MỌI route (L6 + CSP). frame-ancestors trong CSP + X-Frame-Options
  // DENY cùng chống clickjacking (X-Frame-Options cho trình duyệt cũ). nosniff chống
  // MIME-sniff; Referrer-Policy tránh rò rỉ URL qua Referer.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: buildCsp() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
