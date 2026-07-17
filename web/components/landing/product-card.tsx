import type { Product } from "@/lib/api";

/**
 * Chrome dùng chung cho card sản phẩm (Collection + Flavors).
 * Data-driven: badge marketing từ field `badge`, pill trạng thái từ `status`.
 */

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
