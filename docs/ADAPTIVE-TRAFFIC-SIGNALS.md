# Adaptive road-game signals and local communication

The ephemeral `TrafficGame` worker selects one inbound approach per three/four-arm junction from **actual on-road queues**, not source-demand estimates or a fixed cycle. Two-arm bends retain their existing physical arbitration.

## Admission and safety

- Only feasible lane heads contribute local service pressure; their real followers count, but a blocked adjacent lane does not inflate serviceable demand. Telemetry separately reports **all** actual queues, including blocked ones.
- Larger feasible queues receive priority, with increasing weight for waiting time. At 12 seconds an eligible old request outranks younger queue pressure. This is **not** a maximum-wait promise when exits or physical corridors remain blocked.
- Green holds at least 2 seconds with competing feasible demand and requests a switch at 8 seconds. Empty/blocked approaches can gap out sooner; an incumbent must physically clear before switching. Without competing demand a phase may remain green.
- A switch passes through 0.4 seconds of all-red. An occupied corridor retains its exclusive grant. After topology changes an unknown phase waits for the incumbent and a fresh clearance interval.
- There is still only one worker grant per junction, including turns. A physically cleared grant can be reused within the worker second instead of wasting its remainder.
- `presentation.ts` remains the final rendered bus/car arbiter, including bus drain epochs and swept-body protection. Green is permission to request movement, never a bypass of downstream capacity or physical reservations.

## Neighbor state, RRT and cached replies

A topology-cached corridor follows directed road links to the next controlled junction, stops at branches and is bounded to eight road tiles. Every immediate downstream controlled neighbor is guaranteed. A seeded bounded RRT chooses up to four additional road-connected peers, at most three corridor hops away; each junction has at most eight peers. The RRT chooses dissemination paths, **not a transport protocol**.

Logical request/reply messages travel synchronously inside the same worker; there is no external network or service. A request identifies its cached route and topology. The receiver replies along the **exact reversed route**, without another search. Repeated messages reuse the route. Expiring packets do not expire routes; relevant topology changes invalidate affected local trees, while unrelated edits preserve valid paths. A separate communication generation fences replay after same-topology reset. Replies reject old topology/generation, wrong routes, duplicate sequence numbers and observations older than two substeps (0.4 seconds). Logical return communication is bidirectional even when the vehicle road is one-way.

Controllers read the prior substep's immutable captured observations, then all next phases commit together. Missing/stale state falls back to local control. A neighbor green is only a conservative arrival forecast within its remaining minimum-green window with observed incoming demand, not a promise through maximum-green. Zero usable receiving space supplies negative pressure; normal partial buffering is not treated as spillback. Additional RRT peers contribute only on the actual routed first hop. The averaged per-feasible-head bias is clamped to ±0.75 queue units (1.5 seconds of ordinary age weight), subordinate to urgent age, phase bounds, all-red and physical space. A red neighbor never vetoes feasible buffered movement.

## Visible state and lifecycle

Small green arrows/red bars display accepted worker state using three shared instanced batches, with no point lights, external assets or new controls. `all-red` also covers idle/uninitialized state; it is not a fake clearance countdown. Exact topology and worker epoch fence stale frames; pause freezes state, OFF hides it and errors/reset/road edits clear it appropriately. The display never controls movement.

Phases, observation clocks and message mailboxes clone deterministically, freeze when paused and reset safely. Accepted RRT exact-destination car routing remains intact. Bus passengers, active IDs/destinations, economy and server-save schemas are unchanged.

## Reproducible bounded calibration

Run `node --experimental-strip-types scripts/traffic-adaptive-calibration.mjs` and `node --experimental-strip-types scripts/traffic-signal-coordination-calibration.mjs`. These are deterministic worker fixtures, **not** browser/mobile FPS or universal city throughput claims. Tail figures measure time from approach request to **first grant**, not full trip duration or a guaranteed maximum wait.

### Adaptive versus matched fixed timing

Same physical admission, downstream checks and 0.4-second clearance; comparator uses an 8-second fixed green with round-robin feasible approaches. Both respect the same 2–8-second permitted green bounds. At 600 seconds:

