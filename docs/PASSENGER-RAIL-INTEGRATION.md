# Passenger railway application integration (gated)

This branch reuses the foundation in PR #114 and the tested preview checkpoint
`218f9e6fe5c5b84d12cbd49cb0077d6fa3c4eb37`. It incorporates main
`5b56018659f0cb95cd04aa984994e6218ede5dd7` (PR #118 and the merged PR #104).
It is still a draft: authoritative traffic ownership and approved service policy
are missing. No passenger service is enabled by default and no road relief is claimed.

## Completed application work

- `RailNetworkRuntime` owns zero/two station sites, explicit track links and an
  optional two-terminal shuttle backed by the existing `PassengerRail` engine.
  Queue/seat bounds, first/last mile, boarding/alighting, closures and graceful
  pause retain the original conservation rules. No renderer advances simulation.
- Track edits under moving/occupied trains fail. Removing a line with retained
  journeys requires an authoritative retirement receipt that is not implemented.
  Walking limits, walking speed, track durations and service capacity must be
  explicitly supplied; no fixture tuning is selected as production policy.
- All central city construction entry points refuse reserved rail parcels before
  mutation or spending. Claims are held in a City-keyed WeakMap, rebuilt from a
  validated session, and are never inserted into serialized core City fields.
  Capture/restore also reject an existing overlap. This does not change road
  connectivity, capacity, admission or the PR6 road model.
- Main hosts `installRailManagement` and the existing renderer. The toolbar uses
  the existing popup pattern. Management shows real waiting, occupancy and
  completion state, supports closures/service pause and confirmed removal, and
  can explicitly plan stations. Fresh pointer/key presses are required to accept
  map confirmation; cancellation, pan, interrupted touches, blur, resize and city
  replacement discard stale gestures. An unconfigured line renders no train.
- New track construction, opening a new service and asset upgrades stay disabled
  until policy is supplied. No fares, upkeep, treasury transfers or new money.
  `VITE_PASSENGER_RAIL=true` exposes planning controls for isolated tests; it is
  OFF by default. A loaded rail record is retained and rendered independently of
  this creation gate. There is no synthetic-demand button in the game UI.

## Atomic persistence and time

`ParkRuntime.rail` is optional. Old sessions remain absent and byte-equivalent;
load and ordinary rendering do not generate an identity or empty railway.
An explicitly configured railway receives its own city ID and epoch; Guest and
market city IDs are preserved. The rail record is stored inside the same existing
city/park payload and uses all existing startup, save, export, quota, generation,
cross-tab and immutable-backup paths. There is no new storage slot or loose sidecar.

The binding includes city ID, epoch, monotonic rail revision, and SHA-256 of the
exact serialized core-city revision (root key order canonicalized only). This
avoids duplicating the large city save. It detects mismatched components; it is
not authentication. Full graph, train, queue, lease, receipt and clock validation
runs before a restored city is accepted. Errors do not reset or discard passengers.

Rail advances at actual processed park-clock boundaries, before synchronous
`afterDay` callbacks can render/save. Global pause earns no time. Frame-budget
stops consume no unprocessed time. Clock revisions advance by elapsed whole
minutes, so one-minute and batched playback serialize identically, including
midnight. The economy remains one game day per real second at 1x.

PR118's optional durable-reader hook is preserved. The app supplies a validated
session-to-core projection before financial receipt equality checks; invalid rail
state, a different market city or a different Guest still rejects the ACK before
network or journal mutation. `market-client.ts` is unchanged by rail work.

## Traffic owner dependency (not implemented here)

The PR6 owner retains road capacity, request generation, admission and completion.
Their current OD aggregate loses request identity and does not yet provide the
committed mode bridge. `acceptPreparedDemand` is a foundation/testing adapter;
main never calls it. Its candidate state is validated before installation and
identical retries do not change state. It does not make road reservations.

The authoritative bridge must provide these operations with agreed signatures:

1. Enumerate never-admitted private-road waiting requests with stable request ID,
   origin/destination, integer person count, accepted city/revision and epoch.
2. Atomically reserve a bounded person count for a mode, returning a stable lease
   ID and exclusive ownership. The transaction must commit the bridge snapshot
   and rail acceptance together; already admitted private trips cannot be claimed.
3. Release only unboarded persons once, under a cumulative released counter. Rail
   currently conservatively retains closed/disconnected queues; it never invents
   a release or moves occupied passengers to a new mode.
4. Acknowledge cumulative actual completions after egress, idempotently by
   city/epoch/request/lease. Road admission is not completed travel. Reject stale
   IDs and ensure completed + released <= reserved.
5. Validate/restore the full shared ownership snapshot atomically with rail and
   the same city revision; retain private waiting/active/completed and mode
   pending/completed conservation. No percentage demand subtraction is permitted.

The existing `ModalDemand`/`RailServiceReceipt` types are proposed preparation
contracts, not newly installed PR6 APIs. Do not activate this branch by wiring
aggregate demand to them. Freight, inventory, instant trade and market settlement
remain outside this passenger phase.

## Verification and release boundaries

Focused runtime, rail, save/Guest/backup/quota, market receipt and traffic-clock
checks run with synthetic saves only. Detailed current command results are in
`.test-output/rail-verification/`; browser evidence is generated by
`tests/rail-host-smoke.mjs`. The existing preview evidence remains in
`docs/rail-preview/` and describes checkpoint 218f9e6 only.

Run `npm run build`, `npm run test:rail` and the relevant save/market tests.
The host smoke suite expects an isolated feature-enabled, market-disabled build
at `http://127.0.0.1:4183/CityManager/`; it launches its own Edge profile. This does
not establish physical Android, FPS/load, live traffic or deployment acceptance.

Release owner alone merges/deploys. The shared traffic bridge, production policy
and freight remain outstanding; this branch is not a completed rail release.

Final checkpoint verification (2026-10-30): 137 focused tests passed; final
TypeScript and production build passed. Edge 156.0.4314.50 passed both 390x844
and 844x390 touch flows with zero console errors. This includes exact atomic
save/reload and Guest identity, occupied edit refusal, fresh confirmation,
Escape/resize/pan/touch cancellation, repeated menus, idle infrastructure
management and no ghost train. Native touch exposed Escape bubbling into the
main tool handler; the dialog now consumes that event. Summary is committed in
`docs/rail-app-validation.json`; screenshots remain local synthetic QA artifacts.
