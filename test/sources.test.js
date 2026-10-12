import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, makeConfig } from './helpers/index.js';
import { fetchItems, detectWatch, scopeFingerprint, DetectError } from '../src/sources/index.js';
import { evaluatePage, parsePrice } from '../src/sources/page.js';
import { normalizeWatch } from '../src/config.js';

const { json } = fakeFetch;

function shopifyProducts(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    handle: `p${offset + i}`,
    title: `Product ${offset + i}`,
    variants: [
      { id: (offset + i) * 10 + 1, title: 'Default Title', available: i % 2 === 0, price: '19.99' }
    ]
  }));
}

test('shopify: paginates products.json and normalizes variants', async () => {
  const config = makeConfig({ requestDelayMs: 0 });
  const fetch = fakeFetch([
    [/products\.json\?.*page=1/, () => ({ products: shopifyProducts(250) })],
    [/products\.json\?.*page=2/, () => ({ products: shopifyProducts(3, 250) })]
  ]);
  const watch = normalizeWatch({ id: 'shop', type: 'shopify', store: 'https://shop.test/', allProducts: true }, config);
  const items = await fetchItems(watch, { config, fetch });
  assert.equal(items.length, 253);
  assert.deepEqual(items[0], {
    id: '1',
    title: 'Product 0',
    variant: null,
    group: 'p0',
    available: true,
    price: 19.99,
    currency: 'USD',
    url: 'https://shop.test/products/p0?variant=1'
  });
  // every request carries a cache buster
  assert.ok(fetch.calls.every((u) => /_cb=\d+/.test(u)));
});

test('shopify: single products via .js (cents) plus include/exclude filters', async () => {
  const config = makeConfig({ requestDelayMs: 0 });
  const fetch = fakeFetch([
    [/collections\/keyboards\/products\.json/, () => ({
      products: [
        { handle: 'cyberboard-r4', title: 'Cyberboard R4', variants: [{ id: 1, title: 'Red', available: true, price: '399.00' }] },
        { handle: 'deskmat', title: 'Deskmat', variants: [{ id: 2, title: 'Default Title', available: true, price: '29.00' }] }
      ]
    })],
    [/products\/cyber-cable\.js/, () => ({
      handle: 'cyber-cable', title: 'Cyber Cable',
      variants: [{ id: 3, title: 'Black', available: false, price: 4900 }]
    })]
  ]);
  const watch = normalizeWatch(
    { id: 'am', type: 'shopify', store: 'https://am.test', collections: ['keyboards'], products: ['cyber-cable'], include: ['cyber'] },
    config
  );
  const items = await fetchItems(watch, { config, fetch });
  assert.deepEqual(items.map((i) => [i.title, i.variant, i.price, i.available]), [
    ['Cyberboard R4', 'Red', 399, true],
    ['Cyber Cable', 'Black', 49, false]
  ]);
});

test('shopify: HTTP 429 surfaces as a rate-limit error without retrying', async () => {
  const config = makeConfig({ requestDelayMs: 0 });
  const fetch = fakeFetch([[/products\.json/, () => json({}, 429, { 'retry-after': '30' })]]);
  const watch = normalizeWatch({ id: 'shop', type: 'shopify', store: 'https://shop.test', allProducts: true }, config);
  await assert.rejects(fetchItems(watch, { config, fetch }), (err) => err.rateLimited && err.retryAfterSeconds === 30);
  assert.equal(fetch.calls.length, 1);
});

test('steam: GetHardwareItems + package details become items', async () => {
  const config = makeConfig();
  const fetch = fakeFetch([
    [/GetHardwareItems/, (url) => {
      const input = JSON.parse(new URL(url).searchParams.get('input_json'));
      assert.deepEqual(input, { packageid: [1727363, 1629484], context: { language: 'english', country_code: 'PL' } });
      return {
        response: {
          details: [
            { packageid: 1629484, inventory_available: true, requires_reservation: true, allow_purchase_in_country: true },
            { packageid: 1727363, inventory_available: true, high_pending_orders: true, allow_purchase_in_country: true }
          ]
        }
      };
    }],
    [/packagedetails\?packageids=1629484/, () => ({ 1629484: { success: true, data: { name: 'Steam Frame 256GB Kit' } } })],
    [/packagedetails\?packageids=1727363&cc=pl/, () => ({
      1727363: { success: true, data: { name: 'Steam Frame Ergonomic Accessories Kit', price: { currency: 'PLN', final: 27900 } } }
    })]
  ]);
  const watch = normalizeWatch({ id: 'ergo', type: 'steam', packages: [1727363, 1629484], country: 'pl', url: 'https://store.steampowered.com/hardware/steamframe' }, config);
  const [item, frame] = await fetchItems(watch, { config, fetch });
  assert.deepEqual([frame.title, frame.available, frame.waitlist], ['Steam Frame 256GB Kit', true, true]);
  assert.deepEqual(item, {
    id: '1727363',
    title: 'Steam Frame Ergonomic Accessories Kit',
    variant: null,
    group: '1727363',
    available: true,
    price: 279,
    currency: 'PLN',
    url: 'https://store.steampowered.com/hardware/steamframe',
    highPendingOrders: true
  });
  assert.equal(fetch.calls.filter((u) => /GetHardwareItems|CheckInventory/.test(u)).length, 1, 'one stock request for all packages');
});

