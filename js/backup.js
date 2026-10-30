/* One user-facing backup for every financial module; stores remain independent. */
(function () {
  'use strict';
  const APP = 'al-shwareb';
  const VERSION = 1;
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  function prepare(raw) {
    let obj;
    try { obj = JSON.parse(raw); }
    catch { throw new Error('That file is not a valid backup (.json).'); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('This is not an Al-shwareb backup.');
    if (obj.app === APP) {
      if (obj.version !== VERSION) throw new Error('This backup version is not supported. Update the app before restoring it.');
      if (!obj.data || !has(obj.data, 'main') || !has(obj.data, 'personalFinance')) {
        throw new Error('The whole-app backup is incomplete. No data was restored.');
      }
      const pf = obj.data.personalFinance;
      if (!obj.data.main || !Array.isArray(obj.data.main.finance) || !pf ||
          !pf.meta || !['accounts', 'categories', 'entries', 'budgets', 'recurring'].every(key => Array.isArray(pf[key]))) {
        throw new Error('The whole-app backup is incomplete. No data was restored.');
      }
      return {
        main: Store.prepareImport(obj.data.main),
        personalFinance: window.PF.prepareImport(obj.data.personalFinance),
        scope: 'all',
        confirmation: 'Replace ALL People, Transactions, Finance and Personal Finance data with this backup? This cannot be undone. Export a current backup first.',
        success: 'Whole-app backup restored, including Personal Finance.',
      };
    }
    if (obj.app === 'al-shwareb-pf' || (!obj.app && Array.isArray(obj.accounts) && Array.isArray(obj.entries))) {
      if (obj.version != null && obj.version !== 1) throw new Error('This Personal Finance backup version is not supported.');
      return {
        personalFinance: window.PF.prepareImport(obj), scope: 'pf',
        confirmation: 'This is an older PF-only backup. Replace Personal Finance only? People, Transactions and Finance will be kept. Export a current backup first.',
        success: 'Older Personal Finance backup restored. Other app data was kept.',
      };
    }
    if (!obj.app && Array.isArray(obj.people) && Array.isArray(obj.transactions)) {
      return {
        main: Store.prepareImport(obj), scope: 'main',
        confirmation: 'This is an older backup without Personal Finance. Replace People, Transactions and Finance only? Your current Personal Finance data will be kept. Export a current backup first.',
        success: 'Older app backup restored. Personal Finance was kept.',
      };
    }
    throw new Error('This is not an Al-shwareb backup. No data was restored.');
  }

  window.AppBackup = {
    exportData() {
      if (!Store.data || !window.PF?.data) throw new Error('App data is still loading. Please try again.');
      return JSON.stringify({
        app: APP, version: VERSION, exportedAt: new Date().toISOString(),
        data: { main: Store.data, personalFinance: window.PF.data },
      }, null, 2);
    },
    inspectData(raw) {
      const plan = prepare(raw);
      return { scope: plan.scope, confirmation: plan.confirmation, success: plan.success };
    },
    importData(raw) {
      // Validate both modules before changing either. A malformed PF section must
      // never leave the main records already replaced (or vice versa).
      const plan = prepare(raw);
      const changes = [];
      if (plan.main) changes.push({ store: Store, next: plan.main });
      if (plan.personalFinance) changes.push({ store: window.PF, next: plan.personalFinance });
      const snapshots = changes.map(({ store }) => localStorage.getItem(store.storageKey));
      let written = 0;
      try {
        for (const change of changes) {
          localStorage.setItem(change.store.storageKey, JSON.stringify(change.next));
          written++;
        }
      } catch {
        let rollbackFailed = false;
        for (let i = written - 1; i >= 0; i--) {
          try {
            const key = changes[i].store.storageKey;
            if (snapshots[i] === null) localStorage.removeItem(key);
            else localStorage.setItem(key, snapshots[i]);
          } catch { rollbackFailed = true; }
        }
        throw new Error(rollbackFailed
          ? 'Storage failed during restore and rollback. Do not close the app; export your current data and free device storage.'
          : 'Could not save the backup. Your existing data was kept. Check available device storage and try again.');
      }
      // In-memory stores are updated only after every storage write succeeds.
      for (const { store, next } of changes) store.data = next;
      if (plan.personalFinance) window.PF.refreshAfterRestore();
      return { scope: plan.scope };
    },
  };
})();
