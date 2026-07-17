// =============================================================================
// HELD-OUT ACCEPTANCE TEST — Task 4 (Giai đoạn 5):
//   Admin UI quản lý đơn hàng — /admin/orders: table phân trang (mới-nhất-trước),
//   form TẠO ĐƠN nhiều dòng món (chọn kênh + product picker + số lượng + giảm
//   giá → tổng tạm tính), CHI TIẾT đơn (món snapshot + tổng), ĐỔI STATUS
//   (new→confirmed; terminal done/cancelled không đổi được).
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
//   (CẤM generator đọc/sửa — mã hóa hành vi DỰ ĐỊNH của Task 4, KHÔNG đọc
//    web/app/admin/orders/*, web/app/actions/admin.ts, web/lib/admin-api.ts,
//    web/components/*. Black-box qua browser thật.)
//
// Derived ONLY from (black-box):
//   - plan 2026-07-17-giai-doan-5-admin-ui.md, Task 4 "Held-out" + Global
//     Constraints (list đơn phân trang; form tạo đơn: kênh, khách optional,
//     thêm/bớt dòng món [product picker + quantity], giảm giá → tổng tạm tính;
//     chi tiết đơn: món snapshot + đổi status chặn terminal; phân trang trước/sau).
//   - SRS REQ-ORD-001 (admin tạo/quản lý đơn /admin/orders; customer nullable;
//     channel website|phone|zalo|fb; discount; note...), REQ-ORD-002 (chuỗi status
//     new→confirmed→delivering→done|cancelled), REQ-ORD-003 (tạo đơn + items trong
//     1 transaction), REQ-ORD-004 (SNAPSHOT product_name + unit_price lúc tạo).
//   - api/openapi.yaml:
//       GET   /admin/orders?limit&offset → {items,total}; ORDER created_at DESC.
//       POST  /admin/orders {channel, customer_id?, discount?, note?,
//             items:[{product_id, quantity}]} → 201 {id, code}. subtotal =
//             Σ(unit_price×quantity), total = subtotal − discount. items rỗng /
//             quantity≤0 / discount>subtotal / product không tồn tại → 400.
//       GET   /admin/orders/{id} → OrderDetail (items snapshot product_name/
//             unit_price/quantity).
//       PATCH /admin/orders/{id} {status} → 200; status không hợp lệ / đơn
//             terminal (done|cancelled) đổi status → 400.
//   - DB (0007_orders.up.sql): orders(code,customer_id,channel,status,subtotal,
//     discount,total,note,created_at); order_items(order_id,product_id,
//     product_name,unit_price,quantity) ON DELETE CASCADE theo orders.
//     leads.order_id FK → orders (nullable).
//   - skill run-moonie: admin admin@mooni.local / mooni-admin; seed sản phẩm
//     "Nguyệt Quang Kim" (slug nguyet-quang-kim, status available).
//
// HOW TO RUN — xem header playwright.admin-orders.config.ts. Yêu cầu FULL stack:
// Postgres(docker `postgres`) + API:8080 + Web:3000. Nếu /admin/orders CHƯA tồn
// tại (Task 4 chưa code) → các test FAIL rõ ("admin orders UI chưa dựng").
//
// DB (black-box): seed/verify/cleanup qua `docker compose exec -T postgres psql`
// (user/db `mooni`, cờ -q -P pager=off để robust bất kể ~/.psqlrc). Trích UUID
// bằng regex (robust với command-tag). Mọi đơn test mang:
//   - code prefix 'HELDOUT-OUI-%'  (đơn seed phân trang + đơn done terminal), HOẶC
//   - note LIKE '%heldout-oui%'    (đơn seed + đơn tạo qua form nếu form có note),
//   - + id trả về khi tạo qua form (lưu để cleanup dù form không set note/code).
// CLEANUP đúng thứ tự FK order↔order_items↔leads.order_id:
//   (1) UPDATE leads SET order_id=NULL WHERE order_id thuộc đơn heldout,
//   (2) DELETE orders (order_items CASCADE) theo id-đã-lưu + code + note.
// KHÔNG xóa sản phẩm seed. Convert-created/customer test: không tạo customer.
//
// LƯU Ý selector (structural, KHÔNG tied React internals):
//   - table shadcn = <table><tbody><tr>; row = tr chứa text (mã đơn / note).
//   - form tạo đơn = [role="dialog"] hoặc <form>; nhiều <select>/Radix combobox
//     (kênh + khách + product picker) → phân biệt bằng NỘI DUNG option (option
//     chứa tên sản phẩm = product picker; chứa website/phone = kênh).
//   - product picker + quantity + discount: input theo name*/aria-label; hỗ trợ
//     CẢ native <select> LẪN shadcn/Radix ([role=combobox] → [role=option] portal).
//   - nút "Tạo đơn"/"Thêm đơn" mở form; "Thêm dòng/món" thêm dòng; submit form.
//   - phân trang: nút "Sau"/"Trước"/"Tiếp"/next|prev.
// =============================================================================
import { test, expect, Page, Locator, BrowserContext } from '@playwright/test';
import { execSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@mooni.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'mooni-admin';

const SEED_PRODUCT_SLUG = 'nguyet-quang-kim';
const SEED_PRODUCT_NAME = 'Nguyệt Quang Kim';

const SUFFIX = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const CODE_PREFIX = 'HELDOUT-OUI-';
const NOTE_MARKER = `heldout-oui-${SUFFIX}`;
const DONE_CODE = `${CODE_PREFIX}${SUFFIX}-DONE`.toUpperCase();

const QTY = 2;
let seedProductId = '';
let seedProductPrice = 0;
let discountToUse = 50_000;

let context: BrowserContext;
let page: Page;

// State chia sẻ giữa các test (workers=1, tuần tự theo file order).
const createdOrderIds: string[] = [];
let createdOrderId = '';
let createdOrderCode = '';
let doneOrderId = '';

// ---- DB helpers -------------------------------------------------------------
function psql(sql: string): string {
  // -q + -P pager=off: robust bất kể ~/.psqlrc / command tag.
  const cmd =
    `docker compose exec -T postgres psql -U mooni -d mooni -q -P pager=off -tAc "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function psqlInsertId(sql: string): string {
  const out = psql(sql);
  const m = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) throw new Error(`Không lấy được UUID từ INSERT RETURNING (output: ${JSON.stringify(out)})`);
  return m[0];
}
function orderField(id: string, field: string): string {
  return psql(`SELECT COALESCE(${field}::text,'') FROM orders WHERE id='${id}' LIMIT 1`);
}
function ordersCount(): number {
  return parseInt(psql(`SELECT count(*) FROM orders`) || '0', 10);
}
function allOrderIds(): Set<string> {
  const out = psql(`SELECT id FROM orders`);
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}
// Đợi 1 order mới xuất hiện (id không thuộc `before`) → trả về id đó.
async function waitNewOrderId(before: Set<string>): Promise<string> {
  let found = '';
  await expect
    .poll(
      () => {
        const now = allOrderIds();
        for (const id of now) {
          if (!before.has(id)) {
            found = id;
            return id;
          }
        }
        return '';
      },
      { message: 'Tạo đơn qua form phải tạo đúng 1 order mới trong DB (POST /admin/orders → 201)', timeout: 20_000 },
    )
    .not.toBe('');
  return found;
}

function cleanupDb(): void {
  // Gom mọi order heldout: id đã lưu + code prefix + note marker.
  let ids = new Set<string>(createdOrderIds.filter(Boolean));
  try {
    const byCodeNote = psql(
      `SELECT id FROM orders WHERE code LIKE '${CODE_PREFIX}%' OR note LIKE '%heldout-oui%'`,
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of byCodeNote) ids.add(id);
  } catch { /* ignore */ }
  // (1) gỡ FK leads.order_id trỏ tới các đơn này.
  for (const id of ids) {
    try { psql(`UPDATE leads SET order_id=NULL WHERE order_id='${id}'`); } catch { /* ignore */ }
  }
  // (2) xóa orders (order_items CASCADE).
  for (const id of ids) {
    try { psql(`DELETE FROM orders WHERE id='${id}'`); } catch { /* ignore */ }
  }
  try { psql(`DELETE FROM orders WHERE code LIKE '${CODE_PREFIX}%'`); } catch { /* ignore */ }
  try { psql(`DELETE FROM orders WHERE note LIKE '%heldout-oui%'`); } catch { /* ignore */ }
}

// ---- Tiền tệ: regex khớp số VND ở nhiều định dạng (250000 / 250.000 / 250,000 / 250 000)
function moneyRegex(n: number): RegExp {
  const raw = String(n);
  const grouped = raw.replace(/\B(?=(\d{3})+(?!\d))/g, '[.,\\s]?');
  return new RegExp(grouped);
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

// ---- Orders page structural locators ----------------------------------------
async function gotoOrders(): Promise<void> {
  await page.goto('/admin/orders');
  await expect(page, 'Vào /admin/orders mà bị đá về login — guard/phiên sai')
    .not.toHaveURL(/\/admin\/login/);
  await expect(
    page.locator('table, [role="table"]').first(),
    'admin orders UI chưa dựng — không thấy bảng đơn hàng ở /admin/orders',
  ).toBeVisible({ timeout: 15_000 });
}
function orderRow(text: string): Locator {
  return page.locator('table tbody tr, [role="row"]').filter({ hasText: text }).first();
}
async function closeDialogIfOpen(): Promise<void> {
  const d = page.locator('[role="dialog"], dialog').first();
  if ((await d.count()) > 0 && (await d.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
}

// Mở form tạo đơn → trả dialog/form (scope chứa các control tạo đơn).
async function openCreateForm(): Promise<Locator> {
  const add = page
    .getByRole('button', { name: /tạo đơn|thêm đơn|đơn mới|tạo đơn hàng/i })
    .first();
  const addFallback = page.locator(
    'button:has-text("Tạo đơn"), a:has-text("Tạo đơn"), button:has-text("Thêm đơn"), ' +
      '[data-add-order], button[aria-label*="tạo đơn" i], [title*="Tạo đơn" i]',
  ).first();
  const btn = (await add.count()) > 0 ? add : addFallback;
  await expect(btn, 'Trang /admin/orders phải có nút "Tạo đơn"/"Thêm đơn"').toBeVisible({ timeout: 10_000 });
  await btn.click();
  const d = page
    .locator('[role="dialog"], dialog, form')
    .filter({
      has: page.locator(
        'select, [role="combobox"], input[name*="quantity" i], input[name*="discount" i], input[type="number"]',
      ),
    })
    .first();
  await expect(d, 'Bấm "Tạo đơn" phải mở form/dialog tạo đơn (kênh + dòng món + giảm giá)').toBeVisible({
    timeout: 8_000,
  });
  return d;
}

// Chọn 1 option cho select/combobox trong `scope` — native <select> + shadcn/Radix.
// Trả về true nếu chọn thành công (khớp value HOẶC text theo optionRe).
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

// ---- Setup / teardown -------------------------------------------------------
test.beforeAll(async ({ browser }) => {
  // Precondition: sản phẩm seed tồn tại (dùng làm dòng món + verify snapshot giá).
  seedProductId = psql(`SELECT id FROM products WHERE slug='${SEED_PRODUCT_SLUG}' LIMIT 1`);
  expect(
    seedProductId,
    `Precondition: cần sản phẩm seed "${SEED_PRODUCT_NAME}" (slug ${SEED_PRODUCT_SLUG}) — chạy make seed`,
  ).toMatch(/[0-9a-f-]{36}/i);
  seedProductPrice = parseInt(psql(`SELECT price FROM products WHERE slug='${SEED_PRODUCT_SLUG}'`) || '0', 10);
  expect(seedProductPrice, 'Giá sản phẩm seed phải > 0').toBeGreaterThan(0);
  // Bảo đảm discount hợp lệ (< subtotal) để API không 400 vì discount>subtotal.
  discountToUse = seedProductPrice * QTY > 50_000 ? 50_000 : 0;

  cleanupDb();

  // Đơn DONE (terminal) — future date → nằm TOP trang 1 để test 7 định vị được.
  doneOrderId = psqlInsertId(
    `INSERT INTO orders (code, channel, status, subtotal, discount, total, note, created_at) ` +
      `VALUES ('${DONE_CODE}','website','done',100000,0,100000,'${NOTE_MARKER}-done', now() + interval '30 minutes') RETURNING id`,
  );
  createdOrderIds.push(doneOrderId);

  // 25 đơn seed cho phân trang — PAST date → nằm cuối danh sách (trang sau),
  // KHÔNG chèn lên trên đơn tạo qua form (giữ đơn form ở trang 1 cho test 3/4).
  psql(
    `INSERT INTO orders (code, channel, status, subtotal, discount, total, note, created_at) ` +
      `SELECT '${CODE_PREFIX}${SUFFIX}-P'||g,'website','new',100000,0,100000,'${NOTE_MARKER}-page', ` +
      `now() - (g * interval '1 hour') FROM generate_series(1,25) AS g`,
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
  await gotoOrders();
});

// == Assert 1: Bảng đơn hàng hiện sau login → /admin/orders ====================
test('1. /admin/orders hiện bảng đơn hàng (chứa đơn seed HELDOUT-OUI)', async () => {
  // Bảng phải render (rỗng/empty-state chấp nhận nếu không có đơn — nhưng ở đây đã seed).
  await expect(
    page.locator('table, [role="table"]').first(),
    'admin orders UI chưa dựng — không thấy bảng đơn ở /admin/orders',
  ).toBeVisible({ timeout: 10_000 });
  // Có đơn seed → phải thấy ít nhất 1 dòng đơn heldout (mã HELDOUT-OUI...).
  await expect(
    orderRow(DONE_CODE),
    'Bảng admin phải liệt kê đơn hàng vừa seed (mã HELDOUT-OUI-...-DONE)',
  ).toBeVisible({ timeout: 10_000 });
});

// == Assert 2: Tạo đơn qua form nhiều dòng món → 201 + DB đúng (snapshot + tổng)
test('2. tạo đơn qua form (kênh + 1 dòng món x2 + giảm giá) → order status=new, item snapshot, tổng đúng',
  async () => {
    const before = allOrderIds();
    const d = await openCreateForm();

    // (a) Chọn kênh — best-effort: form thường default 'website' (DB default).
    //     Không hard-fail nếu control kênh không tách bạch được; DB CHECK đảm bảo hợp lệ.
    await chooseOption(d, /^website$|website|trang web|^web$|online/i).catch(() => false);

    // (b) Thêm 1 dòng món nếu form chưa có sẵn dòng trống.
    const addLine = d
      .locator(
        'button:has-text("Thêm dòng"), button:has-text("Thêm món"), button:has-text("Thêm sản phẩm"), ' +
          'button:has-text("Thêm dòng món"), [data-add-line], [data-add-item], ' +
          'button[aria-label*="thêm dòng" i], button[aria-label*="thêm món" i]',
      )
      .first();
    if ((await addLine.count()) > 0 && (await addLine.isVisible().catch(() => false))) {
      await addLine.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // (c) Chọn sản phẩm (product picker) = "Nguyệt Quang Kim". BẮT BUỘC.
    let okProduct = await chooseOption(d, new RegExp(SEED_PRODUCT_NAME, 'i'));
    if (!okProduct && (await addLine.count()) > 0 && (await addLine.isVisible().catch(() => false))) {
      // thử thêm dòng rồi chọn lại
      await addLine.click().catch(() => {});
      await page.waitForTimeout(300);
      okProduct = await chooseOption(d, new RegExp(SEED_PRODUCT_NAME, 'i'));
    }
    expect(okProduct, 'Form tạo đơn phải có product picker chọn được sản phẩm seed (dòng món)').toBe(true);

    // (d) Số lượng = 2. BẮT BUỘC có input số lượng.
    let qtyInput = d
      .locator(
        'input[name*="quantity" i], input[name*="qty" i], input[name*="so_luong" i], ' +
          'input[name*="soluong" i], input[aria-label*="số lượng" i], input[placeholder*="số lượng" i]',
      )
      .first();
    if ((await qtyInput.count()) === 0) {
      // fallback: input number không phải discount → lấy cái đầu.
      qtyInput = d.locator('input[type="number"]').first();
    }
    await expect(qtyInput, 'Form tạo đơn phải có ô Số lượng cho dòng món').toBeVisible({ timeout: 8_000 });
    await qtyInput.fill('');
    await qtyInput.fill(String(QTY));

    // (e) Giảm giá = 50000. Plan yêu cầu form có discount.
    let discountInput = d
      .locator(
        'input[name*="discount" i], input[name*="giam" i], input[aria-label*="giảm giá" i], ' +
          'input[aria-label*="giảm" i], input[placeholder*="giảm" i]',
      )
      .first();
    if ((await discountInput.count()) === 0) {
      const byLabel = d.getByLabel(/giảm giá|giảm/i).first();
      if ((await byLabel.count()) > 0) discountInput = byLabel;
    }
    await expect(discountInput, 'Form tạo đơn phải có ô Giảm giá (discount)').toBeVisible({ timeout: 8_000 });
    await discountInput.fill('');
    await discountInput.fill(String(discountToUse));

    // (f) note marker (nếu form có ô ghi chú) → giúp cleanup nhận diện đơn form.
    const noteField = d
      .locator('textarea[name*="note" i], input[name*="note" i], textarea[name*="ghi_chu" i]')
      .first();
    if ((await noteField.count()) > 0 && (await noteField.isVisible().catch(() => false))) {
      await noteField.fill(NOTE_MARKER).catch(() => {});
    }

    // (g) Best-effort: form hiện TỔNG TẠM TÍNH (subtotal). Không fail nếu định dạng khác.
    const expectedSubtotal = seedProductPrice * QTY;
    const subtotalShown = await d
      .getByText(moneyRegex(expectedSubtotal))
      .first()
      .isVisible()
      .catch(() => false);
    void subtotalShown; // tín hiệu phụ, không FAIL cứng (định dạng VND biến thiên).

    // (h) Submit.
    const submit = d
      .locator(
        'button[type="submit"], button:has-text("Tạo đơn"), button:has-text("Lưu"), ' +
          'button:has-text("Tạo"), button:has-text("Hoàn tất")',
      )
      .first();
    await expect(submit, 'Form tạo đơn phải có nút submit').toBeVisible();
    await submit.click();

    // DB: order mới xuất hiện.
    createdOrderId = await waitNewOrderId(before);
    createdOrderIds.push(createdOrderId);
    createdOrderCode = orderField(createdOrderId, 'code');
    expect(createdOrderCode, 'Order tạo qua form phải có mã đơn (code)').not.toBe('');

    // order fields: status=new, subtotal/discount/total đúng công thức.
    const expectedSubtotalDb = seedProductPrice * QTY;
    const expectedTotal = expectedSubtotalDb - discountToUse;
    expect(orderField(createdOrderId, 'status'), 'Đơn mới phải có status=new').toBe('new');
    expect(orderField(createdOrderId, 'subtotal'), 'subtotal phải = Σ(unit_price×quantity)').toBe(
      String(expectedSubtotalDb),
    );
    expect(orderField(createdOrderId, 'discount'), 'discount phải = giá trị nhập ở form').toBe(
      String(discountToUse),
    );
    expect(orderField(createdOrderId, 'total'), 'total phải = subtotal − discount').toBe(String(expectedTotal));
    // channel phải là enum hợp lệ (DB CHECK) — không ép giá trị cụ thể.
    expect(orderField(createdOrderId, 'channel'), 'channel phải là enum hợp lệ').toMatch(
      /^(website|phone|zalo|fb)$/,
    );

    // order_items: đúng 1 dòng, snapshot product_name + unit_price + quantity.
    const itemRows = psql(
      `SELECT product_name||'|'||unit_price||'|'||quantity||'|'||COALESCE(product_id::text,'') ` +
        `FROM order_items WHERE order_id='${createdOrderId}'`,
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(itemRows.length, 'Đơn phải có đúng 1 dòng order_items').toBe(1);
    const [pname, uprice, qty, pid] = itemRows[0].split('|');
    expect(pname, 'order_items.product_name phải SNAPSHOT tên sản phẩm').toBe(SEED_PRODUCT_NAME);
    expect(uprice, 'order_items.unit_price phải SNAPSHOT giá sản phẩm lúc tạo').toBe(String(seedProductPrice));
    expect(qty, 'order_items.quantity phải = 2').toBe(String(QTY));
    expect(pid, 'order_items.product_id phải trỏ đúng sản phẩm seed').toBe(seedProductId);

    // Ghim đơn form ở TRANG 1 (created_at future thấp hơn DONE) để test 3/4 định vị.
    psql(`UPDATE orders SET created_at = now() + interval '20 minutes' WHERE id='${createdOrderId}'`);

    await closeDialogIfOpen();
  });

// == Assert 3: Chi tiết đơn — hiện món (snapshot) + tổng =======================
test('3. mở chi tiết đơn vừa tạo → hiện tên món snapshot + đơn giá + số lượng + tổng tiền', async () => {
  expect(createdOrderCode, 'Cần đơn tạo ở test 2 để xem chi tiết').not.toBe('');

  const row = orderRow(createdOrderCode);
  await expect(row, `Không thấy dòng đơn "${createdOrderCode}" trong bảng để mở chi tiết`).toBeVisible({
    timeout: 10_000,
  });
  const detailBtn = row
    .locator(
      'button:has-text("Chi tiết"), a:has-text("Chi tiết"), button:has-text("Xem"), a:has-text("Xem"), ' +
        '[data-detail], button[aria-label*="chi tiết" i], a[aria-label*="chi tiết" i], [title*="Chi tiết" i]',
    )
    .first();
  if ((await detailBtn.count()) > 0 && (await detailBtn.isVisible().catch(() => false))) {
    await detailBtn.click();
  } else {
    await row.click();
  }
  await page.waitForTimeout(1000);

  // Vùng chi tiết = dialog nếu có, ngược lại là page (đã điều hướng /admin/orders/{id}).
  const dialog = page.locator('[role="dialog"], dialog').first();
  const region: Locator = (await dialog.isVisible().catch(() => false)) ? dialog : page.locator('body');

  // Tên món snapshot phải hiện.
  await expect(
    region.getByText(new RegExp(SEED_PRODUCT_NAME, 'i')).first(),
    'Chi tiết đơn phải liệt kê tên món (snapshot) "Nguyệt Quang Kim"',
  ).toBeVisible({ timeout: 10_000 });

  // Đơn giá snapshot phải hiện (số tiền = giá sản phẩm ở nhiều định dạng VND).
  await expect(
    region.getByText(moneyRegex(seedProductPrice)).first(),
    'Chi tiết đơn phải hiện đơn giá snapshot của món',
  ).toBeVisible({ timeout: 8_000 });

  // Tổng tiền đơn phải hiện.
  const expectedTotal = seedProductPrice * QTY - discountToUse;
  await expect(
    region.getByText(moneyRegex(expectedTotal)).first(),
    'Chi tiết đơn phải hiện tổng tiền (subtotal − discount)',
  ).toBeVisible({ timeout: 8_000 });

  await closeDialogIfOpen();
});

// == Assert 4: Đổi status new → confirmed → DB cập nhật =======================
test('4. đổi status đơn new → confirmed qua UI → DB.status=confirmed', async () => {
  expect(createdOrderId, 'Cần đơn tạo ở test 2 để đổi status').not.toBe('');
  expect(orderField(createdOrderId, 'status'), 'Precondition: đơn phải đang new').toBe('new');

  const confirmedRe = /^confirmed$|confirmed|đã xác nhận|xác nhận/i;

  // Ưu tiên đổi status trong CHI TIẾT đơn (plan: dropdown status ở chi tiết).
  const row = orderRow(createdOrderCode);
  await expect(row, `Không thấy dòng đơn "${createdOrderCode}" để đổi status`).toBeVisible({ timeout: 10_000 });

  const detailBtn = row
    .locator(
      'button:has-text("Chi tiết"), a:has-text("Chi tiết"), button:has-text("Xem"), a:has-text("Xem"), ' +
        '[data-detail], button[aria-label*="chi tiết" i], [title*="Chi tiết" i]',
    )
    .first();
  if ((await detailBtn.count()) > 0 && (await detailBtn.isVisible().catch(() => false))) {
    await detailBtn.click();
    await page.waitForTimeout(800);
  }
  const dialog = page.locator('[role="dialog"], dialog').first();
  const region: Locator = (await dialog.isVisible().catch(() => false)) ? dialog : page.locator('body');

  let ok = await chooseOption(region, confirmedRe);
  if (!ok) {
    // Fallback: dropdown status ngay trên dòng bảng.
    await closeDialogIfOpen();
    await gotoOrders();
    ok = await chooseOption(orderRow(createdOrderCode), confirmedRe);
  }
  expect(ok, 'UI phải có dropdown/select đổi status sang "confirmed"').toBe(true);

  // Có thể cần nút xác nhận/lưu.
  const save = page
    .locator(
      'button:has-text("Lưu"), button:has-text("Cập nhật"), button:has-text("Xác nhận"), button:has-text("Đồng ý")',
    )
    .first();
  if ((await save.count()) > 0 && (await save.isVisible().catch(() => false))) {
    await save.click().catch(() => {});
  }

  await expect
    .poll(() => orderField(createdOrderId, 'status'), {
      message: 'Đổi status qua UI phải PATCH /admin/orders/{id} → DB.status=confirmed',
      timeout: 15_000,
    })
    .toBe('confirmed');

  await closeDialogIfOpen();
});

// == Assert 5: Phân trang trước/sau =========================================
test('5. phân trang: có nút Sau (đủ đơn > trang) → chuyển trang đổi nội dung; Trước quay lại', async () => {
  // Đã seed 25 đơn HELDOUT-OUI + đơn khác → tổng > 20 (limit mặc định) → phải có phân trang.
  expect(ordersCount(), 'Precondition phân trang: cần > 20 đơn trong DB (đã seed 25)').toBeGreaterThan(20);

  const nextBtn = page
    .locator(
      'button:has-text("Sau"), a:has-text("Sau"), button:has-text("Tiếp"), a:has-text("Tiếp"), ' +
        'button:has-text("Next"), a:has-text("Next"), [aria-label*="sau" i], [aria-label*="next" i], ' +
        '[aria-label*="trang sau" i], [data-next-page]',
    )
    .first();
  await expect(
    nextBtn,
    'Danh sách > 20 đơn → phải có nút phân trang "Sau"/"Tiếp"/next (plan: phân trang orders)',
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
});

// == Assert 6: Validate — tạo đơn KHÔNG có dòng món → báo lỗi / không tạo ======
test('6. tạo đơn KHÔNG có dòng món hợp lệ → form báo lỗi / không đóng, KHÔNG tạo order', async () => {
  const before = allOrderIds();
  const d = await openCreateForm();

  // Chỉ chọn kênh (best-effort), KHÔNG chọn sản phẩm, KHÔNG thêm dòng hợp lệ.
  await chooseOption(d, /^website$|website|trang web|online/i).catch(() => false);

  const submit = d
    .locator(
      'button[type="submit"], button:has-text("Tạo đơn"), button:has-text("Lưu"), button:has-text("Tạo")',
    )
    .first();
  await expect(submit, 'Form phải có nút submit').toBeVisible();
  await submit.click();
  await page.waitForTimeout(2000);

  // KHÔNG được tạo order mới trong DB.
  const after = allOrderIds();
  const newOnes = [...after].filter((id) => !before.has(id));
  expect(
    newOnes.length,
    'Tạo đơn không có dòng món hợp lệ KHÔNG được tạo order (items rỗng → 400 hoặc client chặn)',
  ).toBe(0);

  // Phải có tín hiệu lỗi: dialog vẫn mở HOẶC thông báo lỗi hiện.
  const dialogStillOpen = (await d.count()) > 0 && (await d.isVisible().catch(() => false));
  const errVisible = await page
    .getByText(/lỗi|không hợp lệ|không được|phải|bắt buộc|chọn.*sản phẩm|thêm.*món|ít nhất|invalid/i)
    .first()
    .isVisible()
    .catch(() => false);
  expect(
    dialogStillOpen || errVisible,
    'Đơn không có món phải hiện lỗi hoặc giữ form mở (không âm thầm bỏ qua)',
  ).toBe(true);

  await closeDialogIfOpen();
});

// == Assert 7 (best-effort): đơn terminal (done) KHÔNG đổi được status ========
test('7. (best-effort) đơn done → không đổi được sang status khác (DB giữ done)', async () => {
  expect(orderField(doneOrderId, 'status'), 'Precondition: đơn seed phải đang done').toBe('done');

  const row = orderRow(DONE_CODE);
  const rowVisible = await row.isVisible().catch(() => false);
  test.skip(!rowVisible, 'Không định vị được đơn done trên trang 1 (best-effort) — bỏ qua.');

  // Mở chi tiết nếu có, thử đổi sang confirmed.
  const detailBtn = row
    .locator(
      'button:has-text("Chi tiết"), a:has-text("Chi tiết"), button:has-text("Xem"), [data-detail], ' +
        'button[aria-label*="chi tiết" i], [title*="Chi tiết" i]',
    )
    .first();
  if ((await detailBtn.count()) > 0 && (await detailBtn.isVisible().catch(() => false))) {
    await detailBtn.click();
    await page.waitForTimeout(800);
  }
  const dialog = page.locator('[role="dialog"], dialog').first();
  const region: Locator = (await dialog.isVisible().catch(() => false)) ? dialog : page.locator('body');

  // Cố đổi sang confirmed (UI có thể chặn/disable → chooseOption trả false).
  const changed = await chooseOption(region, /^confirmed$|confirmed|đã xác nhận|xác nhận/i).catch(() => false);
  if (changed) {
    const save = page
      .locator('button:has-text("Lưu"), button:has-text("Cập nhật"), button:has-text("Xác nhận")')
      .first();
    if ((await save.count()) > 0 && (await save.isVisible().catch(() => false))) {
      await save.click().catch(() => {});
    }
    await page.waitForTimeout(1500);
  }

  // Bất biến QUAN TRỌNG: dù UI cho thao tác gì, đơn done KHÔNG được đổi trong DB
  // (API PATCH đơn terminal → 400).
  expect(
    orderField(doneOrderId, 'status'),
    'Đơn done là trạng thái kết thúc — KHÔNG được đổi sang status khác (REQ-ORD-002)',
  ).toBe('done');

  await closeDialogIfOpen();
});
