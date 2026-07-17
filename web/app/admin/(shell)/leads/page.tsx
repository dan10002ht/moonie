import { listLeads, type LeadList } from "@/app/actions/admin";
import { LeadsManager } from "@/components/admin/leads-manager";

/** Danh sách leads phải tươi mỗi lần vào — không cache tĩnh. */
export const dynamic = "force-dynamic";

/** Số lead mỗi trang. */
const PAGE_SIZE = 20;

/** Chuẩn hóa 1 giá trị searchParams (string | string[]) về số nguyên ≥ 0. */
function parseOffset(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Trang quản lý leads (REQ-LEAD-004/005). Server Component: nạp trang leads hiện
 * tại (limit/offset qua searchParams — Next 16 searchParams là async) rồi trao
 * cho `LeadsManager` (client) để render bảng + đổi status + convert + phân trang.
 */
export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const offset = parseOffset(params.offset);

  let data: LeadList | null = null;
  try {
    data = await listLeads(PAGE_SIZE, offset);
  } catch {
    data = null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">Leads</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Khách để lại thông tin từ website — gọi lại, cập nhật trạng thái và
          chuyển thành đơn hàng.
        </p>
      </div>

      {data === null ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-ink-muted">
          Không tải được danh sách leads. Vui lòng thử lại sau.
        </div>
      ) : (
        <LeadsManager
          leads={data.items}
          total={data.total}
          offset={offset}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
