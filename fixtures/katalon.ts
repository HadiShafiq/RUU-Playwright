import { test as base } from './test';
import { bindKatalon } from '../support/katalon/runtime';

export { expect, scenario } from './test';

/**
 * Fixture for the converted Katalon specs (tests/katalon/). Each Katalon script logs in by itself,
 * so the browser starts without the saved session; the Katalon runtime is bound to this test's page.
 */
export const test = base.extend<{ katalon: void }>({
  storageState: { cookies: [], origins: [] },
  katalon: [
    async ({ page, evidence, baseURL }, use, testInfo) => {
      bindKatalon({ page, testInfo, log: evidence.log, baseURL: baseURL! });
      await use();
    },
    { auto: true },
  ],
});
