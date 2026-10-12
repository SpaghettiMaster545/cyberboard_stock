# Stock Bot

A small, dependency-free bot that watches online stores and pings you on **Telegram** the
moment something comes **back in stock** (or sells out, gets listed, changes price).
You control it from Telegram: menus with buttons, stock overview, manual checks, mute,
search, adding new stores by pasting a link.

Out of the box it watches:

| Watch | What | How |
| --- | --- | --- |
| `steam-frame-ergo` | **Steam Frame Ergonomic Accessories Kit** (package `1727363`, Poland) | Steam hardware stock API |
| `steam-frame` | Steam Frame 256GB / 1TB, PSU, Replacement Kit (paused by default) | Steam hardware stock API |
| `angrymiao` | the whole [Angry Miao store](https://store.angrymiao.com) | Shopify `products.json` |

Supported sources:

- **Shopify stores** — whole store, collections, or single products (`products.json` / `products/<handle>.js`).
- **Steam hardware** — any Steam hardware package (Steam Frame, Steam Deck, Steam Controller, ...)
  via `IStoreBrowseService/GetHardwareItems`, the same data the store page uses to show
  "Out of stock" (falls back to `IPhysicalGoodsService/CheckInventoryAvailableByPackage`).
- **Any web page** — availability decided by text patterns ("Add to cart" / "Sold out").

Zero runtime dependencies: Node.js 20+ and its built-in `fetch`.

---

## Telegram bot

Open your bot and send `/menu` (or tap the **Menu** button next to the text field —
the command list is registered automatically, in Polish and English).

```
🤖 Stock Bot
Obserwacje: 2 aktywne z 3 · dostępnych pozycji: 293
[📦 Stan magazynu] [🔄 Sprawdź teraz]
[👀 Obserwowane]   [📜 Historia]
[⚙️ Ustawienia]    [🔕 Wycisz]
[ℹ️ Status]        [❓ Pomoc]
```

| Command | What it does |
| --- | --- |
| `/menu`, `/start` | Main menu with buttons |
| `/stock [watch]` | Stock overview; tap a watch for its items (paged, "in stock only" filter, links) |
| `/check [watch]` | Check right now and show the result |
| `/watches` | All watches: pause/resume, check interval, remove (watches added from Telegram) |
| `/search <text>` | Find a product across all watches (or just send the name) |
| `/history` | Recent stock changes |
| `/status` | Health: last/next check per watch, errors, uptime, memory |
| `/settings` | Which alerts you get (restock / sold out / new / price / removed), quiet hours, daily report, language (PL/EN) |
| `/mute [2h]`, `/unmute` | Alerts keep coming, but silently |
| `/add <link>` | Watch a new Shopify product / collection / store or Steam hardware page, or `steam <package ids> [country]` |
| `/id` | Show the chat id (works for anyone — handy for adding another chat) |

Pasting a link in a private chat offers to add it; any other text searches.
Also available: `/pause <watch>`, `/resume <watch>`, `/interval <watch> <seconds>`, `/remove <watch>`.

Alerts:

- **Restocks** ring (with an *Open store* button); sell-outs/price changes arrive silently.
- While muted or during quiet hours everything is delivered silently instead of dropped.
- A failing store is reported only when it keeps failing (default: 3 checks in a row *and*
  at least 5 minutes), with a single "recovered" message afterwards — no spam from one-off
  HTTP 429s.
- On every deploy with new code the bot sends a short "started" message, plus a daily report.

Only chats listed in `TELEGRAM_CHAT_ID` can use the bot; everyone else just gets their chat id.

---

## Quick local run

```bash
node --version                 # 20+
cp .env.example .env           # put TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in it
npm run self-test              # checks every store once + Telegram connectivity, saves nothing
npm start                      # watch mode: checks + interactive Telegram bot
npm test                       # unit + end-to-end tests (fake Telegram server, no network)
```

Don't know your chat id? Start the bot and send it `/id`.

Without Telegram credentials the bot still runs and prints alerts to the console.

---

## Configuration (`config.json`)

```json
{
  "language": "pl",
  "timezone": "Europe/Warsaw",
  "defaultIntervalSeconds": 60,
  "steamCountry": "PL",
  "notifyOn": { "restock": true, "soldOut": true, "newProduct": true, "priceChange": false, "removed": false },
  "silentTypes": ["soldOut", "priceChange", "removed"],
  "quietHours": { "enabled": false, "from": 23, "to": 8 },
  "health": { "dailyReport": true, "statusIntervalHours": 24, "alertAfterFailures": 3, "alertAfterMinutes": 5, "repeatErrorAlertMinutes": 60 },
  "watches": [ ... ]
}
```

Settings changed from Telegram (mute, alert toggles, language, paused watches, intervals,
added watches) are stored in `data/settings.json` and override `config.json`.

### Watch types

Every watch has `id` (1–24 chars, `a-z0-9-`), `type`, and optionally `name`,
`intervalSeconds`, `enabled`, `url` (for the *Open* button), `note` (shown in the watch
view and in restock alerts) and `notifyOn` (per-watch alert toggles).

**Shopify**

```jsonc
{ "id": "angrymiao", "type": "shopify", "store": "https://store.angrymiao.com",
  "allProducts": true,                       // or:
  "collections": ["cyberboard-collection"],  //   specific collections
  "products": ["am-cyberboard-r4"],          //   and/or specific product handles
  "include": ["cyberboard"], "exclude": ["sticker"],  // optional title filters
  "currency": "USD", "intervalSeconds": 60 }
```

**Steam hardware**

```json
{ "id": "steam-frame-ergo", "type": "steam", "name": "Steam Frame – Ergonomic Kit",
  "packages": [1727363], "country": "PL",
  "url": "https://store.steampowered.com/hardware/steamframe", "intervalSeconds": 45 }
```

Find package ids for any Steam hardware page (with live stock):

```bash
npm run steam-discover -- https://store.steampowered.com/hardware/steamframe PL
```

**Any web page**

```json
{ "id": "shop-x", "type": "page", "name": "Widget at Shop X",
  "url": "https://shop.example/widget",
  "inStock": "add to cart", "outOfStock": "sold out|notify me",
  "price": "class=\"price\">([^<]+)<", "currency": "PLN" }
```

Patterns are case-insensitive regular expressions. If both patterns are set and neither
matches, the check fails instead of guessing. Use `"items": [{ "id", "name", "url", "inStock", "outOfStock" }, ...]`
to watch several pages in one watch.

---

## Hosting: Oracle Cloud VM (current setup)

`.github/workflows/deploy-oracle.yml` deploys on every push to `main` that touches the
app (or manually via **Actions → Deploy To Oracle → Run workflow**, on any branch). It:

1. runs the test suite,
2. uploads `src/`, `scripts/`, `config.json`, `package.json` over SSH,
3. writes the Telegram secrets to the remote `.env`,
4. installs/updates the `angrymiao-stock-bot` systemd service and restarts it,
5. runs `node src/index.js --self-test` on the server (every store once + Telegram `getMe`),
6. verifies the service stays up, the Telegram bot connected and a stock check succeeded,
7. prints the recent logs.

Required repository secrets: `ORACLE_HOST`, `ORACLE_USER`, `ORACLE_SSH_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Optional: `ORACLE_SSH_PORT` (22),
`ORACLE_APP_DIR` (`/home/<user>/angrymiao-stock-bot`). The VM user needs passwordless `sudo`.

State lives on the VM under `data/` and survives redeploys. The first start of this version
migrates the old Angry Miao baseline, so the upgrade neither re-announces every product nor
misses changes.

Useful on the VM:

```bash
sudo journalctl -u angrymiao-stock-bot -f        # live logs
sudo systemctl restart angrymiao-stock-bot
cd ~/angrymiao-stock-bot && node src/index.js --self-test
```

### Other options

- **Docker:** `docker build -t stock-bot . && docker run -d --restart unless-stopped -e TELEGRAM_BOT_TOKEN=... -e TELEGRAM_CHAT_ID=... -v "$(pwd)/data:/app/data" stock-bot`
- **GitHub Actions one-off check:** *Manual Stock Check* runs `--once` and commits `data/state.json`
  (manual only, so it doesn't duplicate the VM's alerts).

---

## How it works

```
sources (Shopify / Steam / page) -> items { id, title, variant, available, price, url }
        -> diff against data/state.json -> alerts (Telegram) + data/runtime.json (health, history)
```

- Each watch runs on its own interval; checks are queued so a store is never hit in parallel.
- **HTTP 429** (rate limiting) is never retried immediately: the watch backs off 2×, 4×, 8×
  its interval (honouring `Retry-After`), and "Check now" skips a store that is cooling down.
- Empty responses and sudden big drops in item count are treated as glitches (a drop is
  accepted only after it is seen 3 checks in a row) — no false "everything sold out" alerts.
- If Telegram is unreachable, the new state is not saved, so the alert is sent on the next check.
- Shopify responses are cache-busted (Shopify page-caches `products.json`).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No messages | `npm run self-test -- --send`; check token and chat id; press **Start** in the bot chat. |
| Bot ignores commands | Your chat id must be in `TELEGRAM_CHAT_ID` (send `/id`). Logs show `getUpdates conflict` if another process polls the same token — stop it (incl. `npm run chat-id`). |
| Angry Miao `HTTP 429` in logs | The store rate-limits; the bot backs off automatically. Raise `intervalSeconds` if it persists. |
| Deploy fails on SSH / sudo | Check `ORACLE_*` secrets and passwordless sudo for the VM user. |

---

## Project layout

```
src/
  index.js            entry point (--watch | --once | --self-test)
  config.js           config.json + .env loading, watch validation
  context.js          shared state: config + Telegram-made settings
  monitor.js          scheduling, diffing, alerts, health, backoff
  store.js            data/state.json, runtime.json, settings.json (+ legacy migration)
  diff.js format.js i18n.js util.js
  sources/            shopify.js, steam.js, page.js, index.js (registry + /add link detection)
  telegram/           api.js (Bot API client), notifier.js, bot.js (commands), views.js (menus)
scripts/              get-chat-id.js, test-telegram.js, steam-discover.js
test/                 node:test suites (fake fetch + fake Telegram server)
deploy/oracle/        systemd installer used by the deploy workflow
```
