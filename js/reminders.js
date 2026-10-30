/* Optional push reminders. Only subscription keys go online, never PF records. */
(function () {
  'use strict';
  const TOKEN_KEY = 'alshwareb_reminder_device_v1';
  const $ = (id) => document.getElementById(id);
  let busy = false;
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function status(message) { $('pf-reminder-status').textContent = message; }
  function token(create) {
    let value = localStorage.getItem(TOKEN_KEY);
    if (!value && create) {
      value = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(TOKEN_KEY, value);
    }
    return value;
  }
  async function api(action, subscription) {
    const response = await fetch('./api/reminders', {
      method: 'POST', cache: 'no-store', headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${token(true)}`,
      }, body: JSON.stringify({ action, subscription }), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Reminder service unavailable. Check the deployment and your connection.');
    return data;
  }
  function decode(value) {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  }
  async function registration() {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) throw new Error('The app is still installing. Reload once online, then try again.');
    return reg;
  }
  async function enable() {
    // Permission must be requested directly from a user gesture, particularly on iOS.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications were not allowed. Enable them in your device/browser settings.');
    const response = await fetch('./api/reminders', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const config = await response.json().catch(() => ({}));
    if (!response.ok || !config.publicKey) throw new Error(config.error || 'Reminder service is not configured yet.');
    const reg = await registration();
    let subscription = await reg.pushManager.getSubscription();
    let created = false;
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(config.publicKey) });
      created = true;
    }
    try { await api('enable', subscription.toJSON()); }
    catch (error) { if (created) await subscription.unsubscribe().catch(() => {}); throw error; }
    status('Enabled on this device: every 3 hours, day and night. Delivery may be delayed by your phone or connection.');
  }
  async function disable() {
    // Remove the server record first; offline failure must not falsely report success.
    await api('disable');
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    status('Reminders are off on this device.');
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    $('pf-reminder-enable').disabled = $('pf-reminder-disable').disabled = true;
    try { await action(); }
    catch (error) { status(error.message || 'Could not update reminders. Please try again online.'); }
    finally {
      busy = false;
      $('pf-reminder-enable').disabled = $('pf-reminder-disable').disabled = false;
    }
  }
  function openEntry() {
    document.querySelector('[data-pf-close-settings]')?.click();
    document.querySelector('.tab[data-tab="pf"]')?.click();
    document.querySelector('[data-pf-view="entries"]')?.click();
    $('pf-entry-form')?.scrollIntoView({ block: 'start' });
    $('pf-entry-amount')?.focus();
  }
  function init() {
    if (location.hash === '#new-transaction') openEntry();
    window.addEventListener('hashchange', () => { if (location.hash === '#new-transaction') openEntry(); });
    navigator.serviceWorker?.addEventListener('message', event => {
      if (event.data?.type === 'OPEN_NEW_TRANSACTION') openEntry();
    });
    if (!supported) {
      status('Push is unavailable here. On iPhone (iOS 16.4+), add this app to the Home Screen and open it there. On Android, use a supported browser over HTTPS.');
      $('pf-reminder-enable').disabled = $('pf-reminder-disable').disabled = true;
      return;
    }
    $('pf-reminder-enable').addEventListener('click', () => run(enable));
    $('pf-reminder-disable').addEventListener('click', () => run(disable));
    if (token(false)) {
      run(async () => {
        const data = await api('status');
        status(data.enabled
          ? (Notification.permission === 'granted' ? 'Enabled: every 3 hours, including overnight.' : 'Registered, but notifications are blocked. Allow them in your device settings or disable reminders here.')
          : 'Reminders are off on this device.');
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
