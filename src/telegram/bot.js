import { randomBytes } from 'node:crypto';
import { t } from '../i18n.js';
import { normalizeWatch, NOTIFY_TYPES } from '../config.js';
import { detectWatch, scopeFingerprint, DetectError } from '../sources/index.js';
import { esc, slugify, formatDuration } from '../util.js';
import { isNotModified } from './api.js';
import {
  mainMenu,
  stockView,
  watchView,
  watchesView,
  removeConfirmView,
  checkResultView,
  checkLine,
  historyView,
  statusView,
  settingsView,
  muteView,
  helpView,
  searchView,
  mutedText,
  nextInterval
} from './views.js';

const COMMANDS = ['menu', 'stock', 'check', 'watches', 'search', 'history', 'status', 'settings', 'mute', 'unmute', 'add', 'help'];
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const STEAM_RE = /^steam[:\s]+\d+/i;

/** "2h" / "30m" / "1d" / "45" (minutes) -> minutes */
export function parseDuration(text) {
  const m = String(text || '').trim().match(/^(\d+)\s*(m|min|h|godz|d)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'm').toLowerCase();
  return unit.startsWith('h') || unit === 'godz' ? n * 60 : unit === 'd' ? n * 1440 : n;
}

/**
 * Interactive side of the bot: long-polls getUpdates and answers commands and
 * inline-button presses. Only chats listed in TELEGRAM_CHAT_ID may use it.
 */
export class TelegramBot {
  constructor(ctx, api, monitor) {
    this.ctx = ctx;
    this.api = api;
    this.monitor = monitor;
    this.offset = 0;
    this.stopped = false;
    this.abort = new AbortController();
    this.pendingAdds = new Map();
    this.unauthorizedSeen = new Map();
    this.me = null;
  }

  async start() {
    this.me = await this.api.call('getMe');
    try {
      const info = await this.api.call('getWebhookInfo');
      if (info && info.url) {
        console.log('Removing the Telegram webhook so long polling can work.');
        await this.api.call('deleteWebhook', { drop_pending_updates: false });
      }
    } catch (err) {
      console.warn(`Could not inspect the Telegram webhook: ${err.message}`);
    }
    await this.registerCommands().catch((err) => console.warn(`setMyCommands failed: ${err.message}`));
    console.log(`Telegram bot @${this.me.username} ready - listening for commands.`);
    this.loop = this.pollLoop();
    return this.me;
  }

