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
