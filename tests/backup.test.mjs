import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = (await Promise.all(['storage.js', 'app.js', 'pf.js', 'backup.js'].map(name => readFile(new URL('../js/' + name, import.meta.url), 'utf8')))).join('\n;\n');
const clone = value => JSON.parse(JSON.stringify(value));
async function setup(t) {
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  if (w.document.readyState !== 'complete') await new Promise(resolve => w.addEventListener('load', resolve, { once: true }));
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.eval(scripts + '\nwindow.__store = Store;');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const store = w.__store;
  const person = store.addPerson('Backup test person');
  store.addTransaction({ personId: person.id, startDate: '2026-10-30', months: 3, amount: 5000, percent: 15, note: 'Deal' });
  store.addFinance({ paidDate: '2026-10-30', receiveDate: '2026-11-30', amount: 700, profitType: 'fixed', profitValue: 50, received: true, note: 'Finance' });
  const pf = w.PF;
  const account = pf.addAccount({ name: 'Test wallet', type: 'wallet', opening: 900 });
  const category = pf.addCategory({ name: 'Test category', kind: 'expense' });
  pf.addEntry({ type: 'expense', amount: 65, date: '2026-10-30', accountId: account.id, categoryId: category.id, note: 'Cafe' });
  pf.setBudget('2026-10', category.id, 500);
  pf.addRule({ type: 'expense', amount: 20, accountId: account.id, categoryId: category.id, startDate: '2026-10-30', frequency: 'monthly', note: 'Rule' });
  store.setCurrency('USD');
  pf.data.meta.currency = 'EGP';
  pf.save();
  return { w, store, pf, backup: w.AppBackup };
}
function snapshot({ w, store, pf }) {
  return {
    main: clone(store.data), pf: clone(pf.data),
    rawMain: w.localStorage.getItem(store.storageKey), rawPF: w.localStorage.getItem(pf.storageKey),
  };
}

test('whole-app backup round-trips every module, ID, reference, budget, recurring rule and currency', async t => {
  const context = await setup(t);
  const { w, store, pf, backup } = context;
  w.localStorage.setItem('alshwareb_reminder_device_v1', 'private-device-token');
  const json = backup.exportData();
  const saved = JSON.parse(json);
  assert.equal(saved.app, 'al-shwareb');
  assert.equal(saved.version, 1);
  assert.equal(saved.data.main.people.length, 1);
  assert.equal(saved.data.main.transactions.length, 1);
  assert.equal(saved.data.main.finance.length, 1);
  assert.equal(saved.data.personalFinance.entries.length, 1);
  assert.equal(saved.data.personalFinance.budgets.length, 1);
  assert.equal(saved.data.personalFinance.recurring.length, 1);
  assert.ok(!json.includes('private-device-token'), 'Push device tokens must not be cloned to another phone');
  store.eraseAll();
  pf.eraseAll();
  backup.importData(json);
  assert.deepEqual(clone(store.data), saved.data.main);
  assert.deepEqual(clone(pf.data), saved.data.personalFinance);
  assert.equal(store.currency, 'USD');
  assert.equal(pf.data.meta.currency, 'EGP');
  assert.deepEqual(JSON.parse(w.localStorage.getItem(store.storageKey)), saved.data.main);
  assert.deepEqual(JSON.parse(w.localStorage.getItem(pf.storageKey)), saved.data.personalFinance);
  assert.equal(w.localStorage.getItem('alshwareb_reminder_device_v1'), 'private-device-token');
  pf.load(); store.load();
  assert.deepEqual(clone(store.data), saved.data.main);
  assert.deepEqual(clone(pf.data), saved.data.personalFinance);
});

test('legacy app-only backups preserve current Personal Finance data', async t => {
  const context = await setup(t);
  const before = snapshot(context);
  const legacy = clone(context.store.data);
  legacy.people[0].name = 'Restored legacy person';
  assert.match(context.backup.inspectData(JSON.stringify(legacy)).confirmation, /Personal Finance data will be kept/);
  context.backup.importData(JSON.stringify(legacy));
  assert.equal(context.store.data.people[0].name, 'Restored legacy person');
  assert.deepEqual(clone(context.pf.data), before.pf);
  assert.equal(context.w.localStorage.getItem(context.pf.storageKey), before.rawPF);
});

test('legacy PF-only backups use the same import and preserve all main records', async t => {
  const context = await setup(t);
  const before = snapshot(context);
  const legacy = context.pf.exportData();
  context.pf.eraseAll();
  assert.match(context.backup.inspectData(legacy).confirmation, /Replace Personal Finance only/);
  context.backup.importData(legacy);
  assert.deepEqual(clone(context.pf.data), before.pf);
  assert.deepEqual(clone(context.store.data), before.main);
  assert.equal(context.w.localStorage.getItem(context.store.storageKey), before.rawMain);
});

