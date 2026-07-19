"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Độ trễ transition (ms) để stagger nhiều phần tử. */
  delay?: number;
  /** Tag phần tử bọc ngoài (mặc định "div"). */
  as?: ElementType;
};

/**
 * Reveal — bọc nội dung để fade + trượt lên khi cuộn vào viewport.
 * IntersectionObserver one-shot (observe rồi unobserve, không re-trigger).
 * Tôn trọng prefers-reduced-motion: hiện ngay, bỏ delay.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as,
}: RevealProps) {
  const Tag: ElementType = as ?? "div";
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setReduced(true);
      setVisible(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const style: CSSProperties | undefined =
    !reduced && delay ? { transitionDelay: `${delay}ms` } : undefined;

  return (
    <Tag
      ref={ref}
      style={style}
      className={`reveal${visible ? " is-visible" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </Tag>
  );
}
