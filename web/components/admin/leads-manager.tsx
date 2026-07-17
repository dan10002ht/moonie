"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Phone } from "lucide-react";
import {
  convertLead,
  updateLeadStatus,
  type Lead,
} from "@/app/actions/admin";
import {
  LEAD_STATUSES,
  LEAD_STATUS_BADGE,
  leadStatusLabel,
  leadSourceLabel,
} from "@/lib/lead-labels";
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

/** Định dạng ngày giờ VN: 17/07/2026 14:30. */
const DATE_FMT = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

/** Pill trạng thái lead theo tokens Mooni. */
function LeadStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        "rounded-full",
        LEAD_STATUS_BADGE[status] ?? "border-border bg-muted text-ink-muted",
      )}
    >
      {leadStatusLabel(status)}
    </Badge>
  );
}

/** Thông báo convert thành công (đơn vừa tạo) — hiện trên đầu bảng. */
type ConvertNotice = { orderId: string; orderCode: string };

export type LeadsManagerProps = {
  leads: Lead[];
  total: number;
  offset: number;
  pageSize: number;
};

/**
 * Bảng quản lý leads (client). Nhận trang leads từ Server Component. Cho phép đổi
 * trạng thái qua select (→ updateLeadStatus → refresh), convert thành đơn nháp
 * (→ convertLead → refresh + banner mã đơn), và phân trang qua searchParams offset.
 */
export function LeadsManager({
  leads,
  total,
  offset,
  pageSize,
}: LeadsManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Id lead đang có thao tác chạy — để disable riêng dòng đó. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ConvertNotice | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
    router.push(query ? `/admin/leads?${query}` : "/admin/leads");
  }

  function handleStatusChange(lead: Lead, status: string) {
    if (status === lead.status) return;
    setError(null);
    setBusyId(lead.id);
    startTransition(async () => {
      const result = await updateLeadStatus(lead.id, status);
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function handleConvert(lead: Lead) {
    setError(null);
    setNotice(null);
    setBusyId(lead.id);
    startTransition(async () => {
      const result = await convertLead(lead.id);
      setBusyId(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice({
        orderId: result.data.order_id,
        orderCode: result.data.order_code,
      });
      router.refresh();
    });
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stock-in-text/25 bg-stock-in-bg px-4 py-3 text-sm text-stock-in-text"
        >
          <span>
            Đã tạo đơn nháp{" "}
            <span className="font-semibold tabular-nums">
              {notice.orderCode}
            </span>{" "}
            từ lead. Lead đã chuyển sang “Đã chuyển đơn”.
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/orders">
              Xem đơn hàng
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      )}

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
                <TableHead className="text-ink-muted">Khách hàng</TableHead>
                <TableHead className="text-ink-muted">SĐT</TableHead>
                <TableHead className="text-ink-muted">Quan tâm</TableHead>
                <TableHead className="text-ink-muted">Lời nhắn</TableHead>
                <TableHead className="text-ink-muted">Nguồn</TableHead>
                <TableHead className="text-ink-muted">Trạng thái</TableHead>
                <TableHead className="text-ink-muted">Ngày tạo</TableHead>
                <TableHead className="w-40 text-right text-ink-muted">
                  Thao tác
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-ink-muted"
                  >
                    Chưa có lead nào.
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => {
                  const isBusy = busyId === lead.id;
                  const converted = lead.status === "converted";
                  const isExpanded = expanded.has(lead.id);
                  return (
                    <TableRow key={lead.id} className="border-border align-top">
                      <TableCell className="font-medium text-ink">
                        {lead.name}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`tel:${lead.phone}`}
                          className="inline-flex items-center gap-1.5 text-ink tabular-nums hover:text-navy"
                        >
                          <Phone className="size-3.5 text-ink-faint" aria-hidden />
                          {lead.phone}
                        </a>
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {lead.product_interest ? (
                          lead.product_interest
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-56 text-ink-muted">
                        {lead.message ? (
                          <div>
                            <p
                              className={cn(
                                "whitespace-pre-line",
                                !isExpanded && "line-clamp-2",
                              )}
                              title={lead.message}
                            >
                              {lead.message}
                            </p>
                            {lead.message.length > 60 && (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(lead.id)}
                                className="mt-0.5 text-xs font-medium text-gold-deep hover:underline"
                              >
                                {isExpanded ? "Thu gọn" : "Xem thêm"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {leadSourceLabel(lead.source)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={lead.status}
                          onValueChange={(v) => handleStatusChange(lead, v)}
                          disabled={isBusy}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Trạng thái của ${lead.name}`}
                            className="w-36"
                          >
                            <LeadStatusBadge status={lead.status} />
                          </SelectTrigger>
                          <SelectContent>
                            {LEAD_STATUSES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-muted tabular-nums">
                        {formatDate(lead.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={converted || isBusy}
                            onClick={() => handleConvert(lead)}
                            title={
                              converted
                                ? "Lead đã được chuyển thành đơn"
                                : undefined
                            }
                          >
                            {converted
                              ? "Đã chuyển đơn"
                              : isBusy
                                ? "Đang xử lý…"
                                : "Chuyển thành đơn"}
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
            "Không có lead"
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
              lead
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
    </div>
  );
}
