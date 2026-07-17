import type { Product } from "@/lib/api";
import { getProducts } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { MarketingBadge } from "./product-card";

/**
 * Tách mô tả seed "Bánh nướng · 180g · Vị truyền thống, đậm đà" thành
 * kicker ("Bánh nướng · 180g") + tagline ("Vị truyền thống, đậm đà") như mockup.
 */
function splitDescription(description?: string | null): {
  kicker: string;
  tagline: string;
} {
  if (!description) return { kicker: "", tagline: "" };
  const parts = description.split(" · ");
  if (parts.length <= 1) return { kicker: "", tagline: description };
  return {
    kicker: parts.slice(0, -1).join(" · "),
    tagline: parts[parts.length - 1] ?? "",
  };
}

/**
 * Flavors — "Đủ vị cho mọi khẩu vị" (§ FLAVORS mockup).
 * Server Component: đọc getProducts() tại render, lọc type=single_cake.
 * Badge marketing + giá từ API. sold_out → làm mờ. API lỗi/trống → fallback nhẹ.
 */
export async function Flavors() {
  let cakes: Product[] = [];
  try {
    const products = await getProducts();
    cakes = products
      .filter((p) => p.type === "single_cake")
      .sort((a, b) => a.display_order - b.display_order);
  } catch {
    cakes = [];
  }

  return (
    <section className="border-y border-border bg-white px-6 py-[clamp(56px,8vw,96px)]">
      <div className="mx-auto max-w-[1160px]">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
              Chọn nhân bánh lẻ
            </div>
            <h2 className="m-0 font-serif text-[clamp(28px,4vw,38px)] font-semibold tracking-[-0.01em] text-navy">
              Đủ vị cho mọi khẩu vị
            </h2>
          </div>
          <p className="m-0 max-w-[340px] text-[14.5px] leading-[1.6] text-ink-soft">
            Có thể đặt lẻ hoặc phối hộp theo ý bạn — nhắn kênh liên hệ để được tư
            vấn.
          </p>
        </div>

        {cakes.length === 0 ? (
          <p className="text-center text-[15px] text-ink-soft">
            Danh sách bánh lẻ đang được cập nhật — vui lòng liên hệ để được tư vấn.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
            {cakes.map((cake) => {
              const soldOut = cake.status === "sold_out";
              const { kicker, tagline } = splitDescription(cake.description);
              return (
                <div
                  key={cake.id}
                  className={`flex flex-col overflow-hidden rounded-[8px] border border-border-strong bg-white ${
                    soldOut ? "opacity-60" : ""
                  }`}
                >
                  <div className="relative h-[170px] bg-navy-tint">
                    <div
                      className="flex h-full w-full items-center justify-center px-3 text-center text-[12px] text-ink-faint"
                      aria-label={`Ảnh ${cake.name}`}
                    >
                      Ảnh {cake.name}
                    </div>
                    <MarketingBadge badge={cake.badge} size="sm" />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    {kicker ? (
                      <div className="mb-[6px] text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                        {kicker}
                      </div>
                    ) : null}
                    <div className="mb-[6px] font-serif text-[19px] font-bold leading-[1.25] text-navy">
                      {cake.name}
                    </div>
                    {tagline ? (
                      <div className="mb-[18px] text-[13px] text-ink-soft">
                        {tagline}
                      </div>
                    ) : null}
                    <div className="mt-auto flex items-center justify-between gap-[10px]">
                      <span className="font-serif text-[20px] font-semibold tabular-nums lining-nums text-steel">
                        {formatVND(cake.price)}
                      </span>
                      <button
                        type="button"
                        data-open-contact="1"
                        className="inline-flex cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[5px] bg-steel px-[15px] py-[10px] font-sans text-[13px] font-bold text-white hover:bg-steel-dark"
                      >
                        Liên hệ
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
