import type { City } from '../src/sim.ts';
/**
 * Fixture: the city keeps the smaller homes cities saved before real building sizes still use (a house grows to three
 * households, a condo to 32). For tests whose subject is not housing but which follow the seeded starter city's own
 * long-run growth: their expected numbers come from that growth path, which real sizes change (a house holds one
 * household and becomes a 40-room block only with a school and people waiting for homes). Real sizes are tested in
 * housing.test.ts, housing-density.test.ts and building-level-boundaries.test.ts.
 */
export function legacyHousing<T extends City>(city: T): T { delete city.housingScale; return city; }
