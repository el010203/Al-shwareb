/* ============================================================
   Al-shwareb — UI logic
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  tab: 'dashboard',
  dashPerson: 'all',
  filterPerson: 'all',
  filterMonth: 'all',
  editingId: null,
  historyPersonId: null,
  finProfitType: 'percent',
  finEditingId: null,
  finFilterStatus: 'all',
  finFilterType: 'all',
  finHistStatus: 'all',
  finHistType: 'all',
  finHistQuery: '',
};

/* ---------- formatting helpers ---------- */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  const cur = Store.currency;
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${escapeHtml(cur)}`;
}

function fmtPct(n) {
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

function formatMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/* ---------- toast ---------- */

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- tabs ---------- */

function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
}

/* ---------- shared select rendering ---------- */

function fillPersonSelects() {
  const people = Store.getPeople();
  const options =
    `<option value="all">All people (${people.length})</option>` +
    people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

  $('#dash-person').innerHTML = options;
  $('#dash-person').value = state.dashPerson;

  $('#filter-person').innerHTML = options;
  $('#filter-person').value = state.filterPerson;

  // Form select has no "all" option — a transaction must belong to someone
  $('#tx-person').innerHTML =
    people.length
      ? people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')
      : '<option value="">No people yet — add one first</option>';
}

function fillMonthFilter() {
  const months = Store.allMonths();
  $('#filter-month').innerHTML =
    `<option value="all">All months</option>` +
    months.map((m) => `<option value="${m}">${formatMonth(m)}</option>`).join('');
  $('#filter-month').value = months.includes(state.filterMonth) ? state.filterMonth : 'all';
  state.filterMonth = $('#filter-month').value;
}

/* ============================================================
   DASHBOARD
   ============================================================ */

function renderDashboard() {
  const personId = $('#dash-person').value || 'all';
  const txs = Store.getTransactions(personId === 'all' ? {} : { personId });
  const summary = Store.summarize(txs);
  const monthly = Store.monthlyBreakdown(txs);

  $('#dash-cards').innerHTML = `
    <div class="card">
      <div class="label">Money invested</div>
      <div class="value">${fmtMoney(summary.invested)}</div>
      <div class="sub">${summary.count} transaction${summary.count === 1 ? '' : 's'} · ${summary.monthCount} deal-month${summary.monthCount === 1 ? '' : 's'}</div>
    </div>
    <div class="card profit">
      <div class="label">Total profit</div>
      <div class="value">${fmtMoney(summary.profit)}</div>
      <div class="sub">Money returned: ${fmtMoney(summary.returned)}</div>
    </div>
    <div class="card">
      <div class="label">Percent profit</div>
      <div class="value">${fmtPct(summary.percent)}</div>
      <div class="sub">Avg. ${fmtMoney(summary.avgMonthlyProfit)} profit per month</div>
    </div>
    <div class="card">
      <div class="label">Best month</div>
      <div class="value" style="font-size:1.05rem">${monthly.length ? escapeHtml(formatMonth(monthly.reduce((a, b) => (b.profit > a.profit ? b : a)).period)) : '—'}</div>
      <div class="sub">${monthly.length ? fmtMoney(monthly.reduce((a, b) => (b.profit > a.profit ? b : a)).profit) : 'No data yet'}</div>
    </div>`;

  renderChart(monthly);
  renderMonthlyTable(monthly);
}

function renderChart(monthly) {
  const wrap = $('#dash-chart');
  if (!monthly.length) {
    wrap.innerHTML = `<div class="chart-empty">No transactions yet — add one from the Transactions tab.</div>`;
    return;
  }
  // Chronological (oldest → newest) for the bars
  const rows = [...monthly].sort((a, b) => a.period.localeCompare(b.period));
  const max = Math.max(...rows.map((r) => r.profit), 1);
  wrap.innerHTML = rows
    .map((r) => {
      const heightPct = Math.max((r.profit / max) * 100, r.profit > 0 ? 4 : 0);
      return `
        <div class="bar-col" title="${escapeHtml(formatMonth(r.period))}: ${fmtMoney(r.profit)} profit">
          <span class="bar-val">${shortMoney(r.profit)}</span>
          <div class="bar" style="height:${heightPct}%"></div>
          <span class="bar-label">${escapeHtml(formatMonth(r.period).split(' ')[0])}</span>
        </div>`;
    })
    .join('');
}

function shortMoney(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) {
    const k = v / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return Math.round(v).toString();
}

function renderMonthlyTable(monthly) {
  const host = $('#dash-table');
  if (!monthly.length) {
    host.innerHTML = `<div class="empty-state"><span class="big">📊</span>Monthly profit will appear here.</div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Month</th>
            <th class="num">Active deals</th>
            <th class="num">Money at work</th>
            <th class="num">Month profit</th>
            <th class="num">Month rate</th>
          </tr>
        </thead>
        <tbody>
          ${monthly
            .map(
              (r) => `
            <tr>
              <td data-label="Month"><strong>${escapeHtml(formatMonth(r.period))}</strong></td>
              <td data-label="Active deals" class="num">${r.count}</td>
              <td data-label="Money at work" class="num">${fmtMoney(r.invested)}</td>
              <td data-label="Month profit" class="num profit-cell">${fmtMoney(r.profit)}</td>
              <td data-label="Month rate" class="num"><span class="pct-pill">${fmtPct(r.percent)}</span></td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

/* ============================================================
   TRANSACTIONS
   ============================================================ */

function renderTransactionList() {
  const host = $('#tx-list');
  const people = Store.getPeople();
  if (!people.length) {
    host.innerHTML = `
      <div class="panel empty-state">
        <span class="big">👤</span>
        No people yet. Open the <strong>People</strong> tab and add the first person, then come back to record a transaction.
      </div>`;
    return;
  }

  const txs = Store.getTransactions({
    personId: state.filterPerson,
    month: state.filterMonth,
  });

  if (!txs.length) {
    host.innerHTML = `
      <div class="panel empty-state">
        <span class="big">🧾</span>
        No transactions match these filters — or none exist yet.<br/>
        Use the form above to add the first one.
      </div>`;
    return;
  }

  const showPerson = state.filterPerson === 'all';
  host.innerHTML = `
    <div class="panel" style="padding:8px 12px">
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Period (start → end)</th>
              ${showPerson ? '<th>Person</th>' : ''}
              <th class="num">Money put</th>
              <th class="num">Total %</th>
              <th class="num">Avg / month</th>
              <th class="num">Total profit</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${txs
              .map((tx) => {
                const profit = Store.profitOf(tx);
                const perMonthRate = Store.monthlyRateOf(tx);
                const perMonthProfit = Store.avgMonthlyProfitOf(tx);
                return `
              <tr>
                <td data-label="Period">
                  <strong>${formatPeriod(tx)}</strong>
                  <div class="muted" style="font-size:0.78rem">${tx.months} month${tx.months === 1 ? '' : 's'} · ${Store.periodDays(tx)} days · ${statusPill(tx)}</div>
                </td>
                ${showPerson ? `<td data-label="Person"><span class="person-chip">${escapeHtml(Store.personName(tx.personId))}</span></td>` : ''}
                <td data-label="Money put" class="num">${fmtMoney(tx.amount)}</td>
                <td data-label="Total %" class="num"><span class="pct-pill">${fmtPct(tx.percent)}</span></td>
                <td data-label="Avg / month" class="num">
                  <strong>${fmtPct(perMonthRate)}</strong>
                  <div class="muted" style="font-size:0.78rem">${fmtMoney(perMonthProfit)}/mo</div>
                </td>
                <td data-label="Total profit" class="num profit-cell">${fmtMoney(profit)}</td>
                <td data-label="Note" class="note-cell"><span class="note-text">${tx.note ? escapeHtml(tx.note) : '<span class="muted">—</span>'}</span></td>
                <td data-label="Actions">
                  <div class="row-actions">
                    <button class="link-btn" data-action="edit" data-id="${tx.id}">Edit</button>
                    <button class="link-btn danger" data-action="delete" data-id="${tx.id}">Delete</button>
                  </div>
                </td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function fillMonthsSelect() {
  const sel = $('#tx-months');
  sel.innerHTML = Array.from({ length: 60 }, (_, i) => {
    const n = i + 1;
    return `<option value="${n}">${n} month${n === 1 ? '' : 's'}</option>`;
  }).join('');
}

function readDealDraft() {
  return {
    startDate: $('#tx-start').value,
    months: Number($('#tx-months').value) || 1,
    amount: Number($('#tx-amount').value) || 0,
    percent: Number($('#tx-percent').value) || 0,
  };
}

function updatePeriodHint() {
  const { startDate, months } = readDealDraft();
  const hint = $('#tx-period-hint');
  if (!startDate) {
    hint.textContent = 'Pick a duration in months.';
    return;
  }
  const draft = { startDate, months };
  const end = Store.endDate(draft);
  const days = Store.periodDays(draft);
  hint.textContent = `${formatDate(startDate)} → ${formatDate(end)} · ${days} day${days === 1 ? '' : 's'}`;
}

function updateProfitPreview() {
  const { startDate, months, amount, percent: totalPercent } = readDealDraft();
  const totalProfit = round2((amount * totalPercent) / 100);
  const perMonthRate = round2(totalPercent / months);
  const perMonthProfit = round2(totalProfit / months);

  $('#tx-preview-profit').textContent = fmtMoney(totalProfit);
  $('#tx-preview-return').textContent =
    amount > 0
      ? `(total returned: ${fmtMoney(amount + totalProfit)})`
      : '';

  const parts = [];
  if (months > 1) {
    parts.push(`${fmtPct(totalPercent)} over ${months} months = ${fmtPct(perMonthRate)}/month avg · ${fmtMoney(perMonthProfit)}/month`);
  } else {
    parts.push('Percent covers the whole period.');
  }
  if (startDate && totalProfit > 0) {
    const days = Store.periodDays({ startDate, months });
    parts.push(`${fmtMoney(round2(totalProfit / days))}/day`);
  }
  $('#tx-rate-hint').textContent = parts.join(' · ');
  updatePeriodHint();
}

function resetTxForm() {
  state.editingId = null;
  $('#tx-form').reset();
  $('#tx-id').value = '';
  $('#tx-start').value = todayISO();
  $('#tx-months').value = '1';
  $('#tx-form-title').textContent = 'Add transaction';
  $('#tx-submit').textContent = 'Add transaction';
  $('#tx-cancel').hidden = true;
  updateProfitPreview();
}

function startEdit(id) {
  const tx = Store.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  state.editingId = id;
  $('#tx-id').value = id;
  $('#tx-person').value = tx.personId;
  $('#tx-start').value = tx.startDate;
  $('#tx-months').value = String(tx.months);
  $('#tx-amount').value = tx.amount;
  $('#tx-percent').value = tx.percent;
  $('#tx-note').value = tx.note;
  $('#tx-form-title').textContent = 'Edit transaction';
  $('#tx-submit').textContent = 'Save changes';
  $('#tx-cancel').hidden = false;
  updateProfitPreview();
  switchTab('transactions');
  $('#tab-transactions .form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatPeriod(tx) {
  const start = formatDate(tx.startDate);
  const end = formatDate(Store.endDate(tx));
  return `${escapeHtml(start)} → ${escapeHtml(end)}`;
}

function statusPill(tx) {
  const status = Store.statusOf(tx);
  const label = status === 'active' ? 'Active' : status === 'ended' ? 'Ended' : 'Upcoming';
  return `<span class="status-pill status-${status}">${label}</span>`;
}

/* ============================================================
   PEOPLE
   ============================================================ */

function renderPeople() {
  const host = $('#people-list');
  const people = Store.getPeople();
  if (!people.length) {
    host.innerHTML = `
      <div class="panel empty-state">
        <span class="big">👥</span>
        No people yet. Add the first person above.
      </div>`;
    return;
  }

  host.innerHTML = people
    .map((p) => {
      const txs = Store.getTransactions({ personId: p.id });
      const s = Store.summarize(txs);
      const initial = escapeHtml(p.name.charAt(0).toUpperCase());
      return `
      <div class="person-card">
        <div class="person-info">
          <div class="name"><span class="avatar">${initial}</span>${escapeHtml(p.name)}</div>
          <div class="person-meta">${s.count} transaction${s.count === 1 ? '' : 's'} · invested ${fmtMoney(s.invested)}</div>
        </div>
        <div class="person-stats">
          <div>Total profit: <span class="v">${fmtMoney(s.profit)}</span></div>
          <div class="person-meta">${fmtPct(s.percent)} overall</div>
        </div>
        <div class="person-actions">
          <button class="btn btn-sm btn-secondary" data-action="history-person" data-id="${p.id}">History</button>
          <button class="btn btn-sm btn-ghost" data-action="rename-person" data-id="${p.id}">Rename</button>
          <button class="btn btn-sm btn-danger" data-action="delete-person" data-id="${p.id}">Delete</button>
        </div>
      </div>`;
    })
    .join('');
}

/* ============================================================
   SETTINGS
   ============================================================ */

function openSettings() {
  $('#set-currency').value = Store.currency;
  const count = Store.data.transactions.length;
  const finCount = Store.data.finance.length;
  $('#storage-note').textContent = `Currently stored on this device: ${Store.data.people.length} people, ${count} transaction${count === 1 ? '' : 's'}, ${finCount} finance entr${finCount === 1 ? 'y' : 'ies'}.`;
  const pf = window.PF?.data;
  $('#backup-contents').textContent = pf
    ? `Build 21 · Included in a new backup: ${pf.entries.length} PF entries, ${pf.accounts.length} accounts, ${pf.budgets.length} budgets and ${pf.recurring.length} recurring items, plus People, Transactions and Finance.`
    : 'Personal Finance is still loading. Wait before exporting.';
  $('#modal-settings').hidden = false;
  renderStorageStatus();
}

// Shows where data lives and asks the browser to protect it from auto-eviction.
async function renderStorageStatus() {
  const host = $('#storage-status');
  if (!host) return;
  let persistent = false;
  let supported = false;
  try {
    if (navigator.storage && navigator.storage.persisted) {
      supported = true;
      persistent = await navigator.storage.persisted();
      if (!persistent && navigator.storage.persist) {
        persistent = await navigator.storage.persist();
      }
    }
  } catch {
    supported = false;
  }
  host.innerHTML =
    `<span class="offline-dot"></span>` +
    `Data is saved <strong>only on this device</strong> and the app works fully offline — no account and no online database.` +
    (supported
      ? persistent
        ? ` Storage protection: <strong>on</strong> (the browser won't auto-clear it).`
        : ` Storage protection: <strong>off</strong> — keep using Export backup to be safe.`
      : ` Keep using Export backup to be safe.`);
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {
    /* unsupported or denied — harmless, backups still available */
  }
}

let offlineBannerTimer = null;

function hideOfflineBanner() {
  const banner = $('#offline-banner');
  if (banner) banner.hidden = true;
  clearTimeout(offlineBannerTimer);
}

function showOfflineBanner() {
  const banner = $('#offline-banner');
  if (!banner) return;
  banner.hidden = false;
  // Informational only — auto-dismiss so it never lingers on screen.
  clearTimeout(offlineBannerTimer);
  offlineBannerTimer = setTimeout(hideOfflineBanner, 4000);
}

function updateOfflineBanner() {
  if (navigator.onLine === false) showOfflineBanner();
  else hideOfflineBanner();
}

function closeSettings() {
  $('#modal-settings').hidden = true;
}

function exportBackup() {
  try {
    const raw = Store.exportData();
    const info = window.AppBackup.inspectData(raw);
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    // Distinguish multiple exports on the same day from an older main-only file.
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
    a.href = url;
    a.download = `al-shwareb-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give Safari time to consume the download before releasing its Blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Backup file downloaded. ${info.summary}`);
  } catch (err) {
    toast(err.message || 'Could not export the backup. Please try again.', true);
  }
}

/* ============================================================
   PERSON HISTORY MODAL
   ============================================================ */

function openHistory(personId) {
  state.historyPersonId = personId;
  renderHistory();
  $('#modal-history').hidden = false;
}

function closeHistory() {
  state.historyPersonId = null;
  $('#modal-history').hidden = true;
}

function renderHistory() {
  const person = Store.personById(state.historyPersonId);
  if (!person) {
    closeHistory();
    return;
  }
  const txs = Store.getTransactions({ personId: person.id });
  const s = Store.summarize(txs);

  $('#history-title').textContent = `${person.name} — transaction history`;
  $('#history-summary').innerHTML = `
    <div class="history-stat"><span class="label">Transactions</span><strong>${s.count}</strong></div>
    <div class="history-stat"><span class="label">Money invested</span><strong>${fmtMoney(s.invested)}</strong></div>
    <div class="history-stat"><span class="label">Total profit</span><strong class="profit-text">${fmtMoney(s.profit)}</strong></div>
    <div class="history-stat"><span class="label">Overall %</span><strong>${fmtPct(s.percent)}</strong></div>`;

  if (!txs.length) {
    $('#history-list').innerHTML = `
      <div class="empty-state"><span class="big">🧾</span>No transactions for ${escapeHtml(person.name)} yet.</div>`;
    return;
  }

  $('#history-list').innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Period (start → end)</th>
            <th>Status</th>
            <th class="num">Money put</th>
            <th class="num">Total %</th>
            <th class="num">Profit</th>
            <th>Note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${txs
            .map(
              (tx) => `
            <tr>
              <td data-label="Period">
                <strong>${formatPeriod(tx)}</strong>
                <div class="muted" style="font-size:0.78rem">${tx.months} month${tx.months === 1 ? '' : 's'} · ${Store.periodDays(tx)} days</div>
              </td>
              <td data-label="Status">${statusPill(tx)}</td>
              <td data-label="Money put" class="num">${fmtMoney(tx.amount)}</td>
              <td data-label="Total %" class="num"><span class="pct-pill">${fmtPct(tx.percent)}</span></td>
              <td data-label="Profit" class="num profit-cell">${fmtMoney(Store.profitOf(tx))}</td>
              <td data-label="Note" class="note-cell"><span class="note-text">${tx.note ? escapeHtml(tx.note) : '<span class="muted">—</span>'}</span></td>
              <td data-label="Actions">
                <div class="row-actions">
                  <button class="link-btn" data-action="hist-edit" data-id="${tx.id}">Edit</button>
                  <button class="link-btn danger" data-action="hist-delete" data-id="${tx.id}">Delete</button>
                </div>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

/* ============================================================
   FINANCE (STANDALONE) & FINANCE HISTORY MODAL
   ============================================================ */

function setFinProfitType(type) {
  state.finProfitType = type === 'fixed' ? 'fixed' : 'percent';
  $$('#fin-form .seg-btn').forEach((btn) => {
    const active = btn.dataset.profitType === state.finProfitType;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });

  const wrap = $('#fin-profit-wrap');
  const label = $('#fin-profit-label');
  const suffix = $('#fin-profit-suffix');
  const input = $('#fin-profit-value');

  if (state.finProfitType === 'fixed') {
    label.textContent = 'Fixed profit amount *';
    suffix.textContent = Store.currency;
    wrap.classList.add('input-suffix-wide');
    input.placeholder = '0.00';
  } else {
    label.textContent = 'Profit percentage *';
    suffix.textContent = '%';
    wrap.classList.remove('input-suffix-wide');
    input.placeholder = '0';
  }

  updateFinancePreview();
}

function readFinanceDraft() {
  return {
    paidDate: $('#fin-paid-date').value,
    receiveDate: $('#fin-receive-date').value,
    amount: Number($('#fin-amount').value) || 0,
    profitType: state.finProfitType,
    profitValue: Number($('#fin-profit-value').value) || 0,
    received: $('#fin-received').value === 'received',
  };
}

function updateFinanceReceiveHint() {
  const { paidDate, receiveDate } = readFinanceDraft();
  const hint = $('#fin-receive-hint');
  if (!receiveDate) {
    hint.textContent = 'Optional — pick when you expect to receive payout.';
    return;
  }
  if (paidDate && receiveDate < paidDate) {
    hint.textContent = 'Date to receive cannot be earlier than date paid.';
    return;
  }
  const days = Store.financeDaysUntilReceive({ receiveDate });
  let rel = '';
  if (days === 0) rel = 'due today';
  else if (days > 0) rel = `in ${days} day${days === 1 ? '' : 's'}`;
  else rel = `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  hint.textContent = `${formatDate(receiveDate)} · ${rel}`;
}

function updateFinancePreview() {
  const draft = readFinanceDraft();
  const profit = Store.financeProfitOf(draft);
  const pct = Store.financePercentOf(draft);
  const totalReturn = Store.financeReturnOf(draft);

  $('#fin-preview-profit').textContent = fmtMoney(profit);
  if (draft.amount > 0) {
    $('#fin-preview-return').textContent = `(total to receive: ${fmtMoney(totalReturn)} · ${fmtPct(pct)})`;
  } else if (profit > 0) {
    $('#fin-preview-return').textContent = `(fixed profit: ${fmtMoney(profit)})`;
  } else {
    $('#fin-preview-return').textContent = '';
  }

  const profitHint = $('#fin-profit-hint');
  if (draft.profitType === 'percent') {
    profitHint.textContent =
      draft.amount > 0
        ? `${fmtPct(draft.profitValue)} of ${fmtMoney(draft.amount)} = ${fmtMoney(profit)} profit.`
        : 'Calculated as a percentage of the amount paid.';
  } else {
    profitHint.textContent =
      draft.amount > 0
        ? `Fixed profit · equals ${fmtPct(pct)} of amount paid.`
        : `Fixed profit amount in ${Store.currency}.`;
  }

  updateFinanceReceiveHint();
}

function resetFinForm() {
  state.finEditingId = null;
  $('#fin-form').reset();
  $('#fin-id').value = '';
  $('#fin-paid-date').value = todayISO();
  $('#fin-receive-date').value = '';
  $('#fin-received').value = 'pending';
  $('#fin-form-title').textContent = 'Add finance entry';
  $('#fin-submit').textContent = 'Add entry';
  $('#fin-cancel').hidden = true;
  setFinProfitType('percent');
}

function startFinEdit(id) {
  const entry = Store.financeById(id);
  if (!entry) return;
  state.finEditingId = id;
  $('#fin-id').value = id;
  $('#fin-amount').value = entry.amount;
  $('#fin-paid-date').value = entry.paidDate;
  $('#fin-receive-date').value = entry.receiveDate || '';
  $('#fin-received').value = entry.received ? 'received' : 'pending';
  $('#fin-profit-value').value = entry.profitValue;
  $('#fin-note').value = entry.note;
  $('#fin-form-title').textContent = 'Edit finance entry';
  $('#fin-submit').textContent = 'Save changes';
  $('#fin-cancel').hidden = false;
  setFinProfitType(entry.profitType);
  switchTab('finance');
  $('#fin-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function financeStatusPill(f) {
  const status = Store.financeStatusOf(f);
  const labels = {
    received: 'Received',
    overdue: 'Overdue',
    'due-today': 'Due today',
    upcoming: 'Upcoming',
    pending: 'Pending',
  };
  return `<span class="status-pill status-${status}">${labels[status] || 'Pending'}</span>`;
}

function formatReceiveCell(f) {
  if (!f.receiveDate) {
    return `<span class="muted">Not set</span><div style="margin-top:3px">${financeStatusPill(f)}</div>`;
  }
  const dateLabel = escapeHtml(formatDate(f.receiveDate));
  if (f.received) {
    return `<strong>${dateLabel}</strong><div style="margin-top:3px">${financeStatusPill(f)}</div>`;
  }
  const days = Store.financeDaysUntilReceive(f);
  let sub = '';
  if (days === 0) sub = 'Due today';
  else if (days > 0) sub = `In ${days} day${days === 1 ? '' : 's'}`;
  else sub = `${Math.abs(days)}d overdue`;
  return `<strong>${dateLabel}</strong><div class="muted" style="font-size:0.78rem;margin-top:2px">${sub} · ${financeStatusPill(f)}</div>`;
}

function formatProfitOptionCell(f) {
  if (f.profitType === 'fixed') {
    return `<span class="fixed-pill">Fixed</span><div class="muted" style="font-size:0.78rem">${fmtPct(Store.financePercentOf(f))} eq.</div>`;
  }
  return `<span class="pct-pill">${fmtPct(f.profitValue)}</span><div class="muted" style="font-size:0.78rem">Percentage</div>`;
}

function buildFinanceTableHtml(entries) {
  return `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Date paid</th>
            <th>Date to receive</th>
            <th class="num">Amount paid</th>
            <th class="num">Profit option</th>
            <th class="num">Profit</th>
            <th class="num">Total to receive</th>
            <th>Note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${entries
            .map((f) => {
              const profit = Store.financeProfitOf(f);
              const totalReturn = Store.financeReturnOf(f);
              const toggleLabel = f.received ? 'Undo' : 'Received';
              return `
            <tr>
              <td data-label="Date paid"><strong>${escapeHtml(formatDate(f.paidDate))}</strong></td>
              <td data-label="Date to receive">${formatReceiveCell(f)}</td>
              <td data-label="Amount paid" class="num">${fmtMoney(f.amount)}</td>
              <td data-label="Profit option" class="num">${formatProfitOptionCell(f)}</td>
              <td data-label="Profit" class="num profit-cell">${fmtMoney(profit)}</td>
              <td data-label="Total to receive" class="num"><strong>${fmtMoney(totalReturn)}</strong></td>
              <td data-label="Note" class="note-cell"><span class="note-text">${f.note ? escapeHtml(f.note) : '<span class="muted">—</span>'}</span></td>
              <td data-label="Actions">
                <div class="row-actions">
                  <button class="link-btn" data-action="fin-toggle-received" data-id="${f.id}">${toggleLabel}</button>
                  <button class="link-btn" data-action="fin-edit" data-id="${f.id}">Edit</button>
                  <button class="link-btn danger" data-action="fin-delete" data-id="${f.id}">Delete</button>
                </div>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function renderFinance() {
  const allEntries = Store.getFinanceEntries();
  const s = Store.summarizeFinance(allEntries);

  const histLabel = `View history (${allEntries.length})`;
  $('#btn-fin-history').textContent = histLabel;
  $('#btn-fin-history-bottom').textContent = histLabel;

  // Refresh currency suffix if fixed mode is active
  if (state.finProfitType === 'fixed') {
    $('#fin-profit-suffix').textContent = Store.currency;
  }
  updateFinancePreview();

  const nextEntry =
    allEntries
      .filter((f) => !f.received && f.receiveDate)
      .sort((a, b) => a.receiveDate.localeCompare(b.receiveDate))[0] || null;

  let nextSub = 'No pending dates';
  if (nextEntry) {
    const days = Store.financeDaysUntilReceive(nextEntry);
    const when = days === 0 ? 'Due today' : days > 0 ? `In ${days}d` : `${Math.abs(days)}d overdue`;
    nextSub = `${when} · ${fmtMoney(Store.financeReturnOf(nextEntry))}`;
  } else if (s.pendingCount > 0) {
    nextSub = `${fmtMoney(s.pendingReturn)} pending (no date set)`;
  }

  $('#fin-cards').innerHTML = `
    <div class="card">
      <div class="label">Amount paid</div>
      <div class="value">${fmtMoney(s.totalPaid)}</div>
      <div class="sub">${s.count} entr${s.count === 1 ? 'y' : 'ies'} · ${s.pendingCount} pending, ${s.receivedCount} received</div>
    </div>
    <div class="card profit">
      <div class="label">Total profit</div>
      <div class="value">${fmtMoney(s.totalProfit)}</div>
      <div class="sub">Total to receive: ${fmtMoney(s.totalReturn)}</div>
    </div>
    <div class="card">
      <div class="label">Overall return</div>
      <div class="value">${fmtPct(s.overallPercent)}</div>
      <div class="sub">${s.percentCount} percentage · ${s.fixedCount} fixed</div>
    </div>
    <div class="card">
      <div class="label">Next to receive</div>
      <div class="value" style="font-size:1.05rem">${nextEntry ? escapeHtml(formatDate(nextEntry.receiveDate)) : '—'}</div>
      <div class="sub">${nextSub}</div>
    </div>`;

  const filtered = Store.getFinanceEntries({
    status: state.finFilterStatus,
    profitType: state.finFilterType,
  });

  const host = $('#fin-list');
  if (!filtered.length) {
    host.innerHTML = `
      <div class="panel empty-state">
        <span class="big">💰</span>
        ${allEntries.length ? 'No finance entries match these filters.' : 'No finance entries yet.<br/>Use the form above to document an amount paid and profit.'}
      </div>`;
    return;
  }

  host.innerHTML = `<div class="panel" style="padding:8px 12px">${buildFinanceTableHtml(filtered)}</div>`;
}

function openFinanceHistory() {
  $('#fin-hist-status').value = state.finHistStatus;
  $('#fin-hist-type').value = state.finHistType;
  $('#fin-hist-search').value = state.finHistQuery;
  renderFinanceHistory();
  $('#modal-finance-history').hidden = false;
}

function closeFinanceHistory() {
  $('#modal-finance-history').hidden = true;
}

function renderFinanceHistory() {
  const entries = Store.getFinanceEntries({
    status: state.finHistStatus,
    profitType: state.finHistType,
    query: state.finHistQuery,
  });
  const s = Store.summarizeFinance(entries);

  $('#fin-history-summary').innerHTML = `
    <div class="history-stat"><span class="label">Entries</span><strong>${s.count}</strong><span class="muted" style="font-size:0.75rem">${s.pendingCount} pending · ${s.receivedCount} received</span></div>
    <div class="history-stat"><span class="label">Amount paid</span><strong>${fmtMoney(s.totalPaid)}</strong></div>
    <div class="history-stat"><span class="label">Total profit</span><strong class="profit-text">${fmtMoney(s.totalProfit)}</strong><span class="muted" style="font-size:0.75rem">${fmtPct(s.overallPercent)} overall</span></div>
    <div class="history-stat"><span class="label">Total to receive</span><strong>${fmtMoney(s.totalReturn)}</strong><span class="muted" style="font-size:0.75rem">Pending: ${fmtMoney(s.pendingReturn)}</span></div>`;

  const host = $('#fin-history-list');
  if (!entries.length) {
    const totalCount = Store.data.finance.length;
    host.innerHTML = `
      <div class="empty-state">
        <span class="big">🗂️</span>
        ${totalCount ? 'No finance history entries match the current filters.' : 'No finance entries recorded yet.'}
      </div>`;
    return;
  }

  host.innerHTML = buildFinanceTableHtml(entries);
}

function handleFinanceRowAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'fin-toggle-received') {
    try {
      const updated = Store.toggleFinanceReceived(id);
      if (state.finEditingId === id) {
        $('#fin-received').value = updated.received ? 'received' : 'pending';
      }
      renderAll();
      if (!$('#modal-finance-history').hidden) renderFinanceHistory();
      toast(updated.received ? 'Marked as received.' : 'Marked as pending.');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  if (action === 'fin-edit') {
    if (!$('#modal-finance-history').hidden) closeFinanceHistory();
    startFinEdit(id);
    return;
  }

  if (action === 'fin-delete') {
    if (confirm('Delete this finance entry? This cannot be undone.')) {
      Store.deleteFinance(id);
      if (state.finEditingId === id) resetFinForm();
      renderAll();
      if (!$('#modal-finance-history').hidden) renderFinanceHistory();
      toast('Finance entry deleted.');
    }
  }
}

/* ============================================================
   FULL RE-RENDER
   ============================================================ */

function renderAll() {
  fillPersonSelects();
  fillMonthFilter();
  renderDashboard();
  renderTransactionList();
  renderPeople();
  renderFinance();
}

/* ============================================================
   EVENTS
   ============================================================ */

function bindEvents() {
  // Tabs
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Dashboard filter
  $('#dash-person').addEventListener('change', (e) => {
    state.dashPerson = e.target.value;
    renderDashboard();
  });

  // Transaction filters
  $('#filter-person').addEventListener('change', (e) => {
    state.filterPerson = e.target.value;
    renderTransactionList();
  });
  $('#filter-month').addEventListener('change', (e) => {
    state.filterMonth = e.target.value;
    renderTransactionList();
  });

  // Live profit preview
  $('#tx-amount').addEventListener('input', updateProfitPreview);
  $('#tx-percent').addEventListener('input', updateProfitPreview);
  $('#tx-months').addEventListener('change', updateProfitPreview);
  $('#tx-start').addEventListener('change', updateProfitPreview);

  // Add / edit transaction
  $('#tx-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = {
      personId: $('#tx-person').value,
      startDate: $('#tx-start').value,
      months: $('#tx-months').value,
      amount: $('#tx-amount').value,
      percent: $('#tx-percent').value,
      note: $('#tx-note').value,
    };
    try {
      if (state.editingId) {
        Store.updateTransaction(state.editingId, payload);
        toast('Transaction updated.');
      } else {
        Store.addTransaction(payload);
        toast('Transaction added.');
      }
      resetTxForm();
      renderAll();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#tx-cancel').addEventListener('click', resetTxForm);

  // Transaction row actions (event delegation)
  $('#tx-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit') startEdit(id);
    if (action === 'delete') {
      if (confirm('Delete this transaction? This cannot be undone.')) {
        Store.deleteTransaction(id);
        if (state.editingId === id) resetTxForm();
        renderAll();
        toast('Transaction deleted.');
      }
    }
  });

  // Add person
  $('#person-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#person-name');
    try {
      Store.addPerson(input.value);
      input.value = '';
      renderAll();
      toast('Person added.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // People list actions
  $('#people-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const person = Store.personById(id);
    if (!person) return;

    if (action === 'history-person') {
      openHistory(id);
      return;
    }

    if (action === 'rename-person') {
      const name = prompt('New name:', person.name);
      if (name === null) return;
      try {
        Store.renamePerson(id, name);
        renderAll();
        toast('Person renamed.');
      } catch (err) {
        toast(err.message, true);
      }
    }

    if (action === 'delete-person') {
      const count = Store.getTransactions({ personId: id }).length;
      const msg = count
        ? `Delete "${person.name}" and their ${count} transaction${count === 1 ? '' : 's'}? This cannot be undone.`
        : `Delete "${person.name}"?`;
      if (confirm(msg)) {
        Store.deletePerson(id);
        if (state.dashPerson === id) state.dashPerson = 'all';
        if (state.filterPerson === id) state.filterPerson = 'all';
        renderAll();
        toast('Person deleted.');
      }
    }
  });

  // Settings modal
  $('#open-settings').addEventListener('click', openSettings);
  $$('[data-close-modal]').forEach((el) => el.addEventListener('click', closeSettings));

  // History modal
  $$('[data-close-history]').forEach((el) => el.addEventListener('click', closeHistory));
  $('#history-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'hist-edit') {
      closeHistory();
      startEdit(id);
    }
    if (action === 'hist-delete') {
      if (confirm('Delete this transaction? This cannot be undone.')) {
        Store.deleteTransaction(id);
        renderAll();
        renderHistory();
        toast('Transaction deleted.');
      }
    }
  });

  // Finance profit type toggle (Percentage vs Fixed amount)
  $$('#fin-form .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => setFinProfitType(btn.dataset.profitType));
  });

  // Finance live preview
  $('#fin-amount').addEventListener('input', updateFinancePreview);
  $('#fin-profit-value').addEventListener('input', updateFinancePreview);
  $('#fin-receive-date').addEventListener('change', updateFinancePreview);
  $('#fin-paid-date').addEventListener('change', updateFinancePreview);

  // Add / edit finance entry
  $('#fin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = {
      paidDate: $('#fin-paid-date').value,
      receiveDate: $('#fin-receive-date').value,
      amount: $('#fin-amount').value,
      profitType: state.finProfitType,
      profitValue: $('#fin-profit-value').value,
      received: $('#fin-received').value === 'received',
      note: $('#fin-note').value,
    };
    try {
      if (state.finEditingId) {
        Store.updateFinance(state.finEditingId, payload);
        toast('Finance entry updated.');
      } else {
        Store.addFinance(payload);
        toast('Finance entry added.');
      }
      resetFinForm();
      renderAll();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#fin-cancel').addEventListener('click', resetFinForm);

  // Finance tab filters
  $('#fin-filter-status').addEventListener('change', (e) => {
    state.finFilterStatus = e.target.value;
    renderFinance();
  });
  $('#fin-filter-type').addEventListener('change', (e) => {
    state.finFilterType = e.target.value;
    renderFinance();
  });

  // Finance row actions (tab list + history modal)
  $('#fin-list').addEventListener('click', handleFinanceRowAction);
  $('#fin-history-list').addEventListener('click', handleFinanceRowAction);

  // Finance history modal
  $('#btn-fin-history').addEventListener('click', openFinanceHistory);
  $('#btn-fin-history-bottom').addEventListener('click', openFinanceHistory);
  $$('[data-close-fin-history]').forEach((el) => el.addEventListener('click', closeFinanceHistory));

  $('#fin-hist-status').addEventListener('change', (e) => {
    state.finHistStatus = e.target.value;
    renderFinanceHistory();
  });
  $('#fin-hist-type').addEventListener('change', (e) => {
    state.finHistType = e.target.value;
    renderFinanceHistory();
  });
  $('#fin-hist-search').addEventListener('input', (e) => {
    state.finHistQuery = e.target.value;
    renderFinanceHistory();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#modal-settings').hidden) closeSettings();
    if (!$('#modal-history').hidden) closeHistory();
    if (!$('#modal-finance-history').hidden) closeFinanceHistory();
  });

  $('#set-currency').addEventListener('change', (e) => {
    Store.setCurrency(e.target.value || 'EGP');
    updateProfitPreview();
    renderAll();
    if (!$('#modal-finance-history').hidden) renderFinanceHistory();
    toast('Currency updated.');
  });

  $('#btn-export').addEventListener('click', exportBackup);

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const info = window.AppBackup.inspectData(String(reader.result));
        if (!confirm(info.confirmation)) return;
        window.AppBackup.importData(String(reader.result));
        state.dashPerson = 'all';
        state.filterPerson = 'all';
        state.filterMonth = 'all';
        state.finFilterStatus = 'all';
        state.finFilterType = 'all';
        state.finHistStatus = 'all';
        state.finHistType = 'all';
        state.finHistQuery = '';
        $('#fin-filter-status').value = 'all';
        $('#fin-filter-type').value = 'all';
        resetTxForm();
        resetFinForm();
        renderAll();
        closeSettings();
        closeHistory();
        closeFinanceHistory();
        toast(info.success);
      } catch (err) {
        toast(err.message, true);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#btn-sample').addEventListener('click', () => {
    if ((Store.data.people.length || Store.data.finance.length) && !confirm('Add sample data to the current data?')) return;
    Store.loadSampleData();
    renderAll();
    toast('Sample data loaded.');
  });

  $('#btn-erase').addEventListener('click', () => {
    if (!confirm('Erase ALL people, transactions, and finance entries from this device?')) return;
    if (!confirm('Really erase everything? Consider exporting a backup first.')) return;
    Store.eraseAll();
    state.dashPerson = 'all';
    state.filterPerson = 'all';
    state.filterMonth = 'all';
    state.finFilterStatus = 'all';
    state.finFilterType = 'all';
    state.finHistStatus = 'all';
    state.finHistType = 'all';
    state.finHistQuery = '';
    $('#fin-filter-status').value = 'all';
    $('#fin-filter-type').value = 'all';
    resetTxForm();
    resetFinForm();
    renderAll();
    closeSettings();
    toast('All data erased.');
  });
}

/* ---------- boot ---------- */

document.addEventListener('DOMContentLoaded', () => {
  Store.load();
  fillMonthsSelect();
  bindEvents();
  resetTxForm();
  resetFinForm();
  renderAll();
  requestPersistentStorage();
  updateOfflineBanner();
  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  // Re-check when the user returns to the app (some devices miss the 'online' event).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateOfflineBanner();
  });
  $('#offline-banner-close').addEventListener('click', hideOfflineBanner);
});
