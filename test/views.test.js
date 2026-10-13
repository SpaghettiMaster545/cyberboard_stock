import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/index.js';
import { searchView, watchView, nextInterval } from '../src/telegram/views.js';
import { formatChanges, itemLine } from '../src/format.js';

function envWithItems() {
  const env = makeEnv({
    watches: [{ id: 'am', type: 'shopify', name: 'Angry Miao', store: 'https://am.test', allProducts: true, note: 'Only with a Frame' }]
  });
  const item = (title, variant, available, group) => ({ title, variant, group, available, price: 10, currency: 'USD', url: `https://am.test/products/${group}` });
  env.store.state.watches.am = {
    fingerprint: 'x',
    items: {
      1: item('AFA R2 Accessories', 'FR4 Plate', true, 'afa'),
      2: item('CYBERBOARD R4', 'Red', false, 'r4'),
      3: item('CYBERBOARD R4', 'Blue', false, 'r4'),
      4: item('Deskmat', 'R4 size', true, 'mat')
    }
  };
  return env;
}

test('search ranks whole-word title matches first', () => {
  const { ctx } = envWithItems();
  const text = searchView(ctx, 'R4').text;
  const order = ['CYBERBOARD R4', 'AFA R2 Accessories', 'Deskmat'].map((s) => text.indexOf(s));
  assert.ok(order.every((i) => i > 0));
  assert.ok(order[0] < order[1] && order[0] < order[2], text);
  assert.match(searchView(ctx, 'zzz').text, /Nic nie znalazłem/);
});

test('watch view groups variants and shows the watch note', () => {
  const { ctx } = envWithItems();
  const { text, keyboard } = watchView(ctx, 'am', { filter: 'a' });
  assert.match(text, /ℹ️ Only with a Frame/);
  assert.match(text, /CYBERBOARD R4<\/a> · 10,00\sUSD\n\s+<i>\+2 niedostępne<\/i>/);
  assert.ok(keyboard.flat().some((b) => b.callback_data === 'wi:am:0:s'));
});

test('alerts: note on restocks, variant not repeated when it is part of the title', () => {
  const { ctx } = envWithItems();
  const watch = ctx.getWatch('am');
  const item = { title: 'AM INFINITY MOUSE', variant: 'INFINITY MOUSE', price: 129, currency: 'USD', url: 'u' };
  assert.equal(itemLine(item, 'en'), 'AM INFINITY MOUSE · $129.00');
  const [msg] = formatChanges(watch, [{ type: 'restock', item }], 'en');
  assert.match(msg, /BACK IN STOCK<\/b> · Angry Miao[\s\S]*ℹ️ Only with a Frame/);
  const [sold] = formatChanges(watch, [{ type: 'soldout', item }], 'en');
  assert.doesNotMatch(sold, /Only with a Frame/);
});

test('interval steps cycle and respect the minimum', () => {
  assert.equal(nextInterval(45, 15), 60);
  assert.equal(nextInterval(1800, 15), 30);
  assert.equal(nextInterval(50, 60), 60);
});

test('short variants are kept even when the title contains them', () => {
  assert.equal(itemLine({ title: 'Keyboard Red Edition', variant: 'Red' }, 'en'), 'Keyboard Red Edition — Red');
  assert.equal(itemLine({ title: 'AM HATSU', variant: 'AM HATSU' }, 'en'), 'AM HATSU');
});

test('durations never contain characters that break Telegram HTML', async () => {
  const { formatDuration } = await import('../src/util.js');
  assert.equal(formatDuration(400, 'pl'), '0,4 s');
  assert.equal(formatDuration(5, 'en'), '0.1s');
  assert.equal(formatDuration(125000, 'pl'), '2 min 5 s');
});
