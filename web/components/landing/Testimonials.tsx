import { Reveal } from "./Reveal";

const REVIEWS = [
  {
    quote:
      "Hộp Nguyệt Quang Kim đẹp và sang, gửi biếu sếp ai cũng khen. Bánh sen trứng ngọt vừa, rất chuẩn vị.",
    initial: "M",
    name: "Chị Minh",
    place: "Quận 1, TP.HCM",
  },
  {
    quote:
      "Đặt 120 hộp có khắc logo tặng khách hàng, giao đúng hẹn, xuất VAT đầy đủ. Sẽ hợp tác tiếp năm sau.",
    initial: "T",
    name: "Anh Tuấn",
    place: "Phòng HC · Công ty FMCG",
  },
  {
    quote:
      "Nhắn Zalo là được tư vấn ngay, chốt đơn nhanh gọn. Bánh làm mới, thơm, cả nhà mình đều thích.",
    initial: "H",
    name: "Chị Hà",
    place: "Cầu Giấy, Hà Nội",
  },
];

/** Testimonials — "Được tin chọn mỗi mùa trăng" (§ TESTIMONIALS mockup). Tĩnh. */
export function Testimonials() {
  return (
    <section className="px-6 py-[clamp(56px,8vw,96px)]">
      <div className="mx-auto max-w-[1160px]">
        <Reveal className="mx-auto mb-11 max-w-[560px] text-center">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
            Khách hàng nói gì
          </div>
          <h2 className="m-0 font-serif text-[clamp(28px,4vw,38px)] font-semibold tracking-[-0.01em] text-navy">
            Được tin chọn mỗi mùa trăng
          </h2>
        </Reveal>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-[22px]">
          {REVIEWS.map((r, i) => (
            <Reveal
              key={r.name}
              delay={i * 80}
              className="rounded-[8px] border border-border bg-white p-7"
            >
              <div className="mb-[14px] text-[15px] tracking-[2px] text-gold">
                ★★★★★
              </div>
              <p className="m-0 mb-5 font-serif text-[18px] italic leading-[1.55] text-ink">
                &ldquo;{r.quote}&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-full bg-navy-tint font-serif text-[17px] font-bold text-steel">
                  {r.initial}
                </span>
                <div>
                  <div className="text-[14px] font-semibold text-navy">
                    {r.name}
                  </div>
                  <div className="text-[12.5px] text-ink-faint">{r.place}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
