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

## Install it as an app (iPad / iPhone / Android / desktop)

The app is a **PWA** (manifest, icons and an offline service worker are included).
Once it is opened over an `https://` URL (for example the Cloudflare URL below):

- **iPad / iPhone (Safari):** tap the Share button → **Add to Home Screen**.
- **Android (Chrome):** tap the three-dot menu → **Install app** / **Add to Home screen**.
- **Desktop Chrome/Edge:** click the install icon in the address bar.

It then opens full-screen with its own icon, works offline, and respects iPad
safe areas (notch / home indicator). On-screen keyboards no longer zoom the page.

## Deploy to Cloudflare Workers

This repo includes `wrangler.toml` configured for **Workers Static Assets**, so no
server code is needed.

1. Create a free Cloudflare account and note your `*.workers.dev` subdomain
   (Workers & Pages → choose/set a subdomain).
2. From the project folder on your computer:

```bash
npx wrangler login
npx wrangler deploy
```

The app goes live at `https://al-shwareb.<your-subdomain>.workers.dev` — open that
URL on the iPad and use *Add to Home Screen*. Every `wrangler deploy` after a
`git pull` publishes the newest version.

Alternative without the command line: in the Cloudflare dashboard go to
**Workers & Pages → Create → Workers → upload static assets** and drag in this
folder (or a ZIP of it).

> Note: data still lives only on each device's browser storage. The service worker
> caches the app itself for offline use; keep using **Settings → Export backup** to
> safeguard or move your transactions.

## How your data is stored

Everything is saved in the browser's `localStorage` on **this device and this
browser only**. Clearing browser data will erase it, so use
**Settings → Export backup** regularly and keep the `.json` file somewhere safe.
Use **Import backup** to restore, or to move the data to another browser/device.

## Project structure

```
index.html             # app markup
manifest.webmanifest   # PWA install metadata
sw.js                  # service worker (offline caching)
wrangler.toml          # Cloudflare Workers Static Assets config
.wranglerignore        # files excluded from the Workers upload
icons/                 # app icons (PWA, Apple touch icon, favicon)
css/styles.css         # all styling (mobile/tablet-first, dark theme)
js/storage.js          # data model, localStorage, profit calculations
js/app.js              # screens, forms, rendering and events
```

When you change app files, bump `CACHE_VERSION` in `sw.js` so installed copies
pick up the update.
