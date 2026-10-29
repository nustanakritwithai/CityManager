import test from 'node:test';
import assert from 'node:assert/strict';
import { writeVehicleMatrix, type CitizenVehiclePose } from '../src/citizen-vehicle-poses.ts';
test('all 2000 car transforms are written without shortening the visible array', () => {
  const a = new Float32Array(2000 * 16);
  for (let i = 0; i < 2000; i++) { const pose: CitizenVehiclePose = { vehicleId: String(i), x: i, z: -i, headingX: 1, headingZ: 0, paint: i % 6 }; writeVehicleMatrix(a, i * 16, pose); }
  assert.equal(a[1999 * 16 + 12], 1999); assert.equal(a[1999 * 16 + 14], -1999); assert.equal(a[1999 * 16 + 15], 1);
  assert.equal(a[8], 1); assert.equal(a[2], -1);
});
