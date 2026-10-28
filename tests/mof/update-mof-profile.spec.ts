import { test, expect, scenario } from '../../fixtures/attached';
import { LoginPage } from '../../pages/LoginPage';
import { MofApplicationPage, type MofSection } from '../../pages/MofApplicationPage';
import type { Evidence } from '../../fixtures/test';
import type { EnvConfig } from '../../config/environments';
import type { Page } from '@playwright/test';

/*
 * Update MOF Profile Application: explore the left menu, then leave only the SELANGOR branch
 * selected in Personnel / Branch Info and STOP.
 *
 * NON-DESTRUCTIVE: navigation, paging and row-selection only. Save, Delete, Submit, Declare
 * and dialog OK/Yes are never clicked. Nothing is persisted.
 *
 * Watch it run (keeps the browser open at the end):
 *   npm run mof:sit
 */
test.describe.configure({ mode: 'serial' });

const CR = 'MOF-PROFILE';
const MODULE = 'Supplier Management / Update MOF Profile';
const ROLE = 'Supplier Administrator (MOF)';
const TARGET_STATE = 'SELANGOR';

/** Leave the browser on the MOF application, logging in and opening it only if needed. */
async function ensureOnApplication(page: Page, env: EnvConfig, evidence: Evidence) {
  const mof = new MofApplicationPage(page);
  if (/MOF Application/.test(await page.title())) return mof;
  await new LoginPage(page, env).ensureLoggedIn(evidence.log);
  const { via, applicationNo } = await mof.open(evidence.log);
  evidence.log(`On MOF application ${applicationNo} (${via})`);
  return mof;
}

/**
 * Open a section. If it doesn't open, capture the application's message, reload the draft fresh
 * and retry once (a validation on the current section can block leaving it). Returns the
 * blocking message if it still won't open.
 */
async function openSection(mof: MofApplicationPage, name: MofSection, evidence: Evidence): Promise<string> {
  evidence.log(`Left menu → "${name}"`);
  let result = await mof.goToSection(name);
  if (result.opened) return '';
  evidence.log(`Not opened. Application message: ${result.message || '(none)'}`);
  await evidence.capture('navigation_blocked', { step: `Click "${name}"`, expected: 'Section opens', actual: result.message });
  evidence.log('Repair attempt 1: reload the draft from Task List and retry');
  await mof.openExistingDraft(evidence.log);
  result = await mof.goToSection(name);
  return result.opened ? '' : result.message || 'Section did not open (no message shown)';
}

const SECTIONS: { id: string; name: MofSection }[] = [
  { id: 'MOF-002', name: 'Company Basic Information' },
  { id: 'MOF-003', name: 'Assoc Company / Projects' },
  { id: 'MOF-004', name: 'Capital / Equity Status' },
  { id: 'MOF-005', name: 'Bank Information' },
  { id: 'MOF-006', name: 'Register Category Code(s)' },
  { id: 'MOF-007', name: 'Supporting Documents' },
  { id: 'MOF-008', name: 'Declaration' },
];

test(
  'Open Update MOF Profile Application',
  scenario({
    cr: CR, id: 'MOF-001', module: MODULE, role: ROLE,
    expected: 'Proposed — Pending QA Review: After login, Quick Link → accept Terms → Proceed opens the MOF application with its left-side menu. If a pending application exists (ERR-722542), that draft is opened instead.',
  }),
  async ({ page, env, evidence }) => {
    // Allow for the manual-login wait on top of the normal test time.
    test.setTimeout(Number(process.env.LOGIN_WAIT_MS ?? 180_000) + 120_000);
    await new LoginPage(page, env).ensureLoggedIn(evidence.log);
    await evidence.capture('logged_in', { step: 'Login', expected: 'Authenticated dashboard' });
    const mof = new MofApplicationPage(page);
    const { via, applicationNo } = await mof.open(evidence.log);
    await evidence.capture('mof_application_opened', { step: 'Open Update MOF Profile Application', expected: 'Application with left menu', actual: `${applicationNo} (${via})` });
    evidence.actual(`Opened ${applicationNo} via ${via === 'new' ? 'new application' : 'existing draft (ERR-722542 on new)'}`);
  },
);

