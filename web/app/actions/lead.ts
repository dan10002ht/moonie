"use server";

import { ApiError, createLead, type LeadInput } from "@/lib/api";
import { clientIpFromRequest } from "@/lib/client-ip";

/**
 * Kết quả gửi lead — trả về client (ContactSheet) để map thành thông báo.
 * Giữ `status` để client phân biệt 400 (validation) / 429 (rate limit) / khác.
 */
export type LeadResult =
  | { ok: true }
  | { ok: false; status: number | null; message: string };

/**
 * Server Action: nhận payload từ form client (same-origin) rồi gọi createLead()
 * (POST /leads) server-to-server. Chạy trên Next server nên KHÔNG dính CORS như
 * gọi thẳng API từ browser; đây cũng là topology production (web proxy → API).
 * Validate chính vẫn ở API — action chỉ chuyển tiếp và chuẩn hóa lỗi.
 */
export async function submitLead(input: LeadInput): Promise<LeadResult> {
  try {
    const clientIp = await clientIpFromRequest();
    await createLead(input, clientIp);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      return { ok: false, status: err.status, message: err.message };
    }
    return {
      ok: false,
      status: null,
      message: "Gửi không thành công, vui lòng thử lại.",
    };
  }
}
