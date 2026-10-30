import test from 'node:test';
import assert from 'node:assert/strict';
import { LANE_SLOTS, LANE_START, LANE_END, SLOT_PITCH, CAR_LENGTH, JUNCTION_HALF, laneSlotCentres, overlappingPairs } from '../src/citizen-road-queue.ts';
test('lane slots keep queue spacing and stay out of junction squares', () => {
  assert.ok(LANE_SLOTS >= 1);
  for (let n = 1; n <= LANE_SLOTS; n++) for (const phase of [0, .3, 1]) {
    const c = laneSlotCentres(n, phase);
    for (let k = 1; k < n; k++) assert.ok(c[k] - c[k - 1] >= SLOT_PITCH - 1e-9);
    assert.ok(c[0] - CAR_LENGTH / 2 >= JUNCTION_HALF - 1e-9 && c.at(-1)! + CAR_LENGTH / 2 <= 1 - JUNCTION_HALF + 1e-9);
  }
  assert.throws(() => laneSlotCentres(LANE_SLOTS + 1, 0));
  assert.deepEqual(laneSlotCentres(1, 1), [LANE_END]); assert.deepEqual(laneSlotCentres(1, 0), [LANE_START]);
});
test('overlap detector finds touching cars', () => {
  const a = { vehicleId: 'a', x: 0, z: 0, headingX: 1, headingZ: 0 };
  assert.equal(overlappingPairs([a, { ...a, vehicleId: 'b', x: .1 }]).length, 1);
  assert.equal(overlappingPairs([a, { ...a, vehicleId: 'b', x: 2 }]).length, 0);
});
