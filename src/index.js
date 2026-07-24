import { config, secrets } from './config.js';
import { fetchAllWatched } from './shopify.js';
import {
  loadState,
  saveState,
  buildState,
  isStateCompatible
} from './state.js';
import { loadRuntimeState, saveRuntimeState } from './runtime.js';
import { diffStates } from './diff.js';
import { formatBatch } from './format.js';
import { sendMessage } from './telegram.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function summarizeState(state) {
  const vars = Object.values(state.variants);
  return {
    productCount: new Set(vars.map((v) => v.productHandle)).size,
    variantCount: vars.length,
    inStock: vars.filter((v) => v.available).length
  };
}

function formatDuration(ms) {
  if (ms < 1000) return 'under 1s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours && seconds) parts.push(`${seconds}s`);

  return parts.join(' ');
}

function formatUtc(iso) {
  return iso ? new Date(iso).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'never';
}

async function notifySafely(text, label) {
  try {
    await sendMessage(text);
    return true;
  } catch (err) {
    console.error(`${label} notification failed: ${err.message}`);
    return false;
  }
}

function buildFailureAlert(result, runtime, nowMs) {
  const lastSuccess = runtime.lastSuccessAt
    ? formatDuration(nowMs - Date.parse(runtime.lastSuccessAt)) + ' ago'
    : 'no successful check yet';

  return (
    '\u26A0\uFE0F <b>Angry Miao stock bot check failed</b>\n' +
    `Reason: <code>${esc(result.errorMessage || 'Unknown error')}</code>\n` +
    `Consecutive failures: <b>${runtime.consecutiveFailures}</b>\n` +
    `Last successful check: ${esc(lastSuccess)}\n` +
    `Retry interval: ${config.pollIntervalSeconds}s`
  );
}

function buildRecoveryAlert(runtime, summary, nowMs, failureCount) {
  const downtime = runtime.failureStreakStartedAt
    ? formatDuration(nowMs - Date.parse(runtime.failureStreakStartedAt))
    : 'unknown';

  return (
    '\u2705 <b>Angry Miao stock bot recovered</b>\n' +
    `Checks are succeeding again after <b>${failureCount}</b> failed cycle(s).\n` +
    `Downtime window: ${esc(downtime)}\n` +
    `Monitoring <b>${summary.productCount}</b> product(s) (${summary.variantCount} variants).\n` +
    `${summary.inStock} variant(s) currently in stock.`
  );
}

function buildHeartbeat(summary, runtime) {
  const noErrorsLine =
    runtime.statusWindowFailureCount === 0
      ? 'Endpoint/data errors in last 24h: <b>0</b>'
      : `Endpoint/data errors in last 24h: <b>${runtime.statusWindowFailureCount}</b>`;
  const lastChangeLine = runtime.lastChangeAt
    ? `Last stock change alert: ${esc(formatUtc(runtime.lastChangeAt))} (${runtime.lastChangeCount} change(s))`
    : 'Last stock change alert: none recorded yet';

  return (
    '\u2139\uFE0F <b>Angry Miao stock bot daily status</b>\n' +
    'Bot is running normally.\n' +
    `Monitoring <b>${summary.productCount}</b> product(s) (${summary.variantCount} variants).\n` +
    `${summary.inStock} variant(s) currently in stock.\n` +
    `Last successful check: ${esc(formatUtc(runtime.lastSuccessAt))}\n` +
    `Stock change alerts in last 24h: <b>${runtime.statusWindowChangeCount}</b>\n` +
    `${noErrorsLine}\n` +
    `${lastChangeLine}`
  );
}

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
  const { productCount, variantCount, inStock } = summarizeState(newState);
  console.log(
    `${reason}: ${productCount} products, ${variantCount} variants, ${inStock} in stock.`
  );
  return { productCount, variantCount, inStock };
}

