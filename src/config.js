import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootDir = join(__dirname, '..');

/**
 * Minimal .env loader (no dependency). Real environment variables always win,
 * so GitHub Actions secrets override any local .env file.
 */
function loadEnv() {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

export const NOTIFY_TYPES = ['restock', 'soldOut', 'newProduct', 'priceChange', 'removed'];

const defaults = {
  language: 'pl',
  timezone: 'Europe/Warsaw',
  defaultIntervalSeconds: 60,
  minIntervalSeconds: 15,
  steamCountry: 'PL',
  notifyOn: {
    restock: true,
    soldOut: true,
    newProduct: true,
    priceChange: false,
    removed: false
  },
  // Alert types delivered without sound (restocks always ring).
  silentTypes: ['soldOut', 'priceChange', 'removed'],
  quietHours: { enabled: false, from: 23, to: 8 },
  health: {
    dailyReport: true,
    statusIntervalHours: 24,
    alertAfterFailures: 3,
    alertAfterMinutes: 5,
    repeatErrorAlertMinutes: 60
  },
  requestDelayMs: 400,
  userAgent: 'StockBot/2.0 (personal stock notifier)',
  dataDir: 'data',
  watches: []
};

/**
 * The original bot had a single Shopify store at the top level
 * (`store` + `watch`). Convert that shape into one entry of `watches`.
 */
function legacyWatch(user) {
  if (!user.store) return null;
  return {
    id: 'angrymiao',
    type: 'shopify',
    name: 'Angry Miao',
    store: user.store,
    allProducts: !!(user.watch && user.watch.allProducts),
    collections: (user.watch && user.watch.collections) || [],
    intervalSeconds: user.pollIntervalSeconds
  };
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

/** Validate and fill in a watch definition. Throws on unusable definitions. */
export function normalizeWatch(raw, cfg) {
  if (!raw || typeof raw !== 'object') throw new Error('watch must be an object');
  const w = { ...raw };
  if (!w.id || !ID_RE.test(w.id)) {
    throw new Error(
      `watch id "${w.id}" is invalid (use 1-24 chars: lowercase letters, digits, dashes)`
    );
  }
  if (!['shopify', 'steam', 'page'].includes(w.type)) {
    throw new Error(`watch "${w.id}": unknown type "${w.type}" (shopify | steam | page)`);
  }
  w.name = w.name || w.id;
  w.enabled = w.enabled !== false;
  const interval = Number(w.intervalSeconds) || cfg.defaultIntervalSeconds;
  w.intervalSeconds = Math.max(cfg.minIntervalSeconds, Math.round(interval));

  if (w.type === 'shopify') {
    if (!w.store) throw new Error(`watch "${w.id}": "store" URL is required`);
    w.store = String(w.store).replace(/\/+$/, '');
    w.allProducts = !!w.allProducts;
    w.collections = Array.isArray(w.collections) ? w.collections : [];
    w.products = Array.isArray(w.products) ? w.products : [];
    if (!w.allProducts && !w.collections.length && !w.products.length) {
      throw new Error(`watch "${w.id}": set allProducts, collections or products`);
    }
    w.currency = w.currency || 'USD';
    w.url = w.url || w.store;
  } else if (w.type === 'steam') {
    w.packages = (Array.isArray(w.packages) ? w.packages : [w.packages])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    if (!w.packages.length) throw new Error(`watch "${w.id}": "packages" must list Steam package ids`);
    w.country = String(w.country || cfg.steamCountry).toUpperCase();
    w.url = w.url || `https://store.steampowered.com/sub/${w.packages[0]}`;
  } else if (w.type === 'page') {
    const items = Array.isArray(w.items) && w.items.length ? w.items : [w];
    w.items = items.map((it, i) => {
      if (!it.url) throw new Error(`watch "${w.id}": page item ${i + 1} needs a "url"`);
      if (!it.inStock && !it.outOfStock) {
        throw new Error(`watch "${w.id}": page item ${i + 1} needs "inStock" and/or "outOfStock" pattern`);
      }
      return {
        id: String(it.id || (items.length === 1 ? 'item' : `item${i + 1}`)),
        name: it.name || w.name,
        url: it.url,
        inStock: it.inStock || null,
        outOfStock: it.outOfStock || null,
        price: it.price || null,
        currency: it.currency || w.currency || null
      };
    });
    w.url = w.url || w.items[0].url;
  }
  return w;
}

export function loadConfig(cfgPath = join(rootDir, 'config.json')) {
  let user = {};
  if (existsSync(cfgPath)) {
    try {
      user = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      console.error(`Invalid config.json, using defaults: ${err.message}`);
    }
  }

  const cfg = {
    ...defaults,
    ...user,
    notifyOn: { ...defaults.notifyOn, ...(user.notifyOn || {}) },
    quietHours: { ...defaults.quietHours, ...(user.quietHours || {}) },
    health: { ...defaults.health, ...(user.health || {}) }
  };
  delete cfg.store;
  delete cfg.watch;

  const rawWatches = Array.isArray(user.watches) ? user.watches : [];
  const legacy = !rawWatches.length && legacyWatch(user);
  if (legacy) rawWatches.push(legacy);

  cfg.watches = [];
  const seen = new Set();
  for (const raw of rawWatches) {
    try {
      const w = normalizeWatch(raw, cfg);
      if (seen.has(w.id)) throw new Error(`duplicate watch id "${w.id}"`);
      seen.add(w.id);
      cfg.watches.push(w);
    } catch (err) {
      console.error(`config.json: skipping watch - ${err.message}`);
    }
  }

  cfg.dataPath = isAbsolute(cfg.dataDir) ? cfg.dataDir : join(rootDir, cfg.dataDir);
  return cfg;
}

export const config = loadConfig();

export const secrets = {
  botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  chatIds: (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Lets tests point the bot at a fake Telegram server.
  telegramApiBase: (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '')
};
