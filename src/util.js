import { writeFileSync, renameSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Escape text for Telegram's HTML parse mode. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${path}, ignoring it: ${err.message}`);
    return fallback;
  }
}

/** Write JSON atomically (tmp file + rename) so a crash never leaves a half-written file. */
export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${shortUrl(url)}`);
    this.status = status;
  }
}

/** The remote side asked us to slow down (HTTP 429). */
export class RateLimitError extends HttpError {
  constructor(url, retryAfterSeconds) {
    super(429, url);
    this.retryAfterSeconds = retryAfterSeconds;
    this.rateLimited = true;
  }
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('_cb');
    return u.origin + u.pathname;
  } catch {
    return String(url);
  }
}

function parseRetryAfter(value) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - Date.now()) / 1000)) : null;
}

let cacheBustCounter = 0;

/** Append a unique query param so CDN/page caches always hand us fresh data. */
export function cacheBust(url) {
  cacheBustCounter += 1;
  return `${url}${url.includes('?') ? '&' : '?'}_cb=${Date.now()}${cacheBustCounter}`;
}

/**
 * GET a URL with a timeout and a couple of retries for network errors / 5xx.
 * HTTP 429 is never retried here: it is surfaced as a RateLimitError so the
 * scheduler can back off instead of hammering the store.
 */
export async function httpGet(
  url,
  { fetchImpl = globalThis.fetch, headers = {}, as = 'json', timeoutMs = 20000, retries = 2 } = {}
) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) {
        throw new RateLimitError(url, parseRetryAfter(res.headers.get('retry-after')));
      }
      if (!res.ok) throw new HttpError(res.status, url);
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      lastErr = err;
      const retryable = !err.rateLimited && !(err.status >= 400 && err.status < 500);
      if (!retryable || attempt > retries) break;
      await sleep(700 * attempt);
    }
  }
  throw lastErr;
}

export function formatDuration(ms, lang = 'en') {
  if (ms == null || !Number.isFinite(ms)) return '?';
  // Sub-second values as "0,4 s" - no "<" sign, which Telegram's HTML mode would reject.
  if (ms < 1000) {
    const tenths = (Math.max(ms, 100) / 1000).toFixed(1);
    return lang === 'pl' ? `${tenths.replace('.', ',')} s` : `${tenths}s`;
  }
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sep = lang === 'pl' ? ' ' : '';
  const parts = [];
  if (d) parts.push(`${d}${sep}d`);
  if (h) parts.push(`${h}${sep}h`);
  if (m && !d) parts.push(`${m}${sep}min`);
  if (s && !d && !h) parts.push(`${s}${sep}s`);
  return parts.join(' ') || `0${sep}s`;
}

/** "12.10 21:05:03" style timestamp in the configured time zone. */
export function formatTime(iso, timeZone, lang = 'en') {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(lang === 'pl' ? 'pl-PL' : 'en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  } catch {
    return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }
}

/** Hour of day (0-23) in the given time zone. */
export function hourIn(timeZone, date = new Date()) {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date);
    return Number(h) % 24;
  } catch {
    return date.getUTCHours();
  }
}

export function formatMoney(amount, currency, lang = 'en') {
  if (amount == null || !Number.isFinite(amount)) return '';
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(lang === 'pl' ? 'pl-PL' : 'en-US', {
      style: 'currency',
      currency
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Keep a message under Telegram's 4096-char limit without cutting an HTML tag in half. */
export function clip(text, max = 3900) {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max);
  return text.slice(0, cut > max * 0.5 ? cut : max) + '\n…';
}

export function slugify(s, maxLen = 24) {
  return (
    String(s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen)
      .replace(/-+$/g, '') || 'watch'
  );
}
