/**
 * UI strings. `{name}` placeholders are filled by t(). Values are inserted
 * as-is, so callers escape anything user/store provided before passing it in.
 */
const pl = {
  // generic
  in_stock: 'dostępne',
  sold_out: 'brak',
  ago: '{time} temu',
  in_time: 'za {time}',
  never: 'nigdy',
  now: 'teraz',
  back: '⬅️ Wstecz',
  menu: '⬅️ Menu',
  on: 'wł.',
  off: 'wył.',
  every: 'co {time}',
  paused: 'wstrzymane',
  unknown_watch: 'Nie znam obserwacji „{id}”.',
  not_modified: 'Bez zmian',
  done: 'Gotowe ✅',

  // alerts
  label_restock: 'DOSTĘPNE!',
  label_soldout: 'Wyprzedane',
  label_new: 'Nowość',
  label_price: 'Zmiana ceny',
  label_removed: 'Usunięte',
  changes_header: '🔔 <b>{name}</b> · zmiany: {count}',
  was_price: 'było {price}',
  view_product: 'Zobacz produkt',
  open_store: '🛒 Otwórz sklep',
  baseline_new: '👀 <b>Nowa obserwacja: {name}</b>\nŚledzę pozycji: <b>{items}</b> · dostępnych: <b>{inStock}</b>',
  baseline_reset: '↻ <b>{name}</b>: zakres obserwacji się zmienił — zapisałem nowy stan bez wysyłania alertów.\nPozycji: <b>{items}</b> · dostępnych: <b>{inStock}</b>',
  baseline_footer: 'Dam znać, gdy coś się zmieni.',
  failure_alert:
    '⚠️ <b>Problem ze sprawdzaniem: {name}</b>\nBłąd: <code>{error}</code>\nNieudane próby z rzędu: <b>{count}</b> (od {since})\nOstatnie udane sprawdzenie: {lastOk}',
  recovery_alert: '✅ <b>{name}</b> znów działa\nPo {count} nieudanych próbach (przerwa: {downtime}).',
  startup:
    '🤖 <b>Stock Bot uruchomiony</b> (v{version})\nObserwuję:\n{watches}\n\nOtwórz /menu, żeby zobaczyć stan i opcje.',
  daily_report: '📊 <b>Raport dzienny</b>\nBot działa normalnie (od {uptime}).\n{watches}\n\nZmiany przez ostatnie {hours} h: <b>{changes}</b> · błędy: <b>{failures}</b>',

  // main menu
  main_title: '🤖 <b>Stock Bot</b>',
  main_summary: 'Obserwacje: <b>{active}</b> aktywne z {total} · dostępnych pozycji: <b>{inStock}</b>',
  main_last_check: 'Ostatnie sprawdzenie: {time}',
  main_muted: '🔕 Wyciszone {until}',
  main_quiet: '🌙 Trwa cisza nocna ({from}:00–{to}:00)',
  main_pick: 'Wybierz opcję:',
  btn_stock: '📦 Stan magazynu',
  btn_check: '🔄 Sprawdź teraz',
  btn_watches: '👀 Obserwowane',
  btn_history: '📜 Historia',
  btn_settings: '⚙️ Ustawienia',
  btn_mute: '🔕 Wycisz',
  btn_unmute: '🔔 Włącz dźwięk',
  btn_status: 'ℹ️ Status',
  btn_help: '❓ Pomoc',
  btn_menu: '📋 Menu',

  // stock
  stock_title: '📦 <b>Stan magazynu</b>',
  stock_empty: 'Brak obserwacji. Dodaj: /add &lt;link&gt;',
  stock_line_groups: '{icon} <b>{name}</b>\n   produkty: {groupsIn}/{groups} · warianty: {inStock}/{items} · {checked}',
  stock_line_items: '{icon} <b>{name}</b>\n   dostępne: {inStock}/{items} · {checked}',
  stock_line_nodata: '⏳ <b>{name}</b>\n   jeszcze nie sprawdzono',
  stock_line_paused: '⏸ <b>{name}</b> ({paused})',
  checked: 'sprawdzono {time}',

  // watch view
  watch_header: '{icon} <b>{name}</b>\n<i>{type}{country} · {interval}</i>',
  watch_checked: 'Sprawdzono: {time} · dostępne produkty: <b>{groupsIn}/{groups}</b>',
  watch_checked_items: 'Sprawdzono: {time} · dostępne: <b>{inStock}/{items}</b>',
  watch_no_data: 'Jeszcze nie sprawdzono — kliknij 🔄.',
  watch_error: '⚠️ Ostatni błąd: <code>{error}</code>',
  watch_filter: 'Filtr: {filter} · strona {page}/{pages}',
  filter_in_stock: 'tylko dostępne',
  filter_all: 'wszystkie',
  watch_nothing_in_stock: '<i>Nic nie jest teraz dostępne.</i>',
  more_unavailable: '+{count} niedostępne',
  high_demand: 'dużo zamówień',
  waitlist: 'lista oczekujących',
  btn_only_in_stock: '🟢 Tylko dostępne',
  btn_show_all: '📋 Pokaż wszystkie',
  btn_check_watch: '🔄 Sprawdź',
  btn_pause: '⏸ Wstrzymaj',
  btn_resume: '▶️ Wznów',
  btn_interval: '⏱ {interval}',
  btn_remove: '🗑 Usuń',
  btn_confirm_remove: '🗑 Tak, usuń',
  btn_cancel: '✖️ Anuluj',
  btn_open: '🌐 Otwórz stronę',
  confirm_remove: 'Usunąć obserwację <b>{name}</b>? Historia i stan zostaną skasowane.',
  removed_watch: '🗑 Usunięto obserwację <b>{name}</b>.',
  cannot_remove: 'Obserwacji z config.json nie da się usunąć — możesz ją wstrzymać.',
  paused_toast: '⏸ Wstrzymano: {name}',
  resumed_toast: '▶️ Wznowiono: {name}',
  interval_toast: '⏱ Sprawdzanie co {interval}',

  // watches list
  watches_title: '👀 <b>Obserwowane</b>',
  watches_line: '{n}. {icon} <b>{name}</b> — {type}{country} · {interval}',
  watches_add_hint: '➕ Dodaj nową: wyślij link do produktu, kolekcji lub sklepu (Shopify) albo strony sprzętu Steam, np.\n<code>/add https://store.steampowered.com/hardware/steamframe</code>\n<code>/add steam 1727363</code>',

  // check
  checking: '⏳ Sprawdzam…',
  check_title: '🔄 <b>Wynik sprawdzenia</b>',
  check_ok: '✅ <b>{name}</b>: dostępne {inStock}/{items} · {changes} ({duration})',
  check_baseline: '✅ <b>{name}</b>: zapisano stan początkowy ({items} poz.)',
  check_fail: '⚠️ <b>{name}</b>: <code>{error}</code>',
  check_rate_limited: '⏳ <b>{name}</b>: sklep ogranicza zapytania (HTTP 429) — ponowię {next}',
  check_none: 'Brak aktywnych obserwacji.',
  no_changes: 'bez zmian',
  n_changes: 'zmiany: {count}',
  btn_again: '🔄 Jeszcze raz',

  // history
  history_title: '📜 <b>Ostatnie zmiany</b>',
  history_empty: 'Na razie brak zmian.',
  history_page: 'Strona {page}/{pages}',

  // status
  status_title: 'ℹ️ <b>Status bota</b>',
  status_version: 'Wersja: v{version} · działa od {uptime}',
  status_system: 'Pamięć: {mem} MB · Node {node}',
  status_notify_on: 'Powiadomienia: 🔔 włączone',
  status_notify_muted: 'Powiadomienia: 🔕 wyciszone {until}',
  status_report: 'Raport dzienny: {state}',
  status_watch_ok: '✅ OK · {last} ({duration}) · następne {next}',
  status_watch_fail: '⚠️ Błędy z rzędu: {count} · <code>{error}</code> · następne {next}',
  status_watch_paused: '⏸ wstrzymane',
  status_watch_pending: '⏳ czeka na pierwsze sprawdzenie',
  status_watch_counts: 'Sprawdzeń: {checks} · błędów: {failures}',
  btn_refresh: '🔄 Odśwież',

  // settings
  settings_title: '⚙️ <b>Ustawienia</b>',
  settings_body: 'Kliknij, aby przełączyć. Powiadamiaj o:',
  type_restock: 'Powrót do sprzedaży',
  type_soldOut: 'Wyprzedanie',
  type_newProduct: 'Nowe produkty',
  type_priceChange: 'Zmiany cen',
  type_removed: 'Usunięte produkty',
  btn_quiet: '🌙 Cisza nocna {from}–{to}: {state}',
  btn_report: '📊 Raport dzienny: {state}',
  btn_language: '🌐 Język: Polski',
  quiet_hint: 'W ciszy nocnej i podczas wyciszenia alerty przychodzą bez dźwięku.',

  // mute
  mute_title: '🔕 <b>Wyciszenie</b>\nAlerty dalej przychodzą, ale bez dźwięku. Na jak długo?',
  mute_forever: 'Do odwołania',
  muted_until: 'do {time}',
  muted_forever: 'do odwołania',
  muted_toast: '🔕 Wyciszono {until}',
  unmuted: '🔔 Dźwięk powiadomień włączony.',
  mute_usage: 'Użycie: /mute 2h · /mute 30m · /mute (menu)',

  // search
  search_usage: 'Napisz, czego szukać, np. <code>/search r4</code> — albo po prostu wyślij samą nazwę.',
  search_title: '🔎 <b>Wyniki dla „{query}”</b>',
  search_none: 'Nic nie znalazłem dla „{query}”.',
  search_more: '…i jeszcze {count}',

  // add
  add_usage: 'Użycie: <code>/add &lt;link&gt;</code>\nObsługiwane: sklepy Shopify (produkt, kolekcja, cały sklep), strony sprzętu Steam, <code>steam &lt;id pakietu&gt; [kraj]</code>.',
  add_bad_url: 'To nie wygląda na poprawny link.',
  add_steam_none: 'Nie znalazłem na tej stronie Steam żadnych pakietów do kupienia.',
  add_rate_limited: 'Sklep chwilowo ogranicza zapytania (HTTP 429). Spróbuj za minutę.',
  add_unsupported: 'Nie umiem automatycznie obserwować {host}. Dla innych sklepów dodaj obserwację typu „page” w config.json (wzorce tekstu „w magazynie”/„wyprzedane”).',
  add_detecting: '⏳ Rozpoznaję link…',
  add_exists: 'To już jest obserwowane jako <b>{name}</b>.',
  add_done: '✅ Dodano obserwację <b>{name}</b> ({type}).',
  add_failed: '⚠️ Nie udało się dodać: <code>{error}</code>',
  add_offer: 'Wygląda na link. Dodać go do obserwowanych?',
  btn_add: '➕ Dodaj obserwację',
  add_expired: 'Ta propozycja wygasła — wyślij link jeszcze raz.',

  // misc commands
  help:
    '❓ <b>Pomoc</b>\n' +
    '/menu — menu główne\n' +
    '/stock — stan magazynu\n' +
    '/check — sprawdź teraz\n' +
    '/watches — obserwowane (wstrzymaj, interwał, usuń)\n' +
    '/search &lt;tekst&gt; — szukaj produktu\n' +
    '/history — ostatnie zmiany\n' +
    '/status — zdrowie bota\n' +
    '/settings — rodzaje powiadomień, cisza nocna, język\n' +
    '/mute [2h] · /unmute — wyciszenie\n' +
    '/add &lt;link&gt; — dodaj obserwację\n' +
    '/id — pokaż id czatu\n\n' +
    'Wskazówka: wyślij samą nazwę produktu, żeby go wyszukać, albo link, żeby go dodać.',
  chat_id: 'Id tego czatu: <code>{id}</code>',
  unauthorized: '⛔ To prywatny bot.\nId tego czatu: <code>{id}</code>\nAby uzyskać dostęp, dopisz je do <code>TELEGRAM_CHAT_ID</code> i zrestartuj bota.',
  unknown_command: 'Nie znam tej komendy. Zobacz /help.',
  error_generic: '⚠️ Coś poszło nie tak: <code>{error}</code>',

  // command menu (setMyCommands)
  cmd_menu: 'Menu główne',
  cmd_stock: 'Stan magazynu',
  cmd_check: 'Sprawdź teraz',
  cmd_watches: 'Obserwowane',
  cmd_search: 'Szukaj produktu',
  cmd_history: 'Ostatnie zmiany',
  cmd_status: 'Status bota',
  cmd_settings: 'Ustawienia',
  cmd_mute: 'Wycisz powiadomienia',
  cmd_unmute: 'Włącz dźwięk',
  cmd_add: 'Dodaj obserwację (link)',
  cmd_help: 'Pomoc'
};

