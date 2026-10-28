import { test as base } from './test';

export { expect, scenario } from './test';

/**
 * `page` for specs that should run in a browser the tester is watching and that must stay open
 * when the run ends (e.g. left on a screen for review).
 *
 * - CDP_URL set (e.g. http://127.0.0.1:9333 from scripts/browser-server.mjs): attach to that
 *   headed browser and reuse its logged-in tab. The browser is NOT closed afterwards.
 * - CDP_URL unset: launch a separate browser for this test and close it at the end.
 *
 * SLOWMO (ms, default 100) slows every action so it can be followed on screen.
 */
export const test = base.extend({
  page: async ({ playwright, baseURL, headless }, use) => {
    const slowMo = Number(process.env.SLOWMO ?? 100);
    const cdp = process.env.CDP_URL;
    const browser = cdp
      ? await playwright.chromium.connectOverCDP(cdp, { slowMo })
      : await playwright.chromium.launch({ headless, slowMo });
    const context = cdp ? browser.contexts()[0] : await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 } });
    const page = cdp
      ? context.pages().find((p) => p.url().includes('eperolehan')) ?? context.pages()[0] ?? (await context.newPage())
      : await context.newPage();
    if (cdp && baseURL) {
      // Pages of an attached browser don't know the config's baseURL; resolve relative paths ourselves.
      const goto = page.goto.bind(page);
      page.goto = (url, opts) => goto(new URL(url, baseURL).toString(), opts);
    }
    // Tracing and failure screenshots come from the config's `trace` / `screenshot` options,
    // which Playwright applies to attached contexts too.
    await use(page);

    if (!cdp) await browser.close();
    // Attached mode: leave the browser and the page exactly where the test finished.
  },
});
