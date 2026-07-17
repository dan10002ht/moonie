# BRIEF — Hàng đợi task Mooni Cake

> Định dạng: `[ ]` chưa làm · `[⏳]` đang làm · `[✅]` xong (kèm tóm tắt indent bên dưới).
> Quy tắc vận hành: xem CLAUDE.md mục "Vòng lặp task". Evaluator PASS mới được mark ✅.
> Chủ dự án thêm task mới = thêm dòng `[ ]`. Task cần mô tả đủ để làm không phải hỏi lại; thiếu thông tin thì agent ghi chú blocker thay vì đoán.

## Giai đoạn 1 — Scaffold (đổ task chi tiết từ plan sau khi viết plan)

_(trống — chờ writing-plans cho giai đoạn 1; 1 task đã chốt trước:)_

1. [ ] Viết project skill `run-moonie` (dùng skill writing-skills): quy trình boot chuẩn duy nhất cho mọi agent — docker compose up + đợi healthcheck + migrate + seed data mẫu + URL/port từng service. DoD: agent mới toanh chỉ đọc skill là dựng được app chạy thật; qa-evaluator và design-evaluator dùng skill này thay vì tự ứng biến. (Làm CUỐI giai đoạn 1, khi app đã tồn tại)

## Giai đoạn 6 — Deploy (task đã chốt trước)

1. [ ] Viết runbook vận hành `docs/runbook.md`: deploy lên VPS, rollback về bản trước, restore backup Postgres, xem log khi sự cố. DoD: từng mục có lệnh cụ thể đã chạy thử thật ít nhất 1 lần (kể cả restore). Kèm 2 mốc security-review bắt buộc theo CLAUDE.md.

## Backlog ý tưởng (chưa thành task)

- Trang admin cần thống kê doanh thu theo tháng
- Xuất danh sách đơn ra Excel/CSV cho kế toán
