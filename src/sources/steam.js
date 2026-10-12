import { httpGet, sleep, cacheBust } from '../util.js';

/**
 * Steam hardware (Steam Frame, Steam Deck, Steam Controller, ...) is sold as
 * "packages". The store page asks IStoreBrowseService/GetHardwareItems about
 * them and shows "Out of stock" when a package neither needs a reservation
 * (waitlist) nor has inventory - the same signal used here.
 * CheckInventoryAvailableByPackage is the older per-package fallback.
 */
const HARDWARE_URL = 'https://api.steampowered.com/IStoreBrowseService/GetHardwareItems/v1';
const INVENTORY_URL =
  'https://api.steampowered.com/IPhysicalGoodsService/CheckInventoryAvailableByPackage/v1';
const DETAILS_URL = 'https://store.steampowered.com/api/packagedetails';
const STORE_ORIGIN = 'https://store.steampowered.com';
const DETAILS_TTL_MS = 60 * 60 * 1000;

const detailsCache = new Map();

function headers(ctx) {
  return {
    'User-Agent': ctx.config.userAgent,
    Accept: 'application/json',
    Origin: STORE_ORIGIN
  };
}

/** Name + price of a package, cached for an hour. Never fails the check. */
export async function packageDetails(pkg, country, ctx) {
  const key = `${pkg}:${country}`;
  const cached = detailsCache.get(key);
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached;
  try {
    const data = await httpGet(`${DETAILS_URL}?packageids=${pkg}&cc=${country.toLowerCase()}`, {
      fetchImpl: ctx.fetch,
      headers: headers(ctx),
      retries: 0
    });
    const entry = data && data[pkg];
    if (!entry || !entry.success || !entry.data) throw new Error('no package data');
    const d = entry.data;
    const result = {
      at: Date.now(),
      name: String(d.name || '').trim() || null,
      price: d.price && Number.isFinite(d.price.final) ? d.price.final / 100 : null,
      currency: (d.price && d.price.currency) || null
    };
    detailsCache.set(key, result);
    return result;
  } catch (err) {
    if (cached) return cached;
    console.warn(`Steam package ${pkg}: details unavailable (${err.message})`);
    return { name: null, price: null, currency: null };
  }
}

export async function checkInventory(pkg, country, ctx) {
  const url =
    `${INVENTORY_URL}?origin=${encodeURIComponent(STORE_ORIGIN)}` +
    `&country_code=${encodeURIComponent(country)}&packageid=${pkg}`;
  const data = await httpGet(cacheBust(url), { fetchImpl: ctx.fetch, headers: headers(ctx) });
  const r = data && data.response;
  // An empty/odd response must never be read as "out of stock" (or "in stock").
  if (!r || typeof r.inventory_available !== 'boolean') {
    throw new Error(`Unexpected Steam inventory response for package ${pkg}: ${JSON.stringify(data).slice(0, 120)}`);
  }
  return { available: r.inventory_available, highPendingOrders: !!r.high_pending_orders };
}

/** Stock details for several packages in one request. */
export async function hardwareItems(packages, country, ctx) {
  const input = JSON.stringify({ packageid: packages, context: { language: 'english', country_code: country } });
  const url = `${HARDWARE_URL}?origin=${encodeURIComponent(STORE_ORIGIN)}&input_json=${encodeURIComponent(input)}`;
  const data = await httpGet(cacheBust(url), { fetchImpl: ctx.fetch, headers: headers(ctx) });
  const details = (data && data.response && data.response.details) || [];
  const byId = new Map(details.map((d) => [Number(d.packageid), d]));
  return packages.map((pkg) => {
    const d = byId.get(pkg);
    if (!d || typeof d.inventory_available !== 'boolean') {
      throw new Error(`Steam GetHardwareItems returned no stock data for package ${pkg}`);
    }
    return {
      available: d.inventory_available && d.allow_purchase_in_country !== false,
      highPendingOrders: !!d.high_pending_orders,
      waitlist: !!d.requires_reservation
    };
  });
}

export async function fetchSteam(watch, ctx) {
  let stock;
  try {
    stock = await hardwareItems(watch.packages, watch.country, ctx);
  } catch (err) {
    if (err.rateLimited) throw err;
    console.warn(`[${watch.id}] GetHardwareItems failed (${err.message}), using the per-package endpoint`);
    stock = [];
    for (const pkg of watch.packages) {
      stock.push(await checkInventory(pkg, watch.country, ctx));
      await sleep(150);
    }
  }

  const items = [];
  for (const [i, pkg] of watch.packages.entries()) {
    const det = await packageDetails(pkg, watch.country, ctx);
    const item = {
      id: String(pkg),
      title: det.name || `Steam package ${pkg}`,
      variant: null,
      group: String(pkg),
      available: stock[i].available,
      price: det.price,
      currency: det.currency,
      url: watch.url
    };
    if (stock[i].highPendingOrders) item.highPendingOrders = true;
    if (stock[i].waitlist) item.waitlist = true;
    items.push(item);
  }
  return items;
}

export function steamScope(w) {
  return { type: 'steam', country: w.country, packages: [...w.packages].sort((a, b) => a - b) };
}

/**
 * Read the purchasable packages off a Steam hardware page
 * (e.g. https://store.steampowered.com/hardware/steamframe).
 */
export async function discoverSteamPackages(pageUrl, ctx) {
  const html = await httpGet(pageUrl, {
    fetchImpl: ctx.fetch,
    as: 'text',
    timeoutMs: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }
  });
  const decoded = html.replace(/&quot;/g, '"').replace(/\\+"/g, '"');
  const ids = new Set();
  for (const m of decoded.matchAll(/"reservation_package":\s*(\d+)/g)) ids.add(Number(m[1]));
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1];
  return { title: title ? title.trim() : null, packages: [...ids] };
}
