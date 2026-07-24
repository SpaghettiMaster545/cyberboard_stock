import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cbCounter = 0;

/**
 * Append a unique cache-busting query param.
 *
 * Shopify page-caches products.json and varies the cache on request headers
 * (`Vary: Accept, accept-encoding`), so different clients can receive stale
 * copies with outdated `available` flags. A unique query string forces a fresh
 * origin render every time, so we always read true, current stock.
 */
function bust(url) {
  const sep = url.includes('?') ? '&' : '?';
  cbCounter += 1;
  return `${url}${sep}_cb=${Date.now()}${cbCounter}`;
}

async function fetchJson(url, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(bust(url), {
        headers: {
          'User-Agent': config.userAgent,
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(600 * attempt);
    }
  }
  throw lastErr;
}

/**
 * Fetch every product from a Shopify products.json base URL, following pagination.
 */
async function fetchPaged(baseUrl) {
  const products = [];
  for (let page = 1; page <= 100; page++) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}limit=250&page=${page}`;
    const data = await fetchJson(url);
    const batch = (data && data.products) || [];
    products.push(...batch);
    if (batch.length < 250) break;
    await sleep(config.requestDelayMs);
  }
  return products;
}

/**
 * Fetch all products the user asked to watch (whole store or specific collections),
 * de-duplicated by product handle.
 *
 * @returns {Promise<Array>} list of Shopify product objects
 */
export async function fetchAllWatched() {
  const store = config.store.replace(/\/$/, '');
  const sources = [];

  if (config.watch.allProducts) {
    sources.push(`${store}/products.json`);
  } else {
    for (const handle of config.watch.collections || []) {
      sources.push(`${store}/collections/${handle}/products.json`);
    }
  }

  if (sources.length === 0) {
    throw new Error(
      'Nothing to watch. Set watch.allProducts=true or add collection handles in config.json.'
    );
  }

  const byHandle = new Map();
  for (const src of sources) {
    const products = await fetchPaged(src);
    for (const p of products) byHandle.set(p.handle, p);
    await sleep(config.requestDelayMs);
  }
  return [...byHandle.values()];
}
