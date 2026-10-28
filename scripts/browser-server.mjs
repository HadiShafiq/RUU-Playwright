// Launches ONE headed Chromium with a persistent SIT profile and a CDP port, and keeps it open
// until you close the window. Tests and exploration steps attach to it with CDP_URL, so the
// browser survives the end of a run (e.g. left open on the screen under review).
//   TEST_ENV=SIT node scripts/browser-server.mjs        → CDP on http://127.0.0.1:9333
//   add --detached to start it in the background, independent of the terminal that launched it
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const env = (process.env.TEST_ENV ?? '').toUpperCase();
if (env !== 'SIT' && env !== 'UAT') throw new Error('TEST_ENV must be SIT or UAT');
const port = Number(process.env.CDP_PORT ?? 9333);
const root = path.resolve(import.meta.dirname, '..');
const profile = path.join(root, '.auth', `profile-${env.toLowerCase()}`);

if (process.argv.includes('--detached')) {
  // Re-launch this script as an independent process, so the browser isn't closed when the
  // launching terminal (or a tool managing it) is closed or reclaimed under memory pressure.
  const logFile = path.join(root, `.auth/browser-server-${env.toLowerCase()}.log`);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [import.meta.filename], { detached: true, stdio: ['ignore', out, out], env: process.env, windowsHide: true });
  child.unref();
  console.log(`[browser-server] started detached (pid ${child.pid}); CDP http://127.0.0.1:${port}; log ${logFile}`);
  process.exit(0);
}

const lowMemoryArgs = JSON.parse(fs.readFileSync(path.join(root, 'config', 'low-memory-chromium-args.json'), 'utf8'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: null,
  args: [`--remote-debugging-port=${port}`, '--start-maximized', ...lowMemoryArgs],
});
// Start on the environment's home page instead of a blank tab.
const home = { SIT: 'http://ngepsit.eperolehan.com.my/home', UAT: 'http://ngepuat.eperolehan.com.my/home' }[env];
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(home).catch((e) => console.log(`[browser-server] could not open ${home}: ${e.message}`));
console.log(`[browser-server] ${env} browser open on ${home}, CDP http://127.0.0.1:${port}, profile ${profile}`);
await new Promise((resolve) => context.on('close', resolve));
console.log('[browser-server] browser closed');
