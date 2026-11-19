import { commutesToday } from '../src/commute.ts';
import type { City } from '../src/sim.ts';
/**
 * Fixture: every household with someone walking a long way to work owns a motorcycle, as its savings would buy
 * one in time. Traffic shows only households' own vehicles, so a browser check that needs moving cars sets
 * them up here instead of waiting months of game time for purchases.
 */
export function withCommuterVehicles(city: City): City {
  const owners = [...new Set(commutesToday(city).filter(t => t.mode === 'walk-long').map(t => t.householdId))].sort((a, b) => a - b);
  if (!owners.length) return city;
  const start = city.vehicles?.nextId ?? 1, fleet = [...(city.vehicles?.fleet ?? [])].filter(v => !owners.includes(v.householdId));
  owners.forEach((householdId, k) => fleet.push({ id: start + k, householdId, kind: 'motorcycle', bought: city.tick, fuelMl: 4_000, odometerM: 0 }));
  city.vehicles = { version: 1, nextId: start + owners.length, fleet };
  return city;
}
