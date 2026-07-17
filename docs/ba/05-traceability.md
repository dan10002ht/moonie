# 05 — Traceability Matrix — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `51d60a1`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> ⚠️ **Cột Task và Test đang trống có chủ đích**: BRIEF.md chưa có task (chờ writing-plans giai đoạn 1), `tests/heldout/` chưa tồn tại. Điền dần khi task đổ vào BRIEF.md và qa-evaluator viết held-out tests.
> Cột "GĐ": bước triển khai dự kiến theo spec §8 (1 Scaffold · 2 API nền · 3 Landing · 4 Auth+API admin · 5 Admin UI · 6 Deploy).

## 1. Yêu cầu chức năng

| REQ | Nguồn (spec) | GĐ | Task (BRIEF.md) | Test (kể cả held-out) | Trạng thái |
|---|---|---|---|---|---|
| REQ-LAND-001 | §1, §5 | 3 | — | — | Chưa triển khai |
| REQ-LAND-002 | §2 | 3 | — | — | Chưa triển khai |
| REQ-LAND-003 | §2 | 3 | — | — | Chưa triển khai |
| REQ-LAND-004 | §5 | 3 | — | — | Chưa triển khai |
| REQ-PROD-001 | §4 | 2 | — | — | Chưa triển khai |
| REQ-PROD-002 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-PROD-003 | §5 | 4–5 | — | — | Chưa triển khai |
| REQ-LEAD-001 | §4 | 2 | — | — | Chưa triển khai |
| REQ-LEAD-002 | §1, §3 | 2 | — | — | Chưa triển khai |
| REQ-LEAD-003 | §3 | 2, 4 | — | — | Chưa triển khai |
| REQ-LEAD-004 | §4 | 4–5 | — | — | Chưa triển khai |
| REQ-LEAD-005 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-001 | §1, §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-002 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-003 | §3 | 4 | — | — | Chưa triển khai |
| REQ-ORD-004 | §3 | 4 | — | — | Chưa triển khai |
| REQ-CUST-001 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-AUTH-001 | §3, §4, §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-002 | §4, §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-003 | §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-004 | §2; CLAUDE.md | 4–5 | — | — | Chưa triển khai |
| REQ-NOTI-001 | §1, §2 | 2 | — | — | Chưa triển khai |
| REQ-NOTI-002 | §2 | 2 | — | — | ⚠️ Treo xác nhận (SRS mâu thuẫn #1) |
| REQ-DASH-001 | §1, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ADM-001 | §5; CLAUDE.md | 5 | — | — | Chưa triển khai |

## 2. Yêu cầu phi chức năng

| NFR | Nguồn | GĐ | Task (BRIEF.md) | Kiểm chứng | Trạng thái |
|---|---|---|---|---|---|
| NFR-001 | spec §9 | 2 | — | — (đo thời gian thực khi qa-evaluator chạy) | Chưa triển khai |
| NFR-002 | spec §2, §9 | 6 | — | — | Chưa triển khai |
| NFR-003 | spec §6, §9 | 6 | — | — | Chưa triển khai |
| NFR-004 | spec §6 | 2 | — | — | Chưa triển khai |
| NFR-005 | spec §6; CLAUDE.md | 1 | — | — | Chưa triển khai |
| NFR-006 | spec §4 | 2 | — | — | Chưa triển khai |
| NFR-007 | spec §6 | 1 | — | — | Chưa triển khai |
| NFR-008 | spec §2, §9 | 1, 6 | — | — | Chưa triển khai |
| NFR-009 | CLAUDE.md | 2 | — | — | Chưa triển khai |
| NFR-010 | spec §9 | 3 | — | — (design-evaluator chấm) | Chưa triển khai |
| NFR-011 | spec §9 | 5 | — | — | Chưa triển khai |

## 3. Ngoài ma trận (backlog, chưa thành REQ)

- Thống kê doanh thu theo tháng (BRIEF.md backlog) — nếu chốt, sẽ mở rộng REQ-DASH.
- Xuất đơn ra Excel/CSV (BRIEF.md backlog) — nếu chốt, sẽ thêm REQ-ORD mới.
