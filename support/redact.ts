import type { Page, Locator } from '@playwright/test';

const SENSITIVE_PARAM = /(pass|pwd|token|session|ticket|auth|code|key|secret|oam_req|request_id)/i;

/** Remove query values that could carry credentials or session identifiers. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(key)) url.searchParams.set(key, 'REDACTED');
    }
    url.hash = '';
    return url.toString();
  } catch {
    return raw.split('?')[0];
  }
}

/** Elements that must be masked in every screenshot. */
export function sensitiveMasks(page: Page): Locator[] {
  return [page.locator('input[type="password"]'), page.locator('[data-sensitive], .sensitive')];
}
