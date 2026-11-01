# Browser-storage removal CI scope

Route `browser-storage` admits D2. After D2, the game keeps nothing in the browser:

- City entry no longer reads a remembered Guest ID. The server session, whether a cookie or the Pages login popup, is the only identity.
- The market journal lives in page memory (`src/session-memory.ts`) instead of `localStorage`.
- Guide progress, advanced mode, atmosphere and sound settings, and the bus, taxi and traffic switches last only for the current visit.

Selection is fail-closed:

- The changed paths must include `src/session-memory.ts`, `src/market-client.ts`, `src/server-city-entry.ts` and `src/city-save-auth.ts`.
- Every changed path must be in the allowlist in `scripts/ci-visual-scope.mjs`. The allowlist is the exact reviewed source and test files plus the CI files. `src/main.ts`, the save format, the server save client, the server, simulation and `index.html` are not on it.
- The diff of `browserStorageSources` must match the reviewed SHA-256. Any further change falls back to the full route.

The route runs:

- the market client, safety, session, trade-rejection, panel and envelope tests;
- the pages-auth, server entry and server save tests;
- the taxi and bus building tests, the traffic fleet tests, and the audio and guide tests;
- the type check and production build;
- the mandatory built-bundle server-save browser smoke, which is the deploy gate.

The save-safety workflow also runs, because its path filter matches the entry and market files.
