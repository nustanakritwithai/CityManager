# HUD and build dock presentation CI scope

Route `hud-polish` admits the top HUD and build-dock presentation change (aesthetics plan, PR 1) without the full legacy browser matrix, which still needs the server-save fixture migration (`docs/server-save-ci-migration.md`).

Selection is fail-closed:

- The changed paths must include `src/main.ts`, `src/tool-menu.ts`, `src/grouped-tool-menu.ts` and `tests/grouped-tool-menu.test.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. `index.html`, simulation, save, auth and server files are not on it.
- The diff of `hudPolishSources` must match the reviewed SHA-256. Any further source change falls back to the full route.

The route runs:

- the toolbar, grouped-menu, select-menu and rail-management unit tests;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.

The legacy local-save browser suites and the traffic browser jobs are skipped, as for the other exact scopes.

Not covered here: the full `npm test` suite (red on `main` at the time of this change) and the owner-decision browser precondition (`tests/owner-decision-smoke.mjs:38`). Both are pre-existing and are left for a separate fix.
