# Park citizen activity: standalone first slice

This module is an opt-in deterministic sidecar. It does not change `City`, its save
version, payroll, work days, money, RNG, population, or the existing main scene.
One economic tick remains one day. The atmosphere clock and decorative traffic
are not simulation inputs and are not evidence that a resident performed an action.

## Integration clock

`createParkActivity(city, minuteOfDay = 0)` creates a sidecar for `city.tick`.
`advanceParkActivity(city, state, wholeMinutes)` mutates only that sidecar, at exact
one-minute boundaries. The caller supplies game minutes, never raw animation
frames. Zero minutes pauses completely. Batches may be split arbitrarily with the
same result. A call cannot cross minute 1440 or a changed economic tick.

The eventual main-loop integration must run 1440 activity minutes, call the
existing economic daily step exactly once, then call
`startParkActivityDay(city, state)`. It must make the chosen real-time speed of
that day explicit. Calling the day reset early cancels outstanding visits with a
diagnostic; it does not fabricate home returns. Skipped economic days are not
replayed as pretend recreation. This slice does not silently slow the economy or
reinterpret the existing visual day/night cycle.

After edits to city topology, homes, population or jobs, explicitly call
`reconcileParkActivity(city, state)`, including while paused. Advancing also
reconciles before processing minutes. Removed or changed identities/homes/parks,
blocked routes, and newly active work reservations cancel the affected activity.
Actors are removed from the renderer; they do not animate through an obstruction
or claim to have returned home. `cancelled` and `lastCancellation` disclose this.

## Real people and prototype scheduling policy

Every `h:<household ID>:m:<zero-based member slot>` is one constituent of the
existing household's `members` count. Slots are an explicit new interpretation
of aggregate population, not extra residents and not pre-existing named people.
`parkActivityCitizens` returns exactly that population. Workforce skill pools use
catalog order; owner allocations then employment allocations (each sorted by firm
ID) occupy available slots of their corresponding skill. Dependents and unused
workers have no job reservation. Retraining/reallocation may change a slot's job;
its identity stays stable while that member slot exists.

The mapping consumes canonical `City.ownerLabor` and `City.employment` first,
then the reviewed workforce candidate's optional `parks[].staffing.allocations`
in park-ID order using remaining slots of each skill. Its read-only structural
bridge preserves compatibility with the core park type before integration.
`firmId` and `parkJobId` distinguish job destinations; municipal jobs never occupy
already allocated slots. No assignments, wages or work days are written here.
Use this same `parkActivityCitizens` mapping for every consumer; independent
ordinal mappings could reserve the same worker twice. These are newly defined
constituent identities, not previously named individual workers in legacy saves.
`parkActivityUnavailableCitizenIds(city, minuteOfDay)` returns on-duty identities
for the separate recreation observer. `parkActivityAbsoluteMinute(state)` returns
the checked absolute game minute; minute 1440 and the next day's minute 0 are one
boundary and must be observed only once.

For this prototype only, employed slots reserve 08:00–17:00 every day. This is a
new scheduling assumption, not a claim about the existing daily economy's shift
system. Unemployed members can reserve visits 10:00–19:00; employed members
17:00–19:00. Actual departures may follow their reservation by the home headway.
No commuter trip or hourly production is simulated. Dispatch occurs every 15
minutes; each constituent can visit once per day. Admission rotates home groups
and uses stable day/identity hashing within each home without consuming the city
RNG. Shortest reachable park
wins, with park ID breaking ties. Trips must fit a conservative return-before-
22:00 budget. The admission ledger is persisted to prevent repeat visits on load.

There are six reserved visitor slots per park and 64 globally, counting outbound,
scheduled-at-home, inside, and returning visitors. This caps activities, never population. It does
not add demand/coverage/capacity to the municipal park economy contract.

## Navigation and state

Orthogonal BFS visits at most the 24×24 build grid and accepts routes of at most
34 cells including endpoints. Empty parcels and roads are walkable. Buildings,
plants and other parks block transit; only the resident's home and destination
park are endpoint exceptions. Coordinates start at the home boundary and finish
at the park boundary. No road frontage is required. Canonical `City` has no water
terrain; the decorative sea outside the build grid is never traversed. A future
terrain map must add actual blocked terrain to routing and reconciliation.

Each admission pass caches successful and failed routes per home building, shared
by all its household members. A separate navigation budget allows at most **256
BFS searches per admission**, each bounded by 576 cells, independent of population
and separate from visitor caps. It evaluates a home's complete available-park
choice set or defers that home. Sorted home groups rotate by eight homes each
15-minute admission (with a day offset), preventing unreachable low-ID homes from
monopolizing the budget. At 32 parks, eight complete home choices fit per pass.
The cache ends with the pass so construction changes cannot leave stale paths.
The persisted `routeSearches` diagnostic counts actual search calls; tests verify
single-home sharing and a 128-home/512-constituent/32-unreachable-park budget,
including eventual admission from the last home. They report observed benchmark
time but do not assert timing. This is a bounded prototype, not a large-city
frame-time guarantee; a batched advance can process multiple admission passes.

The saved state machine is `travel → enter → stroll → wait → meet/sit/leave`, with
meeting participants subsequently sitting (bench slots) or leaving. A meeting is
a temporary encounter between two real visitors in the same park. Both persist
each other's IDs and the same elapsed meeting minute. No friendships, romance,
appointments or other relationships are inferred. Losing a partner ends meeting
state. Unpaired waiting times out; there is no permanent queue or invented friend.

The two physical bench positions are normalized offsets `(-.24,+.29)` and
`(+.24,+.29)` from the park center, facing `-z`. Only slots 0 and 1 may sit; their
reservations prevent overlapping seats. Other slots stand on the cross path.
Entry, strolling and departure follow explicit in-park waypoints. Meeting is
standing at the participants' reserved positions, facing one another.

Departures from the same home have a persisted one-game-minute headway. Scheduled
residents retain reservations but remain at home and produce no walker snapshot
before `departureMinute`; the travel clock then starts from the home edge. The
return deadline includes this delay. This provides limited clearance on shared
outbound routes without decorative position drift. It is not full collision
avoidance for crossing routes, opposite directions or in-park movement.

`parkActivityVisitors(state)` derives positions, headings and phases from saved
state. Coordinates are uncentered tile units, so world coordinates are
`(coordinate - SIZE / 2) * tileUnit`. The renderer may interpolate gait and sampled
positions, but must not invent a phase, citizen or relationship. Disable the old
decorative walkers in any demonstration that claims all people are these agents.

## Persistence and limits

`serializeParkActivity` writes a separate JSON sidecar. `restoreParkActivity`
validates identity format, unique people/reservations, bounds, path adjacency,
phases, elapsed times, bench eligibility and mutual meeting links; then reconciles
legitimate city edits. A different economic tick rejects rather than attaching
old activity to a new day. The caller must associate the sidecar with the same
city save; this first slice adds no canonical city identifier or storage wiring.

Diagnostics expose reservations, inside count, completed home returns,
cancellations, actual meeting pairs and distinct visits. This implementation
has no full pedestrian collision avoidance, traffic-crossing rules, route repair
after construction, age/guardian model, relationship simulation or production
integration. Core behavior is covered by executable unit tests. Browser/render
validation must be reported separately by the integrating demonstration.
