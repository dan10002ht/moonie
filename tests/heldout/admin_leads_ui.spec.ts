// =============================================================================
// HELD-OUT ACCEPTANCE TEST — Task 3 (Giai đoạn 5):
//   Admin UI quản lý leads — /admin/leads: table phân trang (mới-nhất-trước),
//   đổi status qua dropdown/select, convert lead→đơn nháp (KHÔNG tạo customer),
//   hiện SĐT + lời nhắn khách (chủ cần gọi lại).
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
//   (CẤM generator đọc/sửa — mã hóa hành vi DỰ ĐỊNH của Task 3, KHÔNG đọc
//    web/app/admin/leads/*, web/app/actions/admin.ts, web/lib/admin-api.ts,
//    web/components/*. Black-box qua browser thật.)
//
// Derived ONLY from (black-box):
//   - plan 2026-07-17-giai-doan-5-admin-ui.md, Task 3 "Held-out" + Global
//     Constraints (list leads phân trang mới-nhất-trước; dropdown đổi status;
//     nút "Convert thành đơn" → tạo đơn nháp + lead converted + điều hướng đơn;
//     hiện SĐT/lời nhắn; phân trang UI trước/sau + tổng).
//   - SRS REQ-LEAD-004 (admin xem/quản lý leads /admin/leads),
//     REQ-LEAD-005 (convert lead→order; lead giữ FK order sau convert; KHÔNG tự
//     tạo customer — đơn lấy tên/SĐT từ lead).
//   - api/openapi.yaml:
//       GET   /admin/leads?limit&offset  → {items, total}; ORDER created_at DESC.
//       PATCH /admin/leads/{id} {status} → 200 Lead (status new|contacted|
//             converted|closed).
//       POST  /admin/leads/{id}/convert  → 201 {order_id, order_code};
//             lead.status='converted' + lead.order_id; convert lại → 409.
//   - skill run-moonie: admin admin@mooni.local / mooni-admin.
//
// HOW TO RUN — xem header playwright.admin-leads.config.ts. Yêu cầu FULL stack:
// Postgres(docker `postgres`) + API:8080 + Web:3000. Nếu /admin/leads CHƯA tồn
// tại (Task 3 chưa code) → các test FAIL rõ ("admin leads UI chưa dựng").
//
// DB (black-box): seed/verify/cleanup qua `docker compose exec -T postgres psql`
// (user/db `mooni`). Toàn bộ lead test có name prefix 'heldout-lui-' và được DỌN
// ở beforeAll + afterAll.
//   Ràng buộc FK leads.order_id ↔ orders → cleanup ĐÚNG THỨ TỰ:
//     (1) đọc + lưu order_id của các lead heldout (đơn do convert / do seed tạo),
//     (2) UPDATE leads SET order_id=NULL WHERE name LIKE 'heldout-lui-%',
//     (3) DELETE FROM orders theo id đã lưu + code LIKE 'HELDOUT-LUI-%'
//         (order_items cascade theo orders),
//     (4) DELETE FROM leads WHERE name LIKE 'heldout-lui-%'.
//   Convert KHÔNG được tạo customer → baseline count(customers) chụp ở beforeAll,
//   so lại sau convert (không đổi).
//
// SEED (created_at TƯƠNG LAI để CỤM leads heldout luôn NEWEST + liền nhau trên
// trang 1, thứ tự xác định, không bị lead thật xen kẽ):
//   z-newest (+10m) > m-mid (+8m) > status (+6m) > convert (+5m) > done (+4m)
//   > a-oldest (+2m). => mới-nhất-trước: z-newest phải đứng TRƯỚC a-oldest.
//
// LƯU Ý selector (structural, KHÔNG tied React internals):
//   - table shadcn = <table><tbody><tr>; row = tr chứa text tên lead.
//   - select/dropdown status: hỗ trợ CẢ native <select> LẪN shadcn/Radix
//     (role="combobox" trigger trong ROW → [role="option"] trong portal page).
//   - nút Convert: "Convert"/"Chuyển đơn"/"Chuyển thành đơn"/"Tạo đơn".
//   - phân trang: nút "Sau"/"Trước"/"Tiếp"/next|prev — best-effort nếu có.
// =============================================================================
import { test, expect, Page, Locator, BrowserContext } from '@playwright/test';
import { execSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@mooni.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'mooni-admin';

const NAME_PREFIX = 'heldout-lui-';
const SUFFIX = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

// Tên lead test (unique theo SUFFIX; cleanup theo prefix chung).
const N_NEWEST = `${NAME_PREFIX}${SUFFIX}-z-newest`;
const N_MID = `${NAME_PREFIX}${SUFFIX}-m-mid`;
const N_OLDEST = `${NAME_PREFIX}${SUFFIX}-a-oldest`;
const N_STATUS = `${NAME_PREFIX}${SUFFIX}-status`;
const N_CONVERT = `${NAME_PREFIX}${SUFFIX}-convert`;
const N_DONE = `${NAME_PREFIX}${SUFFIX}-done`; // đã converted sẵn (assert 5, độc lập)

// SĐT + lời nhắn distinct để assert hiện thông tin gọi lại (assert 6).
const PHONE_NEWEST = '0900110001';
const MSG_NEWEST = `loi-nhan-${SUFFIX}`;
const SEED_ORDER_CODE = `HELDOUT-LUI-${SUFFIX}`.toUpperCase();

let context: BrowserContext;
let page: Page;

let idStatus = '';
let idConvert = '';
let idDone = '';
let customersBaseline = 0;

// ---- DB helpers -------------------------------------------------------------
function psql(sql: string): string {
  const cmd = `docker compose exec -T postgres psql -U mooni -d mooni -tAc "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function leadField(id: string, field: string): string {
  return psql(`SELECT COALESCE(${field}::text,'') FROM leads WHERE id='${id}' LIMIT 1`);
}
function customersCount(): number {
  return parseInt(psql(`SELECT count(*) FROM customers`) || '0', 10);
}
function ordersCount(): number {
  return parseInt(psql(`SELECT count(*) FROM orders`) || '0', 10);
}
function seedLead(
  name: string,
  phone: string,
  message: string,
  status: string,
  offsetMinutes: number,
  orderId?: string,
): string {
  const cols = ['name', 'phone', 'message', 'source', 'status', 'created_at'];
  const vals = [
    `'${name}'`,
    `'${phone}'`,
    `'${message}'`,
    `'website'`,
    `'${status}'`,
    `now() + interval '${offsetMinutes} minutes'`,
  ];
  if (orderId) {
    cols.push('order_id');
    vals.push(`'${orderId}'`);
  }
  return psql(
    `INSERT INTO leads (${cols.join(',')}) VALUES (${vals.join(',')}) RETURNING id`,
  ).trim();
}
function cleanupDb(): void {
  // (1) lưu order_id do các lead heldout tham chiếu (convert-created + seeded).
  let orderIds: string[] = [];
  try {
    orderIds = psql(
      `SELECT order_id FROM leads WHERE name LIKE '${NAME_PREFIX}%' AND order_id IS NOT NULL`,
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch { /* ignore */ }
  // (2) gỡ FK trước khi xóa orders.
  try { psql(`UPDATE leads SET order_id=NULL WHERE name LIKE '${NAME_PREFIX}%'`); } catch { /* ignore */ }
  // (3) xóa orders (order_items cascade). Theo id đã lưu + theo code seeded.
  for (const oid of orderIds) {
    try { psql(`DELETE FROM orders WHERE id='${oid}'`); } catch { /* ignore */ }
  }
  try { psql(`DELETE FROM orders WHERE code LIKE 'HELDOUT-LUI-%'`); } catch { /* ignore */ }
  // (4) xóa leads heldout.
  try { psql(`DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%'`); } catch { /* ignore */ }
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

// ---- Leads page structural locators -----------------------------------------
async function gotoLeads(): Promise<void> {
  await page.goto('/admin/leads');
  await expect(page, 'Vào /admin/leads mà bị đá về login — guard/phiên sai')
    .not.toHaveURL(/\/admin\/login/);
  await expect(
    page.locator('table, [role="table"]').first(),
    'admin leads UI chưa dựng — không thấy bảng leads ở /admin/leads',
  ).toBeVisible({ timeout: 15_000 });
}
function leadRow(name: string): Locator {
  return page.locator('table tbody tr, [role="row"]').filter({ hasText: name }).first();
}

// Chọn giá trị status — hỗ trợ native <select> lẫn shadcn/Radix, scope = row.
async function chooseStatusInRow(row: Locator, optionRe: RegExp): Promise<boolean> {
  const selects = row.locator('select');
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
  const combos = row.locator(
    '[role="combobox"], button[aria-haspopup="listbox"], button[aria-haspopup="menu"], ' +
      'button[role="combobox"]',
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

function convertBtn(scope: Locator): Locator {
  return scope
    .locator(
      'button:has-text("Convert"), a:has-text("Convert"), ' +
        'button:has-text("Chuyển đơn"), a:has-text("Chuyển đơn"), ' +
        'button:has-text("Chuyển thành đơn"), a:has-text("Chuyển thành đơn"), ' +
        'button:has-text("Tạo đơn"), a:has-text("Tạo đơn"), ' +
        '[data-convert], button[aria-label*="convert" i], button[aria-label*="chuyển" i]',
    )
    .first();
}

// Vị trí (DOM index) của dòng chứa `name` trong danh sách row hiện tại.
async function rowIndexOf(name: string): Promise<number> {
  const texts = await page.locator('table tbody tr, [role="row"]').allTextContents();
  return texts.findIndex((t) => t.includes(name));
}

// ---- Setup / teardown -------------------------------------------------------
test.beforeAll(async ({ browser }) => {
  cleanupDb();
  customersBaseline = customersCount();

  // Seed cụm leads heldout (created_at tương lai → luôn newest + liền nhau).
  seedLead(N_NEWEST, PHONE_NEWEST, MSG_NEWEST, 'new', 10);
  seedLead(N_MID, '0900110002', `mid-${SUFFIX}`, 'new', 8);
  idStatus = seedLead(N_STATUS, '0900110003', `status-${SUFFIX}`, 'new', 6);
  idConvert = seedLead(N_CONVERT, '0900110004', `convert-${SUFFIX}`, 'new', 5);
  // Lead đã converted sẵn (assert 5) — tạo order seeded trước, gắn order_id.
  const seededOrderId = psql(
    `INSERT INTO orders (code, channel, status, subtotal, discount, total, note) ` +
      `VALUES ('${SEED_ORDER_CODE}','website','new',0,0,0,'seed converted lead heldout') RETURNING id`,
  ).trim();
  idDone = seedLead(N_DONE, '0900110005', `done-${SUFFIX}`, 'converted', 4, seededOrderId);
  seedLead(N_OLDEST, '0900110006', `oldest-${SUFFIX}`, 'new', 2);

  context = await browser.newContext({ baseURL: WEB_BASE });
  page = await context.newPage();
  await login();
});

test.afterAll(async () => {
  cleanupDb();
  await context?.close();
});

test.beforeEach(async () => {
  await gotoLeads();
});

// == Assert 1: Bảng leads hiện sau login → /admin/leads =======================
test('1. /admin/leads hiện bảng chứa các lead heldout (tên + SĐT + status)', async () => {
  await expect(
    leadRow(N_NEWEST),
    'Bảng admin phải liệt kê lead heldout vừa seed',
  ).toBeVisible({ timeout: 10_000 });

  const row = leadRow(N_NEWEST);
  // Hiện SĐT (chủ cần gọi lại) trong dòng.
  await expect(
    row.getByText(PHONE_NEWEST, { exact: false }),
    'Dòng lead phải hiện SĐT khách',
  ).toBeVisible({ timeout: 8_000 });
  // Hiện trạng thái lead (new/Mới) đâu đó trong dòng.
  const statusShown = await row
    .getByText(/new|mới/i)
    .first()
    .isVisible()
    .catch(() => false);
  expect(statusShown, 'Dòng lead phải hiện trạng thái (new/Mới)').toBe(true);
});

// == Assert 6: Hiện SĐT + lời nhắn khách (bảng hoặc chi tiết) ==================
test('6. bảng/chi tiết hiện SĐT + lời nhắn của khách (chủ cần thông tin gọi lại)', async () => {
  const row = leadRow(N_NEWEST);
  await expect(row, 'Không thấy dòng lead heldout để kiểm thông tin liên hệ').toBeVisible();

  // SĐT: bắt buộc hiện (ở bảng).
  await expect(
    page.getByText(PHONE_NEWEST, { exact: false }).first(),
    'Phải hiện SĐT khách ở /admin/leads',
  ).toBeVisible({ timeout: 8_000 });

  // Lời nhắn: hiện ở bảng HOẶC trong chi tiết (mở dòng nếu cần).
  let msgVisible = await page
    .getByText(MSG_NEWEST, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (!msgVisible) {
    // thử mở chi tiết: click nút/link chi tiết trong dòng, hoặc chính dòng.
    const detail = row
      .locator(
        'button:has-text("Chi tiết"), a:has-text("Chi tiết"), button:has-text("Xem"), ' +
          '[data-detail], button[aria-label*="chi tiết" i], [title*="Chi tiết" i]',
      )
      .first();
    if ((await detail.count()) > 0 && (await detail.isVisible().catch(() => false))) {
      await detail.click().catch(() => {});
    } else {
      await row.click().catch(() => {});
    }
    msgVisible = await page
      .getByText(MSG_NEWEST, { exact: false })
      .first()
      .isVisible({ timeout: 6_000 })
      .catch(() => false);
  }
  expect(
    msgVisible,
    'Phải hiện lời nhắn của khách (ở bảng hoặc trong chi tiết lead)',
  ).toBe(true);
});

// == Assert 2: Phân trang + mới-nhất-trước ====================================
test('2. leads sắp xếp mới-nhất-trước; phân trang (nếu có) đổi nội dung / hiện tổng', async () => {
  // Bắt buộc: z-newest (created_at trễ hơn) phải đứng TRƯỚC a-oldest.
  await expect(leadRow(N_NEWEST)).toBeVisible({ timeout: 10_000 });
  await expect(leadRow(N_OLDEST)).toBeVisible();
  const iNew = await rowIndexOf(N_NEWEST);
  const iOld = await rowIndexOf(N_OLDEST);
  expect(iNew, 'Không định vị được dòng lead mới nhất').toBeGreaterThanOrEqual(0);
  expect(iOld, 'Không định vị được dòng lead cũ nhất').toBeGreaterThanOrEqual(0);
  expect(
    iNew,
    'Leads phải mới-nhất-trước: lead mới hơn phải đứng TRƯỚC lead cũ hơn (ORDER created_at DESC)',
  ).toBeLessThan(iOld);

  // Best-effort: tổng số hiển thị (API trả total). Ghi chú: nếu không hiện thì bỏ qua.
  const totalShown = await page
    .getByText(/tổng|total|\d+\s*(lead|kết quả|bản ghi)/i)
    .first()
    .isVisible()
    .catch(() => false);

  // Best-effort: phân trang — nếu có nút "Sau/Tiếp/Next" ĐANG bật thì chuyển
  // trang phải đổi nội dung dòng đầu; rồi quay lại.
  const nextBtn = page
    .locator(
      'button:has-text("Sau"), a:has-text("Sau"), button:has-text("Tiếp"), ' +
        'a:has-text("Tiếp"), button:has-text("Next"), a:has-text("Next"), ' +
        '[aria-label*="sau" i], [aria-label*="next" i], [data-next-page]',
    )
    .first();
  const hasPager =
    (await nextBtn.count()) > 0 &&
    (await nextBtn.isVisible().catch(() => false)) &&
    !(await nextBtn.isDisabled().catch(() => true));
  if (hasPager) {
    const firstBefore = (await page.locator('table tbody tr, [role="row"]').first().textContent()) ?? '';
    await nextBtn.click();
    await page.waitForTimeout(1500);
    const firstAfter = (await page.locator('table tbody tr, [role="row"]').first().textContent()) ?? '';
    expect(
      firstAfter.trim(),
      'Chuyển sang trang sau phải đổi nội dung (dòng đầu khác trang trước)',
    ).not.toBe(firstBefore.trim());
  } else {
    // Data ít / không phân trang: chỉ cần mới-nhất-trước (đã assert ở trên).
    // totalShown là tín hiệu phụ, không FAIL nếu thiếu.
    expect(true).toBe(true);
    void totalShown;
  }
});

// == Assert 3: Đổi status qua dropdown/select → DB cập nhật ====================
test('3. đổi status lead heldout sang "contacted" qua dropdown → DB.status=contacted', async () => {
  expect(leadField(idStatus, 'status'), 'Precondition: lead status phải là new trước khi đổi').toBe('new');
  const row = leadRow(N_STATUS);
  await expect(row, `Không thấy dòng lead "${N_STATUS}" để đổi status`).toBeVisible({ timeout: 10_000 });

  const ok = await chooseStatusInRow(row, /contacted|đã liên hệ|liên hệ/i);
  expect(ok, 'Dòng lead phải có dropdown/select để đổi status sang "contacted"').toBe(true);

  // Có thể cần nút xác nhận/lưu (best-effort).
  const confirm = page
    .locator('button:has-text("Lưu"), button:has-text("Cập nhật"), button:has-text("Xác nhận")')
    .first();
  if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
    await confirm.click().catch(() => {});
  }

  await expect.poll(() => leadField(idStatus, 'status'), {
    message: 'Đổi status qua UI phải PATCH /admin/leads/{id} → DB.status=contacted',
    timeout: 12_000,
  }).toBe('contacted');
});

// == Assert 4: Convert lead → đơn nháp (KHÔNG tạo customer) ====================
test('4. convert lead "new" → tạo đơn: lead=converted + order_id set + có order mới; customers KHÔNG đổi',
  async () => {
    expect(leadField(idConvert, 'status'), 'Precondition: lead convert phải là new').toBe('new');
    const ordersBefore = ordersCount();

    const row = leadRow(N_CONVERT);
    await expect(row, `Không thấy dòng lead "${N_CONVERT}" để Convert`).toBeVisible({ timeout: 10_000 });
    const btn = convertBtn(row);
    await expect(btn, 'Dòng lead new phải có nút Convert/Chuyển đơn').toBeVisible({ timeout: 8_000 });
    await btn.click();

    // Có thể có dialog xác nhận convert.
    const confirm = page
      .locator(
        '[role="alertdialog"] button:has-text("Chuyển"), [role="dialog"] button:has-text("Chuyển"), ' +
          '[role="alertdialog"] button:has-text("Convert"), [role="dialog"] button:has-text("Convert"), ' +
          'button:has-text("Xác nhận"), button:has-text("Đồng ý")',
      )
      .first();
    if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
      await confirm.click().catch(() => {});
    }

    // DB: lead chuyển converted + order_id NOT NULL.
    await expect.poll(() => leadField(idConvert, 'status'), {
      message: 'Convert phải đặt lead.status=converted',
      timeout: 15_000,
    }).toBe('converted');
    const orderId = leadField(idConvert, 'order_id');
    expect(orderId, 'Convert phải gắn lead.order_id (FK tới order vừa tạo)').toMatch(
      /[0-9a-f-]{36}/i,
    );

    // Có order mới thực sự tồn tại + đúng là order được gắn.
    expect(
      parseInt(psql(`SELECT count(*) FROM orders WHERE id='${orderId}'`) || '0', 10),
      'Order do convert tạo phải tồn tại trong bảng orders',
    ).toBe(1);
    expect(
      ordersCount(),
      'Convert phải tạo đúng 1 order mới',
    ).toBe(ordersBefore + 1);

    // KHÔNG tạo customer (REQ-LEAD-005) + order.customer_id NULL.
    expect(
      customersCount(),
      'Convert KHÔNG được tạo customer — count(customers) phải KHÔNG đổi',
    ).toBe(customersBaseline);
    expect(
      leadField(idConvert, 'order_id') && psql(`SELECT COALESCE(customer_id::text,'') FROM orders WHERE id='${orderId}'`),
      'Order convert phải có customer_id NULL (không gắn khách tự động)',
    ).toBe('');

    // UI phản ánh: hoặc điều hướng tới đơn (/admin/orders...) HOẶC lead chuyển converted.
    await page.waitForTimeout(1500);
    const url = page.url();
    const navigatedToOrder = /\/admin\/orders/.test(url);
    let rowConverted = false;
    if (!navigatedToOrder) {
      await gotoLeads();
      const r = leadRow(N_CONVERT);
      if (await r.isVisible().catch(() => false)) {
        rowConverted = await r
          .getByText(/converted|đã chuyển|đã chốt|đơn/i)
          .first()
          .isVisible()
          .catch(() => false);
      }
    }
    expect(
      navigatedToOrder || rowConverted,
      'UI phải phản ánh convert: điều hướng tới đơn hoặc lead hiển thị "converted"',
    ).toBe(true);
  });

// == Assert 5: Lead đã converted → KHÔNG convert lần 2 ========================
test('5. lead đã converted → nút Convert disable/ẩn HOẶC convert lại báo lỗi (không tạo đơn 2)',
  async () => {
    expect(leadField(idDone, 'status'), 'Precondition: lead done phải converted').toBe('converted');
    const orderIdBefore = leadField(idDone, 'order_id');
    const ordersBefore = ordersCount();

    const row = leadRow(N_DONE);
    await expect(row, `Không thấy dòng lead đã converted "${N_DONE}"`).toBeVisible({ timeout: 10_000 });

    const btn = convertBtn(row);
    const present = (await btn.count()) > 0;
    const visible = present && (await btn.isVisible().catch(() => false));
    const disabled = visible && (await btn.isDisabled().catch(() => false));

    if (!present || !visible || disabled) {
      // Đạt: nút Convert ẩn hoặc disable với lead đã converted.
      expect(true).toBe(true);
    } else {
      // Nút vẫn bật → bấm phải KHÔNG tạo đơn thứ 2 (API 409) + báo lỗi.
      await btn.click();
      const confirm = page
        .locator('button:has-text("Xác nhận"), button:has-text("Đồng ý"), button:has-text("Chuyển")')
        .first();
      if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
        await confirm.click().catch(() => {});
      }
      await page.waitForTimeout(2500);
      // Không tạo đơn mới, order_id không đổi.
      expect(
        ordersCount(),
        'Convert lần 2 KHÔNG được tạo đơn mới',
      ).toBe(ordersBefore);
      expect(
        leadField(idDone, 'order_id'),
        'Convert lần 2 KHÔNG được đổi order_id của lead',
      ).toBe(orderIdBefore);
      const errVisible = await page
        .getByText(/đã.*convert|đã.*chuyển|lỗi|không thể|409|đã có đơn/i)
        .first()
        .isVisible()
        .catch(() => false);
      expect(errVisible, 'Convert lại lead đã converted phải hiện lỗi').toBe(true);
    }
  });
