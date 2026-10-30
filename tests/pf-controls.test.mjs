import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../js/pf.js', import.meta.url), 'utf8');

async function setup(t) {
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  if (w.document.readyState !== 'complete') await new Promise(resolve => w.addEventListener('load', resolve, { once: true }));
  w.confirm = () => true;
  w.toast = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.eval(source);
  let filesOpened = 0;
  for (const input of w.document.querySelectorAll('input[type="file"]')) {
    input.click = () => { filesOpened++; };
  }
  return { w, $: s => w.document.querySelector(s), filesOpened: () => filesOpened };
}

test('all static and rendered controls have unique IDs', async t => {
  const { w } = await setup(t);
  const ids = [...w.document.querySelectorAll('[id]')].map(el => el.id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate IDs can attach handlers to the wrong control');
});

test('message import fields, dropdowns and Add entry never open the file picker', async t => {
  const { w, $, filesOpened } = await setup(t);
  $('#pf-import summary').click();
  assert.equal(filesOpened(), 0, 'Opening the message panel must not choose a file');
  const box = $('#pf-import-text');
  box.click();
  box.value = 'تم خصم EGP 165 من بطاقة الخصم المباشر رقم 6758 باستخدام Mobile Payment عند FAWRY*SPOT IN CAFE يوم 30/10/26 الساعة 15:10 المتاح 191.35EGP';
  box.dispatchEvent(new w.Event('blur'));
  assert.equal(w.document.querySelectorAll('[data-pf-import-add]').length, 1);
  for (const field of w.document.querySelectorAll('[data-pf-import-field]')) {
    field.click();
    assert.equal(filesOpened(), 0, `${field.dataset.pfImportField} must not open files`);
  }
  $('[data-pf-import-add]').click();
  assert.equal(w.PF.data.entries.length, 1, 'Message import still saves an entry');
  assert.equal(w.PF.data.entries[0].amount, 165);
  $('#pf-import-clear').click();
  assert.equal(filesOpened(), 0, 'Saving or clearing message entries must not open files');
});

test('manual transaction controls still save without opening files', async t => {
  const { w, $, filesOpened } = await setup(t);
  $('#pf-entry-form [data-pf-type="income"]').click();
  $('#pf-entry-account').click();
  $('#pf-entry-category').click();
  $('#pf-entry-amount').value = '120';
  $('#pf-entry-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(w.PF.data.entries.length, 1);
  assert.equal(w.PF.data.entries[0].type, 'income');
  assert.equal(w.PF.data.entries[0].amount, 120);
  assert.equal(filesOpened(), 0);
});

test('only the dedicated PF backup-import button opens the file picker', async t => {
  const { $, filesOpened } = await setup(t);
  $('#pf-settings-btn').click();
  assert.equal(filesOpened(), 0);
  const backupButton = [...$('#modal-pf-settings').querySelectorAll('button')].find(el => el.textContent.trim() === 'Import PF backup');
  backupButton.click();
  assert.equal(filesOpened(), 1, 'Backup import must open its file picker exactly once');
});
