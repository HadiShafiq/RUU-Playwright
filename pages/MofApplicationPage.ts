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
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/**
 * Update MOF Profile Application. Saves (top Save), deletes branches and uploads documents, but
 * deliberately has no methods for Declare, Submit or the top Delete (which deletes the whole
 * application).
 */
export class MofApplicationPage {
  readonly errorBanner: Locator;
  readonly branches: CompanyBranches;

  constructor(readonly page: Page) {
    this.errorBanner = page.locator('.ui-messages-error:visible');
    this.branches = new CompanyBranches(page);
  }

  /** True when the application form with its left menu is on screen. */
  async isOnApplication(): Promise<boolean> {
    return this.sectionTab('Company Basic Information').isVisible();
  }

  /**
   * Dashboard Quick Link → accept Terms → Proceed → Save, then "click HERE" to continue the saved
   * application on the spot. If SIT answers ERR-722542 (a pending application already exists) the
   * existing draft is opened from My Task instead; nothing new is created.
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
    return { via: 'new', applicationNo: await this.saveNewAndContinue(log) };
  }

  /** Save a new application, then continue it through the acknowledgement's "HERE" link. */
  private async saveNewAndContinue(log: (m: string) => void): Promise<string> {
    log('Save (top of form) to create the draft');
    await this.save();
    const ack = this.page.getByText(/Please click HERE or navigate to Task List/);
    await expect(ack).toBeVisible();
    const applicationNo = (await ack.innerText()).match(/KU-\d+-\d+/)?.[0] ?? '';
    log(`Saved as ${applicationNo}. Continuing via "HERE" (not Task List)`);
    await ack.getByRole('link', { name: 'HERE', exact: true }).click();
    await waitForAjaxIdle(this.page);
    await this.expectOnApplication();
    return applicationNo;
  }

  /** Top-of-form Save. (The Delete next to it deletes the whole application and is never used.) */
  async save(): Promise<string> {
    await this.page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await waitForAjaxIdle(this.page);
    const messages = await this.page.locator('.ui-messages:visible, .ui-growl-item:visible').allInnerTexts();
    return messages.map((m) => m.replace(/\s+/g, ' ').trim()).join(' | ');
  }

  /**
   * Upload `file` through the upload dialog opened by `trigger` (an upload icon), then close the
   * dialog. The row the icon sits in shows the file name afterwards.
   */
  async uploadVia(trigger: Locator, file: string) {
    // The upload dialog is modal: while it is open, ignore its backdrop when waiting.
    const inDialog = { dialogOpen: true };
    await trigger.click();
    await waitForAjaxIdle(this.page, undefined, inDialog);
    // Pin the dialog by id: its file input disappears once the upload is done.
    const dialogId = await this.page.locator('.ui-dialog:visible').filter({ has: this.page.locator('input[type="file"]') }).last().getAttribute('id');
    const dialog = this.page.locator(`[id="${dialogId}"]`);
    await dialog.locator('input[type="file"]').first().setInputFiles(file);
    await waitForAjaxIdle(this.page, undefined, inDialog);
    await dialog.locator('td.start button, button:has(.ui-icon-arrowreturnthick-1-n)').first().click();
    await waitForAjaxIdle(this.page, undefined, inDialog);
    if (await dialog.isVisible()) await dialog.locator('a.ui-dialog-titlebar-close').click();
    await waitForAjaxIdle(this.page);
  }

  /** Register Category Code(s): overlap-category justification rows. */
  get overlapRows(): Locator {
    return this.page.locator('tbody[id*="overlapCatSuppDocDtId_data"] > tr');
  }

  /** Fill the justification of overlap row 0 and upload its supporting document. */
  async fillOverlapJustification(reason: string, file: string) {
    const area = this.page.locator('textarea[id*="overlapCatSuppDocDtId:0:overlapCaReasonId"]');
    await area.fill(reason);
    await area.blur();
    await waitForAjaxIdle(this.page);
    await this.uploadVia(this.page.locator('a[id*="overlapCatSuppDocDtId:0:"]').filter({ has: this.page.locator('img[src*="upload.png"]') }), file);
    await expect(this.overlapRows.first()).toContainText(fileName(file));
  }

  /** Supporting Documents: mandatory document rows. */
  get mandatoryRows(): Locator {
    return this.page.locator('tbody[id*="mandatoryTableId_data"] > tr');
  }

  /** Upload `file` to every mandatory document row that has none yet. Returns the documents uploaded. */
  async uploadMandatoryDocuments(file: string, log: (m: string) => void): Promise<string[]> {
    const done: string[] = [];
    const count = await this.mandatoryRows.count();
    for (let i = 0; i < count; i++) {
      const row = this.page.locator(`tbody[id*="mandatoryTableId_data"] > tr[data-ri="${i}"]`);
      const name = (await row.locator('td').nth(1).innerText()).trim().split('(')[0].trim();
      if ((await row.innerText()).includes(fileName(file).slice(0, 15))) {
        log(`"${name}" already has a document, skipped`);
        continue;
      }
      await this.uploadVia(row.locator('a').filter({ has: this.page.locator('img[src*="upload.png"]') }).first(), file);
      // The grid shortens long names ("File_pdf_for_te..."), so match the start only.
      await expect(row).toContainText(fileName(file).slice(0, 15));
      log(`Uploaded "${name}"`);
      done.push(name);
    }
    return done;
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

  /** States of all rows, across all pages. */
  async allStates(): Promise<string[]> {
    const states: string[] = [];
    const pages = await this.pageCount();
    for (let p = 1; p <= pages; p++) {
      await this.goToPage(p);
      states.push(...(await this.rowsOnPage()).map((r) => r.state));
    }
    return states;
  }

  /**
   * Delete every branch except `state`: select the others, then the Delete button below the grid →
   * "Yes". SIT commits the deletion at once (no Save needed). Returns the deleted states.
   */
  async deleteAllExcept(state: string, log: (m: string) => void): Promise<string[]> {
    const before = await this.allStates();
    if (!before.includes(state)) throw new Error(`Branch "${state}" not found; nothing deleted`);
    const others = before.filter((s) => s !== state);
    if (!others.length) return [];
    await this.selectAllExcept(state, log);
    const selected = await this.selectedStates();
    if (selected.includes(state) || selected.length !== others.length) {
      throw new Error(`Selection is not exactly all branches except ${state}: ${selected.join(', ')}. Nothing deleted`);
    }
    await this.page.locator('[id$="tt:delBranchBtnId"]').click();
    const confirm = this.page.locator('.ui-dialog:visible').filter({ hasText: 'Are you sure to proceed with branch deletion?' });
    await expect(confirm).toBeVisible();
    log('Branch Delete → "Yes"');
    await confirm.locator('[id$="pendingQTPopUpId:yesWithResetId"]').click();
    await waitForAjaxIdle(this.page);
    return others;
  }

  /** Walk every page: tick everything except `state`, untick `state`. */
  private async selectAllExcept(state: string, log: (m: string) => void) {
    const pages = await this.pageCount();
    for (let p = 1; p <= pages; p++) {
      await this.goToPage(p);
      for (const r of await this.rowsOnPage()) {
        const want = r.state !== state;
        if (r.selected !== want) {
          await this.row(r.state).locator('.ui-chkbox-box').click();
          await waitForAjaxIdle(this.page);
          log(`${want ? 'Ticked' : 'Unticked'} ${r.state} (page ${p})`);
        }
      }
    }
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
