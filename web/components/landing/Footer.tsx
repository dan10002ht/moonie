import { PhoneIcon } from "./icons";

const LINKS = [
  { href: "#collection", label: "Bộ sưu tập" },
  { href: "#corporate", label: "Quà doanh nghiệp" },
  { href: "#story", label: "Câu chuyện" },
  { href: "#contact", label: "Liên hệ đặt hàng" },
];

const socialSvg = {
  viewBox: "0 0 24 24",
  width: 22,
  height: 22,
  "aria-hidden": true,
  style: { display: "block" },
};

const SOCIALS = [
  {
    href: "https://zalo.me/0938168168",
    label: "Zalo",
    path: (
      <path
        fill="currentColor"
        d="M12 3.6c-4.98 0-9 3.18-9 7.1 0 2.27 1.32 4.3 3.37 5.62-.16.9-.6 2.02-1.28 2.98-.26.36.05.86.48.74 1.86-.5 3.2-1.1 3.96-1.55.78.2 1.62.31 2.47.31 4.98 0 9-3.18 9-7.1s-4.02-7.1-9-7.1Zm-4 8.5a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Zm4 0a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Zm4 0a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Z"
      />
    ),
  },
  {
    href: "https://m.me/moonicake",
    label: "Messenger",
    path: (
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 2.4C6.4 2.4 2.1 6.5 2.1 11.7c0 2.85 1.32 5.36 3.4 7.06v3.24l3.11-1.71c.99.27 2.04.42 3.13.42 5.6 0 9.9-4.1 9.9-9.31S17.6 2.4 12 2.4Zm.55 12.02-2.5-2.67-4.88 2.67 5.37-5.7 2.56 2.67 4.83-2.67-5.36 5.7Z"
      />
    ),
  },
  {
    href: "https://instagram.com/moonicake",
    label: "Instagram",
    path: (
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M8 2h8a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V8a6 6 0 0 1 6-6Zm0 2a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4H8Zm4 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.2-2.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"
      />
    ),
  },
  {
    href: "https://tiktok.com/@moonicake",
    label: "TikTok",
    path: (
      <path
        fill="currentColor"
        d="M14.2 3h2.6c.28 2.1 1.5 3.63 3.7 3.86v2.7c-1.36.04-2.63-.32-3.8-1.02v5.63a5.6 5.6 0 1 1-5.6-5.6c.3 0 .6.02.9.07v2.85a2.75 2.75 0 1 0 1.9 2.62V3Z"
      />
    ),
  },
];

/** Footer navy — thương hiệu, liên kết, mạng xã hội, dòng bản quyền. Port § FOOTER. */
export function Footer() {
  return (
    <footer className="bg-navy px-6 pt-[clamp(44px,6vw,60px)] pb-10 text-footer-text">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-start justify-between gap-9">
        <div className="max-w-[340px]">
          <div className="font-serif text-2xl font-bold text-white">
            Mooni Cake
          </div>
          <div className="mt-1 font-serif text-[15px] italic text-footer-italic">
            Trọn vị trăng rằm, gói trọn tấm lòng.
          </div>
          <p className="mt-4 text-[13.5px] leading-[1.6] text-footer-text">
            Bánh trung thu thủ công cao cấp · Nhận đặt quà biếu cá nhân &amp;
            doanh nghiệp.
          </p>
          <a
            href="tel:+84938168168"
            className="mt-[18px] inline-flex items-center gap-[9px] text-[17px] font-semibold text-white hover:text-navy-mist"
          >
            <span className="inline-flex text-navy-mist">
              <PhoneIcon size={18} />
            </span>
            <span className="tabular-nums lining-nums">
              Hotline · 0938 168 168
            </span>
          </a>
        </div>

        <div>
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-footer-text">
            Liên kết
          </div>
          <div className="flex flex-col gap-[11px]">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-navy-mist hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-footer-text">
            Kết nối
          </div>
          <div className="flex gap-[14px]">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener"
                title={s.label}
                aria-label={s.label}
                className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-full border border-footer-border text-navy-mist hover:border-footer-copy hover:text-white"
              >
                <svg {...socialSvg}>{s.path}</svg>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 flex max-w-[1160px] flex-wrap justify-between gap-[10px] border-t border-footer-divider pt-[22px] text-[12.5px] text-footer-copy">
        <span>© 2026 Mooni Cake. Giá đã gồm VAT · Miễn phí giao nội thành.</span>
        <span>Thiết kế theo Mooni Cake Design System v1.0</span>
      </div>
    </footer>
  );
}
