"use client";

import { useState } from "react";
import { ChatIcon, MenuIcon, PhoneIcon } from "./icons";

const NAV_LINKS = [
  { href: "#collection", label: "Bộ sưu tập" },
  { href: "#corporate", label: "Quà doanh nghiệp" },
  { href: "#story", label: "Câu chuyện" },
  { href: "#contact", label: "Liên hệ" },
];

/**
 * MobileMenu — nút hamburger + dropdown menu mobile (≤920px).
 * Client component: giữ state đóng/mở. Dropdown định vị absolute dưới header
 * (header sticky là positioned container). Port từ mockup § HEADER.
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="hidden h-[42px] w-[42px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-white text-navy max-[920px]:flex"
      >
        <MenuIcon size={22} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 flex flex-col gap-[2px] border-t border-border bg-cream px-6 pt-[14px] pb-5">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={close}
              className="border-b border-border-soft px-1 py-3 text-base font-medium text-ink"
            >
              {link.label}
            </a>
          ))}
          <a
            href="tel:+84938168168"
            className="flex items-center gap-[9px] px-1 pt-[14px] pb-[6px] text-base font-semibold text-navy"
          >
            <PhoneIcon size={18} />
            0938 168 168
          </a>
          <button
            type="button"
            data-open-contact="1"
            onClick={close}
            className="mt-[10px] flex w-full cursor-pointer items-center justify-center gap-2 rounded-[5px] bg-steel p-[14px] font-sans text-[15px] font-bold text-white"
          >
            <ChatIcon size={17} />
            Liên hệ đặt hàng
          </button>
        </div>
      )}
    </>
  );
}
