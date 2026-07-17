/**
 * Định dạng hiển thị — dùng chung cho landing (GĐ3).
 */

/**
 * Format giá VND kiểu mockup: dấu chấm ngăn hàng nghìn + hậu tố "đ".
 * vd 890000 → "890.000đ". Dùng locale vi-VN (dấu chấm nghìn).
 */
export function formatVND(price: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(price)}đ`;
}
