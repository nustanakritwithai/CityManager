# Bus panel presentation CI scope

Route `bus-polish` admits the bus UI change from the bus aesthetics plan (PR B1). It covers:

- the bus dock menu as an icon row;
- the line panel in the panel theme, with line cards and stop chips;
- the composer, with arrow side buttons, numbered stop chips and a gold create button;
- the stop and depot card in the place panel.

It does this without the full legacy browser matrix, which still needs the server-save fixture migration (`docs/server-save-ci-migration.md`).

Selection is fail-closed:

- The changed paths must include `src/bus/menu.ts`, `src/bus/panel.ts` and `src/bus/player.css`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. The bus engine, lines, player model, simulation, save, auth, server files, `index.html` and the bus tests are not on it.
- The diff of `busPolishSources` must match the reviewed SHA-256. Any further source change falls back to the full route.

The route runs:

- all bus unit tests, plus the grouped-menu and rail-manager tests, because the dock row layout is shared;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.

As with the other exact scopes, the legacy local-save browser suites and the traffic browser jobs are skipped.
