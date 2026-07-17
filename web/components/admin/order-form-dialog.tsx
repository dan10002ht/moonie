"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createOrder,
  type AdminProduct,
  type Customer,
  type OrderInput,
} from "@/app/actions/admin";
import { formatVND } from "@/lib/format";
import { ORDER_CHANNELS } from "@/lib/order-labels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinel giá trị "không chọn khách" (Radix Select không nhận value rỗng). */
const NO_CUSTOMER = "none";

/** Một dòng món trong form (state cục bộ). `key` để React nhận diện khi thêm/xóa. */
type ItemRow = {
  key: string;
  productId: string;
  quantity: string;
};

let rowSeq = 0;
function newRow(): ItemRow {
  rowSeq += 1;
  return { key: `row-${rowSeq}`, productId: "", quantity: "1" };
}

/** Chuyển ô nhập text → giá trị gửi API: rỗng ⇒ null, ngược lại trim. */
function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export type OrderFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: AdminProduct[];
  customers: Customer[];
  /** Gọi sau khi tạo đơn thành công để trang refresh dữ liệu. */
  onSaved: () => void;
};

/**
 * Dialog form tạo đơn nhiều dòng món (REQ-ORD-001/002). Chọn kênh, khách (tùy
 * chọn), thêm/bớt dòng món (sản phẩm + số lượng), giảm giá, ngày/địa chỉ/ghi chú.
 * Hiện tổng tạm tính (subtotal = Σ giá×sl, total = subtotal − giảm giá) realtime
 * dựa giá sản phẩm client-side. Validate ít nhất 1 dòng hợp lệ; hiện lỗi API (400).
 */
