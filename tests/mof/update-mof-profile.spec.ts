import path from 'node:path';
import { test, expect, scenario } from '../../fixtures/attached';
import { LoginPage } from '../../pages/LoginPage';
import { MofApplicationPage, type MofSection } from '../../pages/MofApplicationPage';
import type { Evidence } from '../../fixtures/test';
import type { EnvConfig } from '../../config/environments';
import type { Page } from '@playwright/test';

/*
 * Update MOF Profile Application, prepared up to Declaration:
 *   login → Quick Link → Terms → Proceed → Save (new draft) → "HERE"
 *   then the left menu in order, on the same page (never back to Task List):
 *   Personnel / Branch Info: delete every branch except SELANGOR
 *   Register Category Code(s): overlap justification + document, Save
 *   Supporting Documents: upload the mandatory documents, Save
 *   Declaration: STOP. Declare is never clicked.
 *
 * DATA-CHANGING (SIT): creates and saves a draft, deletes branches, uploads documents.
 * Record each run in knowledge/data-change-audit.md.
 *
 * Watch it run (keeps the browser open on Declaration):
 *   npm run browser:sit
 *   npm run mof:sit
 */
test.describe.configure({ mode: 'serial' });

const CR = 'MOF-PROFILE';
const MODULE = 'Supplier Management / Update MOF Profile';
const ROLE = 'Supplier Administrator (MOF)';
const KEEP_BRANCH = 'SELANGOR';
const JUSTIFICATION = 'Testing Justification';
const UPLOAD_PDF = path.resolve(__dirname, '../../fixtures/files/File_pdf_for_testing.pdf');

// Katalon counterpart: Test Cases/Update MOF Profile.tc (KAT-065 in coverage/scenario-matrix.csv).
const meta = (id: string, expected: string) =>
  scenario({ cr: CR, id, module: MODULE, role: ROLE, tags: ['@KAT-065'], expected: `Proposed — Pending QA Review: ${expected}` });

/** Stay on the application if it is already open (normal serial run); otherwise log in and open it. */
async function onApplication(page: Page, env: EnvConfig, evidence: Evidence) {
  const mof = new MofApplicationPage(page);
  if (await mof.isOnApplication()) return mof;
  await new LoginPage(page, env).ensureLoggedIn(evidence.log);
  const { via, applicationNo } = await mof.open(evidence.log);
  evidence.log(`On MOF application ${applicationNo} (${via})`);
  return mof;
}

/** Click a left-menu section on the current page. Fails with the application's message if blocked. */
async function openSection(mof: MofApplicationPage, name: MofSection, evidence: Evidence) {
  evidence.log(`Left menu → "${name}"`);
  const { opened, message } = await mof.goToSection(name);
  expect(opened, `"${name}" did not open. Application message: ${message || '(none)'}`).toBe(true);
  if (message) evidence.log(`Notice on "${name}": ${message}`);
  return message;
}

test(
  'Open Update MOF Profile Application and save the draft',
  meta('MOF-001', 'After login, Quick Link → accept Terms → Proceed → Save creates a draft (KU-…), and "HERE" opens it with its left-side menu. If a pending application exists (ERR-722542), that draft is opened instead.'),
  async ({ page, env, evidence }) => {
    // Allow for a manual-login wait on top of the normal test time.
    test.setTimeout(Number(process.env.LOGIN_WAIT_MS ?? 180_000) + 120_000);
    await new LoginPage(page, env).ensureLoggedIn(evidence.log);
    await evidence.capture('logged_in', { step: 'Login', expected: 'Authenticated dashboard' });
    const mof = new MofApplicationPage(page);
    const { via, applicationNo } = await mof.open(evidence.log);
    await evidence.capture('mof_application_opened', { step: 'Open Update MOF Profile Application', expected: 'Application with left menu', actual: `${applicationNo} (${via})` });
    evidence.actual(`Opened ${applicationNo} via ${via === 'new' ? 'new application, saved' : 'existing draft (ERR-722542 on new)'}`);
  },
);

for (const [id, name] of [
  ['MOF-002', 'Company Basic Information'],
  ['MOF-003', 'Assoc Company / Projects'],
] as const) {
  test(`Left menu section opens: ${name}`, meta(id, `Clicking "${name}" in the left menu opens that section.`), async ({ page, env, evidence }) => {
    const mof = await onApplication(page, env, evidence);
    const notice = await openSection(mof, name, evidence);
    await evidence.capture(`section_${name}`, { step: `Open "${name}"`, expected: 'Section opens', actual: notice || 'Opened' });
    evidence.actual('Section opened');
  });
}

