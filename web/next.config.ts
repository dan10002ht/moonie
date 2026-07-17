import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Xuất bản standalone: `next build` gói server + node_modules tối thiểu vào
  // `.next/standalone`, cho phép runtime image nhỏ (không cần cả node_modules).
  output: "standalone",
};

export default nextConfig;
