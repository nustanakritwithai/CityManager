# Canonical road and mode-ownership bridge

`src/traffic/bridge.ts` now exports the local, tested integration boundary below.
It is a pure module, not yet wired to `main.ts`, the renderer, taxi/rail engines or
player saves. Use **one TrafficBridge for the accepted city session**. Separate
bridges per mode or per OD would fabricate independent road capacity.

## Exported signatures

```ts
type TrafficScope = { cityId: string; revisionId: string; epoch: string };
type PassengerOffer = {
  scope: TrafficScope; requestId: string; purpose: 'commute' | 'school' | 'park';
  from: number; to: number; persons: number;
};
type ModeLeaseRequest = {
  scope: TrafficScope; requestId: string; leaseId: string;
  mode: 'taxi' | 'rail'; persons: number;
};
type ModeServiceReceipt = {
  scope: TrafficScope; leaseId: string;
  boardedPersons: number; releasedPersons: number; completedPersons: number;
};
type TaxiRegistration = { scope: TrafficScope; unitId: string; cell: number };
type TaxiRoadMove = {
  scope: TrafficScope; moveId: string; unitId: string; from: number; to: number;
  carriedPersons: number; leaseId?: string;
};
type FreightOffer = {
  scope: TrafficScope; requestId: string; from: number; to: number;
  vehicleUnits: number;
};

class TrafficBridge {
  constructor(scope: TrafficScope, startMinute?: number);
  offerPassenger(command: PassengerOffer): PassengerReceipt;
  reserveMode(command: ModeLeaseRequest): ModeLeaseReceipt;
  acknowledgeMode(command: ModeServiceReceipt): ModeLeaseReceipt;
  registerTaxi(command: TaxiRegistration): void;
  requestTaxiMove(net: LinkNetwork, command: TaxiRoadMove): RoadAdmissionReceipt;
  offerFreight(command: FreightOffer): RoadAdmissionReceipt;
  advanceTo(scope: TrafficScope, net: LinkNetwork, minute: number, paused?: boolean):
    { minute: number; observedMinute: number; pendingMinutes: number };
  roadEdited(scope: TrafficScope, net: LinkNetwork): void;
  passengerReceipt(scope: TrafficScope, requestId: string): PassengerReceipt;
  modeReceipt(scope: TrafficScope, leaseId: string): ModeLeaseReceipt;
  roadReceipt(scope: TrafficScope, moveId: string): RoadAdmissionReceipt;
  freightReceipt(scope: TrafficScope, requestId: string): RoadAdmissionReceipt;
  renewEpoch(scope: TrafficScope, nextEpoch: string): TrafficScope;
  exportState(): TrafficBridgeState;
  static restore(scope: TrafficScope, value: unknown): TrafficBridge;
}
```

The return types and `TrafficBridgeState` are also exported from `bridge.ts`.
`RoadAdmissionReceipt` contains scope/move ID and cumulative `offeredVehicleUnits`,
`admittedVehicleUnits`, `completedVehicleUnits`, current `waitingVehicleUnits`,
`activeVehicleUnits` and `arrived`. Admission is not arrival. `arrived` becomes true
only when the entire move's representative load has completed actual flow traversal.

`PassengerReceipt` includes offered persons, private waiting/admitted/active/completed,
taxi pending/completed, rail pending/completed, and `conservationError`. Private
admitted is cumulative and includes private completed: do not sum them together.
`ModeLeaseReceipt` includes the immutable grant and cumulative boarded/released/
completed counters plus current pending persons.

## Call order and ownership

1. The session owner supplies a validated accepted-city binding and canonical game
   minute. The bridge does not create an identity or read player storage. Submit
   stable, whole-person offers once; a matching duplicate is a no-op, changed payloads
   under the same ID reject. Freight has its own vehicle-only offers and is ineligible
   for passenger leases.
2. Reserve from never-admitted private waiting. The bridge atomically transfers those
   units out of road eligibility before returning the mode grant. After road admission
   that portion is unavailable. Mode workers never subtract from active road mass.
3. Mode workers report cumulative boarding/release/completion. Completed must not
   exceed boarded; boarded plus released must not exceed the grant. Old receipts merge
   monotonically; contradictory merges reject before mutation. An unboarded release
   creates private waiting exactly once. Boarded/stranded passengers cannot time out
   back into a second private journey.
4. The taxi owner registers each unit once at its initial road cell. Submit every
   empty/full **complete leg** with a stable move ID. All taxi legs consume one
   representative vehicle unit, including partial occupancy and zero occupants.
   Loaded legs must reference a boarded taxi lease and its actual origin/destination
   frontage. A unit cannot start another leg until its previous road receipt arrives;
   the next leg must start where that previous leg ended.
5. Advance this shared bridge with the existing absolute game minute. It processes at
   most 1,440 minutes per call and retains excess elapsed time. Drain pending catch-up
   before issuing new commands; never apply today's mode choices retrospectively to
   pending time. Pausing produces no admission or movement.
6. Taxi drop-off completion is bounded by completed loaded-road receipts for that
   lease; partial vehicle admission/completion is not a completed passenger trip.
   Rail completion remains the rail worker's actual alighting/egress receipt. Neither
   mode gets a capacity discount merely because it was selected.

The passenger invariant is offered = private waiting + private active + private
completed + taxi pending + taxi completed + rail pending + rail completed.
Blocked demand remains in those terms. Taxi/freight load lives in the separate road
ledger. Its explicit `transferred` total records mode handoffs, not completed travel.
Road `offered` is cumulative load submissions, including a new road submission when
a mode releases passengers. It is not a count of unique passenger trips. City demand
and completion reporting must use the passenger ledger; never add taxi vehicle
completion or returned road submissions to offered/completed passenger totals.

## Restore and integration limits

The flow codec is version 2 and accepts structurally valid legacy version-1 untracked
flow snapshots. Request IDs/counters remain after completion so retries cannot replay
load. `TrafficBridge.restore` validates exact fields, scope, clocks, mode transfers,
road request identities, taxi location chains, assigned riders and completion limits
on a new instance before returning it. It never substitutes an empty bridge on error.

After the host has accepted the matching city/revision, `renewEpoch` can invalidate
old asynchronous callbacks while retaining queues/IDs. It cannot change city or
revision. Production integration must still use existing save-generation/conflict
guards and atomically restore **all** participating mode state with this bridge.
Pure codec validation is not that production integration.

The existing taxi worker's autonomous estimated-time movement and mutable `legs[]`
are not execution receipts. It must gate its movement/drop-off against this bridge.
Mid-leg taxi interruption/cancellation and continuous per-unit poses are not provided
by this first boundary. Flow remains an aggregate representative model and may admit
fractions of a unit; one complete taxi leg is acknowledged only after all its mass
arrives. Do not portray partial receipts as a physical taxi arrival or implement a
second independent movement authority. New day-boundary demand generation, renderer
connection, save installation, road-width tools and congestion UI remain separate work.

## Local verification

2026-10-30: 15 focused bridge/request-receipt tests passed; all 97 traffic tests
passed; TypeScript and Vite production build passed with the existing large-chunk
warning. The existing save implementation is untouched; its 63-test regression
belongs to the preceding core checkpoint and was not rerun for this pure bridge.
No browser, complete runtime, taxi-engine integration or rail-engine integration
playtest is claimed. The new bridge source is separate from published core PR120.
