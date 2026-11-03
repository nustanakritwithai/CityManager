import { serialize, type City } from '../src/sim.ts';
import { deserializeParkSession, expandValidatedParkSession } from '../src/park-runtime.ts';

/** Server entry validates the acknowledged bytes, then expands the old map in memory. */
export function questionEntryCity(city: City): City {
  return expandValidatedParkSession(deserializeParkSession(serialize(city))).city;
}
