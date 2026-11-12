import type { CityGoals, SideMission } from './city-goals.ts';
import type { CityChallenge } from './city-challenges.ts';
import type { PopulationGuidance } from './population-guidance.ts';
import type { City } from './sim.ts';

/** Include displayed projections so same-tick edits cannot leave the dashboard stale. */
export function overviewRevision(city: City, goals: CityGoals, missions: readonly SideMission[], challenges: readonly CityChallenge[], population: PopulationGuidance | null): string {
  return JSON.stringify([city.tick, city.ledger.length, city.cropLedger.length, city.goodsLedger.length, goals,
    missions.map(m => m.current), challenges.map(c => c.current), population]);
}
