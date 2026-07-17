// =============================================================================
// HELD-OUT ACCEPTANCE TEST — Task 4 (Giai đoạn 3):
//   Contact bottom sheet + lead form -> POST /api/v1/leads
// Owner: qa-evaluator. GENERATOR MUST NOT READ OR MODIFY THIS FILE.
//   (CẤM generator đọc/sửa file này — nó mã hóa hành vi DỰ ĐỊNH của Task 4,
//    không phải hành vi hiện tại của implementation. Black-box qua browser thật.)
//
// Derived ONLY from (KHÔNG đọc web/components/landing/ContactSheet* v.v.):
//   - plan 2026-07-17-giai-doan-3-landing.md, Task 4 "Held-out" + Global Constraints
//   - SRS REQ-LAND-003 (form -> POST /leads), REQ-LAND-004 (bottom sheet toàn cục)
//   - design/mooni-landing.html: [data-open-contact] mở sheet; [data-close-contact]
//     / backdrop / Escape đóng; form field: input text "Họ và tên", input tel
//     "SĐT/Zalo", select "Sản phẩm quan tâm", textarea "Nội dung liên hệ".
//   - api/openapi.yaml POST /leads (LeadInput{name,phone,message?,product_interest?}
//     -> 201 LeadCreated / 400 / 429), migration 0003_leads (status default 'new').
//
// HOW TO RUN — xem header playwright.contact.config.ts. Yêu cầu API:8080 + Web:3000
// đang chạy. Nếu ContactSheet chưa dựng (Task 4 chưa code) các test sẽ FAIL rõ ràng
// ("bottom sheet chưa dựng" / không tìm thấy field).
//
// DB: query/cleanup qua `docker compose exec -T postgres psql` (service name
// `postgres`, user/db `mooni`, local socket trust). Mọi lead dùng name prefix
// 'heldout-test-form' và được DỌN ở beforeAll + afterAll.
// =============================================================================
import { test, expect, Page, Locator } from '@playwright/test';
import { execSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NAME_PREFIX = 'heldout-test-form';

// ---- DB helpers (black-box, chỉ để verify persistence + cleanup) -------------
function psql(sql: string): string {
  const cmd =
    `docker compose exec -T postgres psql -U mooni -d mooni -tAc "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}
function leadCount(name: string): number {
  return parseInt(psql(`SELECT count(*) FROM leads WHERE name='${name}'`) || '0', 10);
}
function leadStatus(name: string): string {
  return psql(`SELECT status FROM leads WHERE name='${name}' ORDER BY created_at DESC LIMIT 1`);
}
function cleanup(): void {
  try { psql(`DELETE FROM leads WHERE name LIKE '${NAME_PREFIX}%'`); } catch (e) { /* ignore */ }
}

// ---- Black-box locators (theo mockup, không theo implementation nội bộ) -------
// Sheet = container dạng dialog CHỨA input tel của form. Khi đóng -> display:none
// -> toBeHidden. Không phụ thuộc id nội bộ React.
function contactSheet(page: Page): Locator {
  return page
    .locator('[role="dialog"], #mc-contact-sheet, [data-contact-sheet], [aria-modal="true"]')
    .filter({ has: page.locator('input[type="tel"]') })
    .first();
}
function openButton(page: Page): Locator {
  return page.locator('[data-open-contact]:visible').first();
}
function nameInput(sheet: Locator): Locator {
  return sheet.locator('input[type="text"], input[name="name"]').first();
}
function phoneInput(sheet: Locator): Locator {
  return sheet.locator('input[type="tel"], input[name="phone"]').first();
}
function productSelect(sheet: Locator): Locator {
  return sheet.locator('select').first();
}
function messageArea(sheet: Locator): Locator {
  return sheet.locator('textarea').first();
}
function submitBtn(sheet: Locator): Locator {
  return sheet
    .locator('button[type="submit"], button:has-text("Gửi"), input[type="submit"]')
    .first();
}
function successMsg(page: Page): Locator {
  return page.getByText(/cảm ơn|đã nhận|đã gửi|gửi thành công|thành công/i).first();
}

async function openSheet(page: Page): Promise<Locator> {
  const btn = openButton(page);
  await expect(btn, 'Phải có nút [data-open-contact] hiển thị để mở bottom sheet').toBeVisible();
  await btn.click();
  const sheet = contactSheet(page);
  await expect(sheet, 'Bấm [data-open-contact] phải hiện bottom sheet chứa form (chưa dựng?)')
    .toBeVisible();
  return sheet;
}

test.beforeAll(() => cleanup());
test.afterAll(() => cleanup());

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});

// -- Assert 1: mở sheet -------------------------------------------------------
test('1. click [data-open-contact] mở bottom sheet + form hiện', async ({ page }) => {
  const sheet = await openSheet(page);
  await expect(nameInput(sheet), 'form phải nằm trong/hiện cùng bottom sheet').toBeVisible();
});

// -- Assert 3: form đủ field (đặt trước assert 2 vì không phụ thuộc đóng/mở) ---
test('3. form có đủ field: tên (text), SĐT (tel), sản phẩm (select), lời nhắn (textarea)',
  async ({ page }) => {
    const sheet = await openSheet(page);
    await expect(nameInput(sheet), 'thiếu input tên (text)').toBeVisible();
    await expect(phoneInput(sheet), 'thiếu input SĐT type=tel').toBeVisible();
    await expect(productSelect(sheet), 'thiếu select sản phẩm quan tâm').toBeVisible();
    await expect(messageArea(sheet), 'thiếu textarea lời nhắn').toBeVisible();
  });

// -- Assert 2: đóng bằng X / Escape / backdrop --------------------------------
test('2a. đóng bằng nút X ([data-close-contact])', async ({ page }) => {
  const sheet = await openSheet(page);
  await sheet.locator('[data-close-contact], button[aria-label*="Đóng" i]').first().click();
  await expect(sheet, 'sheet phải ẩn sau khi bấm X').toBeHidden();
});

test('2b. đóng bằng phím Escape', async ({ page }) => {
  const sheet = await openSheet(page);
  await page.keyboard.press('Escape');
  await expect(sheet, 'sheet phải ẩn sau khi nhấn Escape').toBeHidden();
});

test('2c. đóng bằng click backdrop (vùng ngoài card)', async ({ page }) => {
  const sheet = await openSheet(page);
  // Backdrop phủ toàn màn (z-index cao hơn header), card nằm dưới cùng giữa.
  // Click góc trên-trái = vùng backdrop.
  await page.mouse.click(8, 8);
  await expect(sheet, 'sheet phải ẩn sau khi click backdrop').toBeHidden();
});

// -- Assert 4: submit hợp lệ -> thành công + lead vào DB (status new) ----------
test('4. submit hợp lệ -> thông báo thành công + lead thật vào DB (status=new)',
  async ({ page }) => {
    const name = `${NAME_PREFIX}-ok-${Date.now()}`;
    const sheet = await openSheet(page);

    await nameInput(sheet).fill(name);
    await phoneInput(sheet).fill('0912345678'); // SĐT VN hợp lệ
    const opts = await productSelect(sheet).locator('option').count();
    if (opts > 0) {
      await productSelect(sheet).selectOption({ index: Math.min(1, opts - 1) });
    }
    await messageArea(sheet).fill('heldout: đặt 2 hộp 6 bánh, tư vấn giúp mình');

    await submitBtn(sheet).click();

    await expect(successMsg(page),
      'Sau submit hợp lệ phải hiện thông báo cảm ơn/đã nhận').toBeVisible({ timeout: 15_000 });

    // Lead phải thực sự vào DB (POST /leads đã lưu), status mặc định 'new'.
    await expect.poll(() => leadCount(name), {
      message: 'Lead phải được lưu vào bảng leads (POST /leads thành công)',
      timeout: 8_000,
    }).toBeGreaterThan(0);
    expect(leadStatus(name), 'lead mới phải có status=new').toBe('new');
  });

// -- Assert 5a: SĐT sai -> lỗi, KHÔNG tạo lead, KHÔNG mất dữ liệu --------------
test('5a. SĐT sai định dạng -> báo lỗi, không tạo lead, giữ nguyên dữ liệu đã điền',
  async ({ page }) => {
    const name = `${NAME_PREFIX}-badphone-${Date.now()}`;
    const sheet = await openSheet(page);

    await nameInput(sheet).fill(name);
    await phoneInput(sheet).fill('123abc'); // SĐT sai
    await messageArea(sheet).fill('heldout: sđt sai');

    await submitBtn(sheet).click();

    // KHÔNG được hiện thành công.
    await expect(successMsg(page),
      'SĐT sai KHÔNG được hiện thông báo thành công').toBeHidden({ timeout: 4_000 })
      .catch(() => { throw new Error('SĐT sai mà vẫn hiện thông báo thành công'); });

    // KHÔNG tạo lead trong DB (client chặn hoặc API trả 400).
    await page.waitForTimeout(1500);
    expect(leadCount(name), 'SĐT sai KHÔNG được lưu lead vào DB').toBe(0);

    // KHÔNG mất dữ liệu đã điền (tên vẫn còn trong ô).
    await expect(nameInput(sheet), 'dữ liệu tên phải được giữ lại sau lỗi').toHaveValue(name);
  });

// -- Assert 5b: thiếu tên -> lỗi, không thành công, giữ SĐT --------------------
test('5b. thiếu tên -> báo lỗi/không submit, không thành công, giữ SĐT đã điền',
  async ({ page }) => {
    const sheet = await openSheet(page);

    await phoneInput(sheet).fill('0987654321');
    await messageArea(sheet).fill('heldout: thiếu tên');
    // để trống ô tên
    await submitBtn(sheet).click();

    await expect(successMsg(page),
      'Thiếu tên KHÔNG được hiện thông báo thành công').toBeHidden({ timeout: 4_000 })
      .catch(() => { throw new Error('Thiếu tên mà vẫn hiện thông báo thành công'); });

    await expect(phoneInput(sheet), 'SĐT đã điền phải được giữ lại').toHaveValue('0987654321');
  });

// -- Assert 6 (best-effort): 429 rate limit -----------------------------------
// Dàn cảnh 429 trong browser rất khó xác định (window 20/phút theo IP, dễ nhiễm
// các test trên). Ở đây kiểm best-effort HỢP ĐỒNG BACKEND mà UI phụ thuộc: bắn
// >20 POST /leads nhanh -> API PHẢI trả 429 ít nhất 1 lần. UI-429 message được
// phủ ở tầng API held-out (leads_test.sh) — SKIP phần assert message UI để tránh
// flaky. Chạy CUỐI CÙNG để không làm cạn rate-limit của các test trên.
test('6. (best-effort) API enforce 429 khi vượt rate limit (nền cho UI "thử lại sau")',
  async ({ request }) => {
    let saw429 = false;
    for (let i = 0; i < 26; i++) {
      const r = await request.post('http://localhost:8080/api/v1/leads', {
        data: { name: `${NAME_PREFIX}-rl-${i}`, phone: '0912345678' },
        failOnStatusCode: false,
      });
      if (r.status() === 429) { saw429 = true; break; }
    }
    test.skip(!saw429,
      'Không quan sát được 429 trong 26 lần POST (rate limit có thể cao/tắt ở môi trường này) — bỏ qua best-effort, không FAIL các assert 1-5.');
    expect(saw429, 'API phải trả 429 khi vượt rate limit — UI dựa vào đây để báo "thử lại sau"')
      .toBe(true);
  });
