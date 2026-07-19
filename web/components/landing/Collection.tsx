import type { Product } from "@/lib/api";
import { getProducts } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { ChatIcon } from "./icons";
import { Reveal } from "./Reveal";
import {
  ComparePrice,
  MarketingBadge,
  StatusPill,
  Subtitle,
} from "./product-card";

/**
 * Collection — "Hộp bánh đặc tuyển" (§ COLLECTION mockup).
 * Server Component: đọc getProducts() tại render, lọc type=gift_box,
 * render card đúng layout mockup. Giá + badge + status từ API (data-driven).
 * API lỗi/trống → fallback nhẹ, không vỡ trang.
 */
export async function Collection() {
  let boxes: Product[] = [];
  try {
    const products = await getProducts();
    boxes = products
      .filter((p) => p.type === "gift_box")
      .sort((a, b) => a.display_order - b.display_order);
  } catch {
    boxes = [];
  }

  return (
    <section id="collection" className="px-6 py-[clamp(56px,8vw,104px)]">
      <div className="mx-auto max-w-[1160px]">
        <Reveal className="mx-auto mb-12 max-w-[600px] text-center">
          <div className="mb-[14px] text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
            Bộ sưu tập mùa trăng 2026
          </div>
          <h2 className="m-0 mb-[14px] font-serif text-[clamp(30px,4.4vw,42px)] font-semibold tracking-[-0.01em] text-navy">
            Hộp bánh đặc tuyển
          </h2>
          <p className="m-0 text-base leading-[1.7] text-ink-muted">
            Ba dòng hộp cho ba dịp trao gửi — từ món quà biếu trang trọng đến hộp
            mini ấm cúng cho gia đình.
          </p>
        </Reveal>

        {boxes.length === 0 ? (
          <p className="text-center text-[15px] text-ink-soft">
            Bộ sưu tập đang được cập nhật — vui lòng liên hệ để được tư vấn.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(290px,1fr))] gap-[22px]">
            {boxes.map((box, i) => {
              const soldOut = box.status === "sold_out";
              return (
                <Reveal key={box.id} delay={i * 80} className="flex">
                <div
                  className={`group flex flex-1 flex-col overflow-hidden rounded-[8px] border border-border-strong bg-white transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-gold/60 hover:shadow-[0_24px_44px_-26px_rgba(4,30,79,0.4)] ${
                    soldOut ? "opacity-60" : ""
                  }`}
                >
                  <div className="relative h-[230px] overflow-hidden bg-navy-tint">
                    <div
                      className="flex h-full w-full items-center justify-center px-4 text-center text-[13px] text-ink-faint transition-transform duration-500 ease-out group-hover:scale-[1.03]"
                      aria-label={`Ảnh ${box.name}`}
                    >
                      Ảnh {box.name}
                    </div>
                    <MarketingBadge badge={box.badge} />
                    <StatusPill status={box.status} />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <Subtitle text={box.subtitle} tone="gift" />
                    <div className="mb-2 font-serif text-[23px] font-bold leading-[1.2] text-navy">
                      {box.name}
                    </div>
                    {box.description ? (
                      <div className="mb-[18px] text-[13.5px] leading-[1.5] text-ink-soft">
                        {box.description}
                      </div>
                    ) : null}
                    <div className="mb-[18px] mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-[6px]">
                      <span className="whitespace-nowrap font-serif text-[24px] font-semibold tabular-nums lining-nums text-steel">
                        {formatVND(box.price)}
                      </span>
                      <ComparePrice
                        price={box.price}
                        compareAtPrice={box.compare_at_price}
                      />
                    </div>
                    <button
                      type="button"
                      data-open-contact="1"
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[5px] bg-steel px-0 py-[13px] font-sans text-[14px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(42,53,87,0.55)] hover:bg-steel-dark"
                    >
                      <ChatIcon size={17} />
                      Liên hệ đặt hàng
                    </button>
                  </div>
                </div>
                </Reveal>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
