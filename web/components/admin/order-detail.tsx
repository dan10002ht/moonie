"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getOrder,
  updateOrderStatus,
  type Customer,
  type OrderDetail,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Định dạng ngày VN: 17/07/2026 14:30. */
const DATE_FMT = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

/** Định dạng ngày (không giờ) cho ngày giao. */
function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Pill trạng thái đơn theo tokens Mooni (inline để tránh import vòng). */
function OrderStatusBadge({ status }: { status: string }) {
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

/** Một cặp nhãn — giá trị trong khối thông tin đơn. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

export type OrderDetailDialogProps = {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  /** Gọi sau khi đổi status thành công để trang list refresh. */
  onChanged: () => void;
};

/**
 * Dialog chi tiết đơn hàng (REQ-ORD-002). Nạp chi tiết qua `getOrder` khi mở
 * (items là snapshot tên/đơn giá tại thời điểm đặt). Hiện thông tin đơn + bảng
 * món + tổng, và cho đổi trạng thái (chặn khi đơn đã hoàn tất/hủy).
 */
export function OrderDetailDialog({
  orderId,
  open,
  onOpenChange,
  customers,
  onChanged,
}: OrderDetailDialogProps) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  // Component được mount mới mỗi lần mở dialog (orderId ổn định trong 1 vòng đời)
  // nên state khởi tạo đã là loading=true/loadError=null — không setState đồng bộ
  // trong effect (react-hooks/set-state-in-effect); chỉ set trong callback async.
  useEffect(() => {
    let cancelled = false;
    getOrder(orderId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Không tải được chi tiết đơn hàng.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const customerName = detail?.customer_id
    ? customers.find((c) => c.id === detail.customer_id)?.name
    : undefined;

  function handleStatusChange(status: string) {
    if (!detail || status === detail.status) return;
    setStatusError(null);
    startTransition(async () => {
      const result = await updateOrderStatus(detail.id, status);
      if (!result.ok) {
        setStatusError(result.message);
        return;
      }
      setDetail({ ...detail, status: result.data.status });
      onChanged();
    });
  }

  const terminal = detail ? isTerminalStatus(detail.status) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg text-navy">
            {detail ? `Đơn ${detail.code}` : "Chi tiết đơn hàng"}
          </DialogTitle>
          <DialogDescription>
            Thông tin đơn và danh sách món (giá đã chốt tại thời điểm đặt).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-sm text-ink-muted">Đang tải…</p>
        ) : loadError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {loadError}
          </p>
        ) : detail ? (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-navy-tint/40 p-4 sm:grid-cols-3">
              <InfoRow label="Mã đơn" value={<span className="tabular-nums">{detail.code}</span>} />
              <InfoRow
                label="Kênh"
                value={orderChannelLabel(detail.channel)}
              />
              <InfoRow
                label="Ngày tạo"
                value={
                  <span className="tabular-nums">
                    {formatDateTime(detail.created_at)}
                  </span>
                }
              />
              <InfoRow
                label="Khách hàng"
                value={
                  customerName ?? (
                    <span className="text-ink-faint">Khách lẻ</span>
                  )
                }
              />
              <InfoRow
                label="Ngày giao"
                value={
                  detail.delivery_date ? (
                    <span className="tabular-nums">
                      {formatDateOnly(detail.delivery_date)}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )
                }
              />
              <InfoRow
                label="Địa chỉ giao"
                value={
                  detail.delivery_address ?? (
                    <span className="text-ink-faint">—</span>
                  )
                }
              />
              {detail.note && (
                <div className="col-span-2 space-y-0.5 sm:col-span-3">
                  <dt className="text-xs text-ink-faint">Ghi chú</dt>
                  <dd className="text-sm whitespace-pre-line text-ink">
                    {detail.note}
                  </dd>
                </div>
              )}
            </dl>

            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-ink-muted">Món</TableHead>
                    <TableHead className="text-right text-ink-muted">
                      Đơn giá
                    </TableHead>
                    <TableHead className="text-right text-ink-muted">
                      SL
                    </TableHead>
                    <TableHead className="text-right text-ink-muted">
                      Thành tiền
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item) => (
                    <TableRow key={item.id} className="border-border">
                      <TableCell className="font-medium text-ink">
                        {item.product_name}
                      </TableCell>
                      <TableCell className="text-right text-ink-muted tabular-nums">
                        {formatVND(item.unit_price)}
                      </TableCell>
                      <TableCell className="text-right text-ink-muted tabular-nums">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-right font-medium text-ink tabular-nums">
                        {formatVND(item.unit_price * item.quantity)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-1 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-sm text-ink-muted">
                <span>Tạm tính</span>
                <span className="tabular-nums">
                  {formatVND(detail.subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm text-ink-muted">
                <span>Giảm giá</span>
                <span className="tabular-nums">
                  {detail.discount > 0 ? `− ${formatVND(detail.discount)}` : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold text-navy">
                <span>Tổng cộng</span>
                <span className="tabular-nums">{formatVND(detail.total)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-ink">Trạng thái</Label>
                {terminal ? (
                  <OrderStatusBadge status={detail.status} />
                ) : (
                  <Select
                    value={detail.status}
                    onValueChange={handleStatusChange}
                    disabled={pending}
                  >
                    <SelectTrigger
                      className="w-44"
                      aria-label="Đổi trạng thái đơn"
                    >
                      <SelectValue />
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
              </div>
              {terminal && (
                <p className="text-xs text-ink-faint">
                  Đơn đã kết thúc — không thể đổi trạng thái.
                </p>
              )}
            </div>

            {statusError && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {statusError}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Đóng
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
