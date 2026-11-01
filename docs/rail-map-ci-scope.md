# Rail map overlay CI scope

Route `rail-map` admits the rail map change from the rail aesthetics plan (PR R3). It draws the railway on the minimap and on the full city map:

- the lilac track runs;
- the numbered stations;
- the gold train;
- the waiting counts under each station on the city map;
- a "รถไฟ" legend key and a pointer readout for rail cells.

The rail manager publishes this data on each sync. The map only reads it.

Selection is fail-closed:

- The changed paths must include `src/rail/map-paint.ts`, `src/rail/map-state.ts` and `tests/rail-map.test.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. The rail runtime, the 3D scene, `src/main.ts`, simulation, save, auth, server files and `index.html` are not on it.
- The diff of `railMapSources` must match the reviewed SHA-256. Any further source change falls back to the full route.

The route runs:

- the rail map, rail manager, track geometry and rail activation unit tests;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate. It runs with `CITYMANAGER_RAIL_CHECKS=activation`.

As with the other exact scopes, the route skips the legacy local-save browser suites and the traffic browser jobs.
