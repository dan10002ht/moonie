/**
 * Client gọi Go API — nơi DUY NHẤT thực hiện fetch tới backend (CLAUDE.md).
 * Không rải `fetch` khắp nơi; mọi route/component đi qua đây.
 */

import type { components } from "@/types/api";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080/api/v1";

/** Lỗi HTTP từ API — mang theo status code để caller xử lý ngữ nghĩa. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Gọi API và parse JSON về kiểu `T`.
 * Ném `ApiError` kèm status khi response không `ok`.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    // API trả lỗi dạng {"error": string} (NFR-006); fallback nếu parse thất bại.
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

/**
 * Health check của API — kiểu trả về khớp schema `Health` sinh từ OpenAPI.
 * Đây là điểm nối contract web↔api: nếu spec đổi shape của `Health`,
 * `tsc --noEmit` sẽ fail tại đây (contract gate compile-time).
 */
export function getHealth(): Promise<components["schemas"]["Health"]> {
  return apiFetch<components["schemas"]["Health"]>("/healthz");
}
