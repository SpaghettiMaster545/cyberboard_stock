import { fetchItems, scopeFingerprint } from './sources/index.js';
import { diffItems, summarizeItems, CHANGE_SETTING } from './diff.js';
import {
  formatChanges,
  formatBaseline,
  formatFailure,
  formatRecovery,
  formatDailyReport
} from './format.js';
import { t } from './i18n.js';
import { sleep } from './util.js';

const MAX_BACKOFF_MS = 15 * 60 * 1000;
const SUSPICIOUS_CONFIRMATIONS = 3;

function itemRecord(i) {
  const rec = {
    title: i.title,
    variant: i.variant || null,
    group: i.group || null,
    available: !!i.available,
    price: i.price != null ? Number(i.price) : null,
    currency: i.currency || null,
    url: i.url || null
  };
  if (i.highPendingOrders) rec.highPendingOrders = true;
  if (i.waitlist) rec.waitlist = true;
  return rec;
}

/**
 * Runs every enabled watch on its own interval, one check at a time, and turns
 * differences into Telegram alerts. Manual checks from Telegram go through the
 * same queue, so a watch is never checked twice in parallel.
 */
export class Monitor {
  constructor(ctx, notifier, push = null) {
    this.ctx = ctx;
    this.notifier = notifier;
    this.push = push;
    this.nextDue = new Map();
    this.queue = Promise.resolve();
    this.stopped = false;
    this.wakeup = null;
  }

