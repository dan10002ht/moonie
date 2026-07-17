"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { submitLead } from "@/app/actions/lead";
import { ChatIcon, MessengerIcon, PhoneIcon, ZaloIcon } from "./icons";

/** Tùy chọn mặc định đầu select — cho khách chưa chọn sản phẩm cụ thể. */
const GENERAL_OPTION = "Tư vấn chung";

/** Thời gian khớp transition slide-up của card (mockup: 0.22s). */
const ANIM_MS = 220;

type Status = "idle" | "submitting" | "success";

type FormState = {
  name: string;
  phone: string;
  product_interest: string;
  message: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  phone: "",
  product_interest: GENERAL_OPTION,
  message: "",
};

/**
 * Validate SĐT VN cơ bản (client-side, UX nhẹ — server vẫn là nguồn validate chính).
 * Chấp nhận 0xxxxxxxxx (10 số) hoặc +84xxxxxxxxx, cho phép khoảng trắng/dấu chấm/gạch.
 */
function isValidVnPhone(raw: string): boolean {
  const digits = raw.replace(/[\s.\-()]/g, "");
  return /^(0\d{9}|\+84\d{9})$/.test(digits);
}

type ChannelProps = {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
};

/** Nút kênh nhanh (Zalo/Messenger/Gọi) — port § BOTTOM SHEET mockup. */
function ChannelLink({ href, icon, title, subtitle }: ChannelProps) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener" : undefined}
      className="flex items-center gap-[14px] rounded-[10px] border border-border bg-cream p-[13px_14px] no-underline hover:border-[#c6cedd] hover:bg-navy-tint"
    >
      <span className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-navy-tint text-steel">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-[15px] font-semibold text-navy">
          {title}
        </span>
        <span className="block text-[12px] text-ink-faint">{subtitle}</span>
      </span>
      <span className="text-[16px] text-[#b7b2a8]">›</span>
    </a>
  );
}

type FieldLabelProps = { children: React.ReactNode; htmlFor: string };
function FieldLabel({ children, htmlFor }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-[6px] block text-[12.5px] font-semibold text-ink-nav"
    >
      {children}
    </label>
  );
}

const INPUT_CLASS =
  "w-full rounded-[5px] border border-border-strong bg-white px-[14px] py-[12px] font-sans text-[14px] text-ink outline-none focus:border-[#4c5a82] focus:shadow-[0_0_0_3px_#e4e8f2]";

type ContactSheetProps = {
  /** Tên sản phẩm cho select "sản phẩm quan tâm" (từ getProducts, truyền từ server). */
  products?: string[];
};

/**
 * ContactSheet — bottom sheet liên hệ toàn cục (§ GLOBAL CONTACT BOTTOM SHEET).
 * Chứa form đặt hàng (tên, SĐT, sản phẩm quan tâm, lời nhắn) → createLead()
 * (POST /leads) + nút kênh nhanh Zalo/Messenger/Gọi. Mở bởi mọi nút
 * [data-open-contact] toàn trang; đóng bằng X / backdrop / Escape.
 */