async function runOnce() {
  const store = config.store.replace(/\/$/, '');

  let products;
  try {
    products = await fetchAllWatched();
  } catch (err) {
    console.error(`Fetch failed, skipping this cycle: ${err.message}`);
    return { ok: false, errorMessage: `Fetch failed: ${err.message}` };
  }

  // Guard against false "everything sold out" alerts caused by an empty response.
  if (!products.length) {
    console.error('No products returned - skipping this cycle to avoid false alerts.');
    return {
      ok: false,
      errorMessage: 'No products were returned from Shopify. This may indicate a bad endpoint response or temporary blocking.'
    };
  }

  const newState = buildState(products, store);
  const summary = summarizeState(newState);
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
    return { ok: true, changes: 0, summary };
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
    return { ok: true, changes: 0, summary };
  }

  const previousVariantCount = Object.keys(oldState.variants || {}).length;
  if (
    previousVariantCount > 0 &&
    summary.variantCount < Math.floor(previousVariantCount * 0.6)
  ) {
    const errorMessage =
      `Variant count dropped from ${previousVariantCount} to ${summary.variantCount}. ` +
      'Treating this response as suspicious and skipping alerts for this cycle.';
    console.error(errorMessage);
    return { ok: false, errorMessage };
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
  return { ok: true, changes: changes.length, summary };
}

async function updateRuntime(result, runtime) {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!result.ok) {
    if (runtime.consecutiveFailures === 0) {
      runtime.failureStreakStartedAt = nowIso;
    }
    runtime.consecutiveFailures += 1;
    runtime.totalFailures += 1;
    runtime.statusWindowFailureCount += 1;
    runtime.lastFailureAt = nowIso;
    runtime.lastFailureMessage = result.errorMessage || 'Unknown error';

    const repeatAfterMs = config.health.repeatErrorAlertMinutes * 60 * 1000;
    const shouldAlert =
      runtime.consecutiveFailures === 1 ||
      !runtime.lastFailureAlertAt ||
      nowMs - Date.parse(runtime.lastFailureAlertAt) >= repeatAfterMs;

    if (shouldAlert) {
      const sent = await notifySafely(
        buildFailureAlert(result, runtime, nowMs),
        'Failure alert'
      );
      if (sent) runtime.lastFailureAlertAt = nowIso;
    }

    saveRuntimeState(runtime);
    return runtime;
  }

  const summary = result.summary;
  const hadFailures = runtime.consecutiveFailures > 0;
  const failureCount = runtime.consecutiveFailures;

  runtime.consecutiveFailures = 0;
  runtime.totalSuccesses += 1;
  runtime.lastSuccessAt = nowIso;
  runtime.lastProductCount = summary.productCount;
  runtime.lastVariantCount = summary.variantCount;
  runtime.lastInStockCount = summary.inStock;

  if (result.changes > 0) {
    runtime.lastChangeAt = nowIso;
    runtime.lastChangeCount = result.changes;
    runtime.statusWindowChangeCount += result.changes;
  }

  if (hadFailures) {
    await notifySafely(
      buildRecoveryAlert(runtime, summary, nowMs, failureCount),
      'Recovery alert'
    );
    runtime.lastRecoveryAt = nowIso;
    runtime.failureStreakStartedAt = null;
    runtime.lastFailureMessage = null;
  }

  const heartbeatIntervalMs = config.health.statusIntervalHours * 60 * 60 * 1000;
  if (!runtime.lastHeartbeatAt) {
    runtime.lastHeartbeatAt = nowIso;
    runtime.statusWindowFailureCount = 0;
    runtime.statusWindowChangeCount = 0;
  } else if (nowMs - Date.parse(runtime.lastHeartbeatAt) >= heartbeatIntervalMs) {
    const sent = await notifySafely(
      buildHeartbeat(summary, runtime),
      'Daily status'
    );
    if (sent) {
      runtime.lastHeartbeatAt = nowIso;
      runtime.statusWindowFailureCount = 0;
      runtime.statusWindowChangeCount = 0;
    }
  }

  saveRuntimeState(runtime);
  return runtime;
}

async function main() {
  const watch = process.argv.includes('--watch');
  let runtime = loadRuntimeState();

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
      runtime = await updateRuntime(await runOnce(), runtime);
    } catch (err) {
      console.error(`Cycle error: ${err.message}`);
      runtime = await updateRuntime(
        { ok: false, errorMessage: `Unexpected cycle error: ${err.message}` },
        runtime
      );
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
