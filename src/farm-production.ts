/** Soil remains historical map data. Future farm output is identical on every parcel. */
export const FARM_YIELD_PER_WORKER = 24;
type FarmProductionCity = { farmSoilIndependentStartTick?: number; tick: number; resources: { fertility: number[] } };
/** Explicit event tick keeps pre-migration harvest journals valid without rewriting history. */
export function farmProductionFertility(city: FarmProductionCity, cell: number, tick = city.tick): number {
  return city.farmSoilIndependentStartTick !== undefined && tick > city.farmSoilIndependentStartTick
    ? 100 : Math.max(50, city.resources.fertility[cell]);
}
/** Forecasts are for the next harvest, not the already-settled migration day. */
export function farmYieldPerWorker(city: FarmProductionCity, cell: number): number {
  return Math.floor(FARM_YIELD_PER_WORKER * farmProductionFertility(city, cell, city.tick + 1) / 100);
}
