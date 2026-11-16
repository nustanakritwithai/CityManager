/**
 * City services and places the treasury builds: clinic, police and fire stations, library, temple,
 * football stadium and airport. Most serve homes within a
 * walking radius and adds to their happiness. Pure data + validation with no sim.ts import, so sim.ts
 * can depend on it without a cycle. Stored only in the optional `city.civic` save section: a city that
 * never builds one keeps a byte-identical save.
 */
export const CIVIC_KINDS = ['clinic', 'police', 'fire', 'library', 'temple', 'stadium', 'airport', 'hospital', 'museum', 'amusement'] as const;
export type CivicKind = typeof CIVIC_KINDS[number];
/** `cell` is the top-left parcel. `cells` lists the whole footprint, top-left first, and is present only on sites larger than one parcel. */
export type CivicSite = { id: number; cell: number; kind: CivicKind; tick: number; cells?: number[] };
export type CivicState = { version: 1; rules: 'civic-1'; sites: CivicSite[] };

/**
 * Money in satang. `radius` is Manhattan cells from the nearest parcel of the site; `points` is happiness for a covered home.
 * `footprint` is [columns, rows] and defaults to one parcel. `visitors` is monthly income from outside: a base plus an
 * amount per attraction in the city.
 */
export type CivicSpec = { label: string; cost: number; upkeep: number; radius: number; points: number; footprint?: readonly [number, number]; visitors?: { base: number; perAttraction: number } };
export const CIVIC = Object.freeze({
  clinic: Object.freeze({ label: 'สถานีอนามัย', cost: 250_000, upkeep: 6_000, radius: 7, points: 5 }),
  police: Object.freeze({ label: 'สถานีตำรวจ', cost: 300_000, upkeep: 8_000, radius: 8, points: 5 }),
  fire: Object.freeze({ label: 'สถานีดับเพลิง', cost: 300_000, upkeep: 8_000, radius: 8, points: 5 }),
  library: Object.freeze({ label: 'ห้องสมุด', cost: 150_000, upkeep: 4_000, radius: 6, points: 4 }),
  temple: Object.freeze({ label: 'วัด', cost: 200_000, upkeep: 3_000, radius: 7, points: 5 }),
  stadium: Object.freeze({ label: 'สนามฟุตบอล', cost: 800_000, upkeep: 20_000, radius: 12, points: 8, footprint: [2, 2] as const }),
  airport: Object.freeze({ label: 'สนามบิน', cost: 2_000_000, upkeep: 50_000, radius: 0, points: 0, footprint: [3, 2] as const, visitors: Object.freeze({ base: 50_000, perAttraction: 30_000 }) }),
  hospital: Object.freeze({ label: 'โรงพยาบาล', cost: 1_200_000, upkeep: 30_000, radius: 14, points: 8, footprint: [2, 2] as const }),
  museum: Object.freeze({ label: 'พิพิธภัณฑ์', cost: 400_000, upkeep: 8_000, radius: 8, points: 4 }),
  amusement: Object.freeze({ label: 'สวนสนุก', cost: 1_000_000, upkeep: 25_000, radius: 12, points: 7, footprint: [2, 2] as const }),
} satisfies Record<CivicKind, CivicSpec>);
export const MAX_CIVIC_SITES = 20;
/** Ledger reasons stay English like every other journal reason; panels translate them. */
export const CIVIC_REASON_NAMES: Record<CivicKind, string> = { clinic: 'clinic', police: 'police station', fire: 'fire station', library: 'library', temple: 'temple', stadium: 'football stadium', airport: 'airport', hospital: 'hospital', museum: 'museum', amusement: 'amusement park' };
export const civicBuildReason = (kind: CivicKind, id: number) => `Build ${CIVIC_REASON_NAMES[kind]} #${id}`;
export const civicUpkeepReason = (kind: CivicKind, id: number) => `Monthly ${CIVIC_REASON_NAMES[kind]} upkeep #${id}`;
export const civicVisitorsReason = (id: number) => `Airport visitors #${id}`;
/** Kinds visitors come for; parks count too, and the caller adds them. */
export const CIVIC_ATTRACTIONS: readonly CivicKind[] = ['library', 'temple', 'stadium', 'museum', 'amusement'];
export const civicSpec = (kind: CivicKind): CivicSpec => CIVIC[kind];
export const civicFootprint = (kind: CivicKind): readonly [number, number] => civicSpec(kind).footprint ?? [1, 1];
/** Every parcel a site stands on. */
export const civicCells = (site: CivicSite): readonly number[] => site.cells ?? [site.cell];
/** Monthly income of one airport given how many attractions the city has. */
export const civicVisitorIncome = (kind: CivicKind, attractions: number) => { const v = civicSpec(kind).visitors; return v ? v.base + v.perAttraction * Math.max(0, attractions) : 0; };

