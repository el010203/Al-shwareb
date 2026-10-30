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
- **Standalone Finance tab** — completely independent of People, Transactions, and
  Dashboard. Document an **amount paid**, choose either a **percentage** or a **fixed
  amount** for the profit, set an optional **date to receive**, mark payouts as
  **Received**, and inspect everything in **View history** (with status, profit-option,
  and search filters).
- **Personal Finance tab (PF)** — a completely standalone module with its own storage
  key, so nothing it records ever appears in People, Transactions, Finance or the
  Dashboard. It documents **every income and every expense** (amount, date, account,
  category, note), keeps **multiple accounts** (cash, bank, wallet, card, savings) with
  automatic balances, holds **monthly budgets per category** with usage bars, and
  supports **recurring entries** (weekly / monthly / yearly) that you confirm when due.
  Entries can be filtered by month, type, account, category and free-text search.
- **Filters** — view everything or narrow down by person and/or month.
- **Edit & delete** any transaction or person.
- **Backup / restore** — all data lives in your browser; export a `.json` backup file
  and import it again any time.
- Zero dependencies, works fully offline, mobile-friendly.

## Personal Finance (PF) tab

The **Personal Finance** tab is a separate module inside the same page. It has its own
data store (`alshwareb_pf_v1` in `localStorage`), its own currency label, its own backup
file and its own erase button — the two halves of the app never read or write each
other's data.

- **Overview** — total balance across accounts, income / expenses / net for the chosen
  month (with change vs last month and savings rate), a 6-month income-vs-expense chart,
  account balances, budget progress and recent entries.
- **Import from message** — paste (or copy) an InstaPay, Vodafone Cash, Etisalat Cash or
  bank SMS and PF reads the amount, whether money came in or went out, the date, the
  reference and any fee, then pre-fills an editable entry you confirm. Arabic and English
  messages and Arabic-Indic digits are understood; paste several messages at once to add
  them together. Parsing happens entirely on the device.
- **Entries** — record income or expense with amount, date, account, category and an
  optional note. Filter by month, type, account, category or search text; edit or delete
  any entry. The account balance is shown after every save.
- **Budgets** — set a monthly limit per expense category, see spent / limit and
  remaining, copy the previous month's budgets forward, and spot spending that has no
  budget yet.
- **Accounts** — add or edit accounts (cash, bank, mobile wallet, card, savings, other)
  with an opening balance; balances are derived from every entry. Categories can be
  added or removed here (a category can only be removed when nothing uses it).
- **Recurring** — define rent, salary or subscriptions and confirm them when due; PF
  shows overdue counts and can post everything that is due in one tap. Nothing is ever
  posted silently.

### Importing InstaPay / Vodafone Cash messages

Web apps cannot read SMS — no browser or PWA exposes an API for it, and iOS has no
SMS API at all. So PF takes the message as *text* instead:

1. Long-press the SMS on your phone → **Copy** (or forward/share it to yourself).
2. Open **Personal Finance → Entries → Import from message** and paste it.
3. PF shows what it understood — type, amount, date, account, category, note — with each
   field editable. Tap **Add** (or **Add all** for a multi-message paste).

What it recognises:

- **Direction** — "you received" / "you sent", "تم استلام" / "تم تحويل" / "تم خصم",
  credits, deposits, withdrawals, payments.
- **Amount** — currency-tagged numbers (EGP, LE, جنيه, ج.م), ignoring balances, fees,
  phone numbers, references and dates.
- **Date** — `dd/mm/yyyy`, `yyyy-mm-dd`, `12 Oct 2026`, `12 اكتوبر 2026`, and the
  year-first `yy-mm-dd` form Egyptian operators use (`26-10-28` → 28 Oct 2026). Readings
  that land in the future are rejected in favour of the plausible one; today if absent.
- **Layout** — multi-paragraph operator messages (amount line, then the date, reference
  and an advert paragraph) are kept together as one message, and advert links such as
  `vf.eg/vfcash?id=money_transfer` are ignored so their wording cannot be mistaken for
  a transaction.
- **Extras** — transaction reference, counterparty name or phone (`لرقم 01037222406`
  becomes `phone 01037222406`, and `المسجل بإسم ...` gives the registered name), and any
  fee (`مصاريف الخدمة 1 جنيه`). The fee is shown as a note rather than added to the
  amount, because operators usually debit it separately.
- **Accounts** — the destination wallet is suggested when the message mentions Vodafone
  Cash / محفظتك, and a bank account when it mentions InstaPay. Advert links are stripped
  first, so a link containing `vfcash` cannot be mistaken for an account called "Cash".
- **Balances are ignored** — `رصيد حسابك ... الحالي 9.20` never becomes the amount.

Example — an incoming Vodafone Cash message:

```
تم استلام مبلغ 200.00 جنيه من 01014271861؛
المسجل بإسم YOSSEF ALAA ELDEIN MOHAMMED TOLBA
على رقم محفظتك 01014271861 بتاريخ 13:42 26-10-28.
رصيدك الحالي: 215.20 جنيه
رقم العملية: 025177594313
```
is read as **income · 200.00 EGP · 28 Oct 2026** with the note
`Vodafone Cash · YOSSEF ALAA ELDEIN MOHAMMED TOLBA · Ref 025177594313` — note that the
`215.20` balance is not mistaken for the amount.

Outgoing example — this Vodafone Cash message:

