import {
  listOrders,
  listProducts,
  listCustomersForPicker,
  type OrderList,
  type AdminProduct,
  type Customer,
} from "@/app/actions/admin";
import { OrdersManager } from "@/components/admin/orders-manager";

/** Danh sách đơn phải tươi mỗi lần vào — không cache tĩnh. */
export const dynamic = "force-dynamic";

/** Số đơn mỗi trang. */
const PAGE_SIZE = 20;

/** Chuẩn hóa 1 giá trị searchParams (string | string[]) về số nguyên ≥ 0. */
function parseOffset(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Trang quản lý đơn hàng (REQ-ORD-001/002). Server Component: nạp trang đơn hiện
 * tại (limit/offset qua searchParams — Next 16 searchParams là async) cùng danh
 * sách sản phẩm (để chọn món) và khách hàng (để gắn khách, tùy chọn), rồi trao
 * cho `OrdersManager` (client) để render bảng + form tạo đơn + chi tiết + status.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const offset = parseOffset(params.offset);

  let data: OrderList | null = null;
  try {
    data = await listOrders(PAGE_SIZE, offset);
  } catch {
    data = null;
  }

  // Sản phẩm để chọn dòng món (ẩn sản phẩm `hidden` khỏi picker) + khách để gắn.
  let products: AdminProduct[] = [];
  let customers: Customer[] = [];
  try {
    products = (await listProducts()).filter((p) => p.status !== "hidden");
  } catch {
    products = [];
  }
  try {
    customers = await listCustomersForPicker();
  } catch {
    customers = [];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">
          Đơn hàng
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Tạo đơn nhập tay nhiều dòng món, xem chi tiết và cập nhật trạng thái
          giao hàng.
        </p>
      </div>

      {data === null ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-ink-muted">
          Không tải được danh sách đơn hàng. Vui lòng thử lại sau.
        </div>
      ) : (
        <OrdersManager
          orders={data.items}
          total={data.total}
          offset={offset}
          pageSize={PAGE_SIZE}
          products={products}
          customers={customers}
        />
      )}
    </div>
  );
}
