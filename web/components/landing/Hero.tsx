import { ChatIcon, CheckIcon } from "./icons";

const FEATURES = [
  "Thủ công mỗi ngày",
  "Không chất bảo quản",
  "Giao nội thành trong ngày",
];

/** Hero — nền navy, tiêu đề serif + ảnh hộp bánh + card giá nổi. Port § HERO. */
export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-navy text-white"
    >
      <div className="pointer-events-none absolute -right-[120px] -top-[90px] h-[420px] w-[420px] rounded-full border border-gold/[0.22]" />
      <div className="pointer-events-none absolute -bottom-[160px] right-[60px] h-[300px] w-[300px] rounded-full border border-gold/[0.14]" />

      <div className="mx-auto max-w-[1160px] px-6 py-[clamp(48px,7vw,88px)]">
        <div className="grid grid-cols-[1.05fr_0.95fr] items-center gap-[60px] max-[920px]:grid-cols-1 max-[920px]:gap-10">
          <div>
            <div className="mb-[22px] text-xs font-semibold uppercase tracking-[0.3em] text-gold">
              Bánh trung thu thủ công cao cấp
            </div>
            <h1 className="m-0 font-serif text-[clamp(40px,6.4vw,72px)] font-bold leading-[1.04] tracking-[-0.01em]">
              Trọn vị trăng rằm,
              <br />
              <span className="font-normal italic text-gold">
                gói trọn tấm lòng
              </span>
            </h1>
            <p className="mt-[26px] max-w-[520px] text-[clamp(16px,1.7vw,18px)] leading-[1.65] text-navy-fog">
              Từng chiếc bánh làm thủ công mỗi ngày, đóng trong hộp quà thiết kế
              riêng cho mùa trăng. Đặt hàng trực tiếp qua Zalo hoặc hotline — tư
              vấn &amp; chốt đơn trong ít phút.
            </p>
            <div className="mt-[34px] flex flex-wrap gap-[14px] max-[920px]:flex-col max-[920px]:items-stretch">
              <button
                type="button"
                data-open-contact="1"
                /* TODO(Task 4): mở bottom sheet liên hệ */
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-[5px] bg-sky px-7 py-[15px] font-sans text-[15px] font-bold text-steel-dark shadow-[0_12px_28px_-12px_rgba(0,0,0,0.5)] hover:bg-white"
              >
                <ChatIcon size={18} />
                Liên hệ đặt hàng
              </button>
              <a
                href="#collection"
                className="inline-flex items-center justify-center gap-2 rounded-[5px] border-[1.5px] border-white/40 bg-transparent px-[26px] py-[14px] font-sans text-[15px] font-semibold text-white hover:border-white hover:bg-white/[0.06]"
              >
                Xem bộ sưu tập
              </a>
            </div>
            <div className="mt-[38px] flex flex-wrap gap-6">
              {FEATURES.map((f) => (
                <div
                  key={f}
                  className="flex items-center gap-[9px] text-sm text-navy-mist"
                >
                  <span className="inline-flex text-check">
                    <CheckIcon size={18} />
                  </span>
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[10px] bg-navy-light shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]">
              {/* Placeholder ảnh hộp bánh cao cấp — ảnh thật thêm sau qua admin */}
              <div
                className="flex h-full w-full items-center justify-center text-center text-[13px] text-navy-mist/70"
                aria-label="Ảnh hộp bánh cao cấp"
              >
                Ảnh hộp bánh cao cấp
              </div>
            </div>
            <div className="absolute -left-[14px] bottom-[26px] max-w-[210px] rounded-[10px] bg-white px-[18px] py-[14px] text-ink shadow-[0_20px_40px_-18px_rgba(0,0,0,0.4)]">
              <div className="font-serif text-[17px] font-bold leading-[1.2] text-navy">
                Nguyệt Quang Kim
              </div>
              <div className="my-[3px] mb-2 text-xs text-ink-soft">
                Hộp thiếc 6 bánh
              </div>
              <div className="flex items-baseline gap-[7px]">
                <span className="font-serif text-[19px] font-semibold tabular-nums lining-nums text-steel">
                  890,000 đ
                </span>
                <span className="rounded-[4px] bg-sale px-[6px] py-[2px] text-[10px] font-extrabold text-white">
                  −15%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
