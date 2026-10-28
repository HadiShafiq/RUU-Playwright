import type { Page } from '@playwright/test';
import type { EnvConfig } from '../config/environments';
import { waitForAjaxIdle } from '../support/primefaces';

const onLogin = (u: URL, env: EnvConfig) => u.host === env.ssoHost || u.pathname.toLowerCase().startsWith('/ssologin');

/**
 * Logs in automatically with E2E_USERNAME / E2E_PASSWORD (from the process environment or the
 * git-ignored .env file). Only when those are not set does it wait up to `manualWaitMs` for the
 * tester to log in by hand. Credentials are never written to disk or logs.
 */
export class LoginPage {
  constructor(private page: Page, private env: EnvConfig) {}

  async ensureLoggedIn(log: (m: string) => void, manualWaitMs = Number(process.env.LOGIN_WAIT_MS ?? 180_000)) {
    await this.page.goto('/web/epapp/dashboard');
    await waitForAjaxIdle(this.page);
    if (!onLogin(new URL(this.page.url()), this.env)) return log('Session already authenticated');

    const { E2E_USERNAME: user, E2E_PASSWORD: pass } = process.env;
    if (user && pass) {
      log(`Login page shown — logging in automatically as ${user}`);
      // The SSO page follows the browser's language: Malay or English labels.
      await this.page.getByRole('textbox', { name: /ID Log Masuk|Login ID/ }).fill(user);
      await this.page.getByRole('textbox', { name: /Kata Laluan|Password/ }).fill(pass);
      await this.page.getByRole('button', { name: /^(Log Masuk|Login)$/ }).click();
      const ok = await this.page
        .waitForURL((u) => !onLogin(u, this.env), { timeout: 60_000 })
        .then(() => true, () => false);
      if (!ok) throw new Error('Automatic login failed: still on the login page (check E2E_USERNAME / E2E_PASSWORD in .env)');
      await waitForAjaxIdle(this.page);
      return log('Logged in automatically');
    }

    log(`No E2E_USERNAME/E2E_PASSWORD set — waiting up to ${manualWaitMs / 1000}s for manual login in the browser`);
    const manual = await this.page
      .waitForURL((u) => !onLogin(u, this.env), { timeout: manualWaitMs })
      .then(() => true, () => false);
    if (!manual) throw new Error('Not logged in: set E2E_USERNAME and E2E_PASSWORD in .env, or log in by hand');
    log('Manual login completed');
  }
}
