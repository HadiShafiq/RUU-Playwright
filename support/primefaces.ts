import { expect, type Locator, type Page } from '@playwright/test';

/** Overlays PrimeFaces/JSF shows while an AJAX request or postback is in flight. */
const BLOCKING_OVERLAYS = '.ui-blockui:visible, .blockUI:visible, .ui-widget-overlay:visible';

/**
 * Wait until PrimeFaces has no queued AJAX requests and no blocking overlay is visible.
 * Ported from the Katalon WebHelper.waitBlockUI(), plus a check of the PrimeFaces AJAX queue.
 */
export async function waitForAjaxIdle(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const pf = (window as any).PrimeFaces;
      const queueEmpty = !pf?.ajax?.Queue || pf.ajax.Queue.isEmpty();
      const jqActive = (window as any).jQuery ? (window as any).jQuery.active === 0 : true;
      return queueEmpty && jqActive;
    },
    undefined,
    { timeout },
  );
  await expect(page.locator(BLOCKING_OVERLAYS)).toHaveCount(0, { timeout });
}

/** Click and wait for the resulting AJAX update to settle. */
export async function clickAndSettle(target: Locator): Promise<void> {
  await target.click();
  await waitForAjaxIdle(target.page());
}

/**
 * Select an option in a PrimeFaces SelectOneMenu (the visible widget, not the hidden <select>).
 * `menu` is the widget container, e.g. page.locator('[id$=":procurementType"]').
 */
export async function selectOneMenu(menu: Locator, optionLabel: string | RegExp): Promise<void> {
  const page = menu.page();
  await menu.locator('.ui-selectonemenu-trigger').click();
  const panelId = `${await menu.getAttribute('id')}_panel`;
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toBeVisible();
  await panel.getByRole('option', { name: optionLabel }).or(panel.locator('li', { hasText: optionLabel })).first().click();
  await waitForAjaxIdle(page);
}

/**
 * JSF IDs look like "_Catalogue_WAR_NGePportlet_:form:procurementType". The prefix can change,
 * so match on the stable trailing segment(s).
 */
export function byJsfIdSuffix(page: Page, suffix: string): Locator {
  return page.locator(`[id$="${suffix.startsWith(':') ? suffix : ':' + suffix}"]`);
}
