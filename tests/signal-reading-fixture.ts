import { createCity, serialize, step } from '../src/sim.ts';
import { deserializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';

/** Save the legacy-size city, and derive the exact city exposed after server load. */
export function signalReadingFixture() {
  const source = createCity(61025);
  for (let day = 0; day < 65; day++) step(source);
  const sourceRaw = serialize(source);
  const fixture = expandValidatedParkSession(deserializeParkSession(sourceRaw)).city;
  return { sourceRaw, fixture };
}
