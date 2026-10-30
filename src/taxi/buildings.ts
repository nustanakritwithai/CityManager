/**
 * Taxi depots (phase D2, taxi-design.th.md). No taxi stands: taxis roam and pick up on their own; the
 * depot is only their spawn point and home base. Pure data + validation; no sim.ts import so
 * sim.ts can depend on it without a cycle. Round 1 is economy-neutral: COST/UPKEEP are placeholders
 * and are never charged. Stored only in the optional `city.taxi` save section.
 */
export const TAXI_ENABLED = false;
export const TAXI_STORAGE_KEY = 'citymanager.taxi';
/** Feature flag with a dev override: `?taxi=1` (remembered) / `?taxi=0`. */
export function taxiEnabled(search = globalThis.location?.search ?? '', storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): boolean {
  const q = new URLSearchParams(search).get('taxi');
  try { if (q === '1') storage?.setItem(TAXI_STORAGE_KEY, '1'); if (q === '0') storage?.removeItem(TAXI_STORAGE_KEY); } catch { /* private mode */ }
  if (q === '1') return true; if (q === '0') return false;
  try { if (storage?.getItem(TAXI_STORAGE_KEY) === '1') return true; } catch { /* ignore */ }
  return TAXI_ENABLED;
}
export const TAXI_DEPOT = Object.freeze({ footprint: 1, units: Object.freeze({ 1: 4, 2: 8 }) as Readonly<Record<1 | 2, number>>, cost: 250_000, upgrade: 200_000, upkeep: 6_000 });
export const MAX_TAXI_DEPOTS = 4;
export type TaxiDepot = { id: number; cell: number; tick: number; level: 1 | 2; open: boolean };
export type TaxiState = { version: 1; rules: 'taxi-1'; depots: TaxiDepot[] };
export const createTaxi = (): TaxiState => ({ version: 1, rules: 'taxi-1', depots: [] });
type Host = { taxi?: TaxiState };
export const taxiDepotAt = (c: Host, i: number) => c.taxi?.depots.find(d => d.cell === i);
export const taxiAt = (c: Host, i: number): TaxiDepot | undefined => taxiDepotAt(c, i);
export const taxiUnits = (d: TaxiDepot) => d.open ? TAXI_DEPOT.units[d.level] : 0;

/** Facts the validator needs from the city, supplied by sim.ts (keeps this module City-free). */
export type TaxiValidationView = {
  cells: readonly { road: boolean; zone: unknown; building: number | null }[];
  tick: number; nextId: number;
  /** Cells and ids already held by parks, plants and campuses. */
  otherCells: ReadonlySet<number>; otherIds: ReadonlySet<number>;
};
/** Throws on any malformed or conflicting taxi section. Runs only when `taxi` is present. */
export function validateTaxi(value: unknown, view: TaxiValidationView): asserts value is TaxiState {
  const fail = (why: string): never => { throw new Error(`Invalid taxi save: ${why}`); };
  const t = value as TaxiState;
  if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).sort().join(',') !== 'depots,rules,version' || t.version !== 1 || t.rules !== 'taxi-1' || !Array.isArray(t.depots)) fail('envelope');
  if (t.depots.length > MAX_TAXI_DEPOTS) fail('too many depots');
  const ids = new Set<number>(), cells = new Set<number>();
  const site = (s: TaxiDepot, keys: string) => {
    if (!s || typeof s !== 'object' || Object.keys(s).sort().join(',') !== keys) fail('site fields');
    if (!Number.isSafeInteger(s.id) || s.id < 1 || s.id >= view.nextId || ids.has(s.id) || view.otherIds.has(s.id)) fail('site id');
    if (!Number.isSafeInteger(s.cell) || s.cell < 0 || s.cell >= view.cells.length || cells.has(s.cell) || view.otherCells.has(s.cell)) fail('site cell');
    const cell = view.cells[s.cell];
    if (cell.road || cell.zone !== null || cell.building !== null) fail('site overlaps road, zone or building');
    if (!Number.isSafeInteger(s.tick) || s.tick < 0 || s.tick > view.tick || typeof s.open !== 'boolean') fail('site state');
    ids.add(s.id); cells.add(s.cell);
  };
  for (const d of t.depots) { site(d, 'cell,id,level,open,tick'); if (d.level !== 1 && d.level !== 2) fail('depot level'); }
}
