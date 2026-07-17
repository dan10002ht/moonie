// =============================================================================
// HELD-OUT Playwright config — Task 1 (Giai đoạn 5): Admin login + shell + dashboard
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE OR THE SPEC.
//   (CẤM generator đọc/sửa file này và admin_login.spec.ts — chúng mã hóa hành vi
//    DỰ ĐỊNH của Task 1 GĐ5, không phải hành vi hiện tại của implementation.
//    Black-box qua browser thật, dẫn xuất CHỈ từ plan + SRS + openapi, KHÔNG đọc
//    web/app/admin/*.)
//
// HOW TO RUN (from repo root /Users/dantt1002/projects/moonie):
//   1) Boot FULL stack (skill run-moonie):
//        make up && make migrate && make seed
//        (api) cd api && set -a && . ../.env && set +a && GOTOOLCHAIN=local go run ./cmd/server
//        (web) cd web && npm run dev
//      => Postgres :5440, API :8080, Web :3000 phải cùng UP.
//      => Seed tạo admin: admin@mooni.local / mooni-admin.
//   2) Run held-out spec (resolves @playwright/test từ web/node_modules):
//        cd web && NODE_PATH="$PWD/node_modules" \
//          npx playwright test --config ../tests/heldout/playwright.admin.config.ts
//      (NODE_PATH cần vì config nằm ngoài web/ nên Node không tự thấy @playwright/test)
//
// Auth flow phụ thuộc Server Action (server-to-server) + proxy.ts guard → PHẢI chạy
// qua Next server (:3000), KHÔNG file tĩnh. Single worker để tránh nhiễu cookie/phiên.
// =============================================================================
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: __dirname,
  testMatch: /admin_login\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
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
