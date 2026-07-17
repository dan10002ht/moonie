"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Mail, Pencil, Phone, Plus } from "lucide-react";
import { type Customer } from "@/app/actions/admin";
import {
  CUSTOMER_TYPE_BADGE,
  customerTypeLabel,
} from "@/lib/customer-labels";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CustomerFormDialog } from "@/components/admin/customer-form-dialog";

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

/** Pill loại khách theo tokens Mooni. */
function CustomerTypeBadge({ type }: { type: string }) {
  return (
    <Badge
      className={cn(
        "rounded-full",
        CUSTOMER_TYPE_BADGE[type] ?? "border-border bg-muted text-ink-muted",
      )}
    >
      {customerTypeLabel(type)}
    </Badge>
  );
}

export type CustomersManagerProps = {
  customers: Customer[];
  total: number;
  offset: number;
  pageSize: number;
};

/**
 * Bảng quản lý khách hàng (client) — nhận trang khách từ Server Component. Điều
 * phối dialog tạo/sửa; sau mỗi thao tác gọi `router.refresh()` để nạp lại dữ
 * liệu tươi. Phân trang qua searchParams offset (trước/sau + tổng).
 */
export function CustomersManager({
  customers,
  total,
  offset,
  pageSize,
}: CustomersManagerProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

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
    router.push(query ? `/admin/customers?${query}` : "/admin/customers");
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditing(customer);
    setFormOpen(true);
  }

  function handleSaved() {
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus aria-hidden />
          Thêm khách hàng
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-ink-muted">Tên</TableHead>
                <TableHead className="text-ink-muted">SĐT</TableHead>
                <TableHead className="text-ink-muted">Email</TableHead>
                <TableHead className="text-ink-muted">Công ty</TableHead>
                <TableHead className="text-ink-muted">Loại</TableHead>
                <TableHead className="text-ink-muted">Ngày tạo</TableHead>
                <TableHead className="w-20 text-right text-ink-muted">
                  Thao tác
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-ink-muted"
                  >
                    Chưa có khách hàng nào. Nhấn “Thêm khách hàng” để bắt đầu.
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((customer) => (
                  <TableRow key={customer.id} className="border-border">
                    <TableCell className="font-medium text-ink">
                      {customer.name}
                    </TableCell>
                    <TableCell>
                      {customer.phone ? (
                        <a
                          href={`tel:${customer.phone}`}
                          className="inline-flex items-center gap-1.5 text-ink tabular-nums hover:text-navy"
                        >
                          <Phone
                            className="size-3.5 text-ink-faint"
                            aria-hidden
                          />
                          {customer.phone}
                        </a>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {customer.email ? (
                        <a
                          href={`mailto:${customer.email}`}
                          className="inline-flex items-center gap-1.5 text-ink hover:text-navy"
                        >
                          <Mail
                            className="size-3.5 text-ink-faint"
                            aria-hidden
                          />
                          {customer.email}
                        </a>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-muted">
                      {customer.company ? (
                        customer.company
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <CustomerTypeBadge type={customer.type} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-ink-muted tabular-nums">
                      {formatDate(customer.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Sửa ${customer.name}`}
                          onClick={() => openEdit(customer)}
                        >
                          <Pencil aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {total === 0 ? (
            "Không có khách hàng"
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
              khách hàng
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={() => goTo(Math.max(0, offset - pageSize))}
          >
            <ChevronLeft aria-hidden />
            Trước
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() => goTo(offset + pageSize)}
          >
            Sau
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      {formOpen && (
        <CustomerFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          customer={editing}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
