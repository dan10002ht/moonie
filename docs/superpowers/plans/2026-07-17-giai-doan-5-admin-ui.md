# Giai đoạn 5 — Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mỗi task UI: screenshot loop (desktop + mobile) + design-evaluator (chất lượng + nhất quán tokens Mooni, KHÔNG so mockup landing — admin không có mockup full, chấm theo design-system + shadcn + usability). Task có form/tương tác thêm qa-evaluator (held-out interaction).

**Goal:** Giao diện admin (Next.js + shadcn/ui theo tokens Mooni) để chủ shop đăng nhập và quản lý sản phẩm/leads/đơn hàng/khách hàng + xem dashboard — dùng API admin đã có ở GĐ4. (REQ-ADM-001, NFR-011: chủ tự vận hành không cần developer.)

**Architecture:** Route group `web/app/admin/*` (đã có proxy.ts guard từ GĐ4). Đăng nhập tại `/admin/login`. shadcn/ui cấu hình theo design tokens Mooni (navy/gold/cream, Playfair heading / Be Vietnam Pro body — KHÔNG giữ theme shadcn mặc định đen trắng). Gọi API admin qua Server Actions / route handlers (server-to-server, cookie mc_admin forward — tránh CORS như GĐ3). Data fetch qua các client function typed từ openapi-typescript (regenerate: spec đã có mọi endpoint admin).

**Tech Stack:** Kế thừa web/ (Next 16, Tailwind v4 tokens, lib/api.ts). Thêm: shadcn/ui (components table, dialog, form, input, select, button, card, badge, toast). Playwright cho screenshot/interaction.

## Global Constraints

