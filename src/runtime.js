import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { rootDir } from './config.js';

const runtimePath = join(rootDir, 'data', 'runtime.json');

const defaults = {
  schemaVersion: 1,
  lastSuccessAt: null,
  lastHeartbeatAt: null,
  consecutiveFailures: 0,
  failureStreakStartedAt: null,
  totalSuccesses: 0,
  totalFailures: 0,
  lastFailureAt: null,
  lastFailureMessage: null,
  lastFailureAlertAt: null,
  lastRecoveryAt: null,
  lastProductCount: 0,
  lastVariantCount: 0,
  lastInStockCount: 0,
  lastChangeAt: null,
  lastChangeCount: 0,
  statusWindowFailureCount: 0,
  statusWindowChangeCount: 0
};

export function loadRuntimeState() {
  if (!existsSync(runtimePath)) return { ...defaults };
  try {
    return { ...defaults, ...JSON.parse(readFileSync(runtimePath, 'utf8')) };
  } catch (err) {
    console.error(`Could not read runtime state, resetting it: ${err.message}`);
    return { ...defaults };
  }
}

export function saveRuntimeState(state) {
  mkdirSync(dirname(runtimePath), { recursive: true });
  writeFileSync(runtimePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}