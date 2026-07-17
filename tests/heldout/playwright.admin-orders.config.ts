// =============================================================================
// HELD-OUT Playwright config — Task 4 (Giai đoạn 5): Admin UI quản lý đơn hàng
//   (table phân trang + form tạo đơn nhiều dòng món + chi tiết + đổi status)
//   → /admin/orders.
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE, THE SPEC
//   (admin_orders_ui.spec.ts) HAY api/openapi.yaml.
//   (CẤM generator đọc/sửa — file mã hóa hành vi DỰ ĐỊNH của Task 4 GĐ5, KHÔNG
//    phải hành vi hiện tại. Black-box qua browser thật; dẫn xuất CHỈ từ plan +
//    SRS REQ-ORD-001/002/003/004 + openapi, KHÔNG đọc web/app/admin/*, actions,
//    lib, components.)
//
// HOW TO RUN (from repo root /Users/dantt1002/projects/moonie):
//   1) Boot FULL stack (skill run-moonie):
//        make up && make migrate && make seed
//        (api) cd api && set -a && . ../.env && set +a && GOTOOLCHAIN=local go run ./cmd/server
//        (web) cd web && npm run dev
//      => Postgres (docker service `postgres`, user/db `mooni`), API :8080, Web :3000 UP.
//      => Seed tạo admin: admin@mooni.local / mooni-admin + 7 sản phẩm available
//         (vd "Nguyệt Quang Kim" slug nguyet-quang-kim) — dùng làm dòng món.
//   2) Run held-out spec (resolves @playwright/test từ web/node_modules):
//        cd web && NODE_PATH="$PWD/node_modules" \
//          npx playwright test --config ../tests/heldout/playwright.admin-orders.config.ts
//      (NODE_PATH cần vì config nằm ngoài web/ nên Node không tự thấy @playwright/test)
//
// Tạo đơn / đổi status chạy qua Server Action + proxy.ts guard → PHẢI qua Next
// server (:3000). Single worker, KHÔNG parallel: các test dùng CHUNG 1 phiên
// đăng nhập + thao tác tuần tự theo THỨ TỰ khai báo (file order): tạo đơn ở
// test 2 → chi tiết test 3 → đổi status test 4 (đơn dùng lại xuyên test).
// Seed/verify/cleanup qua psql (không dính rate-limit).
// =============================================================================
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: __dirname,
  testMatch: /admin_orders_ui\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  metadata: { repoRoot: path.resolve(__dirname, '..', '..') },
});
