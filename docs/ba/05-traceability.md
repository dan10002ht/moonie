# 05 — Traceability Matrix — Website Mooni Cake

> **Cập nhật:** 2026-07-17 · **Commit nguồn:** `961ed54`
> Tài liệu phái sinh — nguồn chân lý là spec/code; nếu lệch nhau, spec/code thắng.
> ⚠️ **GĐ1 (Scaffold) đã xong 8/8** (BRIEF.md, CHANGELOG 2026-07-17). Các dòng đã chạm ở GĐ1 được điền Task + commit + test/gate. Phần lớn REQ nghiệp vụ vẫn "chưa triển khai"; `tests/heldout/` do qa-evaluator sở hữu, chưa có test nghiệp vụ.
> Cột "GĐ": bước triển khai dự kiến theo spec §8 (1 Scaffold · 2 API nền · 3 Landing · 4 Auth+API admin · 5 Admin UI · 6 Deploy). Một số hạ tầng (sqlc, error JSON) spec xếp GĐ2 nhưng đã làm sẵn ở GĐ1 để dựng đường ống — cột GĐ giữ giá trị dự kiến, cột Trạng thái phản ánh thực tại.

> **Ghi nhận thực tại GĐ1** (không sửa yêu cầu, chỉ ghi để chủ dự án nắm):
> - Go floor **1.23 → 1.25** (testcontainers-go v0.43 yêu cầu), pgx → v5.9.2. CI setup-go đọc `go.mod` = 1.25.
> - Local build/test/lint bắt buộc `CGO_ENABLED=0` (shim `cc` phá cgo); testcontainers trên Colima cần `DOCKER_HOST`+`SOCKET_OVERRIDE`. Chi tiết: `Makefile`, PROGRESS §"Ghi chú kỹ thuật".
> - CI chưa chạy trên GitHub thật (chưa có remote) — mới verify bằng lệnh local.

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
| REQ-LEAD-005 | §1, §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-001 | §1, §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-002 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ORD-003 | §3 | 4 | — | — | Chưa triển khai |
| REQ-ORD-004 | §3 | 4 | — | — | Chưa triển khai |
| REQ-CUST-001 | §3, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-AUTH-001 | §3, §4, §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-002 | §4, §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-003 | §6 | 4 | — | — | Chưa triển khai |
| REQ-AUTH-004 | §2; CLAUDE.md | 4–5 | GĐ1/Task 5 (`dc40754`) | tsc/lint/build xanh (gate độc lập) | Khung xong GĐ1 (`web/proxy.ts` skeleton guard `/admin`), hoàn thiện GĐ4–5 |
| REQ-NOTI-001 | §1, §2 | 2 | — | — | Chưa triển khai |
| REQ-NOTI-002 | §1, §2 | 2 | — | — | Chưa triển khai (hết treo — chốt 2026-07-17) |
| REQ-DASH-001 | §1, §4 | 4–5 | — | — | Chưa triển khai |
| REQ-ADM-001 | §5; CLAUDE.md | 5 | GĐ1/Task 5 (`dc40754`) | tsc/lint/build xanh; tokens render thật (gate độc lập) | Khung xong GĐ1 (Tailwind v4 `@theme` design tokens, font Playfair+Be Vietnam), hoàn thiện GĐ5 |

## 2. Yêu cầu phi chức năng

| NFR | Nguồn | GĐ | Task (BRIEF.md) | Kiểm chứng | Trạng thái |
|---|---|---|---|---|---|
| NFR-001 | spec §9 | 2 | — | — (đo thời gian thực khi qa-evaluator chạy) | Chưa triển khai |
| NFR-002 | spec §2, §9 | 6 | — | — | Chưa triển khai |
| NFR-003 | spec §6, §9 | 6 | — | — | Chưa triển khai |
| NFR-004 | spec §6 | 2 | GĐ1/Task 4 (`ed1e6ea`) | `api/internal/store/store_test.go` (`TestAdminUserRoundTrip`, testcontainers Postgres 16 thật) | Hạ tầng xong (GĐ1): sqlc + golang-migrate, truy vấn chỉ qua sqlc |
| NFR-005 | spec §6; CLAUDE.md | 1 | GĐ1/Task 1–2 (`bfff066`, `e9b516c`) | `.env` ignored, `.env.example` trong git; config từ env (gate độc lập) | Hạ tầng xong (GĐ1): secrets qua env, không hardcode |
| NFR-006 | spec §4 | 2 | GĐ1/Task 2 (`8696c89`) | router test: 404/405 trả JSON (`api/cmd/server/main_test.go`) | Hạ tầng xong (GĐ1): error helper JSON (`internal/httpx`) |
| NFR-007 | spec §6 | 1 | GĐ1/Task 7 (`7bda1f8`, `97589ae`) | CI 2 job lint+test+build verify local xanh (chưa chạy GitHub thật — chưa có remote) | Hạ tầng xong (GĐ1): `.github/workflows/ci.yml` |
| NFR-008 | spec §2, §9 | 1, 6 | GĐ1/Task 1+7 (`bfff066`, `7bda1f8`) | `docker compose config` OK, full stack up (api healthz 200 + web 200) | Hạ tầng xong (GĐ1): Compose Postgres+api+web; deploy VPS còn ở GĐ6 |
| NFR-009 | CLAUDE.md | 2 | — | — | Chưa triển khai |
| NFR-010 | spec §9 | 3 | — | — (design-evaluator chấm) | Chưa triển khai |
| NFR-011 | spec §9 | 5 | — | — | Chưa triển khai |

## 3. Ngoài ma trận (backlog, chưa thành REQ)

- Thống kê doanh thu theo tháng (BRIEF.md backlog) — nếu chốt, sẽ mở rộng REQ-DASH.
- Xuất đơn ra Excel/CSV (BRIEF.md backlog) — nếu chốt, sẽ thêm REQ-ORD mới.
