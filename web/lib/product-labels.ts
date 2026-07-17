/**
 * Nhãn tiếng Việt cho loại & trạng thái sản phẩm — dùng chung bảng quản trị và
 * form. Giá trị enum khớp OpenAPI (`Product.type`, `Product.status`).
 */

export const PRODUCT_TYPES = [
  { value: "gift_box", label: "Hộp quà" },
  { value: "single_cake", label: "Bánh lẻ" },
] as const;

export const PRODUCT_STATUSES = [
  { value: "available", label: "Đang bán" },
  { value: "sold_out", label: "Hết hàng" },
  { value: "hidden", label: "Ẩn" },
] as const;

export function productTypeLabel(type: string): string {
  return PRODUCT_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function productStatusLabel(status: string): string {
  return PRODUCT_STATUSES.find((s) => s.value === status)?.label ?? status;
}
