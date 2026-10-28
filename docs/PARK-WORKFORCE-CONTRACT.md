# Park workforce integration contract

Base: park candidate `2431ba3`, incorporating upstream main `8723b447f521a59d3939b2aeeb6a851c61cc1fb1`. Separate checkout/branch `park-workforce`; the park author's checkout is read-only.

- `parks[].staffing? = { allocations: {householdId, parkId, skill, workers}[], workDays: Record<householdWallet, workerDays> }`. Absent means no assignments/claims yet. No individual person agents are invented. Existing population consists of disjoint household skill counts.
- Export `parkEmploymentForHousehold(city, id)`, `householdWorkerCount(city, id)` (all employment exactly once), and `parkStaffingStatus(city, park)` for presentation/integration.
- Existing owner/firm allocation priority remains. Parks allocate residual real workers using the same pure allocator; all three existing skill pools may do maintenance. Neither park nor applicant requires road frontage for this job. Other jobs retain their road/utility rules.
- Level 1 has one position, 42,000 satang/month (1,400/day). Existing 1,000 satang/month maintenance contains no wages and stays separate. Earned wages reserve treasury money; monthly/removal settlement transfers to household wallets, with the existing 10% wage tax. No grants/credit are added.
- Staffing ratio is staff / slots, not a visitor capacity or service radius. Empty/unfunded parks have zero staffed capacity. No happiness/production bonus is introduced.
- The isolated candidate tests provisional v15 / chain-10; the dedicated integrator owns final numbering and must combine workforce/leisure changes under one coordinated schema. This is not an independently approved version assignment. v14 parks without staffing remain readable, without economic mutation on load. Backup original v14 bytes before first overwrite. Legacy park fields and footprint remain unchanged.
- Leisure integration: daily allocations above are the single source of park work. Leisure's activity clock must exclude those workers while on duty and derive off-duty counts from the same household pool. Do not create a second worker/person population or persist duplicate assignments. This branch owns no visitor/activity fields.

Shared-file changes: `src/sim.ts`, `src/parks.ts`, `src/labor.ts`, `src/main.ts`, `src/context-data.ts`, `src/context-panels.ts`, `src/building-card-data.ts`, `src/placement-preview.ts`, `src/inspector-data.ts`, `src/save-storage.ts`, `src/city-stats.ts`, `src/city-stats-panel.ts`, `src/city-network.ts`, `src/overview-data.ts`. Tests and this document are branch-owned. Parent coordinates integration with park/leisure authors; this branch will not merge, push or deploy.

Core author subsequently identified canonical PR 69 head `541d1b2b33e840b04ee9a25bad2952450673d92f`, parent `8723b447`. This local branch retains its original `2431ba3` ancestry; apply only its workforce diff to the canonical integration checkout, rather than merging the reconstructed local base history.

Save reconciliation guards current assignments against combined firm + owner + park skill pools, total worker-day claims against real household workforce, and wages against reserved treasury money. Duplicate per-wallet settlements, live-park mid-month settlements, and excessive paid-plus-outstanding claims are rejected. Removal settles earned wages before deleting the park.

Independent Astra review found and reproduced an early-payment/retained-claim save-validation defect. It was corrected and the exact reproduction now rejects. Reviewer reran 31 focused workforce/labor/park tests successfully, including both 360-day no-park hashes; no remaining findings in that review scope. Browser and full-suite evidence are recorded separately after execution.
