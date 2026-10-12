import { normalizeWatch } from './config.js';
import { LANGUAGES } from './i18n.js';
import { hourIn } from './util.js';

/**
 * Everything the monitor and the Telegram bot share: static config, secrets,
 * persisted store, and helpers that layer Telegram-made settings over config.json.
 */
export function createContext({ config, secrets, store, fetchImpl, version = 'dev' }) {
  const ctx = {
    config,
    secrets,
    store,
    version,
    fetch: fetchImpl || globalThis.fetch,
    startedAt: Date.now(),

    get lang() {
      const l = store.settings.language || config.language;
      return LANGUAGES.includes(l) ? l : 'en';
    },

    get timezone() {
      return config.timezone;
    },

    /** Config + custom watches, with pause/interval overrides from settings applied. */
    watches() {
      const custom = [];
      for (const raw of store.settings.customWatches || []) {
        try {
          custom.push({ ...normalizeWatch(raw, config), custom: true });
        } catch (err) {
          console.error(`Ignoring invalid custom watch: ${err.message}`);
        }
      }
      const configIds = new Set(config.watches.map((w) => w.id));
      return [...config.watches, ...custom.filter((w) => !configIds.has(w.id))].map((w) => {
        const o = store.settings.watches[w.id] || {};
        return {
          ...w,
          enabled: o.enabled !== undefined ? o.enabled : w.enabled,
          intervalSeconds: o.intervalSeconds
            ? Math.max(config.minIntervalSeconds, o.intervalSeconds)
            : w.intervalSeconds
        };
      });
    },

    getWatch(id) {
      return ctx.watches().find((w) => w.id === id) || null;
    },

    /** Telegram toggles win over a watch's own notifyOn, which wins over the global config. */
    notifyOnFor(watch) {
      return { ...config.notifyOn, ...(watch && watch.notifyOn), ...store.settings.notifyOn };
    },

    notifyOn() {
      return { ...config.notifyOn, ...store.settings.notifyOn };
    },

    quietHours() {
      return { ...config.quietHours, ...(store.settings.quietHours || {}) };
    },

    dailyReport() {
      return store.settings.dailyReport != null ? store.settings.dailyReport : config.health.dailyReport;
    },

    /** null, an ISO timestamp, or 'forever'. Expired mutes read as null. */
    mutedUntil(now = Date.now()) {
      const m = store.settings.mutedUntil;
      if (!m) return null;
      if (m === 'forever') return m;
      return Date.parse(m) > now ? m : null;
    },

    inQuietHours(now = new Date()) {
      const q = ctx.quietHours();
      if (!q.enabled || q.from === q.to) return false;
      const h = hourIn(config.timezone, now);
      return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
    },

    /** Alerts are still delivered when muted, just without sound. */
    isSilentNow(now = new Date()) {
      return !!ctx.mutedUntil(now.getTime()) || ctx.inQuietHours(now);
    }
  };
  return ctx;
}
