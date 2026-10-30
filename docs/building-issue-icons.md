# Building issue icons

Read-only map explanations, reusing `MapMarkers`, `buildingIssues()` and the existing place inspector. No new inspector, save field, clock/economy parameter, dependency or asset package.

## Facts and priority

`src/building-issues.ts` owns the explicit `ISSUE_PRIORITY` order: road → power → water → finances → workers → recipe input → missing data → inventory/buyer/occupancy advisories → intentional pause → future education/upgrade conditions. A building has one symbol plus `+N` other categories. The panel lists every category and its actual values.

- Water and power use the simulator's per-building served/need values. Farms are never warned for electricity they do not require. Disconnection is not mislabeled as a resource shortage.
- Factory input is the selected recipe's crop and the existing two-lot batch requirement, not the total of unrelated crops.
- Workers means the actual allocation; one worker is the operational minimum for firms, while schools use their real level-specific staffing gate. The full firm capacity is informational, not a new mandatory staffing gate.
- Campus availability uses the same `educationUtilityAvailability()` helper as `stepEducation()`. A closed campus shows only intentional pause. Current local roles plus outside contract are not taken from the stale `campus.report` snapshot.
- Blue education/upgrade badges are explicitly future growth conditions, not claims that current operations stopped. Education values use `buildingEducationStatus()` and the canonical shared credential allocator. Month-end previews are labeled as next-day review conditions. Routine age-only warnings on buildings younger than 30 days are omitted; maximum tiers do not invent another upgrade.
- Missing firm/education records are not filled with guessed data. Recent imports are labeled historical purchases, not proof of a current factory shortage.

## Interaction and cost

The existing marker layer uses 44px buttons with SVG symbols, semantic color, accessible reason labels, and one count. Marker activation resolves the latest entity identity then opens the existing place route directly; it never invokes a build command or citizen picking. The 7px drag threshold matches map input. Drag pans, cancellation/multiple pointers do not activate, and keyboard activation remains available. While another tool is selected the markers are pointer-transparent.

Facts are cached by meaningful city/context revision, including same-tick education, plant, treasury and road changes. Camera frames only project already-computed marker positions. Offscreen markers are culled before the visible budget, and overlapping touch targets are suppressed without affecting simulation or removing panel facts.

## Verification

- `node --experimental-strip-types --test tests/building-issues.test.ts` covers priorities/counts, representative types, exact resource/recipe/staff/credential requirements, clear/reappear while paused, stale report immunity, missing data, shared credential allocation, maximum tiers, current place routes, no state mutation, tap/drag/cancel/multitouch, and viewport culling.
- `node --experimental-strip-types tests/building-issues-smoke.mjs --preflight` builds and roundtrips a disposable simulated fixture; it does not read a player save.
- `node --experimental-strip-types tests/building-issues-smoke.mjs` runs desktop mouse and 390px touch-emulated acceptance with local-origin requests only and a disposable browser profile. It is wired into the existing Windows CI verification job. Screenshots/report go to `.test-output/building-issues/` and the existing evidence upload.
- Actual local browser execution was not attempted because this cloud's Chromium socket sandbox denial is already known. CI must establish runtime and visual acceptance; viewport emulation is not physical-device FPS evidence.

Integration base: main `090a75c48ceb55ef04e83febb6ff4f60a6f5e01b` (#98/#101/#103/#105/#106). The campus utility helper is already merged via PR #105; this feature does not duplicate that commit. The feature's only simulation-file addition is a read-only wrapper; the utility fix belongs to PR #105, not the icon feature.
