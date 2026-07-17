import { Inbox, ClipboardList, Wallet } from "lucide-react";
import { getDashboard, type Dashboard } from "@/app/actions/admin";
import { formatVND } from "@/lib/format";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

/** Dashboard admin cần dữ liệu tươi mỗi lần vào — không cache tĩnh. */
export const dynamic = "force-dynamic";

type Stat = {
  label: string;
  value: string;
  hint: string;
  icon: typeof Inbox;
};

function buildStats(data: Dashboard): Stat[] {
  return [
    {
      label: "Leads mới",
      value: new Intl.NumberFormat("vi-VN").format(data.new_leads),
      hint: "Chưa liên hệ (status = new)",
      icon: Inbox,
    },
    {
      label: "Đơn đang xử lý",
      value: new Intl.NumberFormat("vi-VN").format(data.processing_orders),
      hint: "Đã xác nhận / đang giao",
      icon: ClipboardList,
    },
    {
      label: "Doanh thu tháng",
      value: formatVND(data.revenue_this_month),
      hint: "Đơn hoàn tất trong tháng này",
      icon: Wallet,
    },
  ];
}

export default async function AdminDashboardPage() {
  let data: Dashboard | null = null;
  try {
    data = await getDashboard();
  } catch {
    data = null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">
          Tổng quan
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Các chỉ số bán hàng chính của Mooni Cake.
        </p>
      </div>

      {data === null ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-ink-muted">
          Không tải được số liệu tổng quan. Vui lòng thử lại sau.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {buildStats(data).map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="gap-3">
                <CardHeader className="flex-row items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium text-ink-muted">
                    {stat.label}
                  </CardTitle>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-navy-tint text-navy">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                </CardHeader>
                <CardContent>
                  <p className="font-serif text-3xl font-semibold text-navy">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">{stat.hint}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
