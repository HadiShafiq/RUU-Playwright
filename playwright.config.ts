import fs from 'node:fs';
import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';
import { getEnv, hasSavedSession } from './config/environments';
import lowMemoryArgs from './config/low-memory-chromium-args.json';

// Login credentials (E2E_USERNAME / E2E_PASSWORD) live in the git-ignored .env file.
// Values already set in the shell win over the file.
if (fs.existsSync('.env')) process.loadEnvFile('.env');

const env = getEnv();

// Up to 3 workers, but only as many as free RAM allows (~1 GB per browser worker).
// Override with WORKERS=n.
const freeGb = os.freemem() / 1024 ** 3;
const workers = Number(process.env.WORKERS) || Math.max(1, Math.min(3, Math.floor(freeGb)));
if (!process.env.WORKERS && workers < 3 && !process.env.PW_MEM_NOTICE) {
  process.env.PW_MEM_NOTICE = '1'; // print once, not in every worker
  console.log(`[config] ${freeGb.toFixed(1)} GB RAM free → ${workers} worker(s). Set WORKERS=n to override.`);
}
// Run ID in Malaysia time, e.g. 2026-10-28_153000
const runId =
  process.env.RUN_ID ??
  new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }).replace(' ', '_').replace(/:/g, '');
process.env.RUN_ID = runId; // shared with workers so all evidence lands in one run folder

export default defineConfig({
  testDir: './tests',
  outputDir: `test-results/${env.name}/${runId}`,
  // Isolated workers (see above). Multi-step business workflows must opt into serial mode
  // (test.describe.configure({ mode: 'serial' })) and use dataLock() for shared records.
  workers,
  fullyParallel: true,
  // No blind retries: a retry can re-submit a business transaction. Failures go through
  // the analyse → repair → rerun loop instead (see knowledge/repair-log.md).
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: `reports/${env.name}/${runId}/results.json` }],
    ['junit', { outputFile: `reports/${env.name}/${runId}/junit.xml` }],
    ['./reporters/execution-report.ts', { outputDir: `reports/${env.name}/${runId}` }],
  ],
  use: {
    baseURL: env.baseURL,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Video recording costs memory and CPU for every test; enable with VIDEO=1 when needed.
    video: process.env.VIDEO ? 'retain-on-failure' : 'off',
    launchOptions: { args: lowMemoryArgs },
    viewport: { width: 1600, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'en-MY',
    timezoneId: 'Asia/Kuala_Lumpur',
  },
  projects: [
    // Interactive login: run headed once per environment to save the session.
    { name: 'auth', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 900 },
        storageState: hasSavedSession(env) ? env.storageStatePath : undefined,
      },
    },
  ],
});
