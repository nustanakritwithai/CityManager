import test from 'node:test';
import assert from 'node:assert/strict';
import { taxiVehiclePoses } from '../src/taxi/vehicle-poses.ts';

test('one yellow pose per authoritative taxi; no extrapolation or input mutation', () => {
  const input = Object.freeze([Object.freeze({ unitId: 'taxi-1-0', x: 3, z: -2, headingX: 0, headingZ: 4 }), Object.freeze({ unitId: 'taxi-1-1', x: 5, z: 1, headingX: -2, headingZ: 0 })]);
  assert.deepEqual(taxiVehiclePoses(input), [
    { vehicleId: 'taxi-1-0', x: 3, z: -2, headingX: 0, headingZ: 1, paint: 0 },
    { vehicleId: 'taxi-1-1', x: 5, z: 1, headingX: -1, headingZ: 0, paint: 0 },
  ]);
  assert.deepEqual(taxiVehiclePoses([]), []);
});

test('rejects duplicate identities and invalid positions or headings', () => {
  const pose = { unitId: 'taxi', x: 0, z: 0, headingX: 1, headingZ: 0 };
  assert.throws(() => taxiVehiclePoses([pose, pose]), /duplicate/);
  assert.throws(() => taxiVehiclePoses([{ ...pose, x: NaN }]), /Invalid taxi road pose/);
  assert.throws(() => taxiVehiclePoses([{ ...pose, headingX: 0 }]), /heading/);
});
