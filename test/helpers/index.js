import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { loadConfig } from '../../src/config.js';
import { Store } from '../../src/store.js';
import { createContext } from '../../src/context.js';
import { Notifier } from '../../src/telegram/notifier.js';
import { Monitor } from '../../src/monitor.js';
import { PushNotifier } from '../../src/push.js';

const TG_TAG = /^<\/?(b|strong|i|em|u|ins|s|strike|del|a|code|pre|tg-spoiler|span|blockquote|tg-emoji)(\s[^<>]*)?>/;
const TG_ENTITY = /^&(lt|gt|amp|quot|#\d+|#x[0-9a-f]+);/i;

/** Mimic Telegram's HTML parse mode: unknown tags or a bare "<" / "&" are rejected. */
export function telegramHtmlError(text) {
  for (let i = 0; i < text.length; i++) {
    const rest = text.slice(i);
    if (text[i] === '<' && !TG_TAG.test(rest)) return `can't parse entities: Unsupported start tag at byte offset ${i}`;
    if (text[i] === '&' && !TG_ENTITY.test(rest)) return `can't parse entities: bad entity at byte offset ${i}`;
  }
  return null;
}

export function tempDir() {
  return mkdtempSync(join(tmpdir(), 'stockbot-test-'));
}

/** Build a real config from an object, the same way config.json is loaded. */
export function makeConfig(obj = {}, dir = tempDir()) {
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify({ dataDir: join(dir, 'data'), ...obj }));
  return loadConfig(path);
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * Fake fetch: routes is a list of [matcher, handler]. matcher is a RegExp or a
 * string contained in the URL; handler returns a Response, a plain object
 * (sent as JSON) or throws. Every requested URL is recorded in fetch.calls.
 */
export function fakeFetch(routes) {
  const fn = async (url, init = {}) => {
    fn.calls.push(String(url));
    fn.requests.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    for (const [match, handler] of routes) {
      const ok = match instanceof RegExp ? match.test(url) : String(url).includes(match);
      if (ok) {
        const out = await handler(String(url), init);
        return out instanceof Response ? out : json(out);
      }
    }
    return json({ error: 'not found' }, 404);
  };
  fn.calls = [];
  fn.requests = [];
  return fn;
}
fakeFetch.json = json;

/** Records every message the bot would send. */
export class FakeNotifier {
  constructor() {
    this.sent = [];
    this.fail = false;
  }
  async broadcast(text, opts = {}) {
    if (this.fail) throw new Error('telegram down');
    const htmlError = telegramHtmlError(text);
    if (htmlError) throw new Error(`invalid Telegram HTML: ${htmlError}\n${text}`);
    this.sent.push({ text, ...opts });
  }
  async notifySafely(text, opts) {
    try {
      await this.broadcast(text, opts);
      return true;
    } catch {
      return false;
    }
  }
}

export function makeEnv(configObj, { fetch, chatIds = ['111'], notifier, push = false, secrets: extra = {} } = {}) {
  const config = makeConfig(configObj);
  const store = new Store(config.dataPath);
  const secrets = { botToken: 'TEST', chatIds, telegramApiBase: '', ntfyTopic: '', ntfyServer: '', ntfyToken: '', ...extra };
  const ctx = createContext({ config, secrets, store, fetchImpl: fetch, version: 'test' });
  const n = notifier || new FakeNotifier();
  const p = push ? new PushNotifier(ctx) : null;
  ctx.push = p;
  const monitor = new Monitor(ctx, n, p);
  return { config, store, ctx, notifier: n, push: p, monitor };
}

export { Notifier };

/**
 * Minimal Telegram Bot API server. Push updates with `pushUpdate`; inspect
 * `calls` ([{ method, params }]). getUpdates long-polls briefly.
 */
export async function startFakeTelegram() {
  const calls = [];
  const invalid = [];
  const queue = [];
  let waiters = [];
  let nextUpdateId = 1;
  let nextMessageId = 100;

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const method = req.url.split('/').pop();
      const params = body ? JSON.parse(body) : {};
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      };
      if (method !== 'getUpdates') calls.push({ method, params });
      const htmlError = params.parse_mode === 'HTML' && typeof params.text === 'string' && telegramHtmlError(params.text);
      if (htmlError) {
        invalid.push({ method, text: params.text, error: htmlError });
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error_code: 400, description: `Bad Request: ${htmlError}` }));
      }
      switch (method) {
        case 'getMe':
          return reply({ id: 42, is_bot: true, username: 'test_stock_bot' });
        case 'getWebhookInfo':
          return reply({ url: '' });
        case 'getUpdates': {
          const offset = params.offset || 0;
          const take = () => queue.filter((u) => u.update_id >= offset);
          if (take().length) return reply(take());
          const timer = setTimeout(() => {
            waiters = waiters.filter((w) => w !== wake);
            reply([]);
          }, 300);
          const wake = () => {
            clearTimeout(timer);
            reply(take());
          };
          waiters.push(wake);
          return;
        }
        case 'sendMessage':
          return reply({ message_id: nextMessageId++, chat: { id: params.chat_id }, text: params.text });
        default:
          return reply(true);
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    calls,
    invalid,
    pushUpdate(update) {
      const u = { update_id: nextUpdateId++, ...update };
      queue.push(u);
      const w = waiters;
      waiters = [];
      w.forEach((fn) => fn());
      return u;
    },
    message(chatId, text, extra = {}) {
      return this.pushUpdate({
        message: { message_id: nextMessageId++, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text, ...extra }
      });
    },
    callback(chatId, data, messageId = 1) {
      return this.pushUpdate({
        callback_query: {
          id: `cb${nextUpdateId}`,
          from: { id: chatId },
          data,
          message: { message_id: messageId, chat: { id: chatId, type: 'private' } }
        }
      });
    },
    /** Wait until a call matching the predicate shows up (after index `from`). */
    async waitFor(pred, { from = 0, timeoutMs = 3000 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const hit = calls.slice(from).find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timed out waiting for Telegram call; got: ${calls.slice(from).map((c) => c.method).join(', ')}`);
    },
    close() {
      waiters.forEach((fn) => fn());
      return new Promise((r) => server.close(r));
    }
  };
}
