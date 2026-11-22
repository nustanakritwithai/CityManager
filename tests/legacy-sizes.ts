import { createCity, type City } from '../src/sim.ts';
/**
 * Fixture: the city keeps the smaller buildings cities saved before real sizes still use: a house grows to three
 * households and a condo to 32; factories employ 4–12 people, farms one a level, and rice is sold in baskets. For tests whose subject is not
 * building size but which follow a seeded city's own long-run growth or a level's old capacity: their expected numbers
 * come from that growth path, which real sizes change. Real sizes are tested in housing.test.ts,
 * housing-density.test.ts, building-level-boundaries.test.ts and real-rice.test.ts.
 */
export function legacySizes<T extends City>(city: T): T { delete city.housingScale; delete city.industryScale; delete city.wageScale; return city; }
/** Fixture: real homes, old workplaces (factories of 4–12 people, farms one a level, no kilo-priced rice, the old wages). */
export function legacyIndustry<T extends City>(city: T): T { delete city.industryScale; delete city.wageScale; return city; }
/** `createCity` for a test file whose cities all keep the old smaller buildings (see legacySizes). */
export function createLegacyCity(...args: Parameters<typeof createCity>): City { return legacySizes(createCity(...args)); }
