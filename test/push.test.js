import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, makeEnv } from './helpers/index.js';

const { json } = fakeFetch;

function pushEnv({ ntfyStatus = 200, telegramFails = false } = {}) {
  const stock = { available: false };
  const fetch = fakeFetch([
    [/GetHardwareItems/, () => ({ response: { details: [{ packageid: 1727363, inventory_available: stock.available }] } })],
    [/packagedetails/, () => ({ 1727363: { success: true, data: { name: 'Steam Frame Ergonomic Accessories Kit', price: { currency: 'PLN', final: 27900 } } } })],
    [/^https:\/\/ntfy\.sh\/$/, () => json({ id: 'abc' }, ntfyStatus)]
  ]);
  const env = makeEnv(
    {
      watches: [{
        id: 'ergo', type: 'steam', name: 'Steam Frame – Ergonomic Kit', packages: [1727363],
        url: 'https://store.steampowered.com/hardware/steamframe', note: 'Tylko razem ze Steam Frame'
      }]
    },
    { fetch, push: true }
  );
  env.store.settings.push = { enabled: true, topic: 'stockbot-test123' };
  env.notifier.fail = telegramFails;
  const pushes = () => fetch.requests.filter((r) => r.url === 'https://ntfy.sh/');
  return { ...env, stock, fetch, pushes };
}

test('a restock becomes a max-priority push with a store button', async () => {
  const { monitor, stock, pushes } = pushEnv();
  await monitor.checkWatch('ergo');
  assert.equal(pushes().length, 0, 'baseline is not pushed');
  stock.available = true;
  await monitor.checkWatch('ergo');
  assert.equal(pushes().length, 1);
  const { body, method } = pushes()[0];
  assert.equal(method, 'POST');
  assert.equal(body.topic, 'stockbot-test123');
  assert.equal(body.title, 'Dostępne: Steam Frame Ergonomic Accessories Kit');
  assert.match(body.message, /279,00\szł\nSteam Frame – Ergonomic Kit\nTylko razem ze Steam Frame/);
  assert.equal(body.priority, 5);
  assert.deepEqual(body.tags, ['green_circle']);
  assert.equal(body.click, 'https://store.steampowered.com/hardware/steamframe');
  assert.deepEqual(body.actions, [{ action: 'view', label: 'Otwórz sklep', url: body.click, clear: true }]);

  stock.available = false;
  await monitor.checkWatch('ergo');
  assert.equal(pushes().length, 1, 'sell-outs are not pushed');
});

test('push still goes out when Telegram is down, and only once', async () => {
  const { monitor, stock, pushes, notifier } = pushEnv({ telegramFails: false });
  await monitor.checkWatch('ergo');
  notifier.fail = true;
  stock.available = true;
  assert.equal((await monitor.checkWatch('ergo')).ok, false);
  assert.equal((await monitor.checkWatch('ergo')).ok, false);
  assert.equal(pushes().length, 1, 're-detected change is not pushed again');
  notifier.fail = false;
  await monitor.checkWatch('ergo');
  assert.equal(pushes().length, 1);
  assert.match(notifier.sent.at(-1).text, /DOSTĘPNE!/);
});

test('no push when disabled globally or for the watch; ntfy errors never break the check', async () => {
  const env = pushEnv();
  await env.monitor.checkWatch('ergo');
  env.store.settings.push.enabled = false;
  env.stock.available = true;
  await env.monitor.checkWatch('ergo');
  assert.equal(env.pushes().length, 0);

  const env2 = pushEnv({ ntfyStatus: 500 });
  await env2.monitor.checkWatch('ergo');
  env2.store.settings.watches.ergo = { push: false };
  env2.stock.available = true;
  await env2.monitor.checkWatch('ergo');
  assert.equal(env2.pushes().length, 0);
  env2.store.settings.watches.ergo.push = true;
  env2.stock.available = false;
  await env2.monitor.checkWatch('ergo');
  env2.stock.available = true;
  const result = await env2.monitor.checkWatch('ergo');
  assert.equal(result.ok, true, 'a failing ntfy server does not fail the check');
  assert.equal(env2.pushes().length, 3, 'tried 3 times');
});

test('many restocks are summarized in one push; NTFY_TOPIC from env wins', async () => {
  const fetch = fakeFetch([[/ntfy\.example/, () => ({ id: 'x' })]]);
  const { push, ctx } = makeEnv({ watches: [] }, { fetch, push: true, secrets: { ntfyTopic: 'env-topic', ntfyServer: 'https://ntfy.example/', ntfyToken: 'tk' } });
  assert.equal(push.enabled, true);
  const watch = { id: 'am', name: 'Angry Miao', url: 'https://am.test' };
  const changes = Array.from({ length: 12 }, (_, i) => ({
    type: 'restock', id: String(i), item: { title: `P${i}`, variant: 'Red', price: 10, currency: 'USD', url: `u${i}` }
  }));
  assert.equal(await push.notifyChanges(watch, changes), 1);
  const [req] = fetch.requests;
  assert.equal(req.url, 'https://ntfy.example/');
  assert.equal(req.headers.Authorization, 'Bearer tk');
  assert.equal(req.body.topic, 'env-topic');
  assert.equal(req.body.title, 'Zmiany w Angry Miao (12)');
  assert.match(req.body.message, /^• P0 — Red · 10,00\sUSD/);
  assert.match(req.body.message, /…\+2$/);
  assert.equal(ctx.pushEnabledFor(watch), true);
});
