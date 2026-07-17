/**
 * Placeholder scaffold (giai đoạn 1) — chỉ để chứng minh design tokens hoạt động.
 * KHÔNG phải landing thật; landing đầy đủ dựng ở giai đoạn 3 (REQ-LAND).
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-cream px-6 py-24">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-white/60 p-10 shadow-sm">
        <p className="font-sans text-sm font-semibold uppercase tracking-[0.2em] text-gold-deep">
          Mooni Cake
        </p>
        <h1 className="mt-3 font-serif text-4xl font-bold text-navy sm:text-5xl">
          Bánh trung thu cao cấp
        </h1>
        <p className="mt-4 font-sans text-base text-ink">
          Trang scaffold xác nhận design tokens Mooni đã hoạt động: nền cream,
          tiêu đề serif tông navy, điểm nhấn gold.
        </p>

        <div className="mt-8 flex flex-wrap gap-3" aria-hidden="true">
          <span className="h-10 w-10 rounded-full bg-navy" title="navy" />
          <span className="h-10 w-10 rounded-full bg-navy-light" title="navy-light" />
          <span className="h-10 w-10 rounded-full bg-gold" title="gold" />
          <span className="h-10 w-10 rounded-full bg-gold-deep" title="gold-deep" />
          <span className="h-10 w-10 rounded-full border border-border bg-cream" title="cream" />
          <span className="h-10 w-10 rounded-full bg-ink" title="ink" />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <span className="rounded-full bg-navy px-5 py-2 font-sans text-sm font-medium text-cream">
            Nút chính (navy)
          </span>
          <span className="rounded-full border border-gold px-5 py-2 font-sans text-sm font-medium text-gold-deep">
            Điểm nhấn (gold)
          </span>
        </div>
      </div>
    </main>
  );
}
