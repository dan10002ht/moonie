"use client";

import { useState, useTransition } from "react";
import {
  createCustomer,
  updateCustomer,
  type Customer,
  type CustomerInput,
} from "@/app/actions/admin";
import { CUSTOMER_TYPES } from "@/lib/customer-labels";
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

type FieldValues = {
  name: string;
  phone: string;
  email: string;
  company: string;
  address: string;
  type: string;
  note: string;
};

type FieldErrors = Partial<Record<"name", string>>;

function emptyValues(): FieldValues {
  return {
    name: "",
    phone: "",
    email: "",
    company: "",
    address: "",
    type: "personal",
    note: "",
  };
}

function valuesFromCustomer(c: Customer): FieldValues {
  return {
    name: c.name,
    phone: c.phone ?? "",
    email: c.email ?? "",
    company: c.company ?? "",
    address: c.address ?? "",
    type: c.type,
    note: c.note ?? "",
  };
}

/** Chuyển ô nhập text → giá trị gửi API: rỗng ⇒ null, ngược lại trim. */
function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export type CustomerFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = tạo mới; khách = sửa. */
  customer: Customer | null;
  /** Gọi sau khi lưu thành công để trang refresh dữ liệu. */
  onSaved: () => void;
};

/**
 * Dialog form tạo/sửa khách hàng (REQ-CUST-001). Validate client (tên bắt buộc)
 * + hiện lỗi trả từ API (400 dữ liệu sai: SĐT/email sai định dạng, type sai enum).
 * Component được remount (qua `key`) mỗi lần mở → khởi tạo state từ props một lần.
 */
export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  onSaved,
}: CustomerFormDialogProps) {
  const isEdit = customer !== null;
  const [values, setValues] = useState<FieldValues>(() =>
    customer ? valuesFromCustomer(customer) : emptyValues(),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setField<K extends keyof FieldValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (values.name.trim() === "") errors.name = "Tên khách hàng là bắt buộc.";
    return errors;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const input: CustomerInput = {
      name: values.name.trim(),
      phone: nullableText(values.phone),
      email: nullableText(values.email),
      company: nullableText(values.company),
      address: nullableText(values.address),
      type: values.type === "business" ? "business" : "personal",
      note: nullableText(values.note),
    };

    startTransition(async () => {
      const result = isEdit
        ? await updateCustomer(customer.id, input)
        : await createCustomer(input);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-lg text-navy">
            {isEdit ? "Sửa khách hàng" : "Thêm khách hàng"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Cập nhật thông tin liên hệ của khách hàng."
              : "Điền thông tin để thêm khách hàng vào danh bạ."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="cf-name" className="text-ink">
              Tên khách hàng <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cf-name"
              name="name"
              value={values.name}
              onChange={(e) => setField("name", e.target.value)}
              disabled={pending}
              aria-invalid={fieldErrors.name ? true : undefined}
              placeholder="Nguyễn Văn An"
            />
            {fieldErrors.name && (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cf-phone" className="text-ink">
                Số điện thoại
              </Label>
              <Input
                id="cf-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                value={values.phone}
                onChange={(e) => setField("phone", e.target.value)}
                disabled={pending}
                placeholder="0901234567"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cf-email" className="text-ink">
                Email
              </Label>
              <Input
                id="cf-email"
                name="email"
                type="email"
                value={values.email}
                onChange={(e) => setField("email", e.target.value)}
                disabled={pending}
                placeholder="an@example.com"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cf-company" className="text-ink">
                Công ty
              </Label>
              <Input
                id="cf-company"
                name="company"
                value={values.company}
                onChange={(e) => setField("company", e.target.value)}
                disabled={pending}
                placeholder="Công ty TNHH ABC"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-ink">Loại khách</Label>
              <Select
                name="type"
                value={values.type}
                onValueChange={(v) => setField("type", v)}
                disabled={pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOMER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cf-address" className="text-ink">
              Địa chỉ
            </Label>
            <Input
              id="cf-address"
              name="address"
              value={values.address}
              onChange={(e) => setField("address", e.target.value)}
              disabled={pending}
              placeholder="123 Đường Lê Lợi, Quận 1, TP.HCM"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cf-note" className="text-ink">
              Ghi chú
            </Label>
            <Textarea
              id="cf-note"
              name="note"
              value={values.note}
              onChange={(e) => setField("note", e.target.value)}
              disabled={pending}
              rows={3}
              placeholder="Khách quen, thích bánh ít ngọt…"
            />
          </div>

          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Đang lưu…" : "Lưu"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