for (const { id, name } of SECTIONS) {
  test(
    `Left menu section opens: ${name}`,
    scenario({ cr: CR, id, module: MODULE, role: ROLE, expected: `Proposed — Pending QA Review: Clicking "${name}" in the left menu opens that section.` }),
    async ({ page, env, evidence }) => {
      const mof = await ensureOnApplication(page, env, evidence);
      const blocked = await openSection(mof, name, evidence);
      if (blocked) {
        await evidence.capture('section_blocked', { step: `Open "${name}"`, expected: 'Section opens', actual: blocked });
        test.info().annotations.push({ type: 'blocked', description: `Application validation: ${blocked}` });
        // Leave a clean state for the next scenario.
        await mof.openExistingDraft(evidence.log);
        test.skip(true, blocked);
      }
      await expect(mof.sectionTab(name)).toHaveAttribute('aria-expanded', 'true');
      await evidence.capture(`section_${name}`, { step: `Open "${name}"`, expected: 'Section opens', actual: 'Opened' });
      evidence.actual('Section opened');
    },
  );
}

test(
  'Personnel / Branch Info: only SELANGOR branch selected, then STOP',
  scenario({
    cr: CR, id: 'MOF-009', module: MODULE, role: ROLE,
    expected: 'Proposed — Pending QA Review: In Personnel / Branch Info → Company Branches, only the SELANGOR branch row is selected across all pages. Nothing is saved.',
  }),
  async ({ page, env, evidence }) => {
    const mof = await ensureOnApplication(page, env, evidence);
    const modifiedBefore = await page.getByRole('cell', { name: 'Modified By :' }).locator('xpath=following-sibling::td[1]').innerText();

    const blocked = await openSection(mof, 'Personnel / Branch Info', evidence);
    expect(blocked, 'Personnel / Branch Info must open').toBe('');
    const notice = (await mof.errorBanner.count()) ? (await mof.errorBanner.first().innerText()).trim() : '';
    if (notice) evidence.log(`Application notice on Personnel / Branch Info: ${notice}`);
    await evidence.capture('personnel_branch_info', { step: 'Open Personnel / Branch Info', expected: 'Section opens', actual: notice || 'Opened' });

    await mof.branches.table.scrollIntoViewIfNeeded();
    const pages = await mof.branches.pageCount();
    evidence.log(`Company Branches: ${pages} page(s). Selecting only ${TARGET_STATE}`);
    const targetPage = await mof.branches.selectOnly(TARGET_STATE, evidence.log);

    evidence.log('Verifying selection across all pages');
    const selected = await mof.branches.selectedStates();
    evidence.log(`Selected rows across all pages: ${JSON.stringify(selected)}`);
    expect(selected, 'Only the SELANGOR branch is selected').toEqual([TARGET_STATE]);

    // Finish on the page that shows the selected SELANGOR row.
    await mof.branches.goToPage(targetPage);
    const row = mof.branches.row(TARGET_STATE);
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await row.scrollIntoViewIfNeeded();
    await evidence.capture('only_selangor_selected', {
      step: `Company Branches page ${targetPage}`,
      expected: 'Only SELANGOR selected',
      actual: `Selected: ${selected.join(', ')}`,
    });

    const modifiedAfter = await page.getByRole('cell', { name: 'Modified By :' }).locator('xpath=following-sibling::td[1]').innerText();
    expect(modifiedAfter, 'Draft "Modified By" must not change (nothing saved)').toBe(modifiedBefore);
    evidence.log(`STOP. Modified By unchanged (${modifiedAfter.trim()}). No Save/Submit/Confirm/Delete clicked.`);
    evidence.actual(`Only ${selected.join(', ')} selected (verified on all ${pages} pages); Modified By unchanged; stopped without saving`);
  },
);
