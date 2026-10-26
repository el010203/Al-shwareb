# Al-shwareb — Profit & Documentation Tracker

A simple, offline web app for personal use. Track money transactions for several
people (no logins — each person simply has their own documentation), set a profit
percent on each transaction, and see total profit plus month-by-month profit.

## Features

- **People, not accounts** — add as many people as you need; each gets their own
  transactions and profit totals. No passwords.
- **Transactions** — person, an exact **start date** (day/month/year), period duration
  (1 month, 2 months, …), money put, **total** profit percent over the whole period, and
  a free-text documentation note. Profit is calculated automatically:
  `total profit = money put × total percent ÷ 100`, and the percent is spread evenly
  across the period — e.g. **10% over 5 months = 2% per month on average**.
- **Day-accurate monthly split** — the period runs from the exact start day for the
  chosen number of months, and profit is prorated by actual days. A one-month deal
  started on 28 Oct correctly splits its profit across the 4 days in October and the
  remaining days in November, so end-of-month deals are never miscounted.
- **Per-person history** — each person card has a **History** button showing all of
  that person's transactions, their totals, and an **Active / Ended / Upcoming** status
  based on today's date. Entries can be edited or deleted straight from the history.
- **Dashboard** — total money invested, **total profit in money**, **overall percent
  profit**, average profit per month, a monthly profit chart, and a full monthly
  breakdown. Multi-month deals are spread across their actual calendar months, so each
  month shows its own profit and the money at work in that month.
- **Filters** — view everything or narrow down by person and/or month.
- **Edit & delete** any transaction or person.
- **Backup / restore** — all data lives in your browser; export a `.json` backup file
  and import it again any time.
- Zero dependencies, works fully offline, mobile-friendly.

## How to run

Option A — just open `index.html` in any browser (double-click it).

Option B — serve it locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## How your data is stored

Everything is saved in the browser's `localStorage` on **this device and this
browser only**. Clearing browser data will erase it, so use
**Settings → Export backup** regularly and keep the `.json` file somewhere safe.
Use **Import backup** to restore, or to move the data to another browser/device.

## Project structure

```
index.html        # app markup
css/styles.css    # all styling (mobile-first)
js/storage.js     # data model, localStorage, profit calculations
js/app.js         # screens, forms, rendering and events
```
