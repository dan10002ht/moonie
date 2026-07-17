/**
 * Client gọi Go API — nơi DUY NHẤT thực hiện fetch tới backend (CLAUDE.md).
 * Không rải `fetch` khắp nơi; mọi route/component đi qua đây.
 */

import type { components } from "@/types/api";

/** Sản phẩm public — re-export để UI (GĐ3) import gọn, không lôi cả `components`. */
export type Product = components["schemas"]["Product"];
/** Payload form liên hệ gửi lên `POST /leads`. */
export type LeadInput = components["schemas"]["LeadInput"];
/** Kết quả tạo lead — chỉ chứa `id`. */
export type LeadCreated = components["schemas"]["LeadCreated"];

/**
 * Base URL của Go API. Server-to-server (Server Action / route handler) nên trỏ
 * thẳng API nội bộ; browser KHÔNG gọi trực tiếp (tránh CORS + lộ endpoint admin).
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080/api/v1";

/**
 * Gốc phục vụ file tĩnh (ảnh upload) — API mount `/uploads/*` ở root origin,
 * NGOÀI tiền tố `/api/v1`. Suy ra bằng cách bỏ đuôi `/api/v1` khỏi API_BASE.
 */
export const MEDIA_BASE = API_BASE.replace(/\/api\/v1\/?$/, "");

/**
 * Giải đường dẫn ảnh sản phẩm về URL tuyệt đối cho `<img>` phía browser.
 * `image_url` từ API là `/uploads/<file>` (nội bộ) hoặc URL http(s) đầy đủ.
 * Trả `null` nếu không có ảnh → caller hiện placeholder.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${MEDIA_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

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

/**
 * Danh sách sản phẩm public (đã ẩn `hidden`, sắp theo thứ tự hiển thị).
 * Contract gate: nếu schema `Product` đổi shape, `tsc --noEmit` fail tại đây.
 */
export function getProducts(): Promise<Product[]> {
  return apiFetch<Product[]>("/products");
}

/**
 * Gửi form liên hệ → tạo lead. Trả `LeadCreated {id}` khi 201.
 * Ném `ApiError` khi thất bại — caller phân biệt theo `status`:
 *   - 400: dữ liệu không hợp lệ (message lấy từ body `{error}`).
 *   - 429: gửi quá nhiều yêu cầu (rate limit) — nên báo khách thử lại sau.
 */
export function createLead(input: LeadInput): Promise<LeadCreated> {
  return apiFetch<LeadCreated>("/leads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
