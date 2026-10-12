import { t } from '../i18n.js';
import { NOTIFY_TYPES } from '../config.js';
import { summarizeItems } from '../diff.js';
import { esc, formatDuration, formatTime, clip } from '../util.js';
import { typeLabel, itemLine, itemPrice, stockIcon } from '../format.js';

/**
 * Every screen of the Telegram UI is a pure function returning
 * { text, keyboard } - the bot either sends it or edits the current message.
 * Callback data stays well under Telegram's 64-byte limit (ids are <= 24 chars).
 */

export const INTERVAL_STEPS = [30, 45, 60, 120, 300, 600, 1800];
const PAGE_SIZE = 10;
const HISTORY_PAGE = 12;
const GREEN = '\u{1F7E2}';
const RED = '\u{1F534}';
const CHANGE_ICON = { restock: GREEN, soldout: RED, new: '\u{1F195}', price: '\u{1F4B0}', removed: '⚪' };

const btn = (text, data) => ({ text, callback_data: data });
const urlBtn = (text, url) => ({ text, url });

function ago(ctx, iso) {
  if (!iso) return t(ctx.lang, 'never');
  return t(ctx.lang, 'ago', { time: formatDuration(Date.now() - Date.parse(iso), ctx.lang) });
}

function untilText(ctx, ts) {
  const ms = ts - Date.now();
  if (!Number.isFinite(ms) || ms <= 1000) return t(ctx.lang, 'now');
  return t(ctx.lang, 'in_time', { time: formatDuration(ms, ctx.lang) });
}

function every(ctx, seconds) {
  return t(ctx.lang, 'every', { time: formatDuration(seconds * 1000, ctx.lang) });
}

export function mutedText(ctx) {
  const m = ctx.mutedUntil();
  if (!m) return null;
  return m === 'forever'
    ? t(ctx.lang, 'muted_forever')
    : t(ctx.lang, 'muted_until', { time: formatTime(m, ctx.timezone, ctx.lang) });
}

function watchItems(ctx, id) {
  const saved = ctx.store.state.watches[id];
  return saved ? saved.items : null;
}

function withNotice(notice, text) {
  return notice ? `${notice}\n\n${text}` : text;
}

export function mainMenu(ctx, notice = null) {
  const lang = ctx.lang;
  const watches = ctx.watches();
  const active = watches.filter((w) => w.enabled);
  let inStock = 0;
  let lastCheck = null;
  for (const w of active) {
    const items = watchItems(ctx, w.id);
    if (items) inStock += summarizeItems(items).inStockCount;
    const h = ctx.store.runtime.watches[w.id];
    if (h && h.lastCheckAt && (!lastCheck || h.lastCheckAt > lastCheck)) lastCheck = h.lastCheckAt;
  }
  const lines = [
    t(lang, 'main_title'),
    t(lang, 'main_summary', { active: active.length, total: watches.length, inStock }),
    t(lang, 'main_last_check', { time: ago(ctx, lastCheck) })
  ];
  const muted = mutedText(ctx);
  if (muted) lines.push(t(lang, 'main_muted', { until: muted }));
  if (ctx.inQuietHours()) {
    const q = ctx.quietHours();
    lines.push(t(lang, 'main_quiet', { from: q.from, to: q.to }));
  }
  lines.push('', t(lang, 'main_pick'));
  return {
    text: withNotice(notice, lines.join('\n')),
    keyboard: [
      [btn(t(lang, 'btn_stock'), 'stock'), btn(t(lang, 'btn_check'), 'chk')],
      [btn(t(lang, 'btn_watches'), 'wl'), btn(t(lang, 'btn_history'), 'hist:0')],
      [
        btn(t(lang, 'btn_settings'), 'set'),
        muted ? btn(t(lang, 'btn_unmute'), 'mu:0') : btn(t(lang, 'btn_mute'), 'mute')
      ],
      [btn(t(lang, 'btn_status'), 'st'), btn(t(lang, 'btn_help'), 'help')]
    ]
  };
}

