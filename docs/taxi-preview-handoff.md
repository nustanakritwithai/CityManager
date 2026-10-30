# Taxi drawing preparation and integration boundary

This branch combines the D1–D3 foundations and prepares a yellow instanced taxi renderer. It is not a playable taxi implementation. The renderer is deliberately not wired to the timer-based D3 snapshots or the visual-only traffic fleet: neither is an authoritative record of road occupancy. It has no effect on the game until the shared traffic bridge is installed and a host supplies real poses. Taxi remains off by default; the foundation's `?taxi=1` is a development opt-in.

## Bridge needed before runtime integration

The traffic owner is implementing the shared bridge. The following are required capabilities, not a claim that these exact TypeScript signatures have been agreed or installed:

* An atomic reserve operation scoped to city, revision, epoch and stable request/lease ID, granting only never-admitted private-road waiting passengers; a cumulative, idempotent release of unboarded passengers and completion after service. Reject stale or duplicate effects and enforce completed + released ≤ reserved.
* Submit a stable taxi unit/move ID and route to the road engine as one vehicle independent of passenger occupancy, including empty cruising, pickup and return. Admission and completion receipts must be cumulative and distinguish admission from actual arrival. Completion of a taxi vehicle must not complete a private-car passenger journey.
* Obtain authoritative occupied road positions with unit ID, world position and nonzero heading for `SceneTaxiVehicles.sync`, or an agreed conversion from the bridge's position format. The caller must exclude taxi IDs from any other vehicle renderer. Synchronize on a coherent city/revision/epoch and clear the view on replacement or reset.
* Provide road-edit invalidation, blocked and resumed move status, and completion events at actual execution time. Keep boarded passengers owned through blockages. Dispatch readiness must react at actual arrivals and the end of the one-minute dwell, independent of five-minute demand batches.
* Expose actual traversed empty and occupied distance/time, once per move, for future cost accounting. No money is charged by this preparation. The 0.50 + 0.20/km + 0.05/min shadow fare remains unapproved. Proposed balance work: calibrate costs and fares against wage, fleet utilization and congestion scenarios, then approve a separate economy change with journal and conservation tests.

Conservation gate: offered = private waiting + private active + private completed + taxi pending + taxi completed + rail pending + rail completed. Release moves only unboarded people back to private waiting, never to both modes. Verify receipts for empty and loaded vehicle capacity separately from passenger accounting.

The test suite and build do not prove browser rendering, runtime integration, road capacity, economy, large-city performance, or save compatibility of an integrated system. Those remain release gates, along with the existing #117 browser CI failures and the shared bridge contract.
