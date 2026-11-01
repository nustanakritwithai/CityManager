# Rail manager presentation CI scope

Route `rail-polish` admits the rail UI change from the rail aesthetics plan (PR R1) without running the full legacy browser matrix. That matrix still needs the server-save fixture migration (`docs/server-save-ci-migration.md`).

The PR R1 change covers:

- the rail dock menu as an icon row;
- confirmations that keep the target cells framed on the map;
- the manager's line diagram and build steps;
- the station and track card in the place panel.

Selection is fail-closed:

- The changed paths must include `src/rail/management.ts`, `src/rail/management.css` and `tests/rail-management.test.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. The rail runtime, the scene, simulation, save, auth, server files and `index.html` are not on it.
- The diff of `railPolishSources` must match the reviewed SHA-256. Any further source change falls back to the full route.

The route runs:

- the rail manager, rail activation, track geometry, grouped-menu, toolbar and select-menu unit tests;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.

As with the other exact scopes, it skips the legacy local-save browser suites and the traffic browser jobs.

Not covered here, and left for a separate fix (both were red on `main` before this change):

- the full `npm test` suite;
- the owner-decision browser precondition (`tests/owner-decision-smoke.mjs:38`).
