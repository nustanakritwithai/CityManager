/** Municipal parks: integer satang, one parcel at every future level.
 * Initial balance values for review. This first slice supports level 1 only;
 * it has no coverage, capacity, staffing or economic bonuses.
 */
export type Park = { id: number; cell: number; tick: number; level: 1 };
export const PARK = Object.freeze({ cost: 100_000, upkeep: 1_000, footprint: 1 });
export const MAX_PARKS = 32;
