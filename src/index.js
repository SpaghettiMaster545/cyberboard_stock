import { config, secrets } from './config.js';
import { fetchAllWatched } from './shopify.js';
import {
  loadState,
  saveState,
  buildState,
  isStateCompatible
} from './state.js';
import { diffStates } from './diff.js';
import { formatBatch } from './format.js';
import { sendMessage } from './telegram.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function filterChanges(changes) {
  const on = config.notifyOn;
  const allow = {
    restock: on.restock,
    soldout: on.soldOut,
    new: on.newProduct,
    price: on.priceChange,
    removed: on.removed
  };
  return changes.filter((c) => allow[c.type]);
}

async function initializeBaseline(newState, reason) {
  saveState(newState);
  const vars = Object.values(newState.variants);
  const inStock = vars.filter((v) => v.available).length;
  const productCount = new Set(vars.map((v) => v.productHandle)).size;
  console.log(
    `${reason}: ${productCount} products, ${vars.length} variants, ${inStock} in stock.`
  );
  return { productCount, variantCount: vars.length, inStock };
}

async function runOnce() {
  const store = config.store.replace(/\/$/, '');

  let products;
  try {
    products = await fetchAllWatched();
  } catch (err) {
    console.error(`Fetch failed, skipping this cycle: ${err.message}`);
    return { ok: false };
  }

  // Guard against false "everything sold out" alerts caused by an empty response.
  if (!products.length) {
    console.error('No products returned - skipping this cycle to avoid false alerts.');
    return { ok: false };
  }

  const newState = buildState(products, store);
  const oldState = loadState();

  if (!oldState) {
    const { productCount, variantCount, inStock } = await initializeBaseline(
      newState,
      'Baseline established'
    );
    await sendMessage(
      '\u{1F916} <b>Angry Miao stock bot is live</b>\n' +
        `Monitoring <b>${productCount}</b> product(s) (${variantCount} variants).\n` +
        `${inStock} variant(s) currently in stock.\n` +
        "You'll get a message whenever stock changes."
    );
    return { ok: true, changes: 0 };
  }

  if (!isStateCompatible(oldState, store)) {
    const { productCount, variantCount, inStock } = await initializeBaseline(
      newState,
      'Baseline refreshed after scope/config change'
    );
    await sendMessage(
      '\u21BB <b>Angry Miao stock bot baseline refreshed</b>\n' +
        `Monitoring <b>${productCount}</b> product(s) (${variantCount} variants).\n` +
        `${inStock} variant(s) currently in stock.\n` +
        'The saved state format or watched scope changed, so the bot reset its baseline without sending per-item alerts.'
    );
    return { ok: true, changes: 0 };
  }

  const changes = filterChanges(diffStates(oldState, newState));

  if (changes.length) {
    console.log(`${changes.length} change(s) detected.`);
    const messages = formatBatch(changes);
    for (const m of messages) {
      await sendMessage(m);
      await sleep(400);
    }
  } else {
    console.log('No changes.');
  }

  saveState(newState);
  return { ok: true, changes: changes.length };
}

async function main() {
  const watch = process.argv.includes('--watch');

  if (!secrets.botToken || secrets.chatIds.length === 0) {
    console.warn(
      'WARNING: Telegram is not fully configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). ' +
        'The bot will still track stock but will not send messages.'
    );
  }

  if (!watch) {
    await runOnce();
    return;
  }

  console.log(
    `Watch mode started - checking every ${config.pollIntervalSeconds}s. Press Ctrl+C to stop.`
  );

  let stop = false;
  const requestStop = () => {
    stop = true;
  };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);

  while (!stop) {
    const startedAt = Date.now();
    try {
      await runOnce();
    } catch (err) {
      console.error(`Cycle error: ${err.message}`);
    }
    const elapsedMs = Date.now() - startedAt;
    const waitSeconds = Math.max(
      0,
      Math.ceil((config.pollIntervalSeconds * 1000 - elapsedMs) / 1000)
    );
    for (let i = 0; i < waitSeconds && !stop; i++) {
      await sleep(1000);
    }
  }
  console.log('Stopped.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
