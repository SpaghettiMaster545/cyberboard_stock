import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { config, secrets, rootDir } from './config.js';
import { Store, migrateLegacyState } from './store.js';
import { createContext } from './context.js';
import { Monitor } from './monitor.js';
import { Notifier } from './telegram/notifier.js';
import { TelegramApi } from './telegram/api.js';
import { TelegramBot } from './telegram/bot.js';
import { fetchItems, scopeFingerprint } from './sources/index.js';
import { summarizeItems } from './diff.js';
import { formatStartup, itemLine } from './format.js';
import { t } from './i18n.js';
import { sleep } from './util.js';

/** package.json version + a short hash of the code and config, e.g. "2.0.0+1a2b3c4". */
function codeVersion() {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  const hash = createHash('sha1');
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else hash.update(name).update(readFileSync(p));
    }
  };
  walk(join(rootDir, 'src'));
  hash.update(JSON.stringify(config));
  return `${pkg.version}+${hash.digest('hex').slice(0, 7)}`;
}

function setup({ readOnly = false } = {}) {
  const version = codeVersion();
  const store = new Store(config.dataPath);
  const ctx = createContext({ config, secrets, store, version });
  // The self-test runs next to the live service, so it must never write state.
  if (!readOnly) {
    const migrated = migrateLegacyState(store, ctx.watches(), scopeFingerprint);
    if (migrated) console.log(`Migrated the previous single-store baseline to watch "${migrated}".`);
  }
  const api = secrets.botToken ? new TelegramApi(secrets.botToken, { baseUrl: secrets.telegramApiBase }) : null;
  const notifier = new Notifier(ctx, api);
  const monitor = new Monitor(ctx, notifier);
  return { version, store, ctx, api, notifier, monitor };
}

function describeWatches(ctx) {
  return ctx
    .watches()
    .map((w) => `${w.id} (${w.type}, ${w.enabled ? `every ${w.intervalSeconds}s` : 'paused'})`)
    .join(', ');
}

async function runOnce() {
  const { ctx, monitor } = setup();
  const results = await monitor.checkAll();
  if (!results.length) console.warn('No enabled watches in config.json.');
  if (results.length && results.every((r) => !r.result.ok)) process.exitCode = 1;
  ctx.store.saveRuntime();
}

/** One pass over every source + a Telegram connectivity check, without touching saved state. */
async function selfTest() {
  const { version, ctx, api, notifier } = setup({ readOnly: true });
  let failed = false;
  console.log(`Stock bot self-test v${version}`);
  console.log(`Language: ${ctx.lang} · timezone: ${ctx.timezone}`);

  const watches = ctx.watches();
  if (!watches.length) {
    console.error('FAIL config: no valid watches');
    failed = true;
  }
  for (const w of watches) {
    const started = Date.now();
    try {
      const items = await fetchItems(w, ctx);
      const s = summarizeItems(Object.fromEntries(items.map((i) => [i.id, i])));
      console.log(
        `OK   ${w.id} [${w.type}${w.enabled ? '' : ', paused'}]: ${s.itemCount} items, ${s.inStockCount} in stock (${Date.now() - started}ms)`
      );
      if (items.length <= 10) {
        for (const i of items) {
          console.log(`       ${i.available ? 'IN STOCK ' : 'sold out '} ${itemLine(i, ctx.lang).replace(/<[^>]+>/g, '')}`);
        }
      }
    } catch (err) {
      // Store hiccups (e.g. HTTP 429) are reported but do not fail the self-test.
      console.warn(`WARN ${w.id} [${w.type}]: ${err.message}`);
    }
  }

  if (!api) {
    console.warn('WARN telegram: TELEGRAM_BOT_TOKEN not set - alerts are only logged');
  } else {
    try {
      const me = await api.call('getMe');
      const hook = await api.call('getWebhookInfo');
      console.log(
        `OK   telegram: @${me.username}, ${secrets.chatIds.length} chat(s) configured` +
          (hook && hook.url ? ' (a webhook is set; the bot will remove it on start)' : '')
      );
      if (!secrets.chatIds.length) console.warn('WARN telegram: TELEGRAM_CHAT_ID is empty');
      if (process.argv.includes('--send')) {
        await notifier.broadcast(`✅ Self-test v${version}: Telegram works.`, { silent: true });
        console.log('OK   telegram: test message sent');
      }
    } catch (err) {
      console.error(`FAIL telegram: ${err.message}`);
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
}

async function runWatch() {
  const { version, store, ctx, api, notifier, monitor } = setup();
  console.log(`Stock bot v${version} starting - watches: ${describeWatches(ctx) || 'none'}`);
  if (!secrets.botToken || !secrets.chatIds.length) {
    console.warn(
      'WARNING: Telegram is not fully configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). ' +
        'Stock is still tracked, alerts are only logged.'
    );
  }

  let stopping = false;
  let bot = null;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping...');
    monitor.stop();
    if (bot) bot.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the interactive bot in the background (retrying if Telegram is unreachable),
  // so stock checks never wait on it.
  const botReady = (async () => {
    if (!api) return;
    for (let delay = 5000; !stopping; delay = Math.min(delay * 2, 300000)) {
      const candidate = new TelegramBot(ctx, api, monitor);
      try {
        await candidate.start();
        bot = candidate;
        if (stopping) bot.stop();
        return;
      } catch (err) {
        console.error(`Telegram bot could not start (retrying in ${delay / 1000}s): ${err.message}`);
        await sleep(delay);
      }
    }
  })();

  if (store.runtime.codeVersion !== version) {
    const sent = await notifier.notifySafely(formatStartup(ctx.watches(), version, ctx.lang), {
      silent: true,
      keyboard: [[{ text: t(ctx.lang, 'btn_menu'), callback_data: 'menu' }]]
    });
    if (sent) {
      store.runtime.codeVersion = version;
      store.saveRuntime();
    }
  }

  await monitor.run();
  if (bot) await bot.stop();
  await Promise.race([botReady, sleep(100)]);
  console.log('Stopped.');
  process.exit(0);
}

const args = process.argv.slice(2);
const run = args.includes('--self-test') ? selfTest : args.includes('--once') ? runOnce : runWatch;

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
