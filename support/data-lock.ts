import fs from 'node:fs';
import path from 'node:path';

const LOCK_DIR = path.resolve(__dirname, '..', '.locks');

/**
 * Cross-worker mutual exclusion for shared mutable test data (a record, an account, a Constant Rule).
 * Uses atomic mkdir so it works across Playwright worker processes.
 */
export async function withDataLock<T>(key: string, fn: () => Promise<T>, timeoutMs = 10 * 60_000): Promise<T> {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const lock = path.join(LOCK_DIR, key.replace(/[^\w.-]/g, '_'));
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for data lock "${key}"`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
