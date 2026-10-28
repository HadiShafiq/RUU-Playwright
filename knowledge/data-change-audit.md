# Approved data-changing actions (audit log)

| Date | Env | Approved by | Scenario | Record / data touched | Action | Cleanup plan | Cleanup done |
|---|---|---|---|---|---|---|---|
| 2026-10-28 17:18 | SIT | User ("Delete, don't Save") | Update MOF Profile, Personnel / Branch Info | Draft KU-28102026-0020 (supplier test account OWNER 16, eP-1400O0039): 15 company branches deleted (JOHOR, KELANTAN, PERLIS, LABUAN, PULAU PINANG, SABAH, PAHANG, KEDAH, PUTRAJAYA, PERAK, KUALA LUMPUR, MELAKA, TERENGGANU, SARAWAK, NEGERI SEMBILAN). SELANGOR kept. | Branch Delete (`delBranchBtnId`) → dialog "Yes". Save NOT clicked, **but the deletion persisted anyway** (verified by a fresh load in a new tab) | Re-add each branch by hand from `evidence/SIT/MOF-PROFILE/BRANCH-BACKUP/branches-before-delete.json`; or delete draft and recreate (needs approval) | No |
