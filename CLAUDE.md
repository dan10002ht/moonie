# Mooni Cake — Website bánh trung thu cao cấp

Website giới thiệu + đặt hàng qua lead form (KHÔNG có giỏ hàng/thanh toán online — tránh phải đăng ký sàn TMĐT với Bộ Công Thương), kèm trang admin quản lý bán hàng.

## Kiến trúc (Monorepo)

```
web/    → Next.js 15 App Router + Tailwind CSS. Public site + admin UI tại /admin (shadcn/ui)
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
2. **Plan** — dùng skill writing-plans. Mỗi task phải có **definition of done + tiêu chí test cụ thể viết trước khi code** (hợp đồng).
3. **TDD** — dùng skill test-driven-development. Test trước, code sau.
4. **Build** — generator (bạn hoặc subagent) implement theo plan.
5. **Đánh giá độc lập** — bắt buộc dispatch agent evaluator, KHÔNG tự chấm:
   - UI/UX → agent `design-evaluator` (chấm vs mockup + 4 tiêu chí)
   - Tính năng → agent `qa-evaluator` (chạy app thật, threshold cứng, rớt 1 tiêu chí = fail)
   - Code Go → agent `go-reviewer`
6. **Sửa theo feedback** evaluator cho đến khi pass.
7. **Verify** — skill verification-before-completion: chạy lệnh thật, thấy output thật rồi mới báo xong.
8. **Cập nhật `docs/PROGRESS.md`** rồi commit.

Nguyên tắc harness: mỗi scaffold là một giả định model không tự làm được — thấy không còn cần thì gỡ. Giữ mọi thứ đơn giản nhất có thể.
