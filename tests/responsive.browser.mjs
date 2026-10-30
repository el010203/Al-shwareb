// Real-browser layout checks. See README for CHROMIUM_PATH setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const screens = [
  [320, 568], [375, 667], [390, 844], [430, 932], [844, 390],
  [768, 1024], [820, 1180], [1024, 768], [1180, 820], [1366, 1024],
];

async function seed(page) {
  await page.evaluate(() => {
    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const person = Store.addPerson('LongPersonNameWithoutSpacesForLayoutTesting');
    Store.addTransaction({ personId: person.id, startDate: today, months: 12, amount: 1234567890.99, percent: 15, note: 'Long note '.repeat(40) });
    Store.addFinance({ paidDate: today, receiveDate: today, amount: 1234567890.99, profitType: 'fixed', profitValue: 5000, note: 'FinanceNoteWithoutSpaces'.repeat(12) });
    const account = PF.addAccount({ name: 'LongBankAccountNameWithoutSpacesForLayout', type: 'bank', opening: 1234567890.99 });
    const category = PF.addCategory({ name: 'LongCategoryNameWithoutSpacesForLayout', kind: 'expense' });
    PF.addEntry({ type: 'expense', amount: 1234567890.99, date: today, accountId: account.id, categoryId: category.id, note: 'ملاحظات طويلة '.repeat(15) });
    PF.setBudget(today.slice(0,7), category.id, 1234567890.99);
    PF.addRule({ type: 'expense', amount: 1234567890.99, accountId: account.id, categoryId: category.id, startDate: today, frequency: 'monthly', note: 'Recurring entry layout test' });
    renderAll();
  });
  await page.reload(); // PF re-renders from its own persisted records.
}
async function checkLayout(page, label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.viewport + 1, `${label}: page is ${dimensions.document}px wide at ${dimensions.viewport}px`);
  const escaped = await page.locator('.tab-panel.active .input, .tab-panel.active .select, .tab-panel.active .panel, .pf-topbar, .person-card').evaluateAll(elements => elements.filter(el => {
    const r = el.getBoundingClientRect();
    return r.width && r.height && (r.left < -1 || r.right > innerWidth + 1);
  }).map(el => el.id || el.className));
  assert.deepEqual(escaped, [], `${label}: off-screen controls`);
  if (dimensions.viewport <= 640) {
    const clippedTables = await page.locator('.tab-panel.active .table-wrap').evaluateAll(elements => elements.filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.parentElement.id));
    assert.deepEqual(clippedTables, [], `${label}: mobile table cards must not need horizontal scrolling`);
  }
}

test('phone and tablet layouts contain forms, lists, navigation and dialogs', async t => {
  if (!process.env.CHROMIUM_PATH) throw new Error('Set CHROMIUM_PATH to your Chrome/Chromium executable.');
  const server = createServer(async (req, res) => {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try { res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  t.after(() => browser.close());
  if (process.env.SCREENSHOT_DIR) await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  for (const [width, height] of screens) {
    await t.test(`${width} × ${height}`, async () => {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      let filePickers = 0;
      page.on('filechooser', () => { filePickers++; });
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('[data-tab="pf"]').click();
        await checkLayout(page, 'empty PF');
        await seed(page);
        for (const tab of ['dashboard', 'transactions', 'people', 'finance', 'pf']) {
          await page.locator(`[data-tab="${tab}"]`).click();
          await checkLayout(page, tab);
          if (process.env.SCREENSHOT_DIR && ['transactions', 'people'].includes(tab)) {
            await page.screenshot({ path: resolve(process.env.SCREENSHOT_DIR, `${width}x${height}-${tab}.png`), fullPage: true });
          }
        }
        // History dialogs must remain usable with long names and wide tables.
        for (const [tab, trigger, modal] of [
          ['people', '[data-action="history-person"]', '#modal-history'],
          ['finance', '#btn-fin-history', '#modal-finance-history'],
        ]) {
          await page.locator(`[data-tab="${tab}"]`).click();
          await page.locator(trigger).click();
          const card = page.locator(`${modal} .modal-card`);
          const size = await card.boundingBox();
          assert.ok(size.x >= 0 && size.x + size.width <= width + 1 && size.y >= 0 && size.y + size.height <= height + 1);
          assert.ok(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Dialog content must not overflow sideways');
          await page.locator(`${modal} .icon-btn`).click();
        }
        await page.locator('[data-tab="pf"]').click();
        // All main tabs fit without sideways scrolling on phones.
        if (width <= 640) {
          assert.equal(await page.locator('.tabs').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
        }
        for (const view of ['overview', 'entries', 'budgets', 'accounts', 'recurring']) {
          await page.locator(`[data-pf-view="${view}"]`).click();
          await checkLayout(page, `PF ${view}`);
        }
        await page.locator('[data-pf-view="entries"]').click();
        await page.locator('#pf-import > summary').click();
        await page.locator('#pf-import-text').fill('تم خصم EGP 165 من بطاقة الخصم المباشر رقم 6758 باستخدام Mobile Payment عند FAWRY*SPOT IN CAFE يوم 30/10/26 الساعة 15:10 المتاح 191.35EGP');
        await page.locator('[data-pf-import-add]').waitFor();
        await checkLayout(page, 'message preview');
        const smallFonts = await page.locator('#tab-pf .input, #tab-pf .select').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().width && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id));
        assert.deepEqual(smallFonts, [], 'Inputs must not cause Safari focus zoom');
        const shortButtons = await page.locator('#tab-pf .btn, #tab-pf .link-btn, .pf-subnav-btn').evaluateAll(elements => elements.filter(el => {
          const r = el.getBoundingClientRect(); return r.width && r.height && r.height < 43.5;
        }).map(el => el.textContent.trim()));
        assert.deepEqual(shortButtons, [], 'Touch controls must be at least 44px tall');
        await page.locator('#pf-settings-btn').click();
        const dialog = page.locator('#modal-pf-settings .modal-card');
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, 'Settings dialog must fit the viewport');
        await page.locator('#pf-reminder-disable').scrollIntoViewIfNeeded();
        await page.locator('#pf-erase').scrollIntoViewIfNeeded();
        await page.locator('#modal-pf-settings [data-pf-close-settings].icon-btn').click();
        assert.ok(await page.locator('#modal-pf-settings').isHidden(), 'Sticky close button remains reachable after scrolling');
        assert.equal(filePickers, 0, 'Regular interactions must never open files');
        assert.deepEqual(errors, [], 'No runtime errors');
        if (process.env.SCREENSHOT_DIR) {
          await page.screenshot({ path: resolve(process.env.SCREENSHOT_DIR, `${width}x${height}-entries.png`), fullPage: true });
          await page.locator('[data-pf-view="overview"]').click();
          await page.screenshot({ path: resolve(process.env.SCREENSHOT_DIR, `${width}x${height}-overview.png`), fullPage: true });
        }
      } finally { await context.close(); }
    });
  }
});
