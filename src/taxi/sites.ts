/**
 * Shared taxi site types (one module for D2 buildings and D3 dispatch). This file is byte-identical
 * on feat/taxi-buildings (#117) and feat/taxi-dispatch (#116) so either PR merges first and the other
 * merges cleanly (identical add/add). Edit it in both branches together. Mode-share types stay in
 * types.ts (#115). There are no taxi stands: the depot is the only taxi building.
 */
/** Units per depot level (placeholder). */
export const TAXI_DEPOT_UNITS: Readonly<Record<1 | 2, number>> = Object.freeze({ 1: 4, 2: 8 });
/** Saved depot (City.taxi.depots[]). */
export type TaxiDepot = { id: number; cell: number; tick: number; level: 1 | 2; open: boolean };
/** Optional save envelope; absent = city without taxis. */
export type TaxiState = { version: 1; rules: 'taxi-1'; depots: TaxiDepot[] };
/** What dispatch needs from a depot (a saved TaxiDepot satisfies it). */
export type TaxiDepotSite = Pick<TaxiDepot, 'id' | 'cell' | 'level' | 'open'>;
