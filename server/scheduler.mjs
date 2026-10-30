import { sendReminder } from './webpush.mjs';
export async function runSchedule(env, send = sendReminder) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) throw new Error('Missing VAPID configuration');
  let cursor = '';
  while (true) {
    const { results } = await env.REMINDERS_DB.prepare('SELECT * FROM reminder_subscriptions WHERE id > ? ORDER BY id LIMIT 50').bind(cursor).all();
    if (!results.length) break;
    // Limit concurrency; never log endpoints, keys, or message contents.
    for (let i = 0; i < results.length; i += 5) {
      await Promise.all(results.slice(i, i + 5).map(async row => {
        try {
          const response = await send(row, env);
          if (response.status === 404 || response.status === 410) {
            await env.REMINDERS_DB.prepare('DELETE FROM reminder_subscriptions WHERE id = ? AND endpoint = ?').bind(row.id, row.endpoint).run();
          } else if (!response.ok) console.warn('Push delivery rejected:', response.status);
          await response.body?.cancel();
        } catch { console.warn('Push delivery failed; will try at the next scheduled interval.'); }
      }));
    }
    cursor = results.at(-1).id;
  }
}
export default {
  scheduled(_event, env, ctx) { ctx.waitUntil(runSchedule(env)); },
  fetch() { return new Response('Scheduled reminders only', { status: 404 }); },
};
