import { listProducts, type AdminProduct } from "@/app/actions/admin";
import { ProductsManager } from "@/components/admin/products-manager";

/** Danh sách sản phẩm admin phải tươi mỗi lần vào (gồm cả hidden). */
export const dynamic = "force-dynamic";

/**
 * Trang quản lý sản phẩm (REQ-PROD-002/003). Server Component: nạp TẤT CẢ sản
 * phẩm (gồm `hidden`) qua Server Action rồi trao cho `ProductsManager` (client)
 * để render bảng + dialog form tạo/sửa + upload ảnh.
 */
export default async function AdminProductsPage() {
  let products: AdminProduct[] = [];
  let loadError = false;
  try {
    products = await listProducts();
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">
          Sản phẩm
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Quản lý bộ sưu tập bánh trung thu — giá, trạng thái, hình ảnh.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-ink-muted">
          Không tải được danh sách sản phẩm. Vui lòng thử lại sau.
        </div>
      ) : (
        <ProductsManager initialProducts={products} />
      )}
    </div>
  );
}
