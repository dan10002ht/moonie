const STEPS = [
  {
    no: "01",
    title: "Nguyên liệu chọn lọc",
    body: "Sen Đồng Tháp, trứng muối Bắc Thảo, trà xanh Thái Nguyên — rõ nguồn gốc.",
  },
  {
    no: "02",
    title: "Sên nhân & nướng thủ công",
    body: "Từng công đoạn làm tay theo công thức gia truyền, giữ trọn hương vị.",
  },
  {
    no: "03",
    title: "Đóng hộp & trao tay",
    body: "Hộp thiết kế riêng cho mùa trăng, kèm thiệp — sẵn sàng làm quà.",
  },
];

/** Craft / Story — "Làm thủ công, từng chiếc một" (§ CRAFT/STORY mockup). Tĩnh. */
export function Craft() {
  return (
    <section id="story" className="px-6 py-[clamp(56px,8vw,104px)]">
      <div className="mx-auto max-w-[1160px]">
        <div className="grid grid-cols-[0.9fr_1.1fr] items-center gap-14 max-[920px]:grid-cols-1">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[10px] bg-navy-tint shadow-[0_30px_60px_-34px_rgba(4,30,79,0.35)]">
            <div
              className="flex h-full w-full items-center justify-center px-4 text-center text-[13px] text-ink-faint"
              aria-label="Ảnh nghệ nhân làm bánh"
            >
              Ảnh nghệ nhân làm bánh
            </div>
          </div>
          <div>
            <div className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-gold-deep">
              Câu chuyện Mooni
            </div>
            <h2 className="m-0 mb-[18px] font-serif text-[clamp(30px,4.4vw,42px)] font-semibold leading-[1.12] tracking-[-0.01em] text-navy">
              Làm thủ công, từng chiếc một
            </h2>
            <p className="m-0 mb-[30px] max-w-[520px] text-base leading-[1.75] text-ink-muted">
              Từ mẻ nhân sen được sên tay nhiều giờ đến lớp vỏ nướng vàng đều, mỗi
              chiếc bánh Mooni là kết tinh của công thức gia truyền và nguyên liệu
              chọn lọc — làm mới mỗi ngày, không chất bảo quản.
            </p>
            <div className="flex flex-col gap-[22px]">
              {STEPS.map((step) => (
                <div key={step.no} className="flex items-start gap-[18px]">
                  <span className="w-[34px] shrink-0 font-serif text-[22px] font-bold leading-none text-gold-deep">
                    {step.no}
                  </span>
                  <div>
                    <div className="mb-1 font-sans text-[17px] font-semibold text-navy">
                      {step.title}
                    </div>
                    <div className="text-[14.5px] leading-[1.6] text-ink-soft">
                      {step.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
