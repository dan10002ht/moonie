import { ChatIcon, PhoneIcon } from "./icons";
import { MobileMenu } from "./MobileMenu";

const NAV_LINKS = [
  { href: "#collection", label: "Bộ sưu tập" },
  { href: "#corporate", label: "Quà doanh nghiệp" },
  { href: "#story", label: "Câu chuyện" },
  { href: "#contact", label: "Liên hệ" },
];

/** Header sticky — logo + nav desktop + hotline + CTA + menu mobile. Port § HEADER. */
export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-cream/[0.88] backdrop-blur-[12px]">
      <div className="mx-auto flex max-w-[1160px] items-center justify-between gap-5 px-6 py-[14px]">
        <a
          href="#top"
          className="shrink-0 font-serif text-2xl font-bold leading-none text-navy"
        >
          Mooni Cake
        </a>

        <nav className="flex items-center gap-[30px] max-[920px]:hidden">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="relative text-[14.5px] font-medium text-ink-nav transition-colors duration-200 hover:text-navy after:absolute after:-bottom-1 after:left-0 after:h-[1.5px] after:w-full after:origin-left after:scale-x-0 after:bg-gold after:transition-transform after:duration-300 after:ease-out hover:after:scale-x-100"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-[14px]">
          <a
            href="tel:+84938168168"
            className="inline-flex items-center gap-2 text-[14.5px] font-semibold text-navy hover:text-steel max-[920px]:hidden"
          >
            <PhoneIcon size={17} />
            <span className="tabular-nums lining-nums">0938 168 168</span>
          </a>
          <button
            type="button"
            data-open-contact="1"
            /* TODO(Task 4): mở bottom sheet liên hệ */
            className="inline-flex cursor-pointer items-center gap-2 rounded-[5px] bg-steel px-5 py-[11px] font-sans text-sm font-bold text-white shadow-[0_8px_20px_-8px_rgba(42,53,87,0.55)] transition-transform duration-200 ease-out hover:scale-[1.02] hover:bg-steel-dark max-[920px]:hidden"
          >
            <ChatIcon size={16} />
            Liên hệ đặt hàng
          </button>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
