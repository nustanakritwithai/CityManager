# Bus map overlay CI scope

Route `bus-map` admits the bus map change from the bus aesthetics plan (PR B3). It covers what the minimap and the full city map draw for buses:

- cased line colours;
- numbered stop discs;
- gold waiting-count badges;
- depot tiles;
- the pointer readout that names a stop;
- a "รถเมล์" legend key.

Selection is fail-closed:

- The changed paths must include `src/bus/map-paint.ts` and `tests/bus-map.test.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. The allowlist excludes the bus engine, routes, 3D scene, `src/main.ts`, simulation, save, auth, server files and `index.html`.
- The diff of `busMapSources` must match the reviewed SHA-256. Any further source change falls back to the full route.

The route runs:

- the bus map, render, player and scene unit tests;
- the rail map unit test, since the minimap is shared;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.

As with the other exact scopes, the legacy local-save browser suites and the traffic browser jobs are skipped.
