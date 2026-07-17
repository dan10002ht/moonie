// =============================================================================
// HELD-OUT ACCEPTANCE TEST — Task 2 (Giai đoạn 5):
//   Admin UI quản lý sản phẩm — /admin/products: table list (gồm cả hidden),
//   dialog form tạo/sửa, upload ảnh, xóa (soft-delete → ẩn khỏi landing).
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
//   (CẤM generator đọc/sửa — mã hóa hành vi DỰ ĐỊNH của Task 2, KHÔNG đọc
//    web/app/admin/products/*, web/app/actions/admin.ts, web/lib/admin-api.ts,
//    web/components/*. Black-box qua browser thật.)
//
// Derived ONLY from (black-box):
//   - plan 2026-07-17-giai-doan-5-admin-ui.md, Task 2 "Held-out" + Global
//     Constraints (table list tất cả gồm hidden; dialog form CRUD; upload ảnh;
//     xóa mềm; validate client + lỗi API).
//   - SRS REQ-PROD-002 (admin CRUD sản phẩm: slug, tên, mô tả, giá, loại
//     gift_box|single_cake, trạng thái available|sold_out|hidden, ảnh, thứ tự),
//     REQ-PROD-003 (upload ảnh → uploads/, image_url set), REQ-PROD-001 (public
//     GET /products KHÔNG trả hidden).
//   - api/openapi.yaml: GET /admin/products (gồm hidden), POST /admin/products,
//     PUT/DELETE /admin/products/{id} (delete = soft: status='hidden'),
//     POST /admin/products/{id}/image (multipart field "file" → image_url).
//   - skill run-moonie: admin admin@mooni.local / mooni-admin; seed 7 sản phẩm
//     available (KHÔNG có hidden) — vd "Nguyệt Quang Kim" (slug nguyet-quang-kim).
//
// HOW TO RUN — xem header playwright.admin-products.config.ts. Yêu cầu FULL
// stack: Postgres(docker `postgres`) + API:8080 + Web:3000. Nếu /admin/products
// CHƯA tồn tại (Task 2 chưa code) → các test FAIL rõ ("admin products UI chưa
// dựng — không thấy bảng sản phẩm").
//
// DB: query/verify/cleanup qua `docker compose exec -T postgres psql` (user/db
// `mooni`). Mọi sản phẩm test dùng slug prefix 'heldout-ui-' và được DỌN ở
// beforeAll + afterAll (products test KHÔNG gắn order → xóa cứng an toàn, không
// vướng FK order_items).
//
// LƯU Ý selector (structural, KHÔNG tied React internals):
//   - table shadcn = <table><tbody><tr>; row = tr chứa text tên/slug.
//   - form = [role="dialog"] chứa input slug/name.
//   - select loại/trạng thái: hỗ trợ CẢ native <select> LẪN shadcn/Radix
//     (role="combobox" trigger → [role="option"] trong portal).
//   - upload: input[type=file] + Playwright setInputFiles(file PNG tạm).
//   - phân biệt "admin list gồm hidden" vs "landing ẩn hidden": admin table đọc
//     GET /admin/products (gồm hidden); landing đọc public GET /products (loại
//     hidden) → assert 2 & 5 kiểm bằng public API :8080 GET /products.
// =============================================================================
import { test, expect, Page, Locator, BrowserContext } from '@playwright/test';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:8080';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@mooni.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'mooni-admin';

const SLUG_PREFIX = 'heldout-ui-';
const SUFFIX = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const SLUG = `${SLUG_PREFIX}${SUFFIX}`;       // sản phẩm test chính (create→edit→upload→delete)
const NAME = `${SLUG_PREFIX}${SUFFIX}`;        // tên = slug cho dễ định vị trong bảng
const BAD_SLUG = `${SLUG_PREFIX}invalid-${SUFFIX}`; // sản phẩm test validate (KHÔNG được tạo)

let context: BrowserContext;
let page: Page;
let pngPath: string;

