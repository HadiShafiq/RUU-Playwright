import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { getEnv } from '../config/environments';

/**
 * Interactive login. Run with:  npm run auth:sit   (or auth:uat)
 * A browser and the Playwright Inspector open. Log in yourself (credentials are never stored
 * in code), wait until the ePerolehan landing page shows you as logged in, then press Resume.
 * The session cookies are saved to .auth/<env>.json (git-ignored) and reused by the tests.
 */
test('save authenticated session', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const env = getEnv();
  await page.goto('/web/epapp/dashboard'); // redirects to the SSO login form
  await page.pause();
  const url = new URL(page.url());
  expect(url.host === env.ssoHost || url.pathname.startsWith('/ssologin'), 'Still on the login page — finish logging in before pressing Resume').toBe(false);
  fs.mkdirSync(path.dirname(env.storageStatePath), { recursive: true });
  await page.context().storageState({ path: env.storageStatePath });
});