const en = {
  in_stock: 'in stock',
  sold_out: 'sold out',
  ago: '{time} ago',
  in_time: 'in {time}',
  never: 'never',
  now: 'now',
  back: '⬅️ Back',
  menu: '⬅️ Menu',
  on: 'on',
  off: 'off',
  every: 'every {time}',
  paused: 'paused',
  unknown_watch: 'Unknown watch "{id}".',
  not_modified: 'No changes',
  done: 'Done ✅',

  label_restock: 'BACK IN STOCK',
  label_soldout: 'Sold out',
  label_new: 'New listing',
  label_price: 'Price change',
  label_removed: 'Removed',
  changes_header: '🔔 <b>{name}</b> · changes: {count}',
  was_price: 'was {price}',
  view_product: 'View product',
  open_store: '🛒 Open store',
  baseline_new: '👀 <b>Now watching: {name}</b>\nItems tracked: <b>{items}</b> · in stock: <b>{inStock}</b>',
  baseline_reset: '↻ <b>{name}</b>: the watched scope changed, so I saved a fresh baseline without per-item alerts.\nItems: <b>{items}</b> · in stock: <b>{inStock}</b>',
  baseline_footer: "I'll message you when something changes.",
  failure_alert:
    '⚠️ <b>Check failing: {name}</b>\nError: <code>{error}</code>\nConsecutive failures: <b>{count}</b> (since {since})\nLast successful check: {lastOk}',
  recovery_alert: '✅ <b>{name}</b> recovered\nAfter {count} failed checks (downtime: {downtime}).',
  startup: '🤖 <b>Stock Bot started</b> (v{version})\nWatching:\n{watches}\n\nOpen /menu for stock and options.',
  daily_report: '📊 <b>Daily report</b>\nBot is running normally (up {uptime}).\n{watches}\n\nChanges in the last {hours}h: <b>{changes}</b> · errors: <b>{failures}</b>',

  main_title: '🤖 <b>Stock Bot</b>',
  main_summary: 'Watches: <b>{active}</b> active of {total} · items in stock: <b>{inStock}</b>',
  main_last_check: 'Last check: {time}',
  main_muted: '🔕 Muted {until}',
  main_quiet: '🌙 Quiet hours active ({from}:00–{to}:00)',
  main_pick: 'Pick an option:',
  btn_stock: '📦 Stock',
  btn_check: '🔄 Check now',
  btn_watches: '👀 Watches',
  btn_history: '📜 History',
  btn_settings: '⚙️ Settings',
  btn_mute: '🔕 Mute',
  btn_unmute: '🔔 Unmute',
  btn_status: 'ℹ️ Status',
  btn_help: '❓ Help',
  btn_menu: '📋 Menu',

  stock_title: '📦 <b>Stock overview</b>',
  stock_empty: 'Nothing is being watched. Add something: /add &lt;link&gt;',
  stock_line_groups: '{icon} <b>{name}</b>\n   products: {groupsIn}/{groups} · variants: {inStock}/{items} · {checked}',
  stock_line_items: '{icon} <b>{name}</b>\n   in stock: {inStock}/{items} · {checked}',
  stock_line_nodata: '⏳ <b>{name}</b>\n   not checked yet',
  stock_line_paused: '⏸ <b>{name}</b> ({paused})',
  checked: 'checked {time}',

  watch_header: '{icon} <b>{name}</b>\n<i>{type}{country} · {interval}</i>',
  watch_checked: 'Checked: {time} · products in stock: <b>{groupsIn}/{groups}</b>',
  watch_checked_items: 'Checked: {time} · in stock: <b>{inStock}/{items}</b>',
  watch_no_data: 'Not checked yet — tap 🔄.',
  watch_error: '⚠️ Last error: <code>{error}</code>',
  watch_filter: 'Filter: {filter} · page {page}/{pages}',
  filter_in_stock: 'in stock only',
  filter_all: 'all',
  watch_nothing_in_stock: '<i>Nothing is in stock right now.</i>',
  more_unavailable: '+{count} unavailable',
  high_demand: 'high demand',
  waitlist: 'waitlist',
  btn_only_in_stock: '🟢 In stock only',
  btn_show_all: '📋 Show all',
  btn_check_watch: '🔄 Check',
  btn_pause: '⏸ Pause',
  btn_resume: '▶️ Resume',
  btn_interval: '⏱ {interval}',
  btn_remove: '🗑 Remove',
  btn_confirm_remove: '🗑 Yes, remove',
  btn_cancel: '✖️ Cancel',
  btn_open: '🌐 Open page',
  confirm_remove: 'Remove <b>{name}</b>? Its saved state and history will be deleted.',
  removed_watch: '🗑 Removed <b>{name}</b>.',
  cannot_remove: 'Watches from config.json cannot be removed — pause it instead.',
  paused_toast: '⏸ Paused: {name}',
  resumed_toast: '▶️ Resumed: {name}',
  interval_toast: '⏱ Checking every {interval}',

  watches_title: '👀 <b>Watches</b>',
  watches_line: '{n}. {icon} <b>{name}</b> — {type}{country} · {interval}',
  watches_add_hint: '➕ Add one: send a link to a Shopify product, collection or store, or a Steam hardware page, e.g.\n<code>/add https://store.steampowered.com/hardware/steamframe</code>\n<code>/add steam 1727363</code>',

  checking: '⏳ Checking…',
  check_title: '🔄 <b>Check results</b>',
  check_ok: '✅ <b>{name}</b>: in stock {inStock}/{items} · {changes} ({duration})',
  check_baseline: '✅ <b>{name}</b>: baseline saved ({items} items)',
  check_fail: '⚠️ <b>{name}</b>: <code>{error}</code>',
  check_rate_limited: '⏳ <b>{name}</b>: the store is rate limiting (HTTP 429) — retrying {next}',
  check_none: 'No active watches.',
  no_changes: 'no changes',
  n_changes: 'changes: {count}',
  btn_again: '🔄 Again',

  history_title: '📜 <b>Recent changes</b>',
  history_empty: 'No changes yet.',
  history_page: 'Page {page}/{pages}',

  status_title: 'ℹ️ <b>Bot status</b>',
  status_version: 'Version: v{version} · up {uptime}',
  status_system: 'Memory: {mem} MB · Node {node}',
  status_notify_on: 'Notifications: 🔔 on',
  status_notify_muted: 'Notifications: 🔕 muted {until}',
  status_report: 'Daily report: {state}',
  status_watch_ok: '✅ OK · {last} ({duration}) · next {next}',
  status_watch_fail: '⚠️ Failures in a row: {count} · <code>{error}</code> · next {next}',
  status_watch_paused: '⏸ paused',
  status_watch_pending: '⏳ waiting for the first check',
  status_watch_counts: 'Checks: {checks} · failures: {failures}',
  btn_refresh: '🔄 Refresh',

  settings_title: '⚙️ <b>Settings</b>',
  settings_body: 'Tap to toggle. Notify me about:',
  type_restock: 'Restocks',
  type_soldOut: 'Sell-outs',
  type_newProduct: 'New products',
  type_priceChange: 'Price changes',
  type_removed: 'Removed products',
  btn_quiet: '🌙 Quiet hours {from}–{to}: {state}',
  btn_report: '📊 Daily report: {state}',
  btn_language: '🌐 Language: English',
  quiet_hint: 'During quiet hours and while muted, alerts arrive without sound.',

  mute_title: '🔕 <b>Mute</b>\nAlerts still arrive, just silently. For how long?',
  mute_forever: 'Until I unmute',
  muted_until: 'until {time}',
  muted_forever: 'until unmuted',
  muted_toast: '🔕 Muted {until}',
  unmuted: '🔔 Notification sound is back on.',
  mute_usage: 'Usage: /mute 2h · /mute 30m · /mute (menu)',

  search_usage: 'Tell me what to look for, e.g. <code>/search r4</code> — or just send the name.',
  search_title: '🔎 <b>Results for "{query}"</b>',
  search_none: 'Nothing found for "{query}".',
  search_more: '…and {count} more',

  add_usage: 'Usage: <code>/add &lt;link&gt;</code>\nSupported: Shopify stores (product, collection, whole store), Steam hardware pages, <code>steam &lt;package id&gt; [country]</code>.',
  add_bad_url: "That doesn't look like a valid link.",
  add_steam_none: "I couldn't find any purchasable packages on that Steam page.",
  add_rate_limited: 'The store is rate limiting right now (HTTP 429). Try again in a minute.',
  add_unsupported: 'I can\'t watch {host} automatically. For other shops add a "page" watch in config.json (in-stock / sold-out text patterns).',
  add_detecting: '⏳ Inspecting the link…',
  add_exists: 'Already watched as <b>{name}</b>.',
  add_done: '✅ Added <b>{name}</b> ({type}).',
  add_failed: '⚠️ Could not add it: <code>{error}</code>',
  add_offer: 'That looks like a link. Add it to your watches?',
  btn_add: '➕ Add watch',
  add_expired: 'That suggestion expired — send the link again.',

  help:
    '❓ <b>Help</b>\n' +
    '/menu — main menu\n' +
    '/stock — stock overview\n' +
    '/check — check now\n' +
    '/watches — watches (pause, interval, remove)\n' +
    '/search &lt;text&gt; — find a product\n' +
    '/history — recent changes\n' +
    '/status — bot health\n' +
    '/settings — alert types, quiet hours, language\n' +
    '/mute [2h] · /unmute — mute\n' +
    '/add &lt;link&gt; — add a watch\n' +
    '/id — show this chat id\n\n' +
    'Tip: send a product name to search, or a link to add it.',
  chat_id: 'This chat id: <code>{id}</code>',
  unauthorized: '⛔ This is a private bot.\nThis chat id: <code>{id}</code>\nTo get access add it to <code>TELEGRAM_CHAT_ID</code> and restart the bot.',
  unknown_command: 'Unknown command. See /help.',
  error_generic: '⚠️ Something went wrong: <code>{error}</code>',

  cmd_menu: 'Main menu',
  cmd_stock: 'Stock overview',
  cmd_check: 'Check now',
  cmd_watches: 'Watches',
  cmd_search: 'Find a product',
  cmd_history: 'Recent changes',
  cmd_status: 'Bot status',
  cmd_settings: 'Settings',
  cmd_mute: 'Mute notifications',
  cmd_unmute: 'Unmute',
  cmd_add: 'Add a watch (link)',
  cmd_help: 'Help'
};

const dictionaries = { pl, en };
export const LANGUAGES = Object.keys(dictionaries);

export function t(lang, key, params = {}) {
  const dict = dictionaries[lang] || dictionaries.en;
  const template = dict[key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

export function hasKey(key) {
  return key in dictionaries.en;
}
