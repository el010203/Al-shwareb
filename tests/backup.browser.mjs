// Full file download -> FileReader restore -> fresh device -> offline reload.
// CHROMIUM_PATH must point to a locally installed Chrome/Chromium executable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

test('a downloaded backup restores PF on a fresh device and survives offline restart', async t => {
  assert.ok(process.env.CHROMIUM_PATH, 'Set CHROMIUM_PATH to a Chrome/Chromium executable');
  const root = resolve('dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (req, res) => {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!path.startsWith(root + sep)) return res.writeHead(403).end();
    try { res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  t.after(() => browser.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const source = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const target = await browser.newContext({ viewport: { width: 820, height: 1180 }, reducedMotion: 'reduce' });
  t.after(() => source.close()); t.after(() => target.close());
  const phone = await source.newPage();
  const ipad = await target.newPage();
  const errors = [];
  phone.on('pageerror', error => errors.push(error.message));
  ipad.on('pageerror', error => errors.push(error.message));
  await phone.goto(url);
  await phone.locator('[data-tab="pf"]').click();
  await phone.locator('[data-pf-view="entries"]').click();
  await phone.locator('#pf-entry-amount').fill('165');
  await phone.locator('#pf-entry-date').fill('2021-04-15');
  await phone.locator('#pf-entry-note').fill('Synthetic historical cafe purchase');
  await phone.locator('#pf-entry-submit').click();
  await phone.evaluate(() => {
    const e = PF.data.entries[0];
    PF.setBudget('2021-04', e.categoryId, 500);
    PF.addRule({ type: e.type, amount: 20, accountId: e.accountId, categoryId: e.categoryId, frequency: 'monthly', startDate: '2021-04-15' });
    const person = Store.addPerson('Synthetic backup person');
    Store.addTransaction({ personId: person.id, startDate: '2021-04-15', months: 3, amount: 1000, percent: 10 });
    Store.addFinance({ paidDate: '2021-04-15', amount: 100, profitType: 'fixed', profitValue: 10 });
  });
  await phone.locator('#open-settings').click();
  assert.match(await phone.locator('#backup-contents').textContent(), /1 PF entries/);
  const pendingDownload = phone.waitForEvent('download');
  await phone.locator('#btn-export').click();
  const download = await pendingDownload;
  assert.equal(await download.failure(), null);
  const raw = await readFile(await download.path(), 'utf8');
  const saved = JSON.parse(raw);
  assert.equal(saved.summary.pfEntries, 1);
  assert.equal(saved.data.personalFinance.entries[0].amount, 165);
  await ipad.goto(url);
  assert.equal(await ipad.evaluate(() => PF.data.entries.length), 0, 'Target starts with no PF records');
  let confirmation = '';
  ipad.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.accept(); });
  await ipad.locator('#open-settings').click();
  await ipad.locator('#import-file').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(raw) });
  await ipad.waitForFunction(() => PF.data.entries.length === 1);
  assert.match(confirmation, /Personal Finance: 1 entries, 2 accounts/);
  const restored = await ipad.evaluate(() => ({ main: Store.data, pf: PF.data }));
  assert.deepEqual(restored.main, saved.data.main);
  assert.deepEqual(restored.pf, saved.data.personalFinance);
  await ipad.locator('[data-tab="pf"]').click();
  assert.equal(await ipad.locator('#pf-month').inputValue(), '2021-04');
  assert.match(await ipad.locator('#pf-cards').textContent(), /165\.00/);
  await ipad.locator('[data-pf-view="entries"]').click();
  assert.match(await ipad.locator('#pf-entries-list').textContent(), /Synthetic historical cafe purchase/);
  await ipad.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // A stale unversioned script must not shadow this build's versioned assets.
    const cache = await caches.open('synthetic-legacy-cache');
    await cache.put('./js/app.js', new Response('throw new Error("STALE SCRIPT LOADED");'));
  });
  await ipad.waitForFunction(() => !!navigator.serviceWorker.controller);
  await target.setOffline(true);
  await ipad.reload();
  assert.deepEqual(await ipad.evaluate(() => PF.data), saved.data.personalFinance, 'Offline restart keeps restored PF records');
  await target.setOffline(false);
  // An old main-only file must clearly warn about missing PF, never erase it.
  ipad.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.accept(); });
  await ipad.locator('#open-settings').click();
  await ipad.locator('#import-file').setInputFiles({ name: 'legacy-main.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved.data.main)) });
  await ipad.waitForFunction(() => document.getElementById('toast').textContent.includes('NO Personal Finance data in this file'));
  assert.match(confirmation, /NO Personal Finance data in this file/);
  assert.deepEqual(await ipad.evaluate(() => PF.data), saved.data.personalFinance);
  assert.deepEqual(errors, []);
});
