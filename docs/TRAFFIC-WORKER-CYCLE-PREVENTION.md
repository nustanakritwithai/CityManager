# Preventing circular worker queues

## Reproduction on live-source dc8ed303 (#178)

A three-by-three road grid at x/y 3–5, with all twelve ordered corner-to-corner ODs at rate 1, completed 29 trips then remained at 29 through worker step 240. All 32 admitted actors stayed in the same positions for 100 steps. Stopping new births for another 240 steps did not drain them, despite 8 of 24 directed road links being empty. This is a fixed-route queue dependency cycle, not a stopped worker clock or rendering-only pause.

At rate 0.25 the original model similarly left 28 admitted cars after new births stopped; rate 0.1 drained normally. These are synthetic reproductions, not proof of the user's exact city topology.

## Bounded admission rule

Before granting a crossing or admitting a new car, project all already-reserved incoming crossings and the proposed admission. A destination grant discharges its actor virtually; an actor already outgoing from a retained grant is not advanced twice.

Build per-lane queues. Each follower depends on its leader. A lane head depends on the next lane only when that lane's eventual holding slots are full, or its shared link capacity including bus PCU is exhausted. Capacity derives from the unchanged stop/entry geometry and standstill pitch, clamped to existing storage; a single moving car with eventual room does not artificially block the lane. Reject a proposed circular dependency before entry. Queued demand remains queued, and admitted IDs, destinations and routes are not rewritten.

At most 128 actors and one selected dependency per actor bound the graph walk; no exponential search or global arbitrary vehicle cap. Physical spacing, exit-room checks, source admission, fairness, occupied crossing ownership and stop-line clamps remain authoritative.

Periodic RRT planning still affects new trips only. Topology reconciliation now also leaves an already-valid active route unchanged; only a genuinely broken continuation is repaired while its occupied edge/progress remain pinned.

## Evidence and limits

- Fresh 3×3 and 5×5 grids at rates 0.25/0.5/1 retain sustained completion and every admitted actor drains after new births stop.
- Removing pending OD demand cancels only its waiting quantity; no admitted car is discarded to pass.
- Free single-car rings rotate; full second-slot circular queues are refused. Shared PCU and retained-grant projection are tested.
- Connected unoccupied future-road closure repairs legally and drains; unrelated additions preserve active paths.
- Removing asphalt beneath a car intentionally leaves that same car blocked on its occupied edge. This patch does not invent teleportation or recovery for a physically deleted road, permanently blocked exits or arbitrary external stationary loads.
- Pure production-engine/presenter integration at normal and measured low render cadence checks sustained model progress, final draining, rotated body clearance, gap and stable IDs. This is not browser/GPU evidence.

No city save, economy, signal policy or bus geometry changes are included. The standalone #178-base strict bypass comparison remains 10 completed without bypass versus 12 with it. After integration with adaptive signals the unchanged preflight reports 11 versus 15. The fix prevents the reproduced admission cycle; it is not a universal guarantee against physical gridlock on every edited road network.

## Local CPU observation

Same 240-step synthetic workloads at rate 0.5, excluding the first 20 steps, measured in Node (not a browser FPS claim): 3×3 baseline median 1.53ms / p95 2.70ms versus candidate 1.38ms / p95 3.01ms; 5×5 baseline 5.40ms / p95 7.36ms versus candidate 5.78ms / p95 9.35ms. The 3×3 candidate completed 189 trips versus 99 for the stalled baseline, so that is not a matched-work speedup comparison. 5×5 completed 224 in both; admission checks cost approximately 0.38ms at the median in this run. Shared-host timing and concurrent test load may affect tails. Evidence script/log remain private workspace diagnostics, with no player data.


## Adaptive-signal integration

The prospective cycle check runs only after the existing physical eligibility and selected-green guards, immediately before adding the actual grant; earlier grants in that same substep remain part of the projection. Spawn rejection still occurs before waiting demand or the next actor ID is consumed. Signal timing, clearance, peer communication, rendered indicators and bus geometry are unchanged.

Integrated validation: 88 cycle/actual-presentation/phase/peer/mapping/RRT/game/spacing tests and 46 worker/presentation/bus/save-boundary tests passed, as did the production build and strict preflight. A 60-step all-road/64-OD/128-actor worker stress run measured 48.96ms mean / 81.19ms p95, with zero conservation error and unchanged City/source inputs. This is bounded Node-worker cost, not a GPU/mobile FPS claim. Actual browser evidence remains a separate exact-commit CI gate.
