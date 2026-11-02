import type { Page } from '@playwright/test';
import type { EnvConfig } from '../config/environments';
import { loadCredentials } from '../support/credentials';
import { waitForAjaxIdle } from '../support/primefaces';

const onLogin = (u: URL, env: EnvConfig) => u.host === env.ssoHost || u.pathname.toLowerCase().startsWith('/ssologin');

/**
 * Logs in automatically with the environment's row of .auth/credentials.xlsx (or E2E_USERNAME /
 * E2E_PASSWORD from the shell or .env, which win). Only when neither is set does it wait up to
 * `manualWaitMs` for the tester to log in by hand. Passwords are never logged.
 */
export class LoginPage {
  constructor(private page: Page, private env: EnvConfig) {}

  async ensureLoggedIn(log: (m: string) => void, manualWaitMs = Number(process.env.LOGIN_WAIT_MS ?? 180_000)) {
    await this.page.goto('/web/epapp/dashboard');
    await waitForAjaxIdle(this.page);
    if (!onLogin(new URL(this.page.url()), this.env)) return log('Session already authenticated');

    const creds = await loadCredentials(this.env.name);
    if (creds) {
      log(`Login page shown — logging in automatically as ${creds.username} (from ${creds.source})`);
      // SIT sometimes ends a fresh session at once (/c/portal/logout → public /home), e.g. when the same
      // account is still logged in elsewhere. Then sign out of SSO properly and log in again.
      for (let attempt = 1; attempt <= 3; attempt++) {
        // The SSO page follows the browser's language: Malay or English labels.
        await this.page.getByRole('textbox', { name: /ID Log Masuk|Login ID/ }).fill(creds.username);
        await this.page.getByRole('textbox', { name: /Kata Laluan|Password/ }).fill(creds.password);
        await this.page.getByRole('button', { name: /^(Log Masuk|Login)$/ }).click();
        const ok = await this.page
          .waitForURL((u) => !onLogin(u, this.env), { timeout: 60_000 })
          .then(() => true, () => false);
        if (!ok) throw new Error(`Automatic login failed: still on the login page (check the username/password in ${creds.source})`);
        await waitForAjaxIdle(this.page);
        if (/^\/web\/epapp\//.test(new URL(this.page.url()).pathname)) return log('Logged in automatically');
        log(`SIT ended the new session straight away (landed on ${new URL(this.page.url()).pathname}); signing out of SSO and retrying (${attempt}/3)`);
        await this.signOut();
        await this.page.goto('/web/epapp/dashboard');
        await waitForAjaxIdle(this.page);
        if (!onLogin(new URL(this.page.url()), this.env)) return log('Session already authenticated');
      }
      throw new Error(`SIT keeps ending the ${creds.username} session right after login: is that account logged in somewhere else (another browser, Playwright UI)? Log out there and rerun`);
    }

    log(`No credentials for ${this.env.name} — waiting up to ${manualWaitMs / 1000}s for manual login in the browser`);
    const manual = await this.page
      .waitForURL((u) => !onLogin(u, this.env), { timeout: manualWaitMs })
      .then(() => true, () => false);
    if (!manual) throw new Error(`Not logged in: fill in the ${this.env.name} row of .auth/credentials.xlsx, or log in by hand`);
    log('Manual login completed');
  }

  /** Ends the SSO session (not just the portal one), so the next login starts clean. */
  async signOut() {
    const back = encodeURIComponent(`${this.env.baseURL}/c/portal/logout`);
    await this.page.goto(`http://${this.env.ssoHost}/oam/server/logout?end_url=${back}`).catch(() => {});
    await waitForAjaxIdle(this.page);
  }
}
