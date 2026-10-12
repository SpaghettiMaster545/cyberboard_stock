import { fetchShopify, shopifyScope, fetchProduct } from './shopify.js';
import { fetchSteam, steamScope, discoverSteamPackages } from './steam.js';
import { fetchPage, pageScope } from './page.js';
import { httpGet } from '../util.js';

const registry = {
  shopify: { fetch: fetchShopify, scope: shopifyScope },
  steam: { fetch: fetchSteam, scope: steamScope },
  page: { fetch: fetchPage, scope: pageScope }
};

/** Fetch the current items of a watch: [{ id, title, variant, group, available, price, currency, url }] */
export function fetchItems(watch, ctx) {
  return registry[watch.type].fetch(watch, ctx);
}

/** Stable string describing what a watch tracks; a different value resets its baseline. */
export function scopeFingerprint(watch) {
  return JSON.stringify(registry[watch.type].scope(watch));
}

export class DetectError extends Error {
  constructor(key, params = {}) {
    super(key);
    this.key = key;
    this.params = params;
  }
}

/**
 * Turn what a user pasted into Telegram (a product/collection/store URL, a
 * Steam hardware page, or "steam <package ids> [country]") into a watch definition.
 */
export async function detectWatch(input, ctx) {
  const text = String(input || '').trim();
  if (!text) throw new DetectError('add_usage');

  const steamArgs = text.match(/^steam[:\s]+([\d,\s]+)\s*([a-z]{2})?$/i);
  if (steamArgs) {
    const packages = steamArgs[1].split(/[,\s]+/).map(Number).filter((n) => n > 0);
    if (!packages.length) throw new DetectError('add_usage');
    return {
      type: 'steam',
      name: `Steam ${packages.join(', ')}`,
      packages,
      country: (steamArgs[2] || ctx.config.steamCountry).toUpperCase()
    };
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new DetectError('add_bad_url');
  }
  const origin = url.origin;

  if (url.hostname === 'store.steampowered.com') {
    const sub = url.pathname.match(/^\/sub\/(\d+)/);
    if (sub) {
      return { type: 'steam', name: `Steam ${sub[1]}`, packages: [Number(sub[1])], url: `${origin}${url.pathname}` };
    }
    const found = await discoverSteamPackages(`${origin}${url.pathname}`, ctx);
    if (!found.packages.length) throw new DetectError('add_steam_none');
    return {
      type: 'steam',
      name: found.title || 'Steam',
      packages: found.packages,
      url: `${origin}${url.pathname}`
    };
  }

  const jsonGet = (u) => httpGet(u, { fetchImpl: ctx.fetch, headers: { 'User-Agent': ctx.config.userAgent }, retries: 0 });

  const product = url.pathname.match(/\/products\/([^/?#]+)/);
  if (product) {
    const handle = decodeURIComponent(product[1]);
    try {
      const p = await fetchProduct(origin, handle, ctx);
      return { type: 'shopify', name: p.title, store: origin, products: [p.handle], url: `${origin}/products/${p.handle}` };
    } catch (err) {
      if (err.rateLimited) throw new DetectError('add_rate_limited');
    }
  }

  const collection = url.pathname.match(/\/collections\/([^/?#]+)/);
  if (collection && collection[1] !== 'all') {
    const handle = decodeURIComponent(collection[1]);
    try {
      const data = await jsonGet(`${origin}/collections/${handle}/products.json?limit=1`);
      if (data && Array.isArray(data.products)) {
        return {
          type: 'shopify',
          name: `${url.hostname.replace(/^www\./, '')} / ${handle}`,
          store: origin,
          collections: [handle],
          url: `${origin}/collections/${handle}`
        };
      }
    } catch (err) {
      if (err.rateLimited) throw new DetectError('add_rate_limited');
    }
  }

  try {
    const data = await jsonGet(`${origin}/products.json?limit=1`);
    if (data && Array.isArray(data.products)) {
      return { type: 'shopify', name: url.hostname.replace(/^www\./, ''), store: origin, allProducts: true };
    }
  } catch (err) {
    if (err.rateLimited) throw new DetectError('add_rate_limited');
  }

  throw new DetectError('add_unsupported', { host: url.hostname });
}
