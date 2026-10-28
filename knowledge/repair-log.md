# Automation repair log

One entry per failure investigated. Never change an expected result just to make a test pass.

| Date | Env | Scenario | Run ID | Failure classification | Root cause | Change made | Attempt | Rerun result |
|---|---|---|---|---|---|---|---|---|
| 2026-10-28 | SIT | MOF-001 | 154741 | Automation (framework) | Manual `tracing.start()` clashed with config `trace: retain-on-failure`, which already instruments CDP-attached contexts | Removed manual tracing from `fixtures/attached.ts` | 1 | Next failure (below) |
| 2026-10-28 | SIT | MOF-001 | 154808 | Automation locator | Quick link name is "Update MOF Profile Application**icon**" (img alt="icon" with no space), so `exact: true` missed it | Changed to `/^Update MOF Profile Application\b/` (wrong: `\b` can't match inside "Applicationicon") | 2 | FAIL, same error |
| 2026-10-28 | SIT | MOF-001 | 154915 | Automation locator | Confirmed from live outerHTML (step 12-link) | Changed to prefix regex `/^Update MOF Profile Application/` | 3 | PASS (run 155029) |
| 2026-10-28 | SIT | MOF-001 | 165640 | Automation (timing) | Test timeout of 120s was shorter than the 180s manual-login wait | `test.setTimeout(loginWait + 120s)` in MOF-001 | 1 | Run stopped by user before the result |
| 2026-10-28 | SIT | MOF-001 | 170027 | Automation locator | A fresh browser profile shows the SSO page in English ("Login ID", "Password", "Login"); locators only matched Malay | Locators accept both languages | 1 | PASS (run 170130) |
| 2026-10-28 | SIT | MOF-007/008 | 155029 | Application validation (not a defect) | Leaving Register Category Code(s) raises ERR-722661 and leaving Supporting Documents raises ERR-722537 | Built-in recovery: reload the draft from Task List and open the section directly | 1 | PASS |
