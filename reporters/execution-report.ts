import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Writes execution-report.csv (opens directly in Excel) and execution-summary.md with the
 * fields from the QA reporting standard. Statuses come only from real Playwright results.
 */
type Row = Record<string, string>;

const COLUMNS = [
  'Scenario ID', 'CR Number', 'Title', 'Module', 'Role', 'Environment', 'Automation Status', 'Execution Status',
  'Attempt Count', 'Duration (s)', 'Expected Result', 'Actual Result', 'Defect Reference', 'Evidence', 'Trace',
];

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default class ExecutionReport implements Reporter {
  private rows = new Map<string, Row>();
  constructor(private opts: { outputDir: string }) {}

  onTestEnd(test: TestCase, result: TestResult) {
    if (test.parent.project()?.name === 'auth') return;
    const ann = [...test.annotations, ...((result as any).annotations ?? [])];
    const get = (t: string) => ann.filter((a) => a.type === t).pop()?.description ?? '';
    const status =
      result.status === 'passed' ? 'PASS'
      : result.status === 'skipped' ? (get('blocked') ? 'BLOCKED' : 'NOT RUN')
      : 'FAIL';
    const trace = result.attachments.find((a) => a.name === 'trace')?.path ?? '';
    this.rows.set(test.id, {
      'Scenario ID': get('scenario') || test.title,
      'CR Number': get('cr'),
      Title: test.title,
      Module: get('module'),
      Role: get('role'),
      Environment: process.env.TEST_ENV?.toUpperCase() ?? '',
      'Automation Status': 'Automated',
      'Execution Status': status,
      'Attempt Count': String(result.retry + 1),
      'Duration (s)': (result.duration / 1000).toFixed(1),
      'Expected Result': get('expected'),
      'Actual Result': get('actual') || get('blocked') || (result.error?.message ?? '').replace(/\u001b\[[\d;]*m/g, '').split('\n')[0],
      'Defect Reference': get('defect'),
      Evidence: get('evidence') && path.relative(process.cwd(), get('evidence')),
      Trace: trace && path.relative(process.cwd(), trace),
    });
  }

  onEnd(result: FullResult) {
    const rows = [...this.rows.values()];
    if (!rows.length) return; // e.g. --list or auth-only runs
    fs.mkdirSync(this.opts.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.opts.outputDir, 'execution-report.csv'),
      '﻿' + [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csv(r[c] ?? '')).join(','))].join('\r\n'),
    );
    const count = (s: string) => rows.filter((r) => r['Execution Status'] === s).length;
    const executed = count('PASS') + count('FAIL');
    const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a');
    fs.writeFileSync(
      path.join(this.opts.outputDir, 'execution-summary.md'),
      [
        `# Execution summary — ${process.env.TEST_ENV?.toUpperCase()} — run ${process.env.RUN_ID}`,
        '',
        `Overall: **${result.status}**`,
        '',
        '| Metric | Value |', '|---|---|',
        `| Total scenarios executed | ${rows.length} |`,
        `| Passed | ${count('PASS')} |`,
        `| Failed | ${count('FAIL')} |`,
        `| Blocked | ${count('BLOCKED')} |`,
        `| Not Run | ${count('NOT RUN')} |`,
        `| Execution pass % (PASS / (PASS+FAIL)) | ${pct(count('PASS'), executed)} |`,
        '',
        'Automation coverage against the full scenario inventory is in `coverage/scenario-matrix.csv`.',
      ].join('\n'),
    );
  }
}
