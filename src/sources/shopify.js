import { httpGet, sleep, cacheBust } from '../util.js';

/**
 * Shopify storefronts expose public JSON:
 *   /products.json                      whole catalogue (paginated)
 *   /collections/<handle>/products.json one collection
 *   /products/<handle>.js               one product (prices in cents)
 * Each variant carries an `available` boolean - that is the stock signal.
 */

function headers(ctx) {
  return {
    'User-Agent': ctx.config.userAgent,
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  };
}

async function fetchPaged(baseUrl, ctx) {
  const products = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}limit=250&page=${page}`;
    // Shopify page-caches products.json and varies on request headers, so a
    // unique query string is the only reliable way to read current stock.
    const data = await httpGet(cacheBust(url), { fetchImpl: ctx.fetch, headers: headers(ctx) });
    const batch = (data && data.products) || [];
    products.push(...batch);
    if (batch.length < 250) break;
    await sleep(ctx.config.requestDelayMs);
  }
  return products;
}

/** Fetch one product via `/products/<handle>.js` and reshape it like products.json. */
export async function fetchProduct(store, handle, ctx) {
  const p = await httpGet(cacheBust(`${store}/products/${encodeURIComponent(handle)}.js`), {
    fetchImpl: ctx.fetch,
    headers: headers(ctx)
  });
  if (!p || !Array.isArray(p.variants)) throw new Error(`Not a Shopify product: ${handle}`);
  return {
    handle: p.handle || handle,
    title: p.title,
    variants: p.variants.map((v) => ({
      id: v.id,
      title: v.title,
      available: !!v.available,
      // .js prices are integer cents, products.json uses "12.34" strings.
      price: typeof v.price === 'number' ? (v.price / 100).toFixed(2) : v.price
    }))
  };
}

function matchesFilters(title, include, exclude) {
  const t = String(title || '').toLowerCase();
  if (include.length && !include.some((k) => t.includes(k))) return false;
  if (exclude.some((k) => t.includes(k))) return false;
  return true;
}

export async function fetchShopify(watch, ctx) {
  const store = watch.store;
  const byHandle = new Map();

  if (watch.allProducts) {
    for (const p of await fetchPaged(`${store}/products.json`, ctx)) byHandle.set(p.handle, p);
  } else {
    for (const handle of watch.collections) {
      for (const p of await fetchPaged(`${store}/collections/${handle}/products.json`, ctx)) {
        byHandle.set(p.handle, p);
      }
      await sleep(ctx.config.requestDelayMs);
    }
  }
  for (const handle of watch.products) {
    if (byHandle.has(handle)) continue;
    byHandle.set(handle, await fetchProduct(store, handle, ctx));
    await sleep(ctx.config.requestDelayMs);
  }

  const include = (watch.include || []).map((s) => String(s).toLowerCase());
  const exclude = (watch.exclude || []).map((s) => String(s).toLowerCase());

  const items = [];
  for (const p of byHandle.values()) {
    if (!matchesFilters(p.title, include, exclude)) continue;
    for (const v of p.variants || []) {
      const price = v.price != null ? Number(v.price) : null;
      items.push({
        id: String(v.id),
        title: p.title,
        variant: v.title && v.title !== 'Default Title' ? v.title : null,
        group: p.handle,
        available: !!v.available,
        price: Number.isFinite(price) ? price : null,
        currency: watch.currency,
        url: `${store}/products/${p.handle}?variant=${v.id}`
      });
    }
  }
  return items;
}

/** The parts of a watch that define *what* is tracked (a change resets the baseline). */
export function shopifyScope(w) {
  return {
    type: 'shopify',
    store: w.store,
    allProducts: w.allProducts,
    collections: w.allProducts ? [] : [...w.collections].sort(),
    products: [...w.products].sort(),
    include: [...(w.include || [])].sort(),
    exclude: [...(w.exclude || [])].sort()
  };
}
