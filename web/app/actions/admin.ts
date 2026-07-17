"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { components } from "@/types/api";
import { API_BASE, ApiError } from "@/lib/api";
import { ADMIN_COOKIE, adminFetch } from "@/lib/admin-api";

/** 3 chỉ số tổng quan dashboard (schema `Dashboard` sinh từ OpenAPI). */
export type Dashboard = components["schemas"]["Dashboard"];

/** Sản phẩm admin (gồm cả `hidden`) — schema `Product` sinh từ OpenAPI. */
export type AdminProduct = components["schemas"]["Product"];
/** Payload tạo/sửa sản phẩm — schema `ProductInput` sinh từ OpenAPI. */
export type ProductInput = components["schemas"]["ProductInput"];
/** Kết quả upload ảnh — schema `ImageUploadResult` sinh từ OpenAPI. */
export type ImageUploadResult = components["schemas"]["ImageUploadResult"];

/** Một lead — schema `Lead` sinh từ OpenAPI. */
export type Lead = components["schemas"]["Lead"];
/** Danh sách leads phân trang — schema `LeadList` sinh từ OpenAPI. */
export type LeadList = components["schemas"]["LeadList"];
/** Kết quả convert lead → đơn — schema `ConvertLeadResult` sinh từ OpenAPI. */
export type ConvertLeadResult = components["schemas"]["ConvertLeadResult"];

/** Một đơn hàng (bảng list) — schema `Order` sinh từ OpenAPI. */
export type Order = components["schemas"]["Order"];
/** Danh sách đơn phân trang — schema `OrderList` sinh từ OpenAPI. */
export type OrderList = components["schemas"]["OrderList"];
/** Chi tiết đơn + items snapshot — schema `OrderDetail` sinh từ OpenAPI. */
export type OrderDetail = components["schemas"]["OrderDetail"];
/** Payload tạo đơn — schema `OrderInput` sinh từ OpenAPI. */
export type OrderInput = components["schemas"]["OrderInput"];
/** Kết quả tạo đơn `{id, code}` — schema `OrderCreated` sinh từ OpenAPI. */
export type OrderCreated = components["schemas"]["OrderCreated"];

/** Một khách hàng — schema `Customer` sinh từ OpenAPI. */
export type Customer = components["schemas"]["Customer"];
/** Danh sách khách hàng phân trang — schema `CustomerList` sinh từ OpenAPI. */
export type CustomerList = components["schemas"]["CustomerList"];
/** Payload tạo/sửa khách hàng — schema `CustomerInput` sinh từ OpenAPI. */
export type CustomerInput = components["schemas"]["CustomerInput"];

/**
 * Kết quả một thao tác ghi (tạo/sửa/upload). `ok:false` mang `message` lấy từ
 * body `{error}` của API (400 dữ liệu sai, 409 slug trùng…) để form hiện lỗi.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/** Chuyển lỗi bất kỳ (thường `ApiError`) thành `ActionResult` thất bại. */
function toFailure(err: unknown): { ok: false; message: string } {
  if (err instanceof ApiError) return { ok: false, message: err.message };
  return { ok: false, message: "Đã có lỗi xảy ra, vui lòng thử lại." };
}

/** Làm mới cache trang admin sản phẩm + landing (ảnh hưởng danh sách public). */
function revalidateProducts(): void {
  revalidatePath("/admin/products");
  revalidatePath("/");
}

/** Kết quả đăng nhập trả về client (LoginForm) để hiện lỗi khi thất bại. */
export type LoginResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Đọc giá trị cookie `mc_admin` từ (các) header Set-Cookie mà API trả về khi
 * đăng nhập thành công. `getSetCookie()` (undici) trả mảng từng Set-Cookie riêng.
 * Trả `{ value, maxAge }` — maxAge để mirror tuổi phiên của API vào cookie Next.
 */
