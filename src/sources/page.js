import { httpGet, sleep } from '../util.js';

/**
 * Fallback for any shop: download the product page and decide availability by
 * text patterns, e.g. inStock "Add to cart" / outOfStock "Sold out|Notify me".
 * Patterns are case-insensitive regular expressions (or plain text).
 */

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

function toRegex(pattern) {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

/** Parse "1 299,00 zł" / "$1,299.00" / "1299" into a number. */
export function parsePrice(text) {
  if (!text) return null;
  let s = String(text).replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function evaluatePage(html, item) {
  const outMatch = item.outOfStock ? toRegex(item.outOfStock).test(html) : null;
  const inMatch = item.inStock ? toRegex(item.inStock).test(html) : null;
  let available;
  if (outMatch) available = false;
  else if (inMatch) available = true;
  else if (item.inStock && item.outOfStock) {
    throw new Error(`neither the in-stock nor the out-of-stock pattern matched ${item.url}`);
  } else available = item.inStock ? false : true;

  let price = null;
  if (item.price) {
    const m = html.match(toRegex(item.price));
    if (m) price = parsePrice(m[1] || m[0]);
  }
  return { available, price };
}

export async function fetchPage(watch, ctx) {
  const items = [];
  for (const item of watch.items) {
    const html = await httpGet(item.url, {
      fetchImpl: ctx.fetch,
      as: 'text',
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' }
    });
    const { available, price } = evaluatePage(html, item);
    items.push({
      id: item.id,
      title: item.name,
      variant: null,
      group: item.id,
      available,
      price,
      currency: item.currency,
      url: item.url
    });
    await sleep(ctx.config.requestDelayMs);
  }
  return items;
}

export function pageScope(w) {
  return {
    type: 'page',
    items: w.items.map((i) => ({ id: i.id, url: i.url, inStock: i.inStock, outOfStock: i.outOfStock }))
  };
}
