/**
 * Road classes: every road parcel is a local street unless the player upgrades it. A class sets the lanes each
 * way, the speed limit and so the capacity real trips will use, plus what the parcel costs to upgrade and to
 * keep up. Stored only in the optional `city.roadClasses` section, so a city that never upgrades a road saves
 * byte-identically.
 */
export const ROAD_CLASS_KINDS = ['local', 'collector', 'arterial'] as const;
export type RoadClass = typeof ROAD_CLASS_KINDS[number];
export type UpgradedRoadClass = Exclude<RoadClass, 'local'>;
export type RoadClassSpec = {
  label: string;
  /** Lanes in each direction. */
  lanes: number;
  /** Speed limit, km/h. */
  speedKmh: number;
  /** Vehicles per lane per hour at free flow (a planning figure; real trips decide the actual flow). */
  laneCapacityPerHour: number;
  /** Satang to raise one parcel from a local street to this class (paid once; lowering is free). */
  upgradeCost: number;
  /** Satang a day to keep one parcel of this class. */
  dailyUpkeep: number;
};
export const ROAD_CLASS: Readonly<Record<RoadClass, RoadClassSpec>> = Object.freeze({
  local: { label: 'ซอย', lanes: 1, speedKmh: 30, laneCapacityPerHour: 600, upgradeCost: 0, dailyUpkeep: 10 },
  collector: { label: 'ถนนรอง', lanes: 1, speedKmh: 50, laneCapacityPerHour: 900, upgradeCost: 4_000, dailyUpkeep: 20 },
  arterial: { label: 'ถนนหลัก', lanes: 2, speedKmh: 60, laneCapacityPerHour: 1_000, upgradeCost: 10_000, dailyUpkeep: 40 },
});
export type RoadClassState = { version: 1; cells: Record<string, UpgradedRoadClass> };
type Host = { roadClasses?: RoadClassState; cells: readonly { road: boolean }[] };

export const roadClassAt = (c: Pick<Host, 'roadClasses'>, cell: number): RoadClass => c.roadClasses?.cells[cell] ?? 'local';
/** Satang to move one parcel from `from` to `to`: the difference when raising, nothing when lowering. */
export const roadClassUpgradeCost = (from: RoadClass, to: RoadClass) => Math.max(0, ROAD_CLASS[to].upgradeCost - ROAD_CLASS[from].upgradeCost);
export const roadUpgradeReason = (cell: number, to: UpgradedRoadClass) => `Upgrade road cell @${cell} to ${to}`;
/** Daily upkeep of every road parcel by its class. */
export function roadUpkeep(c: Host): number {
  let total = 0;
  c.cells.forEach((cell, i) => { if (cell.road) total += ROAD_CLASS[roadClassAt(c, i)].dailyUpkeep; });
  return total;
}

/** Set road parcels to a class, keeping keys sorted; a city back to all local streets drops the section. */
export function setRoadClass(c: Host, cells: readonly number[], to: RoadClass): number {
  let changed = 0;
  const next: Record<string, UpgradedRoadClass> = { ...(c.roadClasses?.cells ?? {}) };
  for (const cell of new Set(cells)) {
    if (!c.cells[cell]?.road || roadClassAt(c, cell) === to) continue;
    if (to === 'local') delete next[cell]; else next[cell] = to;
    changed++;
  }
  if (!changed) return 0;
  const sorted = Object.keys(next).map(Number).sort((a, b) => a - b);
  if (sorted.length) c.roadClasses = { version: 1, cells: Object.fromEntries(sorted.map(k => [String(k), next[k]])) };
  else delete c.roadClasses;
  return changed;
}
/** Forget a parcel's class when its road is removed. */
export function forgetRoadClass(c: Host, cell: number) {
  if (!c.roadClasses?.cells[cell]) return;
  const rest = Object.entries(c.roadClasses.cells).filter(([k]) => Number(k) !== cell);
  if (rest.length) c.roadClasses = { version: 1, cells: Object.fromEntries(rest) }; else delete c.roadClasses;
}

/** Throws on a malformed road class section. Runs only when `roadClasses` is present. */
export function validateRoadClasses(value: unknown, c: Pick<Host, 'cells'>): asserts value is RoadClassState {
  const fail = (why: string): never => { throw new Error(`Invalid road classes save: ${why}`); };
  const s = value as RoadClassState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'cells,version' || s.version !== 1 || !s.cells || typeof s.cells !== 'object' || Array.isArray(s.cells)) fail('envelope');
  const keys = Object.keys(s.cells);
  if (!keys.length) fail('empty');
  let last = -1;
  for (const key of keys) {
    const cell = Number(key);
    if (!/^(0|[1-9]\d*)$/.test(key) || cell <= last || cell >= c.cells.length) fail('cell');
    if (!c.cells[cell].road) fail('not a road');
    if (s.cells[key] !== 'collector' && s.cells[key] !== 'arterial') fail('class');
    last = cell;
  }
}
