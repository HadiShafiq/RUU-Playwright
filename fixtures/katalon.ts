import { test as base } from './test';
import { bindKatalon } from '../support/katalon/runtime';
import { getEnv } from '../config/environments';

export { expect, scenario } from './test';

/**
 * Fixture for the converted Katalon specs (tests/katalon/). Each Katalon script logs in by itself,
 * so the browser starts without the saved session; the Katalon runtime is bound to this test's page.
 *
 * After the test, pass or fail, the session is ended at the SSO server: SIT bounces a new login for an
 * account that still has an open session, so a failed run must not leave one behind for the next test.
 */
export const test = base.extend<{ katalon: void }>({
  storageState: { cookies: [], origins: [] },
  katalon: [
    async ({ page, evidence, baseURL }, use, testInfo) => {
      bindKatalon({ page, testInfo, log: evidence.log, baseURL: baseURL! });
      await use();
      if (!page.isClosed() && testInfo.status !== testInfo.expectedStatus) {
        // The application's own error banner usually says why (e.g. "... (ERR-700125)").
        const messages = await page
          .locator('.ui-messages-error:visible, .ui-growl-item:visible, .ui-dialog[aria-hidden="false"] .ui-dialog-content')
          .allInnerTexts()
          .catch(() => []);
        for (const m of messages.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)) evidence.log(`Application message on failure: ${m}`);
      }
      if (!page.isClosed()) {
        await page
          .goto(`http://${getEnv().ssoHost}/oam/server/logout?end_url=${encodeURIComponent(`${baseURL}/c/portal/logout`)}`, { timeout: 30_000 })
          .then(() => evidence.log('Signed out (SSO logout)'))
          .catch(() => evidence.log('SSO logout failed; the next login for this account may be bounced'));
      }
    },
    { auto: true },
  ],
});
