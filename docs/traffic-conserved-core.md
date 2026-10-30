# Conserved traffic core: PR6 first review slice

The engine retains unresolved offered traffic through overload, blocked frontages,
road cuts, day changes, and bounded catch-up. Finite receiving storage spills queues
upstream. Right-hand junction movements share geometric conflict resources;
compatible opposite straight movements can run concurrently. Shared exits still have
one receiving budget, and widening an approach does not widen the junction.

This slice is explicitly opt-in with `new TrafficClock({ enabled: true,
conservedFlow: true })`. The released representative renderer does not opt in. No
player-save schema, storage, server, economy, Guest policy or runtime UI is changed.

## Source and attribution

The conserved flow, stable parcel-zone snapshot/network and initial clock codec were
imported from the reviewed source checkpoint `f7694428bd2548dcfc59ae54a824b4210af71e9b`
(tree `03fa801c07ea8da102f0677f090bb25bcc70f0e9`), preserving its author in commit
`bdd40f22bf4e73aa9dc07b0d1f2c2d2c3946caf3`. The parent checkpoint is based on the
representative fleet and save fixes now in main `4e23a6b`.

This integration adds movement conflict resources, independent-entrance admission,
strict atomic restore checks at both conservation boundaries, retained catch-up
cursor state, and isolation from the existing representative-only clock lifecycle.
It does not modify the frozen checkpoint branch or PR84/104.

## Units and measured consequences

Demand uses the existing ten-person representative trip convention. The provisional
road budget is 30 representative units per lane per game hour, four units of storage
per directed lane, and 30 units per conflict quadrant per hour. These are prototype
budgets for review/playtesting; the former twelve-unit whole-junction budget was not
adopted as a settled policy.

The synthetic two-day fixed-topology fixture gives:

| Population | Offered | Completed by end | Peak queue |
| --- | ---: | ---: | ---: |
| 200 | 67 | 67 | 0 |
| 500 | 169 | 169 | 0 |
| 1000 | 339 | 339 | 1 |
| 2000 | 679 | 679 | 45 |

Those fixtures clear overnight. Sustained six-hour demand of 360 units gives 178.5
completed on the baseline network and 178.5 with another approach sharing the same
bottleneck. An independent bypass gives 355 completed and zero origin waiting
(five units are still on roads). With a six-unit/hour downstream link, widening the
approach leaves four-hour completion unchanged and at most 24; the approach stores
more queued traffic. These are deterministic numerical scenarios, not live city car
counts or evidence that the game is fun.

## Verification and remaining work

Focused tests cover exact continued flow restore, malformed/duplicated sidecars,
invented admissions, impossible path geometry, road-cut recovery, stable disconnected
parcel offers, population scaling, compatible/conflicting movements, shared exits,
spillback, bypass decisions, render-sample independence and eight-day catch-up.
Existing traffic and synthetic save regressions plus TypeScript/Vite build are the
integration checks. Exact run receipts are recorded by the implementing task.

2026-10-30 Windows verification: 82 traffic tests passed (18 conserved-core tests
among them), 63 save/autosave/park-runtime tests passed, and TypeScript plus Vite
production build passed. Vite reported its existing large-chunk warning. The first
traffic regression run failed one restore fixture that omitted `conservedFlow: true`;
the corrected fixture and activation-isolation test passed in the final run.

Remaining before runtime activation:

- Capture demand at actual economic-day boundaries instead of sampling today's city
  for historical catch-up. Preserve one game day per real second at 1x.
- Bind the codec atomically to accepted city/revision/generation and existing save
  recovery/CAS flows. This pure codec alone is **not** production save/reload support.
- Connect conserved density/queues to rendering and replace visual completion as an
  authority. The released representative fleet still has its existing visual policy.
- Add stable offer/move identities before modal integration; see
  [the taxi/rail proposal](traffic-modal-adapter-proposal.md).
- PR7: lane-expansion editing and persistent width data with legacy Guest preservation.
- PR8: road congestion colors and a bottleneck panel exposing measured flow/queues.
- Mobile portrait/landscape playtests, repeated/cancel/drag interactions and gameplay
  tuning. No browser or fun/readiness claim is made for this pure-engine slice.

Travel resolution remains one directed edge per simulated minute. The core is not
an exact 40 km/h motion simulation. Render-group cloning prevents sampling mutations
from changing traffic, but production frame-cost measurements are still required.
