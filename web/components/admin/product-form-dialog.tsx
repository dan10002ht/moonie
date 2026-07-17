"use client";

import { useMemo, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ImageIcon, Upload } from "lucide-react";
import {
  createProduct,
  updateProduct,
  uploadProductImage,
  type AdminProduct,
  type ProductInput,
} from "@/app/actions/admin";
import { mediaUrl } from "@/lib/api";
import { PRODUCT_STATUSES, PRODUCT_TYPES } from "@/lib/product-labels";
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
  slug: string;
  name: string;
  description: string;
  price: string;
  compareAtPrice: string;
  type: string;
  status: string;
  subtitle: string;
  badge: string;
  displayOrder: string;
};

type FieldErrors = Partial<Record<"slug" | "name" | "price", string>>;

function emptyValues(): FieldValues {
  return {
    slug: "",
    name: "",
    description: "",
    price: "",
    compareAtPrice: "",
    type: "gift_box",
    status: "available",
    subtitle: "",
    badge: "",
    displayOrder: "0",
  };
}

function valuesFromProduct(p: AdminProduct): FieldValues {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description ?? "",
    price: String(p.price),
    compareAtPrice: p.compare_at_price != null ? String(p.compare_at_price) : "",
    type: p.type,
    status: p.status,
    subtitle: p.subtitle ?? "",
    badge: p.badge ?? "",
    displayOrder: String(p.display_order),
  };
}

/** Chuyển ô nhập text → giá trị gửi API: rỗng ⇒ null, ngược lại trim. */
function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Chuyển ô nhập số → number | null. Trả `undefined` nếu không phải số hợp lệ. */
function parseNumber(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export type ProductFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = tạo mới; sản phẩm = sửa. */
  product: AdminProduct | null;
  /** Gọi sau khi lưu thành công để trang refresh dữ liệu. */
  onSaved: () => void;
};

/**
 * Dialog form tạo/sửa sản phẩm (REQ-PROD-002/003). Validate client (tên bắt buộc,
 * giá ≥ 0) + hiện lỗi trả từ API (400 dữ liệu sai, 409 slug trùng). Có input file
 * ảnh: sau khi tạo/sửa thành công, nếu đã chọn tệp thì upload → cập nhật image_url.
 */
