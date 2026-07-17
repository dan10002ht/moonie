# Mooni Cake — Website bánh trung thu cao cấp

Website giới thiệu + đặt hàng qua lead form (KHÔNG có giỏ hàng/thanh toán online — tránh phải đăng ký sàn TMĐT với Bộ Công Thương), kèm trang admin quản lý bán hàng.

## Kiến trúc (Monorepo)

```
web/    → Next.js 16 App Router (Turbopack) + Tailwind CSS. Public site + admin UI tại /admin (shadcn/ui)
          Lưu ý Next 16: params/searchParams là async; auth guard dùng proxy.ts (middleware.ts đã deprecate)
api/    → Go: chi router, pgx + sqlc, golang-migrate. REST JSON tại /api/v1
design/ → Mockup HTML — NGUỒN CHÂN LÝ về UI. Không sửa file trong này.
docs/   → Specs, plans, PROGRESS.md (handoff artifact)
```

- DB: PostgreSQL (Docker). Deploy: VPS + Docker Compose + Caddy (auto HTTPS).
- Lead form → Go API lưu DB + bắn Telegram Bot notification ngay.
- Admin quản lý: đơn hàng (nhập tay + convert từ lead), leads, sản phẩm & tồn kho, khách hàng.
- Auth admin: email + password, JWT trong httpOnly cookie.

## Lệnh thường dùng

```bash
docker compose up -d          # Postgres (+ api/web khi đã có Dockerfile)
cd web && npm run dev         # Next.js dev server (port 3000)
cd api && go run ./cmd/server # Go API (port 8080)
cd web && npm run lint && npm test        # lint + test web
cd api && golangci-lint run && go test ./... # lint + test api
```

(Cập nhật section này khi scaffold xong — lệnh phải chạy được thật.)

## Design tokens (từ design/mooni-design-system.html)

| Token | Giá trị | Dùng cho |
|---|---|---|
| navy (primary) | `#041E4F` | Header footer navy, heading, nút chính |
| navy-light | `#0B2A64` | Hover/nhấn của navy |
| navy-tint | `#EEF1F7` | Nền phụ tông navy |
| gold | `#C6A867` | Accent, badge, chi tiết sang trọng |
| gold-deep | `#B0925A` / `#8A6C36` | Link, hover link, kicker text |
| cream (bg) | `#F7F6F4` | Nền trang mặc định |
| ink | `#22201B` | Body text |
| ink-muted | `#4C483F` / `#918C81` | Text phụ |
| border | `#E6E4DE` | Viền card, divider |
| selection | `#EFE7D3` | ::selection |

- Font: **Playfair Display** (heading, serif, có italic) + **Be Vietnam Pro** (body) — Google Fonts, subset `vietnamese,latin`.
- Khi có mâu thuẫn giữa bảng này và file mockup: **mockup thắng**. Đọc `design/mooni-design-system.html` để xem components, buttons, badges, product cards chuẩn.

## Quy tắc coding

### TypeScript / Next.js (web/)
- TypeScript strict mode. **Cấm `any`** — dùng `unknown` + narrowing.
- Server Components mặc định; `"use client"` chỉ khi cần tương tác.
- Gọi API qua 1 client module duy nhất (`web/lib/api.ts`), không rải `fetch` khắp nơi.
- Tailwind dùng design tokens đã khai báo trong theme, không hardcode mã màu trong JSX.
- Text hiển thị: tiếng Việt có dấu chuẩn, giọng thương hiệu sang trọng (xem mockup).

### Go (api/)
- Error luôn wrap kèm ngữ cảnh: `fmt.Errorf("create order: %w", err)`. Không nuốt error.
- Table-driven tests. Handler test bằng `httptest`.
- Query qua sqlc (SQL viết tay, type-safe) — không ORM.
- Migration: chỉ thêm file mới trong `api/migrations/`, không sửa migration đã chạy.
- Không log dữ liệu nhạy cảm (SĐT khách chỉ log 4 số cuối).

