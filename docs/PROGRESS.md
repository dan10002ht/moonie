# Mooni Cake — Tiến độ dự án

> Handoff artifact: file này là điểm vào cho bất kỳ session/agent mới nào.
> Cập nhật sau MỖI milestone (quy trình trong CLAUDE.md, bước 8).

## Trạng thái hiện tại

**Giai đoạn: Chuẩn bị (harness setup) — HOÀN THÀNH 2026-07-17**

- [x] Brainstorm + chốt thiết kế với chủ dự án
- [x] Spec: `docs/superpowers/specs/2026-07-17-mooni-website-design.md`
- [x] Harness: CLAUDE.md, 3 agents (qa-evaluator, design-evaluator, go-reviewer), settings, git
- [ ] Plan triển khai chi tiết (skill writing-plans) — BƯỚC TIẾP THEO
- [ ] Scaffold monorepo: web/ (Next.js) + api/ (Go) + docker-compose
- [ ] API: schema + migrations + endpoints public (products, leads) + Telegram notify
- [ ] Landing page từ mockup `design/mooni-landing.html`
- [ ] Auth admin + API admin (orders, leads, products, customers)
- [ ] Admin UI
- [ ] Deploy VPS (Docker Compose + Caddy)

## Quyết định đã chốt (không mở lại nếu không có lý do mới)

- Không giỏ hàng/thanh toán online (tránh đăng ký TMĐT với Bộ Công Thương). Đặt hàng qua lead form.
- Stack: Next.js 15 + Go (chi, pgx, sqlc) + PostgreSQL, monorepo, VPS + Docker.
- Lead mới → lưu DB **và** bắn Telegram Bot.
- Admin quản lý: đơn hàng, leads, sản phẩm & tồn kho, khách hàng.
- Mockup trong `design/` là nguồn chân lý UI, không sửa.

## Ghi chú cho session sau

- Mockup dùng placeholder ảnh (`image-slot`) — cần ảnh sản phẩm thật từ chủ dự án trước khi launch.
- Telegram bot token + chat id sẽ cấu hình qua env (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) — chưa có, hỏi chủ dự án khi làm tính năng notify.
- Trung thu 2026 ≈ cuối tháng 9 — website nên sẵn sàng trước tháng 8 để kịp mùa bán.
