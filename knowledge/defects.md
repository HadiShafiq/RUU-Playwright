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

## DEF-2: iGFMAS verification does not complete; no Purchase Order / Contract Order is created — Suspected
- CR / Module / Environment / Scenario: Katalon conversion / Fulfillment / SIT / KAT-047 → KAT-048, KAT-058 → KAT-059
- Severity (recommended): High for SIT testing. It blocks every fulfillment step after PR/CR approval (17 converted test cases: KAT-048..056, KAT-059..064). Probably an SIT integration (iGFMAS) problem, not an application defect.
- Preconditions / Test data: CR260000000005449 (approved 2026-10-30 17:51, "sent to iGFMAS for verification"); PR260000000004657 (approved 2026-11-02 10:56, same message)
- Steps to reproduce: approve a Contract Request or Purchase Request (KAT-058 / KAT-047), then check Task Status Search for the document after some time
- Expected result: iGFMAS verifies; a Contract Order (CO…) / Purchase Order (PO…) is created and the supplier gets an acknowledgement task
- Actual result: on 2026-11-02 ~11:20, Task Status Search still shows only "Initiate CR / Review CR — COMPLETED" (CR, 3 days later) and "Review PR — COMPLETED" (PR); no CO/PO, nothing in the supplier's My Task
- Rechecked 2026-11-02 13:35: PR260000000004657, PR260000000004659 and CR260000000005449 unchanged (only the completed Review/Initiate tasks; no CO/PO)
- Needs: SIT team to confirm iGFMAS verification is running in SIT (or process these two documents)
- Resolved 2026-11-02 15:30: the orders existed (PO260000000006601, PO260000000006602, CO260000000005848), found by the user with a DBeaver query on NGEP_SIT.FL_FULFILMENT_REQUEST / FL_FULFILMENT_ORDER. Only a delay; not a defect.

## DEF-3: MOFCTOO16 company equity data blocks leaving Capital / Equity Status (ERR-722554), and it cannot be corrected (ERR-722683) — Confirmed (SIT data)
- CR / Module / Environment / Scenario: MOF-PROFILE / Supplier Management, Update MOF Profile / SIT / MOF-006 (KAT-065)
- Severity (recommended): Medium for SIT testing. The account's data is inconsistent; the application blocks correctly. Not an application code defect.
- Preconditions / Test data: MOFCTOO16 (MOF No. 357-0002294051), draft KU-02112026-0021
- Steps to reproduce: open the Update MOF Profile draft → Capital / Equity Status → click Bank Information in the left menu
- Expected result: Bank Information opens
- Actual result: "Total or sum of the Capital / Equity Status must be equal to the total value in Capital / Equity Shareholders (Individual) (ERR-722554)". Capital / Equity Status has RM600,000 Bumiputera (100%); Capital / Equity Shareholders (Individual) has no records (the page asks for at least two). Add is disabled and the section shows "Can't edit the personnel and capital information within 6 month after the registration of New Application (ERR-722683)". Seen 2026-11-02 16:56.
- Evidence: test-results/SIT/2026-11-02_165610/ (test-failed-1.png)
- Workaround in use: MOF-006 is marked skipped with this message when ERR-722554 is shown; Register Category, Supporting Documents and Declaration are opened directly from the left menu.
- Needs: SIT team to add the individual shareholders (total RM600,000) for this company, or another MOF supplier account with consistent equity data registered over 6 months ago.
