# Housing timing harness calibration (not acceptance)

This diagnostic-only change prepares one fixed lifecycle/clock calibration. It does not run the traffic paired benchmark, change the 8 ms gate, relax readiness/watchdogs, or authorize a production fix. The calibration has no production save endpoint and does not use player data.

## Why this is required

Preserved experiments:
- [V1, 42363992254](https://github.com/nustanakritwithai/CityManager/actions/runs/42363992254): six pre-ON failures; no comparison.
- [V2, 42366401765](https://github.com/nustanakritwithai/CityManager/actions/runs/42366401765): five passes and one candidate timing failure. Coarse traces cannot locate the exact inner spike.
- [V3, 42368070109](https://github.com/nustanakritwithai/CityManager/actions/runs/42368070109): three passes, baseline and candidate timing failures, one baseline readiness failure. Failed timing trials never received a trace stream handle during the bounded drain. Their exact spike attribution remains unknown. Port closure did not establish complete browser/GPU descendant cleanup.

Baseline failure does not exclude candidate regression. Neither trace loss nor cleanup uncertainty proves an instrumentation or process-leak cause. No production optimization is supported by those findings.

## Boundary

Only the new standalone calibration workflow may be launched after independent review. The existing paired workflow and its V3 pinned refs are retained historically, not updated or invoked by calibration. Local pure contracts can run on Linux; actual Windows Job Object behavior and Edge marker clocks require the single retained Windows calibration result. A failed case stops later cases, whose not-run entries remain explicit. No replacement trial or automatic benchmark follows.

The owned launcher must assign the suspended root to a kill-on-close Job Object before resuming it. It must not permit breakaway or disable browser sandboxing to force success. Only verified owned processes may be enumerated or terminated. Uncertainty is a failed calibration, not permission to kill unrelated Edge processes.

Clock interpretation is limited to actual marks' same-thread cumulative CPU delta across an enclosing bracket. This is a conservative bound including marker and intervening work, not exclusive CPU of a yielding task. Retrospective measure clocks do not represent historical thread CPU. Missing clock fields, identity conflicts or inconsistent brackets fail calibration.

## Max evidence overlay

`scripts/diagnostic-max-evidence.mjs` is an inert preparation helper for a future separately reviewed comparison. It wraps the original V3 diagnostic insertion, preserving the number/order of metric clocks and original max/counter math. Latest frame/projection maximum records contain original endpoints, counters, sequence, step, document time origin, layer instance and reset epoch. They are bounded to one record per kind and reset with the original timing epoch.

The smoke overlay uses the existing `diag()` response to persist the pre/post snapshots immediately before the unchanged fallback assertion. No added CDP evaluation runs during the measured phase. This preserves received context if trace flush fails; it cannot recover a snapshot that a crashed browser never returned. Neither overlay is applied to production files or automatically invoked by this calibration.

## Follow-up decision

After a successful calibration, review the exact artifact, ownership/cleanup proof, interrupted-flush telemetry and clock audit. Only then may the coordinator approve one fixed three-pair comparison using the new baseline/candidate hashes, identical canonical bytes and identical source insertion. A calibration pass is not a traffic acceptance pass or release clearance.

Proposed future comparison refs, not executed here: baseline `6d4052441313f0284398de1295b6fcd6629a0b00` (tree `782300694587f886d7820e7b8270e39dba8bbec9`); candidate `a8030c7f73e0868c88c034623227e1835557e99f` (tree `9509c8a15084af1148f00a4ea6af1d931e810c19`). Recheck canonical-reader and insertion identity for those exact refs before authorizing that comparison.

## First calibration outcome and compiler-only boundary

The single [calibration run 42380138115](https://github.com/nustanakritwithai/CityManager/actions/runs/42380138115) stopped in case 1 because Windows PowerShell's embedded-source compilation failed. The helper exited 2 before broker Run, Job Object creation or Edge launch. Cases 2 and 3 were not run. Artifact 13576833001 has verified SHA256 `67e35e062680a761cab2be54d54687e9e3bf59e91a65f2d19ea7c945fc303b75`.

Its generic compiler catch suppressed the exact error, so no C# syntax, ABI, ownership or browser cause has been established. The proposed separate `diagnostic/housing-harness-compile` workflow compiles once with bounded structured compiler diagnostics and returns before invoking the native broker. It must not invoke either calibration or paired benchmarks. A compiler success would only establish compilation, not Windows ownership, teardown, trace or clock semantics. A future calibration still needs separate review and authorization; no run is automatic.

The subsequent [compile-only observation 42381077653](https://github.com/nustanakritwithai/CityManager/actions/runs/42381077653) also failed, with eight captured inputs but only an unsupported-shape fallback. Artifact 13577318585 SHA256 is `1ec4e1de39c62ad21c4a6504d0ece0d783998bfd4d9c800b5e634a6339017e80`. No broker or target was invoked. The exact compiler cause remains unknown. The next proposed observability correction retains bounded type metadata and sanitized first-line exception text for approved shapes rather than silently dropping unrecognized input. Native in-memory extractor fixtures must pass before the compile-only step; they do not compile or launch the broker. Both failures remain retained.

[Observation 42382512313](https://github.com/nustanakritwithai/CityManager/actions/runs/42382512313) passed all 11 native extractor fixtures and finally captured the compiler cause: both `Task.Factory.StartNew(ReadBoundedLine)` callsites are ambiguous between `Action` and `Func<string>` overloads under the Windows compiler. The proposed correction supplies `<string>` at exactly those two sites, with a reverse-replacement hash check proving no other embedded C# change. Artifact13578305778 SHA256 is `812d8b2163a57d2d160a75da2b4583a4671f1442f1281f0ada95558c2378e933`. This observation invoked no broker or browser. One reviewed compile-only validation can check the correction; it does not authorize a calibration or benchmark.
