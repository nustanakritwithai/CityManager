# Park recreation satisfaction candidate

Status: isolated component for combined review, not wired into the production game.
Base: `2431ba31ca7e34474233703643936132c66e8072`, branch `park-recreation-satisfaction`.
The integration owner owns shared schema changes; this branch assigns no new City save version.

## Existing model and scope

`sim.ts` models households, disjoint worker skill pools and funded employment/owner allocations. `Household.needs` counts unmet food demand; it is not a happiness metric. There are no persistent individual agents or general happiness score in this base. Economic ticks are days. Main's accumulator and the atmosphere clock do not currently define real person minutes. Parks occupy one tile, need no road frontage, are capped at 32 and support level 1. The core already charges construction and upkeep.

This candidate therefore defines **park recreation satisfaction**, a separate nonnegative, bounded benefit from observed leisure, not whole-person happiness. It never modifies household food needs, payroll, accounts, taxes, population growth, productivity, park footprint or roads. It uses no RNG or wall clock. An old save starts with zero earned park benefit and no penalty.

## Exact leisure contract

`observeParkRecreationMinute(city, activity, options)` accepts the separately reviewed leisure state structurally:

- `day` equals `city.tick`; `minute` is integer 0–1439. Absolute minute is `day * 1440 + minute`.
- `visitors[]` contain real `citizenId`, `householdId`, `memberSlot`, `homeId`, `homeCell`, `parkId`, `parkCell` and phase `travel | enter | stroll | wait | meet | sit | leave`.
- Constituent identity is `h:<householdId>:m:<zero-based memberSlot>`. These are existing members, not extra population. Stable skill pools use `WORKER_SKILLS` order and owners/employees occupy the front of each pool.
- The activity engine owns routing, actual arrivals, duration, cancellation and physical presence. Reconcile it against demolitions, displacement, topology and workforce changes **before** sampling. The adapter rejects stale identity/home/park references.
- `stroll`, `wait`, `meet`, `sit` may earn benefit. `enter` counts toward crowding only; `travel` and `leave` count toward neither benefit nor occupancy. No home-proximity or completion-count shortcut is permitted.
- Existing funded private/owner workers cannot earn leisure benefit during [480,1020). The integration owner must also pass current municipal/other committed-work identities in `unavailableCitizenIds`; this unions reservations without releasing existing ones.
- `parkPolicy` optionally maps actual park IDs to explicit `qualityPermille` (0–1000) and `comfortableCapacity`. Rendering quality is never used as service quality. Current provisional defaults are 1000 quality and 3 comfortable occupants; leisure separately limits reservations to 6.

One frame describes **the actual interval before the activity step**, with `frame.minute` equal to its end. Integration order for each minute:

1. Reconcile real activity state as required; obtain frame from the pre-step state.
2. Calculate `nextRecreation = advanceParkRecreation(recreation, frame)` without mutating anything.
3. Advance actual activity exactly one minute. Commit `recreation = nextRecreation` only if it succeeds.
4. At minute 1440, run exactly one existing economic step then reset the leisure day. Absolute recreation time remains continuous.

Speed batching loops this sequence for each actual minute. Pause performs no transition. Do not sample once after a large activity batch: that would fabricate history and miss completed visits. Repeated frame timestamps have no effect; gaps and backwards time reject. Overlapping or conflicting citizen observations reject the whole frame; exact duplicates do not stack. Crowding uses unique actual people, including ineligible people physically present.

## Proposed tuning for owner review

Fixed-point score: 1000 units = 1 point. Maximum 100 points. Default full-quality gain 0.25 points per eligible minute, maximum gross gain 15 points per game day. Decay is 5 points per 1440 game minutes, with saved integer remainder. Quality and crowding each multiply gain by factors no greater than 1. Proposed crowding factor is `min(1, comfortableCapacity / actualOccupants)`. Gains round down in fixed-point units. Decay floors at zero, never creates need/debt and never blocks a city from functioning without parks. Daily cap day belongs to the observed interval `[frame.minute - 1, frame.minute)`.