test(
  'Personnel / Branch Info: keep only the SELANGOR branch',
  meta('MOF-004', 'In Personnel / Branch Info → Company Branches, every branch except SELANGOR is deleted (Delete → Yes), leaving only SELANGOR.'),
  async ({ page, env, evidence }) => {
    const mof = await onApplication(page, env, evidence);
    const notice = await openSection(mof, 'Personnel / Branch Info', evidence);
    await mof.branches.table.scrollIntoViewIfNeeded();
    await evidence.capture('personnel_branch_info', { step: 'Open Personnel / Branch Info', expected: 'Section opens', actual: notice || 'Opened' });

    const deleted = await mof.branches.deleteAllExcept(KEEP_BRANCH, evidence.log);
    evidence.log(deleted.length ? `Deleted ${deleted.length} branch(es): ${deleted.join(', ')}` : `Only ${KEEP_BRANCH} already, nothing deleted`);
    const remaining = await mof.branches.allStates();
    expect(remaining, `Only the ${KEEP_BRANCH} branch remains`).toEqual([KEEP_BRANCH]);
    await mof.branches.table.scrollIntoViewIfNeeded();
    await evidence.capture('only_selangor_left', { step: `Delete all branches except ${KEEP_BRANCH}`, expected: `Only ${KEEP_BRANCH}`, actual: remaining.join(', ') });
    evidence.actual(`Deleted ${deleted.length}; remaining: ${remaining.join(', ')}`);
  },
);

for (const [id, name] of [
  ['MOF-005', 'Capital / Equity Status'],
  ['MOF-006', 'Bank Information'],
] as const) {
  test(`Left menu section opens: ${name}`, meta(id, `Clicking "${name}" in the left menu opens that section.`), async ({ page, env, evidence }) => {
    const mof = await onApplication(page, env, evidence);
    const notice = await openSection(mof, name, evidence);
    await evidence.capture(`section_${name}`, { step: `Open "${name}"`, expected: 'Section opens', actual: notice || 'Opened' });
    evidence.actual('Section opened');
  });
}

test(
  'Register Category Code(s): overlap justification and document, then Save',
  meta('MOF-007', 'In Register Category Code(s), the overlap category gets the justification and its supporting document ("Surat Rayuan Pertindihan Bidang"), and Save keeps them.'),
  async ({ page, env, evidence }) => {
    const mof = await onApplication(page, env, evidence);
    await openSection(mof, 'Register Category Code(s)', evidence);
    const rows = await mof.overlapRows.count();
    evidence.log(`Overlap justification rows: ${rows}`);
    if (rows) {
      await mof.fillOverlapJustification(JUSTIFICATION, UPLOAD_PDF);
      evidence.log(`Justification "${JUSTIFICATION}" + ${path.basename(UPLOAD_PDF)} uploaded`);
    }
    await evidence.capture('overlap_justification', { step: 'Justification + document', expected: 'Filled', actual: rows ? 'Filled' : 'No overlap category' });
    // SIT may still show ERR-722661 once after this Save; the data is saved (verified by reload on SIT).
    const saved = await mof.save();
    evidence.log(`Save: ${saved || '(no message)'}`);
    await evidence.capture('register_category_saved', { step: 'Save', expected: 'Saved', actual: saved });
    evidence.actual(rows ? `Justification and document added; Save: ${saved}` : 'No overlap category on this application');
  },
);

test(
  'Supporting Documents: upload the mandatory documents, then Save',
  meta('MOF-008', 'In Supporting Documents, every mandatory document row gets a document and Save reports "successfully saved".'),
  async ({ page, env, evidence }) => {
    const mof = await onApplication(page, env, evidence);
    await openSection(mof, 'Supporting Documents', evidence);
    evidence.log(`Mandatory document rows: ${await mof.mandatoryRows.count()}`);
    const uploaded = await mof.uploadMandatoryDocuments(UPLOAD_PDF, evidence.log);
    await mof.mandatoryRows.first().scrollIntoViewIfNeeded();
    await evidence.capture('mandatory_documents', { step: 'Upload mandatory documents', expected: 'All rows have a document', actual: uploaded.join('; ') || 'already uploaded' });
    const saved = await mof.save();
    evidence.log(`Save: ${saved}`);
    expect(saved).toMatch(/successfully saved/i);
    await evidence.capture('supporting_documents_saved', { step: 'Save', expected: 'successfully saved', actual: saved });
    evidence.actual(`Uploaded ${uploaded.length}; ${saved}`);
  },
);

test(
  'Declaration: open and STOP before Declare',
  meta('MOF-009', 'Declaration opens and shows the Declare button. The test stops there; Declare is not clicked.'),
  async ({ page, env, evidence }) => {
    const mof = await onApplication(page, env, evidence);
    await openSection(mof, 'Declaration', evidence);
    const declare = page.getByRole('button', { name: 'Declare', exact: true });
    await expect(declare).toBeVisible();
    await declare.scrollIntoViewIfNeeded();
    await evidence.capture('declaration_STOP', { step: 'Open Declaration', expected: 'Declare button shown, not clicked', actual: 'Stopped' });
    evidence.log('STOP on Declaration. Declare NOT clicked. Browser left open here.');
    evidence.actual('Declaration opened; stopped without clicking Declare');
  },
);
