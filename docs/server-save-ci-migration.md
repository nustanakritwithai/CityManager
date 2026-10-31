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
