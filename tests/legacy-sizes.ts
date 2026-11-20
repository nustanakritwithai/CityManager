import type { City } from '../src/sim.ts';
/**
 * Fixture: the city keeps the smaller buildings cities saved before real sizes still use: a house grows to three
 * households and a condo to 32; factories employ 4–12 people and farms one a level. For tests whose subject is not
 * building size but which follow a seeded city's own long-run growth or a level's old capacity: their expected numbers
 * come from that growth path, which real sizes change. Real sizes are tested in housing.test.ts,
 * housing-density.test.ts, building-level-boundaries.test.ts and industry-scale.test.ts.
 */
export function legacySizes<T extends City>(city: T): T { delete city.housingScale; delete city.industryScale; return city; }
