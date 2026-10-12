import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fakeFetch, makeEnv } from './helpers/index.js';
import { Store, migrateLegacyState } from '../src/store.js';
import { scopeFingerprint } from '../src/sources/index.js';

const { json } = fakeFetch;

function steamEnv(extra = {}) {
  const stock = { available: false, status: 200 };
  const fetch = fakeFetch([
    [/GetHardwareItems/, () =>
      stock.status === 200
        ? { response: { details: [{ packageid: 1727363, inventory_available: stock.available, allow_purchase_in_country: true }] } }
        : json({}, stock.status)],
    [/CheckInventoryAvailableByPackage/, () => json({}, stock.status === 200 ? 500 : stock.status)],
    [/packagedetails/, () => ({ 1727363: { success: true, data: { name: 'Ergonomic Kit', price: { currency: 'PLN', final: 27900 } } } })]
  ]);
  const env = makeEnv(
    {
      watches: [{ id: 'ergo', type: 'steam', name: 'Steam Frame – Ergonomic Kit', packages: [1727363], intervalSeconds: 45 }],
      ...extra
    },
    { fetch }
  );
  return { ...env, stock, fetch };
}

test('baseline first, then a restock alert with a store button', async () => {
  const { monitor, notifier, store, stock } = steamEnv();

  const first = await monitor.checkWatch('ergo');
  assert.equal(first.baseline, true);
  assert.equal(notifier.sent.length, 1);
  assert.match(notifier.sent[0].text, /Nowa obserwacja: Steam Frame – Ergonomic Kit/);
  assert.equal(notifier.sent[0].silent, true);

  const second = await monitor.checkWatch('ergo');
  assert.equal(second.changes.length, 0);
  assert.equal(notifier.sent.length, 1);

  stock.available = true;
  const third = await monitor.checkWatch('ergo');
  assert.equal(third.changes[0].type, 'restock');
  const alert = notifier.sent[1];
  assert.match(alert.text, /DOSTĘPNE!/);
  assert.match(alert.text, /Ergonomic Kit<\/b> · 279,00\s?zł/);
  assert.equal(alert.silent, false);
  assert.equal(alert.keyboard[0][0].url, 'https://store.steampowered.com/sub/1727363');
  assert.equal(store.runtime.history[0].type, 'restock');
  assert.equal(store.runtime.history[0].notified, true);

  stock.available = false;
  await monitor.checkWatch('ergo');
  assert.match(notifier.sent[2].text, /Wyprzedane/);
  assert.equal(notifier.sent[2].silent, true, 'sell-outs are delivered silently');
});

test('a change is re-sent on the next check when Telegram was down', async () => {
  const { monitor, notifier, stock } = steamEnv();
  await monitor.checkWatch('ergo');
  stock.available = true;
  notifier.fail = true;
  const failed = await monitor.checkWatch('ergo');
  assert.equal(failed.ok, false);
  notifier.fail = false;
  const retried = await monitor.checkWatch('ergo');
  assert.equal(retried.changes[0].type, 'restock');
  assert.match(notifier.sent.at(-1).text, /DOSTĘPNE!/);
});

test('failure alert only after a persistent streak, then a recovery message', async () => {
  const { monitor, notifier, stock, store } = steamEnv({
    health: { alertAfterFailures: 3, alertAfterMinutes: 0, repeatErrorAlertMinutes: 60 }
  });
  await monitor.checkWatch('ergo');
  stock.status = 404;
  for (let i = 0; i < 2; i++) await monitor.checkWatch('ergo');
  assert.equal(notifier.sent.length, 1, 'no alert for two failures');
  await monitor.checkWatch('ergo');
  assert.match(notifier.sent[1].text, /Problem ze sprawdzaniem/);
  await monitor.checkWatch('ergo');
  assert.equal(notifier.sent.length, 2, 'no repeat within the hour');
  assert.equal(store.runtime.watches.ergo.consecutiveFailures, 4);

  stock.status = 200;
  await monitor.checkWatch('ergo');
  assert.match(notifier.sent[2].text, /znów działa/);
  assert.equal(store.runtime.watches.ergo.consecutiveFailures, 0);
});

