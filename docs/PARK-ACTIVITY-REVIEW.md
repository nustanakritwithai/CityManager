# Park recreation candidate handoff

Checkout: `C:\Users\Administrator\Documents\Codex\2026-10-29\task-4\citymanager-park-activity`.
Branch: `park-citizen-activity`. Base: `2431ba31ca7e34474233703643936132c66e8072`.
The core author subsequently identified canonical PR 69 head
`541d1b2b33e840b04ee9a25bad2952450673d92f`; apply this candidate's new-file diff to
the integrator checkout, rather than merging reconstructed base history.

All candidate source files are new. Existing City/Park schema, economic daily
step, save v14/chain-9, production entry point, asset pipeline and park author
checkout are untouched. No merge, push or deployment was performed.

## Concrete first slice

- `src/park-activity.ts`: pure deterministic sidecar over existing household
  constituents, real labor reservations, bounded pedestrian trips, actual temporary
  paired encounters, two physical seats, departure headway, removal reconciliation,
  explicit game-minute clock, and validated persistence.
- `src/scene-park-activity.ts`: read-only PlayCanvas projection. Quality caps are
  12/24/48 rendered people; simulation caps remain six reservations per park and
  64 citywide. Waiting-at-home reservations are counted but not drawn. Poses follow
  simulated phases, positions and partners. No decorative people are added.
- `park-activity-preview.html`, `src/park-activity-preview.ts`,
  `vite.park-activity.config.ts`: separate playable review entry using an actual
  city grown through 180 existing economic steps, then a treasury-funded one-tile
  park with no adjacent road. It saves the existing city JSON and activity JSON
  together under a candidate-only browser key. Decorative traffic is disabled.
- `tests/park-activity.test.ts` and `tests/park-activity-browser.mjs`: model and real
  browser verification. Full API/state policy is in `park-activity-contract.md`.

## Shared workforce and save boundary

The workforce contract at `e8d6f9e1a6dc27092f85fdac803ac874c9fba857` was read. Its
`parks[].staffing.allocations` contain `{householdId, parkId, skill, workers}` and
`parkEmploymentForHousehold(city,id)` exposes those allocations. They are pooled
worker counts, not already assigned individual citizen identities.

`parkActivityCitizens` now provides **one** constituent mapping: owner and firm
jobs reserve each household's skill slots first, then actual park allocations
append in park-ID order to remaining slots of that skill. A read-only structural
bridge reads the optional reviewed staffing shape without editing the core park
type or copying the workforce allocator. `firmId` and `parkJobId` distinguish
destinations. Every assigned slot is unavailable during the chosen shift. No
second population, job allocation, salary payment or work-day accrual is created.
The new regression verifies all four distinct owner/firm/municipal skill slots,
immediate cancellation when a visitor becomes an on-duty park worker, after-work
admission and exact sidecar replay without changing staffing or money.

The integrator owns the canonical combined save version and game clock. Activity
uses an unpublished version-1 sidecar; it claims no production version. Current
production advances one economic day per accumulator unit, while its atmosphere
clock is decorative. Choose and review the real-time pacing, advance integer
activity minutes, and call the existing economic step exactly once per 1440
minutes. Persist the fractional-minute remainder with the same city snapshot.
Reconcile topology/population/job edits even while paused.

**Actual visit evidence:** `visited` is a daily admission/reservation deduplication
list. It is not proof of arrival or a happiness trigger. Actual arrival is the
`travel` -> `enter` transition, and actual meeting requires reciprocal participant
IDs. No happiness, coverage or economic bonus is implemented. A future benefit
must consume an idempotent saved arrival/benefit record; do not award on mesh
creation, render refresh, reservation, load, or daily reset.

For the happiness candidate's `observeParkRecreationMinute(city, activity, options)`,
the clock adapter is `parkActivityAbsoluteMinute(state)` (checked safe integer;
process minute 1440 as the next day's minute 0 only once). Citizen
IDs are exactly `h:<householdId>:m:<zero-based memberSlot>`. Produce
`unavailableCitizenIds` with `parkActivityUnavailableCitizenIds(city,state.minute)`;
it includes municipal allocations during 08:00-17:00. Only emit actual
arrived/inside/leaving observations from simulation,
not scheduled-at-home reservations or renderer LOD. This adapter is an integration
requirement, not implemented production wiring in this component.

## Validation and remaining review

- Astra's focused run: **13/13 tests passed**. Tests include canonical
  180-day city save roundtrip, zero economy mutation, arbitrary minute batching,
  pause, save/replay, work exclusion, capacities, mutual meetings, two seats,
  blockers/removal, validation, departure headway and navigation budgets.
- Final TypeScript check passed, including the preview embedding fix. Final local
  pre-workforce-adapter rerun passed all 13 model tests in 2.73 seconds; the stress search portion
  observed 174.8 ms on that less-contended run. Logs: `.test-output/park-activity/unit-tests.txt`.
- Final adapter revision: **15/15 tests passed in 1.67 seconds**, including the two
  municipal skill-slot and absolute-minute regressions; final TypeScript passed.
- Candidate production build passed, including the preview embedding fix. Vite
  reports the inherited engine bundle at about 1.51 MB / 394 KB gzip; physical
  mobile frame-time and loading measurements are not established.
- Navigation stress measurement: 128 homes, 512 constituents, 32 unreachable
  parks; 4,096 searches across 16 admissions, observed 679.9 ms total. The budget
  is at most 256 BFS calls per admission, each bounded by 576 cells. This is a
  desktop model measurement, not a mobile frame-time guarantee.
- Edge/WebGL rendered actual citizens and a park. The first interactive run
  exposed the production renderer's window-sized canvas covering the embedded
  controls; the isolated preview now resizes to its container. That correction
  built successfully. The final browser run timed out at `Runtime.evaluate`
  around an executor transport disconnection. **Final UI save/load, all-phase
  render assertions and mobile screenshot pass are not established.**
- The broad existing suite was stopped amid severe execution contention; it is
  **not a pass**. No old production files were changed. Run combined regression
  after integration with bounded test concurrency.

Browser test artifacts and logs are under `.test-output/park-activity/`. The
`failure.png` screenshot is from the earlier layout-defect run and is only
evidence of rendered people, not the corrected layout or a passing final build.

## Run locally

From this checkout (dependencies are already copied locally):

```powershell
node --experimental-strip-types --test tests/park-activity.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build --config vite.park-activity.config.ts
node node_modules/vite/bin/vite.js preview --config vite.park-activity.config.ts --host 127.0.0.1 --port 4185
```

Open `http://127.0.0.1:4185/CityManager/park-activity-preview.html`.
To test the built preview in a separate terminal:

```powershell
$env:CITYMANAGER_URL='http://127.0.0.1:4185/CityManager/park-activity-preview.html'
node tests/park-activity-browser.mjs
```

The model is a small prototype: no full collision avoidance, road-crossing safety,
individual ages/guardians, friendships, commuter trips, or repair of obstructed
routes. Canonical terrain has no water inside the build grid; outside decorative
sea is never traversed. A future water map must become an explicit routing blocker.