function parseSessionCookie(
  headers: Headers,
): { value: string; maxAge?: number } | null {
  const setCookies = headers.getSetCookie();
  for (const raw of setCookies) {
    const parts = raw.split(";");
    const first = parts[0]?.trim() ?? "";
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    if (name !== ADMIN_COOKIE) continue;

    const value = first.slice(eq + 1).trim();
    let maxAge: number | undefined;
    for (const attr of parts.slice(1)) {
      const [k, v] = attr.split("=");
      if (k?.trim().toLowerCase() === "max-age" && v) {
        const n = Number.parseInt(v.trim(), 10);
        if (Number.isFinite(n)) maxAge = n;
      }
    }
    return { value, maxAge };
  }
  return null;
}

/**
 * Đăng nhập admin. Gọi POST {API}/auth/login server-to-server; nếu 200 → LẤY
 * cookie `mc_admin` từ Set-Cookie của API rồi SET vào cookie của Next (httpOnly,
 * path /) để browser giữ phiên. 401 → trả lỗi. Browser không gọi trực tiếp API
 * nên Server Action phải chuyển tiếp cookie API set sang response Next.
 */
export async function loginAction(
  email: string,
  password: string,
): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "Không kết nối được máy chủ, vui lòng thử lại." };
  }

  if (response.status === 200) {
    const session = parseSessionCookie(response.headers);
    if (!session) {
      return {
        ok: false,
        message: "Đăng nhập thất bại: máy chủ không trả phiên. Thử lại sau.",
      };
    }
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_COOKIE, session.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      ...(session.maxAge !== undefined ? { maxAge: session.maxAge } : {}),
    });
    return { ok: true };
  }

  if (response.status === 401) {
    return { ok: false, message: "Email hoặc mật khẩu không đúng." };
  }

  // Lỗi khác (400/500…): lấy message từ body {error} nếu có.
  let message = "Đăng nhập thất bại, vui lòng thử lại.";
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      message = (body as { error: string }).error;
    }
  } catch {
    // giữ message mặc định
  }
  return { ok: false, message };
}

/**
 * Đăng xuất admin. Báo API xóa phiên (best-effort) rồi xóa cookie `mc_admin`
 * phía Next để proxy.ts chặn lại /admin.
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      headers: token ? { Cookie: `${ADMIN_COOKIE}=${token}` } : undefined,
      cache: "no-store",
    });
  } catch {
    // Kể cả API lỗi vẫn xóa cookie local để đăng xuất chắc chắn.
  }
  cookieStore.delete(ADMIN_COOKIE);
}

/**
 * Lấy 3 chỉ số dashboard. Gọi GET {API}/admin/dashboard kèm cookie `mc_admin`
 * (adminFetch tự forward). Ném `ApiError` (401 = phiên hỏng) để caller xử lý.
 */
export async function getDashboard(): Promise<Dashboard> {
  return adminFetch<Dashboard>("/admin/dashboard");
}

/**
 * Danh sách TẤT CẢ sản phẩm (gồm `hidden`) cho bảng quản trị. Gọi GET
 * {API}/admin/products kèm cookie phiên. Ném `ApiError` (401) để caller xử lý.
 */
export async function listProducts(): Promise<AdminProduct[]> {
  return adminFetch<AdminProduct[]>("/admin/products");
}

/**
 * Tạo sản phẩm mới. POST {API}/admin/products. 201 → trả sản phẩm; 400/409 →
 * `ok:false` kèm message (vd slug trùng). Revalidate list + landing khi thành công.
 */
