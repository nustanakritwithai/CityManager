import { buildPark, deserialize, serialize, step, type City } from '../src/sim.ts';
import { populationFixture } from './population-capacity-fixture.ts';

/** Synthetic capacity fixture. Explicit outside capital/utilities are not natural growth. */
export function parkPopulationFixture(families = 1366): City {
  const city = populationFixture(families, true, false);
  const built = city.cells.some((cell, index) => !cell.road && !cell.building && buildPark(city, index).ok);
  if (!built) throw new Error('Large population fixture needs a real park');
  step(city); // Real municipal allocation staffs the park before recreation begins.
  return deserialize(serialize(city));
}
