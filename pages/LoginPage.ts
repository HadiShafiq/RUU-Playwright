import type { Page } from '@playwright/test';
import type { EnvConfig } from '../config/environments';
import { waitForAjaxIdle } from '../support/primefaces';

const onLogin = (u: URL, env: EnvConfig) => u.host === env.ssoHost || u.pathname.toLowerCase().startsWith('/ssologin');

/**
 * Logs in by waiting for the tester to do it manually in the headed browser. If nobody does
 * within `manualWaitMs`, it falls back to E2E_USERNAME / E2E_PASSWORD from the process
 * environment. Credentials are never written to disk or logs.
 */
export class LoginPage {
  constructor(private page: Page, private env: EnvConfig) {}

  async ensureLoggedIn(log: (m: string) => void, manualWaitMs = Number(process.env.LOGIN_WAIT_MS ?? 180_000)) {
    await this.page.goto('/web/epapp/dashboard');
    await waitForAjaxIdle(this.page);
    if (!onLogin(new URL(this.page.url()), this.env)) return log('Session already authenticated');
    log(`Login page shown — waiting up to ${manualWaitMs / 1000}s for manual login in the browser`);
    const manual = await this.page
      .waitForURL((u) => !onLogin(u, this.env), { timeout: manualWaitMs })
      .then(() => true, () => false);
    if (manual) return log('Manual login completed');
    const { E2E_USERNAME: user, E2E_PASSWORD: pass } = process.env;
    if (!user || !pass) throw new Error('Not logged in: no manual login and no E2E_USERNAME/E2E_PASSWORD provided');
    log('No manual login — using runtime credentials from environment');
    // The SSO page follows the browser's language: Malay or English labels.
    await this.page.getByRole('textbox', { name: /ID Log Masuk|Login ID/ }).fill(user);
    await this.page.getByRole('textbox', { name: /Kata Laluan|Password/ }).fill(pass);
    await this.page.getByRole('button', { name: /^(Log Masuk|Login)$/ }).click();
    await this.page.waitForURL((u) => !onLogin(u, this.env), { timeout: 60_000 });
    log('Logged in with runtime credentials');
  }
}
