"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteProduct,
  type AdminProduct,
} from "@/app/actions/admin";
import { mediaUrl } from "@/lib/api";
import { formatVND } from "@/lib/format";
import { productStatusLabel, productTypeLabel } from "@/lib/product-labels";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductFormDialog } from "@/components/admin/product-form-dialog";

/** Màu pill trạng thái theo tokens Mooni: bán=xanh, hết=hổ phách, ẩn=xám. */
function StatusBadge({ status }: { status: AdminProduct["status"] }) {
  const styles: Record<AdminProduct["status"], string> = {
    available:
      "border-transparent bg-stock-in-bg text-stock-in-text",
    sold_out: "border-transparent bg-stock-warn-bg text-gold-deep",
    hidden: "border-border bg-muted text-ink-muted",
  };
  return (
    <Badge className={cn("rounded-full", styles[status])}>
      {productStatusLabel(status)}
    </Badge>
  );
}

export type ProductsManagerProps = {
  initialProducts: AdminProduct[];
};

/**
 * Bảng quản lý sản phẩm (client) — nhận danh sách từ Server Component, hiển thị
 * TẤT CẢ sản phẩm (gồm `hidden`). Điều phối dialog tạo/sửa và xác nhận xóa; sau
 * mỗi thao tác gọi `router.refresh()` để nạp lại dữ liệu tươi từ server.
 */
export function ProductsManager({ initialProducts }: ProductsManagerProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(product: AdminProduct) {
    setEditing(product);
    setFormOpen(true);
  }

  function handleSaved() {
    router.refresh();
  }

  function confirmDelete() {
    if (!deleting) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteProduct(deleting.id);
      if (!result.ok) {
        setDeleteError(result.message);
        return;
      }
      setDeleting(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus aria-hidden />
          Thêm sản phẩm
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-16 text-ink-muted">Ảnh</TableHead>
                <TableHead className="text-ink-muted">Tên</TableHead>
                <TableHead className="text-ink-muted">Loại</TableHead>
                <TableHead className="text-right text-ink-muted">Giá</TableHead>
                <TableHead className="text-ink-muted">Nhãn</TableHead>
                <TableHead className="text-ink-muted">Trạng thái</TableHead>
                <TableHead className="w-24 text-right text-ink-muted">
                  Thao tác
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialProducts.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-ink-muted"
                  >
                    Chưa có sản phẩm nào. Nhấn “Thêm sản phẩm” để bắt đầu.
                  </TableCell>
                </TableRow>
              ) : (
                initialProducts.map((product) => {
                  const src = mediaUrl(product.image_url);
                  return (
                    <TableRow key={product.id} className="border-border">
                      <TableCell>
                        <div className="relative flex size-11 items-center justify-center overflow-hidden rounded-lg border border-border bg-navy-tint">
                          {src ? (
                            <Image
                              src={src}
                              alt={product.name}
                              fill
                              sizes="44px"
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <ImageIcon
                              className="size-5 text-ink-faint"
                              aria-hidden
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-ink">
                          {product.name}
                        </div>
                        {product.subtitle && (
                          <div className="text-xs text-ink-faint">
                            {product.subtitle}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {productTypeLabel(product.type)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-ink tabular-nums">
                        {formatVND(product.price)}
                      </TableCell>
                      <TableCell>
                        {product.badge ? (
                          <Badge className="rounded-full bg-badge-hot text-white">
                            {product.badge}
                          </Badge>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={product.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Sửa ${product.name}`}
                            onClick={() => openEdit(product)}
                          >
                            <Pencil aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Xóa ${product.name}`}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(product);
                            }}
                          >
                            <Trash2 aria-hidden />
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

      {formOpen && (
        <ProductFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          product={editing}
          onSaved={handleSaved}
        />
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-lg text-navy">
              Xóa sản phẩm?
            </DialogTitle>
            <DialogDescription>
              Sản phẩm “{deleting?.name}” sẽ được ẩn khỏi trang bán hàng (xóa
              mềm). Bạn có thể hiện lại bằng cách sửa trạng thái.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={pending}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
            >
              {pending ? "Đang xóa…" : "Xóa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
