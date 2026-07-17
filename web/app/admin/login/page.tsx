"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loginAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Trang đăng nhập admin (REQ-AUTH-004). Đứng riêng — KHÔNG dùng admin shell:
 * nền cream, canh giữa, logo Mooni (Playfair). Submit → loginAction (Server
 * Action) đặt cookie phiên → điều hướng /admin; sai → hiện thông báo lỗi.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await loginAction(email, password);
      if (result.ok) {
        router.replace("/admin");
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-serif text-3xl font-semibold tracking-tight text-navy">
            Mooni <span className="text-gold">Cake</span>
          </p>
          <p className="mt-2 text-sm text-ink-muted">Trang quản trị</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-7 shadow-sm ring-1 ring-foreground/5">
          <h1 className="font-serif text-xl font-semibold text-navy">
            Đăng nhập
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Nhập tài khoản quản trị để tiếp tục.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-ink">
                Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
                className="h-10"
                placeholder="admin@mooni.local"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-ink">
                Mật khẩu
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
                className="h-10"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="mt-2 h-11 w-full text-sm"
            >
              {pending ? "Đang đăng nhập…" : "Đăng nhập"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-ink-faint">
          Mooni Cake — Bánh trung thu cao cấp
        </p>
      </div>
    </main>
  );
}