test('invalid, incomplete and future backups never change either module', async t => {
  const context = await setup(t);
  const before = snapshot(context);
  const valid = JSON.parse(context.backup.exportData());
  const invalidPF = clone(valid); invalidPF.data.personalFinance.entries = 'bad';
  invalidPF.data.main.people[0].name = 'Must not be written';
  const missingPF = clone(valid); delete missingPF.data.personalFinance;
  const missingMain = clone(valid); delete missingMain.data.main;
  const invalidMain = clone(valid); invalidMain.data.main.people = null;
  const future = clone(valid); future.version = 99;
  const futurePF = clone(valid); futurePF.data.personalFinance.meta.version = 99;
  const missingBudget = clone(valid); delete missingBudget.data.personalFinance.budgets;
  const corruptEntry = clone(valid); corruptEntry.data.personalFinance.entries = [{}];
  for (const raw of ['not json', 'null', '[]', '{}', ...[invalidPF, missingPF, missingMain, invalidMain, future, futurePF, missingBudget, corruptEntry].map(JSON.stringify)]) {
    assert.throws(() => context.backup.importData(raw));
    assert.deepEqual(snapshot(context), before);
  }
});

test('a failed second storage write rolls back the first and keeps in-memory data', async t => {
  const context = await setup(t);
  const { w, store, pf, backup } = context;
  const before = snapshot(context);
  const incoming = JSON.parse(backup.exportData());
  incoming.data.main.people[0].name = 'Replacement main';
  incoming.data.personalFinance.entries[0].amount = 99;
  const original = w.Storage.prototype.setItem;
  let fail = true;
  w.Storage.prototype.setItem = function(key, value) {
    if (key === pf.storageKey && fail) { fail = false; throw new Error('Quota exceeded'); }
    return original.call(this, key, value);
  };
  assert.throws(() => backup.importData(JSON.stringify(incoming)), /existing data was kept/);
  assert.deepEqual(snapshot(context), before);
  assert.equal(store.data.people[0].name, before.main.people[0].name);
});

test('restore clears stale PF edits and message drafts and refreshes visible entries', async t => {
  const { w, pf, backup } = await setup(t);
  const json = backup.exportData();
  const box = w.document.getElementById('pf-import-text');
  box.value = 'You received EGP 200 on 30-10-2026';
  box.dispatchEvent(new w.Event('blur'));
  assert.ok(w.document.querySelector('[data-pf-import-add]'));
  backup.importData(json);
  assert.equal(box.value, '');
  assert.equal(w.document.querySelectorAll('[data-pf-import-add]').length, 0);
  assert.equal(w.document.getElementById('pf-entry-id').value, '');
  assert.ok(w.document.querySelector(`[data-pf-edit-entry="${pf.data.entries[0].id}"]`));
});

test('cancelled shared restore leaves both stores untouched', async t => {
  const context = await setup(t);
  const { w, backup } = context;
  const before = snapshot(context);
  const incoming = JSON.parse(backup.exportData());
  incoming.data.main.people[0].name = 'Not accepted';
  let confirmation = '';
  w.confirm = text => { confirmation = text; return false; };
  w.FileReader = class {
    readAsText() { this.result = JSON.stringify(incoming); this.onload(); }
  };
  const input = w.document.getElementById('import-file');
  Object.defineProperty(input, 'files', { value: [{}] });
  input.dispatchEvent(new w.Event('change'));
  assert.match(confirmation, /ALL People, Transactions, Finance and Personal Finance/);
  assert.deepEqual(snapshot(context), before);
});

