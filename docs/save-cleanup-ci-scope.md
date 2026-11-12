# Browser-save cleanup CI scope

Route `save-cleanup` admits D1. D1 removes thirteen browser-save modules that the online-only game no longer imports from `src/main.ts`, the traffic worker or any page. Before this change, only tests used them. It also removes the dedicated tests and browser harnesses for those modules. Four feature tests now load their city through `deserializeParkSession` instead of the old startup path. This is the same path the server entry uses.

Selection is fail-closed:

- Every one of the thirteen modules must be deleted in the change.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. No live source is on it: not `src/main.ts`, `src/save-storage.ts`, the server save client, auth, the market client, simulation, the server or `index.html`.
- The diff of `saveCleanupSources` must match the reviewed SHA-256. That diff covers the deleted modules and the four adapted feature tests. Any further source change falls back to the full route.

The route runs:

- the four adapted feature tests;
- the remaining save-storage, autosave, education-session, server entry, server save, pages auth and market session tests;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.

The save-safety workflow also runs its server-only contract tests and the same smoke.

`tests/education-capacity.test.ts` is adapted but not run here, because two of its cases already fail on `main`. They are part of the pre-existing `npm test` failures, which stay at 71 before and after this change.

## Remaining browser-save removal (D2)

The remaining `save-storage` and `save-copy-codec` modules and their browser-only
backup/quota tests are now removed. The park-activity review preview also has no
Save/Load controls or persistent storage. Closing or reloading that preview resets
it. Existing browser keys are left untouched; this change neither reads/imports
nor clears old player data.

Frozen legacy readers and their migration dependencies remain necessary for old
server snapshots. Their v2/v3 integrity and corruption cases now live in
`tests/legacy-save-readers.test.ts`; mixed feature suites retain city/session
serialization, migration, identity, economics and invalid-input checks.
`tests/server-city-entry.test.ts` checks every source entry for browser persistence
APIs, including the isolated preview, and asserts that retired modules stay absent.

D2 uses the full CI route. It does not extend D1's exact-diff exemption above.
Explicit legacy-reader workflow commands replace the removed storage suite.
Server-only browser acceptance must still prove existing server snapshots load,
server ACK/retry/conflict behavior works, and obsolete browser keys remain intact.