export function stockView(ctx) {
  const lang = ctx.lang;
  const watches = ctx.watches();
  if (!watches.length) {
    return { text: `${t(lang, 'stock_title')}\n\n${t(lang, 'stock_empty')}`, keyboard: [[btn(t(lang, 'menu'), 'menu')]] };
  }
  const blocks = [];
  const buttons = [];
  for (const w of watches) {
    const items = watchItems(ctx, w.id);
    const h = ctx.store.runtime.watches[w.id];
    let icon = '⏸';
    if (!w.enabled) {
      blocks.push(t(lang, 'stock_line_paused', { name: esc(w.name), paused: t(lang, 'paused') }));
    } else if (!items) {
      icon = '⏳';
      blocks.push(t(lang, 'stock_line_nodata', { name: esc(w.name) }));
    } else {
      const s = summarizeItems(items);
      icon = h && h.consecutiveFailures >= 3 ? '⚠️' : stockIcon(s);
      const params = {
        icon,
        name: esc(w.name),
        groupsIn: s.groupsInStock,
        groups: s.groupCount,
        inStock: s.inStockCount,
        items: s.itemCount,
        checked: t(lang, 'checked', { time: ago(ctx, h && h.lastSuccessAt) })
      };
      blocks.push(t(lang, s.groupCount > 1 && s.groupCount !== s.itemCount ? 'stock_line_groups' : 'stock_line_items', params));
    }
    buttons.push(btn(`${icon} ${w.name}`.slice(0, 60), `w:${w.id}`));
  }
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  keyboard.push([btn(t(lang, 'btn_check'), 'chk'), btn(t(lang, 'menu'), 'menu')]);
  return { text: clip(`${t(lang, 'stock_title')}\n\n${blocks.join('\n\n')}`), keyboard };
}

/** Group items by product (Shopify variants share a group). */
export function groupItems(items) {
  const groups = new Map();
  for (const [id, it] of Object.entries(items || {})) {
    const key = it.group || id;
    if (!groups.has(key)) groups.set(key, { key, title: it.title, url: it.url, items: [] });
    groups.get(key).items.push(it);
  }
  const list = [...groups.values()];
  for (const g of list) g.available = g.items.some((i) => i.available);
  list.sort((a, b) => Number(b.available) - Number(a.available) || String(a.title).localeCompare(String(b.title)));
  return list;
}

function groupBlock(ctx, g) {
  const lang = ctx.lang;
  const icon = g.available ? GREEN : RED;
  if (g.items.length === 1) {
    const it = g.items[0];
    const notes = [];
    if (it.waitlist) notes.push(t(lang, 'waitlist'));
    if (it.highPendingOrders) notes.push(t(lang, 'high_demand'));
    return `${icon} ${itemLine(it, lang, { link: true })}${notes.length ? ` <i>(${notes.join(', ')})</i>` : ''}`;
  }
  const avail = g.items.filter((i) => i.available);
  const prices = g.items.map((i) => i.price).filter((p) => p != null);
  const sample = avail[0] || g.items[0];
  const minPrice = prices.length ? itemPrice({ ...sample, price: Math.min(...prices) }, lang) : '';
  let text = `${icon} <a href="${esc(g.url)}">${esc(g.title)}</a>${minPrice ? ` · ${esc(minPrice)}` : ''}`;
  const names = avail.map((i) => esc(i.variant || i.title));
  const shown = names.slice(0, 6).join(', ');
  const parts = [];
  if (names.length) parts.push(`✓ ${shown}${names.length > 6 ? ` +${names.length - 6}` : ''}`);
  const unavailable = g.items.length - avail.length;
  if (unavailable) parts.push(t(lang, 'more_unavailable', { count: unavailable }));
  if (parts.length) text += `\n    <i>${parts.join(' · ')}</i>`;
  return text;
}

