/**
 * Nhãn tiếng Việt + màu pill cho loại khách hàng — dùng chung bảng quản trị và
 * form. Giá trị enum khớp OpenAPI (`Customer.type`: personal | business).
 */

export const CUSTOMER_TYPES = [
  { value: "personal", label: "Cá nhân" },
  { value: "business", label: "Doanh nghiệp" },
] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number]["value"];

export function customerTypeLabel(type: string): string {
  return CUSTOMER_TYPES.find((t) => t.value === type)?.label ?? type;
}

/**
 * Class nền/chữ pill loại khách theo tokens Mooni (không hardcode hex):
 * cá nhân=navy tint (nhẹ nhàng), doanh nghiệp=hổ phách/vàng (giá trị cao).
 */
export const CUSTOMER_TYPE_BADGE: Record<string, string> = {
  personal: "border-transparent bg-navy-tint text-navy",
  business: "border-transparent bg-stock-warn-bg text-gold-deep",
};
