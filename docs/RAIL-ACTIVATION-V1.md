# Passenger rail V1 — modeled shuttle

This integration selectively carries PR #124's two-terminal rail engine onto main
`ce8227b`. It does not merge the old application/save code wholesale. PR #114 is
already represented by that foundation and must not be merged separately.

## Supported workflow

Open **รถไฟ**, place two stations on empty unzoned parcels beside roads serving
homes and destinations, then draw straight cardinal track sections between them.
Bends use multiple straight sections. The whole proposed section validates before
any reservation changes. Roads, buildings, plants, parks, campuses, bus depots and
taxi depots cannot overlap tracks/stations. No grade crossings exist in V1.
Open the line from management. The clock advances with processed game minutes,
not rendering; global pause and unprocessed frame-budget time create no travel.

The one train has 32 seats, platforms hold 64, boarding/alighting is 8 per game
minute, dwell is 30 minutes and minimum departure interval is 60 minutes.
A track cell takes 120 **game** minutes (not 120 real minutes). At nominal 1x,
1440 game minutes request one second, subject to normal frame pacing. New tracks
are capped at 96 undirected segments. These are prototype game values, not
real transport estimates. Construction and operation are free; there are no
fares, upkeep, treasury transfers, financial effects or upgrades in this version.

## Honest simulation boundary

Shuttle riders are illustrative samples based on nearby current population and
destination density, using connected pedestrian-road access within three edges.
They are not identified citizens or a ledger of real trips. **This version does
not subtract road traffic or claim congestion relief.** Existing taxi/bus/road
allocation is unchanged. A future road-relief integration needs a coherent shared
rate/timestep and ownership contract; a seats/cycle estimate is not that contract.

Each hour of processed game time may admit bounded samples. At most 32 active
batches and 128 unresolved modeled passengers are retained. Completed batches
are summarized in cumulative counters with a monotonic sequence fence; active
outside/platform/onboard/egress passengers are never pruned. Closed stations and
paused service retain their queues. **Stop new intake** leaves service operating
until existing passengers finish; only then can the idle service be removed.
Reconfiguration retains the counters and sequence fence.

## Save and compatibility

`ParkRuntime.rail` is optional and remains in the same v25 server save payload as
city and park clocks. Capture binds the rail record to the exact core revision.
Load verifies the original core envelope before normalized/migrated city state
is used. No separate storage, browser-save revival, auth/session change, market
policy change or server migration is introduced. Old sessions without rail keep
identical absence semantics. Existing PR #124 model-absent foundation sessions
retain their original queues and are not silently reset into modeled service.

Validation rejects altered bindings, unsupported policies, invalid counters,
wrong clocks, incompatible parcels and oversized modeled queues. Bounds do not
constitute anti-cheat authentication of client save data.

## Verification scope

Focused tests cover passenger phases, clock batching, pause/closure, intake drain,
queue retirement/replay fence, atomic track construction, mutual parcel guards,
v25 exact save/resume, malformed save rejection, unchanged city accounting and
unchanged road input. Existing server-save ACK tests remain mandatory. UI/touch
and browser ACK/reload evidence must be checked against the final integrated
commit before release. Historical PR #124 preview screenshots are not acceptance
of this application. No claim of physical-phone FPS is made by Node tests.
