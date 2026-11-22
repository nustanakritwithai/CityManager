import { createCity, type City } from '../src/sim.ts';
/**
 * Fixture: the city keeps the smaller buildings cities saved before real sizes still use: a house grows to three
 * households and a condo to 32; factories employ 4–12 people, farms one a level, and rice is sold in baskets. For tests whose subject is not
 * building size but which follow a seeded city's own long-run growth or a level's old capacity: their expected numbers
 * come from that growth path, which real sizes change. Real sizes are tested in housing.test.ts,
 * housing-density.test.ts, building-level-boundaries.test.ts and real-rice.test.ts.
 */
export function legacySizes<T extends City>(city: T): T { delete city.housingScale; delete city.industryScale; delete city.wageScale; delete city.priceScale; return city; }
/** Fixture: real homes, old workplaces (factories of 4–12 people, farms one a level, no kilo-priced rice, the old wages). */
export function legacyIndustry<T extends City>(city: T): T { delete city.industryScale; delete city.wageScale; delete city.priceScale; return city; }
/** `createCity` for a test file whose cities all keep the old smaller buildings (see legacySizes). */
/** Fixture: the old wages for firms, venues, park keepers and teachers, and no central-government teacher pay subsidy. For
 * tests of how payroll is reserved, paid and taxed, whose expected sums were worked out at the old rates. Real wages are
 * tested in real-costs.test.ts and real-service-wages.test.ts. */
export function legacyWages<T extends City>(city: T): T { delete city.wageScale; return city; }
/** Fixture: the old prices for fuel, vehicles, bus rides and taxis. For tests of how travel is paid whose expected sums
 * were worked out at the old prices. Real prices are tested in real-prices.test.ts. */
export function legacyPrices<T extends City>(city: T): T { delete city.priceScale; return city; }
export function createLegacyCity(...args: Parameters<typeof createCity>): City { return legacySizes(createCity(...args)); }
