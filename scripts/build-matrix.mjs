// Builds coverage/scenario-matrix.csv from the Katalon "Test Cases" tree plus any Playwright
// specs tagged with @KAT-xxx. Re-run after adding specs:  npm run matrix
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Katalon project to inventory: KATALON_DIR, or the CDC-Katalon-Automation folder next to this one.
const katalonRoot = process.env.KATALON_DIR ?? path.resolve(root, '..', 'CDC-Katalon-Automation');
const katalon = path.join(katalonRoot, 'Test Cases');
if (!fs.existsSync(katalon)) {
  console.error(`Katalon "Test Cases" not found at ${katalon}. Set KATALON_DIR to the Katalon project folder.`);
  process.exit(1);
}
const out = path.join(root, 'coverage', 'scenario-matrix.csv');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.tc') ? [path.join(d, e.name)] : []);

const ROLES = [
  [/supplier/i, 'Supplier'], [/receiving officer/i, 'Receiving Officer'], [/acknowledge officer/i, 'Acknowledge Officer'],
  [/approv/i, 'Approver'], [/do verify/i, 'Delivery Officer'], [/payment/i, 'Finance / Payment'],
  [/requ?is?i?tioner|requestioner|prepare|add to/i, 'Requisitioner'], [/mof profile/i, 'Supplier'],
];
const STATE_CHANGING = /submit|approve|create|acknowledge|prepare|add |add to|respond|assign|stop delivery|payment|update|amendment|claim|direct loa|verify/i;

const specs = fs.existsSync(path.join(root, 'tests'))
  ? walk2(path.join(root, 'tests')).map((f) => [path.relative(root, f), fs.readFileSync(f, 'utf8')])
  : [];
function walk2(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk2(path.join(d, e.name)) : /\.spec\.ts$/.test(e.name) ? [path.join(d, e.name)] : []);
}

const rows = walk(katalon).sort().map((f, i) => {
  const id = `KAT-${String(i + 1).padStart(3, '0')}`;
  const rel = path.relative(katalon, f).split(path.sep).join('/').replace(/\.tc$/, '');
  const parts = rel.split('/');
  const name = parts.at(-1);
  const spec = specs.find(([, src]) => src.includes(`'${id}'`) || src.includes(`@${id}`));
  return {
    'Scenario ID': id,
    'CR Number': '',
    Module: parts[0].replace(/^\d+\.\s*/, ''),
    'Sub-flow': parts.slice(1, -1).join(' / '),
    'Test Case': name,
    Role: ROLES.find(([re]) => re.test(name))?.[1] ?? 'TBD',
    'Data Impact': STATE_CHANGING.test(name) ? 'State-changing (approval needed)' : 'Review',
    'Katalon Source': `Test Cases/${rel}.tc`,
    'Playwright Spec': spec?.[0] ?? '',
    'Automation Status': spec ? 'Automated (Playwright)' : 'Pending (Katalon only)',
    'Execution Status': 'NOT RUN',
    'Expected Result': '',
    Notes: '',
  };
});

const cols = Object.keys(rows[0]);
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n'));
const automated = rows.filter((r) => r['Playwright Spec']).length;
console.log(`${rows.length} Katalon scenarios, ${automated} with Playwright specs (${((automated / rows.length) * 100).toFixed(1)}%) → ${path.relative(root, out)}`);
