# Giai đoạn 3 — Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mỗi task UI kết thúc bằng vòng lặp screenshot (2 viewport, so mockup) + design-evaluator gate (≥8/10 cả 4 tiêu chí). Task form + interaction thêm qa-evaluator.

**Goal:** Dựng lại trang landing từ `design/mooni-landing.html` bằng Next.js 16 + Tailwind, khớp mockup 1:1, đọc sản phẩm từ `GET /api/v1/products`, form liên hệ đẩy `POST /api/v1/leads` qua `createLead()`.

**Architecture:** Port mockup (HTML inline-style) → React Server Components + vài Client Component cho tương tác (mobile menu, bottom sheet, form). Dùng design tokens Tailwind đã có (GĐ1). Data sản phẩm từ `getProducts()` (GĐ2). Form → `createLead()`. Mockup là NGUỒN CHÂN LÝ — không sáng tác lại, không AI-slop.

**Tech Stack:** Kế thừa web/ GĐ1-2 (Next 16 App Router, Tailwind v4 tokens, lib/api.ts). Playwright cho screenshot (cài ở task đầu). Không thêm UI lib nặng.

## Global Constraints

- Kế thừa Global Constraints GĐ1-2 (tokens navy/gold/cream, font Playfair Display + Be Vietnam Pro, TS strict cấm any, Colima/CGO/port 5440, spec-first).
- **Mockup 1:1**: `design/mooni-landing.html` là chân lý UI. Màu/spacing/typography/section/text tiếng Việt phải khớp. Responsive breakpoints 920px, 720px như mockup. Giữ sticky mobile CTA + bottom sheet liên hệ toàn cục.
- **Không giỏ hàng, không hiện giá cứng**: mọi CTA mở bottom sheet liên hệ (mockup dùng `data-open-contact`). Đây là mô hình lead-form đã chốt.
- **Screenshot loop bắt buộc** mỗi task UI: chụp desktop 1440×900 + mobile 390×844, so với mockup chụp cùng viewport, lưu `docs/reports/screenshots/<ngày>-<task>/`. Generator tự sửa ≤3 vòng rồi design-evaluator chấm độc lập.
- Ảnh sản phẩm: mockup dùng placeholder (image-slot). Dùng placeholder tương đương (ô màu/tỉ lệ đúng) — ảnh thật chủ dự án thêm sau qua admin. KHÔNG chặn.

## File Structure

```
api/cmd/seed/main.go            # + seed products khớp mockup (gift box + bánh lẻ)
web/app/(public)/page.tsx       # landing — compose các section
web/components/landing/         # AnnouncementBar, Header, MobileMenu, Hero, TrustStrip,
                                #   Collection, CorporateGifting, Craft, Flavors,
                                #   Testimonials, ContactCTA, Footer, StickyMobileCTA
web/components/landing/ContactSheet.tsx  # bottom sheet + form (client), gọi createLead
web/lib/format.ts               # helper (nếu cần format text)
```

---

### Task 1: Seed products khớp mockup + cài Playwright

**Trace:** nền REQ-LAND-002 (landing đọc data thật). Không phải UI — không cần screenshot.

**Files:** api/cmd/seed/main.go (+products), web (cài @playwright/test + browsers).

- [ ] **Step 1: Seed products** — thêm vào cmd/seed (idempotent ON CONFLICT slug): 3 gift box (nguyet-quang-kim "Nguyệt Quang Kim", vong-nguyet "Vọng Nguyệt", tho-ngoc "Thỏ Ngọc", type gift_box, mô tả lấy từ mockup) + 3 bánh lẻ (thap-cam-ga-quay, sen-nhuyen-trung, tra-xanh-hat-sen — cái cuối status sold_out như mockup "hết hàng", type single_cake). display_order tăng dần, price đặt hợp lý (vd 0 hoặc giá tham khảo — mockup không hiện giá nên price chỉ lưu nội bộ, landing KHÔNG hiển thị giá). image_url để trống (placeholder).
- [ ] **Step 2: make seed** verify 6 products trong DB (query), gift box + single cake đúng type/status.
- [ ] **Step 3: Cài Playwright** trong web/ (`npm i -D @playwright/test`, `npx playwright install chromium`). Thêm script screenshot tiện dùng.
- [ ] **Step 4: Commit** `chore: seed products mẫu khớp mockup + Playwright`.

---

### Task 2: Landing frame (shell + header + hero + trust + footer + sticky CTA)

**Trace:** REQ-LAND-001 (section frame), REQ-LAND-004 (responsive, sticky CTA). UI → screenshot loop + design-evaluator.

**Files:** web/app/(public)/page.tsx, components/landing/{AnnouncementBar,Header,MobileMenu,Hero,TrustStrip,Footer,StickyMobileCTA}.tsx.

