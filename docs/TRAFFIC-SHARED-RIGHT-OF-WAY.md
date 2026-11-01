# Shared bus/car right of way — bounded follow-up to PR164

Base: main `26783b155bbf1d494d950c8c74bc628085453e3a`.

## Authority and clocks

Cars retain worker simulation, stable representative IDs and the existing close-gap presenter.
Buses retain their passenger engine. An optional movement gate is called **before** a bus advances
or commits a geometry-changing departure/arrival event. It is not a visual-only pause.

Gated advance uses at most 0.25-second slices and stops at every route timestamp. A denied drive
translates the bus's complete private timeline, preserving its fractional position exactly; it does
not rewind the bus or freeze the global service clock. A denied terminal transition postpones only
that event, leaving the arrived road position unchanged. Queue timeouts and the service-end boundary
continue to run. Boarding/alighting commits only after the corresponding actual arrival is admitted.
No-motion lifecycle events do not require a roadway grant. The original optional-ungated engine path
remains available and is covered by its original tests.

The main-thread gate uses production bus geometry, conservative swept bodies, current visible cars
and peer buses. Denied corridor requests exclude new admissions while existing occupants drain.
Already visible vehicles are never hidden, shifted backwards or teleported to resolve a conflict.
A granted incremental sweep is replaced by the actual committed body, including its rear extent.
Long vehicles publish complete cached actual-route maneuver plans: an occupied stop guard,
a route corridor to a real holding pocket, and when needed the next terminal guard (at most three
lifecycle identities, not a limit on the number of road junctions). Straight traversals of degree>2 nodes require the
same admission as bends; a straight heading does not make a crossing conflict-free. They protect the full rotation and downstream rear-clearance envelope before
entry, without reserving an entire route or inventing movement targets. A stop token protects only
the future arrival/kerb/departure sweeps, not the already traversed approach; it is acquired before
parking and retained through the real dwell until the departure tail clears. Current tokens survive an
uncommitted proposal until the actual tail clears. Adjacent/mirrored bends and straight-node traversals in all four directions are regression-covered.
An adjacent crossing is not automatically a legal holding pocket. The applied bus class's actual
length/width, conservative full-rotation radius, lane offset and bumper gaps determine whether a
stopped body fits between conflict envelopes. Where it cannot, the maneuver follows the **actual
route** to its next safe pocket or real stop. Dense connected grids are not rejected or globally
locked based on component size. A shortest route has at most 576 cells; preserving one occupied
edge during a replan permits 577. Immutable plans therefore have a finite 1,154-sample ceiling,
computed once per path/applied class and reset on topology changes. Segment sweeps follow the route,
not an enclosing whole-grid rectangle. The final terminal/departure guard is requested before entry
to the last no-pocket corridor so late planning cannot trap a follower at the kerb.

Shared admission separates REQUESTED, SELECTED_DRAIN, ACQUIRED, OCCUPIED and actual TAIL_CLEAR.
A pending request owns no future space. A selected drain epoch consists of existing visible IDs;
new representative births may wait, but no already-visible ID is removed or promoted retroactively.
Existing actors evacuate under actual body checks and acquired leases. Acquisition requires the
complete maneuver and real exit space; granted clearance survives until actual rear-clear. Fair
birth opportunities and continuous-demand mixed cycles are independent integration requirements.
Car intent carries exact incoming lane/heading, node centre and actual outgoing clearance, plus a
monotonic per-actor visit counter that survives route replans. These are read-only planning hints,
not extra motion or save state.
A denied drive is held for the rest of its capped host frame, preventing near-waypoint epsilon gaps
from repeatedly subdividing one frame. Same-host-schedule determinism is supported; arbitrary
chunk-size invariance under external contention is not claimed.
Topology refresh cancels obsolete reservations before creating new requests. An occupied fractional
edge is completed before a changed route continues from its downstream end.

## Depot lifecycle

`home` means stored inside the depot, not an overlapping row of road meshes. Existing parked counts
remain visible in the bus panel. Departure is admitted from the depot doorway before the bus becomes
an active road body. Return becomes `home` only at the actual depot arrival. Requested bus-class
changes apply at a safe depot refit, not by expanding a live roadway body. Existing active capacity
and passengers remain unchanged until return; mixed fleets advertise conservative actual capacity.

