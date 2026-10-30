# Three-hour reminders on Cloudflare Pages

The app now has an **optional** push reminder in **Personal Finance → Settings**.
It is **not live just from uploading the static app**. Set up the shared database,
Pages API and scheduled Worker below, then enable notifications on each phone.
No financial records or pasted messages are uploaded. The server stores only
push endpoint, encryption keys, a hashed per-device management token and creation
time. Push subscriptions are sensitive identifiers: do not publish the database,
keys, `.dev.vars` files, or command output containing private keys.

## Architecture and timing

- Cloudflare Pages serves the app and `functions/api/reminders.js`.
- A D1 database stores opt-in subscriptions, independently of all finance storage.
- `server/scheduler.mjs` is a **separate Worker**, because Pages Functions do not
  support cron triggers. It uses the same D1 database.
- Cron `0 */3 * * *` sends at **00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00,
  21:00 UTC**, including overnight. This is a shared UTC schedule, not three hours
  from each device's opt-in time; local clock times change with timezone/DST.
- Notification: **New transaction** — “Any new transactions? Tap to record one.”
- Tapping focuses the existing app and entry form, or opens that form in the PWA.
- A short 15-minute push TTL avoids a backlog of stale reminders after reconnecting.
  Phones, Focus/Do Not Disturb, battery settings and connectivity may delay or suppress
  delivery. This is not an exact alarm; missed reminders are not replayed.
- There are no quiet hours. Repeated notifications replace the previous reminder
  rather than accumulating eight cards a day.

## 1. Prepare Cloudflare (on your own computer/account)

Use a recent Node.js (22+) and Wrangler. Authenticate with `npx wrangler login`;
never paste login credentials or private keys into chat.

```sh
npx wrangler d1 create al-shwareb-reminders
```
Put the returned database ID into **`server/wrangler.toml`**, replacing
`REPLACE_WITH_CREATED_DATABASE_ID`. Then create its schema:

```sh
npx wrangler d1 execute al-shwareb-reminders --remote --config server/wrangler.toml --file server/schema.sql
```
Generate a **single** VAPID keypair locally (reuse it for both deployments):

```sh
node scripts/generate-vapid.mjs
```
Keep the output private. Do not regenerate keys on every build; changing the public
key requires devices to unsubscribe and re-enable notifications.

## 2. Configure the existing Pages project

In the Cloudflare dashboard, open your existing **Pages** project:

1. **Settings → Builds & deployments**: build command `npm run build`, output
   directory **`dist`**, repository root unchanged. Do **not** publish the repository
   root now that it contains backend code. `scripts/build.mjs` copies only public assets.
2. **Settings → Bindings**: add a **D1 database** binding named **`REMINDERS_DB`**,
   selecting the database created above.
3. **Variables and secrets**: add **`VAPID_PUBLIC_KEY`**, using the generated public
   key. Pages does **not** need the private key.
4. Redeploy the production Pages project so the binding and Function take effect.

The old root `wrangler.toml` describes the alternative static Workers deployment,
not this Pages project's bindings. Configure the existing Pages project through
its dashboard as above; do not replace the Pages site with the scheduler Worker.
For preview deployments, leave the database binding unset (reminders report
“not configured”) or use a **separate test database**. Do not register test devices
against the production scheduler accidentally.

Verify `https://YOUR-PROJECT.pages.dev/api/reminders` returns JSON with `publicKey`,
not HTML. If it returns 503 JSON, check the binding and variable and redeploy.
The Functions directory must be at the repository root, alongside `package.json`.

## 3. Deploy the scheduled Worker

Set these secrets on the **scheduler Worker**, using Wrangler's interactive prompts:

```sh
npx wrangler secret put VAPID_PUBLIC_KEY --config server/wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY --config server/wrangler.toml
npx wrangler secret put VAPID_SUBJECT --config server/wrangler.toml
```
Use the same public/private keypair generated above. `VAPID_SUBJECT` must be a
real contact URI you control, e.g. `mailto:you@example.com` (replace the example).
If Wrangler asks to create the Worker while setting its first secret, accept.
Then deploy:

```sh
npx wrangler deploy --config server/wrangler.toml
```
Confirm the cron trigger appears under that Worker's triggers. Allow time for
Cloudflare to propagate new cron triggers. Any Cloudflare usage charges depend
on your account plan; this feature is not a guarantee of free hosting.
For a public site, configure Cloudflare rate limiting for `/api/reminders` to
limit subscription abuse. The API has no financial-data access, accepts only
same-origin JSON writes with a per-device capability, and restricts push endpoints
to Apple, Google FCM and Mozilla; it is not a user-account/authentication system.

## 4. Enable on both phones

- **iPhone:** iOS 16.4+, Safari → Share → Add to Home Screen, then **open the app
  using that Home Screen icon**. In PF → Settings, tap **Enable reminders** and
  accept the system permission prompt.
- **Android:** open the HTTPS app in Chrome (installing the PWA is recommended),
  PF → Settings → **Enable reminders**, then allow notifications.
- Repeat on each device; permission is never requested automatically.
- **Disable reminders** in the same menu removes that device's server record and
  browser subscription. Disabling needs internet. You can also revoke permission
  in OS settings immediately. Expired endpoints are removed by the scheduler.
- Reminders are independent of PF backups/erase; disable before clearing site data,
  because that also removes this device's management token.

## Verification

```sh
npm test
npm run build
```
Tests cover independently decrypting the encrypted push payload, VAPID signature,
endpoint restrictions, API opt-in/out and device isolation, expired-subscription
cleanup, three-hour cron configuration, notification clicks and API cache bypass.
For an end-to-end check after deployment: enable on a real phone, close the app,
and wait for the next scheduled UTC slot. Check that tapping opens PF Entries.
Delivery on actual Apple/Google push services requires the live Cloudflare setup
and cannot be verified by the local unit tests alone.