export async function createProduct(
  input: ProductInput,
): Promise<ActionResult<AdminProduct>> {
  try {
    const data = await adminFetch<AdminProduct>("/admin/products", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidateProducts();
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Cập nhật sản phẩm. PUT {API}/admin/products/{id}. 200 → trả bản mới; 400/404/409
 * → `ok:false` kèm message.
 */
export async function updateProduct(
  id: string,
  input: ProductInput,
): Promise<ActionResult<AdminProduct>> {
  try {
    const data = await adminFetch<AdminProduct>(
      `/admin/products/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) },
    );
    revalidateProducts();
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Xóa (soft delete → status `hidden`) sản phẩm. DELETE {API}/admin/products/{id}.
 * API trả 204 không body → không parse JSON; gọi fetch trực tiếp (forward cookie).
 */
export async function deleteProduct(
  id: string,
): Promise<ActionResult<null>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/admin/products/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: token ? { Cookie: `${ADMIN_COOKIE}=${token}` } : undefined,
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, message: "Không kết nối được máy chủ, vui lòng thử lại." };
  }
  if (response.status === 204) {
    revalidateProducts();
    return { ok: true, data: null };
  }
  let message = `Xóa thất bại (status ${response.status}).`;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      message = (body as { error: string }).error;
    }
  } catch {
    // giữ message mặc định
  }
  return { ok: false, message };
}

/**
 * Upload ảnh cho sản phẩm. POST {API}/admin/products/{id}/image dạng multipart
 * (field `file`). KHÔNG đặt Content-Type thủ công — để fetch tự sinh boundary từ
 * FormData; adminFetch không dùng được vì nó ép `application/json`.
 */
export async function uploadProductImage(
  id: string,
  formData: FormData,
): Promise<ActionResult<ImageUploadResult>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Chưa chọn tệp ảnh." };
  }
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/admin/products/${encodeURIComponent(id)}/image`,
      {
        method: "POST",
        headers: token ? { Cookie: `${ADMIN_COOKIE}=${token}` } : undefined,
        body: formData,
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, message: "Không kết nối được máy chủ, vui lòng thử lại." };
  }
  if (response.status === 200) {
    const data = (await response.json()) as ImageUploadResult;
    revalidateProducts();
    return { ok: true, data };
  }
  let message = `Upload ảnh thất bại (status ${response.status}).`;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
    ) {
      message = (body as { error: string }).error;
    }
  } catch {
    // giữ message mặc định
  }
  return { ok: false, message };
}

/** Làm mới cache trang admin leads sau khi đổi status / convert. */
function revalidateLeads(): void {
  revalidatePath("/admin/leads");
}

/**
 * Danh sách leads phân trang cho bảng quản trị (mới nhất trước). Gọi GET
 * {API}/admin/leads?limit&offset kèm cookie phiên. Trả `{items, total}`. Ném
 * `ApiError` (401) để caller xử lý.
 */
export async function listLeads(
  limit: number,
  offset: number,
): Promise<LeadList> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return adminFetch<LeadList>(`/admin/leads?${params.toString()}`);
}

/**
 * Đổi trạng thái lead. PATCH {API}/admin/leads/{id} body `{status}`. 200 → trả
 * lead mới; 400 (status sai) / 404 → `ok:false` kèm message. Revalidate list.
 */
export async function updateLeadStatus(
  id: string,
  status: string,
): Promise<ActionResult<Lead>> {
  try {
    const data = await adminFetch<Lead>(
      `/admin/leads/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    revalidateLeads();
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Convert lead thành đơn nháp. POST {API}/admin/leads/{id}/convert (không body).
 * 201 → trả `{order_id, order_code}` (lead thành `converted`); 404 → không tìm
 * thấy; 409 → đã convert trước đó. Revalidate list để lead hiện trạng thái mới.
 */
export async function convertLead(
  id: string,
): Promise<ActionResult<ConvertLeadResult>> {
  try {
    const data = await adminFetch<ConvertLeadResult>(
      `/admin/leads/${encodeURIComponent(id)}/convert`,
      { method: "POST" },
    );
    revalidateLeads();
    revalidatePath("/admin/orders");
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/** Làm mới cache trang admin đơn hàng sau khi tạo/đổi status. */
function revalidateOrders(): void {
  revalidatePath("/admin/orders");
}

/**
 * Danh sách đơn hàng phân trang cho bảng quản trị (mới nhất trước). Gọi GET
 * {API}/admin/orders?limit&offset kèm cookie phiên. Trả `{items, total}`. Ném
 * `ApiError` (401) để caller xử lý.
 */
export async function listOrders(
  limit: number,
  offset: number,
): Promise<OrderList> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return adminFetch<OrderList>(`/admin/orders?${params.toString()}`);
}

/**
 * Chi tiết một đơn (gồm items snapshot). Gọi GET {API}/admin/orders/{id} kèm
 * cookie phiên. Ném `ApiError` (401/404) để caller xử lý.
 */
export async function getOrder(id: string): Promise<OrderDetail> {
  return adminFetch<OrderDetail>(`/admin/orders/${encodeURIComponent(id)}`);
}

/**
 * Tạo đơn hàng (nhập tay, nhiều dòng món). POST {API}/admin/orders. 201 → trả
 * `{id, code}`; 400 (dữ liệu sai: không dòng món, sản phẩm không tồn tại, giảm
 * giá vượt tổng…) → `ok:false` kèm message. Revalidate list khi thành công.
 */
export async function createOrder(
  input: OrderInput,
): Promise<ActionResult<OrderCreated>> {
  try {
    const data = await adminFetch<OrderCreated>("/admin/orders", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidateOrders();
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Đổi trạng thái đơn. PATCH {API}/admin/orders/{id} body `{status}`. 200 → trả
 * đơn mới; 400 (status sai / đơn đã kết thúc) / 404 → `ok:false` kèm message.
 * Revalidate list để bảng hiện trạng thái mới.
 */
export async function updateOrderStatus(
  id: string,
  status: string,
): Promise<ActionResult<Order>> {
  try {
    const data = await adminFetch<Order>(
      `/admin/orders/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    );
    revalidateOrders();
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Danh sách khách hàng phân trang. Gọi GET {API}/admin/customers?limit&offset
 * kèm cookie phiên. Trả `{items, total}`. Ném `ApiError` (401) để caller xử lý.
 */
export async function listCustomers(
  limit: number,
  offset: number,
): Promise<CustomerList> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return adminFetch<CustomerList>(`/admin/customers?${params.toString()}`);
}

/**
 * Lấy TẤT CẢ khách hàng cho picker chọn khách khi tạo đơn (tối đa 100 — API kẹp
 * limit về 100). Trả mảng `Customer[]`. Ném `ApiError` để caller xử lý.
 */
export async function listCustomersForPicker(): Promise<Customer[]> {
  const data = await listCustomers(100, 0);
  return data.items;
}

/** Làm mới cache trang admin khách hàng sau khi tạo/sửa. */
function revalidateCustomers(): void {
  revalidatePath("/admin/customers");
}

/**
 * Chi tiết một khách hàng. Gọi GET {API}/admin/customers/{id} kèm cookie phiên.
 * Ném `ApiError` (401/404) để caller xử lý.
 */
export async function getCustomer(id: string): Promise<Customer> {
  return adminFetch<Customer>(`/admin/customers/${encodeURIComponent(id)}`);
}

/**
 * Tạo khách hàng mới. POST {API}/admin/customers. 201 → trả khách; 400 (tên rỗng,
 * SĐT/email sai định dạng, type sai enum) → `ok:false` kèm message. Revalidate list.
 */
export async function createCustomer(
  input: CustomerInput,
): Promise<ActionResult<Customer>> {
  try {
    const data = await adminFetch<Customer>("/admin/customers", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidateCustomers();
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Cập nhật khách hàng. PUT {API}/admin/customers/{id}. 200 → trả bản mới; 400/404
 * → `ok:false` kèm message. Revalidate list khi thành công.
 */
export async function updateCustomer(
  id: string,
  input: CustomerInput,
): Promise<ActionResult<Customer>> {
  try {
    const data = await adminFetch<Customer>(
      `/admin/customers/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) },
    );
    revalidateCustomers();
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/** Re-export cho caller phân biệt lỗi theo status khi cần. */
export { ApiError };
