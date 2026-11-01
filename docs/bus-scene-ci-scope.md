# Bus scene presentation CI scope

Route `bus-scene` admits the bus 3D change from the bus aesthetics plan (PR B2). It changes how these look:

- the windowed buses;
- the sign-plate stop poles;
- the shelters;
- the garage depots, whose door now faces the road;
- the slimmer route ribbons, whose colour set no longer includes yellow or orange.

It does this without the full legacy browser matrix, which still needs the server-save fixture migration (`docs/server-save-ci-migration.md`).

Selection is fail-closed:

- The changed paths must include `src/bus/geometry.ts`, `src/bus/overlay.ts`, `src/bus/scene-buses.ts` and `tests/bus-scene.test.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. The allowlist excludes the bus engine, lines, panels, `src/main.ts`, simulation, save, auth, server files and `index.html`.
- The diff of `busSceneSources` must match the reviewed SHA-256. Any further source change falls back to the full route.

The route runs:

- all bus unit tests, including the new bus scene test;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.

As with the other exact scopes, the route skips the legacy local-save browser suites and the traffic browser jobs.
