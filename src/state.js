import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync
} from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { config, rootDir } from './config.js';

function statePath() {
  return isAbsolute(config.statePath)
    ? config.statePath
    : join(rootDir, config.statePath);
}

export function loadState() {
  const p = statePath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`Could not read state file, treating as empty: ${err.message}`);
    return null;
  }
}

export function saveState(state) {
  const p = statePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function scopeMeta(store) {
  return {
    schemaVersion: 2,
    store,
    allProducts: !!config.watch.allProducts,
    collections: [...(config.watch.collections || [])].sort()
  };
}

export function isStateCompatible(savedState, store) {
  if (!savedState || !savedState.meta) return false;
  const current = scopeMeta(store);
  return JSON.stringify(savedState.meta) === JSON.stringify(current);
}

/**
 * Build a normalized, diff-friendly state from raw Shopify products.
 * Keyed by variant id. Intentionally contains no timestamps so the file only
 * changes when actual stock/price changes (keeps git history clean).
 */
export function buildState(products, store) {
  const variants = {};
  for (const p of products) {
    for (const v of p.variants || []) {
      variants[String(v.id)] = {
        productTitle: p.title,
        productHandle: p.handle,
        variantTitle: v.title,
        available: !!v.available,
        price: v.price != null ? String(v.price) : null,
        url: `${store}/products/${p.handle}?variant=${v.id}`
      };
    }
  }
  return {
    meta: scopeMeta(store),
    variants
  };
}
