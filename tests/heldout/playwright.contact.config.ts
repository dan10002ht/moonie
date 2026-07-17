// =============================================================================
// HELD-OUT Playwright config — Task 4 (Giai đoạn 3): Contact bottom sheet + form
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE OR THE SPEC.
//   (CẤM generator đọc/sửa file này và contact_form.spec.ts — chúng mã hóa hành
//    vi DỰ ĐỊNH của Task 4, không phải hành vi hiện tại của implementation.)
//
// HOW TO RUN (from repo root /Users/dantt1002/projects/moonie):
//   1) Boot stack (skill run-moonie):
//        make up && make migrate && make seed
//        (api) cd api && set -a && . ../.env && set +a && GOTOOLCHAIN=local go run ./cmd/server
//        (web) cd web && npm run dev
//      => Postgres :5440, API :8080, Web :3000 must all be UP.
//   2) Run the held-out spec (resolves @playwright/test from web/node_modules):
//        cd web && NODE_PATH="$PWD/node_modules" \
//          npx playwright test --config ../tests/heldout/playwright.contact.config.ts
//      (NODE_PATH needed vì config nằm ngoài web/ nên Node không tự thấy @playwright/test)
//
// Serial, no retries, single worker: rate-limit window (20/min) is shared per IP,
// so parallel/retried runs would contaminate each other. Run once.
// =============================================================================
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: __dirname,
  testMatch: /contact_form\.spec\.ts$/,
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
