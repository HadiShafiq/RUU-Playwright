import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type Page, type TestDetails } from '@playwright/test';
import { getEnv, type EnvConfig } from '../config/environments';
import { redactUrl, sensitiveMasks } from '../support/redact';

export interface ScenarioMeta {
  cr: string;
  id: string;
  module: string;
  role: string;
  /** Approved expected result. Generated scenarios must say "Proposed — Pending QA Review". */
  expected: string;
  tags?: string[];
}

/** Build the test details (tags + annotations) that drive traceability and the execution report. */
export function scenario(m: ScenarioMeta): TestDetails {
  return {
    tag: [`@${m.cr}`, `@${m.id}`, ...(m.tags ?? [])],
    annotation: [
      { type: 'cr', description: m.cr },
      { type: 'scenario', description: m.id },
      { type: 'module', description: m.module },
      { type: 'role', description: m.role },
      { type: 'expected', description: m.expected },
    ],
  };
}

interface StepRecord {
  file: string;
  step: string;
  expected: string;
  actual: string;
}

export interface Evidence {
  dir: string;
  /** Screenshot a checkpoint (sensitive fields masked) and record it in the scenario summary. */
  capture(name: string, info: { step: string; expected?: string; actual?: string }): Promise<void>;
  /** Record the observed result shown in the execution report. */
  actual(text: string): void;
  /** Timestamped line in the console and in execution.log. */
  log(message: string): void;
}

type Fixtures = { env: EnvConfig; evidence: Evidence };

const stripAnsi = (s: string) => s.replace(/\u001b\[[\d;]*m/g, '');

function annotation(type: string): string {
  return base.info().annotations.find((a) => a.type === type)?.description ?? '';
}

export const test = base.extend<Fixtures>({
  env: async ({}, use) => use(getEnv()),

  evidence: async ({ page, env }, use, testInfo) => {
    const cr = annotation('cr') || 'UNMAPPED';
    const id = annotation('scenario') || testInfo.titlePath.join('_').replace(/[^\w-]+/g, '_').slice(0, 60);
    const dir = path.resolve(__dirname, '..', 'evidence', env.name, cr, id, process.env.RUN_ID ?? 'local');
    fs.mkdirSync(dir, { recursive: true });

    const steps: StepRecord[] = [];
    const consoleErrors: string[] = [];
    const networkFailures: string[] = [];
    let actualResult = '';
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 500)));
    page.on('requestfailed', (r) => networkFailures.push(`${r.method()} ${redactUrl(r.url())} — ${r.failure()?.errorText}`));
    page.on('response', (r) => r.status() >= 500 && networkFailures.push(`${r.status()} ${r.request().method()} ${redactUrl(r.url())}`));

    let counter = 0;
    const evidence: Evidence = {
      dir,
      async capture(name, info) {
        const file = `${String(++counter).padStart(2, '0')}_${name.replace(/[^\w-]+/g, '_')}.png`;
        await page.screenshot({ path: path.join(dir, file), mask: sensitiveMasks(page), animations: 'disabled' });
        steps.push({ file, step: info.step, expected: info.expected ?? '', actual: info.actual ?? '' });
      },
      actual(text) {
        actualResult = text;
      },
      log(message) {
        const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' });
        const line = `[${time}] ${id}: ${message}`;
        console.log(line);
        fs.appendFileSync(path.join(dir, 'execution.log'), line + '\n');
      },
    };

    await use(evidence);

    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed && !page.isClosed()) {
      await page.screenshot({ path: path.join(dir, 'failure_details.png'), mask: sensitiveMasks(page) }).catch(() => {});
      fs.writeFileSync(path.join(dir, 'failure_dom.html'), await page.content().catch(() => ''));
    }
    const summary = {
      cr,
      scenario: id,
      title: testInfo.title,
      environment: env.name,
      module: annotation('module'),
      role: annotation('role'),
      status: annotation('blocked') ? 'BLOCKED' : failed ? 'FAIL' : testInfo.status === 'skipped' ? 'NOT RUN' : 'PASS',
      expected: annotation('expected'),
      actual: actualResult || annotation('blocked') || (failed ? stripAnsi(testInfo.error?.message ?? '').split('\n')[0] : ''),
      error: failed ? stripAnsi(testInfo.error?.message ?? '') : undefined,
      finalUrl: page.isClosed() ? '' : redactUrl(page.url()),
      durationMs: testInfo.duration,
      attempt: testInfo.retry + 1,
      steps,
      consoleErrors: failed ? consoleErrors : consoleErrors.length,
      networkFailures: failed ? networkFailures : networkFailures.length,
      trace: failed ? path.relative(dir, path.join(testInfo.outputDir, 'trace.zip')) : undefined,
    };
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(
      path.join(dir, 'summary.md'),
      [
        `# ${cr} / ${id} — ${summary.status}`,
        `${testInfo.title} · ${env.name} · ${summary.module} · role: ${summary.role}`,
        '',
        `**Expected:** ${summary.expected}`,
        `**Actual:** ${summary.actual}`,
        '',
        '| Screenshot | Step | Expected | Actual |',
        '|---|---|---|---|',
        ...steps.map((s) => `| ${s.file} | ${s.step} | ${s.expected} | ${s.actual} |`),
        ...(failed ? ['', '| failure_details.png | Failure state | | |', '', '```', summary.error ?? '', '```'] : []),
      ].join('\n'),
    );
    testInfo.annotations.push({ type: 'evidence', description: dir }, { type: 'actual', description: summary.actual });
  },
});

export { expect };

/**
 * True when the page was bounced to a login page, i.e. the saved session is missing or expired.
 * Verified on SIT: protected pages redirect to /ssologin on the same host.
 */
export function isOnLoginPage(page: Page, env: EnvConfig): boolean {
  const url = new URL(page.url());
  return url.host === env.ssoHost || url.pathname.toLowerCase().startsWith('/ssologin');
}
