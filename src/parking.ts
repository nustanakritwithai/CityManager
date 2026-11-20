/**
 * Driveways and parking, read-only: where each building meets the road and how many vehicles it can hold.
 * Every real trip in the travel plan starts at an origin's driveway and ends at a destination's parking, so
 * these figures come from the building itself (its homes, its staff, its customers and its deliveries).
 * Nothing is stored: the answer follows the city's roads and buildings as they are now.
 */
import { civicSpec, type CivicKind, type CivicSite } from './civic/sites.ts';
import { getHousingCapacity, legacyHousingCapacity } from './housing.ts';
import { ROAD_CLASS, roadClassAt, type RoadClass } from './road-classes.ts';
import { roadNeighborsFor, type RoadMap } from './road-topology.ts';
import { factoryLevel } from './factory-levels.ts';
import { retailCapacity } from './retail-capacity.ts';

type Host = RoadMap & { cells: { road: boolean; building: number | null }[]; housingScale?: 1 };
type BuildingLike = { id: number; cell: number; zone: 'R' | 'C' | 'I' | 'F'; level: number; housingType?: 'cottage' | 'apartment' | 'condo' };

export type Parking = {
  /** Spaces for the people who live or work here. */
  residentOrStaff: number;
  /** Spaces for customers and visitors. */
  visitor: number;
  /** Bays where a truck stops to load or unload goods or crops. */
  loadingBays: number;
};
export const totalSpaces = (p: Parking) => p.residentOrStaff + p.visitor;

const RANK: Record<RoadClass, number> = { local: 0, collector: 1, arterial: 2 };

/**
 * The road parcel a building enters and leaves by: of the road parcels beside its footprint, the smallest
 * road (a driveway onto a side street keeps the main road flowing, as access rules do), then the lowest
 * parcel number. Null while no road touches it.
 */
export function driveway(c: Host, footprint: readonly number[]): number | null {
  const own = new Set(footprint), roads = new Set<number>();
  for (const cell of footprint) for (const n of roadNeighborsFor(c, cell)) if (!own.has(n) && c.cells[n]?.road) roads.add(n);
  let best: number | null = null;
  for (const road of roads) {
    if (best === null) { best = road; continue; }
    const a = RANK[roadClassAt(c, road)], b = RANK[roadClassAt(c, best)];
    if (a < b || (a === b && road < best)) best = road;
  }
  return best;
}

/**
 * Parking for a building, by what it is:
 * - a home has one space per dwelling (a cottage of three households has three);
 * - a shop has a space per staff post, two customer spaces per staff post and one loading bay;
 * - a factory has a space per job and a loading bay for every two levels (at least one);
 * - a farm has a space per worker and one loading bay where crops leave.
 */
/** `rules` is the building's city: one saved before real building sizes keeps its smaller homes, and so fewer bays. */
export function buildingParking(b: BuildingLike, rules: { housingScale?: 1 } = { housingScale: 1 }): Parking {
  if (b.zone === 'R') return { residentOrStaff: (rules.housingScale === 1 ? getHousingCapacity : legacyHousingCapacity)(b.housingType ?? 'cottage', b.level).households, visitor: 0, loadingBays: 0 };
  if (b.zone === 'C') { const staff = b.level === 1 ? 1 : retailCapacity(b.level).workers; return { residentOrStaff: staff, visitor: staff * 2, loadingBays: 1 }; }
  if (b.zone === 'I') return { residentOrStaff: factoryLevel(b.level).jobs, visitor: 0, loadingBays: Math.max(1, Math.floor(b.level / 2)) };
  return { residentOrStaff: b.level, visitor: 0, loadingBays: 1 };
}

/** Visitor spaces at a city service or venue that has no staff posts to size it by. */
const SERVICE_VISITORS: Readonly<Partial<Record<CivicKind, number>>> = Object.freeze({
  clinic: 6, police: 4, fire: 2, library: 8, temple: 12, stadium: 120, airport: 200, hospital: 40, museum: 16, amusement: 80,
});
/** Staff spaces at a service without staff posts: the people who run it every day. */
const SERVICE_STAFF: Readonly<Partial<Record<CivicKind, number>>> = Object.freeze({
  clinic: 4, police: 6, fire: 8, library: 2, temple: 2, stadium: 10, airport: 30, hospital: 25, museum: 4, amusement: 12,
});

/** Parking at a city service or venue. A venue sizes its car park by its staff posts and the visitors they serve a day. */
export function civicParking(kind: CivicKind): Parking {
  const staff = civicSpec(kind).staff;
  if (staff) return { residentOrStaff: staff.slots, visitor: staff.slots * staff.visitsPerWorker, loadingBays: 1 };
  return { residentOrStaff: SERVICE_STAFF[kind] ?? 0, visitor: SERVICE_VISITORS[kind] ?? 0, loadingBays: kind === 'hospital' || kind === 'airport' ? 2 : 0 };
}
export const civicFootprint = (site: Pick<CivicSite, 'cell' | 'cells'>) => site.cells ?? [site.cell];

export type AccessReport = { driveway: number | null; roadClass: RoadClass | null; roadLabel: string | null; parking: Parking };
/** One building's driveway and parking, for the building card. */
export function buildingAccess(c: Host, b: BuildingLike): AccessReport {
  const road = driveway(c, [b.cell]), cls = road === null ? null : roadClassAt(c, road);
  return { driveway: road, roadClass: cls, roadLabel: cls === null ? null : ROAD_CLASS[cls].label, parking: buildingParking(b, c) };
}
