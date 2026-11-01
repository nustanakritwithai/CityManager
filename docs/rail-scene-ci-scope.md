# Rail scene presentation CI scope

Route `rail-scene` admits the rail 3D change from the rail aesthetics plan (PR R2). It covers:

- the platform station;
- the two-car train;
- the ballasted track with a buffer stop;
- the riders waiting on the platform.

It does this without the full legacy browser matrix, which still needs the server-save fixture migration (`docs/server-save-ci-migration.md`).

Selection is fail-closed:

- The changed paths must include `src/rail/scene.ts`, `src/rail/track-geometry.ts` and `tests/rail-track-geometry.test.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. The rail runtime, the rail manager UI, `src/main.ts`, simulation, save, auth, server files and `index.html` are not on it.
- The diff of `railSceneSources` must match the reviewed SHA-256. Any further source change falls back to the full route.

The route runs:

- the rail track geometry, rail manager and rail activation unit tests;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate. It runs with `CITYMANAGER_RAIL_CHECKS=activation`, so a real line is built and the rendered train is checked: one train, three batched track meshes, and the train moving.

As with the other exact scopes, the route skips the legacy local-save browser suites and the traffic browser jobs.
