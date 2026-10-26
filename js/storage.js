/* ============================================================
   Al-shwareb — storage & calculation layer
   All data is kept in the browser's localStorage.
   ============================================================ */

const DB_KEY = 'alshwareb_db_v1';

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
        meta: { version: 1, currency: 'EGP', createdAt: new Date().toISOString() },
        people: [],
        transactions: [],
      };
      this.save();
    }
    if (!this.data.meta) this.data.meta = { version: 1, currency: 'EGP' };
    if (!this.data.meta.currency) this.data.meta.currency = 'EGP';
    return this.data;
  },

  save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this.data));
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
    if (month && month !== 'all') list = list.filter((t) => t.period === month);
    return [...list].sort((a, b) => {
      if (a.period !== b.period) return b.period.localeCompare(a.period);
      return b.createdAt.localeCompare(a.createdAt);
    });
  },

  addTransaction({ personId, period, amount, percent, note }) {
    if (!this.personById(personId)) throw new Error('Please choose a person.');
    if (!period) throw new Error('Please choose a month period.');
    amount = Number(amount);
    percent = Number(percent);
    if (!isFinite(amount) || amount < 0) throw new Error('Money amount must be 0 or more.');
    if (!isFinite(percent) || percent < 0) throw new Error('Percent must be 0 or more.');

    const tx = {
      id: this.uid(),
      personId,
      period,
      amount: round2(amount),
      percent: round2(percent),
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
    if (fields.personId !== undefined) {
      if (!this.personById(fields.personId)) throw new Error('Please choose a person.');
      tx.personId = fields.personId;
    }
    if (fields.period !== undefined) {
      if (!fields.period) throw new Error('Please choose a month period.');
      tx.period = fields.period;
    }
    if (fields.amount !== undefined) {
      const amount = Number(fields.amount);
      if (!isFinite(amount) || amount < 0) throw new Error('Money amount must be 0 or more.');
      tx.amount = round2(amount);
    }
    if (fields.percent !== undefined) {
      const percent = Number(fields.percent);
      if (!isFinite(percent) || percent < 0) throw new Error('Percent must be 0 or more.');
      tx.percent = round2(percent);
    }
    if (fields.note !== undefined) tx.note = (fields.note || '').trim();
    this.save();
    return tx;
  },

  deleteTransaction(id) {
    this.data.transactions = this.data.transactions.filter((t) => t.id !== id);
    this.save();
  },

  /* ---------- calculations ---------- */

  // Profit of one transaction = money put × percent ÷ 100
  profitOf(tx) {
    return round2((Number(tx.amount) || 0) * (Number(tx.percent) || 0) / 100);
  },

  summarize(list) {
    let invested = 0;
    let profit = 0;
    for (const tx of list) {
      invested += Number(tx.amount) || 0;
      profit += this.profitOf(tx);
    }
    invested = round2(invested);
    profit = round2(profit);
    return {
      count: list.length,
      invested,
      profit,
      returned: round2(invested + profit),
      // Overall percent profit = total profit ÷ total money put
      percent: invested > 0 ? round2((profit / invested) * 100) : 0,
    };
  },

  // Groups transactions by month period.
  monthlyBreakdown(list) {
    const map = new Map();
    for (const tx of list) {
      if (!map.has(tx.period)) map.set(tx.period, []);
      map.get(tx.period).push(tx);
    }
    return [...map.entries()]
      .map(([period, txs]) => ({ period, ...this.summarize(txs) }))
      .sort((a, b) => b.period.localeCompare(a.period));
  },

  allMonths() {
    return [...new Set(this.data.transactions.map((t) => t.period))].sort().reverse();
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
      meta: { version: 1, currency: obj.meta.currency || 'EGP', createdAt: obj.meta.createdAt || new Date().toISOString() },
      people: obj.people,
      transactions: obj.transactions,
    };
    this.save();
  },

  eraseAll() {
    this.data = {
      meta: { version: 1, currency: this.currency, createdAt: new Date().toISOString() },
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
    const now = new Date();
    const ym = (offset) => {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const rows = [
      [people[0].id, 0, 5000, 10, 'Electronics order'],
      [people[1].id, 0, 3000, 12, 'Clothes shipment'],
      [people[2].id, 0, 2500, 8, 'Accessories'],
      [people[0].id, 1, 4500, 11, 'Restock — phones'],
      [people[1].id, 1, 2000, 9, 'Market stall goods'],
      [people[2].id, 2, 6000, 10, 'Wholesale deal'],
      [people[0].id, 2, 3500, 7, 'Seasonal items'],
      [people[1].id, 3, 4200, 13, 'Online sales batch'],
    ];
    this.data.people.push(...people);
    for (const [personId, offset, amount, percent, note] of rows) {
      this.data.transactions.push({
        id: this.uid(),
        personId,
        period: ym(offset),
        amount,
        percent,
        note,
        createdAt: new Date().toISOString(),
      });
    }
    this.save();
  },
};

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
