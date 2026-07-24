import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

const defaults = {
  store: 'https://store.angrymiao.com',
  watch: { collections: ['cyberboard-collection'], allProducts: false },
  pollIntervalSeconds: 20,
  notifyOn: {
    restock: true,
    soldOut: true,
    newProduct: true,
    priceChange: false,
    removed: false
  },
  requestDelayMs: 400,
  userAgent:
    'AngryMiaoStockBot/1.0 (personal stock notifier; +https://github.com)',
  statePath: 'data/state.json'
};

function loadConfig() {
  const cfgPath = join(rootDir, 'config.json');
  let user = {};
  if (existsSync(cfgPath)) {
    try {
      user = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      console.error(`Invalid config.json, using defaults: ${err.message}`);
    }
  }
  return {
    ...defaults,
    ...user,
    watch: { ...defaults.watch, ...(user.watch || {}) },
    notifyOn: { ...defaults.notifyOn, ...(user.notifyOn || {}) }
  };
}

export const config = loadConfig();

export const secrets = {
  botToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  chatIds: (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
};