  /** Fills Telegram's "Menu" button with the command list (localized). */
  async registerCommands() {
    const list = (lang) => COMMANDS.map((command) => ({ command, description: t(lang, `cmd_${command}`) }));
    await this.api.call('setMyCommands', { commands: list(this.ctx.lang) });
    for (const lang of ['pl', 'en']) {
      await this.api.call('setMyCommands', { commands: list(lang), language_code: lang });
    }
    await this.api.call('setChatMenuButton', { menu_button: { type: 'commands' } });
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  async pollLoop() {
    let backoff = 1000;
    while (!this.stopped) {
      let updates;
      try {
        updates = await this.api.call(
          'getUpdates',
          { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
          { timeoutMs: 65000, signal: this.abort.signal, retries: 0 }
        );
        backoff = 1000;
      } catch (err) {
        if (this.stopped) break;
        if (err.code === 409) {
          console.error('Telegram getUpdates conflict: another process is polling this bot token (or a webhook was set).');
        } else {
          console.error(`Telegram polling error: ${err.message}`);
        }
        await this._sleep(backoff);
        backoff = Math.min(backoff * 2, 60000);
        continue;
      }
      for (const update of updates) {
        this.offset = update.update_id + 1;
        try {
          await this.handleUpdate(update);
        } catch (err) {
          console.error(`Telegram update ${update.update_id} failed: ${err.stack || err.message}`);
        }
      }
    }
  }

  async stop() {
    this.stopped = true;
    this.abort.abort();
    if (this.loop) await this.loop.catch(() => {});
  }

  isAuthorized(chat, from) {
    const ids = this.ctx.secrets.chatIds;
    return (chat && ids.includes(String(chat.id))) || (from && ids.includes(String(from.id)));
  }

  // ---------------------------------------------------------------- output

  async send(chatId, view) {
    return this.api.call('sendMessage', {
      chat_id: chatId,
      text: view.text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(view.keyboard ? { reply_markup: { inline_keyboard: view.keyboard } } : {})
    });
  }

  async edit(chatId, messageId, view) {
    try {
      await this.api.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: view.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: view.keyboard || [] }
      });
    } catch (err) {
      if (isNotModified(err)) return;
      // Too old to edit, deleted, etc. - just send a fresh message.
      await this.send(chatId, view);
    }
  }

  async answer(callbackId, text = null) {
    try {
      await this.api.call('answerCallbackQuery', {
        callback_query_id: callbackId,
        ...(text ? { text: text.replace(/<[^>]+>/g, '').slice(0, 190) } : {})
      });
    } catch {
      // Callback queries expire after a while; nothing useful to do then.
    }
  }

  // ---------------------------------------------------------------- input

  async handleUpdate(update) {
    if (update.callback_query) return this.onCallback(update.callback_query);
    const msg = update.message;
    if (!msg || !msg.chat || typeof msg.text !== 'string') return;
    const text = msg.text.trim();
    const lang = this.ctx.lang;

    let command = null;
    let args = '';
    if (text.startsWith('/')) {
      const [head, ...rest] = text.split(/\s+/);
      let cmd = head.slice(1).toLowerCase();
      const at = cmd.indexOf('@');
      if (at !== -1) {
        // In groups, ignore commands addressed to other bots.
        if (this.me && cmd.slice(at + 1) !== String(this.me.username).toLowerCase()) return;
        cmd = cmd.slice(0, at);
      }
      command = cmd;
      args = rest.join(' ').trim();
    }

    if (command === 'id') {
      return this.send(msg.chat.id, { text: t(lang, 'chat_id', { id: msg.chat.id }) });
    }

    if (!this.isAuthorized(msg.chat, msg.from)) {
      const last = this.unauthorizedSeen.get(msg.chat.id) || 0;
      if (Date.now() - last > 10 * 60 * 1000) {
        this.unauthorizedSeen.set(msg.chat.id, Date.now());
        console.warn(`Ignoring Telegram message from unauthorized chat ${msg.chat.id}`);
        return this.send(msg.chat.id, { text: t(lang, 'unauthorized', { id: msg.chat.id }) });
      }
      return;
    }

    if (command) return this.onCommand(msg.chat.id, command, args);

    // Free text only in private chats: a link offers to add it, anything else searches.
    if (msg.chat.type !== 'private') return;
    if (URL_RE.test(text) || STEAM_RE.test(text)) return this.offerAdd(msg.chat.id, text);
    if (text.length >= 2) return this.send(msg.chat.id, searchView(this.ctx, text));
  }

  findWatch(query) {
    const q = String(query || '').toLowerCase();
    const watches = this.ctx.watches();
    return (
      watches.find((w) => w.id === q) ||
      watches.find((w) => w.name.toLowerCase() === q) ||
      watches.find((w) => w.name.toLowerCase().includes(q) || w.id.includes(q)) ||
      null
    );
  }

  async onCommand(chatId, command, args) {
    const { ctx } = this;
    const lang = ctx.lang;
    switch (command) {
      case 'start':
      case 'menu':
        return this.send(chatId, mainMenu(ctx));
      case 'stock': {
        if (!args) return this.send(chatId, stockView(ctx));
        const w = this.findWatch(args);
        return this.send(chatId, w ? watchView(ctx, w.id) : searchView(ctx, args));
      }
      case 'check': {
        const w = args ? this.findWatch(args) : null;
        if (args && !w) return this.send(chatId, { text: t(lang, 'unknown_watch', { id: esc(args) }) });
        const progress = await this.send(chatId, { text: t(lang, 'checking') });
        const results = await this.monitor.checkAll(w ? [w.id] : null, { respectBackoff: !w });
        return this.edit(chatId, progress.message_id, checkResultView(ctx, results, this.monitor));
      }
      case 'watches':
        return this.send(chatId, watchesView(ctx));
      case 'search':
        return this.send(chatId, args ? searchView(ctx, args) : { text: t(lang, 'search_usage') });
      case 'history':
        return this.send(chatId, historyView(ctx, 0));
      case 'status':
        return this.send(chatId, statusView(ctx, this.monitor));
      case 'settings':
        return this.send(chatId, settingsView(ctx));
      case 'mute': {
        if (!args) return this.send(chatId, muteView(ctx));
        if (/^(off|0|stop)$/i.test(args)) return this.onCommand(chatId, 'unmute', '');
        const minutes = parseDuration(args);
        if (!minutes) return this.send(chatId, { text: t(lang, 'mute_usage') });
        this.setMute(minutes);
        return this.send(chatId, mainMenu(ctx, t(lang, 'muted_toast', { until: mutedText(ctx) })));
      }
      case 'unmute':
        this.setMute(0);
        return this.send(chatId, mainMenu(ctx, t(lang, 'unmuted')));
      case 'add':
        if (!args) return this.send(chatId, { text: t(lang, 'add_usage') });
        return this.addWatch(chatId, args);
      case 'remove': {
        const w = args ? this.findWatch(args) : null;
        return this.send(chatId, w ? removeConfirmView(ctx, w.id) : watchesView(ctx));
      }
      case 'pause':
      case 'resume': {
        const w = args ? this.findWatch(args) : null;
        if (!w) return this.send(chatId, watchesView(ctx));
        this.setEnabled(w.id, command === 'resume');
        return this.send(chatId, watchView(ctx, w.id));
      }
      case 'interval': {
        const [idArg, secArg] = args.split(/\s+/);
        const w = idArg ? this.findWatch(idArg) : null;
        const seconds = Number(secArg);
        if (!w || !Number.isFinite(seconds) || seconds <= 0) {
          return this.send(chatId, { text: '/interval &lt;watch&gt; &lt;seconds&gt;' });
        }
        const applied = this.setInterval(w.id, seconds);
        return this.send(chatId, watchView(ctx, w.id, { notice: t(lang, 'interval_toast', { interval: formatDuration(applied * 1000, lang) }) }));
      }
      case 'help':
        return this.send(chatId, helpView(ctx));
      default:
        return this.send(chatId, { text: t(lang, 'unknown_command') });
    }
  }

  async onCallback(cq) {
    const { ctx } = this;
    const lang = ctx.lang;
    const chat = cq.message && cq.message.chat;
    if (!chat || !this.isAuthorized(chat, cq.from)) return this.answer(cq.id, '⛔');
    const chatId = chat.id;
    const messageId = cq.message.message_id;
    const [action, a1, a2, a3] = String(cq.data || '').split(':');

    let view = null;
    let toast = null;

    switch (action) {
      case 'menu':
        view = mainMenu(ctx);
        break;
      case 'stock':
        view = stockView(ctx);
        break;
      case 'w':
        view = watchView(ctx, a1);
        break;
      case 'wi':
        view = watchView(ctx, a1, { page: Number(a2) || 0, filter: a3 === 's' ? 's' : 'a' });
        break;
      case 'wp':
      case 'wpl': {
        const w = ctx.getWatch(a1);
        if (w) {
          this.setEnabled(a1, !w.enabled);
          toast = t(lang, w.enabled ? 'paused_toast' : 'resumed_toast', { name: w.name });
        }
        view = action === 'wp' ? watchView(ctx, a1) : watchesView(ctx);
        break;
      }
      case 'wn': {
        const w = ctx.getWatch(a1);
        if (w) {
          const applied = this.setInterval(a1, nextInterval(w.intervalSeconds, ctx.config.minIntervalSeconds));
          toast = t(lang, 'interval_toast', { interval: formatDuration(applied * 1000, lang) });
        }
        view = watchView(ctx, a1);
        break;
      }
      case 'wc': {
        const w = ctx.getWatch(a1);
        if (!w) {
          view = watchesView(ctx);
          break;
        }
        await this.answer(cq.id, t(lang, 'checking'));
        const result = await this.monitor.checkWatch(a1);
        return this.edit(chatId, messageId, watchView(ctx, a1, { notice: checkLine(ctx, w, result, this.monitor.nextDue.get(a1)) }));
      }
      case 'wr':
        view = removeConfirmView(ctx, a1);
        break;
      case 'wR': {
        const w = ctx.getWatch(a1);
        if (w && w.custom) {
          this.removeWatch(a1);
          view = watchesView(ctx, t(lang, 'removed_watch', { name: esc(w.name) }));
        } else {
          view = watchesView(ctx);
        }
        break;
      }
      case 'wl':
        view = watchesView(ctx);
        break;
      case 'chk': {
        await this.answer(cq.id, t(lang, 'checking'));
        await this.edit(chatId, messageId, { text: t(lang, 'checking'), keyboard: [] });
        const results = await this.monitor.checkAll(null, { respectBackoff: true });
        return this.edit(chatId, messageId, checkResultView(ctx, results, this.monitor));
      }
      case 'hist':
        view = historyView(ctx, Number(a1) || 0);
        break;
      case 'st':
        view = statusView(ctx, this.monitor);
        break;
      case 'set':
        view = settingsView(ctx);
        break;
      case 'sn':
        if (NOTIFY_TYPES.includes(a1)) {
          ctx.store.settings.notifyOn[a1] = !ctx.notifyOn()[a1];
          ctx.store.saveSettings();
        }
        view = settingsView(ctx);
        break;
      case 'sq': {
        const q = ctx.quietHours();
        ctx.store.settings.quietHours = { ...q, enabled: !q.enabled };
        ctx.store.saveSettings();
        view = settingsView(ctx);
        break;
      }
      case 'sd':
        ctx.store.settings.dailyReport = !ctx.dailyReport();
        ctx.store.saveSettings();
        view = settingsView(ctx);
        break;
      case 'sl':
        ctx.store.settings.language = lang === 'pl' ? 'en' : 'pl';
        ctx.store.saveSettings();
        this.registerCommands().catch((err) => console.warn(`setMyCommands failed: ${err.message}`));
        view = settingsView(ctx);
        break;
      case 'mute':
        view = muteView(ctx);
        break;
      case 'mu': {
        const minutes = Number(a1);
        this.setMute(minutes);
        toast = minutes === 0 ? t(lang, 'unmuted') : t(lang, 'muted_toast', { until: mutedText(ctx) });
        view = mainMenu(ctx);
        break;
      }
      case 'help':
        view = helpView(ctx);
        break;
      case 'addc': {
        const pending = this.pendingAdds.get(a1);
        this.pendingAdds.delete(a1);
        if (!pending) {
          toast = t(lang, 'add_expired');
          break;
        }
        await this.answer(cq.id);
        return this.addWatch(chatId, pending.text, messageId);
      }
      case 'noop':
      default:
        break;
    }

    await this.answer(cq.id, toast);
    if (view) await this.edit(chatId, messageId, view);
  }

  // ---------------------------------------------------------------- actions

  setMute(minutes) {
    const s = this.ctx.store.settings;
    if (minutes === 0) s.mutedUntil = null;
    else if (minutes < 0) s.mutedUntil = 'forever';
    else s.mutedUntil = new Date(Date.now() + minutes * 60000).toISOString();
    this.ctx.store.saveSettings();
  }

  _override(id) {
    const s = this.ctx.store.settings;
    if (!s.watches[id]) s.watches[id] = {};
    return s.watches[id];
  }

  setEnabled(id, enabled) {
    this._override(id).enabled = enabled;
    this.ctx.store.saveSettings();
    this.monitor.reschedule(id, { now: enabled });
  }

  setInterval(id, seconds) {
    const applied = Math.max(this.ctx.config.minIntervalSeconds, Math.round(seconds));
    this._override(id).intervalSeconds = applied;
    this.ctx.store.saveSettings();
    this.monitor.reschedule(id);
    return applied;
  }

  removeWatch(id) {
    const s = this.ctx.store.settings;
    s.customWatches = (s.customWatches || []).filter((w) => w.id !== id);
    this.ctx.store.saveSettings();
    this.ctx.store.forgetWatch(id);
    this.monitor.forget(id);
  }

  async offerAdd(chatId, text) {
    const token = randomBytes(4).toString('hex');
    this.pendingAdds.set(token, { text, at: Date.now() });
    for (const [k, v] of this.pendingAdds) {
      if (Date.now() - v.at > 30 * 60 * 1000 || this.pendingAdds.size > 50) this.pendingAdds.delete(k);
    }
    const lang = this.ctx.lang;
    return this.send(chatId, {
      text: `${t(lang, 'add_offer')}\n<code>${esc(text)}</code>`,
      keyboard: [[{ text: t(lang, 'btn_add'), callback_data: `addc:${token}` }, { text: t(lang, 'btn_cancel'), callback_data: 'menu' }]]
    });
  }

  /** Detect what the link is, store it as a custom watch and take its baseline. */
  async addWatch(chatId, input, messageId = null) {
    const { ctx } = this;
    const lang = ctx.lang;
    const progress = { text: t(lang, 'add_detecting'), keyboard: [] };
    if (messageId) await this.edit(chatId, messageId, progress);
    else messageId = (await this.send(chatId, progress)).message_id;

    let watch;
    try {
      const def = await detectWatch(input, ctx);
      const probe = normalizeWatch({ ...def, id: 'probe' }, ctx.config);
      const existing = ctx.watches().find((w) => w.type === probe.type && scopeFingerprint(w) === scopeFingerprint(probe));
      if (existing) {
        return this.edit(chatId, messageId, watchView(ctx, existing.id, { notice: t(lang, 'add_exists', { name: esc(existing.name) }) }));
      }
      const taken = new Set(ctx.watches().map((w) => w.id));
      const base = slugify(def.name, 20);
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      watch = normalizeWatch({ ...def, id }, ctx.config);
      ctx.store.settings.customWatches.push({ ...def, id });
      ctx.store.saveSettings();
    } catch (err) {
      const text = err instanceof DetectError
        ? t(lang, err.key, { host: esc(err.params.host || '') })
        : t(lang, 'add_failed', { error: esc(err.message) });
      return this.edit(chatId, messageId, { text, keyboard: [[{ text: t(lang, 'menu'), callback_data: 'menu' }]] });
    }

    console.log(`Added watch "${watch.id}" (${watch.type}) from Telegram`);
    const result = await this.monitor.checkWatch(watch.id);
    const notice = `${t(lang, 'add_done', { name: esc(watch.name), type: watch.type })}\n${checkLine(ctx, watch, result, this.monitor.nextDue.get(watch.id))}`;
    return this.edit(chatId, messageId, watchView(ctx, watch.id, { notice }));
  }
}