// ---- DB helpers (black-box; verify persistence + cleanup) --------------------
function psql(sql: string): string {
  const cmd = `docker compose exec -T postgres psql -U mooni -d mooni -tAc "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function productCount(slug: string): number {
  return parseInt(psql(`SELECT count(*) FROM products WHERE slug='${slug}'`) || '0', 10);
}
function productField(slug: string, field: string): string {
  return psql(`SELECT COALESCE(${field}::text,'') FROM products WHERE slug='${slug}' LIMIT 1`);
}
function cleanupDb(): void {
  // xóa file ảnh test trước (đọc image_url khi rows còn tồn tại), rồi xóa rows.
  try {
    const urls = psql(
      `SELECT image_url FROM products WHERE slug LIKE '${SLUG_PREFIX}%' AND image_url IS NOT NULL AND image_url<>''`,
    );
    for (const u of urls.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const base = path.basename(u);
      if (base) {
        try {
          execSync(`find "${REPO_ROOT}" -type f -name "${base}" -path "*uploads*" -delete`, {
            cwd: REPO_ROOT,
          });
        } catch { /* best-effort */ }
      }
    }
  } catch { /* ignore */ }
  try { psql(`DELETE FROM products WHERE slug LIKE '${SLUG_PREFIX}%'`); } catch { /* ignore */ }
}

async function inPublicList(slug: string): Promise<boolean> {
  const r = await page.request.get(`${API_BASE}/api/v1/products`, { failOnStatusCode: false });
  if (!r.ok()) return false;
  const arr = (await r.json()) as Array<{ slug?: string }>;
  return Array.isArray(arr) && arr.some((p) => p.slug === slug);
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

// ---- Products page structural locators --------------------------------------
async function gotoProducts(): Promise<void> {
  await page.goto('/admin/products');
  await expect(page, 'Vào /admin/products mà bị đá về login — guard/phiên sai')
    .not.toHaveURL(/\/admin\/login/);
  await expect(
    page.locator('table, [role="table"]').first(),
    'admin products UI chưa dựng — không thấy bảng sản phẩm ở /admin/products',
  ).toBeVisible({ timeout: 15_000 });
}
function productRow(text: string): Locator {
  return page.locator('table tbody tr, [role="row"]').filter({ hasText: text }).first();
}
function formDialog(): Locator {
  return page
    .locator('[role="dialog"], dialog, form')
    .filter({ has: page.locator('input[name="slug"], input[name="name"]') })
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
  const add = page
    .locator(
      'button:has-text("Thêm"), a:has-text("Thêm"), [data-add-product], ' +
        'button:has-text("Tạo sản phẩm"), button[aria-label*="thêm" i], [title*="Thêm" i]',
    )
    .first();
  await expect(add, 'Trang /admin/products phải có nút Thêm sản phẩm').toBeVisible({ timeout: 10_000 });
  await add.click();
  const d = formDialog();
  await expect(d, 'Bấm Thêm phải mở form/dialog tạo sản phẩm (chứa input slug/name)').toBeVisible();
  return d;
}
async function openEditForm(name: string): Promise<Locator> {
  const row = productRow(name);
  await expect(row, `Không thấy dòng sản phẩm "${name}" trong bảng để Sửa`).toBeVisible();
  const edit = row
    .locator(
      'button:has-text("Sửa"), a:has-text("Sửa"), [data-edit], ' +
        'button[aria-label*="sửa" i], a[aria-label*="sửa" i], [title*="Sửa" i]',
    )
    .first();
  await expect(edit, `Dòng "${name}" phải có nút Sửa`).toBeVisible({ timeout: 8_000 });
  await edit.click();
  const d = formDialog();
  await expect(d, 'Bấm Sửa phải mở form/dialog sửa sản phẩm').toBeVisible();
  return d;
}
async function setInput(scope: Locator, name: string, labelRe: RegExp, value: string): Promise<void> {
  let loc = scope.locator(`input[name="${name}"], textarea[name="${name}"]`).first();
  if ((await loc.count()) === 0) loc = scope.getByLabel(labelRe).first();
  await expect(loc, `Form thiếu trường "${name}"`).toBeVisible();
  await loc.fill('');
  await loc.fill(value);
}
// Chọn giá trị cho select loại/trạng thái — hỗ trợ native <select> lẫn shadcn/Radix.
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
    '[role="combobox"], button[aria-haspopup="listbox"], button[role="combobox"]',
  );
  const cn = await combos.count();
  for (let i = 0; i < cn; i++) {
    await combos.nth(i).click();
    const option = page.locator('[role="option"]').filter({ hasText: optionRe }).first();
    if ((await option.count()) > 0 && (await option.isVisible().catch(() => false))) {
      await option.click();
      return true;
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  return false;
}
async function fillProductCore(
  d: Locator,
  opts: { slug: string; name: string; price: string; typeRe: RegExp; statusRe: RegExp },
): Promise<void> {
  await setInput(d, 'name', /tên/i, opts.name);
  await setInput(d, 'slug', /slug|định danh|đường dẫn/i, opts.slug);
  await setInput(d, 'price', /giá(?!\s*gốc)/i, opts.price);
  const okType = await chooseOption(d, opts.typeRe);
  expect(okType, 'Form thiếu chọn LOẠI sản phẩm (gift_box/single_cake)').toBe(true);
  const okStatus = await chooseOption(d, opts.statusRe);
  expect(okStatus, 'Form thiếu chọn TRẠNG THÁI sản phẩm (available/sold_out/hidden)').toBe(true);
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
  // 1x1 PNG đỏ (base64) → file tạm để upload.
  pngPath = path.join(os.tmpdir(), `heldout-ui-${SUFFIX}.png`);
  const pngB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fs.writeFileSync(pngPath, Buffer.from(pngB64, 'base64'));

  context = await browser.newContext({ baseURL: WEB_BASE });
  page = await context.newPage();
  await login();
});

test.afterAll(async () => {
  cleanupDb();
  try { if (pngPath && fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch { /* ignore */ }
  await context?.close();
});

test.beforeEach(async () => {
  await gotoProducts();
});

// == Assert 1: Bảng liệt kê sản phẩm (seed available hiện) =====================
test('1. /admin/products hiện bảng chứa sản phẩm seed ("Nguyệt Quang Kim")', async () => {
  await expect(
    productRow('Nguyệt Quang Kim'),
    'Bảng admin phải liệt kê sản phẩm seed "Nguyệt Quang Kim"',
  ).toBeVisible({ timeout: 10_000 });
});

// == Assert 6: Validate — giá âm KHÔNG được tạo (chạy sớm, độc lập chuỗi CRUD) ==
test('6. tạo với giá ÂM → form báo lỗi / không đóng, KHÔNG tạo sản phẩm', async () => {
  const d = await openAddForm();
  await fillProductCore(d, {
    slug: BAD_SLUG,
    name: BAD_SLUG,
    price: '-1000',
    typeRe: /gift_box|hộp|quà/i,
    statusRe: /hidden|ẩn/i,
  });
  await saveBtn(d).click();
  await page.waitForTimeout(2000);

  // KHÔNG được lưu vào DB (client chặn hoặc API trả 400).
  expect(productCount(BAD_SLUG), 'Giá âm KHÔNG được tạo sản phẩm trong DB').toBe(0);

  // Phải có tín hiệu lỗi: dialog vẫn mở HOẶC thông báo lỗi hiện.
  const dialogStillOpen =
    (await d.count()) > 0 && (await d.isVisible().catch(() => false));
  const errVisible = await page
    .getByText(/lỗi|không hợp lệ|không được|phải|≥|>= *0|âm|invalid|bắt buộc/i)
    .first()
    .isVisible()
    .catch(() => false);
  expect(
    dialogStillOpen || errVisible,
    'Giá âm phải hiện lỗi hoặc giữ form mở (không âm thầm bỏ qua)',
  ).toBe(true);

  await closeDialogIfOpen();
});

// == Assert 2: Tạo sản phẩm (status=hidden) → hiện trong bảng admin, KHÔNG landing
test('2. tạo sản phẩm hidden qua form → hiện trong bảng admin + có trong DB; KHÔNG có ở landing public',
  async () => {
    const d = await openAddForm();
    await fillProductCore(d, {
      slug: SLUG,
      name: NAME,
      price: '250000',
      typeRe: /gift_box|hộp|quà/i,
      statusRe: /hidden|ẩn/i,
    });
    await saveBtn(d).click();

    // DB xác nhận đã tạo, đúng status hidden.
    await expect.poll(() => productCount(SLUG), {
      message: 'Sản phẩm mới phải được lưu vào bảng products',
      timeout: 12_000,
    }).toBe(1);
    expect(productField(SLUG, 'status'), 'Sản phẩm mới phải có status=hidden').toBe('hidden');

    // Xuất hiện trong bảng admin (admin list gồm cả hidden).
    await gotoProducts();
    await expect(
      productRow(NAME),
      'Sản phẩm hidden vừa tạo PHẢI hiện trong bảng admin (admin list gồm hidden)',
    ).toBeVisible({ timeout: 10_000 });

    // KHÔNG có ở landing public (GET /products loại hidden).
    await expect.poll(() => inPublicList(SLUG), {
      message: 'Sản phẩm hidden KHÔNG được xuất hiện ở landing public GET /products',
      timeout: 8_000,
    }).toBe(false);
  });

// == Assert 3: Sửa — đổi giá + trạng thái → DB phản ánh giá trị mới ============
test('3. sửa sản phẩm test → đổi giá & trạng thái → DB cập nhật', async () => {
  expect(productCount(SLUG), 'Cần sản phẩm test (assert 2) tồn tại để sửa').toBe(1);
  const d = await openEditForm(NAME);

  // Form sửa phải nạp sẵn slug/tên cũ.
  await setInput(d, 'price', /giá(?!\s*gốc)/i, '333000');
  const okStatus = await chooseOption(d, /available|đang bán|còn hàng/i);
  expect(okStatus, 'Form sửa phải cho đổi trạng thái sang available').toBe(true);
  await saveBtn(d).click();

  await expect.poll(() => productField(SLUG, 'price'), {
    message: 'Giá mới phải được lưu vào DB sau khi sửa',
    timeout: 12_000,
  }).toBe('333000');
  expect(productField(SLUG, 'status'), 'Trạng thái mới phải là available sau khi sửa').toBe('available');
});

// == Assert 4: Upload ảnh trong form sửa → image_url được set =================
test('4. upload ảnh PNG trong form sửa → products.image_url được set', async () => {
  expect(productCount(SLUG), 'Cần sản phẩm test tồn tại để upload ảnh').toBe(1);
  const d = await openEditForm(NAME);

  const fileInput = d.locator('input[type="file"]');
  await expect(fileInput.first(), 'Form sửa phải có input[type=file] để upload ảnh')
    .toBeAttached({ timeout: 8_000 });
  await fileInput.first().setInputFiles(pngPath);

  // Một số impl cần nút "Tải lên"/"Upload" riêng; nếu có thì bấm.
  const uploadBtn = d
    .locator('button:has-text("Tải lên"), button:has-text("Tải"), button:has-text("Upload")')
    .first();
  if ((await uploadBtn.count()) > 0 && (await uploadBtn.isVisible().catch(() => false))) {
    await uploadBtn.click();
  }
  // Lưu form (nếu image_url gắn khi lưu form thay vì upload tức thì).
  const save = saveBtn(d);
  if ((await save.count()) > 0 && (await save.isVisible().catch(() => false))) {
    await save.click().catch(() => {});
  }

  await expect.poll(() => productField(SLUG, 'image_url'), {
    message: 'Sau upload, products.image_url phải được set (REQ-PROD-003)',
    timeout: 20_000,
  }).toMatch(/\/uploads\/.+/);
});

// == Assert 5: Xóa (soft-delete) → ẩn khỏi landing public ======================
test('5. xóa sản phẩm test → status=hidden + biến mất khỏi landing public GET /products',
  async () => {
    expect(productCount(SLUG), 'Cần sản phẩm test tồn tại để xóa').toBe(1);
    const row = productRow(NAME);
    await expect(row, `Không thấy dòng "${NAME}" để xóa`).toBeVisible();
    const del = row
      .locator(
        'button:has-text("Xóa"), a:has-text("Xóa"), [data-delete], ' +
          'button[aria-label*="xóa" i], [title*="Xóa" i]',
      )
      .first();
    await expect(del, `Dòng "${NAME}" phải có nút Xóa`).toBeVisible({ timeout: 8_000 });
    await del.click();

    // Có thể có dialog xác nhận → bấm nút xác nhận.
    const confirm = page
      .locator(
        '[role="alertdialog"] button:has-text("Xóa"), [role="dialog"] button:has-text("Xóa"), ' +
          'button:has-text("Xác nhận"), button:has-text("Đồng ý")',
      )
      .first();
    if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
      await confirm.click();
    }

    // Soft-delete: status='hidden' (spec: an toàn với FK order_items).
    await expect.poll(() => productField(SLUG, 'status'), {
      message: 'Xóa = soft-delete → status phải thành hidden',
      timeout: 12_000,
    }).toBe('hidden');

    // Hệ quả nghiệp vụ: KHÔNG còn ở landing public.
    await expect.poll(() => inPublicList(SLUG), {
      message: 'Sau khi xóa, sản phẩm KHÔNG được còn ở landing public GET /products',
      timeout: 8_000,
    }).toBe(false);
  });
