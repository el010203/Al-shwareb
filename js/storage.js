/* ============================================================
   Al-shwareb — storage & calculation layer (v3)
   All data is kept in the browser's localStorage.

   Transaction model:
     startDate   'YYYY-MM-DD' — exact day the deal starts
     months      duration in whole months (1, 2, 3, …)
     amount      money put once
     percent     TOTAL profit percent over the whole period
                 (average per-month rate = percent / months)

   The deal is active on the half-open interval [startDate, endDate),
   where endDate = startDate + months. Profit is spread by actual days,
   so a deal starting just before month-end is prorated correctly.
   ============================================================ */

const DB_KEY = 'alshwareb_db_v1';
const MAX_MONTHS = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
        meta: { version: 3, currency: 'EGP', createdAt: new Date().toISOString() },
        people: [],
        transactions: [],
      };
      this.save();
    }
    if (!this.data.meta) this.data.meta = { version: 3, currency: 'EGP' };
    if (!this.data.meta.currency) this.data.meta.currency = 'EGP';
    this.data.meta.version = 3;
    // Migrate v1 (period month) and v2 (startMonth) records to exact dates.
    this.data.transactions = this.data.transactions.map((tx) => this.normalizeTx(tx));
    this.save();
    return this.data;
  },

  save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this.data));
  },

  normalizeTx(tx) {
    let startDate;
    if (tx.startDate && DATE_RE.test(tx.startDate) && isValidDate(tx.startDate)) {
      startDate = tx.startDate;
    } else {
      const ym = tx.startMonth || tx.period || currentMonthYM();
      startDate = `${ym.slice(0, 7)}-01`;
    }
    let months = parseInt(tx.months, 10);
    if (!isFinite(months) || months < 1) months = 1;
    if (months > MAX_MONTHS) months = MAX_MONTHS;
    const copy = { ...tx, startDate, months };
    delete copy.period;
    delete copy.startMonth;
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
      if (a.startDate !== b.startDate) return b.startDate.localeCompare(a.startDate);
      return b.createdAt.localeCompare(a.createdAt);
    });
  },

  validateDeal({ personId, startDate, months, amount, percent }) {
    if (!this.personById(personId)) throw new Error('Please choose a person.');
    if (!startDate || !DATE_RE.test(startDate) || !isValidDate(startDate)) {
      throw new Error('Please choose a valid start date.');
    }
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
    const { personId, startDate, note } = fields;
    const v = this.validateDeal(fields);
    const tx = {
      id: this.uid(),
      personId,
      startDate,
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
      startDate: fields.startDate !== undefined ? fields.startDate : tx.startDate,
      months: fields.months !== undefined ? fields.months : tx.months,
      amount: fields.amount !== undefined ? fields.amount : tx.amount,
      percent: fields.percent !== undefined ? fields.percent : tx.percent,
    };
    const v = this.validateDeal(merged);
    tx.personId = merged.personId;
    tx.startDate = merged.startDate;
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

  /* ---------- date / period math ---------- */

  // Maturity date = start date + N whole months (clamped to month length).
  endDate(tx) {
    return addMonthsISO(tx.startDate, tx.months);
  },

  periodDays(tx) {
    return daysBetween(tx.startDate, this.endDate(tx));
  },

  // Every calendar month the deal touches, with the active days in each.
  monthSlices(tx) {
    const end = this.endDate(tx);
    const slices = [];
    let cursor = tx.startDate;
    while (cursor < end) {
      const ym = cursor.slice(0, 7);
      const nextMonth = firstOfNextMonth(ym);
      const sliceEnd = nextMonth < end ? nextMonth : end;
      slices.push({
        ym,
        days: daysBetween(cursor, sliceEnd),
        from: cursor,
        to: addDaysISO(sliceEnd, -1),
      });
      cursor = sliceEnd;
    }
    return slices;
  },

  isActiveInMonth(tx, ym) {
    return tx.startDate < firstOfNextMonth(ym) && this.endDate(tx) > `${ym}-01`;
  },

  // 'upcoming' | 'active' | 'ended', relative to a given day (default today).
  statusOf(tx, asOf = todayISO()) {
    const end = this.endDate(tx);
    if (tx.startDate > asOf) return 'upcoming';
    if (end <= asOf) return 'ended';
    return 'active';
  },

  /* ---------- profit math ---------- */

  // Total profit over the whole period = money put × total percent ÷ 100
  profitOf(tx) {
    return round2((Number(tx.amount) || 0) * (Number(tx.percent) || 0) / 100);
  },

  // Average per-month rate, e.g. 10% over 5 months -> 2% / month
  monthlyRateOf(tx) {
    return round2((Number(tx.percent) || 0) / tx.months);
  },

  // Average profit per whole month of the period
  avgMonthlyProfitOf(tx) {
    return round2(this.profitOf(tx) / tx.months);
  },

  dailyProfitOf(tx) {
    const days = this.periodDays(tx);
    return days > 0 ? this.profitOf(tx) / days : 0;
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
      percent: invested > 0 ? round2((profit / invested) * 100) : 0,
      avgMonthlyProfit: monthCount > 0 ? round2(profit / monthCount) : 0,
    };
  },

  // Expands every transaction onto its calendar months using day proration.
  // Per month: "money at work" = principal of every deal active that month,
  // profit = each deal's daily profit × active days in that month. Allocation
  // of the final slice is corrected so monthly parts sum to the exact total.
  monthlyBreakdown(list) {
    const map = new Map();
    for (const tx of list) {
      const slices = this.monthSlices(tx);
      const total = this.profitOf(tx);
      const daily = this.dailyProfitOf(tx);
      let allocated = 0;
      slices.forEach((slice, i) => {
        let part;
        if (i === slices.length - 1) {
          part = round2(total - allocated); // absorb rounding remainder
        } else {
          part = round2(daily * slice.days);
          allocated += part;
        }
        if (!map.has(slice.ym)) map.set(slice.ym, { period: slice.ym, invested: 0, profit: 0, count: 0 });
        const row = map.get(slice.ym);
        row.invested += Number(tx.amount) || 0;
        row.profit += part;
        row.count += 1;
      });
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

  // Every calendar month touched by any transaction (including partial months)
  allMonths() {
    const set = new Set();
    for (const tx of this.data.transactions) {
      for (const slice of this.monthSlices(tx)) set.add(slice.ym);
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
      meta: { version: 3, currency: obj.meta.currency || 'EGP', createdAt: obj.meta.createdAt || new Date().toISOString() },
      people: obj.people,
      transactions: obj.transactions.map((tx) => this.normalizeTx(tx)),
    };
    this.save();
  },

  eraseAll() {
    this.data = {
      meta: { version: 3, currency: this.currency, createdAt: new Date().toISOString() },
      people: [],
      transactions: [],
    };
    this.save();
  },

  loadSampleData() {
    // Reuse existing people with the same name instead of creating duplicates.
    const names = ['Ahmed', 'Mona', 'Karim'];
    const people = names.map((name) => {
      const existing = this.data.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
      return existing || { id: this.uid(), name, createdAt: new Date().toISOString() };
    });
    const created = people.filter((p) => !this.data.people.includes(p));
    this.data.people.push(...created);
    const today = todayISO();
    // start offsets in days (mixed day-of-month to show proration), months, amount, total %
    const rows = [
      [people[0].id, -2, 3, 5000, 10, 'Electronics order — 10% over 3 months'],
      [people[1].id, -5, 2, 3000, 12, 'Clothes shipment — 12% over 2 months'],
      [people[2].id, -9, 5, 2500, 10, 'Accessories — 10% over 5 months (2% per month avg)'],
      [people[0].id, -34, 4, 4500, 11, 'Restock — phones'],
      [people[1].id, -40, 1, 2000, 9, 'Market stall goods'],
      [people[2].id, -65, 6, 6000, 12, 'Wholesale deal'],
      [people[0].id, -70, 2, 3500, 7, 'Seasonal items'],
      [people[1].id, -95, 3, 4200, 12, 'Online sales batch'],
    ];
    for (const [personId, offset, months, amount, percent, note] of rows) {
      this.data.transactions.push({
        id: this.uid(),
        personId,
        startDate: addDaysISO(today, offset),
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

/* ---------- module-level date utilities ---------- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function currentMonthYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return !isNaN(d.getTime()) && toISODate(d) === iso;
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Add whole months, clamping the day to the target month's length
// (e.g. Jan 31 + 1 month -> Feb 28/29).
function addMonthsISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (m - 1) + n;
  const targetYear = y + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const daysInTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
  return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(Math.min(d, daysInTarget))}`;
}

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86400000);
}

function firstOfNextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return addMonthsISO(`${y}-${pad2(m)}-01`, 1);
}
