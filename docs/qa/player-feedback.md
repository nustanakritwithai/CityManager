# Player feedback UX: draft validation

This patch adds visible school/university models, inline campus action results,
education costs and actual cohort progress, inspector pause/play controls, and a
persistent save-failure banner. It does not change education rules, prices,
payroll, simulation timing, or save storage/authority. Main `8dca948` is integrated,
including the Load identity fence, workforce, payroll and partial-study fixes.
The progress read-model expands optional `studyCohorts` into actual count/day
groups, preserving the legacy single-cohort fallback. School and university tests
exercise a real partial-attendance split and verify that closing the campus does
not invent progress or flatten advanced learners to the household minimum.

## Verified

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.
- Production build: `node node_modules/vite/bin/vite.js build --configLoader native`
  passed (existing large-bundle warning remains).
- Targeted integration tests after main `8dca948`: 44/44 passed with
  `node --experimental-strip-types --test tests/player-feedback.test.ts tests/autosave.test.ts tests/scene-decor.test.ts tests/load-authority.test.ts tests/education-labor.test.ts tests/education-capacity.test.ts tests/education-payroll.test.ts`.
- Isolated Edge/CDP, CSS viewport 390 x 844, DPR 1, synthetic starter city:
  school and university appear on the map; tapping the university selects it;
  the upgrade shows its actual 2,500 baht price; repeated refusal remains visible
  beside the actions. The revised layout gives the refusal a full row instead of
  squeezing the two action buttons. Screenshots below were visually inspected.
  They precede the final read-only capacity row, which now distinguishes maximum
  seats from `report.operatingSeats`, enrolled learners and today's progressing
  learners. That row consumes the simulator report directly, including partial
  capacity when available; it does not implement its own staffing policy.
- No real player saves, personal browser profile, server identity or shared market
  transactions were used. No new dependencies or external assets were installed.

![Synthetic campuses at 390 x 844](player-feedback/campuses-mobile.jpg)
![Repeated university refusal and separated action row](player-feedback/campus-refusal-mobile.jpg)

## Runtime verification

The local executor repeatedly disconnected during the remaining runtime flow. CDP
reported `Input.dispatchTouchEvent` and later `Runtime.evaluate` timeouts, followed
by `exec-server transport disconnected`. This does not establish a product defect
or a successful local test. Verification therefore moved to isolated Windows CI.
No physical Android test was performed.

The [full UX run at e7bbd77](https://github.com/nustanakritwithai/CityManager/actions/runs/40941901537)
passed inspector pause/play, actual school progress/cost and successful actions,
same-paused-day toggle/upgrade refresh, manual/autosave failure persistence,
menu/close/export reachability, and successful-write clearing. It exercised
390 x 844 and 1280 x 900 with no browser exceptions. The artifact
`player-feedback-ux-evidence` includes `results.json` and ten small screenshots.
Clock controls use pointer clicks; other mobile controls use emulated touch.

The bounded `tests/player-feedback-smoke.mjs` uses an explicitly supplied isolated
browser (`CITYMANAGER_DEBUG_PORT`) and serves the local `dist` build. It seeds only
the synthetic localhost origin and injects quota failures locally. Set
`CITYMANAGER_UX_RUNTIME_ONLY=1` to skip the already-confirmed campus flow and resume
the remaining clock/save checks. CI always runs the full flow and writes
`results.json` on success or failure.

## Targeted CI follow-up

`.github/workflows/player-feedback.yml` runs the full smoke on Windows with the
installed Edge, a fresh profile, loopback CDP port 9476, and the local test server
on port 4176. It builds with online APIs disabled and retains JPG screenshots plus
`results.json` for three days even on failure. It includes desktop campus and
active-warning screenshots, not only the final game panel.

The first existing browser CI on `55b0dacb` found a real navigation regression:
after a quota failure, the independently fixed mobile page menu stayed behind
the persistent banner even though its HUD parent moved down. The follow-up uses
the shared touch-row origin to move the menu, clock and KPI chip together. The
new smoke explicitly checks the game-menu hit target while the warning remains.
Its measured prior-offset control put the menu at y=60..104 behind the banner
at y=8..107.375; the corrected menu was y=167..211 and received native clicks.
This diagnosis is separate from the earlier local executor disconnections.

Visual review of that passing run found the desktop warning stretched the
inspector into the build dock. The current CSS keeps the desktop bottom clearance
while moving only its top; the smoke now asserts that separation and activates
the campus controls while the warning is visible. These follow-up changes require
their own successful CI before release.