test('shared export button downloads a whole-app backup and shared import updates all visible modules', async t => {
  const { w, store, pf } = await setup(t);
  let downloadedBlob, filename;
  w.URL.createObjectURL = blob => { downloadedBlob = blob; return 'blob:backup-test'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function() { filename = this.download; };
  w.document.getElementById('btn-export').click();
  assert.match(filename, /^al-shwareb-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  const text = await new Promise((resolve, reject) => {
    const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(downloadedBlob);
  });
  const exported = JSON.parse(text);
  assert.equal(exported.app, 'al-shwareb');
  assert.equal(exported.data.personalFinance.entries.length, 1);
  store.eraseAll(); pf.eraseAll();
  w.FileReader = class { readAsText() { this.result = text; this.onload(); } };
  const input = w.document.getElementById('import-file');
  Object.defineProperty(input, 'files', { value: [{}] });
  input.dispatchEvent(new w.Event('change'));
  assert.equal(store.data.people.length, 1);
  assert.equal(pf.data.entries.length, 1);
  assert.match(w.document.getElementById('people-list').textContent, /Backup test person/);
  assert.match(w.document.getElementById('pf-entries-list').textContent, /Cafe/);
});

test('legacy month-based transactions still migrate through shared restore', async t => {
  const { store, backup } = await setup(t);
  const old = clone(store.data);
  old.meta.version = 1;
  delete old.finance;
  delete old.transactions[0].startDate;
  delete old.transactions[0].months;
  old.transactions[0].period = '2025-06';
  backup.importData(JSON.stringify(old));
  assert.equal(store.data.transactions[0].startDate, '2025-06-01');
  assert.equal(store.data.transactions[0].months, 1);
});

test('legacy UI export API also includes PF, and its restore API restores both stores', async t => {
  const { store, pf } = await setup(t);
  // Older cached app.js calls these public Store methods, not AppBackup directly.
  const json = store.exportData();
  const saved = JSON.parse(json);
  assert.equal(saved.app, 'al-shwareb');
  assert.equal(saved.data.personalFinance.entries.length, 1);
  store.eraseAll(); pf.eraseAll();
  store.importData(json);
  assert.deepEqual(clone(store.data), saved.data.main);
  assert.deepEqual(clone(pf.data), saved.data.personalFinance);
});

test('Store restore accepts the unified file instead of rejecting or ignoring its PF section', async t => {
  const { store, pf, backup } = await setup(t);
  const json = backup.exportData();
  pf.eraseAll();
  store.importData(json);
  assert.equal(pf.data.entries.length, 1);
});

test('restored historical PF data selects a populated month, not an empty current month', async t => {
  const { w, backup } = await setup(t);
  const saved = JSON.parse(backup.exportData());
  saved.data.personalFinance.entries[0].date = '2021-04-15';
  saved.data.personalFinance.budgets[0].month = '2021-04';
  backup.importData(JSON.stringify(saved));
  assert.equal(w.document.getElementById('pf-month').value, '2021-04');
  assert.match(w.document.getElementById('pf-cards').textContent, /65\.00/);
});

test('export and restore diagnostics report actual PF counts and warn about missing PF', async t => {
  const { w, store, backup } = await setup(t);
  const file = backup.exportData();
  const info = backup.inspectData(file);
  assert.equal(info.counts.pfEntries, 1);
  assert.equal(info.counts.pfAccounts, 3);
  assert.equal(info.counts.pfBudgets, 1);
  assert.equal(info.counts.pfRecurring, 1);
  assert.match(info.confirmation, /Personal Finance: 1 entries, 3 accounts/);
  assert.match(info.success, /Personal Finance: 1 entries/);
  assert.deepEqual(JSON.parse(file).summary, clone(info.counts));
  const legacy = backup.inspectData(JSON.stringify(store.data));
  assert.equal(legacy.counts.pfEntries, null);
  assert.match(legacy.confirmation, /NO Personal Finance data in this file/);
  assert.match(legacy.confirmation, /cannot be restored from it/);
  w.document.getElementById('open-settings').click();
  assert.match(w.document.getElementById('backup-contents').textContent, /1 PF entries, 3 accounts/);
});

test('public backup APIs fail closed if the shared backup module is missing', async t => {
  const context = await setup(t);
  const before = snapshot(context);
  const json = context.backup.exportData();
  context.w.AppBackup = undefined;
  assert.throws(() => context.store.exportData(), /Backup tools are still updating/);
  assert.throws(() => context.store.importData(json), /Backup tools are still updating/);
  assert.deepEqual(snapshot(context), before);
  let downloaded = false;
  context.w.URL.createObjectURL = () => { downloaded = true; return 'blob:partial'; };
  context.w.document.getElementById('btn-export').click();
  assert.equal(downloaded, false, 'Never silently create a main-only file');
  assert.match(context.w.document.getElementById('toast').textContent, /Backup tools are still updating/);
});

test('PF records restore on a different fresh app instance and survive reload from storage', async t => {
  const source = await setup(t);
  const file = source.backup.exportData();
  const target = await setup(t);
  target.store.eraseAll();
  target.pf.eraseAll();
  const before = target.pf.data.accounts[0].id;
  target.store.importData(file);
  target.store.load();
  target.pf.load();
  assert.notEqual(target.pf.data.accounts[0].id, before);
  assert.deepEqual(clone(target.pf.data), clone(source.pf.data));
  assert.deepEqual(clone(target.store.data), clone(source.store.data));
});

test('HTML asset versions match precache entries, so old cache keys cannot serve legacy scripts', async () => {
  const worker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const release = worker.match(/CACHE_VERSION = 'al-shwareb-v(\d+)'/)[1];
  const doc = new JSDOM(html).window.document;
  const assets = [...doc.querySelectorAll('script[src], link[rel="stylesheet"]')].map(el => el.getAttribute('src') || el.getAttribute('href'));
  for (const path of assets) {
    assert.equal(new URL(path, 'https://example.test').searchParams.get('v'), release);
    assert.ok(worker.includes(`'./${path}'`), `Precache must include ${path} for offline startup`);
  }
  doc.defaultView.close();
});

test('restore recomputes PF counts and warns before importing an empty PF section', async t => {
  const { backup } = await setup(t);
  const saved = JSON.parse(backup.exportData());
  saved.summary.pfEntries = 900;
  saved.data.personalFinance.entries = [];
  const info = backup.inspectData(JSON.stringify(saved));
  assert.equal(info.counts.pfEntries, 0);
  assert.match(info.confirmation, /This file has no PF income\/expense entries/);
  assert.match(info.confirmation, /cancel and export a fresh backup/);
});
