# 01 — BRD: Business Requirements Document — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `51d60a1`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> Nguồn chính: `docs/superpowers/specs/2026-07-17-mooni-website-design.md` (spec đã duyệt), `docs/PROGRESS.md`, `CLAUDE.md`.

## 1. Bối cảnh kinh doanh

Mooni Cake là thương hiệu bánh trung thu cao cấp, định vị **quà biếu** cho hai nhóm khách: cá nhân và doanh nghiệp (spec §1). Dự án xây website giới thiệu sản phẩm và tiếp nhận đặt hàng, kèm trang quản trị nội bộ để chủ dự án tự vận hành bán hàng.

Ràng buộc mùa vụ: Trung thu 2026 rơi vào khoảng cuối tháng 9 — website cần sẵn sàng **trước tháng 8/2026** để kịp mùa bán (PROGRESS.md, mục "Ghi chú cho session sau").

## 2. Mục tiêu

1. Trang landing public giới thiệu bộ sưu tập hộp quà và bánh lẻ, dựng 1:1 từ mockup đã duyệt (`design/mooni-landing.html`).
2. Tiếp nhận nhu cầu đặt hàng qua **lead form**; chủ dự án nhận thông báo Telegram tức thì.
3. Trang admin để chủ dự án tự quản lý: đơn hàng, leads, sản phẩm & tồn kho, khách hàng, dashboard doanh thu — **không cần developer** trong vận hành hàng ngày (spec §9).
4. Toàn bộ chạy trên 1 VPS, HTTPS, backup tự động (spec §9).

## 3. Phạm vi

### 3.1 Trong phạm vi (spec §1)

| Hạng mục | Mô tả |
|---|---|
| Landing public | Dựng 1:1 từ mockup: announcement bar, header, hero, trust strip, bộ sưu tập hộp quà (Nguyệt Quang Kim, Vọng Nguyệt, Thỏ Ngọc), quà doanh nghiệp, câu chuyện (craft/story), bánh lẻ, testimonials, form liên hệ, footer, bottom sheet liên hệ, sticky CTA mobile |
| Đặt hàng qua lead form | Khách để lại thông tin → hệ thống lưu DB + thông báo Telegram |
| Admin `/admin` | Đơn hàng (nhập tay + convert từ lead), leads, sản phẩm & tồn kho, khách hàng, dashboard doanh thu |
| Hạ tầng | VPS + Docker Compose, Caddy auto HTTPS, backup Postgres hàng ngày, CI GitHub Actions |

### 3.2 Ngoài phạm vi + lý do (spec §1, PROGRESS.md "Quyết định đã chốt")

| Hạng mục | Lý do |
|---|---|
| Giỏ hàng, cổng thanh toán online | **Quyết định chủ đích**: có giỏ hàng/thanh toán online sẽ phát sinh nghĩa vụ đăng ký sàn TMĐT với Bộ Công Thương. Đặt hàng đi qua lead form + xử lý thủ công. |
| Đa ngôn ngữ | Ngoài phạm vi giai đoạn này (spec §1). |
| Blog | Ngoài phạm vi, có thể thêm sau (spec §1). |
| Lưu ảnh trên S3/cloud storage | Ảnh lưu trên VPS (`uploads/` mount volume, nằm trong backup) — đủ ở quy mô này (spec §5). |

### 3.3 Backlog ý tưởng (chưa cam kết — BRIEF.md)

- Thống kê doanh thu theo tháng trong admin (chi tiết hơn dashboard hiện tại).
- Xuất danh sách đơn ra Excel/CSV cho kế toán.

## 4. Stakeholders

| Vai trò | Mô tả |
|---|---|
| Chủ dự án / chủ thương hiệu | Duyệt spec & thiết kế; người dùng chính của admin; nhận thông báo Telegram; cung cấp ảnh sản phẩm thật. |
| Khách cá nhân | Xem landing, để lại lead mua quà biếu cá nhân. |
| Khách doanh nghiệp | Xem mục quà doanh nghiệp, để lại lead đặt số lượng lớn. |
| Đội phát triển (agent harness) | Xây dựng theo quy trình 8 bước trong CLAUDE.md; không tham gia vận hành. |

## 5. Tiêu chí thành công (spec §9)

1. Landing giống mockup đến mức design-evaluator chấm **≥ 8/10 cả 4 tiêu chí** (design quality, originality, craft, functionality).
2. Khách điền form trên mobile → chủ nhận Telegram trong **< 5 giây**, lead xuất hiện trong admin.
3. Chủ tự nhập đơn, đổi trạng thái hết hàng, xem doanh thu — không cần developer.
4. Toàn bộ chạy trên 1 VPS, HTTPS, backup tự động.

## 6. Ràng buộc

- **Mùa vụ:** sẵn sàng trước tháng 8/2026 (PROGRESS.md).
- **Hạ tầng:** 1 VPS duy nhất + Docker Compose — không mở rộng hạ tầng cloud (spec §2, §9).
- **Pháp lý:** không giỏ hàng/thanh toán online (xem 3.2).
- **UI:** mockup trong `design/` là nguồn chân lý, không sửa (CLAUDE.md, PROGRESS.md).
- **Dữ liệu đầu vào còn thiếu:** ảnh sản phẩm thật (mockup đang dùng placeholder) và Telegram bot token + chat id — chờ chủ dự án cung cấp (PROGRESS.md "Ghi chú cho session sau").
