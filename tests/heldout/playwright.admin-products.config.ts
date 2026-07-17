// =============================================================================
// HELD-OUT Playwright config — Task 2 (Giai đoạn 5): Admin UI quản lý sản phẩm
//   (table + form tạo/sửa + upload ảnh) → /admin/products.
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE, THE SPEC
//   (admin_products_ui.spec.ts) HAY api/openapi.yaml.
//   (CẤM generator đọc/sửa — file mã hóa hành vi DỰ ĐỊNH của Task 2 GĐ5, KHÔNG
//    phải hành vi hiện tại. Black-box qua browser thật; dẫn xuất CHỈ từ plan +
//    SRS REQ-PROD-002/003 + openapi, KHÔNG đọc web/app/admin/*.)
//
// HOW TO RUN (from repo root /Users/dantt1002/projects/moonie):
//   1) Boot FULL stack (skill run-moonie):
//        make up && make migrate && make seed
//        (api) cd api && set -a && . ../.env && set +a && GOTOOLCHAIN=local go run ./cmd/server
//        (web) cd web && npm run dev
//      => Postgres :5440 (docker service `postgres`), API :8080, Web :3000 cùng UP.
//      => Seed tạo admin: admin@mooni.local / mooni-admin + 7 sản phẩm available.
//   2) Run held-out spec (resolves @playwright/test từ web/node_modules):
//        cd web && NODE_PATH="$PWD/node_modules" \
//          npx playwright test --config ../tests/heldout/playwright.admin-products.config.ts
//      (NODE_PATH cần vì config nằm ngoài web/ nên Node không tự thấy @playwright/test)
//
// CRUD + upload chạy qua Server Action + proxy.ts guard → PHẢI qua Next server
// (:3000), KHÔNG file tĩnh. Single worker, KHÔNG parallel: các test dùng chung 1
// phiên đăng nhập + thao tác tuần tự trên cùng 1 sản phẩm test (create→edit→
// upload→delete) theo THỨ TỰ khai báo (file order).
// =============================================================================
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: __dirname,
  testMatch: /admin_products_ui\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
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
