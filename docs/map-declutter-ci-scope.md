# Map declutter CI scope

Route `map-declutter` admits the change that sorts building issues by urgency. It touches only how issues are presented.

Each issue now falls into one of three tiers:

- **alert:** something is broken. It always gets a map badge, is counted in the HUD "ควรตรวจ", shows as a minimap dot, and plays the chime.
- **nearby:** an empty new home, or next-level and education requirements. These appear only when zoomed in, as small translucent dots.
- **panel:** recent imports, or a campus the player paused. These appear only in the place panel.

No more than 20 badges are shown on screen at once. The place panel still lists every issue.

Selection is fail-closed:

- The changed paths must include `src/building-issues.ts`, `src/map-markers.ts` and `tests/building-issues.test.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. Simulation, the overlay layers, `src/main.ts`, save, server and `index.html` are not on it.
- The diff of `mapDeclutterSources` must match the reviewed SHA-256. Any further change falls back to the full route.

The route runs:

- the building issue, audio, rail map and bus map unit tests;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.