`createParkRecreation` accepts tuning and stores it in the separate version-1 sidecar. Changes to tuning require explicit migration/review; do not silently replace saved settings. Last-positive-gain diagnostics preserve actual park, quality and crowding provenance. No-visit citizens need no stored record. Current roster removal prunes records rather than leaving unbounded departed citizens.

## Persistence and UI

Serialize/restore the complete recreation sidecar alongside the corresponding City and activity state in one candidate envelope. Restore with the expected absolute activity minute and reject mismatches. Do not reset recreation while retaining visit history, or retain recreation while resetting the activity clock. Missing legacy sidecar initializes at the current game minute with no historical award.

`renderParkRecreationPanel` is a read-only Thai UI contribution with city mean, positive-benefit count, proposed rules and a per-resident provenance table. The mean denominator includes all current residents; it is never called whole-person happiness. It is deliberately not mounted into production `main.ts` until combined integration review.

Further gameplay coupling is deferred: any effects on migration, work, income, tax or needs require a separate owner decision with conservation and baseline tests. No automatic coupling is proposed in this change.

## Verification

Focused reducer and adapter tests cover observed intervals, idempotency, cap/decay, crowding, duplicates/conflicts, state validation, save/replay, work reservations, missing/stale references and no-visit baseline. An optional integration evidence runner consumes the leisure worker's real module without copying or editing it. See the final handoff for exact executed commands, source hashes, results and remaining integration gates.

Executed component evidence:

- `node --experimental-strip-types --test tests/park-recreation.test.ts tests/park-recreation-activity.test.ts tests/park-recreation-panel.test.ts`: **25/25 PASS**.
- `node --experimental-strip-types --test tests/parks.test.ts tests/population.test.ts`: **20/20 PASS**, including 360-day no-park baseline hashes and old-save migration.
- `npm run build`: **PASS** (TypeScript and Vite). Existing large production chunk warning remains; this component is not imported into production main.
- `node --experimental-strip-types scripts/verify-park-recreation.mjs C:\Users\Administrator\Documents\Codex\2026-10-29\task-4\citymanager-park-activity`: **PASS**. The source file was read-only and hashed both before and after. Leisure SHA-256: `10efd44b0159ff590a3b2d309740e6bcd84dfd1a6b7256d91a23074c8236fe77`. This is an exact-source integration check, not a claim about a later leisure commit.
- Real replay: seed 61025, days 180–182, 2880 game minutes, 1072 eligible person-minutes, 34 completed returns, max occupancy 6. All 17 residents had remaining benefit; average 6.5518235294/100 after two days with the proposed settings. This is a fixture outcome, not a balance target. No-park replay created no benefit records.
- Speed batches 1 and 37 agree; save/reload at elapsed minute 1087 agrees with uninterrupted execution. Pause changes nothing. Activity and scoring leave city saves byte-identical to the reference economic engine.
- The served review HTML and evidence JSON returned HTTP 200. **Visual browser QA NOT RUN**: in-app browser creation and subsequent surface inventory both timed out. No screenshot or visual pass is claimed.

To inspect locally, run `npm run dev -- --port 5189 --strictPort` and open `http://127.0.0.1:5189/CityManager/park-recreation-review.html`. The page uses the committed real-run evidence at `public/park-recreation-review.json`; it is explicitly a recorded review, not a live gameplay integration. Re-run the evidence command after adapting a later leisure contract.

Integration gates: the integrator must connect one atomic City/activity/recreation save envelope, feed municipal work reservations, retain the minute-by-minute observer inside speed batching, and complete browser QA. No merge, push or deployment was performed by this component worker. Managed worktree creation was unavailable for this task type, so all edits are in an independent local clone/branch; the park-core checkout was not edited.

Workforce handoff received: candidate `e8d6f9e1a6dc27092f85fdac803ac874c9fba857` supplies pooled `parks[].staffing.allocations` rows `{ householdId, parkId, skill, workers }`, after existing firm/owner labor. It does not itself establish individual citizen identities. The integrator must extend the leisure component's canonical member-slot resolver to assign those remaining workers without overlap, and use that same resolver for activity scheduling and `unavailableCitizenIds`. This scorer does not invent a parallel assignment. The workforce candidate's provisional v15/chain-10 is not adopted here; the integrator decides the combined schema version.
