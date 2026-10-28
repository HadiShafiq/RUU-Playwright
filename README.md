# ePerolehan — Playwright automation

Standalone Playwright project. It reads the Katalon project (`C:\Users\hadishafiq\CDC-Katalon-Automation`, or `KATALON_DIR`) only to build the coverage matrix, and never changes it.

## One-time setup
```
npm install
npm run auth:sit        # a browser opens: log in by hand, then press Resume in the Inspector
```
The session is saved to `.auth/sit.json` (git-ignored). If it expires, tests fail with "Redirected to SSO". When that happens, run the auth step again.

## Running
| Command | What it does |
|---|---|
| `npm run smoke:sit` / `smoke:uat` | Read-only smoke tests |
| `npm run test:sit -- --grep @CR29641` | All tests for one CR |
| `npm run test:sit -- --grep @TC-004` | One scenario |
| `npm run report` | Open the HTML report |
| `npm run matrix` | Rebuild `coverage/scenario-matrix.csv` |

`TEST_ENV` is required. No environment is used by default, and production isn't configured.

## Low-memory machines
- All Playwright browsers start with `config/low-memory-chromium-args.json`. `--disable-gpu` is the main saving: one SIT tab measured 789 MB → 612 MB.
- Workers = free RAM in GB (1 to 3). Override with `WORKERS=n`.
- Video is off by default. Use `VIDEO=1` to record failures.
- `npm run browser:sit` starts the kept-open browser **detached**, so closing the terminal doesn't close it.
- `npm run browsers:mem` shows Playwright browser memory. `npm run browsers:kill` closes Playwright browsers only, never your own Chrome.

## Outputs
- `evidence/<ENV>/<CR>/<Scenario>/<RunId>/`: numbered checkpoint screenshots, `summary.md` and `summary.json`. On failure it also holds `failure_details.png` and `failure_dom.html`.
- `reports/<ENV>/<RunId>/`: `execution-report.csv` (opens in Excel), `execution-summary.md`, `results.json`, `junit.xml`
- `reports/html/`: Playwright HTML report with traces for failed tests
- `knowledge/`: application map, repair log, defect register, data-change audit

## Writing a test
```ts
import { test, expect, scenario } from '../../fixtures/test';
test('Blank value is rejected', scenario({
  cr: 'CR29641', id: 'TC-004', module: 'Constant Rules', role: 'Admin',
  expected: 'Validation message "Value is required" is shown',   // approved expected result
}), async ({ page, evidence }) => { /* ... */ await evidence.capture('validation_message', { step: '...' }); });
```
- Locators, in this order: `getByRole` → `getByLabel` → `getByPlaceholder` → `getByTestId` → `byJsfIdSuffix` → XPath (only with a reason).
- After every PrimeFaces action, call `waitForAjaxIdle(page)` or `clickAndSettle()`. Don't use `waitForTimeout` or `force: true`.
- Multi-step workflows: use `test.describe.configure({ mode: 'serial' })`. Wrap shared records in `withDataLock('record-key', ...)`.
- Runs use 3 workers and `retries: 0`. Blind retries could submit a transaction twice.