- [ ] **Step 1** Đọc kỹ mockup các section: announcement bar, header (nav desktop + nút mobile menu), hero, trust strip, footer, sticky mobile CTA. Ghi lại màu/text/spacing chính xác.
- [ ] **Step 2** Port từng section thành component, dùng Tailwind tokens (không hardcode hex ngoài token). MobileMenu + StickyMobileCTA là client component (toggle). Text tiếng Việt copy đúng mockup.
- [ ] **Step 3** Responsive: breakpoints 920/720 khớp mockup (r-hide-mobile, r-show-mobile...).
- [ ] **Step 4** Screenshot loop: chụp impl + mockup ở 1440×900 và 390×844, tự so, sửa ≤3 vòng.
- [ ] **Step 5** build + tsc + lint xanh.
- [ ] **Step 6** Commit `feat(web): landing frame — header, hero, trust, footer, sticky CTA`.
- [ ] **GATE**: design-evaluator (≥8/10 cả 4 tiêu chí vs mockup).

---

### Task 3: Product & content sections (collection + corporate + craft + flavors + testimonials)

**Trace:** REQ-LAND-001 (các section), REQ-LAND-002 (collection + flavors đọc GET /products). UI → screenshot loop + design-evaluator.

**Files:** components/landing/{Collection,CorporateGifting,Craft,Flavors,Testimonials}.tsx, page.tsx wire getProducts().

- [ ] **Step 1** Collection: 3 gift box từ `getProducts()` (filter type gift_box), render đúng layout mockup (tên, mô tả, badge, nút mở contact). Flavors: single_cake từ API, hiện badge "hết hàng" khi status sold_out.
- [ ] **Step 2** CorporateGifting, Craft/Story, Testimonials: port tĩnh từ mockup (text đúng).
- [ ] **Step 3** Server Component đọc products (fetch tại render). Xử lý API lỗi/trống gracefully (không vỡ trang).
- [ ] **Step 4** Screenshot loop 2 viewport so mockup, sửa ≤3 vòng.
- [ ] **Step 5** build/tsc/lint xanh.
- [ ] **Step 6** Commit `feat(web): landing product & content sections (wire GET /products)`.
- [ ] **GATE**: design-evaluator ≥8/10.

---

### Task 4: Contact bottom sheet + form → POST /leads (interactive)

**Trace:** REQ-LAND-003 (form → POST /leads), REQ-LAND-004 (bottom sheet toàn cục). UI + FUNCTIONAL → screenshot loop + design-evaluator + qa-evaluator (held-out).

**Held-out (qa-evaluator viết trước):** bottom sheet mở khi bấm nút data-open-contact; đóng bằng nút X / backdrop / phím Escape; submit form hợp lệ → gọi POST /leads → hiện thông báo thành công; SĐT sai → hiện lỗi validation (không submit hoặc nhận 400); nhận 429 → hiện thông báo "thử lại sau"; form giữ đúng field (tên, SĐT, sản phẩm quan tâm, lời nhắn) khớp mockup.

**Files:** components/landing/ContactSheet.tsx (client), wire các nút data-open-contact toàn trang.

- [ ] **Step 1** Port bottom sheet + form từ mockup (field: tên, SĐT tel, select sản phẩm quan tâm — options từ getProducts hoặc tĩnh, textarea lời nhắn). Client component, state mở/đóng.
- [ ] **Step 2** Tương tác: nút data-open-contact mở sheet; đóng bằng X / click backdrop / Escape (khớp mockup script).
- [ ] **Step 3** Submit → `createLead()`. Trạng thái: đang gửi (disable nút), thành công (thông báo cảm ơn), lỗi 400 (hiện field lỗi), 429 (thông báo thử lại sau). Không mất dữ liệu form khi lỗi.
- [ ] **Step 4** Test client (vitest/RTL nếu hợp) + screenshot sheet mở (desktop+mobile).
- [ ] **Step 5** build/tsc/lint xanh; chạy app thật + Playwright kịch bản: mở sheet → điền → submit → 201 (kiểm lead vào DB).
- [ ] **Step 6** Commit `feat(web): contact bottom sheet + form POST /leads`.
- [ ] **GATE**: qa-evaluator (held-out: mở/đóng/submit/validation/429) + design-evaluator (≥8/10).

---

## Self-Review

**Trace:** REQ-LAND-001→T2+T3, REQ-LAND-002→T3 (+seed T1), REQ-LAND-003→T4, REQ-LAND-004→T2+T4. NFR-010 (design-evaluator ≥8/10) áp mỗi task UI.
**Ngoài phạm vi GĐ3:** admin (GĐ4-5), auth, orders/customers, deploy (GĐ6). Landing chỉ đọc products + đẩy leads — đã đủ API từ GĐ2.
**Placeholder scan:** ảnh sản phẩm placeholder là chủ đích (ảnh thật thêm sau qua admin) — không phải TODO chưa định nghĩa.
**Rủi ro:** port mockup 1:1 là phần dễ lệch nhất — screenshot loop + design-evaluator là gate chính. Nếu design-evaluator rớt 3 lần liên tiếp một task → circuit breaker, báo chủ dự án kèm screenshot để quyết.
