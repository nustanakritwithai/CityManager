---
type: technical-handoff
project: CityManager
domain: transport
feature: passenger-rail
status: draft
canonical: true
owner: rail-preparation-agent
validation: focused-headless-tests-and-build
last_reviewed: 2026-10-30
---

# Passenger rail preparation — inert vertical slice

## Status and scope

Prepared at main `84a9222a058bd61fb18cc733362db533a67f7b5c` (#111), in the
isolated local branch `prep/passenger-rail-foundation-20261030`. This is NOT a
released railway, production UI, live traffic integration or approved balance.
Only new `src/rail/*`, one test file and this handoff are added. No `main.ts`,
road tools, economy, primary saves, guest identity, autosave or release branches
are changed. No PR/push/merge/deployment is part of this preparation.

Source/contract review on 2026-10-30:

- Main's existing `src/traffic/types.ts` uses 10 people per representative road unit.
- #100 sampled head `9ebe00c73fc37705c4e75edb8bffa9aefa11bf82` and #104 sampled
  head `dfbee60d442ca8ac96baddbe5e808b6678dd5189` were open, default-OFF aggregate
  assignment/representative-rendering release work. They are not conserved road
  queues. Their historical `served` label is not evidence of completed journeys.
- Traffic integration owner confirmed future PR6 local checkpoint
  `2c998d19660d7b8d15c0759b6a823e3387c6a83d` is frozen and unpublished. Its
  `TrafficFlow` has aggregate OD mass, not stable individual request IDs. It is
  a design reference ONLY, not an imported dependency or stable modal API.
- The host clock remains one real second per economic day at speed 1, subject
  to its existing playback frame budget. Absolute game minute is
  `tick * 1440 + minuteOfDay`; no clock-rate change is introduced here.

## What is executable

`graph.ts` validates directed cardinal grid links and computes deterministic
weighted paths. Connections are explicit: adjoining track cells do not magically
connect. Row-wraps, duplicate edges and nonpositive durations are invalid. It
reuses the existing grid-neighbor helper, NOT road connectivity or new road tools.

`passenger.ts` owns a two-terminal, one-line, one-train shuttle. Supplied config
defines seats, platform queue capacities, boarding/alighting rates, minimum dwell,
minimum departure interval and bounded batch retention. There are no production
numeric defaults. The tests' numbers are fixtures, not approved tuning.

States are explicit and conserved:

```
offered = outside/access wait + platform wait + onboard + egress + completed
```

- Excess passengers wait outside the finite platform instead of disappearing.
- First-mile `readyAtMinute` and last-mile `egressMinutes` come from the future
  access planner. The slice does not invent access paths, population or catchment.
- Boarding is seat/rate limited; alighting is rate limited; egress must finish
  before completion. Minimum departure interval is NOT a promise of actual
  headway: path duration, unloading, loading and fleet size remain bottlenecks.
- An empty train repositions to the other terminal if needed; idle trains do not
  run endless fabricated services.
- The sole train owns the entire corridor block while moving. This prevents
  overlap within this supported slice, NOT proof of a multi-train signal system.
- Service pause stops new boarding/departures except draining riders already
  onboard. Global clock pause stops all movement/loading/egress.
- Closed stations retain passengers. Reopening resumes service. No timeout drop,
  ghost-through, teleport or hidden completion exists.
- Occupied graph edits reject before mutation. A docked empty train may receive
  a disconnected newer graph: queues remain conserved until repaired. Cache keys
  are directed stop pairs and invalidate on graph replacement.
- Identical batch/lease retries are no-ops even after completion; conflicting
  retries reject. Snapshot reads are defensive copies.
- At `maxBatches`, NEW offers reject without eviction. Completed IDs are retained
  for deduplication. This is deliberately a bounded preparation session, not an
  unlimited production backlog. Production compaction/watermarks remain future work.

## Typed API and host clock boundary

```ts
const rail = new PassengerRail(explicitConfig, graph, hostAbsoluteMinute);
const handoff = offerLeasedPassengerDemand(rail, modalDemand, offer);
// Same synchronous host transaction: commit handoff.demand together with rail.
const progress = rail.advanceTo(hostAbsoluteMinute, workBudgetMinutes, paused);
const snapshot = rail.snapshot;
const diagnostics = rail.diagnostics();
const cumulativeReceipts = rail.serviceReceipts();
```

`advanceTo` receives authoritative absolute GAME minutes, never wall seconds or
renderer delta. The budget limits processed quanta; it returns the remaining
minutes. Repeating the same target drains that work without replay. Do not move
the host world ahead while silently dropping transport work: a future coordinator
must keep existing park/economic/transport boundaries atomic. There is no host hook
yet. A backward clock/new city requires a new correctly restored runtime, not an
implicit reset that erases outstanding passengers. Trips can span multiple days;
midnight neither flushes trains nor regenerates demand. No new demand is generated
inside this module: the owner offers each source request once.

## Proposed modal ownership contract — coordinate with PR6 before use

`ModalDemand` refers to a stable *demand request*, not a mesh ID or route key. Its
source zone IDs are opaque nonnegative numbers, permitting the traffic draft's
future stable-parcel IDs without importing their provisional encoding. Counts
are integer PEOPLE. Only reporting converts completed people / 10 to current
representative-road equivalents; no fractional-person rounding is performed.

```
offered = roadAdmitted + roadAssignable + railPending + railCompleted
```

- `roadAdmitted` is cumulative ownership handed to the road engine (including
  that engine's eventual completions), not its current on-road occupancy.
- `reserveRailDemand` moves ONLY unadmitted road-eligible people to a rail lease.
  `roadAssignable` decreases immediately. Rail queue/onboard passengers cannot
  also enter road simulation. `railPending` includes all unresolved rail legs.
- `offerLeasedPassengerDemand` first validates a candidate modal reservation,
  then attempts rail intake. Refused capacity returns original modal ownership.
  The host MUST commit both results synchronously/atomically. Direct low-level
  `rail.offer` cannot independently prove external ownership; use the adapter.
- `admitRoadDemand` refuses rail-owned quantities. It is a host-owned delta
  operation, not a retryable event API; road admission idempotency belongs to
  the future shared coordinator.
- A cumulative `RailServiceReceipt` is bound to request, lease and source OD.
  `acknowledgeRailService` accepts only quantities within that lease; duplicate
  and older receipts cannot credit twice or reverse completion.
- Only completed journeys (after egress) earn
  `completedRailRoadEquivalents`. Boarding, a station upgrade or an empty train
  does NOT fabricate completed road relief. Rail waiting remains unresolved in
  the RAIL pool, not simultaneously duplicated in road demand.
- No reducer subtracts riders from already-admitted road flow. No global
  congestion percentage, link-volume subtraction or road-car hiding exists.
- Explicit rail-to-road fallback/cancellation is NOT implemented. Do not
  recreate road demand after a closure while retaining the rail lease. That
  future operation must release proven unboarded ownership exactly once.

Current #100/#104 cannot consume this contract safely: they assign hourly OD
volumes and have no request-level ownership/leases. Future PR6 must add stable
request/batch identities and a modal transaction boundary, or define a different
equally conserved aggregate interface. Do not infer that this standalone reducer
already integrates with PR6 or causes visible road relief in the shipped game.

## Unresolved decisions and deliberately absent systems

`RAIL_INTEGRATION_DECISIONS` explicitly leaves track grade, construction costs,
upkeep, fares, upgrade levels and catchment policy as `null`. Nothing charges money
or invents a final policy for them. Additional decisions needed before activation:

1. Ground versus elevated track/crossings and legal placement/footprint rules.
2. Costs, payroll/workforce, energy and fares through existing paired ledgers.
3. Station/fleet/dispatch upgrade levels and balance; no global capacity multiplier.
4. Actual home/work/cohort/service OD adapter and reachable first/last-mile paths.
5. Stable request ownership and clock/save transaction boundary with traffic lead.

No freight, manifest, goods reservation or instant-trade change is made. No
multi-train junctions, passing loops, transfers, route-edit UI, rail visuals,
construction commands, production restore codec, primary save version or account
is added. Snapshot is a debug/read-only interface, NOT a supported save format.
Existing #89/#97 guest/load generation/autosave protections must remain in the
future session integration; old cities should get empty rail, never resets.

## Verification and next gates

Headless tests cover grid validation, deterministic round trip, both directions,
capacity conservation, finite platform overflow, loading/headway bottlenecks,
first/last mile timing, actual arrival-only credit, repeated/conflicting intake,
bounded refusal, pause/speed/budget equivalence, multi-day trips, graceful service
stop, station closure, occupied edit rejection, cache invalidation, defensive
copies, malformed input, modal overbooking, duplicate/stale/source-mismatched
receipts and unchanged city serialization. No browser/device/performance claim.

Prepared-head results: **21/21 rail tests, 54/54 focused rail/traffic/road tests,
TypeScript and Vite production build passed**, plus clean staged whitespace check.
The existing >500 kB bundle warning remains. Full project suite, independent
review, remote CI and browser/device QA were not run for this inert preparation.

Commands:

```
node --experimental-strip-types --test tests/rail-passenger.test.ts
node --experimental-strip-types --test tests/rail-passenger.test.ts tests/traffic-demand.test.ts tests/traffic-network.test.ts tests/traffic-routing.test.ts tests/road-topology.test.ts
npm run build
git diff --check
```

Next: independent review of this isolated draft and agreement with PR6 owner;
then an explicitly scoped atomic clock/save integration and actual OD adapter;
then two-station UI/visual vertical slice with measured completed service and
conserved road relief. Management/upgrades follow, freight later. Do not merge
or activate this preparation merely because its focused tests pass.