test('short failure streaks stay quiet (alertAfterMinutes)', async () => {
  const { monitor, notifier, stock } = steamEnv({ health: { alertAfterFailures: 1, alertAfterMinutes: 5 } });
  await monitor.checkWatch('ergo');
  stock.status = 403;
  for (let i = 0; i < 4; i++) await monitor.checkWatch('ergo');
  stock.status = 200;
  await monitor.checkWatch('ergo');
  assert.equal(notifier.sent.length, 1, 'only the baseline message, no failure/recovery spam');
});

test('HTTP 429 backs the watch off exponentially', async () => {
  const { monitor, stock, store } = steamEnv();
  await monitor.checkWatch('ergo');
  stock.status = 429;
  const t0 = Date.now();
  await monitor.checkWatch('ergo');
  assert.equal(store.runtime.watches.ergo.rateLimitStreak, 1);
  assert.ok(monitor.nextDue.get('ergo') - t0 >= 89000, 'waits 2x the interval');
  await monitor.checkWatch('ergo');
  assert.ok(monitor.nextDue.get('ergo') - Date.now() >= 175000, 'then 4x');
  const results = await monitor.checkAll(null, { respectBackoff: true });
  assert.equal(results[0].result.skipped, true, 'manual "check all" does not poke a cooling-down store');
});

test('suspicious drops are ignored until confirmed, notification toggles are respected', async () => {
  let count = 10;
  const fetch = fakeFetch([
    [/products\.json/, () => ({
      products: Array.from({ length: count }, (_, i) => ({
        handle: `p${i}`, title: `P${i}`, variants: [{ id: i + 1, title: 'Default Title', available: true, price: '5.00' }]
      }))
    })]
  ]);
  const { monitor, notifier, store } = makeEnv(
    { requestDelayMs: 0, notifyOn: { removed: false }, watches: [{ id: 'shop', type: 'shopify', store: 'https://s.test', allProducts: true }] },
    { fetch }
  );
  await monitor.checkWatch('shop');
  count = 2;
  assert.equal((await monitor.checkWatch('shop')).ok, false);
  assert.equal((await monitor.checkWatch('shop')).ok, false);
  const accepted = await monitor.checkWatch('shop');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.changes.length, 8);
  assert.equal(accepted.notified, 0, 'removed items are not announced by default');
  assert.equal(notifier.sent.length, 1);
  assert.equal(store.runtime.history.length, 8);
});

test('old single-store state is migrated without a new baseline', async () => {
  const fetch = fakeFetch([
    [/products\.json/, () => ({
      products: [{ handle: 'r4', title: 'Cyberboard R4', variants: [{ id: 7, title: 'Red', available: true, price: '399.00' }] }]
    })]
  ]);
  const env = makeEnv(
    { requestDelayMs: 0, watches: [{ id: 'angrymiao', type: 'shopify', store: 'https://store.angrymiao.com', allProducts: true }] },
    { fetch }
  );
  mkdirSync(env.config.dataPath, { recursive: true });
  writeFileSync(
    join(env.config.dataPath, 'state.json'),
    JSON.stringify({
      meta: { schemaVersion: 2, store: 'https://store.angrymiao.com', allProducts: true, collections: ['cyberboard-collection'] },
      variants: {
        7: { productTitle: 'Cyberboard R4', productHandle: 'r4', variantTitle: 'Red', available: false, price: '399.00', url: 'u' }
      }
    })
  );
  const store = new Store(env.config.dataPath);
  assert.ok(store.legacyState);
  env.ctx.store = store;
  const migrated = migrateLegacyState(store, env.ctx.watches(), scopeFingerprint);
  assert.equal(migrated, 'angrymiao');
  const result = await env.monitor.checkWatch('angrymiao');
  assert.equal(result.baseline, undefined);
  assert.deepEqual(result.changes.map((c) => c.type), ['restock']);
});

test('mute and quiet hours make delivery silent', async () => {
  const { ctx, store } = steamEnv({ timezone: 'UTC', quietHours: { enabled: true, from: 22, to: 6 } });
  assert.equal(ctx.inQuietHours(new Date('2026-10-12T23:30:00Z')), true);
  assert.equal(ctx.inQuietHours(new Date('2026-10-12T12:00:00Z')), false);
  assert.equal(ctx.isSilentNow(new Date('2026-10-12T12:00:00Z')), false);
  store.settings.mutedUntil = new Date(Date.now() + 60000).toISOString();
  assert.equal(ctx.isSilentNow(new Date()), true);
  store.settings.mutedUntil = new Date(Date.now() - 1000).toISOString();
  assert.equal(ctx.mutedUntil(), null);
});
