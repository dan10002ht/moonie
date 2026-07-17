import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";
import { LogoutButton } from "@/components/admin/logout-button";

/**
 * Admin shell (REQ-ADM-001): sidebar navy (điều hướng) + header (tên shop + đăng
 * xuất). Đặt trong route group `(shell)` nên KHÔNG áp cho /admin/login (login
 * đứng ngoài group, có giao diện riêng). URL không đổi vì group trong ngoặc.
 */
export default function AdminShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col bg-cream md:flex-row">
      <aside className="flex flex-col bg-sidebar text-sidebar-foreground md:min-h-screen md:w-64 md:shrink-0 md:border-r md:border-sidebar-border">
        <div className="px-5 py-5 md:px-6 md:py-6">
          <Link
            href="/admin"
            className="font-serif text-2xl font-semibold tracking-tight text-white"
          >
            Mooni <span className="text-gold">Cake</span>
          </Link>
          <p className="mt-1 hidden text-xs text-sidebar-foreground md:block">
            Trang quản trị
          </p>
        </div>
        <AdminNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-cream px-5 md:px-8">
          <span className="font-serif text-lg font-semibold text-navy">
            Mooni Cake
          </span>
          <LogoutButton />
        </header>
        <main className="flex-1 p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
