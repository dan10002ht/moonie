"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

/**
 * Nút đăng xuất. Gọi logoutAction (xóa cookie mc_admin server-side) rồi điều
 * hướng về /admin/login. proxy.ts sẽ chặn mọi /admin/* sau khi cookie mất.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      await logoutAction();
      router.replace("/admin/login");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleLogout}
      disabled={pending}
      className="h-9 gap-2"
    >
      <LogOut className="size-4" aria-hidden />
      {pending ? "Đang thoát…" : "Đăng xuất"}
    </Button>
  );
}
