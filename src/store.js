import { join } from 'node:path';
import { readJson, writeJson } from './util.js';

const STATE_VERSION = 3;
const RUNTIME_VERSION = 2;
const SETTINGS_VERSION = 1;
export const HISTORY_LIMIT = 200;

function defaultRuntime() {
  return {
    schemaVersion: RUNTIME_VERSION,
    lastHeartbeatAt: null,
    window: { changes: 0, failures: 0 },
    codeVersion: null,
    watches: {},
    history: []
  };
}

export function defaultHealth() {
  return {
    lastCheckAt: null,
    lastSuccessAt: null,
    lastDurationMs: null,
    totalChecks: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    failureStreakStartedAt: null,
    failureAlertSentAt: null,
    rateLimitStreak: 0,
    lastError: null,
    lastErrorAt: null,
    lastChangeAt: null,
    itemCount: 0,
    inStockCount: 0,
    groupCount: 0,
    groupsInStock: 0,
    suspicious: null
  };
}

function defaultSettings() {
  return {
    schemaVersion: SETTINGS_VERSION,
    language: null,
    notifyOn: {},
    quietHours: null,
    mutedUntil: null,
    dailyReport: null,
    watches: {},
    customWatches: []
  };
}

/**
 * Three small JSON files under data/:
 *   state.json    last seen items per watch (diff baseline, no timestamps)
 *   runtime.json  health counters + change history
 *   settings.json everything changed from Telegram (mute, toggles, added watches)
 */
export class Store {
  constructor(dataPath) {
    this.paths = {
      state: join(dataPath, 'state.json'),
      runtime: join(dataPath, 'runtime.json'),
      settings: join(dataPath, 'settings.json')
    };

    const state = readJson(this.paths.state, null);
    this.legacyState = null;
    if (state && state.schemaVersion === STATE_VERSION && state.watches) {
      this.state = state;
    } else {
      // v1/v2 files from the single-store bot: { meta, variants }.
      if (state && state.variants) this.legacyState = state;
      this.state = { schemaVersion: STATE_VERSION, watches: {} };
    }
    this._stateJson = JSON.stringify(this.state);

    const runtime = readJson(this.paths.runtime, null);
    this.runtime = defaultRuntime();
    if (runtime && runtime.schemaVersion === RUNTIME_VERSION) {
      Object.assign(this.runtime, runtime);
    } else if (runtime) {
      this.runtime.lastHeartbeatAt = runtime.lastHeartbeatAt || null;
    }
    for (const [id, h] of Object.entries(this.runtime.watches)) {
      this.runtime.watches[id] = { ...defaultHealth(), ...h };
    }

    this.settings = { ...defaultSettings(), ...readJson(this.paths.settings, {}) };
  }

  /** Only touches the disk when the items really changed (keeps git-tracked state quiet). */
  saveState() {
    const json = JSON.stringify(this.state);
    if (json === this._stateJson) return false;
    writeJson(this.paths.state, this.state);
    this._stateJson = json;
    return true;
  }

  saveRuntime() {
    writeJson(this.paths.runtime, this.runtime);
  }

  saveSettings() {
    writeJson(this.paths.settings, this.settings);
  }

  health(id) {
    if (!this.runtime.watches[id]) this.runtime.watches[id] = defaultHealth();
    return this.runtime.watches[id];
  }

  addHistory(entries) {
    this.runtime.history.unshift(...entries);
    if (this.runtime.history.length > HISTORY_LIMIT) {
      this.runtime.history.length = HISTORY_LIMIT;
    }
  }

  forgetWatch(id) {
    delete this.state.watches[id];
    delete this.runtime.watches[id];
    delete this.settings.watches[id];
    this.saveState();
    this.saveRuntime();
  }
}

/**
 * Carry the old single-store baseline over to the matching Shopify watch, so
 * upgrading neither re-announces everything nor misses a change in between.
 */
export function migrateLegacyState(store, watches, fingerprint) {
  const legacy = store.legacyState;
  if (!legacy || !legacy.meta) return null;
  const meta = legacy.meta;
  const match = watches.find(
    (w) =>
      w.type === 'shopify' &&
      !store.state.watches[w.id] &&
      w.store === String(meta.store || '').replace(/\/+$/, '') &&
      w.allProducts === !!meta.allProducts &&
      !w.products.length &&
      (w.allProducts ||
        JSON.stringify([...w.collections].sort()) === JSON.stringify([...(meta.collections || [])].sort()))
  );
  if (!match) return null;

  const items = {};
  for (const [id, v] of Object.entries(legacy.variants || {})) {
    const price = v.price != null ? Number(v.price) : null;
    items[id] = {
      title: v.productTitle,
      variant: v.variantTitle && v.variantTitle !== 'Default Title' ? v.variantTitle : null,
      group: v.productHandle,
      available: !!v.available,
      price: Number.isFinite(price) ? price : null,
      currency: match.currency,
      url: v.url
    };
  }
  store.state.watches[match.id] = { fingerprint: fingerprint(match), items };
  store.legacyState = null;
  store.saveState();
  return match.id;
}
