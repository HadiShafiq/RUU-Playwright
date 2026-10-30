# ePerolehan — Playwright automation

Standalone Playwright project. It reads the Katalon project (`C:\Users\hadishafiq\CDC-Katalon-Automation`, or `KATALON_DIR`) only to build the coverage matrix, and never changes it.

## One-time setup
```
npm install
npm run auth:sit        # a browser opens: log in by hand, then press Resume in the Inspector
```
The session is saved to `.auth/sit.json` (git-ignored). If it expires, tests fail with "Redirected to SSO". When that happens, run the auth step again.

For automatic login, fill in the yellow Username and Password cells of `.auth/credentials.xlsx` (git-ignored; sheet "Credentials", one row per environment). Tests that use `LoginPage` (such as `npm run mof:sit`) then log in by themselves with the row matching `TEST_ENV`. `E2E_USERNAME` / `E2E_PASSWORD` in the shell or in `.env` (see `.env.example`) override the workbook. With neither, tests wait up to 3 minutes for you to log in by hand.

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

## Katalon test cases (tests/katalon)
All 64 Katalon test cases are converted into `tests/katalon/<Katalon test case path>.spec.ts`, tagged `@KAT-0xx` (as in the coverage matrix) and `@katalon`. The 65th, Update MOF Profile, is the hand-written `tests/mof/update-mof-profile.spec.ts`. Each spec is its Katalon script translated line by line: same steps, same Object Repository XPaths, same delays and data columns. They run on `support/katalon/runtime.ts`, a layer that does what Katalon's `WebUI`, `findTestObject` and `TestObject` do, but with Playwright. **None of them has been run yet.** Nearly all of them change data on SIT/UAT.

| Command | What it does |
|---|---|
| `npm run katalon:convert` | Regenerate the specs, `support/katalon/*` and the matrix from the Katalon project (read-only) |
| `npm run katalon:sit -- --grep @KAT-010` | Run one converted test case on SIT (one worker) |

- **Fix the converter, not the specs.** The specs are generated, so fixes go in `scripts/katalon/convert.mjs` or the runtime.
- **Variables:** the defaults come from the `.tc` files. Username, Password and IC values go to `.auth/katalon-variables.json` (git-ignored, written by `katalon:convert`). If a Katalon suite binds a data file, the spec reads row `DATA_ROW` (default 1) of that Excel file. It looks for the file by name under `KATALON_DATA_DIR` (default `Desktop\Data Prep Excel AP 201`). `KAT_<Variable>=value` overrides any variable, for example `KAT_Document_Number=LA26…`.
- **Files:** Katalon's `user.dir` is `fixtures/katalon` (holds `TestData/UploadFiles`). Its `user.home` is `reports/katalon-home`, so result workbooks (`Desktop/PrepDataFileNumber/*.xlsx`) are written there. Set `KATALON_HOME` to write them somewhere else.
- **Katalon bugs:** `knowledge/katalon-script-defects.md` lists the places where a Katalon script uses a name it never defines. Katalon stops at those lines, and so do these specs.

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