export function OrderFormDialog({
  open,
  onOpenChange,
  products,
  customers,
  onSaved,
}: OrderFormDialogProps) {
  const [channel, setChannel] = useState<string>("phone");
  const [customerId, setCustomerId] = useState<string>(NO_CUSTOMER);
  const [rows, setRows] = useState<ItemRow[]>(() => [newRow()]);
  const [discount, setDiscount] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [deliveryAddress, setDeliveryAddress] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** Map id → giá sản phẩm để tính tổng tạm tính client-side. */
  const priceById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) map.set(p.id, p.price);
    return map;
  }, [products]);

  const subtotal = useMemo(() => {
    let sum = 0;
    for (const row of rows) {
      const price = priceById.get(row.productId);
      const qty = Number.parseInt(row.quantity, 10);
      if (price !== undefined && Number.isFinite(qty) && qty > 0) {
        sum += price * qty;
      }
    }
    return sum;
  }, [rows, priceById]);

  const discountValue = useMemo(() => {
    const n = Number.parseInt(discount.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [discount]);

  const total = Math.max(0, subtotal - discountValue);

  function setRow(key: string, patch: Partial<ItemRow>) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) =>
      prev.length <= 1 ? prev : prev.filter((r) => r.key !== key),
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    // Chỉ giữ dòng hợp lệ: có sản phẩm + số lượng > 0.
    const items: OrderInput["items"] = [];
    for (const row of rows) {
      const qty = Number.parseInt(row.quantity, 10);
      if (row.productId !== "" && Number.isFinite(qty) && qty > 0) {
        items.push({ product_id: row.productId, quantity: qty });
      }
    }

    if (items.length === 0) {
      setFormError(
        "Cần ít nhất 1 dòng món hợp lệ (chọn sản phẩm và số lượng > 0).",
      );
      return;
    }

    if (discountValue > subtotal) {
      setFormError("Giảm giá không được vượt quá tổng tiền hàng.");
      return;
    }

    const input: OrderInput = {
      channel: channel as OrderInput["channel"],
      customer_id: customerId === NO_CUSTOMER ? null : customerId,
      discount: discountValue,
      delivery_date: nullableText(deliveryDate),
      delivery_address: nullableText(deliveryAddress),
      note: nullableText(note),
      items,
    };

    startTransition(async () => {
      const result = await createOrder(input);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      onSaved();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg text-navy">
            Tạo đơn hàng
          </DialogTitle>
          <DialogDescription>
            Nhập đơn thủ công — chọn kênh, khách hàng (tùy chọn) và các dòng món.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-ink">
                Kênh đặt hàng <span className="text-destructive">*</span>
              </Label>
              <Select
                name="channel"
                value={channel}
                onValueChange={setChannel}
                disabled={pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_CHANNELS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-ink">Khách hàng</Label>
              <Select
                name="customer_id"
                value={customerId}
                onValueChange={setCustomerId}
                disabled={pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CUSTOMER}>Không chọn</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dòng món động */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-ink">
                Dòng món <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                disabled={pending}
              >
                <Plus aria-hidden />
                Thêm dòng
              </Button>
            </div>

            <div className="space-y-2 rounded-xl border border-border bg-navy-tint/40 p-3">
              {products.length === 0 && (
                <p className="text-xs text-ink-muted">
                  Chưa có sản phẩm khả dụng. Hãy thêm sản phẩm trước khi tạo đơn.
                </p>
              )}
              {rows.map((row, index) => {
                const price = priceById.get(row.productId);
                const qty = Number.parseInt(row.quantity, 10);
                const lineTotal =
                  price !== undefined && Number.isFinite(qty) && qty > 0
                    ? price * qty
                    : 0;
                return (
                  <div
                    key={row.key}
                    className="flex flex-wrap items-end gap-2 sm:flex-nowrap"
                  >
                    <div className="min-w-[160px] flex-1 space-y-1">
                      {index === 0 && (
                        <span className="text-xs text-ink-faint">
                          Sản phẩm
                        </span>
                      )}
                      <Select
                        value={row.productId}
                        onValueChange={(v) => setRow(row.key, { productId: v })}
                        disabled={pending || products.length === 0}
                      >
                        <SelectTrigger
                          className="w-full bg-card"
                          aria-label={`Sản phẩm dòng ${index + 1}`}
                        >
                          <SelectValue placeholder="Chọn sản phẩm" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} · {formatVND(p.price)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-20 space-y-1">
                      {index === 0 && (
                        <span className="text-xs text-ink-faint">SL</span>
                      )}
                      <Input
                        name={`quantity-${index}`}
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={row.quantity}
                        onChange={(e) =>
                          setRow(row.key, { quantity: e.target.value })
                        }
                        disabled={pending}
                        aria-label={`Số lượng dòng ${index + 1}`}
                        className="bg-card"
                      />
                    </div>

                    <div className="w-28 space-y-1 text-right">
                      {index === 0 && (
                        <span className="block text-xs text-ink-faint">
                          Thành tiền
                        </span>
                      )}
                      <span className="block py-2 text-sm font-medium text-ink tabular-nums">
                        {formatVND(lineTotal)}
                      </span>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Xóa dòng ${index + 1}`}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeRow(row.key)}
                      disabled={pending || rows.length <= 1}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="of-discount" className="text-ink">
                Giảm giá (VND)
              </Label>
              <Input
                id="of-discount"
                name="discount"
                type="number"
                min={0}
                inputMode="numeric"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                disabled={pending}
                placeholder="0"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="of-delivery-date" className="text-ink">
                Ngày giao
              </Label>
              <Input
                id="of-delivery-date"
                name="delivery_date"
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="of-delivery-address" className="text-ink">
              Địa chỉ giao
            </Label>
            <Input
              id="of-delivery-address"
              name="delivery_address"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              disabled={pending}
              placeholder="Số nhà, đường, phường/quận…"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="of-note" className="text-ink">
              Ghi chú
            </Label>
            <Textarea
              id="of-note"
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              rows={2}
              placeholder="Yêu cầu đặc biệt, tên người nhận…"
            />
          </div>

          {/* Tổng tạm tính realtime */}
          <div className="space-y-1 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm text-ink-muted">
              <span>Tạm tính</span>
              <span className="tabular-nums">{formatVND(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-ink-muted">
              <span>Giảm giá</span>
              <span className="tabular-nums">
                {discountValue > 0 ? `− ${formatVND(discountValue)}` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-base font-semibold text-navy">
              <span>Tổng cộng</span>
              <span className="tabular-nums">{formatVND(total)}</span>
            </div>
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Đang tạo…" : "Tạo đơn"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