export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: ProductFormDialogProps) {
  const isEdit = product !== null;
  // Component được remount (qua `key`) mỗi lần mở → khởi tạo state từ props một
  // lần, tránh đồng bộ prop→state trong effect (react-hooks/set-state-in-effect).
  const [values, setValues] = useState<FieldValues>(() =>
    product ? valuesFromProduct(product) : emptyValues(),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview cục bộ cho tệp vừa chọn. Tạo object URL bằng useMemo, thu hồi ở cleanup
  // của effect (không setState trong effect).
  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function setField<K extends keyof FieldValues>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (values.name.trim() === "") errors.name = "Tên sản phẩm là bắt buộc.";
    if (values.slug.trim() === "") errors.slug = "Slug là bắt buộc.";
    const price = parseNumber(values.price);
    if (price === undefined || price === null || price < 0) {
      errors.price = "Giá phải là số ≥ 0.";
    }
    return errors;
  }

  const existingImage = product ? mediaUrl(product.image_url) : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const compareAt = parseNumber(values.compareAtPrice);
    const order = parseNumber(values.displayOrder);
    const input: ProductInput = {
      slug: values.slug.trim(),
      name: values.name.trim(),
      description: nullableText(values.description),
      price: Number(values.price.trim()),
      type: values.type,
      status: values.status,
      // Giữ ảnh hiện tại khi sửa (PUT thay toàn bộ); upload sau sẽ ghi đè nếu có tệp.
      image_url: product?.image_url ?? null,
      badge: nullableText(values.badge),
      compare_at_price: compareAt === undefined ? null : compareAt,
      subtitle: nullableText(values.subtitle),
      display_order: order === undefined ? 0 : (order ?? 0),
    };

    startTransition(async () => {
      const result = isEdit
        ? await updateProduct(product.id, input)
        : await createProduct(input);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }

      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const upload = await uploadProductImage(result.data.id, fd);
        if (!upload.ok) {
          setFormError(
            `Sản phẩm đã lưu nhưng tải ảnh thất bại: ${upload.message}`,
          );
          onSaved();
          return;
        }
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
            {isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Cập nhật thông tin, giá và trạng thái sản phẩm."
              : "Điền thông tin để thêm sản phẩm mới vào bộ sưu tập."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name" className="text-ink">
                Tên sản phẩm <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pf-name"
                value={values.name}
                onChange={(e) => setField("name", e.target.value)}
                disabled={pending}
                aria-invalid={fieldErrors.name ? true : undefined}
                placeholder="Hộp Trăng Vàng"
              />
              {fieldErrors.name && (
                <p className="text-xs text-destructive">{fieldErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-slug" className="text-ink">
                Slug <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pf-slug"
                value={values.slug}
                onChange={(e) => setField("slug", e.target.value)}
                disabled={pending}
                aria-invalid={fieldErrors.slug ? true : undefined}
                placeholder="hop-trang-vang"
              />
              {fieldErrors.slug && (
                <p className="text-xs text-destructive">{fieldErrors.slug}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-subtitle" className="text-ink">
              Phụ đề
            </Label>
            <Input
              id="pf-subtitle"
              value={values.subtitle}
              onChange={(e) => setField("subtitle", e.target.value)}
              disabled={pending}
              placeholder="Hộp thiếc cao cấp"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-description" className="text-ink">
              Mô tả
            </Label>
            <Textarea
              id="pf-description"
              value={values.description}
              onChange={(e) => setField("description", e.target.value)}
              disabled={pending}
              rows={3}
              placeholder="Bộ sưu tập bánh trung thu cao cấp…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-price" className="text-ink">
                Giá (VND) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pf-price"
                type="number"
                min={0}
                inputMode="numeric"
                value={values.price}
                onChange={(e) => setField("price", e.target.value)}
                disabled={pending}
                aria-invalid={fieldErrors.price ? true : undefined}
                placeholder="890000"
              />
              {fieldErrors.price && (
                <p className="text-xs text-destructive">{fieldErrors.price}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-compare" className="text-ink">
                Giá gốc (so sánh)
              </Label>
              <Input
                id="pf-compare"
                type="number"
                min={0}
                inputMode="numeric"
                value={values.compareAtPrice}
                onChange={(e) => setField("compareAtPrice", e.target.value)}
                disabled={pending}
                placeholder="Để trống nếu không giảm giá"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-ink">Loại</Label>
              <Select
                value={values.type}
                onValueChange={(v) => setField("type", v)}
                disabled={pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-ink">Trạng thái</Label>
              <Select
                value={values.status}
                onValueChange={(v) => setField("status", v)}
                disabled={pending}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pf-order" className="text-ink">
                Thứ tự hiển thị
              </Label>
              <Input
                id="pf-order"
                type="number"
                inputMode="numeric"
                value={values.displayOrder}
                onChange={(e) => setField("displayOrder", e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-badge" className="text-ink">
              Nhãn marketing (badge)
            </Label>
            <Input
              id="pf-badge"
              value={values.badge}
              onChange={(e) => setField("badge", e.target.value)}
              disabled={pending}
              placeholder="Bán chạy"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pf-image" className="text-ink">
              Hình ảnh
            </Label>
            <div className="flex items-center gap-4">
              <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-navy-tint">
                {previewUrl ?? existingImage ? (
                  <Image
                    src={(previewUrl ?? existingImage) as string}
                    alt="Xem trước ảnh sản phẩm"
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <ImageIcon className="size-6 text-ink-faint" aria-hidden />
                )}
              </div>
              <div className="space-y-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pending}
                >
                  <Upload aria-hidden />
                  {file ? "Đổi ảnh khác" : "Chọn ảnh"}
                </Button>
                <p className="text-xs text-ink-faint">
                  {file ? file.name : "PNG, JPG hoặc WEBP, tối đa 5MB."}
                </p>
              </div>
              <input
                ref={fileInputRef}
                id="pf-image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
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
