/* ============================================================
   Al-shwareb — storage & calculation layer (v2)
   All data is kept in the browser's localStorage.

   Transaction model:
     startMonth  'YYYY-MM' — first calendar month of the deal
     months      duration in months (1, 2, 3, …)
     amount      money put once
     percent     TOTAL profit percent over the whole period
                 (per-month rate = percent / months)
   ============================================================ */

const DB_KEY = 'alshwareb_db_v1';
const MAX_MONTHS = 60;

const Store = {
  data: null,

  /* ---------- persistence ---------- */

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      this.data = raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error('Failed to read saved data', err);
      this.data = null;
    }
    if (!this.data || !Array.isArray(this.data.people) || !Array.isArray(this.data.transactions)) {
      this.data = {
        meta: { version: 2, currency: 'EGP', createdAt: new Date().toISOString() },
        people: [],
        transactions: [],
      };
      this.save();
    }
    if (!this.data.meta) this.data.meta = { version: 2, currency: 'EGP' };
    if (!this.data.meta.currency) this.data.meta.currency = 'EGP';
    this.data.meta.version = 2;
    // Migrate v1 records (single `period` month) to the startMonth + months model.
    this.data.transactions = this.data.transactions.map((tx) => this.normalizeTx(tx));
    this.save();
    return this.data;
  },

  save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this.data));
  },

  normalizeTx(tx) {
    const startMonth = tx.startMonth || tx.period || currentMonthYM();
    let months = parseInt(tx.months, 10);
    if (!isFinite(months) || months < 1) months = 1;
    if (months > MAX_MONTHS) months = MAX_MONTHS;
    const copy = { ...tx, startMonth, months };
    delete copy.period;
    return copy;
  },

  /* ---------- helpers ---------- */

  uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  },

  get currency() {
    return this.data.meta.currency || 'EGP';
  },

  setCurrency(label) {
    this.data.meta.currency = (label || 'EGP').trim().slice(0, 8) || 'EGP';
    this.save();
  },

  /* ---------- people ---------- */

  getPeople() {
    return [...this.data.people].sort((a, b) => a.name.localeCompare(b.name));
  },

  personById(id) {
    return this.data.people.find((p) => p.id === id) || null;
  },

  personName(id) {
    const p = this.personById(id);
    return p ? p.name : 'Unknown';
  },

  addPerson(name) {
    name = (name || '').trim();
    if (!name) throw new Error('Please enter a name.');
    if (this.data.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('A person with this name already exists.');
    }
    const person = { id: this.uid(), name, createdAt: new Date().toISOString() };
    this.data.people.push(person);
    this.save();
    return person;
  },

  renamePerson(id, name) {
    name = (name || '').trim();
    if (!name) throw new Error('Please enter a name.');
    const person = this.personById(id);
    if (!person) throw new Error('Person not found.');
    if (this.data.people.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('A person with this name already exists.');
    }
    person.name = name;
    this.save();
  },

  deletePerson(id) {
    this.data.people = this.data.people.filter((p) => p.id !== id);
    this.data.transactions = this.data.transactions.filter((t) => t.personId !== id);
    this.save();
  },

  /* ---------- transactions ---------- */

  getTransactions({ personId = null, month = null } = {}) {
    let list = this.data.transactions;
    if (personId && personId !== 'all') list = list.filter((t) => t.personId === personId);
    if (month && month !== 'all') list = list.filter((t) => this.isActiveInMonth(t, month));
    return [...list].sort((a, b) => {
      if (a.startMonth !== b.startMonth) return b.startMonth.localeCompare(a.startMonth);
      return b.createdAt.localeCompare(a.createdAt);
    });
  },

  validateDeal({ personId, startMonth, months, amount, percent }) {
    if (!this.personById(personId)) throw new Error('Please choose a person.');
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) throw new Error('Please choose a start month.');
    months = parseInt(months, 10);
    if (!isFinite(months) || months < 1 || months > MAX_MONTHS) {
      throw new Error(`Period must be between 1 and ${MAX_MONTHS} months.`);
    }
    amount = Number(amount);
    percent = Number(percent);
    if (!isFinite(amount) || amount < 0) throw new Error('Money amount must be 0 or more.');
    if (!isFinite(percent) || percent < 0) throw new Error('Percent must be 0 or more.');
    return { months, amount: round2(amount), percent: round2(percent) };
  },

  addTransaction(fields) {
    const { personId, startMonth, note } = fields;
    const v = this.validateDeal(fields);
    const tx = {
      id: this.uid(),
      personId,
      startMonth,
      months: v.months,
      amount: v.amount,
      percent: v.percent,
      note: (note || '').trim(),
      createdAt: new Date().toISOString(),
    };
    this.data.transactions.push(tx);
    this.save();
    return tx;
  },

  updateTransaction(id, fields) {
    const tx = this.data.transactions.find((t) => t.id === id);
    if (!tx) throw new Error('Transaction not found.');
    const merged = {
      personId: fields.personId !== undefined ? fields.personId : tx.personId,
      startMonth: fields.startMonth !== undefined ? fields.startMonth : tx.startMonth,
      months: fields.months !== undefined ? fields.months : tx.months,
      amount: fields.amount !== undefined ? fields.amount : tx.amount,
      percent: fields.percent !== undefined ? fields.percent : tx.percent,
    };
    const v = this.validateDeal(merged);
    tx.personId = merged.personId;
    tx.startMonth = merged.startMonth;
    tx.months = v.months;
    tx.amount = v.amount;
    tx.percent = v.percent;
    if (fields.note !== undefined) tx.note = (fields.note || '').trim();
    this.save();
    return tx;
  },

  deleteTransaction(id) {
    this.data.transactions = this.data.transactions.filter((t) => t.id !== id);
    this.save();
  },

  /* ---------- period math ---------- */

  endMonth(tx) {
    return addMonthsYM(tx.startMonth, tx.months - 1);
  },

  monthRange(tx) {
    const out = [];
    for (let i = 0; i < tx.months; i++) out.push(addMonthsYM(tx.startMonth, i));
    return out;
  },

  isActiveInMonth(tx, ym) {
    return tx.startMonth <= ym && ym <= this.endMonth(tx);
  },

  // Total percent spread evenly over the period, e.g. 10% over 5 months -> 2% / month
  monthlyRateOf(tx) {
    return round2((Number(tx.percent) || 0) / tx.months);
  },

  // Total profit over the whole period = money put × total percent ÷ 100
  profitOf(tx) {
    return round2((Number(tx.amount) || 0) * (Number(tx.percent) || 0) / 100);
  },

  // Profit earned in each single month of the period
  monthlyProfitOf(tx) {
    return round2(this.profitOf(tx) / tx.months);
  },

  /* ---------- calculations ---------- */

  summarize(list) {
    let invested = 0;
    let profit = 0;
    let monthCount = 0;
    for (const tx of list) {
      invested += Number(tx.amount) || 0;
      profit += this.profitOf(tx);
      monthCount += tx.months;
    }
    invested = round2(invested);
    profit = round2(profit);
    return {
      count: list.length,
      invested,
      profit,
      returned: round2(invested + profit),
      monthCount,
      // Overall percent = total profit ÷ total money put (each deal's full-period %)
      percent: invested > 0 ? round2((profit / invested) * 100) : 0,
      avgMonthlyProfit: monthCount > 0 ? round2(profit / monthCount) : 0,
    };
  },

  // Expands every transaction onto its calendar months.
  // In a given month: "money at work" = amounts of deals active that month,
  // profit = each deal's per-month profit, rate = profit ÷ money at work.
  monthlyBreakdown(list) {
    const map = new Map();
    for (const tx of list) {
      const perMonth = this.monthlyProfitOf(tx);
      for (const ym of this.monthRange(tx)) {
        if (!map.has(ym)) map.set(ym, { period: ym, invested: 0, profit: 0, count: 0 });
        const row = map.get(ym);
        row.invested += Number(tx.amount) || 0;
        row.profit += perMonth;
        row.count += 1;
      }
    }
    return [...map.values()]
      .map((r) => ({
        ...r,
        invested: round2(r.invested),
        profit: round2(r.profit),
        percent: r.invested > 0 ? round2((r.profit / r.invested) * 100) : 0,
      }))
      .sort((a, b) => b.period.localeCompare(a.period));
  },

  // Every calendar month touched by any transaction (including spanned months)
  allMonths() {
    const set = new Set();
    for (const tx of this.data.transactions) {
      for (const ym of this.monthRange(tx)) set.add(ym);
    }
    return [...set].sort().reverse();
  },

  /* ---------- backup / restore ---------- */

  exportData() {
    return JSON.stringify(this.data, null, 2);
  },

  importData(jsonText) {
    let obj;
    try {
      obj = JSON.parse(jsonText);
    } catch {
      throw new Error('That file is not a valid backup (.json).');
    }
    if (!obj || !Array.isArray(obj.people) || !Array.isArray(obj.transactions) || !obj.meta) {
      throw new Error('The file does not look like an Al-shwareb backup.');
    }
    this.data = {
      meta: { version: 2, currency: obj.meta.currency || 'EGP', createdAt: obj.meta.createdAt || new Date().toISOString() },
      people: obj.people,
      transactions: obj.transactions.map((tx) => this.normalizeTx(tx)),
    };
    this.save();
  },

  eraseAll() {
    this.data = {
      meta: { version: 2, currency: this.currency, createdAt: new Date().toISOString() },
      people: [],
      transactions: [],
    };
    this.save();
  },

  loadSampleData() {
    const people = [
      { id: this.uid(), name: 'Ahmed', createdAt: new Date().toISOString() },
      { id: this.uid(), name: 'Mona', createdAt: new Date().toISOString() },
      { id: this.uid(), name: 'Karim', createdAt: new Date().toISOString() },
    ];
    // startMonth offsets from today, duration in months, total percent over the period
    const rows = [
      [people[0].id, 0, 3, 5000, 10, 'Electronics order — 10% over 3 months'],
      [people[1].id, 0, 2, 3000, 12, 'Clothes shipment — 12% over 2 months'],
      [people[2].id, 0, 5, 2500, 10, 'Accessories — 10% over 5 months (2% per month)'],
      [people[0].id, 1, 4, 4500, 11, 'Restock — phones'],
      [people[1].id, 1, 1, 2000, 9, 'Market stall goods'],
      [people[2].id, 2, 6, 6000, 12, 'Wholesale deal'],
      [people[0].id, 2, 2, 3500, 7, 'Seasonal items'],
      [people[1].id, 3, 3, 4200, 12, 'Online sales batch'],
    ];
    this.data.people.push(...people);
    for (const [personId, offset, months, amount, percent, note] of rows) {
      this.data.transactions.push({
        id: this.uid(),
        personId,
        startMonth: addMonthsYM(currentMonthYM(), -offset),
        months,
        amount,
        percent,
        note,
        createdAt: new Date().toISOString(),
      });
    }
    this.save();
  },
};

/* ---------- module-level utilities ---------- */

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function currentMonthYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonthsYM(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
