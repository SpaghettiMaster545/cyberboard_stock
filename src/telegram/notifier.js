import { isParseError, htmlToPlain } from './api.js';

/**
 * Sends alerts to every configured chat. While muted or in quiet hours the
 * messages are still delivered, just with `disable_notification` (no sound).
 * Without Telegram credentials it logs instead, so the bot can run locally.
 */
export class Notifier {
  constructor(ctx, api) {
    this.ctx = ctx;
    this.api = api;
  }

  get enabled() {
    return !!this.api && this.ctx.secrets.chatIds.length > 0;
  }

  /** Throws only when no chat received the message (so the caller can retry later). */
  async broadcast(text, { silent = false, keyboard = null } = {}) {
    if (!this.enabled) {
      console.log(`[telegram disabled] ${text.replace(/<[^>]+>/g, '').replace(/\n+/g, ' | ')}`);
      return;
    }
    const quiet = silent || this.ctx.isSilentNow();
    const failures = [];
    for (const chatId of this.ctx.secrets.chatIds) {
      const params = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        disable_notification: quiet,
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {})
      };
      try {
        try {
          await this.api.call('sendMessage', params);
        } catch (err) {
          if (!isParseError(err)) throw err;
          // A stock alert must arrive even if a product name broke the markup.
          console.error(`Telegram rejected HTML, sending plain text instead: ${err.description}`);
          const { parse_mode, ...plain } = params;
          await this.api.call('sendMessage', { ...plain, text: htmlToPlain(text) });
        }
      } catch (err) {
        failures.push(`chat ${chatId}: ${err.message}`);
      }
    }
    if (failures.length) console.error(`Telegram delivery problems: ${failures.join(' | ')}`);
    if (failures.length === this.ctx.secrets.chatIds.length) {
      throw new Error(`Telegram notification failed: ${failures.join(' | ')}`);
    }
  }

  /** Like broadcast, but never throws. Returns whether it was delivered. */
  async notifySafely(text, opts) {
    try {
      await this.broadcast(text, opts);
      return true;
    } catch (err) {
      console.error(err.message);
      return false;
    }
  }
}
