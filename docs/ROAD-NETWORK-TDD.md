# CityManager · Road-network distance / ECC TDD slice

## Baseline and intent

- Base `main` at `504f16a30199cd6fd47be0d98e1b20d26aed2c0e`; verification workflow [40078183712](https://github.com/nustanakritwithai/CityManager/actions/runs/40078183712) succeeded.
- Goal: supply **real, repeatable shortest road distance** between road cells and road-fronted parcels before adding freight/supply-chain decisions. This is a reversible vertical slice, not a traffic simulator.
- Keep PlayCanvas 2.23.3, TypeScript, Vite, the 24×24 map, deterministic daily simulation, current pricing, wallets, and **save schema v1** unchanged.

## Reuse / build decision (ECC search-first)

Use the existing grid and TypeScript tests. Build one bounded pure module rather than pulling in an A* library: every road edge currently has uniform weight and the map has 576 cells, so breadth-first search gives the exact minimum hop count. A* becomes useful only if transport edges later have different costs, speed or congestion.

## Route contract

`shortestRoadRoute(city, from, to)` returns a shortest sequence of **road tile indices**, including its road endpoints; it never cuts through empty land. For a parcel, an adjacent road is selected as frontage. When multiple frontages have equal length, stable source/neighbour ordering determines the route. Roads only connect in the four cardinal directions; flat-array index wraparound is not adjacency.

`roadDistance(city, from, to)` returns the number of road edges plus 1 entrance step for each off-road parcel. Returns `null` if no road route exists; the corresponding route function returns `[]`. A road at the gateway has distance 0. This distance is in **grid steps**, not metres, driving time, fuel costs, road capacity or traffic congestion.

`gatewayRoadRoute` and `gatewayRoadDistance` are convenience functions from the west outside-market gateway. These read only `city.cells`; they do not change RNG, tick, save data, accounts, ledgers or buildings.

The selected-place inspector displays gateway distance only when a road route exists, with an explicit limitation that travel time and traffic are not yet modelled. Connectivity and existing growth rules are unchanged.

## TDD evidence and checks

- **RED**: PR #6 test-first commit `3b10b143f61415549582da6825981f3bc3a27763`, Actions [40081765381](https://github.com/nustanakritwithai/CityManager/actions/runs/40081765381) failed as expected: `ERR_MODULE_NOT_FOUND` for the not-yet-created `src/road-network.ts`.
- **GREEN**: verify the exact final PR head via GitHub Actions before claiming PASS; this document does not assume the outcome.
- Target cases in `tests/road-network.test.ts`: straight routes, frontage steps, shortest path despite detours, disconnected routes, row wraparound, invalid indices, demolition cut, save/RNG non-mutation.
- Required gate: `npm test`; `npm run assets:verify`; `npm run build`; all four browser suites, both normal and blocked-model fallback on Windows/Edge. Mobile viewport evidence remains **emulated**, not verified on a physical device.
- Draft PR must not be merged or deployed without a complete verified run and review.

## Roadmap after this slice

1. Define explicit commodity IDs and recipes (raw materials → factory goods → retail goods/services); capture source, owner, destination and stock per item with invariant tests. Keep these rules distinct from a visual mockup.
2. Introduce deliveries that require a valid road route between participants; log shipment departure/arrival and avoid consuming goods before delivery. Decide on treatment of disconnected districts and imports.
3. Add route-dependent costs, vehicle/capacity choices, and later congestion; measure pathfinding performance and add a distance cache only if needed.
4. Add municipal power/water capacity networks, tax/budget consequences, migration/save-schema migration with backwards compatibility and regression tests.
5. Profile 64×64 cities, UI responsiveness and actual phone hardware before increasing city size or traffic fidelity.

**Scope**: this PR makes road-distance diagnostics real and testable. It does NOT imply shipping, route-dependent commerce, congestion, A* weighting or 64×64 support already exist.