export function ContactSheet({ products = [] }: ContactSheetProps) {
  // `mounted` = card có trong DOM; `shown` = đã áp transform (slide-up).
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId = useRef<number | null>(null);

  const openSheet = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setMounted(true);
    rafId.current = requestAnimationFrame(() => setShown(true));
  }, []);

  const closeSheet = useCallback(() => {
    setShown(false);
    closeTimer.current = setTimeout(() => setMounted(false), ANIM_MS);
  }, []);

  // Mọi nút [data-open-contact] toàn trang mở sheet (tái hiện script mockup).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-open-contact]")) {
        e.preventDefault();
        openSheet();
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openSheet]);

  // Escape để đóng.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mounted, closeSheet]);

  // Khóa scroll nền khi mở.
  useEffect(() => {
    document.documentElement.style.overflow = mounted ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [mounted]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    },
    [],
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) {
      setError("Vui lòng nhập họ và tên.");
      return;
    }
    if (!isValidVnPhone(phone)) {
      setError("Số điện thoại chưa hợp lệ — nhập dạng 09xx xxx xxx.");
      return;
    }

    setStatus("submitting");
    let result;
    try {
      result = await submitLead({
        name,
        phone,
        product_interest: form.product_interest || null,
        message: form.message.trim() || null,
      });
    } catch {
      // Lỗi mạng/không mong đợi khi gọi server action — giữ dữ liệu, cho gửi lại.
      setStatus("idle");
      setError("Gửi không thành công, vui lòng thử lại hoặc nhắn Zalo.");
      return;
    }

    if (result.ok) {
      setStatus("success");
      return;
    }

    // Lỗi từ API — giữ nguyên dữ liệu form để khách gửi lại.
    setStatus("idle");
    if (result.status === 429) {
      setError("Bạn gửi hơi nhanh, thử lại sau ít phút.");
    } else if (result.status === 400) {
      setError(result.message || "Dữ liệu chưa hợp lệ, vui lòng kiểm tra lại.");
    } else {
      setError("Gửi không thành công, vui lòng thử lại hoặc nhắn Zalo.");
    }
  };

  // Reset trạng thái khi đóng hẳn (card rời DOM) để lần mở sau sạch.
  const handleClose = () => {
    closeSheet();
    if (status === "success") {
      setForm(EMPTY_FORM);
      setStatus("idle");
      setError(null);
    }
  };

  if (!mounted) return null;

  const submitting = status === "submitting";

  return (
    <>
      {/* Backdrop */}
      <div
        data-close-contact="1"
        onClick={handleClose}
        className={`fixed inset-0 z-[998] bg-[rgba(4,30,79,0.5)] transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Liên hệ đặt hàng"
        className="fixed inset-x-0 bottom-0 z-[999] flex items-end justify-center"
      >
        <div
          className="max-h-[92vh] w-full max-w-[460px] overflow-y-auto rounded-t-[16px] bg-white p-[22px_22px_30px] shadow-[0_-20px_60px_-20px_rgba(4,30,79,0.5)] transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: shown ? "translateY(0)" : "translateY(110%)" }}
        >
          <div className="mx-auto mb-4 h-[4px] w-[38px] rounded-[2px] bg-border" />

          <div className="mb-1 flex items-center justify-between">
            <div className="font-serif text-[20px] font-bold text-navy">
              Liên hệ đặt hàng
            </div>
            <button
              type="button"
              data-close-contact="1"
              aria-label="Đóng"
              onClick={handleClose}
              className="h-[32px] w-[32px] cursor-pointer rounded-[8px] border-none bg-[#f1f0ec] text-[15px] leading-none text-ink-soft hover:bg-border"
            >
              ✕
            </button>
          </div>

          {status === "success" ? (
            <div
              className="py-6 text-center"
              role="status"
              aria-live="polite"
            >
              <div className="mx-auto mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-navy-tint text-steel">
                <ChatIcon size={24} />
              </div>
              <div className="mb-2 font-serif text-[19px] font-bold text-navy">
                Cảm ơn! Chúng tôi sẽ liên hệ lại sớm
              </div>
              <p className="mx-auto max-w-[320px] text-[13.5px] leading-[1.6] text-ink-soft">
                Yêu cầu của bạn đã được gửi. Shop sẽ gọi lại trong giờ làm việc
                8:00–20:00. Cần gấp? Nhắn nhanh qua kênh bên dưới.
              </p>
              <div className="mt-5 flex flex-col gap-2 text-left">
                <ChannelLink
                  href="https://zalo.me/0938168168"
                  icon={<ZaloIcon size={22} />}
                  title="Zalo"
                  subtitle="Chat & đặt hàng ngay"
                />
                <ChannelLink
                  href="tel:+84938168168"
                  icon={<PhoneIcon size={22} />}
                  title="Gọi điện"
                  subtitle="0938 168 168 · nhanh nhất"
                />
              </div>
            </div>
          ) : (
            <>
              <p className="mb-4 text-[13px] text-ink-soft">
                Để lại lời nhắn, shop gọi lại — hoặc chat ngay qua kênh bên dưới.
              </p>

              <form onSubmit={onSubmit} noValidate className="flex flex-col gap-[14px]">
                <div>
                  <FieldLabel htmlFor="mc-name">Họ và tên</FieldLabel>
                  <input
                    id="mc-name"
                    name="name"
                    type="text"
                    placeholder="Nguyễn Thị Minh"
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="mc-phone">
                    Số điện thoại / Zalo
                  </FieldLabel>
                  <input
                    id="mc-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="09xx xxx xxx"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="mc-product">
                    Sản phẩm quan tâm
                  </FieldLabel>
                  <div className="relative">
                    <select
                      id="mc-product"
                      name="product_interest"
                      value={form.product_interest}
                      onChange={(e) => update("product_interest", e.target.value)}
                      className={`${INPUT_CLASS} cursor-pointer appearance-none pr-[40px]`}
                    >
                      <option value={GENERAL_OPTION}>{GENERAL_OPTION}</option>
                      {products.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-[14px] top-1/2 -translate-y-1/2 text-[11px] text-ink-soft">
                      ▼
                    </span>
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="mc-message">Nội dung liên hệ</FieldLabel>
                  <textarea
                    id="mc-message"
                    name="message"
                    placeholder="Mình muốn đặt 2 hộp 6 bánh, tư vấn giúp mình quà biếu…"
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    className={`${INPUT_CLASS} min-h-[84px] resize-y leading-[1.5]`}
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-[5px] bg-[#fbecec] px-[12px] py-[10px] text-[13px] text-sale"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-[5px] bg-steel px-[26px] py-[13px] font-sans text-[14px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(42,53,87,0.55)] hover:bg-steel-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Đang gửi..." : "Gửi yêu cầu đặt hàng"}
                </button>
                <span className="text-center text-[12px] text-ink-faint">
                  Giờ làm việc 8:00–20:00 · phản hồi nhanh
                </span>
              </form>

              <div className="my-[14px] flex items-center gap-[10px]">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] tracking-[0.04em] text-ink-faint">
                  Hoặc chat ngay
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="flex flex-col gap-2">
                <ChannelLink
                  href="https://zalo.me/0938168168"
                  icon={<ZaloIcon size={22} />}
                  title="Zalo"
                  subtitle="Chat & đặt hàng ngay"
                />
                <ChannelLink
                  href="https://m.me/moonicake"
                  icon={<MessengerIcon size={22} />}
                  title="Messenger"
                  subtitle="Chat qua Facebook"
                />
                <ChannelLink
                  href="tel:+84938168168"
                  icon={<PhoneIcon size={22} />}
                  title="Gọi điện"
                  subtitle="0938 168 168 · nhanh nhất"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