  _serialize(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Check one watch now. Resolves to { ok, changes, summary, error, ... }. */
  checkWatch(id) {
    return this._serialize(() => this._check(id));
  }

  /**
   * Check several (default: all enabled) watches now, in order. With
   * respectBackoff, a watch that is cooling down after HTTP 429 is skipped
   * instead of provoking the store again.
   */
  async checkAll(ids = null, { respectBackoff = false } = {}) {
    const targets = this.ctx.watches().filter((w) => (ids ? ids.includes(w.id) : w.enabled));
    const results = [];
    for (const w of targets) {
      const h = this.ctx.store.runtime.watches[w.id];
      if (respectBackoff && h && h.rateLimitStreak > 0 && (this.nextDue.get(w.id) || 0) > Date.now()) {
        results.push({ watch: w, result: { ok: false, rateLimited: true, skipped: true, error: h.lastError } });
        continue;
      }
      results.push({ watch: w, result: await this.checkWatch(w.id) });
    }
    return results;
  }

  async _check(id) {
    const watch = this.ctx.getWatch(id);
    if (!watch) return { ok: false, error: `unknown watch ${id}` };
    const startedAt = Date.now();
    let result;
    try {
      result = await this._run(watch);
    } catch (err) {
      result = {
        ok: false,
        error: err.message || String(err),
        rateLimited: !!err.rateLimited,
        retryAfterSeconds: err.retryAfterSeconds || null
      };
    }
    result.durationMs = Date.now() - startedAt;
    await this._recordHealth(watch, result, startedAt);
    this._schedule(watch, result, startedAt);
    this._log(watch, result);
    return result;
  }

  async _run(watch) {
    const { ctx } = this;
    const { store } = ctx;
    const fetched = await fetchItems(watch, ctx);
    // Guard against false "everything sold out" alerts caused by an empty response.
    if (!fetched.length) throw new Error('No items returned - skipping to avoid false alerts');

    const items = {};
    for (const i of fetched) items[i.id] = itemRecord(i);
    const summary = summarizeItems(items);
    const fingerprint = scopeFingerprint(watch);
    const saved = store.state.watches[watch.id];

    if (!saved || saved.fingerprint !== fingerprint) {
      store.state.watches[watch.id] = { fingerprint, items };
      store.saveState();
      await this.notifier.notifySafely(
        formatBaseline(watch, items, summary, ctx.lang, !!saved),
        { silent: true }
      );
      return { ok: true, baseline: true, changes: [], summary };
    }

    this._guardSuspiciousDrop(watch, saved, fetched.length);

    const changes = diffItems(saved.items, items);
    const notifyOn = ctx.notifyOnFor(watch);
    const toSend = changes.filter((c) => notifyOn[CHANGE_SETTING[c.type]]);

    // Phone push first: it is best effort and de-duplicated, so a Telegram
    // outage (which makes the change be re-detected) never blocks it.
    if (this.push && changes.length) await this.push.notifyChanges(watch, changes);

    if (toSend.length) {
      // If Telegram is down this throws, the state is not saved and the same
      // change is detected (and sent) again on the next check.
      await this.sendChanges(watch, toSend);
    }

    saved.items = items;
    store.saveState();
    if (changes.length) {
      const at = new Date().toISOString();
      store.addHistory(
        changes.map((c) => ({
          at,
          watchId: watch.id,
          watchName: watch.name,
          type: c.type,
          title: c.item.title,
          variant: c.item.variant,
          price: c.item.price,
          oldPrice: c.oldPrice ?? null,
          currency: c.item.currency,
          url: c.item.url,
          notified: toSend.includes(c)
        }))
      );
    }
    return { ok: true, changes, notified: toSend.length, summary };
  }

  /**
   * A sudden big drop in item count usually means a broken/partial response.
   * Skip it - unless the same count shows up several checks in a row, in which
   * case the shop really did remove those items.
   */
  _guardSuspiciousDrop(watch, saved, count) {
    const health = this.ctx.store.health(watch.id);
    const previous = Object.keys(saved.items).length;
    if (previous < 5 || count >= Math.floor(previous * 0.6)) {
      health.suspicious = null;
      return;
    }
    const s = health.suspicious && health.suspicious.count === count ? health.suspicious : { count, seen: 0 };
    s.seen += 1;
    health.suspicious = s;
    if (s.seen < SUSPICIOUS_CONFIRMATIONS) {
      throw new Error(`Item count dropped from ${previous} to ${count}; treating the response as suspicious`);
    }
    health.suspicious = null;
  }

  async sendChanges(watch, changes) {
    const lang = this.ctx.lang;
    const silentTypes = new Set(this.ctx.config.silentTypes || []);
    const silent = changes.every((c) => silentTypes.has(CHANGE_SETTING[c.type]));
    const single = changes.length === 1 && changes[0].item.url && changes[0].type !== 'removed';
    const keyboard = single
      ? [[{ text: t(lang, 'open_store'), url: changes[0].item.url }]]
      : null;
    for (const text of formatChanges(watch, changes, lang)) {
      await this.notifier.broadcast(text, { silent, keyboard });
    }
  }

  async _recordHealth(watch, result, startedAt) {
    const { ctx } = this;
    const h = ctx.store.health(watch.id);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    h.lastCheckAt = new Date(startedAt).toISOString();
    h.lastDurationMs = result.durationMs;
    h.totalChecks += 1;

    if (result.ok) {
      const failures = h.consecutiveFailures;
      const alerted = !!h.failureAlertSentAt;
      const streakStartedAt = h.failureStreakStartedAt;
      h.consecutiveFailures = 0;
      h.failureStreakStartedAt = null;
      h.failureAlertSentAt = null;
      h.rateLimitStreak = 0;
      h.lastSuccessAt = nowIso;
      Object.assign(h, result.summary);
      if (result.changes && result.changes.length) {
        h.lastChangeAt = nowIso;
        ctx.store.runtime.window.changes += result.changes.length;
      }
      if (alerted) {
        await this.notifier.notifySafely(formatRecovery(watch, failures, streakStartedAt, ctx.lang, now));
      }
    } else {
      if (!h.consecutiveFailures) h.failureStreakStartedAt = nowIso;
      h.consecutiveFailures += 1;
      h.totalFailures += 1;
      h.lastError = result.error;
      h.lastErrorAt = nowIso;
      h.rateLimitStreak = result.rateLimited ? h.rateLimitStreak + 1 : 0;
      ctx.store.runtime.window.failures += 1;

      // Only alert on failures that persist; one-off hiccups (e.g. a single
      // HTTP 429) resolve themselves and would just be noise.
      const cfg = ctx.config.health;
      const streakMs = now - Date.parse(h.failureStreakStartedAt);
      const persistent =
        h.consecutiveFailures >= cfg.alertAfterFailures && streakMs >= cfg.alertAfterMinutes * 60000;
      const repeatDue =
        !h.failureAlertSentAt ||
        now - Date.parse(h.failureAlertSentAt) >= cfg.repeatErrorAlertMinutes * 60000;
      if (persistent && repeatDue) {
        const sent = await this.notifier.notifySafely(formatFailure(watch, h, ctx.lang, ctx.timezone, now));
        if (sent) h.failureAlertSentAt = nowIso;
      }
    }
    ctx.store.saveRuntime();
  }

  _schedule(watch, result, startedAt) {
    let delay = watch.intervalSeconds * 1000;
    if (!result.ok && result.rateLimited) {
      const streak = this.ctx.store.health(watch.id).rateLimitStreak;
      delay = Math.max(delay * Math.min(2 ** streak, 8), (result.retryAfterSeconds || 0) * 1000);
      delay = Math.min(delay, Math.max(MAX_BACKOFF_MS, watch.intervalSeconds * 1000));
    }
    this.nextDue.set(watch.id, startedAt + delay);
  }

  /** Make a watch due right away (or after its interval, if `soon` is false). */
  reschedule(id, { now = false } = {}) {
    if (now) {
      this.nextDue.set(id, 0);
    } else {
      const w = this.ctx.getWatch(id);
      const h = this.ctx.store.runtime.watches[id];
      if (w && h && h.lastCheckAt) this.nextDue.set(id, Date.parse(h.lastCheckAt) + w.intervalSeconds * 1000);
    }
    if (this.wakeup) this.wakeup();
  }

  forget(id) {
    this.nextDue.delete(id);
  }

  _log(watch, result) {
    const tag = `[${watch.id}]`;
    if (!result.ok) {
      const next = this.nextDue.get(watch.id);
      const wait = next ? Math.round((next - Date.now()) / 1000) : '?';
      console.error(`${tag} check failed: ${result.error} (retry in ${wait}s)`);
      return;
    }
    const s = result.summary;
    const scope = s.groupCount !== s.itemCount ? `${s.groupCount} products/${s.itemCount} items` : `${s.itemCount} items`;
    const what = result.baseline
      ? 'baseline saved'
      : result.changes.length
        ? `${result.changes.length} change(s): ${result.changes.map((c) => `${c.type} ${c.item.title}${c.item.variant ? ` (${c.item.variant})` : ''}`).slice(0, 5).join('; ')}`
        : 'no changes';
    console.log(`${tag} ok: ${scope}, ${s.inStockCount} in stock, ${what} (${result.durationMs}ms)`);
  }

  async _maybeDailyReport() {
    const { ctx } = this;
    const rt = ctx.store.runtime;
    const now = Date.now();
    if (!rt.lastHeartbeatAt) {
      rt.lastHeartbeatAt = new Date(now).toISOString();
      ctx.store.saveRuntime();
      return;
    }
    const intervalMs = ctx.config.health.statusIntervalHours * 3600 * 1000;
    if (now - Date.parse(rt.lastHeartbeatAt) < intervalMs) return;
    const sent = !ctx.dailyReport() || (await this.notifier.notifySafely(formatDailyReport(ctx, now), { silent: true }));
    if (sent) {
      rt.lastHeartbeatAt = new Date(now).toISOString();
      rt.window = { changes: 0, failures: 0 };
      ctx.store.saveRuntime();
    }
  }

  _idle(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wakeup = done;
    }).finally(() => {
      this.wakeup = null;
    });
  }

  /** Main loop for watch mode. Resolves after stop(). */
  async run() {
    // Spread the first checks out a little instead of firing everything at once.
    let offset = 0;
    for (const w of this.ctx.watches()) {
      if (!this.nextDue.has(w.id)) this.nextDue.set(w.id, Date.now() + offset);
      offset += 1500;
    }
    while (!this.stopped) {
      for (const w of this.ctx.watches()) {
        if (this.stopped) break;
        if (!w.enabled) continue;
        if ((this.nextDue.get(w.id) ?? 0) <= Date.now()) {
          await this.checkWatch(w.id);
          await sleep(200);
        }
      }
      if (this.stopped) break;
      try {
        await this._maybeDailyReport();
      } catch (err) {
        console.error(`Daily report failed: ${err.message}`);
      }
      await this._idle(1000);
    }
  }

  stop() {
    this.stopped = true;
    if (this.wakeup) this.wakeup();
  }
}
