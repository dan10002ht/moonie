// =============================================================================
// HELD-OUT ACCEPTANCE TEST — Task 5 (Giai đoạn 5, TASK CUỐI):
//   Admin UI quản lý KHÁCH HÀNG — /admin/customers: table phân trang (mới-nhất-
//   trước), form/dialog TẠO khách + SỬA khách (validate name/email/phone/type),
//   hiện SĐT + email đầy đủ trong bảng (chủ cần liên hệ khách).
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
//   (CẤM generator đọc/sửa — mã hóa hành vi DỰ ĐỊNH của Task 5, KHÔNG đọc
//    web/app/admin/customers/*, web/app/actions/admin.ts, web/lib/admin-api.ts,
//    web/components/*. Black-box qua browser thật.)
//
// Derived ONLY from (black-box):
//   - plan 2026-07-17-giai-doan-5-admin-ui.md, Task 5 "Held-out" + Global
//     Constraints (list khách phân trang; tạo/sửa khách qua form dialog: tên,
//     SĐT, email, công ty, địa chỉ, loại personal/business, ghi chú; validate +
//     lỗi API; hiện SĐT/email đầy đủ; phân trang trước/sau + tổng).
//   - SRS REQ-CUST-001 (admin CRUD khách hàng /admin/customers: tên, SĐT, email,
//     công ty, địa chỉ, loại personal|business, ghi chú).
//   - api/openapi.yaml:
//       GET  /admin/customers?limit&offset → {items,total}; ORDER created_at DESC.
//       POST /admin/customers {name(req), phone?, email?, company?, address?,
//            type(personal|business), note?} → 201 {id}. name rỗng / type sai /
//            phone|email sai định dạng → 400 (validate ở handler, KHÔNG 500).
//       GET  /admin/customers/{id} → Customer.
//       PUT  /admin/customers/{id} → 200 Customer (validate như tạo).
//   - DB (0006_customers.up.sql): customers(id, name, phone, email, company,
//     address, type CHECK personal|business DEFAULT personal, note, created_at,
//     updated_at). orders.customer_id nullable FK → customers.
//   - skill run-moonie: admin admin@mooni.local / mooni-admin.
//
// HOW TO RUN — xem header playwright.admin-customers.config.ts. Yêu cầu FULL
// stack: Postgres(docker `postgres`) + API:8080 + Web:3000. Nếu /admin/customers
// CHƯA tồn tại (Task 5 chưa code) → các test FAIL rõ ("admin customers UI chưa
// dựng — không thấy bảng khách hàng").
//
// DB (black-box): seed/verify/cleanup qua `docker compose exec -T postgres psql`
// (user/db `mooni`, cờ -q -P pager=off robust bất kể ~/.psqlrc). Mọi khách test
// mang name prefix 'heldout-cui-' và được DỌN ở beforeAll + afterAll. Khách test
// KHÔNG gắn order → xóa cứng an toàn; phòng hờ vẫn UPDATE orders.customer_id=NULL
// trước khi DELETE.
//
// LƯU Ý selector (structural, KHÔNG tied React internals):
//   - table shadcn = <table><tbody><tr>; row = tr chứa text tên/email.
//   - form = [role="dialog"] / <form> chứa input[name=name] + input[name=phone].
//   - select loại (type): hỗ trợ CẢ native <select> LẪN shadcn/Radix
//     (role="combobox" trigger → [role="option"] trong portal).
//   - nút "Thêm khách hàng" định vị theo accessible name; nút "Sửa" trong dòng.
//   - phân trang: nút "Sau"/"Trước"/"Tiếp"/next|prev.
// =============================================================================
import { test, expect, Page, Locator, BrowserContext } from '@playwright/test';
import { execSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@mooni.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'mooni-admin';

const NAME_PREFIX = 'heldout-cui-';
const SUFFIX = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

// Khách test chính (create → show → edit).
const NAME = `${NAME_PREFIX}${SUFFIX}`;
const PHONE = '0912345678';
const EMAIL = `${NAME_PREFIX}${SUFFIX}@example.com`.replace(/-/g, '.');
const COMPANY = `Cty heldout ${SUFFIX}`;
// Giá trị sau khi SỬA.
const NAME_EDIT = `${NAME_PREFIX}${SUFFIX}-edited`;
const PHONE_EDIT = '0987654321';
// Khách validate (thiếu tên) — KHÔNG được tạo. Nhận diện qua email marker.
const BAD_EMAIL = `${NAME_PREFIX}noname-${SUFFIX}@example.com`.replace(/-/g, '.');

let context: BrowserContext;
let page: Page;
let createdId = '';

// ---- DB helpers (black-box; verify persistence + cleanup) --------------------
function psql(sql: string): string {
  const cmd =
    `docker compose exec -T postgres psql -U mooni -d mooni -q -P pager=off -tAc "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function customerCountByName(name: string): number {
  return parseInt(psql(`SELECT count(*) FROM customers WHERE name='${name}'`) || '0', 10);
}
function customerCountByEmail(email: string): number {
  return parseInt(psql(`SELECT count(*) FROM customers WHERE email='${email}'`) || '0', 10);
}
function customerIdByName(name: string): string {
  return psql(`SELECT id FROM customers WHERE name='${name}' ORDER BY created_at DESC LIMIT 1`).trim();
}
function customerField(id: string, field: string): string {
  return psql(`SELECT COALESCE(${field}::text,'') FROM customers WHERE id='${id}' LIMIT 1`);
}
function totalCustomers(): number {
  return parseInt(psql(`SELECT count(*) FROM customers`) || '0', 10);
}
function cleanupDb(): void {
  try {
    const ids = psql(`SELECT id FROM customers WHERE name LIKE '${NAME_PREFIX}%'`)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) {
      try { psql(`UPDATE orders SET customer_id=NULL WHERE customer_id='${id}'`); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try { psql(`DELETE FROM customers WHERE name LIKE '${NAME_PREFIX}%'`); } catch { /* ignore */ }
  // đơn phòng hờ: khách validate (thiếu tên) nếu lỡ tạo với email marker.
  try { psql(`DELETE FROM customers WHERE email='${BAD_EMAIL}'`); } catch { /* ignore */ }
}

// Regex khớp SĐT dù có dấu phân cách (0912 345 678 / 0912.345.678 / 0912-345-678).
function phoneRegex(phone: string): RegExp {
  return new RegExp(phone.split('').join('[.\\s-]?'));
}

// ---- Auth -------------------------------------------------------------------
function emailInput(): Locator { return page.locator('input[type="email"], input[name="email"]').first(); }
function passwordInput(): Locator { return page.locator('input[type="password"], input[name="password"]').first(); }
async function login(): Promise<void> {
  await page.goto('/admin/login');
  await expect(passwordInput(), 'Trang /admin/login phải có form đăng nhập — admin UI chưa dựng?')
    .toBeVisible();
  await emailInput().fill(ADMIN_EMAIL);
  await passwordInput().fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"], button:has-text("Đăng nhập")').first().click();
  await expect(page, 'Login admin thất bại — không vào được /admin').toHaveURL(/\/admin(\/|$|\?)/, {
    timeout: 15_000,
  });
  await expect(page).not.toHaveURL(/\/admin\/login/);
}

// ---- Customers page structural locators -------------------------------------
async function gotoCustomers(): Promise<void> {
  await page.goto('/admin/customers');
  await expect(page, 'Vào /admin/customers mà bị đá về login — guard/phiên sai')
    .not.toHaveURL(/\/admin\/login/);
  await expect(
    page.locator('table, [role="table"]').first(),
    'admin customers UI chưa dựng — không thấy bảng khách hàng ở /admin/customers',
  ).toBeVisible({ timeout: 15_000 });
}
function customerRow(text: string): Locator {
  return page.locator('table tbody tr, [role="row"]').filter({ hasText: text }).first();
}
function formDialog(): Locator {
  return page
    .locator('[role="dialog"], dialog, form')
    .filter({ has: page.locator('input[name="name"]') })
    .filter({ has: page.locator('input[name="phone"], input[name="email"], [role="combobox"], select') })
    .first();
}
function saveBtn(scope: Locator): Locator {
  return scope
    .locator(
      'button[type="submit"], button:has-text("Lưu"), button:has-text("Tạo"), ' +
        'button:has-text("Cập nhật"), button:has-text("Thêm")',
    )
    .first();
}
async function openAddForm(): Promise<Locator> {
  const byRole = page.getByRole('button', { name: /thêm khách hàng|thêm khách|tạo khách|khách mới/i }).first();
  const fallback = page
    .locator(
      'button:has-text("Thêm khách"), a:has-text("Thêm khách"), button:has-text("Tạo khách"), ' +
        '[data-add-customer], button[aria-label*="thêm khách" i], [title*="Thêm khách" i], ' +
        'button:has-text("Thêm")',
    )
    .first();
  const add = (await byRole.count()) > 0 ? byRole : fallback;
  await expect(add, 'Trang /admin/customers phải có nút "Thêm khách hàng"').toBeVisible({ timeout: 10_000 });
  await add.click();
  const d = formDialog();
  await expect(d, 'Bấm Thêm phải mở form/dialog tạo khách (chứa input tên + SĐT/email/loại)').toBeVisible({
    timeout: 8_000,
  });
  return d;
}
async function openEditForm(name: string): Promise<Locator> {
  const row = customerRow(name);
  await expect(row, `Không thấy dòng khách "${name}" trong bảng để Sửa`).toBeVisible({ timeout: 10_000 });
  const edit = row
    .locator(
      'button:has-text("Sửa"), a:has-text("Sửa"), [data-edit], ' +
        'button[aria-label*="sửa" i], a[aria-label*="sửa" i], [title*="Sửa" i], ' +
        'button:has-text("Chi tiết"), a:has-text("Chi tiết")',
    )
    .first();
  await expect(edit, `Dòng "${name}" phải có nút Sửa`).toBeVisible({ timeout: 8_000 });
  await edit.click();
  const d = formDialog();
  await expect(d, 'Bấm Sửa phải mở form/dialog sửa khách').toBeVisible({ timeout: 8_000 });
  return d;
}
async function setInput(scope: Locator, name: string, labelRe: RegExp, value: string): Promise<void> {
  let loc = scope.locator(`input[name="${name}"], textarea[name="${name}"]`).first();
  if ((await loc.count()) === 0) loc = scope.getByLabel(labelRe).first();
  await expect(loc, `Form thiếu trường "${name}"`).toBeVisible({ timeout: 8_000 });
  await loc.fill('');
  await loc.fill(value);
}
async function clearInputIfPresent(scope: Locator, name: string): Promise<void> {
  const loc = scope.locator(`input[name="${name}"], textarea[name="${name}"]`).first();
  if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
    await loc.fill('');
  }
}
// Chọn giá trị cho select LOẠI (type) — hỗ trợ native <select> lẫn shadcn/Radix.
async function chooseOption(scope: Locator, optionRe: RegExp): Promise<boolean> {
  const selects = scope.locator('select');
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const s = selects.nth(i);
    const options = s.locator('option');
    const cnt = await options.count();
    for (let j = 0; j < cnt; j++) {
      const val = (await options.nth(j).getAttribute('value')) ?? '';
      const txt = ((await options.nth(j).textContent()) ?? '').trim();
      if (optionRe.test(val) || optionRe.test(txt)) {
        await s.selectOption(val !== '' ? { value: val } : { label: txt });
        return true;
      }
    }
  }
  const combos = scope.locator(
    '[role="combobox"], button[aria-haspopup="listbox"], button[role="combobox"], button[aria-haspopup="menu"]',
  );
  const cn = await combos.count();
  for (let i = 0; i < cn; i++) {
    await combos.nth(i).click().catch(() => {});
    const option = page
      .locator('[role="option"], [role="menuitem"], [role="menuitemradio"]')
      .filter({ hasText: optionRe })
      .first();
    if ((await option.count()) > 0 && (await option.isVisible().catch(() => false))) {
      await option.click();
      return true;
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
}
async function closeDialogIfOpen(): Promise<void> {
  const d = page.locator('[role="dialog"], dialog').first();
  if ((await d.count()) > 0 && (await d.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
}

// ---- Setup / teardown -------------------------------------------------------
test.beforeAll(async ({ browser }) => {
  cleanupDb();
  // Seed 25 khách cho phân trang — created_at QUÁ KHỨ để nằm trang sau (list mới-
  // nhất-trước), KHÔNG chèn lên trên khách tạo qua form (giữ khách form ở trang 1
  // cho test hiện SĐT/email + sửa).
  psql(
    `INSERT INTO customers (name, phone, email, type, created_at) ` +
      `SELECT '${NAME_PREFIX}page-${SUFFIX}-'||g, '09000000'||lpad(g::text,2,'0'), ` +
      `'${NAME_PREFIX}page-${SUFFIX}-'||g||'@example.com', 'personal', now() - (g * interval '1 hour') ` +
      `FROM generate_series(1,25) AS g`,
  );

  context = await browser.newContext({ baseURL: WEB_BASE });
  page = await context.newPage();
  await login();
});

test.afterAll(async () => {
  cleanupDb();
  await context?.close();
});

test.beforeEach(async () => {
  await gotoCustomers();
});

// == Assert 1: Bảng khách hàng hiện sau login → /admin/customers ===============
test('1. /admin/customers hiện bảng khách hàng (đã seed → có dòng heldout-cui)', async () => {
  await expect(
    page.locator('table, [role="table"]').first(),
    'admin customers UI chưa dựng — không thấy bảng khách hàng ở /admin/customers',
  ).toBeVisible({ timeout: 10_000 });
  // Đã seed 25 khách → bảng phải có ít nhất 1 dòng dữ liệu (không phải empty-state).
  const dataRows = page.locator('table tbody tr, [role="row"]');
  await expect
    .poll(() => dataRows.count(), {
      message: 'Bảng khách hàng phải render các dòng khách (đã seed 25 khách heldout-cui)',
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
});

// == Assert 4a: Validate — TẠO THIẾU TÊN → báo lỗi / không tạo (HARD) ==========
test('4a. tạo khách THIẾU TÊN → form báo lỗi / không đóng, KHÔNG tạo khách', async () => {
  const d = await openAddForm();

  // Bỏ trống tên (xóa nếu form prefill), điền các trường khác + email marker.
  await clearInputIfPresent(d, 'name');
  const nameLoc = d.locator('input[name="name"]').first();
  if ((await nameLoc.count()) > 0) await nameLoc.fill('');
  await setInput(d, 'email', /email|thư điện tử/i, BAD_EMAIL);
  // chọn loại (nếu form bắt buộc) — best-effort.
  await chooseOption(d, /business|doanh nghiệp|công ty/i).catch(() => false);

  await saveBtn(d).click();
  await page.waitForTimeout(2000);

  // KHÔNG được lưu khách nào (name rỗng → 400 hoặc client chặn).
  expect(
    customerCountByEmail(BAD_EMAIL),
    'Tạo khách thiếu tên KHÔNG được tạo bản ghi trong DB (name rỗng → 400 hoặc client chặn)',
  ).toBe(0);

  // Phải có tín hiệu lỗi: dialog vẫn mở HOẶC thông báo lỗi hiện.
  const dialogStillOpen = (await d.count()) > 0 && (await d.isVisible().catch(() => false));
  const errVisible = await page
    .getByText(/lỗi|không hợp lệ|không được|bắt buộc|phải nhập|vui lòng|nhập tên|thiếu|invalid|required/i)
    .first()
    .isVisible()
    .catch(() => false);
  expect(
    dialogStillOpen || errVisible,
    'Thiếu tên phải hiện lỗi hoặc giữ form mở (không âm thầm bỏ qua)',
  ).toBe(true);

  await closeDialogIfOpen();
});

// == Assert 4b (best-effort): email SAI ĐỊNH DẠNG → không tạo =================
test('4b. (best-effort) tạo khách EMAIL SAI ĐỊNH DẠNG → báo lỗi / không tạo', async () => {
  const badEmailName = `${NAME_PREFIX}bademail-${SUFFIX}`;
  const d = await openAddForm();

  await setInput(d, 'name', /tên|họ tên/i, badEmailName);
  await setInput(d, 'email', /email|thư điện tử/i, 'khong-phai-email');
  await chooseOption(d, /personal|cá nhân/i).catch(() => false);

  await saveBtn(d).click();
  await page.waitForTimeout(2000);

  // Bất biến QUAN TRỌNG: email sai định dạng KHÔNG được tạo bản ghi (API validate → 400).
  expect(
    customerCountByName(badEmailName),
    'Email sai định dạng KHÔNG được tạo khách (API validate email → 400)',
  ).toBe(0);

  await closeDialogIfOpen();
});

// == Assert 2: Tạo khách qua form (loại business) → 201 + DB đúng ==============
test('2. tạo khách qua form (tên/SĐT/email/công ty/loại business) → DB có khách đúng field',
  async () => {
    const d = await openAddForm();

    await setInput(d, 'name', /tên|họ tên/i, NAME);
    await setInput(d, 'phone', /sđt|điện thoại|số điện thoại|phone/i, PHONE);
    await setInput(d, 'email', /email|thư điện tử/i, EMAIL);
    await setInput(d, 'company', /công ty|doanh nghiệp|company/i, COMPANY);

    // Loại = business (BẮT BUỘC chọn được).
    const okType = await chooseOption(d, /business|doanh nghiệp|công ty/i);
    expect(okType, 'Form phải cho chọn LOẠI khách = business (personal/business)').toBe(true);

    await saveBtn(d).click();

    // DB xác nhận đã tạo (201 → bản ghi tồn tại).
    await expect
      .poll(() => customerCountByName(NAME), {
        message: 'Khách mới phải được lưu vào bảng customers (POST /admin/customers → 201)',
        timeout: 12_000,
      })
      .toBe(1);

    createdId = customerIdByName(NAME);
    expect(createdId, 'Phải lấy được id khách vừa tạo').toMatch(/[0-9a-f-]{36}/i);

    // Field đúng: name/phone/email/type=business.
    expect(customerField(createdId, 'name'), 'customers.name phải = tên đã nhập').toBe(NAME);
    expect(customerField(createdId, 'phone'), 'customers.phone phải = SĐT đã nhập').toBe(PHONE);
    expect(customerField(createdId, 'email'), 'customers.email phải = email đã nhập').toBe(EMAIL);
    expect(customerField(createdId, 'type'), 'customers.type phải = business').toBe('business');
    // company best-effort (một số UI có thể trim) nhưng phải không rỗng.
    expect(
      customerField(createdId, 'company').length,
      'customers.company phải được lưu (không rỗng)',
    ).toBeGreaterThan(0);
  });

// == Assert 6: Bảng hiện SĐT + email đầy đủ (chủ cần liên hệ khách) ============
test('6. bảng /admin/customers hiện SĐT + email đầy đủ của khách vừa tạo', async () => {
  expect(createdId, 'Cần khách tạo ở test 2 để kiểm hiển thị SĐT/email').not.toBe('');

  // Đọc giá trị hiện tại từ DB (chống lệ thuộc thứ tự test).
  const curName = customerField(createdId, 'name');
  const curPhone = customerField(createdId, 'phone');
  const curEmail = customerField(createdId, 'email');

  const row = customerRow(curName);
  await expect(row, `Không thấy dòng khách "${curName}" trong bảng`).toBeVisible({ timeout: 10_000 });

  // Email đầy đủ phải hiện trong dòng (khớp chính xác chuỗi email).
  await expect(
    row.getByText(new RegExp(curEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first(),
    'Bảng phải hiện EMAIL đầy đủ của khách (chủ cần liên hệ)',
  ).toBeVisible({ timeout: 8_000 });

  // SĐT đầy đủ phải hiện (cho phép dấu phân cách khi format).
  await expect(
    row.getByText(phoneRegex(curPhone)).first(),
    'Bảng phải hiện SĐT đầy đủ của khách (chủ cần gọi)',
  ).toBeVisible({ timeout: 8_000 });
});

// == Assert 3: Sửa khách vừa tạo (đổi tên/SĐT/loại) → DB cập nhật ==============
test('3. sửa khách (đổi tên + SĐT + loại → personal) → DB cập nhật', async () => {
  expect(createdId, 'Cần khách tạo ở test 2 để sửa').not.toBe('');
  const curName = customerField(createdId, 'name');
  const d = await openEditForm(curName);

  await setInput(d, 'name', /tên|họ tên/i, NAME_EDIT);
  await setInput(d, 'phone', /sđt|điện thoại|số điện thoại|phone/i, PHONE_EDIT);
  const okType = await chooseOption(d, /personal|cá nhân/i);
  expect(okType, 'Form sửa phải cho đổi LOẠI sang personal').toBe(true);

  await saveBtn(d).click();

  // DB phản ánh giá trị mới trên CÙNG bản ghi (id giữ nguyên → UPDATE, không tạo mới).
  await expect
    .poll(() => customerField(createdId, 'name'), {
      message: 'Tên mới phải được lưu vào DB sau khi sửa (PUT /admin/customers/{id})',
      timeout: 12_000,
    })
    .toBe(NAME_EDIT);
  expect(customerField(createdId, 'phone'), 'SĐT mới phải được lưu sau khi sửa').toBe(PHONE_EDIT);
  expect(customerField(createdId, 'type'), 'Loại mới phải là personal sau khi sửa').toBe('personal');

  // Không tạo bản ghi trùng (vẫn đúng 1 khách mang tên mới).
  expect(customerCountByName(NAME_EDIT), 'Sửa phải UPDATE, KHÔNG tạo khách trùng').toBe(1);
});

// == Assert 5: Phân trang trước/sau + tổng ====================================
test('5. phân trang: có nút Sau (đã seed >20 khách) → đổi nội dung; Trước quay lại; hiện tổng',
  async () => {
    expect(
      totalCustomers(),
      'Precondition phân trang: cần > 20 khách trong DB (đã seed 25 heldout-cui)',
    ).toBeGreaterThan(20);

    const nextBtn = page
      .locator(
        'button:has-text("Sau"), a:has-text("Sau"), button:has-text("Tiếp"), a:has-text("Tiếp"), ' +
          'button:has-text("Next"), a:has-text("Next"), [aria-label*="sau" i], [aria-label*="next" i], ' +
          '[aria-label*="trang sau" i], [data-next-page]',
      )
      .first();
    await expect(
      nextBtn,
      'Danh sách > 20 khách → phải có nút phân trang "Sau"/"Tiếp"/next (plan: phân trang customers)',
    ).toBeVisible({ timeout: 10_000 });

    const firstBefore =
      (await page.locator('table tbody tr, [role="row"]').first().textContent().catch(() => '')) ?? '';
    await nextBtn.click();
    await page.waitForTimeout(1500);
    const firstAfter =
      (await page.locator('table tbody tr, [role="row"]').first().textContent().catch(() => '')) ?? '';
    expect(
      firstAfter.trim(),
      'Chuyển sang trang sau phải đổi nội dung (dòng đầu khác trang trước)',
    ).not.toBe(firstBefore.trim());

    // Trước: quay lại trang 1 (best-effort).
    const prevBtn = page
      .locator(
        'button:has-text("Trước"), a:has-text("Trước"), button:has-text("Prev"), a:has-text("Prev"), ' +
          '[aria-label*="trước" i], [aria-label*="prev" i], [data-prev-page]',
      )
      .first();
    if ((await prevBtn.count()) > 0 && (await prevBtn.isVisible().catch(() => false))) {
      await prevBtn.click();
      await page.waitForTimeout(1500);
      const firstBack =
        (await page.locator('table tbody tr, [role="row"]').first().textContent().catch(() => '')) ?? '';
      expect(firstBack.trim(), 'Bấm Trước phải quay về nội dung trang 1').toBe(firstBefore.trim());
    }

    // Tổng số khách hiển thị đâu đó trên trang (best-effort — định dạng biến thiên).
    const total = totalCustomers();
    const totalShown = await page
      .getByText(new RegExp(`\\b${total}\\b`))
      .first()
      .isVisible()
      .catch(() => false);
    void totalShown; // tín hiệu phụ, không FAIL cứng (UI có thể hiển thị "trang x/y").
  });
