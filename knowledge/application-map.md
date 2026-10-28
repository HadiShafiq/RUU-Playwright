# ePerolehan application map (knowledge base)

Every entry has a status. **Verified** = confirmed by a Playwright run (give the run ID and environment).
**From Katalon (unverified)** = taken from the Katalon project and not yet confirmed by Playwright.

## Environments
| Env | Base URL | SSO host | Status |
|---|---|---|---|
| SIT | http://ngepsit.eperolehan.com.my/home | ngepsso.eperolehan.com.my (OAM) | **Verified** SIT run 2026-10-28_153219 (HTTP 200, title "UTAMA - ePerolehan") |
| UAT | http://ngepuat.eperolehan.com.my/home | ngepsso.eperolehan.com.my (OAM) | From Katalon (unverified) |

## Authentication
- Login: top-right "Login" menu → username/password → submit (Katalon objects `Direct LOA/1. Direct LOA Requistioner/Login/*`). From Katalon (unverified)
- Logout: `http://ngepsso.eperolehan.com.my/oam/server/logout`. From Katalon (unverified)
- Katalon reads credentials from Excel files outside the repo. Playwright doesn't store them anywhere: you log in by hand once (`npm run auth:sit`) and the session is saved to `.auth/` (git-ignored).

## UI technology notes
- Liferay portal with JSF/PrimeFaces portlets. Element IDs carry a portlet prefix, e.g. `_Catalogue_WAR_NGePportlet_:form:procurementType`. Match on the trailing segment (`byJsfIdSuffix`). From Katalon (unverified)
- AJAX overlays: `.ui-blockui`, `.blockUI`, `.ui-widget-overlay`. Wait with `waitForAjaxIdle`. From Katalon (unverified)

## Navigation paths
| Path | Behaviour | Status |
|---|---|---|
| `/home` | Public portal. Title "UTAMA - ePerolehan" | **Verified** SIT 2026-10-28_153219 |
| `/web/epapp/dashboard` | Protected. Without a session it redirects to `/ssologin` on the same host (title "SSOLOGIN - ePerolehan"), not to ngepsso | **Verified** SIT 2026-10-28_153219 |
| "Log Masuk Ke ePerolehan" (Pautan Segera) | Links to `/web/epapp/dashboard` | **Verified** SIT 2026-10-28 |

## Stable locators
| Screen | Element | Locator | Status |
|---|---|---|---|
| Home | Main menu | `getByRole('banner').getByRole('navigation').getByRole('menuitem', { name: 'UTAMA' | 'MENGENAI eP' | 'PENGGUNA eP', exact: true })` | **Verified** SIT 2026-10-28_153219 |
| Home | Top-right login | `getByRole('menuitem', { name: 'Log Masuk' })` | **Verified** SIT 2026-10-28_153219 |
| Home | Quick links heading | `getByRole('heading', { name: 'Pautan Segera' })` | **Verified** SIT 2026-10-28_153219 |
| SSO login | User ID | `getByRole('textbox', { name: /ID Log Masuk/ })` | **Verified** SIT 2026-10-28_153219 |
| SSO login | Password | `getByRole('textbox', { name: /Kata Laluan/ })` | **Verified** SIT 2026-10-28_153219 |
| SSO login | Submit | `getByRole('button', { name: 'Log Masuk' })` | **Verified** SIT 2026-10-28_153219 |

