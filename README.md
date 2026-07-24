# Angry Miao Stock Bot

A lightweight bot that watches the [Angry Miao store](https://store.angrymiao.com)
(the [CYBERBOARD collection](https://store.angrymiao.com/collections/cyberboard-collection)
by default, optionally the **whole store**) and sends you a **Telegram** message the
moment anything comes **back in stock**, sells out, gets listed, or changes price.

It reads Angry Miao's public Shopify data (`products.json`), so it needs **no browser**
at runtime — which makes it tiny, fast, and easy to host **for free, 24/7**.

- Zero runtime dependencies (just Node.js 18+ and its built-in `fetch`).
- Two ways to run: a scheduled **GitHub Actions** job (recommended, free) or a
  continuous **watch** loop (Docker / VPS / Raspberry Pi).

---

## Security note (please read)

You shared your bot token in a chat. Treat it like a password. Once everything works,
consider **revoking and regenerating** it in Telegram's [@BotFather](https://t.me/BotFather)
(`/revoke` → pick the bot → get a new token), then update your `.env` / GitHub secret.

The token lives only in:
- `.env` locally (this file is **gitignored** — never committed), and
- **GitHub repository secrets** when hosted.

It is never written into tracked source files.

---

## 1. Quick local test

```powershell
# from the project folder
node --version        # must be 18 or newer

# 1) Find your Telegram chat id
#    First, open Telegram and send any message to your bot.
npm run chat-id
#    -> copy the printed chat_id

# 2) Put it into .env  (TELEGRAM_CHAT_ID=...)

# 3) Confirm Telegram works
npm run test-telegram

# 4) Do one real stock check (establishes the baseline the first time)
npm run once
```

The **first** `npm run once` just records the current stock as a baseline and sends a
short "bot is live" message. Every run after that compares against the saved baseline
in `data/state.json` and notifies you about differences.

To watch continuously on your own machine:

```powershell
npm run watch        # checks every 5 minutes (configurable), Ctrl+C to stop
```

---

## 2. Free 24/7 hosting with GitHub Actions (recommended)

This runs the check on a schedule in GitHub's cloud. On a **public** repository, Actions
minutes are free and unlimited.

1. **Create a GitHub repo** and push this project to it.

   ```powershell
   git init
   git add .
   git commit -m "Angry Miao stock bot"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

   > Make the repo **public** for unlimited free Actions minutes. (A private repo works
   > too but only includes ~2000 free minutes/month, which a 5-minute schedule can exceed.)
   > `.env` is gitignored, so your token is **not** pushed.

2. **Add your secrets:** repo **Settings → Secrets and variables → Actions → New repository secret**:
   - `TELEGRAM_BOT_TOKEN` → your bot token
   - `TELEGRAM_CHAT_ID` → your chat id (comma-separate for several)

3. **Enable Actions:** open the **Actions** tab, enable workflows, then run **Stock Check →
   Run workflow** once to verify. After that it runs automatically every ~5 minutes.

### Notes about the schedule

- GitHub may delay or batch scheduled runs under load, so spacing is often **5–15 minutes**.
  That is normal and free; use the watch/Docker option below if you need tighter timing.
- The workflow saves `data/state.json` back to the repo between runs. Commits use
  `[skip ci]` and only happen when stock actually changes (plus a rare "keepalive" commit
  so the schedule isn't auto-disabled after 60 days of inactivity).

---

## 3. Alternative: always-on watch mode (Docker / VPS)

Good for a free [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) VM,
a Raspberry Pi, Fly.io, a Render background worker, etc. This polls on your exact interval.

```bash
docker build -t angrymiao-stock-bot .
docker run -d --name stockbot --restart unless-stopped \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e TELEGRAM_CHAT_ID=your_chat_id \
  -v "$(pwd)/data:/app/data" \
  angrymiao-stock-bot
```

Or without Docker, anywhere Node 18+ is installed:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm run watch
```

The `data/` volume keeps the baseline across restarts.

---

## 4. Configuration (`config.json`)

```json
{
  "store": "https://store.angrymiao.com",
  "watch": {
    "collections": ["cyberboard-collection"],
    "allProducts": false
  },
  "pollIntervalSeconds": 300,
  "notifyOn": {
    "restock": true,
    "soldOut": true,
    "newProduct": true,
    "priceChange": false,
    "removed": false
  },
  "requestDelayMs": 400
}
```

| Setting | Meaning |
| --- | --- |
| `watch.collections` | Collection handles to monitor. Add more, e.g. `["cyberboard-collection", "cyberblade"]`. |
| `watch.allProducts` | Set `true` to monitor the **entire store** (all ~120+ products) instead of specific collections. |
| `pollIntervalSeconds` | Interval for `watch` mode (GitHub Actions uses the workflow cron instead). |
| `notifyOn.*` | Toggle which change types trigger a message. |
| `requestDelayMs` | Small delay between requests to be polite to the store. |

**Find collection handles:** the handle is the last part of a collection URL, e.g.
`store.angrymiao.com/collections/**cyberblade**`. A full list is available at
`https://store.angrymiao.com/collections.json?limit=250`.

---

## 5. How it works

```
Shopify products.json  ->  buildState (per-variant available/price)
                           |
       data/state.json  <- compare (diff)  ->  Telegram messages
```

- Each product variant has an `available` boolean from Shopify — that is the stock signal.
- State is keyed by variant id and contains **no timestamps**, so `data/state.json` only
  changes when real stock/price changes (keeps the commit history clean).
- If a fetch fails or returns nothing, the cycle is **skipped** — it will never blast you
  with false "sold out" alerts because the site hiccuped.

---

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `chat-id` shows "No chats found" | Send a message to your bot in Telegram first, then rerun. |
| No messages arrive | Run `npm run test-telegram`; check the token and chat id; make sure you pressed **Start** in the bot chat. |
| Actions not running | Ensure the repo is public (or has Actions minutes), Actions are enabled, and both secrets are set. |
| Want faster checks | Use the Docker/VPS watch mode with a lower `pollIntervalSeconds`. |
| Getting a flood on first run | Expected only if `data/state.json` was deleted — the first run rebuilds the baseline silently (no per-item spam). |

---

## Project layout

```
.
├─ .github/workflows/stock-check.yml   # free scheduled hosting
├─ src/
│  ├─ index.js       # entry point (--once / --watch)
│  ├─ config.js      # config + .env loading
│  ├─ shopify.js     # fetches products.json (paginated, with retries)
│  ├─ state.js       # load/save/build normalized state
│  ├─ diff.js        # detects restock / sold out / new / price / removed
│  ├─ format.js      # Telegram message formatting
│  └─ telegram.js    # sendMessage via Telegram Bot API
├─ scripts/
│  ├─ get-chat-id.js
│  └─ test-telegram.js
├─ config.json
├─ Dockerfile
└─ data/state.json   # saved baseline (gitignored locally)
```