test('steam: falls back to CheckInventoryAvailableByPackage when GetHardwareItems fails', async () => {
  const config = makeConfig();
  const fetch = fakeFetch([
    [/GetHardwareItems/, () => json({}, 500)],
    [/CheckInventoryAvailableByPackage.*packageid=1727363/, () => ({ response: { inventory_available: true } })],
    [/packagedetails/, () => ({ 1727363: { success: true, data: { name: 'Ergo', price: { currency: 'PLN', final: 27900 } } } })]
  ]);
  const watch = normalizeWatch({ id: 'ergo2', type: 'steam', packages: [1727363], country: 'PL' }, config);
  const [item] = await fetchItems(watch, { config, fetch });
  assert.equal(item.available, true);
  assert.ok(fetch.calls.some((u) => u.includes('country_code=PL&packageid=1727363')));
});

test('steam: an odd inventory response is an error, never "sold out"', async () => {
  const config = makeConfig();
  const fetch = fakeFetch([
    [/GetHardwareItems/, () => ({ response: { details: [] } })],
    [/CheckInventoryAvailableByPackage/, () => ({ response: {} })],
    [/packagedetails/, () => ({})]
  ]);
  const watch = normalizeWatch({ id: 'x', type: 'steam', packages: [5] }, config);
  await assert.rejects(fetchItems(watch, { config, fetch }), /Unexpected Steam inventory response/);
});

test('steam: missing package details fall back to a generic name', async () => {
  const config = makeConfig();
  const fetch = fakeFetch([
    [/GetHardwareItems/, () => ({ response: { details: [{ packageid: 987654, inventory_available: false }] } })],
    [/packagedetails/, () => json({}, 500)]
  ]);
  const watch = normalizeWatch({ id: 'x', type: 'steam', packages: [987654] }, config);
  const [item] = await fetchItems(watch, { config, fetch });
  assert.equal(item.title, 'Steam package 987654');
  assert.equal(item.available, false);
});

test('page: availability from text patterns and price extraction', () => {
  const html = '<h1>Widget</h1><span class="price">1 299,00 zł</span><button>Dodaj do koszyka</button>';
  assert.deepEqual(evaluatePage(html, { url: 'u', inStock: 'dodaj do koszyka', outOfStock: 'niedostępny', price: 'class="price">([^<]+)<' }), {
    available: true,
    price: 1299
  });
  assert.equal(evaluatePage('Sold out', { url: 'u', inStock: 'add to cart', outOfStock: 'sold out' }).available, false);
  assert.equal(evaluatePage('nothing', { url: 'u', outOfStock: 'sold out' }).available, true);
  assert.throws(() => evaluatePage('nothing', { url: 'u', inStock: 'a+b', outOfStock: 'sold out' }), /neither/);
  assert.equal(parsePrice('$1,299.50'), 1299.5);
  assert.equal(parsePrice('279,00 zł'), 279);
});

test('detectWatch: steam package ids, steam /sub/ links and Shopify links', async () => {
  const config = makeConfig();
  const fetch = fakeFetch([
    [/am\.test\/products\/cyberboard-r4\.js/, () => ({ handle: 'cyberboard-r4', title: 'Cyberboard R4', variants: [] })],
    [/am\.test\/collections\/keyboards\/products\.json/, () => ({ products: [] })],
    [/shop\.test\/products\.json/, () => ({ products: [] })],
    [/store\.steampowered\.com\/hardware\/steamframe/, () =>
      new Response('<title>Steam Frame</title><div data-x="{&quot;reservation_package&quot;:1629484},{\\&quot;reservation_package\\&quot;:1727363}"></div>')]
  ]);
  const c = { config, fetch };
  assert.deepEqual(await detectWatch('steam 1727363, 1727366 de', c), {
    type: 'steam', name: 'Steam 1727363, 1727366', packages: [1727363, 1727366], country: 'DE'
  });
  assert.deepEqual((await detectWatch('https://store.steampowered.com/sub/1727363/', c)).packages, [1727363]);
  const frame = await detectWatch('https://store.steampowered.com/hardware/steamframe?utm=x', c);
  assert.deepEqual([frame.name, frame.packages], ['Steam Frame', [1629484, 1727363]]);
  const product = await detectWatch('am.test/products/cyberboard-r4?variant=1', c);
  assert.deepEqual([product.type, product.name, product.products], ['shopify', 'Cyberboard R4', ['cyberboard-r4']]);
  const collection = await detectWatch('https://am.test/collections/keyboards', c);
  assert.deepEqual(collection.collections, ['keyboards']);
  const store = await detectWatch('https://shop.test/', c);
  assert.equal(store.allProducts, true);
  await assert.rejects(detectWatch('https://example.org/item', c), (e) => e instanceof DetectError && e.key === 'add_unsupported');
});

test('scope fingerprint ignores cosmetic fields but tracks scope', () => {
  const config = makeConfig();
  const a = normalizeWatch({ id: 'a', type: 'steam', packages: [2, 1], name: 'A', intervalSeconds: 30 }, config);
  const b = normalizeWatch({ id: 'b', type: 'steam', packages: [1, 2], name: 'B', intervalSeconds: 90 }, config);
  const c2 = normalizeWatch({ id: 'c', type: 'steam', packages: [1, 2, 3] }, config);
  assert.equal(scopeFingerprint(a), scopeFingerprint(b));
  assert.notEqual(scopeFingerprint(a), scopeFingerprint(c2));
});