Both destructive UI paths reject depot removal while an active bus depends on it, before grid/money
mutation (including after asynchronous confirmation). Each bus retains its originating depot ID after
line removal so stopping a line still permits a real return. An already-missing legacy depot yields
an explicit visible stranded bus, not an invented home arrival; affected passengers reconcile once.
Retained fleet is capped at 80, including stranded buses. Service offers use actual available fleet,
not an uncreated configured fleet. This is a fail-safe, not a new orphan recovery UI.

## Junction fairness

A bounded request map (at most the live actor count) chooses oldest eligible requests, then ID.
An occupied crossing retains ownership; the existing one-worker-step crossroad signal duration is
unchanged. Two-arm bends still release after the rear clears. Eligibility requires physical downstream
room for the entering body to clear, not merely a spare numerical storage slot. New source admission
cannot steal an already-granted crossing.

The synthetic symmetric four-way scenario completes 15 trips per approach over 120 worker steps.
This is a fairness regression, not a browser FPS claim or a promise to eliminate physical gridlock.
An explored immediate crossroad-release variant was rejected: it changed baseline bottleneck capacity
and failed the existing strict bypass-benefit delta. The existing bypass test remains unchanged.

## Evidence and limits

Scoped tests cover exact mid-edge hold/resume, terminal event ordering, service closure and passenger
conservation, topology refresh, origin-depot return, bounded orphan retention, physical exit room,
cloned worker state, all existing close-gap/substep safety and strict bypass behavior. Integrated layer
and browser acceptance remain separate release gates. Node timings are not mobile/GPU smoothness evidence.
No rail, save schema, identity, economy, VPS or server-market policy changes are part of this work.

## Shared presenter admission and dense-grid evidence

The presenter uses REQUESTED → SELECTED_DRAIN → ACQUIRED → OCCUPIED → RELEASE
semantics. A pending request owns no future space. Selection captures a fixed epoch of
already-admitted representative cars; those cars retain escape rights and physical collision
checks. Only never-admitted births are temporarily deferred. Acquired corridors protect their
actual future exit as well as occupied space until the real tail clears. Old waiting requests
cannot revoke an acquired grant. Bus blockers captured at selection may evacuate, but lose that
privilege after clearing the domain; disjoint downstream bus movements remain possible.
Changed pending plans refresh selection without discarding acquired protection.

Finite actual-route plans replace the rejected four-node topology restriction. Projection is
cached by immutable plan identity; structural route/sample bounds are not map-support limits.
Cars use per-segment node envelopes, explicit centre hold lines and physical downstream slots.
Analytic rotated-body support bounds cover each movement segment. The executed rounded turn
and its reserved envelope use the same canonical arc: early incoming samples stop at its
tangent and premature outgoing samples wait without moving backward or dropping the ID.

`traffic-right-of-way-fixture.ts` builds a synthetic 55-road dense layout with 12 conflict nodes
on the actual bus route. The layer regression runs 900 simulated seconds for each actual bus
class (40/60/80 seats; .78/1.02/1.32 body lengths). It requires stop sequence 255 → 341 → 255,
real dwell/departure, all four submitted passengers completed, exact ledger conservation and
unchanged city serialization. Every sampled frame checks rotated car/car clearance (.09),
car/bus physical separation and admitted-ID continuity. Separate tests cover off-route entry,
nonrevocable grants, pause/reset, delayed turn samples, and two/three-bus evacuation chains.

The measured dense runs retain 4–43 visible cars for classes 1/2 and 1–41 for class 3; they do
not establish that visibility stays constant. Birth backpressure is observable in diagnostics,
and a real render-frame admission opportunity separates selected drain epochs. Fairness tests
cover finite epochs and continuous newcomer opportunities, not universal starvation freedom
for arbitrarily saturated roads. The coordinator sees at most 64 rendered car representatives
and actual bus-engine bodies: worker traffic mass continues independently, so this is not a
claim that every aggregate worker vehicle receives physical bus collision arbitration.

These are deterministic Node layer/engine tests, not mobile performance or rendered-browser
proof. Actual built-browser traffic, save/reload and screenshot acceptance remain required
before publication. No timeout releases, actor hiding, teleports or capacity deletion are used
to make the tested cycles finish.
