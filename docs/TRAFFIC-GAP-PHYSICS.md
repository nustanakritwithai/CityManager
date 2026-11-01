# PR164 integration: bounded bumper-gap traffic

Ported onto main `8744614` (rail and commercial/save work preserved). The road
model remains representative traffic, not individual citizens. No save schema,
financial, rail, bus passenger or authentication contract changes are included.

## Physics and calibration

- Stationary bumper clearance: 0.09 world units; two world units per tile.
- Moving target: 0.09 + speed × 0.12 seconds (shorter than PR164's 0.18).
- Straight maximum: one tile/second; acceleration 2.5 and comfortable braking
  4 world units/second². A newly appearing obstruction still invokes the strict
  no-overlap safety bound, even when that requires stronger braking.
- Turning maximum: 0.6 tile/second near the approach and while clearing the bend.
- Five deterministic following substeps per one-second worker step. Pausing
  advances neither the model nor the following integrator.
- Sedan/SUV length 0.42; decorative car 0.60; truck uses conservative centered
  0.74 bounds (its original mesh is asymmetric). Bus lengths remain 0.78/1.02/1.32.
- Straight storage is at most three per lane/tile. An actual junction or bend
  reserves a 0.25-tile square; its approach may only physically fit two cars.
  Do not pack three bodies into an unsafe corner merely to match the storage cap.

PR164 rerouted a source only when storage was full, ignoring an uncleared entry
bumper gap. Admission now checks both and can use a real available bypass.
Non-collinear two-arm bends also reserve the corridor. Ownership survives worker
boundaries for both incoming and outgoing bodies until the body clears; source
spawns begin beyond the junction square. Tests inspect every actual substep
without filtering/render hiding and assert non-overlap and monotonic progression.

## Presentation boundary

Raw poses expose stable model IDs, speed and final-link endpoint metadata.
The separate stateful presenter owns sticky selection and legal visual admission,
turning and completion transitions. Per-frame omission/teleportation is not an
acceptable fix for collision or the user's reported flashing cars. Model mass
must remain independently conserved, irrespective of the visual cap.

## Acceptance and transient window

Explicit acceleration, turn braking and safe bend occupancy make the former
10-step bypass check a startup transient: both layouts complete five vehicles.
At the same 20-step horizon, the unchanged fixture completes 9 without the bypass
and 14 with it. The longer 120-step comparison is 59 versus 93. The reviewer
accepted a fixed 20-step warmup with the same seed, demand and elapsed time and
strict `after > before`; this is not a relaxed inequality or retuned map.

The broad inherited browser suite is not substituted for focused evidence:
physics, raw junction/corner bodies, worker pause/clone parity, taxis/fares, bus
engine and actual browser lifecycle/save acceptance remain separate checks.

## Bounded CPU evidence

Repeated fallback routing rebuilt all link costs by scanning every actor for
every OD/substep. The integration indexes occupancy once per spawn wave and
updates the touched link after each admission, skipping routing if no source
exit has space. Sixty peak-fixture frames compared byte-for-byte equal to the
unoptimized same-physics reference (combined SHA-256
`d526f4c47a3d9c5d1a9e11c256dee5ca1a89731f8896a3d7c6fcdbb4fae84523`).
One paired Node run measured p95 56 ms versus 372 ms and maximum 68 ms versus
2096 ms. These are executor CPU timings, not phone FPS or a browser performance
waiver. The reference was temporary and is not shipped.
