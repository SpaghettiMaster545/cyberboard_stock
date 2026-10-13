import { randomBytes } from 'node:crypto';
import { t } from './i18n.js';
import { itemPrice } from './format.js';
import { sleep } from './util.js';

/**
 * Phone push notifications through ntfy (https://ntfy.sh): a free app for
 * Android/iOS, no account needed. The bot publishes to a random "topic"; the
 * phone subscribes to the same topic in the ntfy app. Used for the alerts that
 * matter (restocks), separately from the Telegram chat.
 */

const DEDUPE_MS = 30 * 60 * 1000;
export const PUSH_TYPES = ['restock', 'new'];

export function newTopic() {
  return `stockbot-${randomBytes(8).toString('hex')}`;
}

export class PushNotifier {
  constructor(ctx) {
    this.ctx = ctx;
    this.recent = new Map();
  }

  get settings() {
    if (!this.ctx.store.settings.push) this.ctx.store.settings.push = {};
    return this.ctx.store.settings.push;
  }

  get server() {
    return (this.ctx.secrets.ntfyServer || 'https://ntfy.sh').replace(/\/+$/, '');
  }

  /** A topic from NTFY_TOPIC wins over the one generated from Telegram. */
  get topic() {
    return this.ctx.secrets.ntfyTopic || this.settings.topic || null;
  }

  get topicFromEnv() {
    return !!this.ctx.secrets.ntfyTopic;
  }

  get enabled() {
    return !!this.topic && (this.topicFromEnv ? this.settings.enabled !== false : !!this.settings.enabled);
  }

  get types() {
    const types = this.settings.types;
    return Array.isArray(types) && types.length ? types : ['restock'];
  }

  get subscribeUrl() {
    return this.topic ? `${this.server}/${this.topic}` : null;
  }

  async publish({ title, message, priority = 4, tags = [], click = null }) {
    if (!this.topic) throw new Error('push topic not set');
    const body = { topic: this.topic, title, message, priority, tags };
    if (click) {
      body.click = click;
      body.actions = [{ action: 'view', label: t(this.ctx.lang, 'push_open'), url: click, clear: true }];
    }
    const headers = { 'Content-Type': 'application/json' };
    if (this.ctx.secrets.ntfyToken) headers.Authorization = `Bearer ${this.ctx.secrets.ntfyToken}`;

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.ctx.fetch(`${this.server}/`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000)
        });
        if (res.ok) return;
        lastErr = new Error(`ntfy HTTP ${res.status}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastErr = err;
      }
      await sleep(1000 * (attempt + 1));
    }
    throw lastErr;
  }

  async sendTest() {
    const lang = this.ctx.lang;
    await this.publish({ title: t(lang, 'push_test_title'), message: t(lang, 'push_test_body'), priority: 4, tags: ['white_check_mark'] });
  }

  /**
   * Push the changes the phone should know about (restocks, optionally new
   * products). Best effort: never throws, and the same change is not pushed
   * twice within half an hour (e.g. when a Telegram outage makes the monitor
   * re-detect it).
   */
  async notifyChanges(watch, changes) {
    if (!this.enabled || !this.ctx.pushEnabledFor(watch)) return 0;
    const now = Date.now();
    for (const [key, at] of this.recent) if (now - at > DEDUPE_MS) this.recent.delete(key);

    const types = new Set(this.types);
    const relevant = changes.filter((c) => types.has(c.type) && !this.recent.has(`${watch.id}:${c.id}:${c.type}`));
    if (!relevant.length) return 0;

    const lang = this.ctx.lang;
    const line = (c) => [c.item.variant, itemPrice(c.item, lang)].filter(Boolean).join(' · ');
    const messages =
      relevant.length <= 3
        ? relevant.map((c) => ({
            title: `${t(lang, c.type === 'restock' ? 'push_restock' : 'push_new')}: ${c.item.title}`,
            message: [line(c), watch.name, c.type === 'restock' ? watch.note : null].filter(Boolean).join('\n'),
            priority: c.type === 'restock' ? 5 : 3,
            tags: [c.type === 'restock' ? 'green_circle' : 'new'],
            click: c.item.url
          }))
        : [
            {
              title: t(lang, 'push_many', { count: relevant.length, name: watch.name }),
              message: relevant
                .slice(0, 10)
                .map((c) => `• ${c.item.title}${line(c) ? ` — ${line(c)}` : ''}`)
                .concat(relevant.length > 10 ? [`…+${relevant.length - 10}`] : [])
                .join('\n'),
              priority: relevant.some((c) => c.type === 'restock') ? 5 : 3,
              tags: ['green_circle'],
              click: watch.url || null
            }
          ];

    let sent = 0;
    for (const msg of messages) {
      try {
        await this.publish(msg);
        sent += 1;
      } catch (err) {
        console.error(`[${watch.id}] push notification failed: ${err.message}`);
      }
    }
    if (sent) for (const c of relevant) this.recent.set(`${watch.id}:${c.id}:${c.type}`, now);
    return sent;
  }
}
