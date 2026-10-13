import { sleep } from '../util.js';

export class TelegramError extends Error {
  constructor(method, code, description, retryAfter = null) {
    super(`Telegram ${method} failed (${code}): ${description}`);
    this.method = method;
    this.code = code;
    this.description = description;
    this.retryAfter = retryAfter;
  }
}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  return signal;
}

/** Tiny Bot API client: JSON POSTs, retries on 429 (honouring retry_after), 5xx and network errors. */
export class TelegramApi {
  constructor(token, { baseUrl = 'https://api.telegram.org', fetchImpl = globalThis.fetch } = {}) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
  }

  async call(method, params = {}, { timeoutMs = 20000, signal = null, retries = 2 } = {}) {
    const url = `${this.baseUrl}/bot${this.token}/${method}`;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res;
      let data = null;
      try {
        res = await this.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: withTimeout(signal, timeoutMs)
        });
        data = await res.json().catch(() => null);
      } catch (err) {
        if (signal && signal.aborted) throw err;
        // Never echo the request URL: it contains the bot token.
        lastErr = new TelegramError(method, 'network', err.cause?.code || err.name || 'fetch failed');
        if (attempt < retries) await sleep(1000 * (attempt + 1));
        continue;
      }

      if (data && data.ok) return data.result;

      const code = (data && data.error_code) || res.status;
      const description = (data && data.description) || `HTTP ${res.status}`;
      const retryAfter = data && data.parameters && data.parameters.retry_after;
      lastErr = new TelegramError(method, code, description, retryAfter);
      if (code === 429 && attempt < retries) {
        await sleep(Math.min((retryAfter || 1) * 1000, 30000));
        continue;
      }
      if (code >= 500 && attempt < retries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw lastErr;
    }
    throw lastErr;
  }
}

export function isParseError(err) {
  return err instanceof TelegramError && /can't parse entities/i.test(err.description);
}

/** Telegram HTML -> plain text, for the fallback when Telegram rejects our markup. */
export function htmlToPlain(text) {
  return String(text)
    .replace(/<\/?(b|strong|i|em|u|ins|s|strike|del|a|code|pre|tg-spoiler|span|blockquote|tg-emoji)(\s[^<>]*)?>/gi, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function isNotModified(err) {
  return err instanceof TelegramError && /message is not modified/i.test(err.description);
}
