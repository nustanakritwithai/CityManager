# Bus demand follows existing employment

The visual traffic worker previously chose only the two closest reachable non-residential buildings for each home. A bus line serving the residents' real employer could therefore receive no demand when that employer was farther away.

## Behavior

When the compiled bus service has at least one active line, the main-thread capture includes aggregate home/work counts from the existing employed-citizen iterator. Wage jobs, owner labor and staffed parks use the same household member slots as existing activity/work labels. This reads current homes and assignments on every traffic sample, including after a household moves. It does not assign new jobs or people.

The worker preserves each home's old nearest-two demand budget. The fraction belonging to residents with reachable jobs is redirected to those actual workplaces, proportionally to the number of assigned workers. The remaining fraction keeps the old destinations. No reachable job means the original routes remain. No old ambient demand budget means no new trips, including park-only cities without ambient destinations.

Bus riders are split out of that shared demand rather than added alongside private cars. Taxi vehicle/repositioning flow is excluded from bus diversion. Whole-person carry, queueing, boarding, releases and cumulative return accounting continue through the existing bus bridge/engine.

An absent or suspended bus service keeps the legacy capture/demand path. Work-label hours do not suppress bus demand: this visual traffic game and bus service use their existing real-time clock, independent of accelerated economic days. These are representative flows, not a saved daily travel diary for every citizen.

## Bounds and limits

- Aggregate commute input is bounded at 65,536 home/work rows, independent of the work-label roster's existing cap.
- Duplicate road-frontage pairs are combined before retaining at most 4,096 raw demand rows. Omitted rate is reported as clipped, never as completed travel.
- The existing 64-OD/128-car representative projection remains. Large cities may omit particular employers from the representative endpoints. This change does not guarantee waiting passengers for every line or alter mode-choice costs, walking catchments, capacity or waiting times.
- No economy, payroll, city serialization, server API or player-save writes are introduced.

## Verification

`node --experimental-strip-types --test tests/bus-commute-demand.test.ts` covers the four-resident/three-bus distant-employer case, actual committed Worker-engine frames producing waiting and boarding, exact demand conservation, disabled-service parity, owner/park assignments, off-hours capture, moved homes, unreachable/directed roads, duplicate inputs, a 4,900-pair clipping fixture and taxi-only exclusion.

`node --experimental-strip-types tests/bus-commute-browser.mjs` runs against a built local preview and an isolated server fixture. It observes the compiled browser Worker and native bus lifecycle without touching production-player saves. The browser script's result, rather than this description, determines whether a run passed.
