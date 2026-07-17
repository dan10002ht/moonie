import type { Product } from "@/lib/api";
import { formatVND } from "@/lib/format";

/**
 * Chrome dùng chung cho card sản phẩm (Collection + Flavors).
 * Data-driven: badge marketing từ field `badge`, pill trạng thái từ `status`,
 * subtitle (nhãn loại IN HOA) + compare_at_price (giá gạch + % giảm) từ API.
 */

/**
 * % giảm giá từ compare_at_price so với price. Null nếu không có KM
 * (compare rỗng hoặc ≤ price). Làm tròn về số nguyên như mockup.
 */
export function discountPercent(
  price: number,
  compareAtPrice?: number | null,
): number | null {
  if (!compareAtPrice || compareAtPrice <= price) return null;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}

/** Nhãn phân loại IN HOA trên tên. Rỗng/null → không render. */
export function Subtitle({
  text,
  tone,
}: {
  text?: string | null;
  tone: "gift" | "flavor";
}) {
  if (!text) return null;
  return (
    <div
      className={`mb-[6px] text-[11px] font-semibold uppercase tracking-[0.14em] ${
        tone === "gift" ? "text-badge-hot" : "text-ink-faint"
      }`}
    >
      {text}
    </div>
  );
}

/**
 * Giá gạch (compare_at_price) + pill % giảm — hiện khi compare > price.
 * Dùng chung cho cả gift box lẫn flavor (chỉ render khi có KM).
 */
export function ComparePrice({
  price,
  compareAtPrice,
}: {
  price: number;
  compareAtPrice?: number | null;
}) {
  const pct = discountPercent(price, compareAtPrice);
  if (pct === null || !compareAtPrice) return null;
  return (
    <>
      <span className="text-[13px] tabular-nums lining-nums text-ink-faint line-through">
        {formatVND(compareAtPrice)}
      </span>
      <span className="rounded-[4px] bg-sale px-2 py-[3px] text-[11px] font-extrabold text-white">
        −{pct}%
      </span>
    </>
  );
}

type BadgeStyle = { className: string };

/** Map nhãn marketing → style pill (port màu mockup). */
function badgeStyle(badge: string): BadgeStyle {
  switch (badge) {
    case "Mới":
      return { className: "bg-navy text-white" };
    case "Quà biếu":
      return {
        className:
          "border border-badge-gift-border bg-badge-gift-bg text-steel",
      };
    // "Bán chạy" và mọi nhãn khác dùng tông steel mặc định
    default:
      return { className: "bg-badge-hot text-white" };
  }
}

/**
 * Badge marketing góc trên-trái ảnh. Rỗng/null → không render.
 * `size="sm"` cho card bánh lẻ (nhỏ hơn).
 */
export function MarketingBadge({
  badge,
  size = "md",
}: {
  badge?: string | null;
  size?: "sm" | "md";
}) {
  if (!badge) return null;
  const { className } = badgeStyle(badge);
  const dims =
    size === "sm"
      ? "top-3 left-3 px-[10px] py-[5px] text-[10px] tracking-[0.08em]"
      : "top-[14px] left-[14px] px-[11px] py-[6px] text-[10.5px] tracking-[0.08em]";
  return (
    <span
      className={`absolute z-[2] inline-flex items-center rounded-[4px] font-bold uppercase ${dims} ${className}`}
    >
      {badge}
    </span>
  );
}

/**
 * Pill trạng thái góc trên-phải ảnh (chỉ card hộp quà — Collection).
 * available → "Còn hàng" (xanh) · sold_out → "Hết hàng" (mờ) · hidden → ẩn card,
 * nhưng API public đã lọc hidden nên chỉ xử lý 2 case thấy được.
 */
export function StatusPill({ status }: { status: Product["status"] }) {
  if (status === "hidden") return null;
  const soldOut = status === "sold_out";
  return (
    <span
      className={`absolute right-[14px] top-[14px] z-[2] inline-flex items-center gap-[5px] rounded-[6px] bg-white/[0.94] px-[10px] py-[5px] text-[11.5px] font-semibold ${
        soldOut ? "text-ink-soft" : "text-stock-in-text"
      }`}
    >
      <span
        className={`h-[6px] w-[6px] rounded-full ${
          soldOut ? "bg-stock-out-dot" : "bg-stock-in-dot"
        }`}
      />
      {soldOut ? "Hết hàng" : "Còn hàng"}
    </span>
  );
}
