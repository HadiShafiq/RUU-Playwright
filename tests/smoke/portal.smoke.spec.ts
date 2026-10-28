import { test, expect, scenario, isOnLoginPage } from '../../fixtures/test';
import { hasSavedSession } from '../../config/environments';
import { waitForAjaxIdle } from '../../support/primefaces';

// Read-only checks: navigate and observe only. Nothing is clicked that submits or changes data.

test.describe('public visitor', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    'Public portal home page loads',
    scenario({
      cr: 'FRAMEWORK',
      id: 'SMK-001',
      module: 'Portal',
      role: 'Anonymous',
      expected: 'Home page returns HTTP < 400 with title "UTAMA - ePerolehan", the main menu (UTAMA, MENGENAI eP, PENGGUNA eP) and the "Log Masuk" entry point.',
      tags: ['@smoke', '@readonly'],
    }),
    async ({ page, evidence }) => {
      const response = await page.goto('/home');
      expect(response?.status(), 'HTTP status of /home').toBeLessThan(400);
      await waitForAjaxIdle(page);
      await expect(page).toHaveTitle('UTAMA - ePerolehan');
      const nav = page.getByRole('banner').getByRole('navigation');
      for (const item of ['UTAMA', 'MENGENAI eP', 'PENGGUNA eP']) {
        await expect(nav.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
      }
      await expect(page.getByRole('menuitem', { name: 'Log Masuk' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Pautan Segera' })).toBeVisible();
      await evidence.capture('public_home', {
        step: 'Open /home as anonymous visitor',
        expected: 'Title, main menu and Log Masuk visible',
        actual: `HTTP ${response?.status()}, title "${await page.title()}", menu + Log Masuk visible`,
      });
      evidence.actual(`HTTP ${response?.status()}; title "${await page.title()}"; main menu and Log Masuk visible`);
    },
  );

  test(
    'Protected dashboard redirects anonymous visitor to SSO login',
    scenario({
      cr: 'FRAMEWORK',
      id: 'SMK-003',
      module: 'Authentication',
      role: 'Anonymous',
      expected: 'Opening /web/epapp/dashboard without a session shows the SSO login page (ID Log Masuk, Kata Laluan, Log Masuk button).',
      tags: ['@smoke', '@readonly'],
    }),
    async ({ page, env, evidence }) => {
      await page.goto('/web/epapp/dashboard');
      await expect.poll(() => isOnLoginPage(page, env), { message: 'Expected redirect to SSO login' }).toBe(true);
      await expect(page.getByRole('textbox', { name: /ID Log Masuk/ })).toBeVisible();
      await expect(page.getByRole('textbox', { name: /Kata Laluan/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Log Masuk' })).toBeVisible();
      // Read-only: the form is observed but never filled or submitted.
      await evidence.capture('sso_login_page', {
        step: 'Open protected dashboard without session',
        expected: 'SSO login form shown',
        actual: `Redirected to ${new URL(page.url()).pathname}`,
      });
      evidence.actual(`Redirected to ${new URL(page.url()).pathname}; login form fields visible`);
    },
  );
});

test(
  'Authenticated dashboard loads with saved session',
  scenario({
    cr: 'FRAMEWORK',
    id: 'SMK-002',
    module: 'Portal',
    role: 'Any authorised tester',
    expected: 'With the saved session, /web/epapp/dashboard loads without redirecting to the SSO login page.',
    tags: ['@smoke', '@readonly', '@auth'],
  }),
  async ({ page, env, evidence }) => {
    if (!hasSavedSession(env)) {
      test.info().annotations.push({ type: 'blocked', description: `No saved ${env.name} session — run npm run auth:${env.name.toLowerCase()}` });
      test.skip(true, 'No saved session');
    }
    await page.goto('/web/epapp/dashboard');
    await waitForAjaxIdle(page);
    expect(isOnLoginPage(page, env), 'Redirected to SSO login: session expired, re-run the auth step').toBe(false);
    await evidence.capture('authenticated_dashboard', {
      step: 'Open dashboard with saved session',
      expected: 'Dashboard, not SSO login',
      actual: `Landed on ${new URL(page.url()).pathname}`,
    });
    evidence.actual(`Landed on ${new URL(page.url()).pathname} without SSO redirect`);
  },
);
