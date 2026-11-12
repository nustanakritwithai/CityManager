# Recreation above 2,048 residents

## Change

The recreation scorer had its own fixed 2,048-resident limit. With any park present, the first observed minute rejected a larger city even if nobody was visiting a park. Its saved-score and visit-array limits inherited the same unrelated number.

The scorer now validates every resident, park, visit and saved record without a separate population ceiling. Exact duplicates still collapse, conflicting visits reject atomically, absent residents are pruned, and every retained record continues to decay. Never-visited people remain implicit zero: only previous records and current visitors need sorting and scoring. Comfortable capacity remains a nonnegative safe integer, with overflow-safe crowding arithmetic. Production comfort stays at three people.

This changes no immigration rules, housing capacities, money, staffing, jobs, save version, park reservation capacity or route budget. The current structural maximum remains 192 building parcels × 32 households = 6,144 households; the largest supported household composition has three people. This is a structural bound, not a promise that all those households can be housed, supplied and employed together. Existing land, utilities, employment and affordability requirements still govern real growth.

## Saving and performance

Canonical city sessions keep the existing v27/chain-22 envelope, recreation version 1, 12,000,000-character processing limit and 8 MiB server byte limit. No stored scores or economic history are dropped to fit. The standalone recreation JSON helper retains its old 2,000,000-character parsing guard; canonical city sessions restore the already-parsed recreation object and do not use that standalone string limit. A 9,000-person canonical session with every score present is tested beyond two million recreation characters and below the existing server limit.

Whole-roster validation remains linear in population. Sparse processing avoids sorting every never-visited resident, but large towns still cost more CPU and memory. Existing frame pacing can slow simulated time instead of skipping observations. The change does not promise unlimited population, save duration, 10× playback or mobile frame rates.

Run `node --experimental-strip-types scripts/park-population-benchmark.mjs` for diagnostic real-runtime CPU measurements. The fixtures explicitly provide outside capital and utilities; they do not demonstrate natural growth. One Linux/Node 24 measurement, while other tests were running, measured median CPU time per observed game minute of 1.60 ms / 4.29 ms / 10.76 ms for 2,049 / 4,098 / 9,000 residents. These are CPU diagnostics, not browser frame rates or physical Android results.

## Verification

- Boundary regression: real validated 2,049- and 4,098-person cities with a park advance and round-trip.
- Real 4,098-person park visits, staffed benefit, fractional pause, daily economic step and interrupted reload produce the same complete state as uninterrupted execution.
- 18,432 scoring records remain complete; malformed tail records and unknown/conflicting visits still reject.
- More than 8,192 duplicate visit observations deduplicate without extra credit.
- A 9,000-person canonical save retains all scores and resumes after reload, without exceeding the existing server limit.
- `npm test` and `npm run build` cover regression and production typing/bundling.
- The dedicated `Large population acceptance` workflow runs the compiled app in Chrome with a synthetic isolated server. It checks native minute progression, benefit, pause, exact server Save/ACK/reload, a 412×915 screenshot, no external requests and no JavaScript errors. Its uploaded evidence must pass review before release. Emulated mobile is not a physical-device test.
