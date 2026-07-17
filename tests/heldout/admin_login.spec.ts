// =============================================================================
// HELD-OUT ACCEPTANCE TEST — Task 1 (Giai đoạn 5):
//   Admin auth flow: /admin/login (form) → POST /api/v1/auth/login → cookie
//   httpOnly mc_admin → redirect /admin (dashboard 3 số) · proxy.ts guard ·
//   đăng xuất → /admin/login.
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
//   (CẤM generator đọc/sửa — mã hóa hành vi DỰ ĐỊNH của Task 1, KHÔNG đọc
//    web/app/admin/*, web/app/actions/admin.ts, proxy.ts.)
//
// Derived ONLY from (black-box):
//   - plan 2026-07-17-giai-doan-5-admin-ui.md, Task 1 "Held-out" + Global
//     Constraints (Auth flow: /admin/login form → POST /api/v1/auth/login →
//     cookie httpOnly mc_admin → redirect /admin; proxy.ts chặn /admin/* không
//     cookie → /admin/login; nút đăng xuất → POST /auth/logout → /admin/login).
//   - SRS REQ-AUTH-004 (guard /admin phía web), REQ-DASH-001 (dashboard:
//     new_leads / processing_orders / revenue_this_month).
//   - api/openapi.yaml: POST /auth/login (Set-Cookie mc_admin), POST /auth/logout
//     (xóa cookie), GET /admin/dashboard (Dashboard{new_leads, processing_orders,
//     revenue_this_month}).
//   - skill run-moonie: admin admin@mooni.local / mooni-admin.
//
// HOW TO RUN — xem header playwright.admin.config.ts. Yêu cầu FULL stack:
// API:8080 + Web:3000 (make up/migrate/seed). Nếu /admin/login CHƯA tồn tại
// (Task 1 chưa code) → các test FAIL rõ ràng ("admin UI chưa dựng").
//
// Precondition auth: seed đã tạo admin admin@mooni.local/mooni-admin.
// Mỗi test dùng browser context RIÊNG (mặc định Playwright) → không rò cookie
// giữa các test; test guard bắt đầu với context SẠCH (không cookie).
// =============================================================================
import { test, expect, Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@mooni.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'mooni-admin';

// ---- Black-box structural locators (KHÔNG tied React internals) --------------
function emailInput(page: Page) {
  return page.locator('input[type="email"], input[name="email"]').first();
}
function passwordInput(page: Page) {
  return page.locator('input[type="password"], input[name="password"]').first();
}
function submitBtn(page: Page) {
  return page
    .locator('button[type="submit"], input[type="submit"], button:has-text("Đăng nhập")')
    .first();
}
function logoutControl(page: Page) {
  // Nút/link đăng xuất trong shell header. Structural: text hoặc aria/href.
  return page
    .locator(
      'button:has-text("Đăng xuất"), a:has-text("Đăng xuất"), ' +
        'button:has-text("Đăng Xuất"), [data-logout], ' +
        'button[aria-label*="xuất" i], a[href*="logout" i], button:has-text("Logout")',
    )
    .first();
}

async function fillLoginForm(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await expect(
    passwordInput(page),
    'Trang /admin/login phải có form đăng nhập (input password) — admin UI chưa dựng?',
  ).toBeVisible();
  await expect(emailInput(page), 'Form đăng nhập thiếu input email').toBeVisible();
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await fillLoginForm(page);
  await emailInput(page).fill(email);
  await passwordInput(page).fill(password);
  await submitBtn(page).click();
}

async function hasMcAdminCookie(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies();
  return cookies.some((c) => c.name === 'mc_admin' && !!c.value);
}

// == Assert 1: Guard — /admin khi CHƯA đăng nhập → redirect /admin/login =======
test('1. guard: mở /admin (context sạch, không cookie) → redirect /admin/login, không thấy dashboard',
  async ({ page }) => {
    // Context mặc định của test này KHÔNG có cookie mc_admin.
    await page.goto('/admin');

    // proxy.ts phải chặn → URL cuối cùng nằm ở /admin/login.
    await expect(
      page,
      'Chưa đăng nhập mà vào /admin phải bị proxy.ts redirect về /admin/login',
    ).toHaveURL(/\/admin\/login/, { timeout: 15_000 });

    // Phải thấy form đăng nhập (bằng chứng KHÔNG lọt vào dashboard).
    await expect(
      passwordInput(page),
      'Sau redirect phải thấy form đăng nhập, KHÔNG phải dashboard',
    ).toBeVisible();
  });

// == Assert 2: Login SAI → báo lỗi, vẫn ở /admin/login =========================
test('2. login sai mật khẩu → hiện thông báo lỗi, VẪN ở /admin/login (không vào /admin)',
  async ({ page }) => {
    await login(page, ADMIN_EMAIL, 'sai-mat-khau-khong-dung-123');

    // KHÔNG được điều hướng vào dashboard: URL vẫn ở /admin/login.
    // (chờ ngắn cho server action phản hồi rồi kiểm URL không rời login)
    await page.waitForTimeout(2500);
    await expect(
      page,
      'Login sai KHÔNG được vào /admin — phải ở lại /admin/login',
    ).toHaveURL(/\/admin\/login/);

    // Phải hiện thông báo lỗi cho người dùng.
    const err = page
      .getByText(/sai|không đúng|thất bại|không hợp lệ|lỗi|email hoặc mật khẩu|đăng nhập/i)
      .filter({ hasNot: page.locator('input, button') });
    await expect(
      err.first(),
      'Login sai phải hiện thông báo lỗi trên /admin/login',
    ).toBeVisible({ timeout: 8_000 });

    // Không có cookie phiên (login thất bại không được set mc_admin có giá trị).
    expect(
      await hasMcAdminCookie(page),
      'Login sai KHÔNG được set cookie phiên mc_admin hợp lệ',
    ).toBe(false);
  });

// == Assert 3: Login ĐÚNG → /admin (dashboard 3 số) + cookie mc_admin ==========
test('3. login đúng → điều hướng /admin, dashboard hiện 3 số/nhãn, cookie mc_admin set',
  async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Điều hướng vào /admin (KHÔNG còn ở /admin/login).
    await expect(
      page,
      'Login đúng phải redirect tới /admin (dashboard)',
    ).toHaveURL(/\/admin(\/|$|\?)/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/admin\/login/);

    // Cookie phiên httpOnly mc_admin phải được set (browser context giữ cookie).
    await expect
      .poll(() => hasMcAdminCookie(page), {
        message: 'Sau login đúng phải có cookie mc_admin trong context',
        timeout: 8_000,
      })
      .toBe(true);

    // Dashboard 3 chỉ số (REQ-DASH-001): leads mới / đơn đang xử lý / doanh thu tháng.
    await expect(
      page.getByText(/lead(s)?\s*mới|lead mới/i).first(),
      'Dashboard thiếu chỉ số "leads mới"',
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/đang xử lý|đơn.*xử lý|xử lý/i).first(),
      'Dashboard thiếu chỉ số "đơn đang xử lý"',
    ).toBeVisible();
    await expect(
      page.getByText(/doanh thu/i).first(),
      'Dashboard thiếu chỉ số "doanh thu tháng"',
    ).toBeVisible();
  });