## Update MOF Profile Application (verified SIT 2026-10-28, run 155029, account role Supplier Administrator (MOF))
- Dashboard Quick Link `getByRole('link', { name: /^Update MOF Profile Application/ })` (name ends in "icon" from the Ai badge) → `/web/epapp/apply-mof-profile-update`
- Terms page: tick `row "I Accept the Terms…" .ui-chkbox-box` → `button "Proceed"` (disabled until ticked). Proceed does not save. Drafts start their 60-day clock only when saved.
- **ERR-722542** on Proceed means a pending application already exists. Open it via Task List → My Task → link "Update MOF draft application (…)" → `/web/epapp/mof-application`
- Left menu: `getByRole('tab', { name: /^<section>/ })` with `aria-expanded="true"` when active. Click target: `a.ui-commandlink` filtered by text. Sections: Company Basic Information, Assoc Company / Projects, Personnel / Branch Info, Capital / Equity Status, Bank Information, Register Category Code(s), Supporting Documents, Declaration
- Leaving a section runs validation. **ERR-722661** (overlap category, needs justification + document) blocks leaving Register Category Code(s). **ERR-722537** (BORANG PENGISYTIHARAN MOF missing) blocks leaving Supporting Documents. Reloading the draft lets you open any section directly.
- Personnel / Branch Info shows **ERR-722683** (personnel and capital can't be edited within 6 months of New Application registration; this account was registered 01-Oct-2026). The Company Branches grid still allows row selection, and its Add/Delete buttons are enabled.
- Company Branches grid: `.ui-datatable` with columnheader "Branch Name". The state is the first line of cell 2. Rows have a `.ui-chkbox-box` checkbox and `aria-selected`. Paginated 5 per page. Row selection survives paging.
- Test data (supplier test account OWNER 16, eP-1400O0039): draft KU-28102026-0020. It had 16 branches; **since 2026-10-28 17:18 only SELANGOR remains** (see data-change-audit.md).
- **Branch Delete commits immediately.** `[id$="tt:delBranchBtnId"]` (below the branches grid) → dialog "…disqualified from … Quotation/Tender that involves locality… Are you sure to proceed with branch deletion?" → `[id$="pendingQTPopUpId:yesWithResetId"]` deletes on the server with no Save needed. "Modified By" does NOT change. Treat it as destructive.
- **Two Delete buttons:** the top one `[id$="tt:j_idt2820"]` (`mofApplDelConfirm.show()`) deletes the WHOLE application. Never use it in branch flows.
- SIT occasionally leaves a PrimeFaces AJAX request unanswered (queue stuck, run 171538). Recover with a full reload via Task List; retrying on the same page keeps waiting behind the stuck request.

## Known environment behaviour
- SIT /home normally loads in about 4s. Under 3 concurrent workers one navigation took 37s (run 2026-10-28_153031). Keep `navigationTimeout` at 60s.
- The UI is in Bahasa Melayu by default (language selector "Bahasa Melayu"). Locators use the Malay labels. Katalon's Object Repository (`CDC-Katalon-Automation/Object Repository`) is a reference only. Re-check each locator in Playwright before using it.

## Preparing an application for Declare (verified SIT 2026-10-28 on KU-28102026-0028)
- Saving a new application (top Save) creates the draft: "Please click HERE or navigate to Task List … KU-…". Continue it from Task List → My Task.
- Register Category Code(s) overlap justification: `textarea[id*="overlapCatSuppDocDtId:0:overlapCaReasonId"]`. Upload icon `a[id*="overlapCatSuppDocDtId:0:"]` with `img[src*="upload.png"]` → dialog with `input[type=file]` → `td.start button` → title-bar X. Document description: "Surat Rayuan Pertindihan Bidang". The upload and justification persist. Save still showed the ERR-722661 banner once, but a fresh reload showed the data saved and the error gone.
- Supporting Documents mandatory rows: `tbody[id*="mandatoryTableId_data"] > tr[data-ri=i]`, with the same upload dialog pattern. For this Organization (Others) account there are 3: BORANG PENGISYTIHARAN MOF; UNDANG-UNDANG TUBUH / PERLEMBAGAAN PERTUBUHAN; MINIT MESYUARAT AGUNG TAHUNAN PERTUBUHAN TERKINI. Save → "Update MOF Profile : KU-… has been successfully saved".
- Declaration page: a list of notes (processing fee is required before processing; registration fee before the certificate is issued) and a **Declare** button. Declare submits the application; it was never clicked by automation.
- Test upload file: `CDC-Katalon-Automation/TestData/UploadFiles/File_pdf_for_testing.pdf` (1-page PDF). In bash heredocs, write Windows paths with forward slashes, because backslashes get stripped.