export function watchView(ctx, id, { page = 0, filter = null, notice = null } = {}) {
  const lang = ctx.lang;
  const w = ctx.getWatch(id);
  if (!w) return { text: t(lang, 'unknown_watch', { id: esc(id) }), keyboard: [[btn(t(lang, 'back'), 'stock')]] };

  const items = watchItems(ctx, id);
  const h = ctx.store.runtime.watches[id];
  const s = items ? summarizeItems(items) : null;
  const header = t(lang, 'watch_header', {
    icon: w.enabled ? stockIcon(s) : '⏸',
    name: esc(w.name),
    type: typeLabel(w),
    country: w.country ? ` · ${w.country}` : '',
    interval: w.enabled ? every(ctx, w.intervalSeconds) : t(lang, 'paused')
  });
  const lines = [header];
  if (w.note) lines.push(`<i>ℹ️ ${esc(w.note)}</i>`);
  const keyboard = [];

  if (!items) {
    lines.push('', t(lang, 'watch_no_data'));
  } else {
    const groups = groupItems(items);
    const multi = groups.length > 1;
    const f = filter || (groups.length > 8 ? 's' : 'a');
    const shown = f === 's' ? groups.filter((g) => g.available) : groups;
    const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const p = Math.min(Math.max(0, page), pages - 1);

    const grouped = s.groupCount !== s.itemCount;
    lines.push(
      t(lang, grouped ? 'watch_checked' : 'watch_checked_items', {
        time: ago(ctx, h && h.lastSuccessAt),
        groupsIn: s.groupsInStock,
        groups: s.groupCount,
        inStock: s.inStockCount,
        items: s.itemCount
      })
    );
    if (h && h.consecutiveFailures) lines.push(t(lang, 'watch_error', { error: esc(h.lastError) }));
    if (multi) {
      lines.push(
        t(lang, 'watch_filter', {
          filter: t(lang, f === 's' ? 'filter_in_stock' : 'filter_all'),
          page: p + 1,
          pages
        })
      );
    }
    lines.push('');
    const slice = shown.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    lines.push(slice.length ? slice.map((g) => groupBlock(ctx, g)).join('\n') : t(lang, 'watch_nothing_in_stock'));

    if (pages > 1) {
      keyboard.push([
        btn('◀️', `wi:${id}:${(p - 1 + pages) % pages}:${f}`),
        btn(`${p + 1}/${pages}`, 'noop'),
        btn('▶️', `wi:${id}:${(p + 1) % pages}:${f}`)
      ]);
    }
    if (multi) {
      keyboard.push([
        f === 's'
          ? btn(t(lang, 'btn_show_all'), `wi:${id}:0:a`)
          : btn(t(lang, 'btn_only_in_stock'), `wi:${id}:0:s`)
      ]);
    }
  }

  keyboard.push([
    btn(t(lang, 'btn_check_watch'), `wc:${id}`),
    w.enabled ? btn(t(lang, 'btn_pause'), `wp:${id}`) : btn(t(lang, 'btn_resume'), `wp:${id}`)
  ]);
  const row = [btn(t(lang, 'btn_interval', { interval: formatDuration(w.intervalSeconds * 1000, lang) }), `wn:${id}`)];
  if (w.custom) row.push(btn(t(lang, 'btn_remove'), `wr:${id}`));
  keyboard.push(row);
  const nav = [btn(t(lang, 'back'), 'stock')];
  if (w.url && /^https?:\/\//.test(w.url)) nav.unshift(urlBtn(t(lang, 'btn_open'), w.url));
  keyboard.push(nav);

  return { text: clip(withNotice(notice, lines.join('\n'))), keyboard };
}

export function removeConfirmView(ctx, id) {
  const lang = ctx.lang;
  const w = ctx.getWatch(id);
  if (!w) return watchesView(ctx);
  if (!w.custom) return watchView(ctx, id, { notice: t(lang, 'cannot_remove') });
  return {
    text: t(lang, 'confirm_remove', { name: esc(w.name) }),
    keyboard: [[btn(t(lang, 'btn_confirm_remove'), `wR:${id}`), btn(t(lang, 'btn_cancel'), `w:${id}`)]]
  };
}

export function watchesView(ctx, notice = null) {
  const lang = ctx.lang;
  const watches = ctx.watches();
  const lines = [t(lang, 'watches_title'), ''];
  const keyboard = [];
  watches.forEach((w, i) => {
    lines.push(
      t(lang, 'watches_line', {
        n: i + 1,
        icon: w.enabled ? '✅' : '⏸',
        name: esc(w.name),
        type: typeLabel(w),
        country: w.country ? ` · ${w.country}` : '',
        interval: w.enabled ? every(ctx, w.intervalSeconds) : t(lang, 'paused')
      })
    );
    keyboard.push([
      btn(`${i + 1}. ${w.name}`.slice(0, 60), `w:${w.id}`),
      w.enabled ? btn('⏸', `wpl:${w.id}`) : btn('▶️', `wpl:${w.id}`)
    ]);
  });
  if (!watches.length) lines.push(t(lang, 'stock_empty'));
  lines.push('', t(lang, 'watches_add_hint'));
  keyboard.push([btn(t(lang, 'menu'), 'menu')]);
  return { text: clip(withNotice(notice, lines.join('\n'))), keyboard };
}

export function checkLine(ctx, watch, result, nextDue) {
  const lang = ctx.lang;
  const name = esc(watch.name);
  if (result.ok && result.baseline) {
    return t(lang, 'check_baseline', { name, items: result.summary.itemCount });
  }
  if (result.ok) {
    const n = result.changes.length;
    return t(lang, 'check_ok', {
      name,
      inStock: result.summary.inStockCount,
      items: result.summary.itemCount,
      changes: n ? t(lang, 'n_changes', { count: n }) : t(lang, 'no_changes'),
      duration: formatDuration(result.durationMs, lang)
    });
  }
  if (result.rateLimited) return t(lang, 'check_rate_limited', { name, next: untilText(ctx, nextDue) });
  return t(lang, 'check_fail', { name, error: esc(result.error) });
}

export function checkResultView(ctx, results, monitor) {
  const lang = ctx.lang;
  const lines = [t(lang, 'check_title'), ''];
  if (!results.length) lines.push(t(lang, 'check_none'));
  for (const { watch, result } of results) lines.push(checkLine(ctx, watch, result, monitor.nextDue.get(watch.id)));
  return {
    text: clip(lines.join('\n')),
    keyboard: [
      [btn(t(lang, 'btn_stock'), 'stock'), btn(t(lang, 'btn_again'), 'chk')],
      [btn(t(lang, 'menu'), 'menu')]
    ]
  };
}

export function historyView(ctx, page = 0) {
  const lang = ctx.lang;
  const entries = ctx.store.runtime.history || [];
  const lines = [t(lang, 'history_title'), ''];
  const keyboard = [];
  if (!entries.length) {
    lines.push(t(lang, 'history_empty'));
  } else {
    const pages = Math.ceil(entries.length / HISTORY_PAGE);
    const p = Math.min(Math.max(0, page), pages - 1);
    for (const e of entries.slice(p * HISTORY_PAGE, (p + 1) * HISTORY_PAGE)) {
      const when = formatTime(e.at, ctx.timezone, lang).replace(/:\d\d$/, '');
      let line = `<code>${esc(when)}</code> ${CHANGE_ICON[e.type] || '•'} ${itemLine(e, lang, { link: true })}`;
      if (e.type === 'price' && e.oldPrice != null) {
        line += ` <i>(${t(lang, 'was_price', { price: esc(itemPrice({ ...e, price: e.oldPrice }, lang)) })})</i>`;
      }
      lines.push(`${line} <i>· ${esc(e.watchName || e.watchId)}</i>`);
    }
    if (pages > 1) {
      lines.push('', t(lang, 'history_page', { page: p + 1, pages }));
      keyboard.push([
        btn('◀️', `hist:${(p - 1 + pages) % pages}`),
        btn(`${p + 1}/${pages}`, 'noop'),
        btn('▶️', `hist:${(p + 1) % pages}`)
      ]);
    }
  }
  keyboard.push([btn(t(lang, 'menu'), 'menu')]);
  return { text: clip(lines.join('\n')), keyboard };
}

export function statusView(ctx, monitor) {
  const lang = ctx.lang;
  const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const muted = mutedText(ctx);
  const rt = ctx.store.runtime;
  const lines = [
    t(lang, 'status_title'),
    t(lang, 'status_version', { version: esc(ctx.version), uptime: formatDuration(Date.now() - ctx.startedAt, lang) }),
    t(lang, 'status_system', { mem, node: process.version }),
    muted ? t(lang, 'status_notify_muted', { until: muted }) : t(lang, 'status_notify_on')
  ];
  let report = t(lang, 'off');
  if (ctx.dailyReport()) {
    const next = rt.lastHeartbeatAt
      ? Date.parse(rt.lastHeartbeatAt) + ctx.config.health.statusIntervalHours * 3600 * 1000
      : null;
    report = `${t(lang, 'on')}${next ? ` (${untilText(ctx, next)})` : ''}`;
  }
  lines.push(t(lang, 'status_report', { state: report }));

  for (const w of ctx.watches()) {
    const h = rt.watches[w.id];
    lines.push('', `<b>${esc(w.name)}</b>`);
    const next = monitor ? monitor.nextDue.get(w.id) : null;
    if (!w.enabled) lines.push(t(lang, 'status_watch_paused'));
    else if (!h || !h.lastCheckAt) lines.push(t(lang, 'status_watch_pending'));
    else if (h.consecutiveFailures) {
      lines.push(t(lang, 'status_watch_fail', { count: h.consecutiveFailures, error: esc(h.lastError), next: untilText(ctx, next) }));
    } else {
      lines.push(
        t(lang, 'status_watch_ok', {
          last: ago(ctx, h.lastCheckAt),
          duration: formatDuration(h.lastDurationMs, lang),
          next: untilText(ctx, next)
        })
      );
    }
    if (h && h.totalChecks) lines.push(t(lang, 'status_watch_counts', { checks: h.totalChecks, failures: h.totalFailures }));
  }
  return {
    text: clip(lines.join('\n')),
    keyboard: [[btn(t(lang, 'btn_refresh'), 'st'), btn(t(lang, 'menu'), 'menu')]]
  };
}

export function settingsView(ctx, notice = null) {
  const lang = ctx.lang;
  const on = ctx.notifyOn();
  const q = ctx.quietHours();
  const keyboard = [];
  const toggles = NOTIFY_TYPES.map((type) => btn(`${on[type] ? '✅' : '⬜'} ${t(lang, `type_${type}`)}`, `sn:${type}`));
  for (let i = 0; i < toggles.length; i += 2) keyboard.push(toggles.slice(i, i + 2));
  keyboard.push([btn(t(lang, 'btn_quiet', { from: q.from, to: q.to, state: t(lang, q.enabled ? 'on' : 'off') }), 'sq')]);
  keyboard.push([btn(t(lang, 'btn_report', { state: t(lang, ctx.dailyReport() ? 'on' : 'off') }), 'sd')]);
  keyboard.push([btn(t(lang, 'btn_language'), 'sl')]);
  keyboard.push([btn(t(lang, 'menu'), 'menu')]);
  return {
    text: withNotice(notice, `${t(lang, 'settings_title')}\n${t(lang, 'settings_body')}\n\n<i>${t(lang, 'quiet_hint')}</i>`),
    keyboard
  };
}

export function muteView(ctx) {
  const lang = ctx.lang;
  const muted = mutedText(ctx);
  const keyboard = [
    [btn('30 min', 'mu:30'), btn('1 h', 'mu:60'), btn('3 h', 'mu:180')],
    [btn('8 h', 'mu:480'), btn('24 h', 'mu:1440'), btn(t(lang, 'mute_forever'), 'mu:-1')]
  ];
  if (muted) keyboard.push([btn(t(lang, 'btn_unmute'), 'mu:0')]);
  keyboard.push([btn(t(lang, 'menu'), 'menu')]);
  return {
    text: t(lang, 'mute_title') + (muted ? `\n\n${t(lang, 'main_muted', { until: muted })}` : ''),
    keyboard
  };
}

export function helpView(ctx) {
  return { text: t(ctx.lang, 'help'), keyboard: [[btn(t(ctx.lang, 'btn_menu'), 'menu')]] };
}

function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

export function searchView(ctx, query) {
  const lang = ctx.lang;
  const q = fold(query).trim();
  const wordRe = new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
  const results = [];
  for (const w of ctx.watches()) {
    const items = watchItems(ctx, w.id);
    if (!items) continue;
    for (const g of groupItems(items)) {
      // Whole-word title hits first ("r4" should not rank "FR4 plate" first), then any title hit, then variants.
      const title = fold(g.title);
      let score = 0;
      if (wordRe.test(title)) score = 3;
      else if (title.includes(q)) score = 2;
      else if (g.items.some((i) => fold(i.variant).includes(q))) score = 1;
      if (score) results.push({ w, g, score });
    }
  }
  results.sort((a, b) => b.score - a.score || Number(b.g.available) - Number(a.g.available));
  const lines = [t(lang, 'search_title', { query: esc(query) }), ''];
  if (!results.length) {
    lines[0] = t(lang, 'search_none', { query: esc(query) });
    lines.length = 1;
  }
  for (const { w, g } of results.slice(0, 15)) lines.push(`${groupBlock(ctx, g)} <i>· ${esc(w.name)}</i>`);
  if (results.length > 15) lines.push(t(lang, 'search_more', { count: results.length - 15 }));
  return { text: clip(lines.join('\n')), keyboard: [[btn(t(lang, 'btn_stock'), 'stock'), btn(t(lang, 'menu'), 'menu')]] };
}

export function nextInterval(current, min) {
  const steps = INTERVAL_STEPS.filter((s) => s >= min);
  return steps.find((s) => s > current) || steps[0];
}
