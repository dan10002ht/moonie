import type { ReactNode } from "react";

type TrustItem = {
  icon: ReactNode;
  title: string;
  sub: string;
};

const svgProps = {
  viewBox: "0 0 24 24",
  width: 22,
  height: 22,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  style: { display: "block" },
};

const ITEMS: TrustItem[] = [
  {
    icon: (
      <svg {...svgProps}>
        <path d="M12 3v18M5 8c0-2 3-3 7-3s7 1 7 3M5 8v8c0 2 3 3 7 3s7-1 7-3V8" />
      </svg>
    ),
    title: "Thủ công mỗi ngày",
    sub: "Mẻ bánh mới, không tồn kho lâu",
  },
  {
    icon: (
      <svg {...svgProps}>
        <path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
    title: "An toàn thực phẩm",
    sub: "Nguyên liệu chọn lọc, rõ nguồn gốc",
  },
  {
    icon: (
      <svg {...svgProps}>
        <path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7" />
        <path d="M2 7h20v5H2zM12 22V7M12 7S10.5 3 8 3 5 5.5 8 7M12 7s1.5-4 4-4 3 2.5 0 4" />
      </svg>
    ),
    title: "Chuẩn quà biếu",
    sub: "Hộp thiết kế riêng, thiệp cá nhân hoá",
  },
  {
    icon: (
      <svg {...svgProps}>
        <path d="M3 12h11l3-4h3l1 4v4h-3M3 16h1M6 16h6" />
        <circle cx="17.5" cy="17.5" r="2" />
        <circle cx="6.5" cy="17.5" r="2" />
      </svg>
    ),
    title: "Giao nhanh tận nơi",
    sub: "Nội thành trong ngày · toàn quốc",
  },
];

/** Trust strip — 4 điểm tin cậy trên nền trắng. Port § TRUST STRIP. */
export function TrustStrip() {
  return (
    <section className="border-b border-border bg-white">
      <div className="mx-auto grid max-w-[1160px] grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-5 px-6 py-[26px]">
        {ITEMS.map((item) => (
          <div key={item.title} className="flex items-center gap-[14px]">
            <span className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[10px] bg-navy-tint text-steel">
              {item.icon}
            </span>
            <div>
              <div className="text-[14.5px] font-semibold text-navy">
                {item.title}
              </div>
              <div className="text-[12.5px] text-ink-soft">{item.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
