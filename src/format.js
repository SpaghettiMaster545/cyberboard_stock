import { t } from './i18n.js';
import { esc, formatMoney, formatDuration, formatTime } from './util.js';

const ICON = {
  restock: '\u{1F7E2}', // green circle
  soldout: '\u{1F534}', // red circle
  new: '\u{1F195}', // NEW button
  price: '\u{1F4B0}', // money bag
  removed: '⚪' // white circle
};

const ORDER = { restock: 0, new: 1, price: 2, soldout: 3, removed: 4 };

export function typeLabel(watch) {
  return { shopify: 'Shopify', steam: 'Steam', page: 'WWW' }[watch.type] || watch.type;
}

export function itemPrice(item, lang) {
  return item.price != null ? formatMoney(Number(item.price), item.currency, lang) : '';
}

/** "Title — Variant · price" (escaped, optional link on the title). */
export function itemLine(item, lang, { link = false, bold = false } = {}) {
  let title = esc(item.title);
  if (bold) title = `<b>${title}</b>`;
  if (link && item.url) title = `<a href="${esc(item.url)}">${title}</a>`;
  // Skip variants that only repeat the product name ("AM HATSU — AM HATSU"), keep short ones like "Red".
  const v = String(item.variant || '').toLowerCase();
  const name = String(item.title || '').toLowerCase();
  const repeats = v && (v === name || (v.length >= 10 && name.includes(v)));
  const variant = item.variant && !repeats ? ` — ${esc(item.variant)}` : '';
  const price = itemPrice(item, lang);
  return `${title}${variant}${price ? ` · ${esc(price)}` : ''}`;
}

export function formatChange(ch, lang, watchName = null) {
  const label = `${ICON[ch.type]} <b>${t(lang, `label_${ch.type}`)}</b>`;
  let text = watchName ? `${label} · ${esc(watchName)}` : label;
  text += `\n${itemLine(ch.item, lang, { bold: !!watchName })}`;
  if (ch.type === 'price') {
    text += `\n<i>${t(lang, 'was_price', { price: esc(formatMoney(ch.oldPrice, ch.item.currency, lang)) })}</i>`;
  }
  if (ch.item.url && ch.type !== 'removed') {
    text += `\n<a href="${esc(ch.item.url)}">${t(lang, 'view_product')}</a>`;
  }
  return text;
}

/**
 * Turn a list of changes into one or more Telegram messages, each safely under
 * Telegram's 4096-character limit.
 */
export function formatChanges(watch, changes, lang) {
  const sorted = [...changes].sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  const note = watch.note && sorted.some((c) => c.type === 'restock') ? `\n\n<i>ℹ️ ${esc(watch.note)}</i>` : '';
  if (sorted.length === 1) return [formatChange(sorted[0], lang, watch.name) + note];

  const header = t(lang, 'changes_header', { name: esc(watch.name), count: sorted.length });
  const messages = [];
  let cur = header;
  for (const block of sorted.map((c) => formatChange(c, lang))) {
    const candidate = `${cur}\n\n${block}`;
    if (candidate.length > 3800) {
      messages.push(cur);
      cur = block;
    } else {
      cur = candidate;
    }
  }
  messages.push(cur + note);
  return messages;
}

export function stockIcon(summary) {
  if (!summary) return '⏳';
  return summary.inStockCount > 0 ? ICON.restock : ICON.soldout;
}

export function formatBaseline(watch, items, summary, lang, reset) {
  const params = { name: esc(watch.name), items: summary.itemCount, inStock: summary.inStockCount };
  let text = t(lang, reset ? 'baseline_reset' : 'baseline_new', params);
  const list = Object.values(items);
  if (list.length <= 10) {
    text += '\n' + list.map((i) => `${i.available ? ICON.restock : ICON.soldout} ${itemLine(i, lang, { link: true })}`).join('\n');
  }
  if (!reset) text += `\n\n${t(lang, 'baseline_footer')}`;
  return text;
}

export function formatFailure(watch, health, lang, timezone, now = Date.now()) {
  return t(lang, 'failure_alert', {
    name: esc(watch.name),
    error: esc(health.lastError || '?'),
    count: health.consecutiveFailures,
    since: formatDuration(now - Date.parse(health.failureStreakStartedAt), lang),
    lastOk: health.lastSuccessAt
      ? `${formatTime(health.lastSuccessAt, timezone, lang)} (${t(lang, 'ago', { time: formatDuration(now - Date.parse(health.lastSuccessAt), lang) })})`
      : t(lang, 'never')
  });
}

export function formatRecovery(watch, failures, streakStartedAt, lang, now = Date.now()) {
  return t(lang, 'recovery_alert', {
    name: esc(watch.name),
    count: failures,
    downtime: streakStartedAt ? formatDuration(now - Date.parse(streakStartedAt), lang) : '?'
  });
}

export function formatStartup(watches, version, lang) {
  const active = watches.filter((w) => w.enabled);
  const lines = active.length
    ? active.map((w) => `• ${esc(w.name)} <i>(${typeLabel(w)}, ${t(lang, 'every', { time: formatDuration(w.intervalSeconds * 1000, lang) })})</i>`)
    : ['—'];
  return t(lang, 'startup', { version: esc(version), watches: lines.join('\n') });
}

export function formatDailyReport(ctx, now = Date.now()) {
  const lang = ctx.lang;
  const lines = [];
  for (const w of ctx.watches().filter((x) => x.enabled)) {
    const h = ctx.store.runtime.watches[w.id];
    if (!h || !h.lastSuccessAt) {
      lines.push(`• ${esc(w.name)}: ⏳`);
      continue;
    }
    const stock = h.groupCount > 1 && h.groupCount !== h.itemCount
      ? `${h.groupsInStock}/${h.groupCount}`
      : `${h.inStockCount}/${h.itemCount}`;
    const icon = h.consecutiveFailures ? '⚠️' : h.inStockCount ? ICON.restock : ICON.soldout;
    lines.push(`• ${icon} ${esc(w.name)}: ${stock} ${t(lang, 'in_stock')}`);
  }
  return t(lang, 'daily_report', {
    uptime: formatDuration(now - ctx.startedAt, lang),
    watches: lines.join('\n') || '—',
    hours: ctx.config.health.statusIntervalHours,
    changes: ctx.store.runtime.window.changes,
    failures: ctx.store.runtime.window.failures
  });
}
