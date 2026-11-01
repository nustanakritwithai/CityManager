# PR181 presenter collision-query optimization

## Failed browser evidence retained

Run `41293475577`, normal-peak job `124810044344`, application/harness head
`996e213b6a31488d0bce2aaf90293ec7da44c383`. Artifact `13078012202`, ZIP SHA256
`30885f8cc1efbd6072ee93a927acbb3bb357ad7324037cbf31ac30af70e6f0c1`.
All three preregistered pairs completed, with 128 model / 64 visible actors.
OFF p95 was 83.4 ms each; ON p95 was 100.1 / 100 / 100 ms: strict `<100` failed.
Frame epoch maxima were 9.7 / 9.1 / 10.3 ms (already reached before measurement),
so `<8` failed. Projection maxima 4 / 3.7 / 3 ms passed. Relative allowance
104.25 ms passed. No failed observation is replaced or waived by this document.

## One bounded change

Base `d0347bbd693b05f6623f15da5ca88692114293b5` includes the lane-order fix and
native HTTP server fixture. Only `src/traffic/presentation.ts` runtime changes:

- Reject disjoint cached union bounds before testing their constituent exact
  collision boxes, using the same gap and epsilon.
- Snapshot entry bodies once during `acquireCorners`, where poses and collection
  membership do not change. References retain live grant flags, so earlier grants
  in the same ordered pass remain visible to later requests.
- Reuse collection snapshots within that pass instead of repeated allocations.

No lane order, exact geometry, admission policy, vehicle count, clocks, thresholds,
worker simulation, rendering, or persistence changes. Bounds never authorize a
movement: any overlapping union still undergoes the original exact tests.

## Local evidence (not browser or device certification)

Actual peak city fixture: 2,000 people, 490 roads, 86 buildings; 35 production
worker steps replayed at 12 presentation frames per step. Earlier e65 presenter
versus unoptimized PR181 means were 2.31–2.55 versus 2.49–2.91 ms across five
alternating pairs. Behavioral differences mean that is not an isolated cost of
just the new predicate. Sampling identified collision `clear` (20.8%), `frame`
(20.0%), acquisition (5.0%), plan lookup (4.9%), GC (4.3%); the predecessor
predicate itself was 0.7%. Profile includes worker fixture preparation.

One optimized candidate, five alternating baseline/candidate pairs after warmup.
No other test was launched by this worker during this final timing run. Shared
host scheduling was noisy (including large outliers); retain all values:

|Pair/order|Before mean / p95 / max ms|After mean / p95 / max ms|
|---|---|---|
|1 before→after|3.852 / 8.384 / 40.327|2.949 / 5.602 / 18.625|
|2 after→before|4.485 / 8.105 / 269.645|2.720 / 4.601 / 20.197|
|3 before→after|6.390 / 10.428 / 544.681|3.335 / 6.795 / 98.550|
|4 after→before|2.998 / 4.936 / 13.824|2.301 / 3.659 / 6.609|
|5 before→after|3.031 / 4.972 / 16.518|2.325 / 3.826 / 8.499|

All five means and p95s improved locally. This does **not** establish a native
browser `<8 ms` maximum or `<100 ms` frame interval pass. GPU/scene costs are not
measured by the Node replay; native CI must independently pass unchanged gates.
An earlier concurrent validation/timing pass is retained separately and is not
used as the isolated timing comparison.

Exact before/after equality: **4,020 frames**, comparing every rendered pose and
all presenter diagnostics, across peak, dense 5×5, and 3×3 with unrelated road
addition plus stopped new demand. Fixed inputs, order and timesteps match.

## Reproduction evidence

Local evidence directory `/workspace/shared/pr181-peak-cpu`:
- `bench.mjs`, `results.jsonl`: e65 versus unoptimized PR181.
- `profile.mjs`, `CPU.*.cpuprofile`: sampled attribution.
- `compare-opt.mjs`, `optimized-isolated-results.jsonl`: final timing above.
- `optimized-results.jsonl`: earlier concurrent pass, retained.
- `equivalence.mjs`, `equivalence.jsonl`: exact 4,020-frame parity.
- `focused-tests.log`, `typecheck.log`: relevant correctness validation.

Run with `node --experimental-strip-types <script>`; archived sources alongside
scripts preserve exact baseline and candidate modules. Browser raw evidence is
`/workspace/shared/pr181-peak-audit/normal-peak/failure.json`. These local evidence
paths are not shipped application dependencies and contain synthetic fixtures,
not player saves. Independent review and fresh native CI remain release gates.

Focused validation: 60/60 tests passed, zero skipped (`traffic-presentation`,
`traffic-lane-order`, `traffic-worker-cycle-presentation`, `traffic-game-layer`),
including all three dense bus classes through outbound/dwell/return, normal and
low-FPS actor drainage, collision gaps and stable IDs. TypeScript check passed.