- Kế thừa Global Constraints GĐ1-4 (tokens, font, TS strict cấm any, Colima, spec-first — admin gọi API dưới /api/v1/admin đã có).
- **Tokens Mooni, KHÔNG theme shadcn mặc định**: navy #041E4F (primary), gold #C6A867 (accent), cream #F7F6F4 (bg), ink #22201B. Heading Playfair Display, body Be Vietnam Pro. Admin trông sang trọng đồng bộ landing, không phải dashboard generic tím-xám.
- **Auth flow**: /admin/login (form → POST /api/v1/auth/login → cookie httpOnly do API set → redirect /admin). proxy.ts (GĐ1/4) chặn /admin/* không cookie → /admin/login. Nút đăng xuất → POST /auth/logout → /admin/login. Submit qua Server Action (server-to-server, forward cookie) tránh CORS.
- **Phân trang UI**: leads/orders/customers list có phân trang (API trả {items,total}) — nút trước/sau hoặc số trang, hiện tổng.
- **Không hiện dữ liệu nhạy cảm thừa**: SĐT khách hiện đầy đủ trong admin (chủ cần gọi) — đúng nghiệp vụ; nhưng không log ra console.
- **Screenshot loop** mỗi task UI: chụp desktop 1440×900 + mobile 390×844 (admin ưu tiên desktop nhưng phải dùng được mobile), lưu docs/reports/screenshots/. design-evaluator chấm ≥8/10 (design/craft/nhất quán tokens/functionality — originality không áp cứng cho admin CRUD, thay bằng "usability").
- Ảnh sản phẩm: upload thật qua form (API upload đã có). Placeholder khi chưa có ảnh.

## File Structure

```
web/app/admin/login/page.tsx        # trang đăng nhập
web/app/admin/layout.tsx            # shell: sidebar nav + header + đăng xuất (chỉ áp /admin trừ /admin/login)
web/app/admin/page.tsx              # dashboard (3 stat card)
web/app/admin/products/page.tsx     # quản lý sản phẩm
web/app/admin/leads/page.tsx        # quản lý leads
web/app/admin/orders/page.tsx       # quản lý đơn hàng
web/app/admin/customers/page.tsx    # quản lý khách hàng
web/app/actions/admin.ts            # Server Actions gọi API admin (forward cookie)
web/components/ui/*                 # shadcn components (theo tokens)
web/lib/admin-api.ts                # typed client admin (từ openapi-typescript)
```

---

### Task 1: shadcn setup + admin shell + login + dashboard

**Trace:** REQ-ADM-001, REQ-AUTH-004 (guard), REQ-DASH-001 (dashboard UI). UI + auth flow → screenshot + design-evaluator + qa-evaluator (đăng nhập).

**Held-out (qa-evaluator):** vào /admin khi chưa đăng nhập → redirect /admin/login; login sai → hiện lỗi; login đúng (admin@mooni.local/mooni-admin) → vào /admin thấy dashboard 3 số; đăng xuất → về /admin/login; /admin/login khi đã đăng nhập → vào thẳng /admin.

- [ ] Cài + cấu hình shadcn/ui theo tokens Mooni (components.json, CSS vars map sang navy/gold/cream; KHÔNG để mặc định). Regenerate openapi-typescript (spec có endpoint admin).
- [ ] web/app/actions/admin.ts: Server Actions login/logout + fetch dashboard (forward cookie mc_admin server-to-server).
- [ ] /admin/login: form email+password (shadcn), submit → login action → redirect /admin; lỗi → hiện message.
- [ ] /admin/layout.tsx: shell sidebar (Dashboard/Sản phẩm/Leads/Đơn hàng/Khách hàng) + header (tên shop + đăng xuất). Áp cho /admin/* trừ /admin/login.
- [ ] /admin/page.tsx: 3 stat card (leads mới, đơn xử lý, doanh thu tháng — format VND) từ GET /admin/dashboard.
- [ ] Screenshot loop + build/tsc/lint xanh.
- [ ] GATE: qa-evaluator (held-out auth flow) + design-evaluator (shell + login + dashboard đúng tokens Mooni).
- [ ] Commit `feat(web): admin shell + login + dashboard`.

---

### Task 2: Quản lý sản phẩm (table + form + upload ảnh)

**Trace:** REQ-PROD-002/003 (UI). UI + form → screenshot + design-evaluator + qa-evaluator.

**Held-out:** list hiện cả sản phẩm hidden; tạo sản phẩm mới qua form → xuất hiện trong list + landing; sửa (giá/status/badge) → cập nhật; upload ảnh → ảnh hiện; xóa → ẩn khỏi landing.

- [ ] /admin/products: table (shadcn) list tất cả (getAdminProducts) — tên, loại, giá, trạng thái, badge, ảnh thumbnail. Nút thêm/sửa/xóa.
- [ ] Dialog form tạo/sửa: slug, tên, mô tả, giá, compare_at_price, loại, trạng thái, subtitle, badge, display_order. Validate client + hiện lỗi API. Upload ảnh (input file → POST image).
- [ ] Server Actions cho CRUD + upload (forward cookie).
- [ ] Screenshot + build/tsc/lint. GATE: qa-evaluator (held-out CRUD+upload) + design-evaluator.
- [ ] Commit `feat(web): admin quản lý sản phẩm + upload ảnh`.

---

### Task 3: Quản lý leads (table + status + convert)

**Trace:** REQ-LEAD-004/005 (UI). UI + tương tác.

**Held-out:** list leads phân trang mới-nhất-trước; đổi status (dropdown) → cập nhật; nút "Convert thành đơn" → tạo đơn nháp, lead chuyển converted, điều hướng tới đơn vừa tạo; hiện SĐT/lời nhắn khách.

- [ ] /admin/leads: table phân trang (getAdminLeads {items,total}) — tên, SĐT, sản phẩm quan tâm, lời nhắn, nguồn, status, ngày. Dropdown đổi status. Nút Convert (disable nếu đã converted).
- [ ] Server Actions status/convert.
- [ ] Phân trang UI (trước/sau + tổng).
- [ ] Screenshot + build/tsc/lint. GATE: qa-evaluator + design-evaluator.
- [ ] Commit `feat(web): admin quản lý leads + convert`.

---

### Task 4: Quản lý đơn hàng (table + tạo đơn + chi tiết + status)

**Trace:** REQ-ORD-001/002 (UI). UI + form phức tạp nhất.

**Held-out:** list đơn phân trang; tạo đơn qua form (chọn kênh, khách optional, thêm dòng món: chọn sản phẩm + số lượng, giảm giá) → 201, tổng tính đúng; xem chi tiết đơn (món + snapshot giá); đổi status; đơn done/cancelled không đổi được.

- [ ] /admin/orders: table phân trang (mã, khách/note, kênh, status, tổng, ngày). 
- [ ] Form tạo đơn: chọn channel, customer (optional dropdown từ customers), thêm/bớt dòng món (product picker + quantity), discount → hiện tổng tạm tính. Submit → createOrder.
- [ ] Trang/dialog chi tiết đơn: thông tin + danh sách món (snapshot) + đổi status (dropdown, chặn terminal).
- [ ] Server Actions create/list/detail/status.
- [ ] Screenshot + build/tsc/lint. GATE: qa-evaluator (held-out tạo đơn + tính tổng + status) + design-evaluator.
- [ ] Commit `feat(web): admin quản lý đơn hàng (tạo + chi tiết + status)`.

---

### Task 5: Quản lý khách hàng (table + form)

**Trace:** REQ-CUST-001 (UI). UI + form.

**Held-out:** list khách phân trang; tạo/sửa khách qua form (validate type/email/phone); hiện SĐT/email đầy đủ.

- [ ] /admin/customers: table phân trang (tên, SĐT, email, công ty, loại). Nút thêm/sửa.
- [ ] Dialog form: tên, SĐT, email, công ty, địa chỉ, loại (personal/business), ghi chú. Validate + lỗi API.
- [ ] Server Actions CRUD.
- [ ] Screenshot + build/tsc/lint. GATE: qa-evaluator + design-evaluator.
- [ ] Commit `feat(web): admin quản lý khách hàng`.

---

## Self-Review

**Trace:** REQ-ADM-001→tất cả task; REQ-DASH-001 UI→T1; REQ-PROD-002/003 UI→T2; REQ-LEAD-004/005 UI→T3; REQ-ORD UI→T4; REQ-CUST-001 UI→T5; REQ-AUTH-004 guard→T1; NFR-011 (chủ tự vận hành)→toàn bộ.
**Ngoài phạm vi GĐ5:** deploy/HTTPS/backup + security deploy-gate (GĐ6). low_stock status: nếu làm thì thêm ở T2 (thêm 'low_stock' vào enum + UI + landing render amber) — cân nhắc, không bắt buộc.
**Rủi ro:** admin không có mockup full → design-evaluator chấm theo nhất quán tokens + design-system components + usability, không pixel-match. Auth flow qua Server Action + proxy.ts là chỗ dễ sai (cookie forward, redirect loop) — held-out auth flow là gate chính T1.
**Lưu ý:** CORS — admin UI gọi API qua Server Action server-to-server (như GĐ3 form), forward cookie mc_admin. KHÔNG gọi trực tiếp browser→API (CORS + lộ). Vấn đề rate-limit real-IP sau proxy vẫn thuộc GĐ6.
