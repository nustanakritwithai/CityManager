import { createCity, serialize, step } from '../src/sim.ts';
import { deserializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';
import { captureEntityExplanation } from '../src/entity-explanation-data.ts';

/** Real legacy-size simulated fixtures and their validated server-loaded cities. */
const load = (raw: string) => expandValidatedParkSession(deserializeParkSession(raw)).city;
export function entityExplanationCity() {
  const source = createCity(61025);
  for (let n = 0; n < 29; n++) step(source);
  const raw = serialize(source);
  return { raw, city: load(raw) };
}
export function entityInsufficientFixture() {
  const young = createCity(61025);
  for (let n = 0; n < 35; n++) {
    const raw = serialize(young), city = load(raw);
    for (const building of city.buildings) {
      const snapshot = captureEntityExplanation(city, { kind: 'building', buildingId: building.id });
      if (snapshot?.missing.length) return { raw, city, building: { ...building }, snapshot };
    }
    step(young);
  }
  throw Error('Actual early-game entity must provide missing evidence');
}
