"use client";

import { ChatIcon, PhoneIcon } from "./icons";

/**
 * Sticky mobile CTA — thanh cố định đáy màn hình, chỉ hiện ≤720px. Port § STICKY MOBILE CTA.
 * Client component để về sau nối bottom sheet liên hệ (Task 4).
 */
export function StickyMobileCTA() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] hidden gap-[10px] border-t border-border bg-white/[0.96] p-[10px_14px] shadow-[0_-8px_24px_-12px_rgba(4,30,79,0.25)] backdrop-blur-[10px] max-[720px]:flex">
      <a
        href="tel:+84938168168"
        aria-label="Gọi điện"
        className="inline-flex w-[52px] shrink-0 items-center justify-center rounded-lg bg-navy-tint text-steel"
      >
        <PhoneIcon size={22} />
      </a>
      <button
        type="button"
        data-open-contact="1"
        onClick={() => {
          /* TODO(Task 4): mở bottom sheet liên hệ */
        }}
        className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-steel p-[14px] font-sans text-[15px] font-bold text-white"
      >
        <ChatIcon size={17} />
        Liên hệ đặt hàng
      </button>
    </div>
  );
}