| Scenario | Completed fixed → adaptive | Blocked car-seconds fixed → adaptive | Approach p95 first-grant wait fixed → adaptive |
| --- | ---: | ---: | --- |
| Sparse uneven demand | 187 → 399 | 1797 → 592 | 22.4–26.4s → 0.8–5.8s |
| Saturated approaches | 374 → 352 | 4011 → 4052 | 27.6–27.8s → 6.4s |
| Bursty demand | 356 → 357 | 3647 → 3505 | 27.6–27.8s → 6.4s |

Saturated throughput trades off against more equal service and shorter approach waits; it is not a universal speedup.

### Isolating safe grant reuse

Against accepted main `dc8ed303be2879700e09c5afdc8c95b77a0024f4`, at 240 seconds:

| Fixture | Live | Tail-clear release only | Full adaptive |
| --- | ---: | ---: | ---: |
| Bottleneck | 120 | 170 | 170 |
| Real bypass | 187 | 224 | 203 |
| Asymmetric four-way | 120 | 183 | 141 |
| Saturated four-way | 120 | 183 | 140 |

Thus gains versus live cannot be attributed solely to adaptive timing: releasing cleared grants supplies much of the gain, while real phase clearance has a cost. The former bypass test's absolute +30 margin encoded the obsolete one-second hold; it now checks greater throughput/lower drops, mass/storage invariants, and preregistered live floors at 120/240/600 seconds.

### Neighbor coordination versus independent adaptive control

All five preregistered 600-second fixtures **tie** independent control after conservative forecast correction:

| Fixture | Completed (both) | Blocked car-seconds (both) |
| --- | ---: | ---: |
| Corridor | 415 | 1771 |
| Two adjacent junctions | 404 | 2447 |
| Unequal crossflows | 431 | 5700 |
| Four-junction RRT corridor | 518 | 9726 |
| Spillback and repair | 428 | 5405 |

The feature demonstrably exchanges and uses neighboring state: a focused accepted-message test changes an otherwise equal feasible grant, while expiry restores the exact local choice. There is **no demonstrated net throughput gain from coordination** in these fixtures, and no “optimized green wave” claim.

### CPU and invariants

Initial matched 60-step all-road/64-OD/128-car host sample: live mean/p95 19.5/43.3ms, release-only 20.7/42.3ms, adaptive/communication 43.5/71.2ms. Profiling identified peer exchange and repeated downstream fleet scans. A peer-copy optimization showed no speed benefit and was reverted. The final bounded change reuses existing grouped lane/link occupancy only during the decision pass before any movement: matched candidate mean fell 45.15→39.18ms and p95 74.65→59.79ms, with identical 148 completions. Full frames, phases, observation clocks, snapshots, message contents and stats matched over 60 dense + 240 corridor steps (35,500 mailbox comparisons), including pause/edit/clone/reset. Live movement/spawn checks remain uncached and current; bus-load and tail-gap guards have a regression test.

Peer-route cache construction is separate one-time/topology-edit work (a separate host sample measured 34.7ms initial construction and 16.3ms for an edit), not a per-message RRT search.

Before the circular-admission guard described below, residual added work remained material, around 39ms of the one-second worker cadence on this host, and below the existing 750/1000ms worker gate. This is not a speedup versus live or a real-device claim. Conservation error was zero in the dense sample. The earlier grouping pass also had exact full-frame/signal equality over two 240-step traces. No timing/policy thresholds were changed during optimization.


## Circular-admission guard integration

The follow-on [worker cycle prevention](TRAFFIC-WORKER-CYCLE-PREVENTION.md) rejects prospective circular lane dependencies after signal/physical eligibility and before admission. It does not retune phases, neighbor scoring, clearance or bus geometry. Existing fixed-versus-adaptive and all five neighbor-comparison calibration results above were rerun on the integrated candidate and remained unchanged. The final bounded 60-step peak worker sample measured 48.96ms mean / 81.19ms p95; safety bookkeeping adds cost, and no overall speedup or mobile-FPS claim is made.
