"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Cake,
  Inbox,
  ClipboardList,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Mục điều hướng admin. Đơn hàng/Leads/… trỏ tới các trang GĐ5 tương ứng. */
const NAV_ITEMS: readonly NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/products", label: "Sản phẩm", icon: Cake },
  { href: "/admin/leads", label: "Leads", icon: Inbox },
  { href: "/admin/orders", label: "Đơn hàng", icon: ClipboardList },
  { href: "/admin/customers", label: "Khách hàng", icon: Users },
];

/**
 * Điều hướng admin. Dọc trên desktop (sidebar), cuộn ngang trên mobile. Đánh dấu
 * mục đang mở theo pathname (chính xác cho /admin, tiền tố cho các mục con).
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Điều hướng quản trị"
      className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-4 md:pb-4"
    >
      {NAV_ITEMS.map((item) => {
        const active =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
