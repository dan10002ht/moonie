"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, Plus } from "lucide-react";
import {
  updateOrderStatus,
  type Order,
  type AdminProduct,
  type Customer,
} from "@/app/actions/admin";
import { formatVND } from "@/lib/format";
import {
  ORDER_STATUSES,
  ORDER_STATUS_BADGE,
  orderChannelLabel,
  orderStatusLabel,
  isTerminalStatus,
} from "@/lib/order-labels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrderFormDialog } from "@/components/admin/order-form-dialog";
import { OrderDetailDialog } from "@/components/admin/order-detail";

/** Định dạng ngày VN: 17/07/2026. */
const DATE_FMT = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

/** Pill trạng thái đơn theo tokens Mooni. */
export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        "rounded-full",
        ORDER_STATUS_BADGE[status] ?? "border-border bg-muted text-ink-muted",
      )}
    >
      {orderStatusLabel(status)}
    </Badge>
  );
}

export type OrdersManagerProps = {
  orders: Order[];
  total: number;
  offset: number;
  pageSize: number;
  products: AdminProduct[];
  customers: Customer[];
};

/**
 * Bảng quản lý đơn hàng (client). Nhận trang đơn từ Server Component + danh sách
 * sản phẩm/khách để nạp form tạo đơn. Cho phép: tạo đơn (dialog nhiều dòng món),
 * xem chi tiết (dialog items snapshot), đổi trạng thái qua select (chặn khi đơn
 * đã hoàn tất/hủy), và phân trang qua searchParams offset.
 */
export function OrdersManager({
  orders,
  total,
  offset,
  pageSize,
  products,
  customers,
}: OrdersManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  /** Map id → tên khách để hiện cột "Khách hàng" từ customer_id. */
  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const page = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrev = offset > 0;
  const hasNext = offset + pageSize < total;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageSize, total);

  function goTo(nextOffset: number) {
    const params = new URLSearchParams();
    if (nextOffset > 0) params.set("offset", String(nextOffset));
    const query = params.toString();
    router.push(query ? `/admin/orders?${query}` : "/admin/orders");
  }

  function handleStatusChange(order: Order, status: string) {
    if (status === order.status) return;
    setError(null);
    setBusyId(order.id);
    startTransition(async () => {
      const result = await updateOrderStatus(order.id, status);
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  /** Nhãn khách hiển thị: tên khách nếu có, else trích ghi chú, else "Khách lẻ". */
  function customerCell(order: Order): { label: string; muted: boolean } {
    if (order.customer_id) {
      const name = customerName.get(order.customer_id);
      if (name) return { label: name, muted: false };
    }
    if (order.note && order.note.trim() !== "") {
      const note = order.note.trim();
      return {
        label: note.length > 40 ? `${note.slice(0, 40)}…` : note,
        muted: true,
      };
    }
    return { label: "Khách lẻ", muted: true };
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setFormOpen(true)}>
          <Plus aria-hidden />
          Tạo đơn
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-ink-muted">Mã đơn</TableHead>
                <TableHead className="text-ink-muted">Khách hàng</TableHead>
                <TableHead className="text-ink-muted">Kênh</TableHead>
                <TableHead className="text-right text-ink-muted">
                  Tổng tiền
                </TableHead>
                <TableHead className="text-ink-muted">Trạng thái</TableHead>
                <TableHead className="text-ink-muted">Ngày</TableHead>
                <TableHead className="w-28 text-right text-ink-muted">
                  Thao tác
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-ink-muted"
                  >
                    Chưa có đơn hàng nào. Nhấn “Tạo đơn” để bắt đầu.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => {
                  const isBusy = busyId === order.id;
                  const terminal = isTerminalStatus(order.status);
                  const cust = customerCell(order);
                  return (
                    <TableRow key={order.id} className="border-border">
                      <TableCell className="font-medium text-ink tabular-nums">
                        {order.code}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "max-w-[220px] truncate",
                          cust.muted ? "text-ink-faint" : "text-ink",
                        )}
                        title={cust.label}
                      >
                        {cust.label}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {orderChannelLabel(order.channel)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-ink tabular-nums">
                        {formatVND(order.total)}
                      </TableCell>
                      <TableCell>
                        {terminal ? (
                          <OrderStatusBadge status={order.status} />
                        ) : (
                          <Select
                            value={order.status}
                            onValueChange={(v) => handleStatusChange(order, v)}
                            disabled={isBusy}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`Trạng thái đơn ${order.code}`}
                              className="w-40"
                            >
                              <OrderStatusBadge status={order.status} />
                            </SelectTrigger>
                            <SelectContent>
                              {ORDER_STATUSES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-muted tabular-nums">
                        {formatDate(order.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Xem chi tiết đơn ${order.code}`}
                            onClick={() => setDetailId(order.id)}
                          >
                            <Eye aria-hidden />
                            Chi tiết
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {total === 0 ? (
            "Không có đơn hàng"
          ) : (
            <>
              Hiển thị{" "}
              <span className="font-medium text-ink tabular-nums">
                {rangeStart}–{rangeEnd}
              </span>{" "}
              · Trang{" "}
              <span className="font-medium text-ink tabular-nums">{page}</span>/
              <span className="tabular-nums">{totalPages}</span> · Tổng{" "}
              <span className="font-medium text-ink tabular-nums">{total}</span>{" "}
              đơn
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev || pending}
            onClick={() => goTo(Math.max(0, offset - pageSize))}
          >
            <ChevronLeft aria-hidden />
            Trước
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext || pending}
            onClick={() => goTo(offset + pageSize)}
          >
            Sau
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      {formOpen && (
        <OrderFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          products={products}
          customers={customers}
          onSaved={() => router.refresh()}
        />
      )}

      {detailId && (
        <OrderDetailDialog
          orderId={detailId}
          open={detailId !== null}
          onOpenChange={(open) => {
            if (!open) setDetailId(null);
          }}
          customers={customers}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
