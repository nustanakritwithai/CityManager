# Server-only save CI scope and remaining browser migrations

The reviewed server-only entry transition runs exact-source auth, entry, migration-inventory and server-save unit contracts, production build, and the **mandatory real built-bundle server-save browser acceptance**. That test uses the real server service with a disposable existing-owner cookie fixture; it verifies acknowledgement, migration, reload, quota independence, failures, retry and conflict, zero browser city writes, and access to the real Save control after authenticated entry. It captures acknowledged-save and conflict UI states. The optional duplicate 13-frame toolbar/mobile matrix is not run here: that unchanged feature remains covered by visual PR167 and its own retained visual helper/tests. This server-save result does not claim fresh toolbar-matrix coverage. Its self-test is **not browser acceptance**. The required Save smoke workflow, deploy gate, and read-only post-deploy probe remain mandatory.

Scope is fail-closed: exact changed paths plus hashes of the reviewed before/after `src/main.ts` and `index.html`. Unknown/mixed changes do not select this route. No city state, authentication or success is injected into the application. No performance threshold was relaxed. This route is **not full simulation/UI coverage**.

## Not passed: old browser persistence contracts

These existing entrypoints inline localStorage seeds, load buttons and/or assertions about local writes/backups. They are retained, **not passed**, and not silently adapted with a fake storage shim:

- `tests/browser-smoke.mjs`
- `tests/submenus-smoke.mjs`, `tests/context-smoke.mjs`, `tests/compact-smoke.mjs`
- `tests/population-smoke.mjs`, `tests/worker-smoke.mjs`, `tests/agriculture-smoke.mjs`
- `tests/building-cards-smoke.mjs`, `tests/building-progression-smoke.mjs`, `tests/building-issues-smoke.mjs`
- `tests/roads-smoke.mjs`, `tests/audio-smoke.mjs`, `tests/signals-smoke.mjs`
- Main-entry-dependent entity/owner/player/traffic browser scenarios, and production boots in visual fixtures, also require authenticated server setup.

Follow-up migration must reuse the isolated server fixture, seed the service through its real contract, await the authenticated entry, and preserve every unrelated economy/UI assertion. Assertions requiring removed browser persistence must be explicitly replaced with equivalent server durability checks, not deleted or marked passed. Pure simulation/unit tests remain in place. A future default/full CityManager browser run fails with an actionable migration prerequisite rather than blindly invoking the known-incompatible legacy startup chain. Other scopes must receive their own reviewed server-fixture startup before being claimed compatible.


## Reviewed save-management transition

A separate exact-path and before/after main/index hash guard admits the delete/new-city management change to the existing mandatory server-save route. It adds fresh-world and management-dialog unit contracts while retaining server entry/auth/migration/save contracts and real Chrome/Windows built-browser lifecycle acceptance. Installer, database migration and production PostgreSQL adapter files are outside this frontend route. Unknown or mixed changes still fail closed. No unrelated toolbar/traffic matrix is reintroduced.

## PR181 presenter lane-order acceptance migration

The exact reviewed `src/traffic/presentation.ts` change has its own fail-closed
`traffic-presenter` path and canonical source-diff hash. It requires the lane-order
regression, both migrated traffic browser entrypoints, and the real server fixture
and tests. Any unrelated source, unknown range or missing required file selects
the full route. This is relevant traffic coverage, not a claim that the entire
historical simulation suite passes.

Both default/fault and all seven partitioned allocation-game profiles now seed the
isolated real server service through an acknowledged create, enter through the
visible existing-owner gate, and retain actual worker, preference, pause,
road/bypass, economy, model-fallback and performance assertions. No city is seeded
in browser storage. The removed local primary/checkpoint/backup assertions are
replaced by exact server raw/revision ACK, unchanged head during isolation,
actual autosave publication and authenticated reload durability. Standalone
traffic preferences remain browser preferences; zero browser city writes remains
mandatory. No recovery-IDB-denial chooser is presented as current startup.

The new scope does not skip the Traffic workflow's default/fault or any of
the seven browser jobs covering the former full/core/extended workloads. Main additionally retains current strict
gap/identity/bus/RRT/signal and real server-save browser acceptance. Existing
server-save workflows remain mandatory. Per-process 240-second watchdogs, traffic demand, bypass
thresholds and performance thresholds are unchanged; combined work is partitioned as described below.

PR181's original full run reported 71 failures in 32 files outside the only
changed production module's import closure. Selected failures reproduce on exact
base e65eb66 (old commercial-level, serialization-version, inventory and bounded
history expectations). The remainder are not declared harmless or fixed here.
They are preserved for separate baseline maintenance, not removed, marked passed,
or hidden by a globally relaxed test command.

Local build, real-service sockets-free fixtures and targeted tests can run in the
cloud workspace. Local Chromium currently fails before DevTools with
`process_singleton_posix.cc: socket() failed: Operation not permitted`; no sandbox
bypass is used. New remote CI screenshots and manual image review are required
before acceptance; earlier artifacts are not proof of this migrated harness.

### Exact-head browser follow-up

The first migrated run reached actual entry and Save. It exposed two remaining
harness assumptions: the shared native Save waiter lacked the current Thai
server terminal text; a reload can legitimately flush an unchanged session and
advance server revision. The fixture now verifies every such increase against
observed successful POST/ACK actions, exact raw/city identity and contiguous
expected revisions, then requires the actual entry GET to match the final head.
It does not accept unexplained revision growth. Old pages unload and intercepted
requests settle before a new scenario is seeded; fresh scenario identities and
rejected-save errors fence delayed outgoing requests. Compact request evidence
is recorded without dumping session bodies.

The fallback extended run exhausted its unchanged 240-second watchdog after
bypass and dense sampling accumulated. CI now partitions the same assertions
into normal core/bypass/dense/peak and fallback core/bypass/dense jobs. Automated
union tests require every original check exactly once (9 normal, 8 fallback).
Dense OFF/ON stays paired in one job; all three normal peak pairs stay in one
job. Existing demand, native inputs, screenshots, per-pair thresholds and the
240-second per-profile watchdog are unchanged. No old failure is marked passed.
