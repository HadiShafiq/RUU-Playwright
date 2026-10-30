# Defect register

Mark each defect **Confirmed** (reproduced, evidence attached) or **Suspected** (needs QA review).

<!-- Template
## DEF-<n>: <title>  — Confirmed | Suspected
- CR / Module / Environment / Scenario:
- Severity (recommended) + justification:
- Preconditions / Test data:
- Steps to reproduce:
- Expected result:
- Actual result:
- Evidence (screenshots, trace):
- Error messages:
- Reproducibility:
- Impacted scenarios:
-->

## DEF-1: Direct LOA Submit fails, "Performance Bond Percentage" rule setting expired (ERR-770222) — Confirmed
- CR / Module / Environment / Scenario: Katalon conversion / Direct LOA (PK7) Zonal, Agreement Periodic (Schedule) Product / SIT / KAT-019
- Severity (recommended): High for SIT testing. Direct LOA with a performance bond can't be submitted; it's an environment configuration problem, not an application code bug.
- Preconditions / Test data: requisitioner account of KAT-019; Quotation/Tender Type 7, Fulfilment Type 2 (Schedule), Performance Bond 1 (Yes), Zone/Location Yes, contract 4 months, LOA price 4,800,000
- Steps to reproduce: run `npm run katalon:sit -- --grep @KAT-019` (fills Create LOA and clicks Submit)
- Expected result: "Letter of Acceptance (LOA) LA… is successfully submitted."
- Actual result: banner "Setting for Rule Type Performance Bond Percentage has expired. Please contact System Administrator. (ERR-770222)"; no LOA number. Seen 2026-10-30 15:35 (run 2026-10-30_152324). KAT-014 and KAT-017 (Performance Bond 1, non-schedule or non-zonal) submitted fine the same day.
- Evidence: test-results/SIT/2026-10-30_152324/ (screenshot test-failed-1.png, trace.zip), evidence/SIT/KATALON/KAT-019/2026-10-30_152324/
- Workaround in use: KAT-019 runs with Performance Bond 2 (No) via support/katalon/data-overrides.json until a SIT administrator renews the rule setting; remove the override afterwards.