export const isCivicKind = (value: string): value is CivicKind => (CIVIC_KINDS as readonly string[]).includes(value);
export const createCivic = (): CivicState => ({ version: 1, rules: 'civic-1', sites: [] });
type Host = { civic?: CivicState };
export const civicAt = (c: Host, i: number): CivicSite | undefined => c.civic?.sites.find(s => s.cell === i || !!s.cells?.includes(i));

/** Which kinds reach a home; `distance` is supplied by the caller so this module stays map-free. */
export function civicCoverage(c: Host, cell: number, distance: (a: number, b: number) => number): Record<CivicKind, boolean> {
  const covered = Object.fromEntries(CIVIC_KINDS.map(kind => [kind, false])) as Record<CivicKind, boolean>;
  for (const site of c.civic?.sites ?? []) if (!covered[site.kind] && civicSpec(site.kind).points > 0 && civicCells(site).some(part => distance(cell, part) <= civicSpec(site.kind).radius)) covered[site.kind] = true;
  return covered;
}
/** Services and places together add at most this much to a home's target, so a city cannot buy full happiness with buildings alone. */
export const CIVIC_POINTS_CAP = 30;
export const civicPoints = (covered: Record<CivicKind, boolean>) => Math.min(CIVIC_POINTS_CAP, CIVIC_KINDS.reduce((n, kind) => n + (covered[kind] ? CIVIC[kind].points : 0), 0));

/** Facts the validator needs from the city, supplied by sim.ts (keeps this module City-free). */
export type CivicValidationView = {
  cells: readonly { road: boolean; zone: unknown; building: number | null }[];
  tick: number; nextId: number;
  /** The parcels a kind covers from a top-left parcel on this map, or null when it would leave the map. */
  footprint: (kind: CivicKind, anchor: number) => number[] | null;
  /** Cells and ids already held by parks, plants, campuses, taxi and bus sites. */
  otherCells: ReadonlySet<number>; otherIds: ReadonlySet<number>;
};
/** Throws on any malformed or conflicting civic section. Runs only when `civic` is present. */
export function validateCivic(value: unknown, view: CivicValidationView): asserts value is CivicState {
  const fail = (why: string): never => { throw new Error(`Invalid civic save: ${why}`); };
  const s = value as CivicState;
  if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'rules,sites,version' || s.version !== 1 || s.rules !== 'civic-1' || !Array.isArray(s.sites)) fail('envelope');
  if (s.sites.length > MAX_CIVIC_SITES) fail('too many sites');
  const ids = new Set<number>(), cells = new Set<number>();
  for (const site of s.sites) {
    const keys = site && typeof site === 'object' ? Object.keys(site).sort().join(',') : '';
    if (keys !== 'cell,id,kind,tick' && keys !== 'cell,cells,id,kind,tick') fail('site fields');
    if (!CIVIC_KINDS.includes(site.kind)) fail('site kind');
    if (!Number.isSafeInteger(site.id) || site.id < 1 || site.id >= view.nextId || ids.has(site.id) || view.otherIds.has(site.id)) fail('site id');
    // A site without `cells` is one parcel: every kind was, before larger footprints existed, so old stadiums stay valid.
    const footprint = site.cells === undefined ? [site.cell] : view.footprint(site.kind, site.cell);
    if (site.cells !== undefined && (!Array.isArray(site.cells) || !footprint || footprint.length < 2 || site.cells.length !== footprint.length || site.cells.some((part, n) => part !== footprint[n]))) fail('site footprint');
    if (site.cells === undefined && civicSpec(site.kind).visitors) fail('site footprint');
    for (const part of footprint!) {
      if (!Number.isSafeInteger(part) || part < 0 || part >= view.cells.length || cells.has(part) || view.otherCells.has(part)) fail('site cell');
      const cell = view.cells[part];
      if (cell.road || cell.zone !== null || cell.building !== null) fail('site overlaps road, zone or building');
    }
    if (!Number.isSafeInteger(site.tick) || site.tick < 0 || site.tick > view.tick) fail('site tick');
    ids.add(site.id); for (const part of footprint!) cells.add(part);
  }
}