// == Assert 4 (best-effort): đã đăng nhập vào /admin/login → thẳng /admin ======
test('4. (best-effort) đã đăng nhập rồi mở /admin/login → redirect thẳng /admin (không bắt login lại)',
  async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/admin(\/|$|\?)/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/admin\/login/);

    // Đã có phiên → mở lại /admin/login.
    await page.goto('/admin/login');
    await page.waitForTimeout(2000);

    const url = page.url();
    const redirected = /\/admin(\/|$|\?)/.test(url) && !/\/admin\/login/.test(url);
    test.skip(
      !redirected,
      'Impl không auto-redirect /admin/login khi đã đăng nhập (chấp nhận được — best-effort, không FAIL cứng).',
    );
    expect(
      redirected,
      'Đã đăng nhập mà mở /admin/login thì phải vào thẳng /admin, không bắt đăng nhập lại',
    ).toBe(true);
  });

// == Assert 5: Đăng xuất → /admin/login + /admin lại bị chặn ===================
test('5. đăng xuất → về /admin/login; mở lại /admin lại bị chặn về /admin/login (cookie đã xóa)',
  async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/admin(\/|$|\?)/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/admin\/login/);

    // Bấm nút đăng xuất trong shell.
    const logout = logoutControl(page);
    await expect(
      logout,
      'Shell admin phải có nút/link Đăng xuất',
    ).toBeVisible({ timeout: 10_000 });
    await logout.click();

    // Sau đăng xuất phải về /admin/login.
    await expect(
      page,
      'Đăng xuất phải điều hướng về /admin/login',
    ).toHaveURL(/\/admin\/login/, { timeout: 15_000 });

    // Cookie phiên đã bị xóa (không còn mc_admin có giá trị).
    await expect
      .poll(() => hasMcAdminCookie(page), {
        message: 'Đăng xuất phải xóa cookie mc_admin',
        timeout: 8_000,
      })
      .toBe(false);

    // Mở lại /admin → lại bị guard chặn về /admin/login.
    await page.goto('/admin');
    await expect(
      page,
      'Sau đăng xuất, mở /admin phải lại bị chặn về /admin/login',
    ).toHaveURL(/\/admin\/login/, { timeout: 15_000 });
    await expect(
      passwordInput(page),
      'Sau đăng xuất + vào /admin phải thấy lại form đăng nhập',
    ).toBeVisible();
  });
