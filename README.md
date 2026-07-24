# Angry Miao Stock Bot

A lightweight bot that watches the [Angry Miao store](https://store.angrymiao.com)
(the [CYBERBOARD collection](https://store.angrymiao.com/collections/cyberboard-collection)
by default, optionally the **whole store**) and sends you a **Telegram** message the
moment anything comes **back in stock**, sells out, gets listed, or changes price.

It reads Angry Miao's public Shopify data (`products.json`), so it needs **no browser**
at runtime — which makes it tiny, fast, and easy to host **for free, 24/7**.

- Zero runtime dependencies (just Node.js 18+ and its built-in `fetch`).
- Primary hosting path: a free **Oracle Cloud Always Free** VM with a 20-second
  polling loop and automatic deploys from GitHub Actions.
- Secondary path: local/Docker watch mode if you want to run it yourself.

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
  To watch continuously on your own machine:
```

  npm run watch        # checks every 20 seconds (configurable), Ctrl+C to stop

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... npm run watch
```
  ## 2. Free 24/7 hosting on Oracle Cloud (recommended)
The `data/` volume keeps the baseline across restarts.
  This runs the bot continuously on an Oracle Cloud Always Free VM, while GitHub Actions
  handles deployment whenever you push changes.

  ### What the deployment workflow does

  The workflow in `.github/workflows/deploy-oracle.yml`:

  - connects to your Oracle VM over SSH,
  - installs Node.js 20 if needed,
  - uploads `src/`, `config.json`, `package.json`, and the Oracle installer,
  - writes the Telegram secrets into a remote `.env`,
  - creates/updates a `systemd` service named `angrymiao-stock-bot`,
  - restarts the service and prints recent logs.

  ### One-time Oracle VM setup

  1. Create an **Always Free** VM in Oracle Cloud.
     Ubuntu works best with the included installer, though Oracle Linux is also supported.

  2. Make sure you can SSH into it locally first.

  3. In GitHub, add these repository **Secrets**:
     - `ORACLE_HOST` → public IP or hostname of the VM
     - `ORACLE_USER` → SSH username, usually `ubuntu` or `opc`
     - `ORACLE_SSH_KEY` → the full private SSH key used to connect
     - `TELEGRAM_BOT_TOKEN` → your bot token
     - `TELEGRAM_CHAT_ID` → your chat id (comma-separate several if needed)

  4. Optional GitHub **Secrets**:
     - `ORACLE_SSH_PORT` → defaults to `22`
     - `ORACLE_APP_DIR` → defaults to `/home/<ORACLE_USER>/angrymiao-stock-bot`

  5. Push to `main`, or run **Deploy To Oracle** manually from the Actions tab.

  ### Notes

  - The bot polls every **20 seconds** by default via `config.json`.
  - The Oracle user must have passwordless `sudo` for package install + `systemd` setup.
  - The state file lives on the VM under `data/state.json`, so redeploys keep the baseline.

  ---

  ## 3. Legacy GitHub Actions mode

  The old GitHub-hosted stock checker is no longer scheduled by default. The workflow in
  `.github/workflows/stock-check.yml` is now **manual-only** so it does not duplicate the
  Oracle-hosted notifications.

  If you still want to run a one-off check inside GitHub for debugging, use **Manual Stock Check**.

  ---

  ## 4. Alternative: local/Docker watch mode

  Good for your own VPS, a Raspberry Pi, or anywhere you want the process to stay up.

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

  ## 5. Configuration (`config.json`)

  ```json
  {
    "store": "https://store.angrymiao.com",
    "watch": {
      "collections": ["cyberboard-collection"],
      "allProducts": true
    },
    "pollIntervalSeconds": 20,
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
  | `watch.collections` | Collection handles to monitor. Add more, e.g. `['cyberboard-collection', 'cyberblade']`. |
  | `watch.allProducts` | Set `true` to monitor the **entire store** (all ~120+ products) instead of specific collections. |
  | `pollIntervalSeconds` | Interval for watch mode. Default is now **20** for the Oracle VM. |
  | `notifyOn.*` | Toggle which change types trigger a message. |
  | `requestDelayMs` | Small delay between requests to be polite to the store. |

  **Find collection handles:** the handle is the last part of a collection URL, e.g.
  `store.angrymiao.com/collections/**cyberblade**`. A full list is available at
  `https://store.angrymiao.com/collections.json?limit=250`.

  ---

  ## 6. How it works

  ```
  Shopify products.json  ->  buildState (per-variant available/price)
                             |
         data/state.json  <- compare (diff)  ->  Telegram messages
  ```

  - Each product variant has an `available` boolean from Shopify — that is the stock signal.
  - State is keyed by variant id and contains **no timestamps**, so `data/state.json` only
    changes when real stock/price changes.
  - In watch mode, the bot now keeps the configured cadence based on **cycle start time**,
    so a 20-second interval stays about 20 seconds instead of drifting upward.
  - If a fetch fails or returns nothing, the cycle is **skipped** — it will never blast you
    with false "sold out" alerts because the site hiccuped.

  ---

  ## 7. Troubleshooting

  | Symptom | Fix |
  | --- | --- |
  | Oracle deploy workflow fails on SSH | Check `ORACLE_HOST`, `ORACLE_USER`, `ORACLE_SSH_KEY`, port, and that the VM allows SSH from the internet. |
  | Oracle deploy fails on `sudo` | Use a VM user with passwordless `sudo` (`ubuntu` or `opc` by default). |
  | No messages arrive | Run `npm run test-telegram`; check the token and chat id; make sure you pressed **Start** in the bot chat. |
  | Want to reduce load | Raise `pollIntervalSeconds` above `20`. |
  | Getting a flood on first run | Expected only if `data/state.json` was deleted on the VM — the first run rebuilds the baseline silently (no per-item spam). |

  ---

  ## Project layout

  ```
  .
  ├─ .github/workflows/deploy-oracle.yml  # GitHub -> Oracle deployment
  ├─ .github/workflows/stock-check.yml    # manual-only legacy fallback
  ├─ deploy/oracle/install.sh             # remote bootstrap + systemd install
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
  └─ data/state.json
  ```
