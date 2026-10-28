import { expect, type Locator, type Page } from '@playwright/test';
import { waitForAjaxIdle } from '../support/primefaces';

/** Left-side menu of the MOF application (verified on SIT 2026-10-28). */
export const MOF_SECTIONS = [
  'Company Basic Information',
  'Assoc Company / Projects',
  'Personnel / Branch Info',
  'Capital / Equity Status',
  'Bank Information',
  'Register Category Code(s)',
  'Supporting Documents',
  'Declaration',
] as const;
export type MofSection = (typeof MOF_SECTIONS)[number];

export interface SectionResult {
  opened: boolean;
  /** Error/info banner the application shows after navigating, if any. */
  message: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Update MOF Profile Application: navigation only. This page object deliberately has no
 * methods for Save, Delete, Submit, Declare or dialog OK buttons.
 */
export class MofApplicationPage {
  readonly errorBanner: Locator;
  readonly branches: CompanyBranches;

  constructor(readonly page: Page) {
    this.errorBanner = page.locator('.ui-messages-error:visible');
    this.branches = new CompanyBranches(page);
  }

  /**
   * Dashboard Quick Link → accept Terms → Proceed. If SIT answers ERR-722542 (a pending
   * application already exists) the existing draft is opened from My Task; nothing new is created.
   */
  async open(log: (m: string) => void): Promise<{ via: 'new' | 'existing-draft'; applicationNo: string }> {
    await this.page.goto('/web/epapp/dashboard');
    // The "Ai" badge <img alt="icon"> follows the text with no space, so the accessible name is
    // "Update MOF Profile Applicationicon": match the prefix only.
    await this.page.getByRole('link', { name: /^Update MOF Profile Application/ }).click();
    await waitForAjaxIdle(this.page);
    await expect(this.page).toHaveTitle(/Update MOF Profile Application/);
    await this.page.getByRole('row', { name: /I Accept the Terms and Conditions/ }).locator('.ui-chkbox-box').click();
    await waitForAjaxIdle(this.page);
    await this.page.getByRole('button', { name: 'Proceed' }).click();
    await waitForAjaxIdle(this.page);

    const pending = this.page.getByText(/ERR-722542/);
    if (await pending.isVisible()) {
      log(`Application says: ${(await pending.innerText()).trim()}`);
      return { via: 'existing-draft', applicationNo: await this.openExistingDraft(log) };
    }
    await this.expectOnApplication();
    return { via: 'new', applicationNo: await this.applicationNo() };
  }

  /** Task List → My Task → "Update MOF draft application". Also used to reload the draft fresh. */
  async openExistingDraft(log: (m: string) => void): Promise<string> {
    log('Opening existing draft from Task List → My Task');
    await this.page.getByRole('menuitem', { name: 'Task List' }).click();
    await waitForAjaxIdle(this.page);
    const row = this.page.getByRole('row', { name: /Update MOF draft application/ }).first();
    const applicationNo = (await row.getByRole('gridcell').first().innerText()).trim();
    await row.getByRole('link', { name: /Update MOF draft application/ }).click();
    await waitForAjaxIdle(this.page);
    await this.expectOnApplication();
    return applicationNo;
  }

  async expectOnApplication() {
    // Existing draft: "MOF Application"; new, unsaved application: "Update MOF Profile Application".
    await expect(this.page).toHaveTitle(/MOF Application|Update MOF Profile Application/);
    await expect(this.sectionTab('Company Basic Information')).toBeVisible();
  }

  async applicationNo(): Promise<string> {
    const cell = this.page.getByRole('cell', { name: 'Application No. :' }).locator('xpath=following-sibling::td[1]');
    return (await cell.innerText()).trim();
  }

  /** Left-menu tab. Tabs carry status icons in their name ("Bank Information S"), so match by prefix. */
  sectionTab(name: MofSection): Locator {
    return this.page.getByRole('tab', { name: new RegExp(`^${escapeRegExp(name)}`) });
  }

  async goToSection(name: MofSection): Promise<SectionResult> {
    await this.page.locator('a.ui-commandlink').filter({ hasText: name }).first().click();
    await waitForAjaxIdle(this.page);
    const opened = (await this.sectionTab(name).getAttribute('aria-expanded')) === 'true';
    const message = (await this.errorBanner.count())
      ? (await this.errorBanner.first().innerText()).replace(/\s+/g, ' ').trim()
      : '';
    return { opened, message };
  }
}

/** "Company Branches" grid in Personnel / Branch Info. Row checkboxes only select rows. */
export class CompanyBranches {
  constructor(private page: Page) {}

  get table(): Locator {
    return this.page
      .locator('.ui-datatable')
      .filter({ has: this.page.getByRole('columnheader', { name: 'Branch Name' }) })
      .last();
  }

  private get pageLinks(): Locator {
    return this.table.locator('.ui-paginator').first().locator('.ui-paginator-page');
  }

  /** Number of grid pages; 1 when the grid fits on one page and has no paginator. */
  async pageCount(): Promise<number> {
    return Math.max(1, await this.pageLinks.count());
  }

  async goToPage(n: number) {
    if ((await this.pageLinks.count()) === 0) return; // single page, nothing to click
    await this.pageLinks.getByText(String(n), { exact: true }).click();
    await waitForAjaxIdle(this.page);
    // The grid re-renders asynchronously; don't read rows until page n is the active page.
    await expect(this.table.locator('.ui-paginator').first().locator('.ui-paginator-page.ui-state-active')).toHaveText(String(n));
  }

  /** State (first line of the Branch Name cell) and selection status of each row on the current page. */
  async rowsOnPage(): Promise<{ state: string; selected: boolean }[]> {
    return this.table.locator('tbody.ui-datatable-data > tr').evaluateAll((trs) =>
      trs.map((tr) => ({
        state: ((tr as HTMLTableRowElement).cells[1]?.innerText ?? '').trim().split('\n')[0],
        selected: tr.getAttribute('aria-selected') === 'true' || !!tr.querySelector('.ui-chkbox-box.ui-state-active'),
      })),
    );
  }

  row(state: string): Locator {
    return this.table
      .locator('tbody.ui-datatable-data > tr')
      .filter({ has: this.page.locator('td:nth-child(2) td').getByText(state, { exact: true }) });
  }

  /** Walk every page: tick `state`, untick everything else. Returns the page `state` is on. */
  async selectOnly(state: string, log: (m: string) => void): Promise<number> {
    const pages = await this.pageCount();
    let found = 0;
    for (let p = 1; p <= pages; p++) {
      await this.goToPage(p);
      for (const r of await this.rowsOnPage()) {
        const want = r.state === state;
        if (want) found = p;
        if (r.selected !== want) {
          await this.row(r.state).locator('.ui-chkbox-box').click();
          await waitForAjaxIdle(this.page);
          log(`${want ? 'Ticked' : 'Unticked'} ${r.state} (page ${p})`);
        }
      }
    }
    if (!found) throw new Error(`Branch "${state}" not found on any of ${pages} pages`);
    return found;
  }

  /** States currently selected, across all pages. */
  async selectedStates(): Promise<string[]> {
    const selected: string[] = [];
    const pages = await this.pageCount();
    for (let p = 1; p <= pages; p++) {
      await this.goToPage(p);
      selected.push(...(await this.rowsOnPage()).filter((r) => r.selected).map((r) => r.state));
    }
    return selected;
  }
}