### Chung
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`...
- Secrets chỉ nằm trong `.env` (đã gitignore). Không bao giờ commit token/password.

## Quy trình bắt buộc (harness — tách generator khỏi evaluator)

Mỗi feature đi theo pipeline, KHÔNG bỏ bước:

1. **Spec** — đã có trong `docs/superpowers/specs/`. Feature mới → brainstorm trước.
2. **Plan** — dùng skill writing-plans. Mỗi task phải có **definition of done + tiêu chí test cụ thể viết trước khi code** (hợp đồng). Tasks đổ vào `BRIEF.md`.
3. **Held-out tests** — `qa-evaluator` dịch definition-of-done thành acceptance tests trong `tests/heldout/` TRƯỚC khi generator code (xem quy tắc held-out bên dưới).
4. **TDD** — dùng skill test-driven-development. Test trước, code sau.
5. **Build** — generator (subagent) implement theo plan.
6. **Đánh giá độc lập** — bắt buộc dispatch agent evaluator, KHÔNG tự chấm:
   - UI/UX → agent `design-evaluator` (screenshot thật, chấm vs mockup + 4 tiêu chí)
   - Tính năng → agent `qa-evaluator` (chạy app thật + held-out tests, rớt 1 tiêu chí = fail)
   - Code Go → agent `go-reviewer`
7. **Sửa theo feedback** evaluator cho đến khi pass.
8. **Verify** — skill verification-before-completion: chạy lệnh thật, thấy output thật rồi mới báo xong.
9. **Cập nhật `BRIEF.md` (mark ✅ + tóm tắt), `CHANGELOG.md`, `docs/PROGRESS.md`** rồi commit.
10. **Tài liệu BA (song song)** — khi kết thúc một GIAI ĐOẠN trong BRIEF.md hoặc spec thay đổi: dispatch agent `ba-writer` cập nhật `docs/ba/` (BRD, SRS, FRS, data dictionary, traceability). Không chạy per-task (tránh nhiễu); tài liệu BA là phái sinh — spec/code là nguồn chân lý, ba-writer phát hiện mâu thuẫn thì báo chủ dự án chứ không tự xử.

Nguyên tắc harness: mỗi scaffold là một giả định model không tự làm được — thấy không còn cần thì gỡ. Giữ mọi thứ đơn giản nhất có thể.

## Vòng lặp task (BRIEF.md — file-driven task loop)

`BRIEF.md` là hàng đợi task duy nhất. Định dạng: `[ ]` chưa làm · `[⏳]` đang làm · `[✅]` xong.

- Nhặt task `[ ]` trên cùng, đánh `[⏳]` ngay khi bắt đầu. Task `[⏳]` mà không có agent nào đang chạy = coi như chưa xong, làm lại.
- Code qua **subagent** (generator), không phải main agent. Main agent chỉ điều phối.
- **Evaluator gate**: chỉ được đổi `[⏳]` → `[✅]` khi evaluator tương ứng trả VERDICT: PASS. Generator/main agent tự chấm rồi mark done = vi phạm quy trình.
- Mark ✅ xong: viết tóm tắt ngay dưới task (indent, file đã sửa + cách làm), thêm entry `CHANGELOG.md` theo ngày.
- Surgical: mỗi thay đổi trace về đúng 1 task, không tự nở scope, không bịa task khi hàng đợi trống.
- Blocker: ghi rõ vào dưới task + báo user, KHÔNG mark done.
- `BRIEF.md` = hàng đợi chi tiết (thay đổi liên tục); `docs/PROGRESS.md` = milestone tổng (cập nhật thưa). Không gộp.

## Pipeline test per-task (rẻ trước, đắt sau — fail = dừng)

Căn cứ: `docs/research/2026-07-17-per-task-testing.md` (claims đã verify).

1. **Lint + typecheck**: `golangci-lint run` · `tsc --noEmit` (types sinh từ OpenAPI = contract gate compile-time 2 phía).
2. **Unit tests**: `go test ./...` ∥ Vitest + RTL.
3. **Integration Go** trên Postgres THẬT (testcontainers-go local / service container trong CI). Không mock DB.
4. **Contract tests**: typed client sinh từ OpenAPI spec gọi backend Go đang chạy thật.
5. **Playwright E2E tối thiểu**: happy paths + async Server Components (Vitest không render được async RSC — bắt buộc E2E).
6. **Held-out gate**: `tests/heldout/` pass → evaluator mới được trả PASS.

Ngoài pipeline per-task, chạy skill **security-review** ở 2 mốc bắt buộc: cuối giai đoạn auth admin (giai đoạn 4) và trước deploy production (giai đoạn 6). Finding mức cao chưa xử lý = không deploy.

Contract: API là **spec-first OpenAPI** (`api/openapi.yaml`) — Go dùng `oapi-codegen` (ServerInterface, lệch spec = fail compile), web dùng `openapi-typescript`. Đổi API = sửa spec trước, regenerate 2 phía.

### Quy tắc held-out tests (chống reward hacking — bằng chứng SpecBench)

- `tests/heldout/` do **qa-evaluator viết và sở hữu**, dịch từ definition-of-done + OpenAPI spec, KHÔNG nhìn implementation.
- **Generator (agent viết code) BỊ CẤM đọc, sửa, hay chạy `tests/heldout/`** — không được cat/grep/open thư mục này, không đưa nội dung nó vào prompt của generator. Thêm test cho generator nhìn thấy không thay thế được held-out (bằng chứng: mở rộng visible tests không giảm reward hacking).
- Test do generator tự sinh từ code có sẵn chỉ mã hóa hành vi hiện tại (kể cả bug) — không bao giờ là source of truth.

## Task UI: vòng lặp screenshot (bắt buộc)

Mọi task đụng UI kết thúc bằng vòng lặp screenshot — vừa để tự sửa, vừa làm report cho user:

1. Generator build xong → chụp màn hình bằng Playwright ở **2 viewport: desktop 1440×900 và mobile 390×844**, lưu vào `docs/reports/screenshots/<YYYY-MM-DD>-<task>/`.
2. Chụp cả **mockup tương ứng** (`npx playwright screenshot "file://$PWD/design/mooni-landing.html" ...`) để so cạnh nhau.
3. Generator TỰ NHÌN screenshot (Read file ảnh) trước — thấy lệch rõ (màu, font, spacing, vỡ layout, lỗi dấu tiếng Việt) thì sửa ngay rồi chụp lại. Tối đa 3 vòng tự sửa.
4. Dispatch `design-evaluator` chấm chính thức (nó chụp lại độc lập, không tin screenshot của generator).
5. Screenshot cuối cùng (đã PASS) giữ lại trong `docs/reports/screenshots/` — đính kèm khi báo cáo user; screenshot vòng nháp thì xóa.

Screenshot bắt được: layout/màu/typography/responsive. KHÔNG bắt được: hover, animation, bottom sheet mở/đóng, form submit — những cái đó phải test bằng Playwright interaction (bước 5 pipeline), không được kết luận từ ảnh tĩnh.
