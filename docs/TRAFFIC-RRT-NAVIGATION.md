# Goal-directed road RRT for ordinary cars

This extends the existing seeded taxi roaming RRT (`src/taxi/rrt-roam.ts`, originally commit `26 cdcd 8`) without changing taxi dispatch. Taxi roaming intentionally picks a useful idle endpoint; ordinary trips must instead reach their exact destination. Both use the existing independent seeded `roamRng`, never the city economic RNG.

## Integration and safety

`TrafficGame.replan()` now uses a road-graph RRT candidate at the existing five-step OD planning cadence. Exploration follows only legal directed `network.out` edges. It cannot steer across parcels, override lanes or junction reservations, move a vehicle, or mark a partial route completed. Existing admitted actor paths are untouched by these periodic plans. Existing topology repair still pins the occupied edge and reconstructs only its legal continuation.

Each OD first obtains its existing congestion-weighted Dijkstra route. A complete RRT candidate is selected only when its cost is no greater (numerical tolerance 1e-9). Therefore the benefit is deterministic equal-cost route diversity, **not a claim to beat shortest-path cost**. Incomplete, more expensive, budget-exhausted or disconnected searches use Dijkstra or report unreachable. Invalid numerical endpoints/costs reject; absent graph endpoints are unreachable, including self-routes.

The seed is independent of render frames. OD + planning epoch identify exploration; rotating the first OD per epoch shares the bounded exploration opportunity. An admitted trip does not switch route just because the seed changes. New OD assignment may choose a different equal-cost path for future births.

## Bounds

- Per candidate: at most 48 tree nodes and 192 attempts.
- Across one planning wave: at most 512 expansions and 2048 attempts, regardless of actor count.
- Same OD/cost epoch memoized; returned paths detached from memo state.
- Network/cost epoch rebuilt for each existing replan, including road edits. No stale cross-topology cache.
- Dijkstra remains part of the combined work; the RRT cap alone is not a total CPU claim.
- Frame navigation counters describe only the latest wave. No save schema or persistent city data added.

## Evidence

New focused tests prove actual RRT selections and different optimal routes, exact goals, one-way legality, bounded miss/fallback, weighted-cost rejection, shared budgets, memo isolation, invalid inputs, deterministic model/clone parity, periodic admitted-route stability and road-edit occupied-edge preservation.

The existing strict bypass preflight remains **10 completed without bypass versus 12 with bypass**, with the original equal 20-step comparison and strict improvement unchanged. Existing 83 scoped traffic/worker/spacing/routing/taxi tests pass.

Reproduce the isolated planning benchmark:

```sh
node --experimental-strip-types scripts/traffic-rrt-benchmark.mjs
```

It uses the same full 576-road graph, unit link costs, 64 mirrored OD pairs; five warmup rounds then 40 measured waves each, alternating execution order. In this cloud Node run, original direct Dijkstra median 24.42 ms and p95 37.37 ms; combined RRT median 26.69 ms and p95 69.94 ms. Median overhead was about 2.27 ms (9.3%); tail latency was noisier and worse in this run. This includes new wrapper validation/memo costs, unlike an earlier RRT-off wrapper comparison. Other scoped tests ran concurrently; this is not an isolated-machine timing claim. Last measured combined wave: 512 expansions/512 attempts, 14 candidate searches, 10 accepted RRT routes, 54 Dijkstra fallbacks. These are CPU observations, not mobile FPS or browser render measurements.

A second predeclared matched run after the heavy regression suite finished measured original Dijkstra median 26.92 ms / p95 41.33 ms and combined RRT median 28.52 ms / p95 34.29 ms (+1.60 ms median, about 5.9%). Both observations are retained: tail variation is not evidence that RRT accelerates planning. No concurrent heavy test was launched by this worker during the second run; shared-host noise remains possible.

Final local regression: 9 new RRT tests, 83 existing routing/worker/spacing/taxi tests, 4 taxi-traffic tests and 44 presenter/layer tests passed, plus TypeScript and production build. The layer suite includes all three L1/L2/L3 dense 12-junction scenarios for 900 simulated seconds, actual stop sequence 255→341→255, real dwell/departure, 4/4 passengers delivered and zero ledger errors, with per-frame clearance and stable-ID assertions unchanged. This preserves the PR177 evidence; it does not claim every possible road layout is deadlock-free.
