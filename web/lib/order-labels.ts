/**
 * Nhãn tiếng Việt + màu pill cho kênh & trạng thái đơn hàng — dùng chung bảng
 * quản trị đơn và chi tiết đơn. Giá trị enum khớp OpenAPI (`Order.channel`,
 * `Order.status`).
 */

export const ORDER_CHANNELS = [
  { value: "website", label: "Website" },
  { value: "phone", label: "Điện thoại" },
  { value: "zalo", label: "Zalo" },
  { value: "fb", label: "Facebook" },
] as const;

export type OrderChannel = (typeof ORDER_CHANNELS)[number]["value"];

export function orderChannelLabel(channel: string): string {
  return ORDER_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
}

export const ORDER_STATUSES = [
  { value: "new", label: "Mới" },
  { value: "confirmed", label: "Đã xác nhận" },
  { value: "delivering", label: "Đang giao" },
  { value: "done", label: "Hoàn tất" },
  { value: "cancelled", label: "Đã hủy" },
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number]["value"];

export function orderStatusLabel(status: string): string {
  return ORDER_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** Trạng thái kết thúc — không cho đổi status nữa. */
export const ORDER_TERMINAL_STATUSES = new Set(["done", "cancelled"]);

export function isTerminalStatus(status: string): boolean {
  return ORDER_TERMINAL_STATUSES.has(status);
}

/**
 * Class nền/chữ pill trạng thái theo tokens Mooni (không hardcode hex):
 * mới=hổ phách (cần xử lý), đã xác nhận=navy, đang giao=xanh nhạt (steel),
 * hoàn tất=xanh (xong), đã hủy=xám (kết thúc).
 */
export const ORDER_STATUS_BADGE: Record<string, string> = {
  new: "border-transparent bg-stock-warn-bg text-gold-deep",
  confirmed: "border-transparent bg-navy-tint text-navy",
  delivering: "border-transparent bg-sky text-badge-hot",
  done: "border-transparent bg-stock-in-bg text-stock-in-text",
  cancelled: "border-border bg-muted text-ink-muted",
};
