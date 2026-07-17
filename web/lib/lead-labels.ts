/**
 * Nhãn tiếng Việt + màu pill cho trạng thái lead — dùng chung bảng quản trị.
 * Giá trị enum khớp OpenAPI (`Lead.status`: new | contacted | converted | closed).
 */

export const LEAD_STATUSES = [
  { value: "new", label: "Mới" },
  { value: "contacted", label: "Đã liên hệ" },
  { value: "converted", label: "Đã lên đơn" },
  { value: "closed", label: "Đã đóng" },
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number]["value"];

export function leadStatusLabel(status: string): string {
  return LEAD_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/**
 * Class nền/chữ pill trạng thái theo tokens Mooni (không hardcode hex):
 * mới=hổ phách (cần xử lý), đã liên hệ=navy (đang tiến hành),
 * đã chuyển đơn=xanh (xong), đã đóng=xám (kết thúc).
 */
export const LEAD_STATUS_BADGE: Record<string, string> = {
  new: "border-transparent bg-stock-warn-bg text-gold-deep",
  contacted: "border-transparent bg-navy-tint text-navy",
  converted: "border-transparent bg-stock-in-bg text-stock-in-text",
  closed: "border-border bg-muted text-ink-muted",
};

/** Nhãn tiếng Việt cho nguồn lead (`Lead.source`). Fallback: giữ nguyên. */
export const LEAD_SOURCES: Record<string, string> = {
  website: "Website",
  phone: "Điện thoại",
  zalo: "Zalo",
  fb: "Facebook",
  facebook: "Facebook",
  manual: "Nhập tay",
};

export function leadSourceLabel(source: string): string {
  return LEAD_SOURCES[source] ?? source;
}
