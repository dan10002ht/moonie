import { ChatIcon, CheckIcon, PhoneIcon } from "./icons";
import { Reveal } from "./Reveal";

const PERKS = [
  "In / khắc logo & thông điệp thương hiệu lên hộp",
  "Thiệp viết tay cá nhân hoá cho từng người nhận",
  "Giá ưu đãi theo số lượng · xuất hoá đơn VAT",
  "Giao theo danh sách địa chỉ, đúng hẹn toàn quốc",
];

/** CorporateGifting — "Món quà thay lời tri ân" (§ CORPORATE mockup). Tĩnh. */
export function CorporateGifting() {
  return (
    <section
      id="corporate"
      className="relative overflow-hidden bg-navy text-white"
    >
      <div className="drift pointer-events-none absolute -bottom-[120px] -left-[100px] h-[340px] w-[340px] rounded-full border border-gold/[0.16]" />
      <div className="mx-auto max-w-[1160px] px-6 py-[clamp(56px,8vw,100px)]">
        <div className="grid grid-cols-2 items-center gap-14 max-[920px]:grid-cols-1">
          <Reveal>
            <div className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-gold">
              Quà biếu doanh nghiệp
            </div>
            <h2 className="m-0 mb-[18px] font-serif text-[clamp(30px,4.4vw,44px)] font-semibold leading-[1.1] tracking-[-0.01em]">
              Món quà thay lời tri ân
              <br />
              đến đối tác &amp; khách hàng
            </h2>
            <p className="m-0 mb-7 max-w-[520px] text-base leading-[1.7] text-navy-fog">
              Hộp bánh khắc logo, thiệp viết riêng theo thương hiệu của bạn. Đặt
              số lượng lớn, giá ưu đãi, xuất hoá đơn VAT và giao tận nơi đúng hẹn
              trên toàn quốc.
            </p>
            <div className="mb-8 flex flex-col gap-3">
              {PERKS.map((perk) => (
                <div
                  key={perk}
                  className="flex items-center gap-3 text-[15px] text-sky"
                >
                  <span className="inline-flex shrink-0 text-gold">
                    <CheckIcon size={19} />
                  </span>
                  {perk}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-[14px] max-[920px]:flex-col max-[920px]:items-stretch">
              <button
                type="button"
                data-open-contact="1"
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-[5px] bg-sky px-7 py-[15px] font-sans text-[15px] font-bold text-steel-dark hover:bg-white"
              >
                <ChatIcon size={18} />
                Nhận báo giá doanh nghiệp
              </button>
              <a
                href="tel:+84938168168"
                className="inline-flex items-center gap-[9px] text-[15px] font-semibold text-white hover:text-navy-mist"
              >
                <span className="inline-flex text-gold">
                  <PhoneIcon size={18} />
                </span>
                <span className="tabular-nums lining-nums">0938 168 168</span>
              </a>
            </div>
          </Reveal>

          <Reveal
            delay={120}
            className="relative aspect-[5/4] overflow-hidden rounded-[10px] bg-navy-light shadow-[0_40px_80px_-34px_rgba(0,0,0,0.6)] max-[920px]:order-first"
          >
            <div
              className="flex h-full w-full items-center justify-center px-4 text-center text-[13px] text-navy-mist/70"
              aria-label="Ảnh set quà doanh nghiệp có logo"
            >
              Ảnh set quà doanh nghiệp có logo
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