```
تم تحويل 205 جنيه لرقم 01037222406 مصاريف الخدمة 1 جنيه رصيد حسابك فى فودافون كاش الحالي 9.20.
تاريخ العملية 13:55 26-10-28 :
رقم العملية 025177972025 :
```
is read as **expense · 205.00 EGP · 28 Oct 2026 · Cash · Other expense**, with the note
`Vodafone Cash · phone 01037222406 · Ref 025177972025` and fee `1.00 EGP`.
- Arabic-Indic digits (٤٥٠) are converted automatically.

If a message format is not recognised, the card says so and offers to fill the form
manually with the raw text as the note.

**Why not fully automatic?** Reading SMS from a native Android app requires `READ_SMS`,
which Google Play only grants to default-SMS-handler apps; sideloaded APKs that request
it get Play Protect warnings. On Android, a future option is the Web Share Target API
(share the SMS straight into the installed PWA); iOS Safari does not support it, which is
why the paste box is the default path on both platforms.

Use the **Month** selector in the PF top bar for Overview and Budgets, and
**Settings** inside the tab to change the PF currency, export/import a PF-only backup
(`pf-backup-YYYY-MM-DD.json`) or erase PF data without touching the rest of the app.

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

## Deploy to Cloudflare

This is a plain static site, so it runs on either Cloudflare product. **Pages is
recommended** — it matches the other apps in your Cloudflare dashboard, connects to
the GitHub repo and redeploys automatically on every push, and uses a `*.pages.dev`
URL (which is also less likely to be blocked by mobile networks than `workers.dev`).

### Option A — Cloudflare Pages connected to GitHub (recommended)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick the **`el010203/Al-shwareb`** GitHub repository and authorize it.
3. Set the **production branch to `arena/9caf2b8f-al-shwareb`** (the `main` branch
   only contains the initial README; the app lives on this branch).
4. Build settings — no build step is needed:
   - Framework preset: **None**
   - Build command: leave **empty**
   - Build output directory: **`/`** (the repository root, where `index.html` is)
5. Click **Save and Deploy**. The app goes live at
   `https://<project-name>.pages.dev` (you can rename the project on the first screen).

After that, every `git push` to the branch publishes a new deployment automatically —
no more manual deploy commands. Preview URLs per branch are also created for free.

### Option B — Pages from the command line (no GitHub connection)

```bash
npx wrangler login
npx wrangler pages deploy . --project-name=al-shwareb
```

The first run creates the Pages project; each later run uploads a new deployment and
prints the `*.pages.dev` URL.

### Option C — Workers Static Assets (the original setup)

`wrangler.toml` is included for this route:

```bash
npx wrangler login
npx wrangler deploy
```

This produces the `*.workers.dev` URL and appears as a **Worker** (different icon and
no repo badge) rather than a Pages project.

### Switching from workers.dev to pages.dev

The two URLs are different browser origins, so local data does not carry over
automatically. Before removing the old Worker: open the old URL →
**Settings → Export backup**, then open the new pages.dev URL →
**Settings → Import backup**. Reinstall the home-screen app from the new URL and
delete the old icon. The old Worker can then be deleted from the dashboard.

> Note: data still lives only on each device's browser storage (`localStorage`) — there
> is no online database and no data ever leaves the device. The service worker caches
> the app itself for offline use: open the URL once while online, install it, and it
> afterwards launches with no internet. The app also requests persistent storage so the
> browser won't auto-clear the data; **Settings** shows the protection status. Keep using
> **Settings → Export backup** to safeguard or move your transactions anyway.

## Troubleshooting

**Installed app shows "This site can't be reached / ERR_FAILED" (Android or iPad).**

1. The device must open the URL **once while online** and stay connected for ~20
   seconds so the service worker can finish caching. Re-open the page in a normal
   browser tab first; it should load normally.
2. Verify the deployment is complete by opening these directly (each must load):
   `https://YOUR-URL.workers.dev/sw.js` and
   `https://YOUR-URL.workers.dev/icons/icon-192.png`. A 404 means files were missing
   from the upload — redeploy with `npx wrangler deploy` from the full project folder.
3. Remove the installed home-screen icon, open the website once in the browser, then
   **Add to Home Screen / Install** again.
4. Some mobile networks block `*.workers.dev`. Try the other network (Wi‑Fi vs mobile
   data). Two permanent fixes: deploy the same files as a **Cloudflare Pages** project
   (see "Option A" above) to get a `*.pages.dev` URL, or connect your own domain to the
   Worker in the Cloudflare dashboard (Workers → your Worker → Settings →
   Domains & Routes), which bypasses workers.dev entirely.
5. When offline and working, an amber **"You're offline"** banner appears inside the
   app. If you instead see a browser error page, the service worker wasn't installed —
   repeat steps 1–3.

## How your data is stored

Everything is saved in the browser's `localStorage` on **this device and this
browser only**. The Personal Finance tab uses its own separate key, so its data is
included only in **PF Settings → Export PF backup**, not in the main backup file. Clearing browser data will erase it, so use
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
css/pf.css             # Personal Finance tab styling (incl. message importer)
js/storage.js          # data model, localStorage, profit calculations
js/app.js              # screens, forms, rendering and events
js/pf.js               # Personal Finance module (own data store, UI, SMS parser)
```

When you change app files, bump `CACHE_VERSION` in `sw.js` so installed copies
pick up the update.
