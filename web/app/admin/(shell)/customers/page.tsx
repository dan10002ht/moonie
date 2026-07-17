import { listCustomers, type CustomerList } from "@/app/actions/admin";
import { CustomersManager } from "@/components/admin/customers-manager";

/** Danh sách khách hàng phải tươi mỗi lần vào — không cache tĩnh. */
export const dynamic = "force-dynamic";

/** Số khách mỗi trang. */
const PAGE_SIZE = 20;

/** Chuẩn hóa 1 giá trị searchParams (string | string[]) về số nguyên ≥ 0. */
function parseOffset(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Trang quản lý khách hàng (REQ-CUST-001). Server Component: nạp trang khách
 * hiện tại (limit/offset qua searchParams — Next 16 searchParams là async) rồi
 * trao cho `CustomersManager` (client) để render bảng + form tạo/sửa + phân trang.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const offset = parseOffset(params.offset);

  let data: CustomerList | null = null;
  try {
    data = await listCustomers(PAGE_SIZE, offset);
  } catch {
    data = null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">
          Khách hàng
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Danh bạ khách hàng — lưu thông tin liên hệ để gọi lại và lên đơn nhanh.
        </p>
      </div>

      {data === null ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-ink-muted">
          Không tải được danh sách khách hàng. Vui lòng thử lại sau.
        </div>
      ) : (
        <CustomersManager
          customers={data.items}
          total={data.total}
          offset={offset}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
