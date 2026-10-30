/* ============================================================
   Al-shwareb — Personal Finance (PF)
   A fully standalone module: its own storage key, its own data
   model, its own rendering. Nothing here reads or writes the
   People / Transactions / Finance / Dashboard data.

   PF data model (localStorage key 'alshwareb_pf_v1'):

     accounts   { id, name, type, opening, createdAt }
                balance = opening + income - expense (all entries
                that point at this account)

     categories { id, name, kind: 'income' | 'expense' }

     entries    { id, type: 'income' | 'expense', amount,
                  date: 'YYYY-MM-DD', accountId, categoryId,
                  note, recurringId, createdAt }

     budgets    { id, month: 'YYYY-MM', categoryId, limit }

     recurring  { id, type, amount, accountId, categoryId, note,
                  frequency: 'weekly' | 'monthly' | 'yearly',
                  startDate, lastPosted, active }
   ============================================================ */

(function () {
  'use strict';

  const PF_KEY = 'alshwareb_pf_v1';
  const PF_VERSION = 1;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTH_RE = /^\d{4}-\d{2}$/;
  const MAX_AMOUNT = 1e12;

  const ACCOUNT_TYPES = [
    ['cash', 'Cash'],
    ['bank', 'Bank account'],
    ['wallet', 'Mobile wallet'],
    ['card', 'Card'],
    ['savings', 'Savings'],
    ['other', 'Other'],
  ];
  const FREQUENCIES = [
    ['weekly', 'Every week'],
    ['monthly', 'Every month'],
    ['yearly', 'Every year'],
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------------- small helpers ---------------- */

  const pad2 = (n) => String(n).padStart(2, '0');

  function isoOf(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function todayISO() {
    return isoOf(new Date());
  }
  function nowMonth() {
    return todayISO().slice(0, 7);
  }
  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function isRealDate(iso) {
    if (!DATE_RE.test(iso || '')) return false;
    const d = parseISO(iso);
    return !Number.isNaN(d.getTime()) && isoOf(d) === iso;
  }
  function isRealMonth(ym) {
    return MONTH_RE.test(ym || '') && Number(ym.slice(5, 7)) >= 1 && Number(ym.slice(5, 7)) <= 12;
  }
  function monthOf(iso) {
    return String(iso || '').slice(0, 7);
  }
  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }
  function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!isRealDate(iso)) return '—';
    return parseISO(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  function fmtMonth(ym) {
    if (!isRealMonth(ym)) return '—';
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  function shortMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
  }
  function money(n) {
    const v = Number(n) || 0;
    const cur = (PF.data && PF.data.meta.currency) || '';
    const formatted = v.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return cur ? `${formatted} ${cur}` : formatted;
  }
  function signedMoney(n, type) {
    const sign = type === 'income' ? '+' : '−';
    return `${sign} ${money(Math.abs(Number(n) || 0))}`;
  }
  function shortMoney(n) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    if (abs >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v));
  }
  function daysBetween(fromISO, toISO) {
    const a = parseISO(fromISO).getTime();
    const b = parseISO(toISO).getTime();
    return Math.round((b - a) / 86400000);
  }
  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function addMonthsClamped(iso, months, anchorDay) {
    const d = parseISO(iso);
    const day = anchorDay || d.getDate();
    const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    return isoOf(target);
  }
  function addPeriod(iso, frequency, anchorDay) {
    if (frequency === 'weekly') {
      const d = parseISO(iso);
      d.setDate(d.getDate() + 7);
      return isoOf(d);
    }
    if (frequency === 'yearly') return addMonthsClamped(iso, 12, anchorDay);
    return addMonthsClamped(iso, 1, anchorDay);
  }
  function accountTypeLabel(type) {
    const found = ACCOUNT_TYPES.find((t) => t[0] === type);
    return found ? found[1] : 'Other';
  }
  function frequencyLabel(freq) {
    const found = FREQUENCIES.find((f) => f[0] === freq);
    return found ? found[1] : 'Every month';
  }
  function toast(message, isError) {
    // Re-use the app's toast element/styling when present.
    if (typeof window.toast === 'function') {
      window.toast(message, !!isError);
      return;
    }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = isError ? 'toast show error' : 'toast show';
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => {
        el.hidden = true;
      }, 220);
    }, 2600);
  }

  /* ---------------- seed data ---------------- */

  function seedAccounts() {
    return [
      { id: uid('acc'), name: 'Cash', type: 'cash', opening: 0, createdAt: new Date().toISOString() },
      { id: uid('acc'), name: 'Bank', type: 'bank', opening: 0, createdAt: new Date().toISOString() },
    ];
  }
  function seedCategories() {
    const expense = ['Food & drinks', 'Transport', 'Rent', 'Utilities', 'Health', 'Shopping', 'Family', 'Other expense'];
    const income = ['Salary', 'Freelance', 'Gift', 'Other income'];
    return [
      ...expense.map((name) => ({ id: uid('cat'), name, kind: 'expense' })),
      ...income.map((name) => ({ id: uid('cat'), name, kind: 'income' })),
    ];
  }
  function defaultData() {
    return {
      meta: { version: PF_VERSION, currency: 'EGP', createdAt: new Date().toISOString() },
      accounts: seedAccounts(),
      categories: seedCategories(),
      entries: [],
      budgets: [],
      recurring: [],
    };
  }

  /* ---------------- normalisation ---------------- */

  function normalizeData(input) {
    const src = input && typeof input === 'object' ? input : {};
    const out = defaultData();
    out.meta = {
      version: PF_VERSION,
      currency: String((src.meta && src.meta.currency) || 'EGP').slice(0, 8),
      createdAt: (src.meta && src.meta.createdAt) || new Date().toISOString(),
    };

    const accounts = Array.isArray(src.accounts) ? src.accounts : [];
    const seenAcc = new Set();
    out.accounts = accounts
      .filter((a) => a && a.id && a.name)
      .map((a) => {
        const id = String(a.id);
        const opening = round2(num(a.opening));
        return {
          id,
          name: String(a.name).slice(0, 40),
          type: ACCOUNT_TYPES.some((t) => t[0] === a.type) ? a.type : 'other',
          opening: Number.isFinite(opening) ? opening : 0,
          createdAt: a.createdAt || new Date().toISOString(),
        };
      })
      .filter((a) => (seenAcc.has(a.id) ? false : seenAcc.add(a.id)))
      .slice(0, 40);
    if (!out.accounts.length) out.accounts = seedAccounts();
    const accountIds = new Set(out.accounts.map((a) => a.id));

    const categories = Array.isArray(src.categories) ? src.categories : [];
    const seenCat = new Set();
    out.categories = categories
      .filter((c) => c && c.id && c.name && (c.kind === 'income' || c.kind === 'expense'))
      .map((c) => ({ id: String(c.id), name: String(c.name).slice(0, 40), kind: c.kind }))
      .filter((c) => (seenCat.has(c.id) ? false : seenCat.add(c.id)))
      .slice(0, 120);
    if (!out.categories.length) out.categories = seedCategories();
    if (!out.categories.some((c) => c.kind === 'expense')) {
      out.categories.push({ id: uid('cat'), name: 'Other expense', kind: 'expense' });
    }
    if (!out.categories.some((c) => c.kind === 'income')) {
      out.categories.push({ id: uid('cat'), name: 'Other income', kind: 'income' });
    }
    const categoryMap = new Map(out.categories.map((c) => [c.id, c]));
    const firstOfKind = (kind) => out.categories.find((c) => c.kind === kind).id;

    const seenEntry = new Set();
    out.entries = (Array.isArray(src.entries) ? src.entries : [])
      .filter((e) => e && e.id && (e.type === 'income' || e.type === 'expense'))
      .map((e) => {
        const amount = round2(num(e.amount));
        let date = e.date;
        if (!isRealDate(date)) date = todayISO();
        const accountId = accountIds.has(String(e.accountId)) ? String(e.accountId) : out.accounts[0].id;
        let categoryId = String(e.categoryId || '');
        const cat = categoryMap.get(categoryId);
        if (!cat || cat.kind !== e.type) categoryId = firstOfKind(e.type);
        return {
          id: String(e.id),
          type: e.type,
          amount: amount > 0 ? amount : 0,
          date,
          accountId,
          categoryId,
          note: e.note ? String(e.note).slice(0, 200) : '',
          recurringId: e.recurringId ? String(e.recurringId) : null,
          createdAt: e.createdAt || new Date().toISOString(),
        };
      })
      .filter((e) => e.amount > 0)
      .filter((e) => (seenEntry.has(e.id) ? false : seenEntry.add(e.id)));

    const seenBudget = new Set();
    out.budgets = (Array.isArray(src.budgets) ? src.budgets : [])
      .filter((b) => b && isRealMonth(b.month) && categoryMap.has(String(b.categoryId)))
      .map((b) => {
        const cat = categoryMap.get(String(b.categoryId));
        return {
          id: b.id ? String(b.id) : uid('bud'),
          month: b.month,
          categoryId: cat.id,
          limit: Math.max(0, round2(num(b.limit))),
        };
      })
      .filter((b) => {
        const cat = categoryMap.get(b.categoryId);
        return cat && cat.kind === 'expense' && b.limit > 0;
      })
      .filter((b) => {
        const key = `${b.month}|${b.categoryId}`;
        if (seenBudget.has(key)) return false;
        seenBudget.add(key);
        return true;
      });

    out.recurring = (Array.isArray(src.recurring) ? src.recurring : [])
      .filter((r) => r && r.id && (r.type === 'income' || r.type === 'expense'))
      .map((r) => {
        const amount = round2(num(r.amount));
        const type = r.type;
        const accountId = accountIds.has(String(r.accountId)) ? String(r.accountId) : out.accounts[0].id;
        let categoryId = String(r.categoryId || '');
        const cat = categoryMap.get(categoryId);
        if (!cat || cat.kind !== type) categoryId = firstOfKind(type);
        const frequency = FREQUENCIES.some((f) => f[0] === r.frequency) ? r.frequency : 'monthly';
        const startDate = isRealDate(r.startDate) ? r.startDate : todayISO();
        return {
          id: String(r.id),
          type,
          amount: amount > 0 ? amount : 0,
          accountId,
          categoryId,
          note: r.note ? String(r.note).slice(0, 200) : '',
          frequency,
          startDate,
          lastPosted: isRealDate(r.lastPosted) ? r.lastPosted : null,
          active: r.active !== false,
          createdAt: r.createdAt || new Date().toISOString(),
        };
      })
      .filter((r) => r.amount > 0);

    return out;
  }

  /* ---------------- store ---------------- */

  const PF = {
    storageKey: PF_KEY,
    data: null,

    load() {
      let raw = null;
      try {
        raw = localStorage.getItem(PF_KEY);
      } catch (err) {
        console.warn('PF: storage unavailable', err);
      }
      let parsed = null;
      if (raw) {
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (err) {
          console.warn('PF: stored data was not valid JSON', err);
        }
      }
      this.data = normalizeData(parsed || defaultData());
      this.save();
      return this.data;
    },

    save() {
      try {
        localStorage.setItem(PF_KEY, JSON.stringify(this.data));
      } catch (err) {
        console.error('PF: could not save', err);
        toast('Could not save Personal Finance data on this device.', true);
      }
    },

    /* ---- lookups ---- */
    account(id) {
      return this.data.accounts.find((a) => a.id === id) || null;
    },
    category(id) {
      return this.data.categories.find((c) => c.id === id) || null;
    },
    accountName(id) {
      const a = this.account(id);
      return a ? a.name : 'Unknown account';
    },
    categoryName(id) {
      const c = this.category(id);
      return c ? c.name : 'Uncategorised';
    },
    categoriesOf(kind) {
      return this.data.categories
        .filter((c) => c.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    rule(id) {
      return this.data.recurring.find((r) => r.id === id) || null;
    },

    /* ---- accounts ---- */
    addAccount(payload) {
      const name = String(payload.name || '').trim();
      if (!name) throw new Error('Give the account a name.');
      if (this.data.accounts.length >= 40) throw new Error('That is a lot of accounts — 40 is the limit.');
      if (this.data.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('An account with that name already exists.');
      }
      const account = {
        id: uid('acc'),
        name: name.slice(0, 40),
        type: ACCOUNT_TYPES.some((t) => t[0] === payload.type) ? payload.type : 'other',
        opening: round2(num(payload.opening)),
        createdAt: new Date().toISOString(),
      };
      this.data.accounts.push(account);
      this.save();
      return account;
    },
    updateAccount(id, payload) {
      const account = this.account(id);
      if (!account) throw new Error('Account not found.');
      const name = String(payload.name || '').trim();
      if (!name) throw new Error('Give the account a name.');
      if (
        this.data.accounts.some(
          (a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        throw new Error('Another account already uses that name.');
      }
      account.name = name.slice(0, 40);
      account.type = ACCOUNT_TYPES.some((t) => t[0] === payload.type) ? payload.type : 'other';
      account.opening = round2(num(payload.opening));
      this.save();
      return account;
    },
    deleteAccount(id) {
      if (this.data.accounts.length <= 1) throw new Error('Keep at least one account.');
      const used = this.data.entries.filter((e) => e.accountId === id).length;
      if (used) {
        throw new Error(
          `This account has ${used} ${used === 1 ? 'entry' : 'entries'}. Delete or move ${used === 1 ? 'it' : 'them'} first.`
        );
      }
      const rules = this.data.recurring.filter((r) => r.accountId === id).length;
      if (rules) throw new Error(`This account is used by ${rules} recurring ${rules === 1 ? 'entry' : 'entries'}.`);
      this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
      this.save();
    },
    accountBalance(id) {
      const account = this.account(id);
      if (!account) return 0;
      let balance = account.opening || 0;
      for (const e of this.data.entries) {
        if (e.accountId !== id) continue;
        balance += e.type === 'income' ? e.amount : -e.amount;
      }
      return round2(balance);
    },
    totalBalance() {
      return round2(
        this.data.accounts.reduce((sum, a) => sum + this.accountBalance(a.id), 0)
      );
    },

    /* ---- categories ---- */
    addCategory(payload) {
      const name = String(payload.name || '').trim();
      const kind = payload.kind === 'income' ? 'income' : 'expense';
      if (!name) throw new Error('Give the category a name.');
      if (this.data.categories.length >= 120) throw new Error('Category limit reached.');
      if (this.data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.kind === kind)) {
        throw new Error('That category already exists for this type.');
      }
      const category = { id: uid('cat'), name: name.slice(0, 40), kind };
      this.data.categories.push(category);
      this.save();
      return category;
    },
    deleteCategory(id) {
      const entryCount = this.data.entries.filter((e) => e.categoryId === id).length;
      const budgetCount = this.data.budgets.filter((b) => b.categoryId === id).length;
      const ruleCount = this.data.recurring.filter((r) => r.categoryId === id).length;
      if (entryCount || budgetCount || ruleCount) {
        const parts = [];
        if (entryCount) parts.push(`${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`);
        if (budgetCount) parts.push(`${budgetCount} ${budgetCount === 1 ? 'budget' : 'budgets'}`);
        if (ruleCount) parts.push(`${ruleCount} recurring`);
        throw new Error(`This category is used by ${parts.join(', ')}.`);
      }
      const kind = (this.category(id) || {}).kind;
      if (this.categoriesOf(kind).length <= 1) {
        throw new Error(`Keep at least one ${kind} category.`);
      }
      this.data.categories = this.data.categories.filter((c) => c.id !== id);
      this.save();
    },
    categoryUsage(id) {
      return this.data.entries.filter((e) => e.categoryId === id).length;
    },

    /* ---- entries ---- */
    addEntry(payload) {
      const entry = this.buildEntry(payload);
      entry.id = uid('ent');
      entry.createdAt = new Date().toISOString();
      this.data.entries.push(entry);
      this.save();
      return entry;
    },
    updateEntry(id, payload) {
      const existing = this.data.entries.find((e) => e.id === id);
      if (!existing) throw new Error('Entry not found.');
      const entry = this.buildEntry(payload);
      Object.assign(existing, entry);
      this.save();
      return existing;
    },
    buildEntry(payload) {
      const type = payload.type === 'income' ? 'income' : 'expense';
      const amount = round2(num(payload.amount));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
      if (amount > MAX_AMOUNT) throw new Error('That amount is too large.');
      const date = isRealDate(payload.date) ? payload.date : todayISO();
      if (!this.account(payload.accountId)) throw new Error('Pick an account.');
      const category = this.category(payload.categoryId);
      if (!category || category.kind !== type) throw new Error('Pick a valid category.');
      return {
        type,
        amount,
        date,
        accountId: payload.accountId,
        categoryId: payload.categoryId,
        note: String(payload.note || '').trim().slice(0, 200),
        recurringId: payload.recurringId || null,
      };
    },
    deleteEntry(id) {
      this.data.entries = this.data.entries.filter((e) => e.id !== id);
      this.save();
    },

    /* ---- budgets ---- */
    budgetFor(month, categoryId) {
      return this.data.budgets.find((b) => b.month === month && b.categoryId === categoryId) || null;
    },
    setBudget(month, categoryId, limit) {
      const budget = this.budgetFor(month, categoryId);
      const value = round2(num(limit));
      if (!Number.isFinite(value) || value <= 0) throw new Error('Enter a budget limit greater than zero.');
      if (budget) {
        budget.limit = value;
      } else {
        this.data.budgets.push({ id: uid('bud'), month, categoryId, limit: value });
      }
      this.save();
    },
    deleteBudget(month, categoryId) {
      this.data.budgets = this.data.budgets.filter(
        (b) => !(b.month === month && b.categoryId === categoryId)
      );
      this.save();
    },
    budgetsOf(month) {
      return this.data.budgets.filter((b) => b.month === month);
    },
    copyBudgets(fromMonth, toMonth) {
      let copied = 0;
      for (const b of this.budgetsOf(fromMonth)) {
        if (this.budgetFor(toMonth, b.categoryId)) continue;
        this.data.budgets.push({
          id: uid('bud'),
          month: toMonth,
          categoryId: b.categoryId,
          limit: b.limit,
        });
        copied += 1;
      }
      if (copied) this.save();
      return copied;
    },

    /* ---- recurring ---- */
    addRule(payload) {
      const rule = this.buildRule(payload);
      rule.id = uid('rec');
      rule.createdAt = new Date().toISOString();
      rule.lastPosted = null;
      this.data.recurring.push(rule);
      this.save();
      return rule;
    },
    updateRule(id, payload) {
      const rule = this.rule(id);
      if (!rule) throw new Error('Recurring entry not found.');
      Object.assign(rule, this.buildRule(payload));
      this.save();
      return rule;
    },
    buildRule(payload) {
      const type = payload.type === 'income' ? 'income' : 'expense';
      const amount = round2(num(payload.amount));
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
      if (!this.account(payload.accountId)) throw new Error('Pick an account.');
      const category = this.category(payload.categoryId);
      if (!category || category.kind !== type) throw new Error('Pick a valid category.');
      return {
        type,
        amount,
        accountId: payload.accountId,
        categoryId: payload.categoryId,
        note: String(payload.note || '').trim().slice(0, 200),
        frequency: FREQUENCIES.some((f) => f[0] === payload.frequency) ? payload.frequency : 'monthly',
        startDate: isRealDate(payload.startDate) ? payload.startDate : todayISO(),
        active: payload.active !== false,
      };
    },
    deleteRule(id) {
      this.data.recurring = this.data.recurring.filter((r) => r.id !== id);
      this.save();
    },
    toggleRule(id) {
      const rule = this.rule(id);
      if (!rule) return;
      rule.active = !rule.active;
      this.save();
    },
    dueDatesOf(rule, upToISO) {
      const out = [];
      if (!rule.active) return out;
      const anchorDay = parseISO(rule.startDate).getDate();
      let cursor = rule.lastPosted
        ? addPeriod(rule.lastPosted, rule.frequency, anchorDay)
        : rule.startDate;
      let guard = 0;
      while (cursor <= upToISO && guard < 240) {
        out.push(cursor);
        cursor = addPeriod(cursor, rule.frequency, anchorDay);
        guard += 1;
      }
      return out;
    },
    nextDueOf(rule) {
      const today = todayISO();
      const due = this.dueDatesOf(rule, today);
      if (due.length) return due[0];
      const anchorDay = parseISO(rule.startDate).getDate();
      return rule.lastPosted
        ? addPeriod(rule.lastPosted, rule.frequency, anchorDay)
        : rule.startDate;
    },
    postRule(id, all) {
      const rule = this.rule(id);
      if (!rule) throw new Error('Recurring entry not found.');
      if (!rule.active) throw new Error('This recurring entry is paused.');
      const today = todayISO();
      const due = this.dueDatesOf(rule, today);
      if (!due.length) {
        throw new Error(`Not due yet — next is ${fmtDate(this.nextDueOf(rule))}.`);
      }
      const dates = all ? due : due.slice(0, 1);
      const accountBefore = this.accountBalance(rule.accountId);
      for (const date of dates) {
        this.addEntry({
          type: rule.type,
          amount: rule.amount,
          date,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          note: rule.note,
          recurringId: rule.id,
        });
      }
      rule.lastPosted = dates[dates.length - 1];
      this.save();
      return { count: dates.length, delta: round2(this.accountBalance(rule.accountId) - accountBefore) };
    },
    postAllDue() {
      let count = 0;
      const touched = new Set();
      for (const rule of [...this.data.recurring]) {
        if (!rule.active) continue;
        const due = this.dueDatesOf(rule, todayISO());
        if (!due.length) continue;
        for (const date of due) {
          this.addEntry({
            type: rule.type,
            amount: rule.amount,
            date,
            accountId: rule.accountId,
            categoryId: rule.categoryId,
            note: rule.note,
            recurringId: rule.id,
          });
          count += 1;
        }
        rule.lastPosted = due[due.length - 1];
        touched.add(rule.accountId);
      }
      if (count) this.save();
      return { count, accounts: touched.size };
    },

    /* ---- reporting ---- */
    entriesForMonth(month) {
      return this.data.entries.filter((e) => monthOf(e.date) === month);
    },
    monthTotals(month) {
      let income = 0;
      let expense = 0;
      let incomeCount = 0;
      let expenseCount = 0;
      for (const e of this.data.entries) {
        if (monthOf(e.date) !== month) continue;
        if (e.type === 'income') {
          income += e.amount;
          incomeCount += 1;
        } else {
          expense += e.amount;
          expenseCount += 1;
        }
      }
      return {
        month,
        income: round2(income),
        expense: round2(expense),
        net: round2(income - expense),
        incomeCount,
        expenseCount,
      };
    },
    spentInCategory(month, categoryId) {
      let total = 0;
      for (const e of this.data.entries) {
        if (e.type === 'expense' && e.categoryId === categoryId && monthOf(e.date) === month) {
          total += e.amount;
        }
      }
      return round2(total);
    },
    monthsWithData() {
      const set = new Set([nowMonth(), PF_STATE.month]);
      for (const e of this.data.entries) set.add(monthOf(e.date));
      for (const b of this.data.budgets) set.add(b.month);
      return [...set].filter(isRealMonth).sort().reverse();
    },
    // Wide chooser: two years back and six months ahead so future budgets
    // can be planned, plus every month that actually holds data.
    monthChoices() {
      const set = new Set();
      const today = nowMonth();
      for (let i = -24; i <= 6; i += 1) set.add(shiftMonth(today, i));
      for (const e of this.data.entries) set.add(monthOf(e.date));
      for (const b of this.data.budgets) set.add(b.month);
      set.add(PF_STATE.month);
      return [...set].filter(isRealMonth).sort().reverse();
    },

    /* ---- backup ---- */
    exportData() {
      return JSON.stringify(
        {
          app: 'al-shwareb-pf',
          module: 'personal-finance',
          version: PF_VERSION,
          exportedAt: new Date().toISOString(),
          data: this.data,
        },
        null,
        2
      );
    },
    prepareImport(raw) {
      let parsed;
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (err) {
        throw new Error('That file is not valid JSON.');
      }
      const data = parsed && parsed.data ? parsed.data : parsed;
      if ((parsed && parsed.app === 'al-shwareb-pf' && parsed.version !== PF_VERSION) ||
          (data && data.meta && Number(data.meta.version) > PF_VERSION)) {
        throw new Error('This Personal Finance backup version is not supported.');
      }
      if (
        !data ||
        !Array.isArray(data.accounts) ||
        !Array.isArray(data.entries) ||
        !Array.isArray(data.categories) ||
        ('budgets' in data && !Array.isArray(data.budgets)) ||
        ('recurring' in data && !Array.isArray(data.recurring)) ||
        (data.meta && (typeof data.meta !== 'object' || Array.isArray(data.meta))) ||
        ['accounts', 'categories', 'entries', 'budgets', 'recurring'].some((key) =>
          Array.isArray(data[key]) && data[key].some((item) => !item || typeof item !== 'object'))
      ) {
        throw new Error('This is not a Personal Finance backup file.');
      }
      // Reject broken records rather than silently dropping them during restore.
      const accountIds = new Set(data.accounts.map(a => String(a.id)));
      const categories = new Map(data.categories.map(c => [String(c.id), c]));
      const validAmount = amount => Number.isFinite(Number(amount)) && Number(amount) > 0;
      const linked = item => accountIds.has(String(item.accountId)) &&
        categories.get(String(item.categoryId))?.kind === item.type;
      const broken = data.accounts.some(a => !a.id || !a.name || !Number.isFinite(Number(a.opening || 0))) ||
        data.categories.some(c => !c.id || !c.name || !['income', 'expense'].includes(c.kind)) ||
        data.entries.some(e => !e.id || !['income', 'expense'].includes(e.type) || !validAmount(e.amount) || !isRealDate(e.date) || !linked(e)) ||
        (data.budgets || []).some(b => !isRealMonth(b.month) || !validAmount(b.limit) || categories.get(String(b.categoryId))?.kind !== 'expense') ||
        (data.recurring || []).some(r => !r.id || !['income', 'expense'].includes(r.type) || !validAmount(r.amount) ||
          !isRealDate(r.startDate) || !FREQUENCIES.some(f => f[0] === r.frequency) || !linked(r) ||
          (r.lastPosted != null && !isRealDate(r.lastPosted)));
      const duplicates = ['accounts', 'categories', 'entries', 'recurring'].some(key => {
        const rows = data[key] || [];
        return new Set(rows.map(row => String(row.id))).size !== rows.length;
      });
      if (broken || duplicates) throw new Error('The Personal Finance backup contains invalid records. No data was restored.');
      return normalizeData(data);
    },
    importData(raw) {
      const next = this.prepareImport(raw);
      localStorage.setItem(PF_KEY, JSON.stringify(next));
      this.data = next;
    },
    refreshAfterRestore() {
      // A historical backup must not open an empty current-month overview.
      const entryMonths = this.data.entries.map(e => e.date.slice(0, 7));
      const budgetMonths = this.data.budgets.map(b => b.month);
      const restoredMonths = (entryMonths.length ? entryMonths : budgetMonths).sort();
      PF_STATE.month = restoredMonths[restoredMonths.length - 1] || nowMonth();
      PF_STATE.filters = { month: 'all', type: 'all', accountId: 'all', categoryId: 'all', q: '' };
      PF_IMPORT.drafts = [];
      PF_IMPORT.parsedFrom = '';
      const box = $('#pf-import-text');
      if (box) box.value = '';
      resetEntryForm(true);
      resetAccountForm();
      resetRuleForm(true);
      renderImportDrafts();
      renderAll();
      closeSettings();
    },
    eraseAll() {
      this.data = normalizeData(defaultData());
      this.save();
    },
  };

  /* ---------------- local UI state ---------------- */

  const PF_STATE = {
    view: 'overview',
    month: nowMonth(),
    entryType: 'expense',
    entryId: null,
    entryDateTouched: false,
    accountId: null,
    ruleType: 'expense',
    ruleId: null,
    filters: {
      month: 'all',
      type: 'all',
      accountId: 'all',
      categoryId: 'all',
      q: '',
    },
  };

  const PF_IMPORT = { drafts: [], parsedFrom: null };

  /* ---------------- select helpers ---------------- */

  function setOptions(select, items, keepValue) {
    if (!select) return;
    const previous = keepValue === false ? null : select.value;
    select.innerHTML = items
      .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
      .join('');
    if (previous && [...select.options].some((o) => o.value === previous)) {
      select.value = previous;
    }
  }

  function accountOptions(includeAll) {
    const items = PF.data.accounts.map((a) => [a.id, a.name]);
    return includeAll ? [['all', 'All accounts'], ...items] : items;
  }
  function categoryOptions(kind, includeAll) {
    const items = PF.categoriesOf(kind).map((c) => [c.id, c.name]);
    return includeAll ? [['all', `All ${kind} categories`], ...items] : items;
  }
  function monthOptions(includeAll) {
    const items = PF.monthsWithData().map((m) => [m, fmtMonth(m)]);
    return includeAll ? [['all', 'All months'], ...items] : items;
  }

  /* ---------------- rendering: overview ---------------- */

  function renderOverview() {
    const month = PF_STATE.month;
    const totals = PF.monthTotals(month);
    const previous = PF.monthTotals(shiftMonth(month, -1));
    const spendDelta = totals.expense - previous.expense;
    const incomeDelta = totals.income - previous.income;

    const cards = [];
    cards.push(`
      <div class="card">
        <div class="label">Total balance</div>
        <div class="value">${escapeHtml(money(PF.totalBalance()))}</div>
        <div class="sub">${PF.data.accounts.length} ${PF.data.accounts.length === 1 ? 'account' : 'accounts'} · opening balances included</div>
      </div>`);
    cards.push(`
      <div class="card">
        <div class="label">Income · ${escapeHtml(fmtMonth(month))}</div>
        <div class="value pf-positive">${escapeHtml(money(totals.income))}</div>
        <div class="sub">${totals.incomeCount} ${totals.incomeCount === 1 ? 'entry' : 'entries'} ${deltaText(incomeDelta, 'vs last month')}</div>
      </div>`);
    cards.push(`
      <div class="card">
        <div class="label">Expenses · ${escapeHtml(fmtMonth(month))}</div>
        <div class="value pf-negative">${escapeHtml(money(totals.expense))}</div>
        <div class="sub">${totals.expenseCount} ${totals.expenseCount === 1 ? 'entry' : 'entries'} ${deltaText(spendDelta, 'vs last month', true)}</div>
      </div>`);
    const savingsRate =
      totals.income > 0 ? `${Math.round((totals.net / totals.income) * 100)}% of income kept` : 'No income recorded this month';
    cards.push(`
      <div class="card ${totals.net >= 0 ? 'profit' : 'negative'}">
        <div class="label">Net · ${escapeHtml(fmtMonth(month))}</div>
        <div class="value">${totals.net >= 0 ? '+' : '−'} ${escapeHtml(money(Math.abs(totals.net)))}</div>
        <div class="sub">${escapeHtml(savingsRate)}</div>
      </div>`);
    const cardsHost = $('#pf-cards');
    if (cardsHost) cardsHost.innerHTML = cards.join('');

    renderChart(month);
    renderAccountMini();
    renderBudgetMini(month);
    renderRecent();
  }

  function deltaText(delta, suffix, invert) {
    if (!delta) return '';
    const better = invert ? delta < 0 : delta > 0;
    const sign = delta > 0 ? '+' : '−';
    return `<span class="${better ? 'pf-up' : 'pf-down'}">${sign}${escapeHtml(money(Math.abs(delta)))} ${escapeHtml(suffix)}</span>`;
  }

  function renderChart(endMonth) {
    const host = $('#pf-chart');
    if (!host) return;
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const ym = shiftMonth(endMonth, -i);
      months.push(PF.monthTotals(ym));
    }
    const max = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 1);
    const hasAny = months.some((m) => m.income || m.expense);
    if (!hasAny) {
      host.innerHTML = `<div class="empty-state"><span class="big">No entries yet</span>Add your first income or expense in the Entries tab to see the trend.</div>`;
      return;
    }
    host.innerHTML = months
      .map((m) => {
        const incomeH = m.income ? Math.max((m.income / max) * 100, 2) : 0;
        const expenseH = m.expense ? Math.max((m.expense / max) * 100, 2) : 0;
        return `
          <div class="pf-chart-col">
            <div class="pf-chart-bars">
              <div class="pf-chart-bar income" style="height:${incomeH}%" title="Income ${escapeHtml(money(m.income))}"></div>
              <div class="pf-chart-bar expense" style="height:${expenseH}%" title="Expenses ${escapeHtml(money(m.expense))}"></div>
            </div>
            <span class="pf-chart-label">${escapeHtml(shortMonth(m.month))}</span>
            <span class="pf-chart-net ${m.net >= 0 ? 'pf-positive' : 'pf-negative'}">${m.net >= 0 ? '+' : '−'}${escapeHtml(shortMoney(Math.abs(m.net)))}</span>
          </div>`;
      })
      .join('');
  }

  function renderAccountMini() {
    const host = $('#pf-account-mini');
    if (!host) return;
    host.innerHTML = PF.data.accounts
      .map((a) => {
        const balance = PF.accountBalance(a.id);
        return `
          <div class="pf-line">
            <span class="pf-line-main">${escapeHtml(a.name)} <span class="pf-tag">${escapeHtml(accountTypeLabel(a.type))}</span></span>
            <span class="pf-line-amount ${balance < 0 ? 'pf-negative' : ''}">${escapeHtml(money(balance))}</span>
          </div>`;
      })
      .join('');
  }

  function renderBudgetMini(month) {
    const host = $('#pf-budget-mini');
    if (!host) return;
    const budgets = PF.budgetsOf(month)
      .map((b) => {
        const spent = PF.spentInCategory(month, b.categoryId);
        return { ...b, spent, pct: b.limit ? (spent / b.limit) * 100 : 0 };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
    if (!budgets.length) {
      host.innerHTML = `
        <div class="empty-state">
          <span class="big">No budgets for ${escapeHtml(fmtMonth(month))}</span>
          Set a monthly limit per category to track how much is left.
          <div class="pf-center-actions"><button type="button" class="btn btn-secondary btn-sm" data-pf-goto="budgets">Set budgets</button></div>
        </div>`;
      return;
    }
    host.innerHTML = budgets
      .map((b) => {
        const label = PF.categoryName(b.categoryId);
        const over = b.spent > b.limit;
        const left = round2(b.limit - b.spent);
        return `
          <div class="pf-budget-row">
            <div class="pf-budget-head">
              <span>${escapeHtml(label)}</span>
              <span class="pf-budget-nums">${escapeHtml(money(b.spent))} / ${escapeHtml(money(b.limit))}</span>
            </div>
            <div class="pf-bar"><span class="pf-bar-fill ${barClass(b.pct)}" style="width:${Math.min(b.pct, 100)}%"></span></div>
            <div class="pf-budget-foot ${over ? 'pf-negative' : ''}">${over ? `Over by ${escapeHtml(money(-left))}` : `${escapeHtml(money(left))} left`}</div>
          </div>`;
      })
      .join('');
  }

  function barClass(pct) {
    if (pct > 100) return 'over';
    if (pct >= 80) return 'warn';
    return 'ok';
  }

  function renderRecent() {
    const host = $('#pf-recent');
    if (!host) return;
    const recent = [...PF.data.entries]
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 5);
    if (!recent.length) {
      host.innerHTML = `<div class="empty-state"><span class="big">Nothing recorded yet</span>Every income and expense you add will show up here.</div>`;
      return;
    }
    host.innerHTML = recent.map(entryRowHtml).join('');
  }

  /* ---------------- rendering: entries ---------------- */

  function entryRowHtml(entry) {
    const isIncome = entry.type === 'income';
    const note = entry.note ? `<div class="pf-entry-note">${escapeHtml(entry.note)}</div>` : '';
    return `
      <div class="pf-entry">
        <span class="pf-dot ${isIncome ? 'income' : 'expense'}" aria-hidden="true">${isIncome ? '↑' : '↓'}</span>
        <div class="pf-entry-main">
          <div class="pf-entry-title">
            ${escapeHtml(PF.categoryName(entry.categoryId))}
            <span class="pf-tag">${escapeHtml(PF.accountName(entry.accountId))}</span>
            ${entry.recurringId ? '<span class="pf-tag pf-tag-recurring">Recurring</span>' : ''}
          </div>
          ${note}
        </div>
        <div class="pf-entry-right">
          <div class="pf-entry-amt ${isIncome ? 'income' : 'expense'}">${escapeHtml(signedMoney(entry.amount, entry.type))}</div>
          <div class="pf-entry-actions">
            <span class="pf-entry-date">${escapeHtml(fmtDate(entry.date))}</span>
            <button type="button" class="link-btn" data-pf-edit-entry="${escapeHtml(entry.id)}">Edit</button>
            <button type="button" class="link-btn danger" data-pf-del-entry="${escapeHtml(entry.id)}">Delete</button>
          </div>
        </div>
      </div>`;
  }

  function filteredEntries() {
    const f = PF_STATE.filters;
    const q = f.q.trim().toLowerCase();
    return PF.data.entries
      .filter((e) => {
        if (f.month !== 'all' && monthOf(e.date) !== f.month) return false;
        if (f.type !== 'all' && e.type !== f.type) return false;
        if (f.accountId !== 'all' && e.accountId !== f.accountId) return false;
        if (f.categoryId !== 'all' && e.categoryId !== f.categoryId) return false;
        if (q) {
          const hay = `${PF.categoryName(e.categoryId)} ${PF.accountName(e.accountId)} ${e.note || ''} ${e.amount} ${e.date}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function renderEntries() {
    const list = filteredEntries();
    const summaryHost = $('#pf-filter-summary');
    const listHost = $('#pf-entries-list');
    if (!listHost || !summaryHost) return;

    let income = 0;
    let expense = 0;
    for (const e of list) {
      if (e.type === 'income') income += e.amount;
      else expense += e.amount;
    }
    const net = round2(income - expense);
    summaryHost.innerHTML = `
      <span class="pf-summary-item">Income <strong class="pf-positive">${escapeHtml(money(income))}</strong></span>
      <span class="pf-summary-item">Expenses <strong class="pf-negative">${escapeHtml(money(expense))}</strong></span>
      <span class="pf-summary-item">Net <strong class="${net >= 0 ? 'pf-positive' : 'pf-negative'}">${net >= 0 ? '+' : '−'} ${escapeHtml(money(Math.abs(net)))}</strong></span>
      <span class="pf-summary-count">${list.length} ${list.length === 1 ? 'entry' : 'entries'}</span>`;

    if (!list.length) {
      const hasAny = PF.data.entries.length > 0;
      listHost.innerHTML = hasAny
        ? `<div class="empty-state"><span class="big">No matches</span>No entries match these filters.</div>`
        : `<div class="empty-state"><span class="big">No entries yet</span>Record your first income or expense with the form above.</div>`;
      return;
    }

    const groups = new Map();
    for (const e of list) {
      if (!groups.has(e.date)) groups.set(e.date, []);
      groups.get(e.date).push(e);
    }
    listHost.innerHTML = [...groups.entries()]
      .map(([date, entries]) => {
        const dayNet = round2(
          entries.reduce((sum, e) => sum + (e.type === 'income' ? e.amount : -e.amount), 0)
        );
        return `
          <div class="pf-day-head">
            <span>${escapeHtml(fmtDate(date))}</span>
            <span class="${dayNet >= 0 ? 'pf-positive' : 'pf-negative'}">${dayNet >= 0 ? '+' : '−'} ${escapeHtml(money(Math.abs(dayNet)))}</span>
          </div>
          ${entries.map(entryRowHtml).join('')}`;
      })
      .join('');
  }

  function renderEntryFormOptions() {
    const accountSel = $('#pf-entry-account');
    const categorySel = $('#pf-entry-category');
    if (!accountSel || !categorySel) return;
    setOptions(accountSel, accountOptions(false));
    setOptions(categorySel, categoryOptions(PF_STATE.entryType, false));
  }

  function updateEntryPreview() {
    const amount = num($('#pf-entry-amount') ? $('#pf-entry-amount').value : 0);
    const preview = $('#pf-entry-preview');
    if (!preview) return;
    const type = PF_STATE.entryType;
    if (!amount) {
      preview.textContent = '—';
      preview.className = '';
      return;
    }
    preview.textContent = signedMoney(amount, type);
    preview.className = type === 'income' ? 'pf-positive' : 'pf-negative';
  }

  function syncEntryForm() {
    const isEditing = !!PF_STATE.entryId;
    const title = $('#pf-entry-title');
    const submit = $('#pf-entry-submit');
    const cancel = $('#pf-entry-cancel');
    if (title) title.textContent = isEditing ? 'Edit entry' : 'Add income or expense';
    if (submit) {
      submit.textContent = isEditing
        ? 'Save changes'
        : PF_STATE.entryType === 'income'
          ? 'Add income'
          : 'Add expense';
    }
    if (cancel) cancel.hidden = !isEditing;
    $$('#pf-entry-form [data-pf-type]').forEach((btn) => {
      const on = btn.dataset.pfType === PF_STATE.entryType;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    updateEntryPreview();
  }

  function resetEntryForm(keepType) {
    PF_STATE.entryId = null;
    if (!keepType) PF_STATE.entryType = 'expense';
    const idField = $('#pf-entry-id');
    if (idField) idField.value = '';
    const amount = $('#pf-entry-amount');
    if (amount) amount.value = '';
    const date = $('#pf-entry-date');
    if (date) date.value = todayISO();
    const note = $('#pf-entry-note');
    if (note) note.value = '';
    renderEntryFormOptions();
    syncEntryForm();
  }

  function startEditEntry(id) {
    const entry = PF.data.entries.find((e) => e.id === id);
    if (!entry) return;
    PF_STATE.entryId = id;
    PF_STATE.entryType = entry.type;
    renderEntryFormOptions();
    $('#pf-entry-id').value = entry.id;
    $('#pf-entry-amount').value = entry.amount;
    $('#pf-entry-date').value = entry.date;
    $('#pf-entry-account').value = entry.accountId;
    $('#pf-entry-category').value = entry.categoryId;
    $('#pf-entry-note').value = entry.note || '';
    syncEntryForm();
    $('#pf-entry-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#pf-entry-amount').focus({ preventScroll: true });
  }

  /* ---------------- rendering: budgets ---------------- */

  function renderBudgets() {
    const month = PF_STATE.month;
    const label = $('#pf-budget-month-label');
    if (label) label.textContent = fmtMonth(month);
    const copyBtn = $('#pf-budget-copy');
    if (copyBtn) {
      const prev = shiftMonth(month, -1);
      copyBtn.hidden = !PF.budgetsOf(prev).length;
      copyBtn.dataset.pfCopyFrom = prev;
    }
    const categorySel = $('#pf-budget-category');
    if (categorySel) setOptions(categorySel, categoryOptions('expense', false));

    const budgets = PF.budgetsOf(month).map((b) => {
      const spent = PF.spentInCategory(month, b.categoryId);
      return { ...b, spent, pct: b.limit ? (spent / b.limit) * 100 : 0 };
    });

    const totalLimit = round2(budgets.reduce((s, b) => s + b.limit, 0));
    const totalSpent = round2(budgets.reduce((s, b) => s + b.spent, 0));
    const hosting = $('#pf-budget-cards');
    if (hosting) {
      const remaining = round2(totalLimit - totalSpent);
      hosting.innerHTML = `
        <div class="card">
          <div class="label">Budgeted · ${escapeHtml(fmtMonth(month))}</div>
          <div class="value">${escapeHtml(money(totalLimit))}</div>
          <div class="sub">${budgets.length} ${budgets.length === 1 ? 'category' : 'categories'}</div>
        </div>
        <div class="card">
          <div class="label">Spent in budgets</div>
          <div class="value ${totalLimit && totalSpent > totalLimit ? 'pf-negative' : ''}">${escapeHtml(money(totalSpent))}</div>
          <div class="sub">${totalLimit ? `${Math.round((totalSpent / totalLimit) * 100)}% of budget used` : 'No limits set'}</div>
        </div>
        <div class="card ${remaining < 0 ? 'negative' : 'profit'}">
          <div class="label">Remaining</div>
          <div class="value">${remaining < 0 ? '−' : ''}${escapeHtml(money(Math.abs(remaining)))}</div>
          <div class="sub">${remaining < 0 ? 'Over budget this month' : 'Still available this month'}</div>
        </div>`;
    }

    const host = $('#pf-budget-list');
    if (!host) return;
    if (!budgets.length) {
      host.innerHTML = `<div class="empty-state"><span class="big">No budgets for ${escapeHtml(fmtMonth(month))}</span>Pick a category and a monthly limit above to start tracking.</div>`;
      return;
    }
    host.innerHTML = budgets
      .sort((a, b) => b.pct - a.pct)
      .map((b) => {
        const over = b.spent > b.limit;
        const left = round2(b.limit - b.spent);
        return `
          <div class="pf-budget-row">
            <div class="pf-budget-head">
              <span>${escapeHtml(PF.categoryName(b.categoryId))}</span>
              <span class="pf-budget-nums">${escapeHtml(money(b.spent))} / ${escapeHtml(money(b.limit))}</span>
            </div>
            <div class="pf-bar"><span class="pf-bar-fill ${barClass(b.pct)}" style="width:${Math.min(b.pct, 100)}%"></span></div>
            <div class="pf-budget-foot">
              <span class="${over ? 'pf-negative' : ''}">${over ? `Over by ${escapeHtml(money(-left))}` : `${escapeHtml(money(left))} left`}</span>
              <span class="pf-budget-actions">
                <button type="button" class="link-btn" data-pf-edit-budget="${escapeHtml(b.categoryId)}">Edit</button>
                <button type="button" class="link-btn danger" data-pf-del-budget="${escapeHtml(b.categoryId)}" data-pf-budget-month="${escapeHtml(b.month)}">Remove</button>
              </span>
            </div>
          </div>`;
      })
      .join('');

    // Unbudgeted spending in this month
    const budgetedIds = new Set(budgets.map((b) => b.categoryId));
    const unbudgeted = round2(
      PF.entriesForMonth(month)
        .filter((e) => e.type === 'expense' && !budgetedIds.has(e.categoryId))
        .reduce((s, e) => s + e.amount, 0)
    );
    if (unbudgeted > 0) {
      host.insertAdjacentHTML(
        'beforeend',
        `<p class="hint">${escapeHtml(money(unbudgeted))} of spending this month is in categories without a budget.</p>`
      );
    }
  }

  /* ---------------- rendering: accounts ---------------- */

  function renderAccounts() {
    const host = $('#pf-account-list');
    if (host) {
      host.innerHTML = PF.data.accounts
        .map((a) => {
          const balance = PF.accountBalance(a.id);
          const count = PF.data.entries.filter((e) => e.accountId === a.id).length;
          return `
            <div class="pf-account-card">
              <div class="pf-account-main">
                <div class="pf-account-name">${escapeHtml(a.name)}</div>
                <div class="pf-account-meta">
                  <span class="pf-tag">${escapeHtml(accountTypeLabel(a.type))}</span>
                  <span>${count} ${count === 1 ? 'entry' : 'entries'}</span>
                  <span>opening ${escapeHtml(money(a.opening))}</span>
                </div>
              </div>
              <div class="pf-account-right">
                <div class="pf-account-balance ${balance < 0 ? 'pf-negative' : ''}">${escapeHtml(money(balance))}</div>
                <div class="row-actions">
                  <button type="button" class="link-btn" data-pf-edit-account="${escapeHtml(a.id)}">Edit</button>
                  <button type="button" class="link-btn danger" data-pf-del-account="${escapeHtml(a.id)}">Delete</button>
                </div>
              </div>
            </div>`;
        })
        .join('');
    }

    const catHost = $('#pf-category-list');
    if (!catHost) return;
    const groups = [
      ['expense', 'Expense categories'],
      ['income', 'Income categories'],
    ];
    catHost.innerHTML = groups
      .map(([kind, title]) => {
        const items = PF.categoriesOf(kind);
        return `
          <div class="pf-cat-group">
            <h3 class="pf-cat-title">${title}</h3>
            <div class="pf-chips">
              ${items
                .map((c) => {
                  const used = PF.categoryUsage(c.id);
                  return `
                    <span class="pf-chip ${kind}">
                      ${escapeHtml(c.name)}${used ? `<span class="pf-chip-count">${used}</span>` : ''}
                      <button type="button" class="pf-chip-x" data-pf-del-category="${escapeHtml(c.id)}" aria-label="Delete ${escapeHtml(c.name)}">&times;</button>
                    </span>`;
                })
                .join('')}
            </div>
          </div>`;
      })
      .join('');
  }

  function renderAccountFormOptions() {
    const typeSel = $('#pf-account-type');
    if (typeSel) setOptions(typeSel, ACCOUNT_TYPES);
  }

  function resetAccountForm() {
    PF_STATE.accountId = null;
    const title = $('#pf-account-title');
    if (title) title.textContent = 'Add account';
    const submit = $('#pf-account-submit');
    if (submit) submit.textContent = 'Add account';
    const cancel = $('#pf-account-cancel');
    if (cancel) cancel.hidden = true;
    ['#pf-account-name', '#pf-account-opening'].forEach((sel) => {
      const el = $(sel);
      if (el) el.value = '';
    });
    renderAccountFormOptions();
  }

  function startEditAccount(id) {
    const account = PF.account(id);
    if (!account) return;
    PF_STATE.accountId = id;
    $('#pf-account-title').textContent = 'Edit account';
    $('#pf-account-submit').textContent = 'Save changes';
    $('#pf-account-cancel').hidden = false;
    $('#pf-account-name').value = account.name;
    $('#pf-account-type').value = account.type;
    $('#pf-account-opening').value = account.opening;
    $('#pf-account-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#pf-account-name').focus({ preventScroll: true });
  }

  /* ---------------- rendering: recurring ---------------- */

  function renderRecurring() {
    const host = $('#pf-recurring-list');
    if (!host) return;
    const rules = [...PF.data.recurring].sort((a, b) => PF.nextDueOf(a).localeCompare(PF.nextDueOf(b)));
    const dueCount = rules.reduce(
      (n, r) => n + PF.dueDatesOf(r, todayISO()).length,
      0
    );
    const postBtn = $('#pf-post-due');
    if (postBtn) {
      postBtn.disabled = dueCount === 0;
      postBtn.textContent = dueCount ? `Post all due (${dueCount})` : 'Nothing due';
    }

    if (!rules.length) {
      host.innerHTML = `<div class="empty-state"><span class="big">No recurring entries</span>Add rent, a salary or a subscription once and PF will remind you when it is due.</div>`;
      return;
    }

    host.innerHTML = rules
      .map((rule) => {
        const due = PF.dueDatesOf(rule, todayISO());
        const next = PF.nextDueOf(rule);
        const overdueDays = daysBetween(next, todayISO());
        let statusClass = 'status-pending';
        let statusText = `Next ${fmtDate(next)}`;
        if (!rule.active) {
          statusClass = 'status-ended';
          statusText = 'Paused';
        } else if (due.length) {
          statusClass = 'status-overdue';
          statusText = due.length > 1 ? `${due.length} due` : 'Due now';
        } else if (next === todayISO()) {
          statusClass = 'status-due-today';
          statusText = 'Due today';
        }
        const isIncome = rule.type === 'income';
        return `
          <div class="pf-rule ${rule.active ? '' : 'paused'}">
            <div class="pf-rule-top">
              <div class="pf-entry-main">
                <div class="pf-entry-title">
                  ${escapeHtml(PF.categoryName(rule.categoryId))}
                  <span class="pf-tag">${escapeHtml(PF.accountName(rule.accountId))}</span>
                  <span class="pf-tag pf-tag-recurring">${escapeHtml(frequencyLabel(rule.frequency))}</span>
                </div>
                <div class="pf-entry-note">
                  ${rule.note ? `${escapeHtml(rule.note)} · ` : ''}started ${escapeHtml(fmtDate(rule.startDate))}
                  ${overdueDays > 0 && rule.active ? ` · ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} overdue` : ''}
                </div>
              </div>
              <div class="pf-entry-right">
                <div class="pf-entry-amt ${isIncome ? 'income' : 'expense'}">${escapeHtml(signedMoney(rule.amount, rule.type))}</div>
                <span class="status-pill ${statusClass}">${escapeHtml(statusText)}</span>
              </div>
            </div>
            <div class="pf-rule-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-pf-post-rule="${escapeHtml(rule.id)}" ${due.length ? '' : 'disabled'}>Post${due.length > 1 ? ` all ${due.length}` : ''}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-pf-toggle-rule="${escapeHtml(rule.id)}">${rule.active ? 'Pause' : 'Resume'}</button>
              <button type="button" class="link-btn" data-pf-edit-rule="${escapeHtml(rule.id)}">Edit</button>
              <button type="button" class="link-btn danger" data-pf-del-rule="${escapeHtml(rule.id)}">Delete</button>
            </div>
          </div>`;
      })
      .join('');
  }

  function renderRuleFormOptions() {
    const accountSel = $('#pf-rule-account');
    const categorySel = $('#pf-rule-category');
    if (accountSel) setOptions(accountSel, accountOptions(false));
    if (categorySel) setOptions(categorySel, categoryOptions(PF_STATE.ruleType, false));
    const freqSel = $('#pf-rule-frequency');
    if (freqSel) setOptions(freqSel, FREQUENCIES);
  }

  function syncRuleForm() {
    const isEditing = !!PF_STATE.ruleId;
    const title = $('#pf-rule-title');
    if (title) title.textContent = isEditing ? 'Edit recurring entry' : 'Add a recurring entry';
    const submit = $('#pf-rule-submit');
    if (submit) submit.textContent = isEditing ? 'Save changes' : 'Add recurring entry';
    const cancel = $('#pf-rule-cancel');
    if (cancel) cancel.hidden = !isEditing;
    $$('#pf-rule-form [data-pf-rule-type]').forEach((btn) => {
      const on = btn.dataset.pfRuleType === PF_STATE.ruleType;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function resetRuleForm(keepType) {
    PF_STATE.ruleId = null;
    if (!keepType) PF_STATE.ruleType = 'expense';
    ['#pf-rule-amount', '#pf-rule-note'].forEach((sel) => {
      const el = $(sel);
      if (el) el.value = '';
    });
    const start = $('#pf-rule-start');
    if (start) start.value = todayISO();
    // Populate the options first: setting a value on an empty select is a no-op.
    renderRuleFormOptions();
    const freq = $('#pf-rule-frequency');
    if (freq) freq.value = 'monthly';
    syncRuleForm();
  }

  function startEditRule(id) {
    const rule = PF.rule(id);
    if (!rule) return;
    PF_STATE.ruleId = id;
    PF_STATE.ruleType = rule.type;
    renderRuleFormOptions();
    $('#pf-rule-amount').value = rule.amount;
    $('#pf-rule-account').value = rule.accountId;
    $('#pf-rule-category').value = rule.categoryId;
    $('#pf-rule-frequency').value = rule.frequency;
    $('#pf-rule-start').value = rule.startDate;
    $('#pf-rule-note').value = rule.note || '';
    syncRuleForm();
    $('#pf-rule-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#pf-rule-amount').focus({ preventScroll: true });
  }

  /* ---------------- rendering: shell ---------------- */

  function renderMonthSelect() {
    const sel = $('#pf-month');
    if (!sel) return;
    setOptions(sel, PF.monthChoices().map((m) => [m, fmtMonth(m)]));
    sel.value = PF_STATE.month;
  }

  function renderFilterOptions() {
    const f = PF_STATE.filters;
    const monthSel = $('#pf-filter-month');
    const typeSel = $('#pf-filter-type');
    const accountSel = $('#pf-filter-account');
    const categorySel = $('#pf-filter-category');
    const search = $('#pf-filter-search');

    if (monthSel) {
      setOptions(monthSel, monthOptions(true));
      if (![...monthSel.options].some((o) => o.value === f.month)) f.month = 'all';
      monthSel.value = f.month;
    }
    if (typeSel) {
      setOptions(typeSel, [['all', 'All types'], ['income', 'Income'], ['expense', 'Expenses']], false);
      typeSel.value = f.type;
    }
    if (accountSel) {
      setOptions(accountSel, accountOptions(true));
      if (![...accountSel.options].some((o) => o.value === f.accountId)) f.accountId = 'all';
      accountSel.value = f.accountId;
    }
    if (categorySel) {
      const kind = f.type === 'all' ? null : f.type;
      const items = kind
        ? categoryOptions(kind, true)
        : [
            ['all', 'All categories'],
            ...PF.data.categories
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => [c.id, `${c.name} (${c.kind === 'income' ? 'in' : 'out'})`]),
          ];
      setOptions(categorySel, items);
      if (![...categorySel.options].some((o) => o.value === f.categoryId)) f.categoryId = 'all';
      categorySel.value = f.categoryId;
    }
    if (search && search.value !== f.q) search.value = f.q;
  }

  function setView(view) {
    PF_STATE.view = view;
    $$('.pf-subnav-btn').forEach((btn) => {
      const on = btn.dataset.pfView === view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.pf-view').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `pf-view-${view}`);
    });
    const monthField = $('#pf-month-field');
    if (monthField) {
      monthField.hidden = !(view === 'overview' || view === 'budgets');
    }
  }

  function renderAll() {
    renderMonthSelect();
    renderFilterOptions();
    renderOverview();
    renderEntryFormOptions();
    syncEntryForm();
    renderEntries();
    renderBudgets();
    renderAccounts();
    renderRecurring();
    $$('.pf-cur').forEach((el) => {
      el.textContent = PF.data.meta.currency || '';
    });
  }

  /* ---------------- settings modal ---------------- */

  function openSettings() {
    $('#pf-set-currency').value = PF.data.meta.currency || '';
    $('#modal-pf-settings').hidden = false;
  }
  function closeSettings() {
    $('#modal-pf-settings').hidden = true;
  }


  /* ------------------------------------------------------------
     Message parsing — InstaPay / Vodafone Cash / bank SMS
     Everything runs locally: the text a user pastes is parsed in
     memory and never leaves the device.
     ------------------------------------------------------------ */

  const AR_DIGIT_MAP = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };

  const MONTH_NAMES = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'أبريل': 4,
    'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'اغسطس': 8, 'أغسطس': 8,
    'سبتمبر': 9, 'اكتوبر': 10, 'أكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
  };

  const CURRENCY_RE = /(egp|e£|\ble\b|جنيه|ج\.م|\bجم\b|usd|\$|eur|aed|ريال)/i;

  const INCOME_PATTERNS = [
    /you\s+(?:have\s+)?received/i,
    /received\s+(?:from|egp|an\s+amount|money)/i,
    /\breceived\b/i,
    /credited/i,
    /deposited?/i,
    /incoming/i,
    /money\s+in\b/i,
    /تم\s+استلام/,
    /استلمت/,
    /تم\s+إضافة|تم\s+اضافه|أضيف|اضيف/,
    /\bوارد\b/,
    /ايداع|إيداع/,
  ];

  const EXPENSE_PATTERNS = [
    /you\s+(?:have\s+)?sent/i,
    /sent\s+(?:to|egp|an\s+amount|money)/i,
    /transferred?\s+to/i,
    /transfer\s+of\s+.*\s+to\s/i,
    /debited/i,
    /deducted/i,
    /paid/i,
    /payment/i,
    /withdrew|withdrawal/i,
    /purchase/i,
    /outgoing/i,
    /money\s+out\b/i,
    /تم\s+تحويل/,
    /تم\s+خصم|خصم/,
    /\bمدين\b/,
    /\bصادر\b/,
    /سحب/,
    /تم\s+الدفع|دفعت/,
  ];

  function normalizeMessageText(raw) {
    return String(raw || '')
      .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => AR_DIGIT_MAP[ch] || ch)
      .replace(/\u066B/g, '.')
      .replace(/\u066C|\u060C/g, ',')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u200E\u200F\u202A-\u202E\u200B-\u200D]/g, '')
      // Arabic / fullwidth punctuation used by the operators
      .replace(/[\u061B\uFF1B]/g, ';')
      .replace(/[\u060C\uFF0C]/g, ',')
      .replace(/\uFF1A/g, ':')
      .replace(/[\u061F\uFF1F]/g, '?');
  }

  const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;

  function stripUrls(text) {
    return String(text || '').replace(URL_RE, ' ');
  }

  function maskNoise(text) {
    let out = text;
    const patterns = [
      /\b20\d{2}-\d{1,2}-\d{1,2}\b/g,
      /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g,
      /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
      /\b\d{1,2}\s+[A-Za-z\u0600-\u06FF]{3,9}\.?,?\s+20\d{2}\b/g,
    ];
    for (const re of patterns) out = out.replace(re, (m) => ' '.repeat(m.length));
    return out;
  }

  function pad2n(n) {
    return String(n).padStart(2, '0');
  }

  function makeDate(y, m, d) {
    if (!y || !m || !d) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const iso = `${String(y).padStart(4, '0')}-${pad2n(m)}-${pad2n(d)}`;
    return isRealDate(iso) ? iso : null;
  }

  // Egypt writes dates day/month/year; ISO and "12 Oct 2026" are handled too.
  function findDate(text) {
    let m = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (m) {
      const iso = makeDate(+m[1], +m[2], +m[3]);
      if (iso) return iso;
    }
    m = text.match(/\b(\d{1,2})\s+([A-Za-z\u0600-\u06FF]{3,9})\.?,?\s+((?:20)?\d{2})\b/);
    if (m) {
      const key = m[2].toLowerCase().replace(/[.،,]/g, '');
      const month = MONTH_NAMES[key];
      if (month) {
        let year = +m[3];
        if (year < 100) year += 2000;
        const iso = makeDate(year, month, +m[1]);
        if (iso) return iso;
      }
    }
    m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+((?:20)?\d{2})\b/);
    if (m) {
      const month = MONTH_NAMES[m[1].toLowerCase()];
      if (month) {
        let year = +m[3];
        if (year < 100) year += 2000;
        const iso = makeDate(year, month, +m[2]);
        if (iso) return iso;
      }
    }
    m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
    if (m) return bestNumericDate(+m[1], +m[2], +m[3]);

    // Day and month only ("يوم 28-10") — banks assume the current year.
    m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})\b(?![:\d])/);
    if (m) {
      const year = new Date().getFullYear();
      const first = +m[1];
      const second = +m[2];
      const dmy = first > 12 ? makeDate(year, second, first) : makeDate(year, second, first);
      const mdy = makeDate(year, first, second);
      if (dmy && mdy) {
        // Prefer the reading that is not in the future.
        const limit = isoOf(new Date(Date.now() + 2 * 86400000));
        return dmy <= limit ? dmy : mdy;
      }
      return dmy || mdy;
    }
    return null;
  }

  // Egyptian operators mix day-first, month-first and year-first dates, and a
  // 2-digit year can land in any position (Vodafone sends "26-10-28" = 28 Oct 2026).
  // Build every plausible reading, then prefer dates that are not in the future.
  function yearFrom(value) {
    if (value >= 100) return value;
    return value >= 70 ? 1900 + value : 2000 + value;
  }

  function bestNumericDate(a, b, c) {
    const today = todayISO();
    const futureLimit = isoOf(new Date(Date.now() + 2 * 86400000));
    const orderRank = { dmy: 0, ymd: 1, mdy: 2 };
    const options = [];
    const add = (iso, order) => {
      if (iso && !options.some((o) => o.iso === iso)) options.push({ iso, order });
    };
    add(makeDate(yearFrom(c), b, a), 'dmy');
    add(makeDate(yearFrom(a), b, c), 'ymd');
    add(makeDate(yearFrom(c), a, b), 'mdy');
    if (!options.length) return null;
    options.sort((x, y) => {
      const fx = x.iso > futureLimit ? 1 : 0;
      const fy = y.iso > futureLimit ? 1 : 0;
      if (fx !== fy) return fx - fy;
      if (orderRank[x.order] !== orderRank[y.order]) return orderRank[x.order] - orderRank[y.order];
      return Math.abs(daysBetween(x.iso, today)) - Math.abs(daysBetween(y.iso, today));
    });
    return options[0].iso;
  }

  function detectSender(text) {
    if (/instapay|انستا\s*باي|إنستا\s*باي|انستا باي/i.test(text)) return 'InstaPay';
    if (/vodafone\s*cash|فودافون\s*كاش|vf\s*cash|vodafonecash/i.test(text)) return 'Vodafone Cash';
    if (/etisalat\s*cash|اتصالات\s*كاش/i.test(text)) return 'Etisalat Cash';
    if (/orange\s*cash|اورنج\s*كاش|أورنج\s*كاش/i.test(text)) return 'Orange Cash';
    if (/instapay|انستا/i.test(text)) return 'InstaPay';
    if (/atm|بطاقة|debit\s*card|credit\s*card|mobile\s*payment|fawry|كارت/i.test(text)) return 'Bank card';
    if (/تحويل\s+لحظي|instant\s+transfer/i.test(text)) return 'Bank transfer';
    if (/بنك|bank|مصرف|حسابكم|حسابك/i.test(text)) return 'Bank';
    return 'Message';
  }

  function detectType(text) {
    let income = 0;
    let expense = 0;
    for (const re of INCOME_PATTERNS) if (re.test(text)) income += 1;
    for (const re of EXPENSE_PATTERNS) if (re.test(text)) expense += 1;
    if (income > expense) return { type: 'income', confidence: income - expense > 1 ? 'high' : 'medium' };
    if (expense > income) return { type: 'expense', confidence: expense - income > 1 ? 'high' : 'medium' };
    // Tie: fall back to direction words, then assume an expense (most common).
    if (/\bto\b|إلى|الى|لـ/i.test(text) && !/\bfrom\b|\bمن\b/i.test(text)) {
      return { type: 'expense', confidence: 'low' };
    }
    if (/\bfrom\b|\bمن\b/i.test(text)) return { type: 'income', confidence: 'low' };
    return { type: 'expense', confidence: 'low' };
  }

  function numberCandidates(text) {
    const masked = maskNoise(text);
    const re = /\d[\d,]*(?:\.\d{1,2})?/g;
    const out = [];
    let m;
    while ((m = re.exec(masked)) !== null) {
      const value = parseFloat(m[0].replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      out.push({ value, raw: m[0], index: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  function scoreCandidate(cand, text) {
    const before = text.slice(Math.max(0, cand.index - 30), cand.index);
    const after = text.slice(cand.end, cand.end + 14);
    let score = 0;

    if (CURRENCY_RE.test(after)) score += 6;
    if (/(egp|e£|\ble\b|جنيه|ج\.م|usd|\$|eur|aed|ريال)\s*$/i.test(before)) score += 6;
    if (/(amount|مبلغ|value|قيمة|قيمه|sent|received|transfer|تحويل|استلام|أرسل|ارسل)/i.test(before)) score += 3;
    if (/(fee|fees|commission|charges|رسوم|عمولة|مصاريف)/i.test(before)) score -= 12;
    if (/(balance|رصيد|available|متاح|المتاح|الرصيد)/i.test(before)) score -= 12;
    // "رقم 6758" (card) / "رقم 0150" (account) — identifiers, never amounts.
    if (/(?:رقم|number|no\.?)\s*$/i.test(before)) score -= 10;
    if (/(ref|reference|رقم\s+العملية|رقم\s+العمليه|trx|transaction\s*id|\bid\b)/i.test(before)) score -= 10;
    if (/^0\d{7,}$/.test(cand.raw)) score -= 16; // phone number
    if (/^\d{9,}$/.test(cand.raw)) score -= 8; // long reference
    if (!cand.raw.includes('.') && cand.value >= 1900 && cand.value <= 2100) score -= 8; // year
    if (cand.value <= 0) score -= 20;
    return score;
  }

  function pickAmount(text) {
    const cands = numberCandidates(text);
    let best = null;
    for (const cand of cands) {
      const score = scoreCandidate(cand, text);
      if (!best || score > best.score) best = { ...cand, score };
    }
    return best;
  }

  function findFee(text, amountCand) {
    const before = /(fee|fees|commission|charges|رسوم|عمولة|مصاريف)/i;
    const cands = numberCandidates(text).filter((c) => c.index !== (amountCand && amountCand.index));
    const hit = cands.find((c) => before.test(text.slice(Math.max(0, c.index - 26), c.index)));
    return hit ? round2(hit.value) : 0;
  }

  function findReference(text) {
    // Keep leading letters (InstaPay refs look like IP3847291045).
    let m = text.match(
      /(?:ref(?:erence)?|trx|transaction\s*(?:id|no|number)?|رقم\s+العملية|رقم\s+العمليه|رقم\s+مرجعي|رقم\s+المرجع|المرجع|مرجعي)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i
    );
    if (m) return m[1];
    // Bare long number, but never a phone number (they start with 0).
    m = text.match(/\b([1-9]\d{9,})\b/);
    return m ? m[1] : '';
  }

  const NAME_STOP =
    /(via|successfully|successful|\bwas\b|\bhas\b|\bhave\b|\bon\b|\bat\b|\bdate\b|\bref\b|\bbalance\b|عبر|بنجاح|باتصال|الساعة|بتاريخ|تاريخ|رقم|برقم|على|في|فى|المسجل|رصيد|رسوم|عمولة|مصاريف|خدمة|خدمه)/i;

  const INSTRUMENT_RE = /^(?:بطاقة|كارت|حساب|حسابك|حسابكم|محفظة|محفظتك|رصيد|card|account|wallet|debit|credit)/i;

  function cleanCounterparty(raw) {
    let name = String(raw || '').split(NAME_STOP)[0];
    const punct = name.search(/[.،,;:!?]/);
    if (punct > 1) name = name.slice(0, punct);
    // "من X إلى Y" / "from X to Y" → the second party is the interesting one.
    const parts = name.split(/\s+(?:إلى|الى|to)\s+/i);
    name = parts[parts.length - 1];
    name = name.replace(/^(?:محفظتك|محفظتي|حسابك|حسابي|your\s+wallet|your\s+account)\s*/i, '');
    name = name.replace(/^[^\p{L}\p{N}+*]+|[^\p{L}\p{N}+*]+$/gu, '').replace(/\s+/g, ' ').trim();
    // "من بطاقة الخصم المباشر" describes the payment method, not a person.
    if (INSTRUMENT_RE.test(name)) return '';
    // Banks mask half the name: "مهاب م*** ***" → "مهاب م***".
    name = name.replace(/\*+(?:\s*\*+)*/g, '***').trim();
    const digits = name.replace(/[\s-]/g, '');
    if (/^0\d{7,}$/.test(digits)) return `phone ${digits}`;
    if (!/[A-Za-z\u0621-\u064A]/.test(name)) return '';
    return name.slice(0, 40);
  }

  const MERCHANT_STOP =
    /(\s+(?:يوم|الساعة|بتاريخ|المتاح|الرصيد|للمزيد|اتصل|إتصل|باستخدام|طريقة)|\s+\d{1,2}[\/\-.]\d|\s+(?:on|at|date|available|balance|for\s+more)\b)/i;

  // Card purchases name the shop, not a person: "Payment عند CROWD POR".
  function findMerchant(text) {
    const patterns = [
      /(?:^|\s)عند\s*:?\s*([A-Za-z\u0621-\u064A0-9][A-Za-z\u0621-\u064A0-9 &*._'’-]{1,40})/i,
      /\bat\s*:?\s*([A-Za-z\u0621-\u064A0-9][A-Za-z\u0621-\u064A0-9 &*._'’-]{1,40})/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      let name = m[1].split(MERCHANT_STOP)[0];
      name = name.replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}&*'’._ -]+$/u, '').trim();
      // Acquirers prefix the shop: "FAWRY*SPOT IN CAFE" -> "SPOT IN CAFE".
      const acquirer = name.match(/^(Fawry)\s*\*\s*(.+)$/i);
      if (acquirer && acquirer[2].trim().length >= 2) name = acquirer[2].trim();
      if (!/[A-Za-z\u0621-\u064A]/.test(name)) continue;
      return name.slice(0, 40);
    }
    return '';
  }

  // Recognise the processor prefix confirmed in the cafe receipt.
  function findAcquirer(text) {
    const m = text.match(/\b(Fawry)\s*\*/i);
    if (!m) return '';
    const name = m[1];
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  // Wallet/contactless payments show up as "Mobile Payment" in the SMS.
  function isMobilePayment(text) {
    return /(mobile\s*payment|apple\s*pay|google\s*pay|samsung\s*pay|contactless|باستخدام\s+mobile|دفع\s+موبايل)/i.test(
      text
    );
  }

  function findCounterparty(text) {
    // Prefer the recipient/destination, then the sender.
    const patterns = [
      // "المسجل بإسم YOSSEF ..." / "registered as ..." — the clearest source of a name
      /(?:بإسم|باسم|بالإسم|بالاسم|registered\s+(?:as|in\s+the\s+name\s+of)|under\s+the\s+name\s+of)\s*:?\s*([A-Za-z\u0621-\u064A0-9][A-Za-z\u0621-\u064A0-9 ._'’*|-]{1,44})/i,
      /(?:لرقم|ل\s*رقم|إلى\s*رقم|الى\s*رقم|برقم)\s*:?\s*([A-Za-z\u0621-\u064A0-9][A-Za-z\u0621-\u064A0-9 ._'’*|-]{1,44})/i,
      /(?:\bto\s*(?:number|no\.?)?)\s*:?\s*([A-Za-z\u0621-\u064A0-9][A-Za-z\u0621-\u064A0-9 ._'’*|-]{1,44})/i,
      /(?:\bto\b|إلى|الى)\s*:?\s*([A-Za-z\u0621-\u064A0-9][A-Za-z\u0621-\u064A0-9 ._'’*|-]{1,44})/i,
      /(?:\bfrom\b|من)\s*:?\s*([A-Za-z\u0621-\u064A0-9][A-Za-z\u0621-\u064A0-9 ._'’*|-]{1,44})/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      const name = m ? cleanCounterparty(m[1]) : '';
      if (name) return name;
    }
    return findMerchant(text);
  }

  function suggestCategoryId(text, type, merchant) {
    const cats = PF.categoriesOf(type);
    if (!cats.length) return null;
    const hay = text.toLowerCase();
    const hit = cats.find((c) => {
      const name = c.name.toLowerCase();
      if (name.length >= 3 && hay.includes(name)) return true;
      return name.split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 4 && hay.includes(w));
    });
    if (hit) return hit.id;
    // Cafe receipts suggest food/drinks, but never create or force a category.
    if (type === 'expense' && /\b(caf[eé]|coffee)\b|كافيه|كافي|قهوة/i.test(merchant || '')) {
      const food = cats.find((c) => /food|drink|طعام|أكل|اكل|مطاعم/i.test(c.name));
      if (food) return food.id;
    }
    const generic = cats.find((c) => /^(other|misc|un ?categor|أخرى|اخرى|متنوع|غير\s+مصنف)/i.test(c.name));
    return (generic || cats[0]).id;
  }

  function suggestAccountId(text) {
    // Only the message body counts: advert links such as "vfcash" must not
    // make an account called "Cash" look like a match.
    const hay = stripUrls(text).toLowerCase();
    const byName = PF.data.accounts
      .filter((a) => a.name.trim().length >= 3 && hay.includes(a.name.trim().toLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (byName) return byName.id;
    if (/بطاقة|كارت|atm|card|تحويل\s+لحظي|instant\s+transfer|حسابكم|حسابك/.test(hay)) {
      const named = PF.data.accounts.find((a) => /bank|بنك|card|بطاقة/i.test(a.name));
      if (named) return named.id;
      const byType = PF.data.accounts.find((a) => a.type === 'bank');
      if (byType) return byType.id;
    }
    if (/vodafone|فودافون|محفظتك|محفظة|wallet/.test(hay)) {
      const named = PF.data.accounts.find((a) => /vodafone|فودافون|wallet|محفظة/i.test(a.name));
      if (named) return named.id;
      const byType = PF.data.accounts.find((a) => a.type === 'wallet');
      if (byType) return byType.id;
    }
    if (/instapay|انستا/.test(hay)) {
      const named = PF.data.accounts.find((a) => /bank|insta|بنك/i.test(a.name));
      if (named) return named.id;
      const byType = PF.data.accounts.find((a) => a.type === 'bank');
      if (byType) return byType.id;
    }
    return PF.data.accounts[0].id;
  }

  function parseMessage(raw) {
    const text = normalizeMessageText(raw).replace(/[ \t]+/g, ' ').trim();
    const draft = {
      id: uid('imp'),
      raw: String(raw || '').trim(),
      sender: detectSender(text),
      type: 'expense',
      amount: 0,
      date: todayISO(),
      fee: 0,
      ref: '',
      counterparty: '',
      accountId: null,
      categoryId: null,
      note: '',
      confidence: 'low',
      isAtm: false,
      acquirer: '',
      mobilePay: false,
      error: '',
    };
    if (!text) {
      draft.error = 'Nothing pasted yet.';
      return draft;
    }

    // Advert links carry words like "transfer" and "cash"; never let them
    // influence direction, amount or reference detection.
    // Keep line breaks: operator SMS separates the name, wallet number and
    // reference onto their own lines, and fields must not bleed into each other.
    const analysis = stripUrls(text).replace(/[ \t]+/g, ' ').trim();
    const amountCand = pickAmount(analysis);
    if (!amountCand || amountCand.value <= 0) {
      draft.error = 'Could not find an amount in this message.';
      return draft;
    }
    const direction = detectType(analysis);
    draft.type = direction.type;
    draft.confidence = direction.confidence;
    draft.amount = round2(amountCand.value);
    draft.date = findDate(analysis) || todayISO();
    draft.fee = findFee(analysis, amountCand);
    draft.ref = findReference(analysis);
    draft.counterparty = findCounterparty(analysis);
    draft.isAtm = /(atm|صراف|ماكينة|withdrawal|سحب\s+نقدي)/i.test(analysis);
    draft.acquirer = findAcquirer(analysis);
    draft.mobilePay = isMobilePayment(analysis);
    draft.accountId = suggestAccountId(analysis);
    draft.categoryId = suggestCategoryId(analysis, draft.type, draft.counterparty);

    const bits = [];
    if (draft.sender && draft.sender !== 'Message') bits.push(draft.sender);
    if (draft.counterparty) bits.push(draft.counterparty);
    if (draft.mobilePay) bits.push('Mobile payment');
    if (draft.acquirer) bits.push(`via ${draft.acquirer}`);
    if (draft.ref) bits.push(`Ref ${draft.ref}`);
    draft.note = (bits.length ? bits.join(' · ') : text.replace(/\s+/g, ' ').slice(0, 90)).slice(0, 200);
    return draft;
  }

  // A block can stand on its own when it carries a real amount plus a
  // direction word. Operator SMS often put the date, reference and an advert
  // in their own paragraphs — those must stay attached to the message above.
  function looksLikeFullMessage(block) {
    const text = stripUrls(normalizeMessageText(block));
    if (text.length < 12) return false;
    const amount = pickAmount(text);
    if (!amount || amount.value <= 0) return false;
    const signal = scoreCandidate(amount, text);
    const direction =
      /(received|sent|transfer|credited|debited|paid|withdraw|deposited|تم|استلام|تحويل|خصم|ايداع|إيداع|دفع|سحب|وارد|صادر)/i.test(
        text
      );
    if (signal > 0) return true;
    return signal === 0 && direction;
  }

  function splitMessages(text) {
    const raw = normalizeMessageText(text).trim();
    if (!raw) return [];

    // One message per line (e.g. copied out of a notes app).
    const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every(looksLikeFullMessage)) return lines;

    const rough = raw.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    if (rough.length <= 1) return rough;

    const blocks = [];
    let prefix = '';
    for (const block of rough) {
      if (looksLikeFullMessage(block)) {
        blocks.push(prefix ? `${prefix}\n${block}` : block);
        prefix = '';
      } else if (blocks.length) {
        blocks[blocks.length - 1] += `\n${block}`;
      } else {
        prefix = prefix ? `${prefix}\n${block}` : block;
      }
    }
    if (prefix) {
      if (blocks.length) blocks[blocks.length - 1] += `\n${prefix}`;
      else blocks.push(prefix);
    }
    return blocks;
  }

  function renderImportDrafts() {
    const host = $('#pf-import-results');
    const summary = $('#pf-import-summary');
    if (!host) return;
    const drafts = PF_IMPORT.drafts;

    if (summary) {
      if (!drafts.length) {
        summary.hidden = true;
      } else {
        const ready = drafts.filter((d) => !d.error).length;
        summary.hidden = false;
        summary.innerHTML = `
          <span>${ready} of ${drafts.length} message${drafts.length === 1 ? '' : 's'} understood</span>
          ${drafts.length > 1 ? '<button type="button" class="btn btn-primary btn-sm" id="pf-import-add-all">Add all</button>' : ''}`;
      }
    }

    if (!drafts.length) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = drafts
      .map((d, i) => {
        if (d.error) {
          return `
            <div class="pf-import-card error">
              <div class="pf-import-card-head">
                <strong>Could not read this message</strong>
                <button type="button" class="link-btn danger" data-pf-import-drop="${i}">Dismiss</button>
              </div>
              <p class="hint">${escapeHtml(d.error)} You can still <button type="button" class="link-btn" data-pf-import-manual="${i}">fill the form manually</button>.</p>
              <pre class="pf-import-raw">${escapeHtml(d.raw.slice(0, 400))}</pre>
            </div>`;
        }
        const isIncome = d.type === 'income';
        const cats = PF.categoriesOf(d.type);
        if (cats.length && !cats.some((c) => c.id === d.categoryId)) d.categoryId = cats[0].id;
        if (!PF.data.accounts.some((a) => a.id === d.accountId)) d.accountId = PF.data.accounts[0].id;
        // A select must always point at a real option.
        const catId = cats.some((c) => c.id === d.categoryId) ? d.categoryId : (cats[0] || {}).id;
        const accId = PF.data.accounts.some((a) => a.id === d.accountId)
          ? d.accountId
          : (PF.data.accounts[0] || {}).id;
        const conf =
          d.confidence === 'low'
            ? '<span class="pf-conf low">Direction guessed — please check</span>'
            : '';
        return `
          <div class="pf-import-card ${isIncome ? 'income' : 'expense'}">
            <div class="pf-import-card-head">
              <div class="pf-import-headline">
                <span class="pf-dot ${isIncome ? 'income' : 'expense'}" aria-hidden="true">${isIncome ? '↑' : '↓'}</span>
                <strong>${escapeHtml(d.sender)}</strong>
                <span class="pf-tag">${isIncome ? 'Income' : 'Expense'}</span>
                ${conf}
              </div>
              <button type="button" class="link-btn danger" data-pf-import-drop="${i}">Dismiss</button>
            </div>
            <div class="pf-import-grid">
              <div class="field">
                <label for="pf-imp-amount-${i}">Amount</label>
                <input type="number" id="pf-imp-amount-${i}" class="input" step="0.01" min="0.01" value="${d.amount}" data-pf-import-field="amount" data-index="${i}" />
              </div>
              <div class="field">
                <label for="pf-imp-date-${i}">Date</label>
                <input type="date" id="pf-imp-date-${i}" class="input" value="${d.date}" data-pf-import-field="date" data-index="${i}" />
              </div>
              <div class="field">
                <label for="pf-imp-account-${i}">Account</label>
                <select id="pf-imp-account-${i}" class="select" data-pf-import-field="accountId" data-index="${i}">
                  ${PF.data.accounts
                    .map(
                      (a) =>
                        `<option value="${escapeHtml(a.id)}"${a.id === accId ? ' selected' : ''}>${escapeHtml(a.name)}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="field">
                <label for="pf-imp-category-${i}">Category</label>
                <select id="pf-imp-category-${i}" class="select" data-pf-import-field="categoryId" data-index="${i}">
                  ${cats
                    .map(
                      (c) =>
                        `<option value="${escapeHtml(c.id)}"${c.id === catId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div class="field field-full">
                <label for="pf-imp-note-${i}">Note</label>
                <input type="text" id="pf-imp-note-${i}" class="input" maxlength="200" value="${escapeHtml(d.note)}" data-pf-import-field="note" data-index="${i}" />
              </div>
            </div>
            ${
              d.isAtm
                ? '<p class="pf-import-hintline">ATM cash withdrawal — if you track cash separately, also add an income entry to your Cash account.</p>'
                : ''
            }
            <div class="pf-import-foot">
              <span class="pf-import-meta">
                ${[
                  d.ref ? `Ref ${escapeHtml(d.ref)}` : '',
                  d.fee ? `fee ${escapeHtml(money(d.fee))} — charge it separately if your provider did` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <button type="button" class="btn btn-primary btn-sm" data-pf-import-add="${i}">
                ${isIncome ? 'Add income' : 'Add expense'} ${escapeHtml(money(d.amount))}
              </button>
            </div>
            <details class="pf-import-source">
              <summary>Show original message</summary>
              <pre class="pf-import-raw">${escapeHtml(d.raw.slice(0, 600))}</pre>
            </details>
          </div>`;
      })
      .join('');
  }

  function refreshImportFromTextarea() {
    const box = $('#pf-import-text');
    if (!box) return;
    const blocks = splitMessages(box.value);
    // Re-parse only when the text changed, so manual edits in drafts survive.
    if (blocks.join('\n\n') === PF_IMPORT.parsedFrom) return;
    PF_IMPORT.parsedFrom = blocks.join('\n\n');
    PF_IMPORT.drafts = blocks.map(parseMessage);
    renderImportDrafts();
  }

  // Once every card has been added or dismissed, empty the box so the same
  // message cannot sit there refusing to re-parse.
  function consumeImportTextIfDone() {
    if (PF_IMPORT.drafts.length) return;
    const box = $('#pf-import-text');
    if (box) box.value = '';
    PF_IMPORT.parsedFrom = '';
  }

  function addImportDraft(index) {
    const draft = PF_IMPORT.drafts[index];
    if (!draft || draft.error) return false;
    try {
      const created = PF.addEntry({
        type: draft.type,
        amount: draft.amount,
        date: draft.date,
        accountId: draft.accountId,
        categoryId: draft.categoryId,
        note: draft.note,
      });
      PF_IMPORT.drafts.splice(index, 1);
      consumeImportTextIfDone();
      renderImportDrafts();
      renderAll();
      toast(
        `Imported ${created.type === 'income' ? 'income' : 'expense'} of ${money(created.amount)}.`
      );
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }

  function bindImportEvents() {
    const panel = $('#pf-import');
    if (!panel) return;

    const box = $('#pf-import-text');
    if (box) {
      let timer = null;
      box.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(refreshImportFromTextarea, 220);
      });
      box.addEventListener('paste', () => {
        clearTimeout(timer);
        timer = setTimeout(refreshImportFromTextarea, 40);
      });
      box.addEventListener('blur', refreshImportFromTextarea);
    }

    const clip = $('#pf-import-clipboard');
    if (clip) {
      clip.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
              const box2 = $('#pf-import-text');
              box2.value = text;
              PF_IMPORT.parsedFrom = null;
              refreshImportFromTextarea();
              toast('Message pasted.');
              return;
            }
          }
          throw new Error('clipboard unavailable');
        } catch (err) {
          const box2 = $('#pf-import-text');
          if (box2) box2.focus();
          toast('Long-press the message and choose Copy, then paste it here.', true);
        }
      });
    }

    const clear = $('#pf-import-clear');
    if (clear) {
      clear.addEventListener('click', () => {
        const box2 = $('#pf-import-text');
        if (box2) box2.value = '';
        PF_IMPORT.parsedFrom = '';
        PF_IMPORT.drafts = [];
        renderImportDrafts();
      });
    }

    panel.addEventListener('input', (e) => {
      const field = e.target.dataset && e.target.dataset.pfImportField;
      if (!field) return;
      const index = Number(e.target.dataset.index);
      const draft = PF_IMPORT.drafts[index];
      if (!draft) return;
      if (field === 'amount') draft.amount = round2(num(e.target.value));
      else if (field === 'date') draft.date = isRealDate(e.target.value) ? e.target.value : draft.date;
      else if (field === 'accountId') draft.accountId = e.target.value;
      else if (field === 'categoryId') draft.categoryId = e.target.value;
      else if (field === 'note') draft.note = e.target.value.slice(0, 200);
    });

    panel.addEventListener('change', (e) => {
      const field = e.target.dataset && e.target.dataset.pfImportField;
      if (!field) return;
      const draft = PF_IMPORT.drafts[Number(e.target.dataset.index)];
      if (!draft) return;
      if (field === 'categoryId') {
        // Keep the visible button in step with the chosen category's type.
        const cat = PF.category(draft.categoryId);
        if (cat) draft.type = cat.kind;
        renderImportDrafts();
      }
      if (field === 'accountId') draft.accountId = e.target.value;
    });

    panel.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-pf-import-add]');
      if (addBtn) {
        addImportDraft(Number(addBtn.dataset.pfImportAdd));
        return;
      }
      const dropBtn = e.target.closest('[data-pf-import-drop]');
      if (dropBtn) {
        PF_IMPORT.drafts.splice(Number(dropBtn.dataset.pfImportDrop), 1);
        consumeImportTextIfDone();
        renderImportDrafts();
        return;
      }
      const manualBtn = e.target.closest('[data-pf-import-manual]');
      if (manualBtn) {
        const draft = PF_IMPORT.drafts[Number(manualBtn.dataset.pfImportManual)];
        if (draft) {
          PF_STATE.entryType = 'expense';
          $('#pf-entry-amount').focus();
          const noteField = $('#pf-entry-note');
          if (noteField) noteField.value = draft.raw.replace(/\s+/g, ' ').slice(0, 200);
          toast('Paste details into the form below.');
        }
        return;
      }
      const addAll = e.target.closest('#pf-import-add-all');
      if (addAll) {
        let added = 0;
        // Work from the end so splice indexes stay valid.
        for (let i = PF_IMPORT.drafts.length - 1; i >= 0; i -= 1) {
          if (!PF_IMPORT.drafts[i].error && addImportDraft(i)) added += 1;
        }
        if (added) toast(`Imported ${added} ${added === 1 ? 'entry' : 'entries'} from messages.`);
        consumeImportTextIfDone();
        renderImportDrafts();
      }
    });
  }

  /* ---------------- events ---------------- */

  function bindEntryEvents() {
    $$('#pf-entry-form [data-pf-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        PF_STATE.entryType = btn.dataset.pfType;
        renderEntryFormOptions();
        const catSel = $('#pf-entry-category');
        if (catSel) catSel.value = PF.categoriesOf(PF_STATE.entryType)[0].id;
        syncEntryForm();
      });
    });

    const amount = $('#pf-entry-amount');
    if (amount) amount.addEventListener('input', updateEntryPreview);

    const form = $('#pf-entry-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const payload = {
          type: PF_STATE.entryType,
          amount: $('#pf-entry-amount').value,
          date: $('#pf-entry-date').value,
          accountId: $('#pf-entry-account').value,
          categoryId: $('#pf-entry-category').value,
          note: $('#pf-entry-note').value,
        };
        try {
          let message;
          if (PF_STATE.entryId) {
            const updated = PF.updateEntry(PF_STATE.entryId, payload);
            const balance = PF.accountBalance(updated.accountId);
            message = `Entry updated — ${PF.accountName(updated.accountId)} balance ${money(balance)}.`;
          } else {
            const created = PF.addEntry(payload);
            const balance = PF.accountBalance(created.accountId);
            message = `${created.type === 'income' ? 'Income' : 'Expense'} recorded — ${PF.accountName(created.accountId)} balance ${money(balance)}.`;
          }
          PF_STATE.entryDateTouched = false;
          const keepType = PF_STATE.entryType;
          resetEntryForm(true);
          PF_STATE.entryType = keepType;
          renderAll();
          const dateField = $('#pf-entry-date');
          if (dateField) dateField.value = todayISO();
          $('#pf-entry-amount').focus({ preventScroll: true });
          toast(message);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }

    const cancel = $('#pf-entry-cancel');
    if (cancel) {
      cancel.addEventListener('click', () => {
        resetEntryForm(true);
        $('#pf-entry-date').value = todayISO();
      });
    }
  }

  function bindFilterEvents() {
    const map = [
      ['#pf-filter-month', 'month'],
      ['#pf-filter-type', 'type'],
      ['#pf-filter-account', 'accountId'],
      ['#pf-filter-category', 'categoryId'],
    ];
    map.forEach(([sel, key]) => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('change', () => {
        PF_STATE.filters[key] = el.value;
        if (key === 'type') {
          PF_STATE.filters.categoryId = 'all';
          renderFilterOptions();
        }
        renderEntries();
      });
    });
    const search = $('#pf-filter-search');
    if (search) {
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          PF_STATE.filters.q = search.value;
          renderEntries();
        }, 140);
      });
    }
  }

  function bindBudgetEvents() {
    const form = $('#pf-budget-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const categoryId = $('#pf-budget-category').value;
          PF.setBudget(PF_STATE.month, categoryId, $('#pf-budget-limit').value);
          $('#pf-budget-limit').value = '';
          renderAll();
          toast(`Budget saved for ${PF.categoryName(categoryId)}.`);
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
    const copy = $('#pf-budget-copy');
    if (copy) {
      copy.addEventListener('click', () => {
        const from = copy.dataset.pfCopyFrom;
        const count = PF.copyBudgets(from, PF_STATE.month);
        renderAll();
        toast(count ? `Copied ${count} ${count === 1 ? 'budget' : 'budgets'} from ${fmtMonth(from)}.` : 'Nothing to copy.', !count);
      });
    }
  }

  function bindAccountEvents() {
    const form = $('#pf-account-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const payload = {
            name: $('#pf-account-name').value,
            type: $('#pf-account-type').value,
            opening: $('#pf-account-opening').value,
          };
          if (PF_STATE.accountId) {
            PF.updateAccount(PF_STATE.accountId, payload);
            toast('Account updated.');
          } else {
            PF.addAccount(payload);
            toast('Account added.');
          }
          resetAccountForm();
          renderAll();
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
    const cancel = $('#pf-account-cancel');
    if (cancel) cancel.addEventListener('click', resetAccountForm);

    const catForm = $('#pf-category-form');
    if (catForm) {
      catForm.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          PF.addCategory({
            name: $('#pf-category-name').value,
            kind: $('#pf-category-kind').value,
          });
          $('#pf-category-name').value = '';
          renderAll();
          toast('Category added.');
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
  }

  function bindRuleEvents() {
    $$('#pf-rule-form [data-pf-rule-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        PF_STATE.ruleType = btn.dataset.pfRuleType;
        renderRuleFormOptions();
        const catSel = $('#pf-rule-category');
        if (catSel) catSel.value = PF.categoriesOf(PF_STATE.ruleType)[0].id;
        syncRuleForm();
      });
    });

    const form = $('#pf-rule-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const payload = {
          type: PF_STATE.ruleType,
          amount: $('#pf-rule-amount').value,
          accountId: $('#pf-rule-account').value,
          categoryId: $('#pf-rule-category').value,
          frequency: $('#pf-rule-frequency').value,
          startDate: $('#pf-rule-start').value,
          note: $('#pf-rule-note').value,
        };
        try {
          if (PF_STATE.ruleId) {
            PF.updateRule(PF_STATE.ruleId, payload);
            toast('Recurring entry updated.');
          } else {
            PF.addRule(payload);
            toast('Recurring entry added.');
          }
          resetRuleForm(true);
          renderAll();
        } catch (err) {
          toast(err.message, true);
        }
      });
    }
    const cancel = $('#pf-rule-cancel');
    if (cancel) cancel.addEventListener('click', () => resetRuleForm(true));

    const postAll = $('#pf-post-due');
    if (postAll) {
      postAll.addEventListener('click', () => {
        const result = PF.postAllDue();
        renderAll();
        toast(
          result.count
            ? `Posted ${result.count} ${result.count === 1 ? 'entry' : 'entries'} from recurring.`
            : 'Nothing is due.',
          !result.count
        );
      });
    }
  }

  function bindDelegatedEvents() {
    const panel = $('#tab-pf');
    if (!panel) return;
    panel.addEventListener('click', (e) => {
      const goto = e.target.closest('[data-pf-goto]');
      if (goto) {
        setView(goto.dataset.pfGoto);
        return;
      }

      const editEntry = e.target.closest('[data-pf-edit-entry]');
      if (editEntry) {
        setView('entries');
        startEditEntry(editEntry.dataset.pfEditEntry);
        return;
      }
      const delEntry = e.target.closest('[data-pf-del-entry]');
      if (delEntry) {
        const entry = PF.data.entries.find((x) => x.id === delEntry.dataset.pfDelEntry);
        if (!entry) return;
        if (!confirm(`Delete this ${entry.type} of ${money(entry.amount)}?`)) return;
        if (PF_STATE.entryId === entry.id) resetEntryForm(true);
        PF.deleteEntry(entry.id);
        renderAll();
        toast('Entry deleted.');
        return;
      }

      const editBudget = e.target.closest('[data-pf-edit-budget]');
      if (editBudget) {
        const budget = PF.budgetFor(PF_STATE.month, editBudget.dataset.pfEditBudget);
        if (!budget) return;
        $('#pf-budget-category').value = budget.categoryId;
        $('#pf-budget-limit').value = budget.limit;
        $('#pf-budget-limit').focus();
        return;
      }
      const delBudget = e.target.closest('[data-pf-del-budget]');
      if (delBudget) {
        const month = delBudget.dataset.pfBudgetMonth || PF_STATE.month;
        const categoryId = delBudget.dataset.pfDelBudget;
        if (!confirm(`Remove the budget for ${PF.categoryName(categoryId)}?`)) return;
        PF.deleteBudget(month, categoryId);
        renderAll();
        toast('Budget removed.');
        return;
      }

      const editAccount = e.target.closest('[data-pf-edit-account]');
      if (editAccount) {
        startEditAccount(editAccount.dataset.pfEditAccount);
        return;
      }
      const delAccount = e.target.closest('[data-pf-del-account]');
      if (delAccount) {
        const account = PF.account(delAccount.dataset.pfDelAccount);
        if (!account) return;
        if (!confirm(`Delete the account "${account.name}"?`)) return;
        try {
          if (PF_STATE.accountId === account.id) resetAccountForm();
          PF.deleteAccount(account.id);
          renderAll();
          toast('Account deleted.');
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }

      const delCategory = e.target.closest('[data-pf-del-category]');
      if (delCategory) {
        const id = delCategory.dataset.pfDelCategory;
        if (!confirm(`Delete the category "${PF.categoryName(id)}"?`)) return;
        try {
          PF.deleteCategory(id);
          renderAll();
          toast('Category deleted.');
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }

      const postRule = e.target.closest('[data-pf-post-rule]');
      if (postRule) {
        try {
          const result = PF.postRule(postRule.dataset.pfPostRule, true);
          renderAll();
          toast(`Posted ${result.count} ${result.count === 1 ? 'entry' : 'entries'}.`);
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }
      const toggleRule = e.target.closest('[data-pf-toggle-rule]');
      if (toggleRule) {
        PF.toggleRule(toggleRule.dataset.pfToggleRule);
        renderAll();
        return;
      }
      const editRule = e.target.closest('[data-pf-edit-rule]');
      if (editRule) {
        startEditRule(editRule.dataset.pfEditRule);
        return;
      }
      const delRule = e.target.closest('[data-pf-del-rule]');
      if (delRule) {
        if (!confirm('Delete this recurring entry? Entries it already posted stay in your records.')) return;
        if (PF_STATE.ruleId === delRule.dataset.pfDelRule) resetRuleForm(true);
        PF.deleteRule(delRule.dataset.pfDelRule);
        renderAll();
        toast('Recurring entry deleted.');
      }
    });
  }

  function bindShellEvents() {
    $$('.pf-subnav-btn').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.pfView));
    });

    const monthSel = $('#pf-month');
    if (monthSel) {
      monthSel.addEventListener('change', () => {
        PF_STATE.month = monthSel.value || nowMonth();
        renderAll();
      });
    }

    const settingsBtn = $('#pf-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
    $$('[data-pf-close-settings]').forEach((el) => el.addEventListener('click', closeSettings));

    const currency = $('#pf-set-currency');
    if (currency) {
      currency.addEventListener('input', () => {
        PF.data.meta.currency = currency.value.trim().slice(0, 8);
        PF.save();
        renderAll();
      });
    }

    const eraseBtn = $('#pf-erase');
    if (eraseBtn) {
      eraseBtn.addEventListener('click', () => {
        if (!confirm('Erase ALL Personal Finance data on this device? People, Transactions, Finance and Dashboard are not affected.')) return;
        if (!confirm('Really erase Personal Finance data? Export a backup first if you might need it.')) return;
        PF.eraseAll();
        PF_STATE.month = nowMonth();
        PF_STATE.filters = { month: 'all', type: 'all', accountId: 'all', categoryId: 'all', q: '' };
        const search = $('#pf-filter-search');
        if (search) search.value = '';
        resetEntryForm(false);
        resetAccountForm();
        resetRuleForm(false);
        renderAll();
        closeSettings();
        toast('Personal Finance data erased.');
      });
    }

    // Re-render when the tab is opened, so relative dates stay accurate.
    $$('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'pf') {
          refreshMonthIfStale();
          renderAll();
        }
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && $('#tab-pf') && $('#tab-pf').classList.contains('active')) {
        refreshMonthIfStale();
        renderAll();
      }
    });
  }

  function refreshMonthIfStale() {
    if (!isRealMonth(PF_STATE.month)) PF_STATE.month = nowMonth();
  }

  /* ---------------- boot ---------------- */

  function init() {
    if (!$('#tab-pf')) return;
    PF.load();
    refreshMonthIfStale();
    if (!document.getElementById('pf-entry-date').value) {
      document.getElementById('pf-entry-date').value = todayISO();
    }
    renderAccountFormOptions();
    resetEntryForm(false);
    resetRuleForm(false);
    resetAccountForm();
    bindEntryEvents();
    bindImportEvents();
    bindFilterEvents();
    bindBudgetEvents();
    bindAccountEvents();
    bindRuleEvents();
    bindDelegatedEvents();
    bindShellEvents();
    renderImportDrafts();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.PF = PF;
})();
