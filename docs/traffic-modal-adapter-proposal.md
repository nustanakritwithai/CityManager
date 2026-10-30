# Proposed traffic boundary for taxi and rail

Status: integration proposal, not an exported or installed PR6 API. No worker should
connect a live mode to aggregate traffic until identity and receipts below are in place.

## Verified existing exports

- PR6 core has `OdDemand { from, to, vehicles }`, `TrafficFlow.advancePeriod`,
  `snapshot`, `diagnostics`, and `renderGroups`. Waiting traffic merges by OD and loses
  request/purpose identity. It cannot yet issue per-request admission/completion receipts.
- Rail [PR114, 0d78e45](https://github.com/nustanakritwithai/CityManager/blob/0d78e45b519aa1c915b543f191ecab1abb519871/src/rail/demand-contract.ts)
  exports `ModalDemand`, `RailLease`, `RailServiceReceipt`, `reserveRailDemand`,
  `admitRoadDemand`, and `acknowledgeRailService`. Rail completion is cumulative and
  idempotent; road admission is an increment. `roadAdmittedPersons` is a handoff,
  not a completed journey. Its summary is not the whole-system completion ledger.
- Taxi [PR116, 9298e2a](https://github.com/nustanakritwithai/CityManager/blob/9298e2a174a2304a509afd1fccd5e15aea7a561f/src/taxi/dispatch.ts)
  exports `TaxiLeaseAdapter.reserve(requestId, persons)`, `release(requestId, persons)`,
  and `complete(requestId, completedPersons)` (the last is cumulative). `RoadLeg` has
  unit/from/to/loaded/minute/path, but no stable move ID. Planned legs are mutable;
  they are not an executed road ledger. The default no-op lease adapter is not a
  production ownership boundary.

## Minimal proposed contract

Keep person ownership separate from physical road vehicle load. Introduce stable
offer/request identity before OD aggregation, retaining purpose and excluding freight
from passenger-mode reservations. Reuse the rail lease pattern, adding a mode tag and
explicit release rather than a new independent demand generator.

```ts
// Proposed names/fields, NOT presently exported. The save owner must supply the
// binding token; workers must not invent their own city/revision identity.
type DemandScope = {
  cityId: string;
  revisionId: string;
  epoch: string;
};
type ModeLease = {
  scope: DemandScope;
  requestId: string;
  leaseId: string;
  mode: 'taxi' | 'rail';
  from: number;
  to: number;
  reservedPersons: number;
};
type ModeReceipt = {
  scope: DemandScope;
  requestId: string;
  leaseId: string;
  releasedPersons: number; // cumulative
  completedPersons: number; // cumulative
};
type RoadMove = {
  scope: DemandScope;
  moveId: string;
  unitId: string;
  from: number;
  to: number;
  vehicleUnits: 1;
  carriedPersons: number;
  leaseId?: string;
};
type RoadMoveReceipt = {
  scope: DemandScope;
  moveId: string;
  admittedVehicleUnits: number; // cumulative; a move may enter progressively
  completedVehicleUnits: number; // cumulative; arrival only once all units arrive
};
```

- Reserve atomically from **never-admitted private-road waiting** only; the grant
  removes those persons from road eligibility before the mode queues them. Reserving
  the same ID/count is idempotent; a mismatched ID payload is an error. A mode cannot
  subtract already-admitted traffic or fabricate a new passenger offer.
- Receipts match scope, request, lease and endpoints of the grant. Validate cumulative
  `completed + released <= reserved`; merge counters monotonically, rejecting a
  merged overdraw. Repeated or older receipts do not add trips. Persist processed IDs,
  including completed grants. Ignore stale epochs; do not replay across another city
  or a competing revision. Successful restore must explicitly rebind a saved ledger
  to the accepted generation before accepting new receipts.
- Release only persons who have not boarded. A waiting taxi timeout may release its
  lease back to private waiting exactly once. Blocked/onboard journeys retain their
  mode ownership and position. Rail completion means alighting/egress is finished;
  taxi completion means authoritative loaded-road arrival and drop-off are finished.
- Private road admission and private road completion are distinct receipts. A taxi
  road arrival completes vehicle movement, not a second private passenger journey.
  The passenger invariant is `offered = privateWaiting + privateActive +
  privateCompleted + taxiPending + taxiCompleted + railPending + railCompleted`.
  Unreachable persons remain in the appropriate waiting/active/pending term.
- Proposed tuning convention: one taxi unit consumes **one representative vehicle
  load unit** whether empty, partly loaded, or full (the current taxi has ten seats).
  Passenger occupancy is separate; no division by occupancy and no zero-load empty
  taxis. This is a gameplay unit, not a claim about real car counts. Empty repositioning,
  pickup approach, loaded travel and return all share private-road link storage,
  admission, junction and exit capacity. Rail trains themselves do not use road load.
- The road engine chooses/revalidates legal routes and emits receipts from actual
  conserved traversal. Taxi estimated timers and mutable planned `legs` must not
  advance a taxi through blocked capacity or authorize completion. Stable `moveId`
  and receipt-driven movement are required additions to the current taxi boundary.

Next ownership: traffic owns admission/traversal receipts and stable offer identity;
taxi owns dispatch/boarding/drop-off and the wrapper around its existing adapter;
rail owns its existing reservations and service receipts. The parent coordinates the
shared scope token with the save owner. This proposal adds no automatic transit
discount, no capacity credit for mode shares, and no bus/rail implementation here.
